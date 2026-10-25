import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  calculateDough,
  YEAST_TYPES,
  type DoughInput,
  type YeastType,
} from "./calc.js";
import { formatResult } from "./format.js";

export const SERVER_NAME = "pizza-mcp";
export const SERVER_VERSION = "1.0.0";

const floursSchema = z
  .array(
    z.object({
      name: z
        .string()
        .min(1)
        .max(120)
        .optional()
        .describe("Nome della farina (es. 'Tipo 00 W300', 'Farina integrale')."),
      percent: z
        .number()
        .positive()
        .max(1000)
        .describe(
          "Percentuale di questa farina sul totale della farina (es. 70). Le percentuali vengono normalizzate a 100 se la somma non è 100.",
        ),
    }),
  )
  .min(1)
  .max(10);

/**
 * Crea una nuova istanza del server MCP con il tool di calcolo registrato.
 * Va usata una nuova istanza per ogni connessione/richiesta: il server MCP
 * mantiene stato di protocollo non condivisibile tra sessioni.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      instructions:
        "Calcola le dosi dell'impasto della pizza (farine, acqua, sale e lievito) " +
        "a partire da panetti, peso, idratazione e programma di lievitazione. " +
        "Usa il tool calculate_dough; le percentuali sono sul peso della farina.",
    },
  );

  server.registerTool(
    "calculate_dough",
    {
      title: "Calcola dosi impasto pizza",
      description: [
        "Calcola tutte le dosi dell'impasto della pizza con il metodo diretto:",
        "grammi di ogni farina, acqua, sale e lievito, con le percentuali del fornaio.",
        "",
        "Parametri principali: numero e peso dei panetti, idratazione desiderata,",
        "una o più farine con le rispettive percentuali, ore e temperatura di",
        "lievitazione (a temperatura ambiente e/o in frigorifero) e tipo di lievito.",
        "",
        "Il lievito viene stimato con un modello tempo/temperatura: percentuale di",
        "lievito fresco = 3,6 / ore equivalenti a 20 °C, con attività che raddoppia",
        "ogni 10 °C. Se conosci già la percentuale di lievito, puoi forzarla con",
        "yeast_percent. Le percentuali di farina, acqua, sale e lievito sono tutte",
        "sul peso della farina (farina totale = 100%).",
      ].join("\n"),
      inputSchema: {
        balls: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .describe("Numero di panetti da preparare."),
        ball_weight_g: z
          .number()
          .positive()
          .max(3000)
          .describe("Peso di ciascun panetto in grammi (es. 250)."),
        hydration_percent: z
          .number()
          .min(30)
          .max(120)
          .optional()
          .describe(
            "Idratazione desiderata in percentuale sul peso della farina (default 62). Es. 62 per il 62%.",
          ),
        salt_percent: z
          .number()
          .min(0)
          .max(10)
          .optional()
          .describe(
            "Sale in percentuale sul peso della farina (default 2,5). Il valore tipico è 2-3%.",
          ),
        flours: floursSchema
          .optional()
          .describe(
            "Una o più farine con la percentuale sul totale della farina. Default: un'unica farina al 100%.",
          ),
        yeast_type: z
          .enum(YEAST_TYPES)
          .optional()
          .describe(
            "Tipo di lievito: fresh = fresco (default), dry = secco attivo, instant = istantaneo.",
          ),
        yeast_percent: z
          .number()
          .min(0)
          .max(10)
          .optional()
          .describe(
            "Opzionale: forza la percentuale di lievito (del tipo scelto) sul peso della farina, ignorando il modello tempo/temperatura.",
          ),
        room_hours: z
          .number()
          .min(0)
          .max(240)
          .optional()
          .describe(
            "Ore di lievitazione a temperatura ambiente (default 24; usa 0 se fai tutto in frigo). Per l'appretto dopo il frigo usa 1-2 ore.",
          ),
        room_temperature_c: z
          .number()
          .min(-5)
          .max(45)
          .optional()
          .describe("Temperatura ambiente in °C (default 20)."),
        fridge_hours: z
          .number()
          .min(0)
          .max(360)
          .optional()
          .describe(
            "Ore di lievitazione in frigorifero (default 0, cioè nessun frigo). Se usi il frigo, aggiungi 1-2 ore a temperatura ambiente per l'appretto.",
          ),
        fridge_temperature_c: z
          .number()
          .min(-5)
          .max(15)
          .optional()
          .describe("Temperatura del frigorifero in °C (default 4)."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const input: DoughInput = {
          balls: args.balls,
          ballWeightGrams: args.ball_weight_g,
          hydrationPercent: args.hydration_percent,
          saltPercent: args.salt_percent,
          flours: args.flours,
          yeastType: args.yeast_type as YeastType | undefined,
          yeastPercent: args.yeast_percent,
          roomHours: args.room_hours,
          roomTemperatureC: args.room_temperature_c,
          fridgeHours: args.fridge_hours,
          fridgeTemperatureC: args.fridge_temperature_c,
        };

        const result = calculateDough(input);

        return {
          content: [
            {
              type: "text" as const,
              text: formatResult(result),
            },
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: { ...result } as Record<string, unknown>,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Impossibile calcolare l'impasto: ${message}`,
            },
          ],
        };
      }
    },
  );

  return server;
}
