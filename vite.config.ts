import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const OPENROUTER_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_OPENROUTER_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';
const MAX_CHAT_BODY_BYTES = 2 * 1024 * 1024;
const ALLOWED_CHAT_FIELDS = [
  'stream',
  'max_tokens',
  'reasoning',
  'reasoning_effort',
  'seed',
  'temperature',
  'tool_choice',
  'tools',
  'top_p',
] as const;

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Uint8Array) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_CHAT_BODY_BYTES) {
        reject(new Error('Request payload exceeds 2 MB limit.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        reject(new Error('Invalid JSON request body.'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

function openrouterApiPlugin(mode: string): Plugin {
  const resolveServerKey = () => {
    const env = loadEnv(mode, process.cwd(), '');
    return (env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '').trim();
  };

  const attachRoutes = (middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }) => {
    middlewares.use(async (req, res, next) => {
      const reqUrl = req.url?.split('?')[0] || '';

      if (reqUrl === '/api/ai/status' && req.method === 'GET') {
        const serverKey = resolveServerKey();
        sendJson(res, 200, {
          configured: Boolean(serverKey),
          model: DEFAULT_OPENROUTER_MODEL,
          provider: 'openrouter',
          keySource: serverKey ? 'server_env' : 'none',
        });
        return;
      }

      if (reqUrl !== '/api/chat' || req.method !== 'POST') {
        next();
        return;
      }

      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(res, 400, {
          error: {
            code: 400,
            message: err instanceof Error ? err.message : 'Malformed JSON request body.',
          },
        });
        return;
      }

      const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
      const bearerKey = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
      const bodyKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      const apiKey = bearerKey || bodyKey || resolveServerKey();

      if (!apiKey) {
        sendJson(res, 401, {
          error: {
            code: 401,
            message:
              'Missing OPENROUTER_API_KEY. Add OPENROUTER_API_KEY to .env.local or configure your OpenRouter key in Luna API settings.',
          },
        });
        return;
      }

      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        sendJson(res, 400, {
          error: {
            code: 400,
            message: 'Request field "messages" must be a non-empty array.',
          },
        });
        return;
      }

      const payload: Record<string, unknown> = {
        model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : DEFAULT_OPENROUTER_MODEL,
        messages: body.messages,
      };
      for (const field of ALLOWED_CHAT_FIELDS) {
        if (body[field] !== undefined) {
          payload[field] = body[field];
        }
      }

      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });

      const origin = typeof req.headers.origin === 'string' && req.headers.origin ? req.headers.origin : 'http://localhost:3000';

      try {
        const upstream = await fetch(OPENROUTER_COMPLETIONS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': origin,
            'X-Title': 'Luna Shift',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!upstream.ok) {
          const text = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
          res.end(
            text ||
              JSON.stringify({
                error: {
                  code: upstream.status,
                  message: `OpenRouter returned HTTP ${upstream.status}`,
                },
              })
          );
          return;
        }

        const isStream = Boolean(payload.stream) && (upstream.headers.get('content-type') || '').includes('text/event-stream');
        if (isStream && upstream.body) {
          res.statusCode = upstream.status;
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');

          const reader = upstream.body.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value && value.byteLength > 0 && !res.writableEnded) {
                res.write(value);
              }
            }
          } finally {
            reader.releaseLock();
            if (!res.writableEnded) res.end();
          }
          return;
        }

        const text = await upstream.text();
        res.statusCode = upstream.status;
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
        res.end(text);
      } catch (err: unknown) {
        if (controller.signal.aborted || res.writableEnded) return;
        sendJson(res, 502, {
          error: {
            code: 502,
            message: err instanceof Error ? `OpenRouter upstream connection error: ${err.message}` : 'OpenRouter upstream error.',
          },
        });
      }
    });
  };

  return {
    name: 'luna-openrouter-proxy',
    configureServer(server) {
      attachRoutes(server.middlewares);
    },
    configurePreviewServer(server) {
      attachRoutes(server.middlewares);
    },
  };
}

export default defineConfig(({ mode }) => {
  return {
    base: '/LunaShift/',
    plugins: [react(), tailwindcss(), openrouterApiPlugin(mode)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
