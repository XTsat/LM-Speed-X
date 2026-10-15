/**
 * Shared OpenAI-compatible API path detection.
 *
 * Used by BOTH the browser-direct path (lib/browser-llm.ts) and the
 * server-proxy paths (api/speed/*, api/connectivity/test-models, api/model)
 * so the "try the URL as filled in, fall back to /v1" behavior lives in one
 * place and the two sides can never drift.
 *
 * Strategy: probe {base}/models first (the URL exactly as the user typed it,
 * minus trailing slashes); if that does not return a valid models list, probe
 * {base}/v1/models. Successful detections are cached per baseUrl for the
 * process lifetime so repeats are free.
 */
import { isCloudflareError } from '@/lib/cloudflare'

/** Detected API path prefix per baseUrl: '' (root works) or '/v1' */
const _pathCache = new Map<string, string>()

/** Per-probe timeout — a hanging /models endpoint must not stall a test start */
const DEFAULT_PROBE_TIMEOUT_MS = 10_000

export interface ProbeModel {
  id: string
  object?: string
}

export interface ModelsProbe {
  ok: boolean
  /** Validated models list — present only when ok is true */
  models?: ProbeModel[]
  /** URL that served a Cloudflare challenge page, so callers can offer manual bypass */
  cfUrl?: string
}

/** Candidate URLs to probe, in preference order */
export function apiPathCandidates(baseUrl: string): Array<{ path: string; url: string }> {
  const normalized = baseUrl.replace(/\/+$/, '')
  if (normalized.endsWith('/v1')) {
    return [{ path: '', url: `${normalized}/models` }]
  }
  return [
    { path: '', url: `${normalized}/models` },
    { path: '/v1', url: `${normalized}/v1/models` },
  ]
}

/**
 * Probe a single /models URL. Reports ok only when the response is JSON and
 * carries a non-empty models list; reports cfUrl when the response is a
 * Cloudflare challenge page (which is not a valid models response).
 */
export async function probeModelsUrl(
  url: string,
  apiKey: string,
  credentials?: RequestCredentials,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<ModelsProbe> {
  let response: Response | null = null
  try {
    response = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      credentials,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    // Chrome extensions may monkey-patch window.fetch and throw synchronously
    if (e instanceof Error && e.name === 'TypeError' && e.message === 'Failed to fetch') {
      throw e // Let callers fall back to the server proxy
    }
    return { ok: false }
  }

  if (response?.status === 403) {
    const body = await response.text().catch(() => '')
    if (isCloudflareError(body)) return { ok: false, cfUrl: url }
    return { ok: false }
  }
  if (!response || !response.ok) return { ok: false }

  try {
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      const body = await response.text().catch(() => '')
      if (isCloudflareError(body)) return { ok: false, cfUrl: url }
      return { ok: false }
    }
    const text = await response.text()
    const data = JSON.parse(text)
    const models = (Array.isArray(data) ? data : data.data) as unknown[]
    const valid =
      Array.isArray(models) &&
      models.length > 0 &&
      typeof (models[0] as { id?: unknown } | null | undefined)?.id === 'string'
    if (!valid) return { ok: false }
    return {
      ok: true,
      models: models
        .filter((m): m is ProbeModel => !!m && typeof (m as { id?: unknown }).id === 'string')
        .map((m) => ({
          id: (m as { id: string }).id,
          object: (m as { object?: string }).object,
        })),
    }
  } catch {
    return { ok: false }
  }
}

/**
 * Detect the correct API path prefix for an OpenAI-compatible API.
 * Returns '' when the baseUrl works as-is, '/v1' when only the /v1 variant
 * responds, or null when neither probe succeeds.
 */
export async function detectApiPath(
  baseUrl: string,
  apiKey: string,
  credentials?: RequestCredentials,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<string | null> {
  const normalized = baseUrl.replace(/\/+$/, '')
  const cached = _pathCache.get(normalized)
  if (cached !== undefined) return cached

  for (const { path, url } of apiPathCandidates(normalized)) {
    const probe = await probeModelsUrl(url, apiKey, credentials, timeoutMs)
    if (probe.ok) {
      _pathCache.set(normalized, path)
      return path
    }
  }
  return null
}

export interface ResolvedApiBase {
  /** Base URL with the API path prefix applied — use this for all calls */
  url: string
  /** Detected prefix ('', '/v1') or null when neither probe succeeded */
  prefix: string | null
  /** True when url differs from the (trimmed) input — the input can be updated */
  changed: boolean
}

/**
 * Resolve the effective API base URL for an OpenAI-compatible API.
 * Defaults to appending /v1 when detection fails — the standard OpenAI path —
 * unless the input already includes /v1.
 */
export async function resolveApiBaseUrl(
  baseUrl: string,
  apiKey: string,
  credentials?: RequestCredentials,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<ResolvedApiBase> {
  const normalized = baseUrl.replace(/\/+$/, '')
  const prefix = await detectApiPath(normalized, apiKey, credentials, timeoutMs)
  const url =
    prefix === null
      ? normalized + (normalized.endsWith('/v1') ? '' : '/v1')
      : normalized + prefix
  return { url, prefix, changed: url !== normalized }
}

// ── Fail-based fallback for chat requests ──
//
// Probes /models can give false signals for chat (some gateways disable the
// models endpoint while chat works fine). So chat flows do NOT pre-probe:
// the real request goes to the address exactly as the user filled it in, and
// only a path-type failure (404/405/501) triggers ONE retry at the obvious
// /v1 alternative. The alternative is remembered only when the retry actually
// succeeds, and callers surface it back to the user (write-back into the
// input) — a correct user URL is never "fixed" by a guess.

/** Trim trailing slashes — the only neutral normalization applied to user input */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

/**
 * The one obvious alternative base URL for a path-type failure:
 * append /v1 when missing, strip /v1 when present. Pure string logic.
 */
export function getFallbackBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized.endsWith('/v1') && normalized.length > 4) {
    return normalized.slice(0, -3)
  }
  return `${normalized}/v1`
}

/**
 * Conservative path-error classifier. Only these signals trigger the /v1
 * fallback, so a URL the user filled in correctly is never "fixed" by a
 * false-positive detection (e.g. a 400 for a bad request body, a 401/403
 * auth issue, or a 404 caused by an unknown model id).
 */
export function isPathError(status: number | undefined, message: string): boolean {
  if (status === 404 || status === 405 || status === 501) return true
  const msg = message.toLowerCase()
  return /(url|path|endpoint|route).*(not found|does not exist|not exist)/.test(msg)
}

/** Chat-confirmed base URL per normalized input — evidence, not guesses */
const _chatBaseCache = new Map<string, string>()

/** Cached chat-confirmed base URL (from a previous successful fallback), if any */
export function getChatBaseUrl(baseUrl: string): string | null {
  const url = _chatBaseCache.get(normalizeBaseUrl(baseUrl))
  return url === undefined ? null : url
}

/** Remember that chat requests succeeded at `resolvedUrl` for this input */
export function rememberChatBaseUrl(baseUrl: string, resolvedUrl: string): void {
  _chatBaseCache.set(normalizeBaseUrl(baseUrl), normalizeBaseUrl(resolvedUrl))
}
