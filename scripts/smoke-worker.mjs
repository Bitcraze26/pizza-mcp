/**
 * Test end-to-end del server MCP su Cloudflare Workers (o in locale con wrangler dev).
 *
 * Uso:
 *   npm run dev:worker          # in un terminale
 *   npm run smoke:worker        # in un altro
 *
 * Variabile opzionale MCP_URL (default http://localhost:8788/mcp).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MCP_URL ?? "http://localhost:8788/mcp");

const transport = new StreamableHTTPClientTransport(url);
const client = new Client({
  name: "pizza-mcp-worker-smoke-test",
  version: "1.0.0",
});

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log("Endpoint:", url.toString());
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
