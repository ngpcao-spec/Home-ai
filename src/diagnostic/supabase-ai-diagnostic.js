import { getSupabaseBrowserClient } from '../supabase/client.js';
import { adaptAiDiagnostic } from './diagnostic-contract.js';
import { createMockDiagnostic } from './mock-diagnostic.js';

const fallbackCodes = new Set(['AI_TIMEOUT', 'AI_RATE_LIMIT', 'AI_UNAVAILABLE', 'AI_INVALID_RESPONSE', 'FUNCTION_NETWORK_ERROR']);

export class AiDiagnosticError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'AiDiagnosticError';
    this.code = code;
  }
}

const errorStatus = error => Number(error?.context?.status ?? error?.status ?? 0);

function normalizeInvokeError(error) {
  const status = errorStatus(error);
  const code = error?.context?.body?.error?.code ?? error?.code;
  if (status === 401 || status === 403 || code === 'AUTH_REQUIRED') {
    return new AiDiagnosticError('AUTH_REQUIRED', 'Supabase authentication is required', { cause: error });
  }
  if (status === 429 || code === 'AI_RATE_LIMIT') return new AiDiagnosticError('AI_RATE_LIMIT', 'AI rate limit exceeded', { cause: error });
  if (status >= 500 || code === 'AI_UNAVAILABLE') return new AiDiagnosticError('AI_UNAVAILABLE', 'AI service unavailable', { cause: error });
  if (!status) return new AiDiagnosticError('FUNCTION_NETWORK_ERROR', 'AI function network failure', { cause: error });
  return new AiDiagnosticError(code ?? 'AI_REQUEST_REJECTED', 'AI diagnostic request rejected', { cause: error });
}

export function createSupabaseAiDiagnostic({
  client = getSupabaseBrowserClient(),
  fallback = createMockDiagnostic({ delay: 0 }),
  timeoutMs = 12000,
  getVerifiedUserId = () => null,
} = {}) {
  const runFallback = async (request, reason) => Object.freeze({
    ...await fallback.analyse(request), source: 'fallback', fallbackReason: reason,
  });

  return Object.freeze({
    async analyse({ description, preferredCategory }) {
      const cleanDescription = String(description ?? '').trim();
      if (!cleanDescription || cleanDescription.length > 2000) {
        throw new AiDiagnosticError('INVALID_INPUT', 'Diagnostic description is invalid');
      }
      if (!client || !getVerifiedUserId()) {
        throw new AiDiagnosticError('AUTH_REQUIRED', 'Supabase authentication is required');
      }
      const controller = newAbortController();
      const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const { data, error } = await client.functions.invoke('diagnose-home-request', {
          body: { description: cleanDescription, preferredCategory: preferredCategory ?? null },
          signal: controller.signal,
        });
        if (error) throw normalizeInvokeError(error);
        try { return adaptAiDiagnostic(data); }
        catch (error) { throw new AiDiagnosticError('AI_INVALID_RESPONSE', 'AI returned an invalid diagnostic', { cause: error }); }
      } catch (error) {
        const normalized = error?.name === 'AbortError'
          ? new AiDiagnosticError('AI_TIMEOUT', 'AI diagnostic timed out', { cause: error })
          : error instanceof AiDiagnosticError ? error : normalizeInvokeError(error);
        if (fallbackCodes.has(normalized.code)) return runFallback({ description: cleanDescription, preferredCategory }, normalized.code);
        throw normalized;
      } finally {
        globalThis.clearTimeout(timer);
      }
    },
  });
}

function newAbortController() {
  if (typeof globalThis.AbortController !== 'function') throw new AiDiagnosticError('AI_UNAVAILABLE', 'AbortController unavailable');
  return new globalThis.AbortController();
}
