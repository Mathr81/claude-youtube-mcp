import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { YouTubeClient } from './youtube-client.js';
import { createServer } from './server.js';

export async function startStdio(client: YouTubeClient): Promise<void> {
  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('YouTube MCP Server v1.0.0 running (stdio)');

  const shutdown = async () => {
    console.error('Shutting down YouTube MCP Server...');
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
