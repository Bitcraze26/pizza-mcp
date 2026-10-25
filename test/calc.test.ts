import { describe, expect, it } from "vitest";
import {
  calculateDough,
  equivalentHoursAt20C,
  MAX_FRESH_YEAST_PERCENT,
  MIN_FRESH_YEAST_PERCENT,
  YEAST_K_PERCENT_HOURS,
  type DoughInput,
} from "../src/calc.js";
import { formatResult } from "../src/format.js";

function make(overrides: Partial<DoughInput> = {}): DoughInput {
  return {
    balls: 6,
    ballWeightGrams: 250,
    hydrationPercent: 62,
    saltPercent: 2.5,
    roomHours: 24,
    roomTemperatureC: 20,
    ...overrides,
  };
}

describe("calculateDough", () => {
  it("calcola farina, acqua, sale e lievito dal peso totale dell'impasto", () => {
    const result = calculateDough(make());

    const freshYeastPercent = YEAST_K_PERCENT_HOURS / 24;
    const expectedFlour =
      (6 * 250) / (1 + (62 + 2.5 + freshYeastPercent) / 100);

    expect(result.targetDoughGrams).toBe(1500);
    expect(result.totalFlourGrams).toBeCloseTo(expectedFlour, 0);
    expect(result.water.grams).toBeCloseTo(expectedFlour * 0.62, 0);
    expect(result.salt.grams).toBeCloseTo(expectedFlour * 0.025, 0);
    expect(result.yeast.grams).toBeCloseTo(
      expectedFlour * (freshYeastPercent / 100),
      1,
    );
    expect(result.water.bakerPercent).toBe(62);
    expect(result.salt.bakerPercent).toBe(2.5);
    expect(result.yeast.bakerPercent).toBeCloseTo(0.15, 3);
    expect(result.doughGrams).toBeCloseTo(1500, 0);
    expect(result.warnings).toEqual([]);
  });

  it("usa i valori di default quando i parametri facoltativi mancano", () => {
    const result = calculateDough({ balls: 2, ballWeightGrams: 250 });

    expect(result.hydrationPercent).toBe(62);
    expect(result.saltPercent).toBe(2.5);
    expect(result.flours).toHaveLength(1);
    expect(result.flours[0]!.name).toBe("Farina");
    expect(result.flours[0]!.percent).toBe(100);
    expect(result.yeast.type).toBe("fresh");
    expect(result.fermentation.totalHours).toBe(24);
    expect(result.fermentation.roomTemperatureC).toBe(20);
  });

  it("divide la farina tra più farine secondo le percentuali", () => {
    const result = calculateDough(
      make({
        flours: [
          { name: "Tipo 00 W300", percent: 70 },
          { name: "Farina integrale", percent: 30 },
        ],
      }),
    );

    expect(result.flours.map((f) => f.percent)).toEqual([70, 30]);
    expect(result.flours[0]!.name).toBe("Tipo 00 W300");
    expect(result.flours[0]!.grams + result.flours[1]!.grams).toBeCloseTo(
      result.totalFlourGrams,
      1,
    );
    expect(result.flours[0]!.grams).toBeCloseTo(
      result.totalFlourGrams * 0.7,
      0,
    );
  });

  it("normalizza le percentuali delle farine se non sommano 100", () => {
    const result = calculateDough(
      make({
        flours: [
          { name: "A", percent: 1 },
          { name: "B", percent: 1 },
        ],
      }),
    );

    expect(result.flours[0]!.percent).toBe(50);
    expect(result.flours[1]!.percent).toBe(50);
    expect(result.warnings.some((w) => /normalizzate/.test(w))).toBe(true);
  });

  it("richiede più lievito per una fermentazione in frigo a parità di ore", () => {
    const room = calculateDough(make({ roomHours: 24, roomTemperatureC: 20 }));
    const fridge = calculateDough(
      make({ roomHours: 0, fridgeHours: 24, fridgeTemperatureC: 4 }),
    );

    expect(fridge.yeast.grams).toBeGreaterThan(room.yeast.grams * 2);
    expect(fridge.fermentation.effectiveHoursAt20C).toBeCloseTo(
      24 * Math.pow(2, (4 - 20) / 10),
      1,
    );
    expect(fridge.fermentation.averageTemperatureFactor).toBeLessThan(0.5);
  });

  it("combina ore a temperatura ambiente e ore in frigo", () => {
    const result = calculateDough(
      make({
        roomHours: 2,
        roomTemperatureC: 20,
        fridgeHours: 22,
        fridgeTemperatureC: 4,
      }),
    );

    expect(result.fermentation.totalHours).toBe(24);
    expect(result.fermentation.effectiveHoursAt20C).toBeCloseTo(
      2 + equivalentHoursAt20C(22, 4),
      1,
    );
    expect(result.warnings.some((w) => /appretto/.test(w))).toBe(false);
  });

  it("avvisa sull'appretto quando si usa solo il frigo", () => {
    const result = calculateDough(
      make({ roomHours: 0, fridgeHours: 24, fridgeTemperatureC: 4 }),
    );

    expect(result.warnings.some((w) => /appretto/.test(w))).toBe(true);
  });

  it("converte il lievito fresco in secco e istantaneo", () => {
    const fresh = calculateDough(make({ yeastType: "fresh" }));
    const dry = calculateDough(make({ yeastType: "dry" }));
    const instant = calculateDough(make({ yeastType: "instant" }));

    expect(dry.yeast.grams).toBeCloseTo(fresh.yeast.grams * 0.4, 1);
    expect(instant.yeast.grams).toBeCloseTo(fresh.yeast.grams / 3, 1);
    expect(dry.yeast.freshEquivalentPercent).toBeCloseTo(
      fresh.yeast.freshEquivalentPercent,
      2,
    );
    expect(instant.yeast.freshEquivalentPercent).toBeCloseTo(
      fresh.yeast.freshEquivalentPercent,
      2,
    );
  });

  it("rispetta una percentuale di lievito impostata manualmente", () => {
    const result = calculateDough(make({ yeastPercent: 0.2 }));

    expect(result.yeast.source).toBe("override");
    expect(result.yeast.bakerPercent).toBeCloseTo(0.2, 3);
    expect(result.yeast.freshEquivalentPercent).toBeCloseTo(0.2, 3);
    expect(result.yeast.grams).toBeCloseTo(
      result.totalFlourGrams * 0.002,
      1,
    );
    expect(result.warnings.some((w) => /manualmente/.test(w))).toBe(true);
  });

  it("limita la stima del lievito per fermentazioni estremamente lunghe", () => {
    const result = calculateDough(make({ roomHours: 100 }));

    expect(result.fermentation.modelClamped).toBe(true);
    expect(result.fermentation.modelFreshYeastPercent).toBe(
      MIN_FRESH_YEAST_PERCENT,
    );
    expect(result.warnings.some((w) => /minimo/.test(w))).toBe(true);
  });

  it("non mostra avvisi del modello quando il lievito è impostato manualmente", () => {
    const result = calculateDough(
      make({ roomHours: 100, yeastPercent: 0.2 }),
    );

    expect(result.fermentation.modelClamped).toBe(true);
    expect(result.warnings.some((w) => /minimo/.test(w))).toBe(false);
    expect(result.warnings.some((w) => /manualmente/.test(w))).toBe(true);
  });

  it("limita la stima del lievito per fermentazioni estremamente brevi", () => {
    const result = calculateDough(make({ roomHours: 0.5 }));

    expect(result.fermentation.modelClamped).toBe(true);
    expect(result.fermentation.modelFreshYeastPercent).toBe(
      MAX_FRESH_YEAST_PERCENT,
    );
    expect(result.warnings.some((w) => /massimo/.test(w))).toBe(true);
  });

  it("avvisa per idratazioni e sale fuori dal range tipico", () => {
    const highHydration = calculateDough(make({ hydrationPercent: 80 }));
    const lowSalt = calculateDough(make({ saltPercent: 1 }));

    expect(highHydration.warnings.some((w) => /Idratazione alta/.test(w))).toBe(
      true,
    );
    expect(lowSalt.warnings.some((w) => /Sale sotto/.test(w))).toBe(true);
  });

  it("avvisa per fermentazioni molto brevi", () => {
    const result = calculateDough(make({ roomHours: 2 }));
    expect(result.warnings.some((w) => /meno di 3 ore/.test(w))).toBe(true);
  });

  it("rifiuta input non validi", () => {
    expect(() => calculateDough(make({ balls: 0 }))).toThrow(/panetti/);
    expect(() => calculateDough(make({ ballWeightGrams: 0 }))).toThrow(/peso/);
    expect(() => calculateDough(make({ hydrationPercent: 0 }))).toThrow(
      /idratazione/i,
    );
    expect(() => calculateDough(make({ saltPercent: -1 }))).toThrow(/sale/i);
    expect(() =>
      calculateDough(make({ roomHours: 0, fridgeHours: 0 })),
    ).toThrow(/almeno un'ora/);
    expect(() =>
      calculateDough(make({ flours: [{ percent: 0 }] })),
    ).toThrow(/percentual/i);
  });

  it("calcola correttamente le ore equivalenti a 20 °C", () => {
    expect(equivalentHoursAt20C(10, 20)).toBeCloseTo(10, 5);
    expect(equivalentHoursAt20C(10, 30)).toBeCloseTo(20, 5);
    expect(equivalentHoursAt20C(10, 10)).toBeCloseTo(5, 5);
    expect(equivalentHoursAt20C(10, 4)).toBeCloseTo(3.29877, 4);
  });

  it("non altera il peso totale dell'impasto con l'arrotondamento", () => {
    for (const balls of [1, 3, 6, 12, 30]) {
      const result = calculateDough(make({ balls }));
      expect(Math.abs(result.doughGrams - result.targetDoughGrams)).toBeLessThan(
        0.3,
      );
    }
  });
});

describe("formatResult", () => {
  it("produce un riepilogo markdown con le dosi e le farine", () => {
    const result = calculateDough(
      make({
        flours: [
          { name: "Tipo 00", percent: 70 },
          { name: "Integrale", percent: 30 },
        ],
      }),
    );
    const text = formatResult(result);

    expect(text).toContain("6 panetti da 250 g");
    expect(text).toContain("Farina (totale)");
    expect(text).toContain("Tipo 00");
    expect(text).toContain("Integrale");
    expect(text).toContain("Lievitazione");
    expect(text).toContain("24 h a 20 °C");
  });

  it("gestisce una sola farina senza duplicare la riga del totale", () => {
    const text = formatResult(
      calculateDough(make({ flours: [{ name: "Tipo 0", percent: 100 }] })),
    );

    expect(text).toContain("Farina — Tipo 0");
    expect(text).not.toContain("Farina (totale)");
  });
});
