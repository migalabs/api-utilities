# MigaLabs API Libraries

Utilities and libraries for working with the MigaLabs API — data about the Ethereum blockchain.

- Docs: [docs.migalabs.io](https://docs.migalabs.io)
- Website: [migalabs.io](https://www.migalabs.io)

---

## MCP Server — Ask your AI agent about Ethereum

The `mcp/` folder contains an MCP (Model Context Protocol) server. Think of it as a plug-in that lets your AI assistant (Claude Code, OpenCode, etc.) read live Ethereum data from MigaLabs.

### 1. Get an API key

The MigaLabs API needs an API key. You get one by creating an account at [migalabs.io](https://www.migalabs.io) and give it to your agent. The key is used to authenticate requests to the MigaLabs API on your behalf.

### 2. Add the server to your agent

Connect your agent to the hosted MCP server at:

```
https://mcp.migalabs.io/mcp
```

Choose your agent below to see the exact configuration.

<details>
<summary>OpenCode</summary>

Add this to your `opencode.json` (or `opencode.jsonc`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "migalabs": {
        "type": "remote",
        "url": "https://mcp.migalabs.io/mcp"
      }
    }
  }
}
```

Or use the CLI:

```bash
opencode mcp add migalabs --url https://mcp.migalabs.io/mcp
```

</details>

<details>
<summary>Claude Code</summary>

Add this to your `.mcp.json` file:

```json
{
  "mcpServers": {
    "migalabs": {
      "type": "http",
      "url": "https://mcp.migalabs.io/mcp"
    }
  }
}
```

Or use the CLI:

```bash
claude mcp add-json migalabs '{"type":"http","url":"https://mcp.migalabs.io/mcp"}'
```

</details>

<details>
<summary>Cursor</summary>

Add this to your `.cursor/mcp.json` (project-level) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "migalabs": {
      "url": "https://mcp.migalabs.io/mcp"
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

</details>

Once connected, your agent can call tools like "get the latest Ethereum block" using your API key automatically.

### What data can I get?

- Latest block, blocks by number, paginated block lists
- Validator details, activation and consolidation queues
- Staking entities and rewards
- Block builders and relays
- Blob / data-availability stats
  and more. See the full API reference at [docs.migalabs.io](https://docs.migalabs.io).
  All tools default to Ethereum `mainnet` however `hoodi` and `sepolia` testnets are also supported.

---
