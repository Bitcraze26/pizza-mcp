import type { DoughResult } from "./calc.js";

const grams1 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
const grams2 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

function safeName(name: string): string {
  return name.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Riepilogo leggibile (Markdown, in italiano) del risultato del calcolo.
 */
export function formatResult(result: DoughResult): string {
  const lines: string[] = [];
  const ballNoun = result.balls === 1 ? "panetto" : "panetti";

  lines.push(
    `## Dosi per ${result.balls} ${ballNoun} da ${grams1.format(result.ballWeightGrams)} g`,
  );
  lines.push("");
  lines.push(
    `**Totale impasto: ${grams1.format(result.targetDoughGrams)} g** ` +
      `(${result.balls} × ${grams1.format(result.ballWeightGrams)} g)`,
  );
  lines.push("");
  lines.push("| Ingrediente | Grammi | % sulla farina |");
  lines.push("|---|---:|---:|");
  if (result.flours.length === 1) {
    const flour = result.flours[0]!;
    lines.push(
      `| Farina — ${safeName(flour.name)} | **${grams1.format(result.totalFlourGrams)}** | **100%** |`,
    );
  } else {
    lines.push(
      `| Farina (totale) | **${grams1.format(result.totalFlourGrams)}** | **100%** |`,
    );
    for (const flour of result.flours) {
      lines.push(
        `| ↳ ${safeName(flour.name)} | ${grams1.format(flour.grams)} | ${percent.format(flour.percent)}% |`,
      );
    }
  }
  lines.push(
    `| Acqua | ${grams1.format(result.water.grams)} | ${percent.format(result.water.bakerPercent)}% |`,
  );
  lines.push(
    `| Sale | ${grams1.format(result.salt.grams)} | ${percent.format(result.salt.bakerPercent)}% |`,
  );
  lines.push(
    `| ${capitalize(result.yeast.typeLabel)} | ${grams2.format(result.yeast.grams)} | ${percent.format(result.yeast.bakerPercent)}% |`,
  );
  lines.push("");

  const f = result.fermentation;
  const phases: string[] = [];
  if (f.fridgeHours > 0) {
    phases.push(
      `${grams1.format(f.fridgeHours)} h in frigo a ${grams1.format(f.fridgeTemperatureC)} °C`,
    );
  }
  if (f.roomHours > 0) {
    phases.push(
      `${grams1.format(f.roomHours)} h a ${grams1.format(f.roomTemperatureC)} °C`,
    );
  }

  const atReferenceTemperature =
    f.fridgeHours === 0 && Math.abs(f.roomTemperatureC - 20) < 0.01;

  lines.push("### Lievitazione");
  lines.push(
    `- **${phases.join(" + ")}**` +
      (atReferenceTemperature
        ? ""
        : ` — circa ${grams1.format(f.effectiveHoursAt20C)} h equivalenti a 20 °C`),
  );
  if (result.yeast.source === "model") {
    lines.push(
      `- Lievito stimato dal modello tempo/temperatura: **${percent.format(result.yeast.bakerPercent)}%** ` +
        `di ${result.yeast.typeLabel} sulla farina`,
    );
  } else {
    lines.push(
      `- Lievito impostato manualmente: **${percent.format(result.yeast.bakerPercent)}%** ` +
        `di ${result.yeast.typeLabel} sulla farina`,
    );
  }
  lines.push("");
  lines.push(
    `Idratazione **${percent.format(result.hydrationPercent)}%** · ` +
      `Sale **${percent.format(result.saltPercent)}%**`,
  );

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("### Note");
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join("\n");
}
