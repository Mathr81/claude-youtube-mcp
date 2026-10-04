#!/usr/bin/env node

import { loadConfig } from './config.js';
import { createYouTubeClient } from './youtube-client.js';
import { startStdio } from './stdio.js';
import { startHttp } from './http.js';

async function main() {
  try {
    const config = loadConfig();
    const client = createYouTubeClient(config);

    const transport = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();
    if (transport === 'http') {
      await startHttp(client);
    } else if (transport === 'stdio') {
      await startStdio(client);
    } else {
      throw new Error(`Unknown MCP_TRANSPORT "${transport}". Use "stdio" or "http".`);
    }
  } catch (error: any) {
    console.error('Failed to start YouTube MCP Server:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
