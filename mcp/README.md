# @migalabs/mcp

MCP (Model Context Protocol) server for the MigaLabs Ethereum API. It lets an AI agent query blocks, validators, staking entities, blobs, rewards and more.

**Full documentation:** [https://docs.migalabs.io/mcp](https://docs.migalabs.io/mcp)

Requires Node.js 22 or newer. You need a MigaLabs API key from [migalabs.io](https://www.migalabs.io).

## Local stdio server (recommended)

Run directly with `npx` — no checkout needed:

```jsonc
{
  "mcp": {
    "servers": {
      "migalabs": {
        "type": "local",
        "command": ["npx", "-y", "@migalabs/mcp"],
        "environment": {
          "MCP_TRANSPORT": "stdio",
          "MIGALABS_API_KEY": "YOUR_API_KEY"
        }
      }
    }
  }
}
```

The key is passed through your MCP client config, never through the chat.

## Hosted server

Connect to `https://mcp.migalabs.io/mcp` and set the `X-Api-Key` header to your key in the MCP client config. See the [full docs](https://docs.migalabs.io/mcp) for per-agent examples.

## License

MIT
