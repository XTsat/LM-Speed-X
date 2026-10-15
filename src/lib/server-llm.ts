/**
 * Server-proxy chat helpers — shared by the speed / stability / concurrency /
 * connectivity test routes. Mirrors the fail-based fallback in the
 * browser-direct path (lib/browser-llm.ts): build the OpenAI client at the
 * address exactly as the user filled it in, and retry ONCE at the /v1
 * alternative only when a path-type failure occurs. The alternative is
 * remembered and reported only when the retry actually succeeds.
 */
import OpenAI from 'openai'
import {
  getChatBaseUrl,
  getFallbackBaseUrl,
  isPathError,
  normalizeApiBaseUrl,
  rememberChatBaseUrl,
} from '@/lib/api-path'

export interface OpenAIProxyOptions {
  apiKey: string
  timeoutMs: number
  customHeaders?: Record<string, string>
}

/**
 * Build an OpenAI client for the effective chat base URL.
 * User input wins by default; a previously confirmed fallback (cached) is
 * reused so subsequent runs don't repeat the failed first attempt.
 */
export function makeOpenAIClient(baseUrl: string, opts: OpenAIProxyOptions): OpenAI {
  const normalized = normalizeApiBaseUrl(baseUrl)
  const baseURL = getChatBaseUrl(normalized) ?? normalized
  return new OpenAI({
    apiKey: opts.apiKey,
    baseURL,
    timeout: opts.timeoutMs,
    maxRetries: 1,
    ...(opts.customHeaders && Object.keys(opts.customHeaders).length > 0
      ? { defaultHeaders: opts.customHeaders }
      : {}),
  })
}

/** Extract an OpenAI SDK error's HTTP status, if any */
function apiErrorStatus(e: unknown): number | undefined {
  return typeof e === 'object' && e !== null && 'status' in e
    ? (e as { status?: number }).status
    : undefined
}

/**
 * Run one OpenAI chat request with a single path-fallback retry: the request
 * first goes to the client's base URL (the user's input by default); only a
 * path-type failure triggers a retry at the /v1 alternative; and only a
 * successful retry is remembered and reported as `resolvedBaseUrl` so callers
 * can write the corrected URL back to the user.
 */
export async function chatCreateWithPathFallback<T>(
  client: OpenAI,
  baseUrl: string,
  opts: OpenAIProxyOptions,
  request: (c: OpenAI) => Promise<T>,
): Promise<{ value: T; resolvedBaseUrl?: string }> {
  try {
    return { value: await request(client) }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (!isPathError(apiErrorStatus(e), message)) throw e

    const fallback = getFallbackBaseUrl(baseUrl)
    const fallbackClient = makeOpenAIClient(fallback, opts)
    const value = await request(fallbackClient)
    rememberChatBaseUrl(baseUrl, fallback)
    return { value, resolvedBaseUrl: fallback }
  }
}