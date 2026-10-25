import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const MCP_PATH = "/mcp";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": [
    "Content-Type",
    "Accept",
    "Authorization",
    "MCP-Protocol-Version",
    "mcp-session-id",
    "Last-Event-ID",
  ].join(", "),
  "Access-Control-Expose-Headers": "mcp-session-id, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(body: unknown, init?: ResponseInit): Response {
  return withCors(Response.json(body, init));
}

/**
 * Cloudflare Worker entry point.
 *
 * Espone un endpoint MCP Streamable HTTP stateless su /mcp: viene creato un
 * nuovo server e un nuovo trasporto per ogni richiesta, senza Durable Objects.
 * Il tool è puro e non ha stato, quindi la modalità stateless è sufficiente.
 */
async function handleMcp(request: Request): Promise<Response> {
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Nessun sessionIdGenerator: modalità stateless.
    enableJsonResponse: true,
  });

  transport.onerror = (error) => {
    console.error("Errore trasporto MCP:", error);
  };

  try {
    await server.connect(transport);
    return withCors(await transport.handleRequest(request));
  } catch (error) {
    console.error("Errore gestione richiesta MCP:", error);
    return json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Errore interno del server MCP.",
        },
        id: null,
      },
      { status: 500 },
    );
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        name: SERVER_NAME,
        version: SERVER_VERSION,
        status: "ok",
        description:
          "Calcolatore di dosi per impasto pizza. Endpoint MCP: /mcp (Streamable HTTP, stateless).",
        endpoint: MCP_PATH,
      });
    }

    if (url.pathname === MCP_PATH) {
      return handleMcp(request);
    }

    return json({ error: "Not found" }, { status: 404 });
  },
};
