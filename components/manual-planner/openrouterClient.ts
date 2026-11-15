/**
 * OpenRouter API client for NVIDIA Nemotron 3 Ultra (`nvidia/nemotron-3-ultra-550b-a55b`).
 * Supports both local server proxy (`/api/chat` backed by `$OPENROUTER_API_KEY`)
 * and direct browser BYOK calls to `https://openrouter.ai/api/v1/chat/completions`.
 */

export const OPENROUTER_CHAT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const NEMOTRON_MODEL_ID = 'nvidia/nemotron-3-ultra-550b-a55b';
export const NEMOTRON_DISPLAY_NAME = 'Nemotron 3 Ultra';
export const NEMOTRON_MODEL_PAGE_URL = 'https://openrouter.ai/nvidia/nemotron-3-ultra-550b-a55b';
export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/settings/keys';

export type OpenRouterRole = 'system' | 'user' | 'assistant' | 'tool';

export interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenRouterMessage {
  role: OpenRouterRole;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenRouterToolCall[];
}

export interface OpenRouterTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

export interface ServerAiStatus {
  configured: boolean;
  model: string;
  provider: string;
  keySource: 'server_env' | 'none';
}

export interface OpenRouterDelta {
  content: string;
  reasoning: string;
}

export interface OpenRouterChatResult {
  content: string;
  reasoning: string;
  toolCalls: OpenRouterToolCall[];
  finishReason: string | null;
  usage?: OpenRouterUsage;
  model: string;
}

export interface OpenRouterChatOptions {
  messages: OpenRouterMessage[];
  model?: string;
  apiKey?: string;
  chatEndpoint?: string;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  seed?: number;
  reasoning?: Record<string, unknown>;
  reasoning_effort?: 'low' | 'medium' | 'high';
  tools?: OpenRouterTool[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  timeoutMs?: number;
  signal?: AbortSignal;
  onDelta?: (delta: OpenRouterDelta) => void;
}

const OPENROUTER_STATUS_HINT: Record<number, string> = {
  400: 'Malformed request or unsupported parameter for Nemotron 3 Ultra.',
  401: 'Missing or invalid OpenRouter API key. Set OPENROUTER_API_KEY in .env.local or add your key in API settings.',
  402: 'Insufficient OpenRouter credits for this request.',
  403: 'OpenRouter spend limit reached, key disabled, or access blocked.',
  404: 'Model or upstream provider unavailable for nvidia/nemotron-3-ultra-550b-a55b.',
  429: 'OpenRouter rate limit reached. Please retry shortly.',
  502: 'Upstream Nemotron provider failed (failed generations are not billed).',
};

export class OpenRouterApiError extends Error {
  readonly status: number;
  readonly code: number;
  readonly retryable: boolean;
  readonly isAuthError: boolean;

  constructor(status: number, code: number, message: string) {
    super(message);
    this.name = 'OpenRouterApiError';
    this.status = status;
    this.code = code;
    this.retryable = status === 429 || status === 502;
    this.isAuthError = status === 401 || status === 403;
  }
}

export function isOpenRouterModelId(modelId?: string | null): boolean {
  if (!modelId) return false;
  return modelId === NEMOTRON_MODEL_ID || modelId === 'openrouter' || modelId.startsWith('nvidia/');
}

export function readStoredByokKeys(): Record<string, string> {
  try {
    const raw = localStorage.getItem('aeon_byok_keys');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getStoredOpenRouterKey(): string {
  const keys = readStoredByokKeys();
  return (keys[NEMOTRON_MODEL_ID] || keys.openrouter || keys['nemotron-3-ultra'] || '').trim();
}

export function getActiveByokModelId(): string {
  try {
    return localStorage.getItem('aeon_active_byok_model') || NEMOTRON_MODEL_ID;
  } catch {
    return NEMOTRON_MODEL_ID;
  }
}

export async function fetchServerAiStatus(signal?: AbortSignal): Promise<ServerAiStatus> {
  try {
    const resp = await fetch('/api/ai/status', { method: 'GET', signal });
    if (!resp.ok) {
      return { configured: false, model: NEMOTRON_MODEL_ID, provider: 'openrouter', keySource: 'none' };
    }
    const data = (await resp.json()) as Partial<ServerAiStatus>;
    return {
      configured: Boolean(data.configured),
      model: data.model || NEMOTRON_MODEL_ID,
      provider: data.provider || 'openrouter',
      keySource: data.keySource === 'server_env' ? 'server_env' : 'none',
    };
  } catch {
    return { configured: false, model: NEMOTRON_MODEL_ID, provider: 'openrouter', keySource: 'none' };
  }
}

function parseOpenRouterError(status: number, rawBody: string): OpenRouterApiError {
  let code = status;
  let message = OPENROUTER_STATUS_HINT[status] || `OpenRouter HTTP ${status}`;
  try {
    const parsed = JSON.parse(rawBody);
    const errObj = parsed?.error;
    if (errObj && typeof errObj === 'object') {
      if (typeof errObj.code === 'number') code = errObj.code;
      if (typeof errObj.message === 'string' && errObj.message.trim()) {
        message = errObj.message.trim();
      }
    }
  } catch {
    if (rawBody.trim() && rawBody.trim().length < 280) {
      message = rawBody.trim();
    }
  }
  return new OpenRouterApiError(status, code, message);
}

function createCombinedSignal(timeoutMs: number, externalSignal?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timerId = globalThis.setTimeout(() => controller.abort(new Error('OpenRouter request timed out')), timeoutMs);

  const onAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      globalThis.clearTimeout(timerId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onAbort);
      }
    },
  };
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function extractReasoningText(source: any): string {
  if (!source || typeof source !== 'object') return '';
  if (typeof source.reasoning === 'string') return source.reasoning;
  if (typeof source.reasoning_content === 'string') return source.reasoning_content;
  if (Array.isArray(source.reasoning_details)) {
    return source.reasoning_details
      .map((item: any) => (typeof item?.text === 'string' ? item.text : typeof item?.summary === 'string' ? item.summary : ''))
      .join('');
  }
  return '';
}

function buildRequestBody(options: OpenRouterChatOptions, includeTools: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model || NEMOTRON_MODEL_ID,
    messages: options.messages,
  };
  if (options.stream !== undefined) body.stream = options.stream;
  if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.top_p !== undefined) body.top_p = options.top_p;
  if (options.seed !== undefined) body.seed = options.seed;
  if (options.reasoning !== undefined) body.reasoning = options.reasoning;
  if (options.reasoning_effort !== undefined) body.reasoning_effort = options.reasoning_effort;
  if (includeTools && options.tools?.length) {
    body.tools = options.tools;
    if (options.tool_choice !== undefined) body.tool_choice = options.tool_choice;
  }
  return body;
}

async function consumeSseStream(
  resp: Response,
  onDelta?: (delta: OpenRouterDelta) => void
): Promise<OpenRouterChatResult> {
  if (!resp.body) {
    throw new OpenRouterApiError(502, 502, 'Empty response stream from OpenRouter.');
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let finishReason: string | null = null;
  let usage: OpenRouterUsage | undefined;
  let model = NEMOTRON_MODEL_ID;
  const toolCallsMap = new Map<number, OpenRouterToolCall>();

  const processLine = (rawLine: string): boolean => {
    const line = rawLine.trim();
    if (!line || line.startsWith(':')) return false;
    if (!line.startsWith('data:')) return false;
    const payload = line.slice(5).trim();
    if (!payload) return false;
    if (payload === '[DONE]') return true;

    let chunk: any;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return false;
    }

    if (chunk?.error) {
      const code = typeof chunk.error.code === 'number' ? chunk.error.code : 502;
      const msg = typeof chunk.error.message === 'string' ? chunk.error.message : 'OpenRouter stream failed.';
      throw new OpenRouterApiError(code, code, msg);
    }

    if (typeof chunk?.model === 'string' && chunk.model) model = chunk.model;
    if (chunk?.usage) usage = chunk.usage as OpenRouterUsage;

    const choice = chunk?.choices?.[0];
    if (!choice) return false;

    if (typeof choice.finish_reason === 'string') {
      finishReason = choice.finish_reason;
    }

    const delta = choice.delta;
    if (!delta) return false;

    let changed = false;
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      content += delta.content;
      changed = true;
    }
    const rPiece = extractReasoningText(delta);
    if (rPiece) {
      reasoning += rPiece;
      changed = true;
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === 'number' ? tc.index : 0;
        const existing = toolCallsMap.get(idx) || {
          id: tc.id || `call_${idx}`,
          type: 'function' as const,
          function: { name: '', arguments: '' },
        };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name += tc.function.name;
        if (typeof tc.function?.arguments === 'string') existing.function.arguments += tc.function.arguments;
        toolCallsMap.set(idx, existing);
      }
    }

    if (changed) {
      onDelta?.({ content, reasoning });
    }
    return false;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (processLine(line)) {
          return {
            content: content.trim(),
            reasoning: reasoning.trim(),
            toolCalls: Array.from(toolCallsMap.entries())
              .sort((a, b) => a[0] - b[0])
              .map(([, v]) => v),
            finishReason,
            usage,
            model,
          };
        }
      }
    }
    if (buffer.trim()) {
      processLine(buffer);
    }
  } finally {
    reader.releaseLock();
  }

  return {
    content: content.trim(),
    reasoning: reasoning.trim(),
    toolCalls: Array.from(toolCallsMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v),
    finishReason,
    usage,
    model,
  };
}

/**
 * Calls NVIDIA Nemotron 3 Ultra via OpenRouter Chat Completions API.
 * Uses a browser BYOK OpenRouter key directly when present, otherwise routes through `chatEndpoint` (`/api/chat`)
 * which injects `$OPENROUTER_API_KEY` on the server.
 */
export async function callOpenRouterNemotron(options: OpenRouterChatOptions): Promise<OpenRouterChatResult> {
  const directKey = (options.apiKey ?? getStoredOpenRouterKey()).trim();
  const useDirectOpenRouter = Boolean(directKey);
  const url = useDirectOpenRouter ? OPENROUTER_CHAT_ENDPOINT : options.chatEndpoint || '/api/chat';
  const stream = options.stream ?? true;
  const timeoutMs = options.timeoutMs ?? 60000;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (useDirectOpenRouter) {
    headers.Authorization = `Bearer ${directKey}`;
    if (typeof window !== 'undefined' && window.location?.origin) {
      headers['HTTP-Referer'] = window.location.origin;
    }
    headers['X-Title'] = 'Luna Shift';
  }

  let includeTools = Boolean(options.tools?.length);
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { signal, cleanup } = createCombinedSignal(timeoutMs, options.signal);
    try {
      const payload = buildRequestBody({ ...options, stream }, includeTools);
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
      });

      if (!resp.ok) {
        const rawErr = await resp.text();
        const apiErr = parseOpenRouterError(resp.status, rawErr);

        // Retry once without tools if an upstream provider rejects tool parameters with 400
        if (apiErr.status === 400 && includeTools) {
          includeTools = false;
          lastError = apiErr;
          continue;
        }
        // Retry once with short backoff on 429 rate-limit or 502 upstream failure
        if (apiErr.retryable && attempt === 0) {
          lastError = apiErr;
          await abortableDelay(1200, options.signal);
          continue;
        }
        throw apiErr;
      }

      const contentType = resp.headers.get('content-type') || '';
      if (stream && contentType.includes('text/event-stream')) {
        return await consumeSseStream(resp, options.onDelta);
      }

      const data = await resp.json();
      if (data?.error) {
        const code = typeof data.error.code === 'number' ? data.error.code : 502;
        throw new OpenRouterApiError(code, code, data.error.message || 'OpenRouter error.');
      }

      const message = data?.choices?.[0]?.message;
      const content = typeof message?.content === 'string' ? message.content.trim() : '';
      const reasoning = extractReasoningText(message).trim();
      const toolCalls: OpenRouterToolCall[] = Array.isArray(message?.tool_calls) ? message.tool_calls : [];

      if (content || reasoning) {
        options.onDelta?.({ content, reasoning });
      }

      return {
        content,
        reasoning,
        toolCalls,
        finishReason: data?.choices?.[0]?.finish_reason || null,
        usage: data?.usage,
        model: data?.model || options.model || NEMOTRON_MODEL_ID,
      };
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || options.signal?.aborted) {
        throw err;
      }
      if (err instanceof OpenRouterApiError) {
        throw err;
      }
      lastError = err;
      if (attempt === 0) {
        await abortableDelay(800, options.signal);
        continue;
      }
    } finally {
      cleanup();
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new OpenRouterApiError(502, 502, 'Failed to connect to OpenRouter.');
}
