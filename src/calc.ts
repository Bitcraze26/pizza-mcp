/**
 * Motore di calcolo per l'impasto della pizza (metodo diretto).
 *
 * Tutte le percentuali sono "percentuali del fornaio": la farina totale è
 * sempre 100%, mentre acqua, sale e lievito sono espressi in rapporto al peso
 * della farina.
 */

export const YEAST_TYPES = ["fresh", "dry", "instant"] as const;
export type YeastType = (typeof YEAST_TYPES)[number];

export const YEAST_TYPE_LABELS: Record<YeastType, string> = {
  fresh: "lievito di birra fresco",
  dry: "lievito di birra secco attivo",
  instant: "lievito di birra istantaneo",
};

/**
 * Quanto lievito del tipo scelto equivale a 1 g di lievito fresco.
 * 1 g di secco attivo ≈ 2,5 g di fresco; 1 g di istantaneo ≈ 3 g di fresco.
 */
const FRESH_EQUIVALENT_FACTOR: Record<YeastType, number> = {
  fresh: 1,
  dry: 0.4,
  instant: 1 / 3,
};

export const DEFAULT_HYDRATION_PERCENT = 62;
export const DEFAULT_SALT_PERCENT = 2.5;
export const DEFAULT_ROOM_HOURS = 24;
export const DEFAULT_ROOM_TEMPERATURE_C = 20;
export const DEFAULT_FRIDGE_TEMPERATURE_C = 4;

/**
 * Modello di stima del lievito.
 *
 * L'attività del lievito viene normalizzata a 20 °C con un fattore Q10 = 2:
 * ogni 10 °C in più raddoppia la velocità, ogni 10 °C in meno la dimezza.
 * Le ore equivalenti a 20 °C sono quindi:
 *
 *   ore_equivalenti = Σ (ore_i × 2^((T_i - 20) / 10))
 *
 * La percentuale di lievito fresco sul peso della farina è:
 *
 *   lievito_fresco_% = 3,6 / ore_equivalenti
 *
 * (3,6 %·h corrisponde a circa 0,4% di lievito fresco per 8 ore a 20 °C).
 */
export const YEAST_REFERENCE_TEMPERATURE_C = 20;
export const YEAST_Q10 = 2;
export const YEAST_K_PERCENT_HOURS = 3.6;
export const MIN_FRESH_YEAST_PERCENT = 0.05;
export const MAX_FRESH_YEAST_PERCENT = 4;

export interface FlourInput {
  /** Nome o descrizione della farina (es. "Tipo 00 W300"). */
  name?: string;
  /** Percentuale sul totale della farina. Non deve necessariamente sommare 100. */
  percent: number;
}

export interface DoughInput {
  /** Numero di panetti. */
  balls: number;
  /** Peso di ciascun panetto in grammi. */
  ballWeightGrams: number;
  /** Idratazione in % sul peso della farina (default 62). */
  hydrationPercent?: number;
  /** Sale in % sul peso della farina (default 2,5). */
  saltPercent?: number;
  /** Una o più farine; se assente, una sola farina al 100%. */
  flours?: FlourInput[];
  /** Tipo di lievito (default "fresh"). */
  yeastType?: YeastType;
  /** Se indicato, forza la % di lievito (del tipo scelto) sul peso della farina. */
  yeastPercent?: number;
  /** Ore a temperatura ambiente (default 24, oppure 0 se si usa solo il frigo). */
  roomHours?: number;
  /** Temperatura ambiente in °C (default 20). */
  roomTemperatureC?: number;
  /** Ore in frigorifero (default 0). */
  fridgeHours?: number;
  /** Temperatura del frigorifero in °C (default 4). */
  fridgeTemperatureC?: number;
}

export interface FlourShare {
  name: string;
  /** Percentuale normalizzata sul totale della farina. */
  percent: number;
  grams: number;
}

export interface DoughResult {
  balls: number;
  ballWeightGrams: number;
  /** Peso obiettivo dell'impasto: panetti × peso panetto. */
  targetDoughGrams: number;
  /** Somma degli ingredienti arrotondati (può differire di frazioni di grammo). */
  doughGrams: number;
  totalFlourGrams: number;
  hydrationPercent: number;
  saltPercent: number;
  flours: FlourShare[];
  water: {
    grams: number;
    bakerPercent: number;
  };
  salt: {
    grams: number;
    bakerPercent: number;
  };
  yeast: {
    type: YeastType;
    typeLabel: string;
    grams: number;
    /** Percentuale del tipo di lievito scelto sul peso della farina. */
    bakerPercent: number;
    freshEquivalentGrams: number;
    freshEquivalentPercent: number;
    source: "model" | "override";
  };
  fermentation: {
    roomHours: number;
    roomTemperatureC: number;
    fridgeHours: number;
    fridgeTemperatureC: number;
    totalHours: number;
    /** Ore di fermentazione equivalenti a 20 °C. */
    effectiveHoursAt20C: number;
    /** Rapporto tra ore equivalenti e ore reali. */
    averageTemperatureFactor: number;
    /** Percentuale di lievito fresco stimata dal modello (dopo i limiti). */
    modelFreshYeastPercent: number;
    /** True se la stima del modello è stata limitata a un minimo/massimo. */
    modelClamped: boolean;
  };
  warnings: string[];
}

const numberFormat = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 3,
});

function fmt(value: number): string {
  return numberFormat.format(value);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} deve essere un numero maggiore o uguale a zero.`);
  }
}

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} deve essere un numero maggiore di zero.`);
  }
}

/** Fattore di attività del lievito rispetto a 20 °C. */
export function yeastActivityFactor(temperatureC: number): number {
  return Math.pow(YEAST_Q10, (temperatureC - YEAST_REFERENCE_TEMPERATURE_C) / 10);
}

/** Ore di fermentazione equivalenti a 20 °C per una fase a temperatura costante. */
export function equivalentHoursAt20C(hours: number, temperatureC: number): number {
  return hours * yeastActivityFactor(temperatureC);
}

/**
 * Calcola dosi, percentuali e stima del lievito a partire dai parametri
 * dell'impasto. Lancia RangeError per input non validi.
 */
export function calculateDough(input: DoughInput): DoughResult {
  const warnings: string[] = [];

  if (!Number.isInteger(input.balls) || input.balls < 1) {
    throw new RangeError("Il numero di panetti deve essere un intero maggiore di zero.");
  }
  assertPositive(input.ballWeightGrams, "Il peso del panetto");

  const hydrationPercent = input.hydrationPercent ?? DEFAULT_HYDRATION_PERCENT;
  assertPositive(hydrationPercent, "L'idratazione");

  const saltPercent = input.saltPercent ?? DEFAULT_SALT_PERCENT;
  assertNonNegative(saltPercent, "Il sale");

  const yeastType = input.yeastType ?? "fresh";
  if (!YEAST_TYPES.includes(yeastType)) {
    throw new RangeError("Tipo di lievito non valido: usa fresh, dry o instant.");
  }

  const roomTemperatureC = input.roomTemperatureC ?? DEFAULT_ROOM_TEMPERATURE_C;
  if (!Number.isFinite(roomTemperatureC)) {
    throw new RangeError("La temperatura ambiente non è valida.");
  }

  const fridgeTemperatureC = input.fridgeTemperatureC ?? DEFAULT_FRIDGE_TEMPERATURE_C;
  if (!Number.isFinite(fridgeTemperatureC)) {
    throw new RangeError("La temperatura del frigo non è valida.");
  }

  const fridgeHours = input.fridgeHours ?? 0;
  assertNonNegative(fridgeHours, "Le ore in frigo");

  // Se non viene indicato nulla, si assume una lievitazione di 24 h a
  // temperatura ambiente. Se invece si usa il frigo, le ore a temperatura
  // ambiente servono solo per l'appretto e vanno indicate esplicitamente.
  const roomHours = input.roomHours ?? (fridgeHours > 0 ? 0 : DEFAULT_ROOM_HOURS);
  assertNonNegative(roomHours, "Le ore a temperatura ambiente");

  const totalHours = roomHours + fridgeHours;
  if (totalHours <= 0) {
    throw new RangeError(
      "Indica almeno un'ora di lievitazione (room_hours e/o fridge_hours).",
    );
  }

  const rawFlours: FlourInput[] =
    input.flours && input.flours.length > 0 ? input.flours : [{ percent: 100 }];

  const flourSum = rawFlours.reduce((sum, flour) => sum + flour.percent, 0);
  if (!Number.isFinite(flourSum) || flourSum <= 0) {
    throw new RangeError("Le percentuali delle farine devono essere maggiori di zero.");
  }
  for (const flour of rawFlours) {
    assertPositive(flour.percent, "La percentuale di ogni farina");
  }

  if (Math.abs(flourSum - 100) > 0.01) {
    warnings.push(
      `Le percentuali delle farine sommano ${fmt(flourSum)}%: sono state normalizzate a 100%.`,
    );
  }

  const normalizedFlours = rawFlours.map((flour, index) => ({
    name:
      flour.name?.trim() ||
      (rawFlours.length === 1 ? "Farina" : `Farina ${index + 1}`),
    percent: (flour.percent / flourSum) * 100,
  }));

  const effectiveHours =
    equivalentHoursAt20C(roomHours, roomTemperatureC) +
    equivalentHoursAt20C(fridgeHours, fridgeTemperatureC);

  if (effectiveHours <= 0) {
    throw new RangeError("Le ore equivalenti di fermentazione devono essere maggiori di zero.");
  }

  const rawFreshYeastPercent = YEAST_K_PERCENT_HOURS / effectiveHours;
  const modelFreshYeastPercent = Math.min(
    Math.max(rawFreshYeastPercent, MIN_FRESH_YEAST_PERCENT),
    MAX_FRESH_YEAST_PERCENT,
  );
  const modelClamped = modelFreshYeastPercent !== rawFreshYeastPercent;

  if (modelClamped && input.yeastPercent === undefined) {
    if (rawFreshYeastPercent < MIN_FRESH_YEAST_PERCENT) {
      warnings.push(
        `La fermentazione è molto lunga: il modello stima ${fmt(rawFreshYeastPercent)}% di lievito fresco, ` +
          `ed è stato applicato il minimo di ${fmt(MIN_FRESH_YEAST_PERCENT)}%. ` +
          "Controlla la maturazione dell'impasto durante la lievitazione.",
      );
    } else {
      warnings.push(
        `La fermentazione è molto breve: il modello stima ${fmt(rawFreshYeastPercent)}% di lievito fresco, ` +
          `ed è stato applicato il massimo del ${fmt(MAX_FRESH_YEAST_PERCENT)}%. ` +
          "Tieni d'occhio l'impasto per evitare una lievitazione eccessiva.",
      );
    }
  }

  let yeastPercent: number;
  let freshEquivalentPercent: number;
  let yeastSource: "model" | "override";

  if (input.yeastPercent !== undefined) {
    assertNonNegative(input.yeastPercent, "La percentuale di lievito");
    yeastPercent = input.yeastPercent;
    freshEquivalentPercent = yeastPercent / FRESH_EQUIVALENT_FACTOR[yeastType];
    yeastSource = "override";
    warnings.push(
      `Lievito impostato manualmente: ${fmt(yeastPercent)}% di ${YEAST_TYPE_LABELS[yeastType]} ` +
        "sulla farina. Il modello tempo/temperatura non è stato usato.",
    );
  } else {
    yeastPercent = modelFreshYeastPercent * FRESH_EQUIVALENT_FACTOR[yeastType];
    freshEquivalentPercent = modelFreshYeastPercent;
    yeastSource = "model";
  }

  const targetDoughGrams = input.balls * input.ballWeightGrams;
  const totalPercentage = 100 + hydrationPercent + saltPercent + yeastPercent;
  const exactFlourGrams = (targetDoughGrams / totalPercentage) * 100;

  const exactWaterGrams = (exactFlourGrams * hydrationPercent) / 100;
  const exactSaltGrams = (exactFlourGrams * saltPercent) / 100;
  const exactYeastGrams = (exactFlourGrams * yeastPercent) / 100;

  const flours: FlourShare[] = normalizedFlours.map((flour) => ({
    name: flour.name,
    percent: round(flour.percent, 2),
    grams: round((exactFlourGrams * flour.percent) / 100, 1),
  }));

  const totalFlourGrams = round(
    flours.reduce((sum, flour) => sum + flour.grams, 0),
    1,
  );
  const waterGrams = round(exactWaterGrams, 1);
  const saltGrams = round(exactSaltGrams, 1);
  const yeastGrams = round(exactYeastGrams, 2);
  const doughGrams = round(
    totalFlourGrams + waterGrams + saltGrams + yeastGrams,
    1,
  );

  // Avvisi di praticità (non bloccanti).
  if (hydrationPercent > 75) {
    warnings.push(
      `Idratazione alta (${fmt(hydrationPercent)}%): l'impasto sarà più morbido e difficile da gestire. ` +
        "Considera l'uso delle mani bagnate o di una ciotola oliata.",
    );
  } else if (hydrationPercent < 55) {
    warnings.push(
      `Idratazione bassa (${fmt(hydrationPercent)}%): l'impasto risulterà compatto e meno estensibile.`,
    );
  }

  if (saltPercent > 0 && saltPercent < 1.5) {
    warnings.push(
      `Sale sotto il range tipico (${fmt(saltPercent)}%): di solito si usa il 2-3% sulla farina.`,
    );
  } else if (saltPercent > 4) {
    warnings.push(
      `Sale sopra il range tipico (${fmt(saltPercent)}%): di solito si usa il 2-3% sulla farina.`,
    );
  }

  if (yeastPercent > 0 && yeastGrams < 0.2) {
    warnings.push(
      `Pochissimo lievito (${fmt(yeastGrams)} g): usa una bilancia da cucina con precisione 0,1 g ` +
        "e scioglilo bene in un po' d'acqua.",
    );
  } else if (yeastSource === "model" && freshEquivalentPercent > 2) {
    warnings.push(
      `Lievito elevato (${fmt(freshEquivalentPercent)}% equivalente fresco): è tipico di fermentazioni molto brevi. ` +
        "Non allungare troppo i tempi o l'impasto può sovralievitare.",
    );
  }

  if (fridgeHours > 0 && roomHours < 1.5) {
    warnings.push(
      "Usi il frigo: lascia i panetti 1-2 ore a temperatura ambiente prima di stendere e infornare (appretto).",
    );
  }

  if (totalHours < 3) {
    warnings.push(
      "Fermentazione molto breve (meno di 3 ore): l'impasto sarà meno digeribile e più elastico. " +
        "Se puoi, allunga il riposo in frigo.",
    );
  }

  return {
    balls: input.balls,
    ballWeightGrams: round(input.ballWeightGrams, 1),
    targetDoughGrams: round(targetDoughGrams, 1),
    doughGrams,
    totalFlourGrams,
    hydrationPercent,
    saltPercent,
    flours,
    water: {
      grams: waterGrams,
      bakerPercent: hydrationPercent,
    },
    salt: {
      grams: saltGrams,
      bakerPercent: saltPercent,
    },
    yeast: {
      type: yeastType,
      typeLabel: YEAST_TYPE_LABELS[yeastType],
      grams: yeastGrams,
      bakerPercent: round(yeastPercent, 3),
      freshEquivalentGrams: round((exactFlourGrams * freshEquivalentPercent) / 100, 2),
      freshEquivalentPercent: round(freshEquivalentPercent, 3),
      source: yeastSource,
    },
    fermentation: {
      roomHours: round(roomHours, 2),
      roomTemperatureC,
      fridgeHours: round(fridgeHours, 2),
      fridgeTemperatureC,
      totalHours: round(totalHours, 2),
      effectiveHoursAt20C: round(effectiveHours, 2),
      averageTemperatureFactor: round(effectiveHours / totalHours, 3),
      modelFreshYeastPercent: round(modelFreshYeastPercent, 3),
      modelClamped,
    },
    warnings,
  };
}
