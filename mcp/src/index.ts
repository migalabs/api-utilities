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
 * This file is copied into the ./mcp directory by the release workflow
 * before building.
 */

import { McpServer, fromJsonSchema, createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { TOOLS, BASE_URL } from './tools.js';

export const SERVER_NAME = "migalabs";
export const SERVER_VERSION = process.env.npm_package_version ?? "0.1";

const API_BASE_URL = BASE_URL || process.env.API_BASE_URL || "";
console.error("API_BASE_URL is set to:", API_BASE_URL);

// ---------------------------------------------------------------------------
// MCP server factory — creates a fresh server per request/connection
// ---------------------------------------------------------------------------
function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  for (const tool of TOOLS) {
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: fromJsonSchema(tool.inputSchema),
      annotations: tool.annotations as { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean },
    }, async (args: unknown) => {
      const toolArgs = args as Record<string, unknown> | undefined;

      // Support per-call apiKey parameter (overrides env var).
      // This key is stripped from args before forwarding to the upstream API,
      // so it never reaches the Migalabs API.
      const perCallApiKey = toolArgs?.apiKey as string | undefined;
      const cleanArgs = { ...toolArgs };
      delete cleanArgs.apiKey;

      // Build the upstream request URL from the tool's path template and params
      // Resolve pathTemplate against API_BASE_URL. Strip the leading '/' so it
      // appends to the base path rather than replacing it:
      //   https://www.migalabs.io/api + /eth/v1/... → https://www.migalabs.io/api/eth/v1/...
      let pathWithParams = tool.pathTemplate.replace(/^\//, '');
      for (const param of tool.executionParameters) {
        if (param.in === 'path' && cleanArgs?.[param.name] !== undefined) {
          pathWithParams = pathWithParams.replace(
            `{${param.name}}`,
            encodeURIComponent(String(cleanArgs[param.name]))
          );
        }
      }
      const url = new URL(pathWithParams, API_BASE_URL.endsWith('/') ? API_BASE_URL : API_BASE_URL + '/');

      // Query parameters
      for (const param of tool.executionParameters) {
        if (param.in === 'query' && cleanArgs?.[param.name] !== undefined) {
          url.searchParams.set(param.name, String(cleanArgs[param.name]));
        }
      }

      // Build headers
      const headers: Record<string, string> = {};
      if (tool.requestBodyContentType) headers['Content-Type'] = tool.requestBodyContentType;

      // API key auth: per-call parameter takes precedence over env var.
      // The key is read at request time (not build time), so it is never
      // embedded in the built code.
      let apiKey = perCallApiKey;
      if (!apiKey) {
        for (const req of tool.securityRequirements) {
          for (const schemeName of Object.keys(req)) {
            const envToken = process.env[`API_KEY_${schemeName}`];
            if (envToken) { apiKey = envToken; break; }
          }
          if (apiKey) break;
        }
      }
      if (apiKey) headers['X-Api-Key'] = apiKey;

      const response = await fetch(url.toString(), {
        method: tool.method.toUpperCase(),
        headers,
      });

      // Parse structured error response from the API so the agent can
      // read error messages without inspecting raw HTML/JSON.
      if (!response.ok) {
        const body = await response.text();
        let errorDetail = body;
        let errorTitle = 'Upstream API error';
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
          })
        );
      }

      const body = await response.text();
      return {
        content: [{ type: 'text', text: body }],
      };
    });
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
    (process.env.MCP_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  return async (c: { req: { header: (name: string) => string | undefined }; json: (body: unknown, status?: number) => unknown; }, next: () => Promise<unknown>) => {
    const origin = c.req.header('origin');
    if (origin !== undefined) {
      let host = '';
      try {
        host = new URL(origin).hostname;
      } catch {
        // "null" and malformed origins fall through to the rejection below.
      }
      if (!loopbackHosts.has(host) && !allowed.has(origin.replace(/\/+$/, ''))) {
        return c.json(
          {
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Forbidden: origin not allowed (set MCP_ALLOWED_ORIGINS).' },
            id: null,
          },
          403
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
  port = 3000
): Promise<Hono<AppEnv>> {
  const app = new Hono<AppEnv>();

  app.use('*', cors({ exposeHeaders: ['mcp-protocol-version', 'www-authenticate'] }));

  const originGuard = createOriginGuard();
  app.use('/mcp', originGuard);

  // createMcpHandler creates a fresh server instance per HTTP request
  // (stateless StreamableHTTP). The same factory backs both modern and
  // legacy protocol eras.
  const mcpHandler = createMcpHandler(
    () => createServer(),
    { onerror: (error) => console.error('MCP request error:', error) }
  );

  app.get('/health', (c) => {
    return c.json({ status: 'OK', server: SERVER_NAME, version: SERVER_VERSION });
  });

  // MCP endpoint — every request gets a fresh server instance.
  app.all('/mcp', async (c) => mcpHandler.fetch(c.req.raw));

  serve(
    { fetch: app.fetch, port },
    (info) => {
      console.error(`MCP StreamableHTTP Server running at http://localhost:${info.port}`);
      console.error(`- MCP Endpoint: http://localhost:${info.port}/mcp`);
      console.error(`- Health Check: http://localhost:${info.port}/health`);
      console.error(`- Playground: http://localhost:${info.port}/`);
    }
  );

  return app;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------
async function main() {
  const transport = process.env.MCP_TRANSPORT ?? 'streamable-http';

  if (transport === 'stdio') {
    console.error('[api-libraries-mcp] starting stdio server…');
    await serveStdio(createServer);
    return;
  }

  // Default: streamable-http
  const port = Number(process.env.PORT ?? 3000);
  await setupStreamableHttpServer(port);
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
