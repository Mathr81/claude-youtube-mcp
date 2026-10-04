import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { YouTubeClient } from './youtube-client.js';
import { createServer } from './server.js';

const MAX_BODY_BYTES = 1024 * 1024;

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendJsonRpcError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { jsonrpc: '2.0', error: { code: -32000, message }, id: null });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error('Request body too large');
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

/**
 * Resolves whether the request targets the MCP endpoint and is authorized.
 * The token can be given either as a path segment (/mcp/<token>), which is
 * what claude.ai custom connectors can use, or as an `Authorization: Bearer`
 * header for clients that support custom headers (e.g. Claude Code).
 */
function checkMcpRoute(
  req: IncomingMessage,
  pathname: string,
  authToken: string | undefined
): 'not-found' | 'unauthorized' | 'ok' {
  let pathToken: string | undefined;
  if (pathname === '/mcp') {
    pathToken = undefined;
  } else if (pathname.startsWith('/mcp/') && pathname.indexOf('/', 5) === -1) {
    pathToken = decodeURIComponent(pathname.slice(5));
  } else {
    return 'not-found';
  }

  if (!authToken) {
    return 'ok';
  }

  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
  if ((pathToken && safeEqual(pathToken, authToken)) || (bearer && safeEqual(bearer, authToken))) {
    return 'ok';
  }
  return 'unauthorized';
}

export async function startHttp(client: YouTubeClient): Promise<void> {
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';
  const authToken = process.env.MCP_AUTH_TOKEN || undefined;

  if (!authToken) {
    console.error(
      'WARNING: MCP_AUTH_TOKEN is not set — the MCP endpoint is publicly accessible ' +
        'and anyone can use your YouTube API quota.'
    );
  }

  const httpServer = createHttpServer(async (req, res) => {
    const { pathname } = new URL(req.url || '/', 'http://localhost');

    if (pathname === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    const route = checkMcpRoute(req, pathname, authToken);
    if (route === 'not-found') {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    if (route === 'unauthorized') {
      sendJsonRpcError(res, 401, 'Unauthorized');
      return;
    }

    // Stateless mode: each POST gets its own server + transport, so there is
    // no session state to keep and the container can be restarted freely.
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJsonRpcError(res, 405, 'Method not allowed');
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error: any) {
      sendJson(res, 400, {
        jsonrpc: '2.0',
        error: { code: -32700, message: `Parse error: ${error.message}` },
        id: null
      });
      return;
    }

    const server = createServer(client);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error: any) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, 'Internal server error');
      }
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  console.error(`YouTube MCP Server v1.0.0 running (HTTP) on http://${host}:${port}/mcp`);

  const shutdown = () => {
    console.error('Shutting down YouTube MCP Server...');
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
