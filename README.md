# MigaLabs API Libraries

Utilities and libraries for working with the MigaLabs API — data about the Ethereum blockchain.

- Docs: [docs.migalabs.io](https://docs.migalabs.io)
- Website: [migalabs.io](https://www.migalabs.io)

---

## MCP Server — Ask your AI agent about Ethereum

The `mcp/` folder contains an MCP (Model Context Protocol) server. Think of it as a plug-in that lets your AI assistant (Claude Code, OpenCode, etc.) read live Ethereum data from MigaLabs.

The recommended way to run it is **locally over stdio**. The MCP client starts the server for you and passes your key through its config. A hosted HTTP server is also available if you don't want to run anything locally.

### 1. Get an API key

The MigaLabs API needs an API key. Create an account at [migalabs.io](https://www.migalabs.io) to get one.

**Never paste your key into a chat.** Keep it in your MCP client configuration instead. Replace `YOUR_API_KEY` in the configs below with your key.

### 2. Run locally with stdio (recommended)

Your MCP client launches the server directly from npm — no checkout, build or HTTP server needed, and no header to configure. Run it with `npx -y @migalabs/mcp` and replace `YOUR_API_KEY` with your key.

<details>
<summary>OpenCode</summary>

Add this to your `opencode.json` (or `opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "migalabs": {
        "type": "local",
        "command": ["npx", "-y", "@migalabs/mcp"],
        "environment": {
          "MCP_TRANSPORT": "stdio",
          "MIGALABS_API_KEY": "YOUR_API_KEY",
        },
      },
    },
  },
}
```

Or use the CLI:

```bash
opencode mcp add migalabs --env MCP_TRANSPORT=stdio --env MIGALABS_API_KEY=YOUR_API_KEY -- npx -y @migalabs/mcp
```

</details>

<details>
<summary>Claude Code</summary>

Add this to your `.mcp.json` file:

```json
{
  "mcpServers": {
    "migalabs": {
      "command": "npx",
      "args": ["-y", "@migalabs/mcp"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "MIGALABS_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

Or use the CLI:

```bash
claude mcp add --env MCP_TRANSPORT=stdio --env MIGALABS_API_KEY=YOUR_API_KEY --transport stdio migalabs -- npx -y @migalabs/mcp
```

</details>

<details>
<summary>Cursor</summary>

Add this to your `.cursor/mcp.json` (project-level) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "migalabs": {
      "command": "npx",
      "args": ["-y", "@migalabs/mcp"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "MIGALABS_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

</details>

The key is read from `MIGALABS_API_KEY` at runtime and forwarded to the MigaLabs API; it is never passed as a tool argument or through the chat.

### 3. Connect to the hosted server (optional)

Alternatively, connect your agent to the hosted MCP server at:

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

Once connected, your agent can call tools like "get the latest Ethereum block".

### What data can I get?

- Latest block, blocks by number, paginated block lists
- Validator details, activation and consolidation queues
- Staking entities and rewards
- Block builders and relays
- Blob data-availability stats
  and more. See the full API reference at [docs.migalabs.io](https://docs.migalabs.io).
  All tools default to Ethereum `mainnet` however `hoodi` and `sepolia` testnets are also supported.

---
