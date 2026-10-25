/**
 * Test end-to-end dell' MCP server: avvia dist/index.js via stdio,
 * elenca i tool e chiama calculate_dough con un caso reale.
 *
 * Uso: npm run build && npm run smoke
 */
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  stderr: "inherit",
});

const client = new Client({
  name: "calcolapizza-smoke-test",
  version: "1.0.0",
});

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(
    "Tool disponibili:",
    tools.map((tool) => tool.name).join(", "),
  );

  const result = await client.callTool({
    name: "calculate_dough",
    arguments: {
      balls: 6,
      ball_weight_g: 250,
      hydration_percent: 62,
      salt_percent: 2.5,
      flours: [
        { name: "Tipo 00 W300", percent: 70 },
        { name: "Farina integrale", percent: 30 },
      ],
      yeast_type: "fresh",
      room_hours: 2,
      room_temperature_c: 20,
      fridge_hours: 22,
      fridge_temperature_c: 4,
    },
  });

  if (result.isError) {
    console.error("La chiamata ha restituito un errore.");
    console.error(JSON.stringify(result.content, null, 2));
    process.exitCode = 1;
  } else {
    const firstText = Array.isArray(result.content)
      ? result.content.find((item) => item.type === "text")
      : undefined;
    console.log("\n--- Risposta leggibile ---\n");
    console.log(firstText?.text ?? "(nessun testo)");
    console.log("\n--- Structured content ---\n");
    console.log(JSON.stringify(result.structuredContent, null, 2));

    if (!result.structuredContent?.totalFlourGrams) {
      console.error("Structured content mancante o incompleto.");
      process.exitCode = 1;
    }
  }
} finally {
  await client.close();
}
