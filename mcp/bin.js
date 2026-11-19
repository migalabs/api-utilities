#!/usr/bin/env node
// npm `bin` entry point. Importing build/index.js runs main() which starts
// the MCP server (stdio or streamable-http based on MCP_TRANSPORT env).
import('./build/index.js');
