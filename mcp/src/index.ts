#!/usr/bin/env node
/**
 * src/index.ts
 *
 * Custom MCP server entry point (NOT generated).
 *
 * We own this file, so we control the types. Tool definitions come from
 * scripts/generate-tools.mjs (via src/tools.ts), which uses
 * openapi-mcp-generator's programmatic API. Because we use the MCP SDK v2
 * McpServer class with an explicitly typed setup function, TypeScript never
 * needs to infer a return type referencing Hono's internal BlankSchema —
 * no TS2883, no patching, no sed.
 *
 * Supports two transports via the MCP_TRANSPORT env var:
 *   streamable-http (default) — HTTP server on PORT (default 3000)
 *   stdio                   — stdio transport for local MCP clients
 *
 * Authentication is per user, not per server: the MCP client sends the
 * user's MigaLabs API key once in its config as an `X-Api-Key` header. We
 * read it from the inbound request and forward it to the upstream API. The
 * agent never sees the key and there is no apiKey tool argument to paste
 * it into.
 *
 * This file is copied into the ./mcp directory by the release workflow
 * before building.
 */

import {
  McpServer,
  fromJsonSchema,
  createMcpHandler,
} from "@modelcontextprotocol/server";
import type { McpRequestContext } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { TOOLS, BASE_URL, SERVER_INSTRUCTIONS } from "./tools.js";

export const SERVER_NAME = "migalabs";
export const SERVER_VERSION = process.env.npm_package_version ?? "0.1";

const API_BASE_URL = process.env.API_BASE_URL || BASE_URL || "";
console.error("API_BASE_URL is set to:", API_BASE_URL);

/**
 * Read the caller's MigaLabs API key from an inbound MCP request.
 *
 * Hosted usage: the user puts their own key in their MCP client config once,
 * e.g. `X-Api-Key: <their-api-key>`. It is sent on every MCP request, so the
 * agent never needs to know it and never has to ask the user to paste it
 * into the chat.
 *
 * The key is only ever used to build the upstream request header. It is
 * never logged, returned to the client, or exposed as a tool argument.
 */
function extractApiKey(request?: Request): string | undefined {
  if (!request) return undefined;
  return request.headers.get("x-api-key")?.trim() || undefined;
}

// ---------------------------------------------------------------------------
// MCP server factory — creates a fresh server per request/connection
// ---------------------------------------------------------------------------
function createServer(ctx?: McpRequestContext): McpServer {
  // Per-request credential from the MCP client's headers. `requestInfo` is
  // present for HTTP requests; stdio callers fall back to the env var below.
  const inboundApiKey = extractApiKey(ctx?.requestInfo);

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema),
        annotations: tool.annotations as {
          readOnlyHint?: boolean;
          destructiveHint?: boolean;
          idempotentHint?: boolean;
          openWorldHint?: boolean;
        },
      },
      async (args: unknown) => {
        const toolArgs = (args ?? {}) as Record<string, unknown>;

        // Build the upstream request URL from the tool's path template and params
        // Resolve pathTemplate against API_BASE_URL. Strip the leading '/' so it
        // appends to the base path rather than replacing it:
        //   https://www.migalabs.io/api + /eth/v1/... → https://www.migalabs.io/api/eth/v1/...
        let pathWithParams = tool.pathTemplate.replace(/^\//, "");
        for (const param of tool.executionParameters) {
          if (param.in === "path" && toolArgs[param.name] !== undefined) {
            pathWithParams = pathWithParams.replace(
              `{${param.name}}`,
              encodeURIComponent(String(toolArgs[param.name])),
            );
          }
        }
        const url = new URL(
          pathWithParams,
          API_BASE_URL.endsWith("/") ? API_BASE_URL : API_BASE_URL + "/",
        );

        // Query parameters
        for (const param of tool.executionParameters) {
          if (param.in === "query" && toolArgs[param.name] !== undefined) {
            url.searchParams.set(param.name, String(toolArgs[param.name]));
          }
        }

        // Build headers
        const headers: Record<string, string> = {};
        if (tool.requestBodyContentType)
          headers["Content-Type"] = tool.requestBodyContentType;

        // API key auth: use the caller's key from the MCP client's headers.
        // It is read from the inbound request at call time, so it is never
        // embedded in built code and never appears in tool arguments.
        // The env var fallback is only for local/stdio self-hosting, where
        // there is no inbound HTTP request.
        let apiKey = inboundApiKey;
        if (!apiKey) {
          for (const req of tool.securityRequirements) {
            for (const schemeName of Object.keys(req)) {
              const envToken = process.env[`API_KEY_${schemeName}`];
              if (envToken) {
                apiKey = envToken;
                break;
              }
            }
            if (apiKey) break;
          }
        }
        if (!apiKey) {
          throw new Error(
            JSON.stringify({
              error: true,
              title: "Missing API key",
              detail:
                "Set X-Api-Key: <your MigaLabs API key> in your MCP client config.",
            }),
          );
        }
        headers["X-Api-Key"] = apiKey;

        const response = await fetch(url.toString(), {
          method: tool.method.toUpperCase(),
          headers,
        });

        // Parse structured error response from the API so the agent can
        // read error messages without inspecting raw HTML/JSON.
        if (!response.ok) {
          const body = await response.text();
          let errorDetail = body;
          let errorTitle = "Upstream API error";
          let errorStatus = response.status;
          try {
            const parsed = JSON.parse(body);
            if (parsed.detail) errorDetail = parsed.detail;
            if (parsed.title) errorTitle = parsed.title;
            if (parsed.status) errorStatus = parsed.status;
            if (parsed.type) errorTitle = `${parsed.type}: ${parsed.title}`;
          } catch {
            // Not JSON, use raw body as detail
          }
          throw new Error(
            JSON.stringify({
              error: true,
              status: errorStatus,
              title: errorTitle,
              detail: errorDetail,
            }),
          );
        }

        const body = await response.text();
        return {
          content: [{ type: "text", text: body }],
        };
      },
    );
  }

  return server;
}

/** Hono context variables set by middleware. */
type AppEnv = { Variables: { inboundPrincipal?: string } };

/**
 * DNS-rebinding protection: rejects browser requests from origins that are not
 * loopback and not listed in MCP_ALLOWED_ORIGINS.
 */
function createOriginGuard() {
  const allowed = new Set(
    (process.env.MCP_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  );
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  return async (
    c: {
      req: { header: (name: string) => string | undefined };
      json: (body: unknown, status?: number) => unknown;
    },
    next: () => Promise<unknown>,
  ) => {
    const origin = c.req.header("origin");
    if (origin !== undefined) {
      let host = "";
      try {
        host = new URL(origin).hostname;
      } catch {
        // "null" and malformed origins fall through to the rejection below.
      }
      if (
        !loopbackHosts.has(host) &&
        !allowed.has(origin.replace(/\/+$/, ""))
      ) {
        return c.json(
          {
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message:
                "Forbidden: origin not allowed (set MCP_ALLOWED_ORIGINS).",
            },
            id: null,
          },
          403,
        );
      }
    }
    await next();
  };
}

/**
 * Sets up a web server for the MCP server using StreamableHTTP transport.
 *
 * Explicit return type `Promise<Hono<AppEnv>>` avoids TS2883 (an inferred
 * return type would reference Hono's internal BlankSchema).
 */
export async function setupStreamableHttpServer(
  port = 3000,
): Promise<Hono<AppEnv>> {
  const app = new Hono<AppEnv>();

  app.use(
    "*",
    cors({
      exposeHeaders: ["mcp-protocol-version"],
      // Required so browser-based MCP clients can send the user's key and
      // the protocol headers on cross-origin requests.
      allowHeaders: [
        "Content-Type",
        "X-Api-Key",
        "MCP-Protocol-Version",
        "Mcp-Session-Id",
        "Last-Event-ID",
      ],
    }),
  );

  const originGuard = createOriginGuard();
  app.use("/mcp", originGuard);

  // Every /mcp request must carry the caller's own API key, configured once
  // in their MCP client as an `X-Api-Key` header. The agent never sees it.
  // We only check that a credential is present here; validity is decided by
  // the upstream MigaLabs API when the tool actually runs.
  app.use("/mcp", async (c, next) => {
    if (!extractApiKey(c.req.raw)) {
      return c.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message:
              "Unauthorized: set X-Api-Key: <your MigaLabs API key> in your MCP client config.",
          },
          id: null,
        },
        401,
      );
    }
    await next();
  });

  // createMcpHandler creates a fresh server instance per HTTP request
  // (stateless StreamableHTTP). The same factory backs both modern and
  // legacy protocol eras. Pass the SDK's per-request context through so
  // tools can read the caller's key from the inbound headers.
  const mcpHandler = createMcpHandler((ctx) => createServer(ctx), {
    onerror: (error) => console.error("MCP request error:", error),
  });

  app.get("/health", (c) => {
    return c.json({
      status: "OK",
      server: SERVER_NAME,
      version: SERVER_VERSION,
    });
  });

  // MCP endpoint — every request gets a fresh server instance.
  app.all("/mcp", async (c) => mcpHandler.fetch(c.req.raw));

  const host = process.env.MCP_HOST ?? "127.0.0.1";
  serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    console.error(
      `MCP StreamableHTTP Server running at http://${host}:${info.port}`,
    );
    console.error(`- MCP Endpoint: http://${host}:${info.port}/mcp`);
    console.error(`- Health Check: http://${host}:${info.port}/health`);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------
async function main() {
  const transport = process.env.MCP_TRANSPORT ?? "streamable-http";

  if (transport === "stdio") {
    console.error("[api-libraries-mcp] starting stdio server…");
    await serveStdio(createServer);
    return;
  }

  // Default: streamable-http
  const port = Number(process.env.PORT ?? 3000);
  await setupStreamableHttpServer(port);
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
