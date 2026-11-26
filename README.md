# MigaLabs API Libraries

Utilities and libraries for working with the MigaLabs API — data about the Ethereum blockchain.

- Docs: [docs.migalabs.io](https://docs.migalabs.io)
- Website: [migalabs.io](https://www.migalabs.io)

---

## MCP Server — Ask your AI agent about Ethereum

The `mcp/` folder contains an MCP (Model Context Protocol) server. Think of it as a plug-in that lets your AI assistant (Claude Code, OpenCode, etc.) read live Ethereum data from MigaLabs.

### 1. Get an API key

The MigaLabs API needs an API key. Create an account at [migalabs.io](https://www.migalabs.io) to get one.

**Never paste your key into a chat.** Put it in your MCP client configuration as an `X-Api-Key` header instead. The hosted MCP server reads that header on each request and forwards it to the MigaLabs API as-is. Replace `YOUR_API_KEY` in the config below with your key.

### 2. Add the server to your agent

Connect your agent to the hosted MCP server at:

```
https://mcp.migalabs.io/mcp
```

Choose your agent below to see the exact configuration.

<details>
<summary>OpenCode</summary>

Add this to your `opencode.json` (or `opencode.jsonc`), replacing `YOUR_API_KEY` with your key:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "migalabs": {
        "type": "remote",
        "url": "https://mcp.migalabs.io/mcp",
        "oauth": false,
        "headers": {
          "X-Api-Key": "YOUR_API_KEY",
        },
      },
    },
  },
}
```

`oauth: false` is required so OpenCode uses the header credential instead of trying an OAuth flow.

Or use the CLI:

```bash
opencode mcp add migalabs --url https://mcp.migalabs.io/mcp --header 'X-Api-Key=YOUR_API_KEY'
```

</details>

<details>
<summary>Claude Code</summary>

Add this to your `.mcp.json` file, replacing `YOUR_API_KEY` with your key:

```json
{
  "mcpServers": {
    "migalabs": {
      "type": "http",
      "url": "https://mcp.migalabs.io/mcp",
      "headers": {
        "X-Api-Key": "YOUR_API_KEY"
      }
    }
  }
}
```

Or use the CLI:

```bash
claude mcp add --transport http migalabs https://mcp.migalabs.io/mcp --header 'X-Api-Key: YOUR_API_KEY'
```

</details>

<details>
<summary>Cursor</summary>

Add this to your `.cursor/mcp.json` (project-level) or `~/.cursor/mcp.json` (global), replacing `YOUR_API_KEY` with your key:

```json
{
  "mcpServers": {
    "migalabs": {
      "url": "https://mcp.migalabs.io/mcp",
      "headers": {
        "X-Api-Key": "YOUR_API_KEY"
      }
    }
  }
}
```

</details>

<details>
<summary>Antigravity</summary>

Add the MCP server in Antigravity settings pointing to:

```
https://mcp.migalabs.io/mcp
```

and set its `X-Api-Key` header to your API key.

</details>

Once connected, your agent can call tools like "get the latest Ethereum block". Your key is read from the MCP client config and applied by the server — it is never passed through the agent or the chat.

### What data can I get?

- Latest block, blocks by number, paginated block lists
- Validator details, activation and consolidation queues
- Staking entities and rewards
- Block builders and relays
- Blob / data-availability stats
  and more. See the full API reference at [docs.migalabs.io](https://docs.migalabs.io).
  All tools default to Ethereum `mainnet` however `hoodi` and `sepolia` testnets are also supported.

---
