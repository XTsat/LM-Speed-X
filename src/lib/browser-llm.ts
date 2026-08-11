'use client'

/**
 * Browser-direct LLM utilities.
 * Used when baseUrl is a local/private IP — the browser connects to the API directly,
 * bypassing the Next.js server proxy.
 */

// ── URL detection ──

/** Detect private/local IPs where server-proxy cannot reach */
export function isLocalUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    )
  } catch {
    return false
  }
}

// ── Token estimation ──

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ── API path detection ──

/** Cache detected API path prefix per baseUrl */
const _pathCache = new Map<string, string>()

/**
 * Detect the correct API path prefix for an OpenAI-compatible API.
 * Tries /models first, falls back to /v1/models.
 * Results are cached per baseUrl for the session.
 */
async function detectApiPath(baseUrl: string, apiKey: string): Promise<string | null> {
  const normalized = baseUrl.replace(/\/+$/, '')
  
  const cached = _pathCache.get(normalized)
  if (cached !== undefined) return cached
  
  const attempts = [
    { path: '', url: `${normalized}/models` },
    { path: '/v1', url: `${normalized}/v1/models` },
  ]
  
  for (const { path, url } of attempts) {
    let response: Response | null = null
    try {
      response = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      })
    } catch {
      // Chrome extensions may monkey-patch window.fetch and throw synchronously
      continue
    }

    if (!response?.ok) continue

    try {
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) continue

      // Validate it's actually a models list
      const text = await response.text()
      const data = JSON.parse(text)
      const models = Array.isArray(data) ? data : data.data
      if (models && models.length > 0 && models[0].id) {
        _pathCache.set(normalized, path)
        return path
      }
    } catch {
      // try next
    }
  }
  
  // All probes failed — return null so callers can fall back to /v1
  return null
}

// ── Model listing ──

export interface ModelsListResult {
  id: string
  object?: string
  created?: number
  owned_by?: string
}

/** Fetch available models directly from the OpenAI-compatible API */
export async function fetchModelsDirect(
  baseUrl: string,
  apiKey: string
): Promise<ModelsListResult[]> {
  const normalized = baseUrl.replace(/\/+$/, '')
  
  // Detect the correct API path prefix, fall back to /v1 if unreachable
  const prefix = await detectApiPath(baseUrl, apiKey) ?? (normalized.endsWith('/v1') ? '' : '/v1')
  const url = `${normalized}${prefix}/models`
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Failed to fetch models (${response.status}) from ${url}: ${text.slice(0, 200)}`)
  }

  const data = await response.json()
  return Array.isArray(data) ? data : data.data ?? []
}

// ── Streaming chat (single completion) ──

export interface ConnectivityResult {
  modelId: string
  reachable: boolean
  error: string
  latencyMs: number
  retries: number
  tierRestricted?: boolean
}

function truncateError(msg: string): string {
  return msg.length > 200 ? msg.slice(0, 200) + '...' : msg
}

function isTierRestricted(error: string): boolean {
  const msg = error.toLowerCase()
  return (
    /plus and ultra models require/i.test(msg) ||
    /requires an api key/i.test(msg) ||
    /requires a (plus|ultra|pro) (model|subscription|plan)?/i.test(msg) ||
    /not available (on|with) your (current )?(plan|tier|subscription)/i.test(msg)
  )
}

/**
 * Test connectivity to a single model via browser-direct fetch.
 * Mirrors the server-side testModel() logic in api/connectivity/test-models/route.ts.
 */
export async function testConnectivityDirect(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  timeoutMs: number,
  maxRetries: number,
  retryDelayMs: number,
  signal?: AbortSignal,
): Promise<ConnectivityResult> {
  const normalized = baseUrl.replace(/\/+$/, '')
  const prefix = await detectApiPath(baseUrl, apiKey) ?? (normalized.endsWith('/v1') ? '' : '/v1')
  const apiBase = `${normalized}${prefix}`

  const mkHeaders = () => ({
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  })

  const probe = async (stream: boolean, abortSignal: AbortSignal): Promise<{ ok: boolean; error: string; status?: number }> => {
    try {
      const resp = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: mkHeaders(),
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Hi' }],
          ...(stream ? { stream: true } : { max_tokens: 1, stream: false }),
        }),
        signal: abortSignal,
      })

      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        return { ok: false, error: text || `HTTP ${resp.status}`, status: resp.status }
      }

      if (stream) {
        // Read first content chunk to confirm connectivity
        if (!resp.body) return { ok: false, error: 'No response body', status: resp.status }
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''
            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed || !trimmed.startsWith('data:')) continue
              const jsonStr = trimmed.slice(5).trim()
              if (jsonStr === '[DONE]') continue
              try {
                const chunk = JSON.parse(jsonStr)
                if (chunk.choices?.[0]?.delta?.content) {
                  reader.cancel()
                  return { ok: true, error: '', status: resp.status }
                }
              } catch { /* skip */ }
            }
          }
          return { ok: true, error: '', status: resp.status }
        } finally {
          reader.releaseLock()
        }
      } else {
        const data = await resp.json()
        const hasContent = data.choices?.length > 0 && data.choices[0].message?.content !== undefined
        return { ok: hasContent, error: hasContent ? '' : 'Empty response from model', status: resp.status }
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return { ok: false, error: `Request timed out after ${timeoutMs}ms` }
      }
      return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }
    }
  }

  const shouldFallbackToNonStreaming = (result: { ok: boolean; error: string; status?: number }): boolean => {
    if (result.ok) return false
    const msg = result.error.toLowerCase()
    const streamUnsupported =
      /stream/i.test(msg) &&
      /(not supported|unsupported|not allow|does not support|not.*support|invalid|expected|must|require)/i.test(msg)
    const badStatus =
      result.status === 400 || result.status === 404 || result.status === 405 ||
      result.status === 406 || result.status === 422 || result.status === 501
    const authFailed =
      result.status === 401 || /invalid api key|unauthorized|authentication/i.test(msg)
    return streamUnsupported || badStatus || authFailed
  }

  const makeResult = (reachable: boolean, error: string, latencyMs: number, retries: number): ConnectivityResult => ({
    modelId,
    reachable,
    error: truncateError(error),
    latencyMs,
    retries,
    tierRestricted: !reachable ? isTierRestricted(error) : undefined,
  })

  const attemptOnce = async (abortSignal: AbortSignal) => {
    const start = Date.now()

    // Check external abort signal
    if (abortSignal.aborted) {
      return makeResult(false, 'Cancelled', 0, 0)
    }

    const streaming = await probe(true, abortSignal)
    if (streaming.ok) {
      return makeResult(true, '', Date.now() - start, 0)
    }

    if (shouldFallbackToNonStreaming(streaming)) {
      // Check external abort before fallback
      if (abortSignal.aborted) {
        return makeResult(false, 'Cancelled', Date.now() - start, 1)
      }
      const nonStreaming = await probe(false, abortSignal)
      if (nonStreaming.ok) {
        return makeResult(true, '', Date.now() - start, 1)
      }
      const streamHint =
        /stream/i.test(streaming.error) &&
        /(not supported|unsupported|not allow|does not support|not.*support|invalid|expected|must|require)/i.test(streaming.error)
      return makeResult(false, streamHint ? nonStreaming.error : streaming.error, Date.now() - start, 1)
    }

    return makeResult(false, streaming.error, Date.now() - start, 0)
  }

  // Check external abort before starting retry loop
  if (signal?.aborted) {
    return makeResult(false, 'Cancelled', 0, 0)
  }

  let lastResult = await attemptOnce(signal!)
  if (lastResult.reachable || maxRetries === 0) return lastResult

  const interval = Math.max(500, retryDelayMs)
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      return { ...lastResult, error: 'Cancelled' }
    }
    await new Promise((r) => setTimeout(r, interval))
    if (signal?.aborted) {
      return { ...lastResult, error: 'Cancelled' }
    }
    const result = await attemptOnce(signal!)
    if (result.reachable) {
      return { ...result, retries: attempt }
    }
    lastResult = { ...result, retries: attempt }
  }

  return lastResult
}

// ── Streaming chat (single completion) ──

export interface SpeedTestResult {
  prompt: string
  model: string
  firstTokenLatency: number
  tokensPerSecond: number
  tokensPerSecondTotal: number
  outputToken: number
  outputTime: number
  totalTime: number
  content: string
  index: number
}

type Message = { role: string; content: string }

/**
 * Run one streamed chat completion from the browser.
 * Emits events via callbacks that mirror the server SSE message format.
 */
export async function runBrowserStreamedChat(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  messages: Message[],
  index: number,
  prompt: string,
  callbacks: {
    onContent: (data: {
      index: number
      content: string
      currentSpeed: number
      currentTotalSpeed: number
      currentTokens: number
      elapsedTime: number
    }) => void
  },
  signal?: AbortSignal
): Promise<SpeedTestResult> {
  const normalized = baseUrl.replace(/\/+$/, '')
  const detectedPrefix = await detectApiPath(baseUrl, apiKey)
  // Fall back to /v1 (standard OpenAI path) unless baseUrl already includes it
  const prefix = detectedPrefix ?? (normalized.endsWith('/v1') ? '' : '/v1')
  const url = `${normalized}${prefix}/chat/completions`

  const startTime = performance.now()
  let firstTokenTime = 0
  let content = ''

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    })
  } catch (e) {
    const errMsg = (e as Error).message || 'Failed to fetch'
    const pageIsHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'
    const apiIsHttp = baseUrl.startsWith('http://')

    let hint = ''
    if (pageIsHttps && apiIsHttp) {
      hint = ' — Mixed content blocked: HTTPS pages cannot fetch HTTP endpoints'
    } else if (isLocalUrl(baseUrl)) {
      hint = ' — CORS may be blocking cross-origin requests to this local address'
    } else if (detectedPrefix === null) {
      hint = ` — API unreachable at ${normalized} (both /models and /v1/models probes failed)`
    }

    throw new Error(`Network error: ${errMsg} (${url})${hint}`)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${text}`)
  }

  if (!response.body) throw new Error('No response body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      // Keep the last incomplete line in buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue

        const jsonStr = trimmed.slice(5).trim()
        if (jsonStr === '[DONE]') continue

        try {
          const chunk = JSON.parse(jsonStr)
          const delta = chunk.choices?.[0]?.delta

          if (delta?.content) {
            if (content.length === 0) {
              firstTokenTime = performance.now() - startTime
            }
            content += delta.content

            const currentTime = performance.now()
            const elapsedTime = currentTime - startTime
            const currentTokens = estimateTokens(content)
            const currentSpeed =
              currentTokens > 0 && elapsedTime > firstTokenTime
                ? (currentTokens / (elapsedTime - firstTokenTime)) * 1000
                : 0
            const currentTotalSpeed =
              currentTokens > 0 ? (currentTokens / elapsedTime) * 1000 : 0

            callbacks.onContent({
              index,
              content: delta.content,
              currentSpeed,
              currentTotalSpeed,
              currentTokens,
              elapsedTime,
            })
          }
        } catch {
          // Skip unparseable chunks
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  const totalTokens = estimateTokens(content)
  const endTime = performance.now()
  const totalTime = endTime - startTime
  const outputTime = totalTime - firstTokenTime

  return {
    prompt,
    model: modelId,
    firstTokenLatency: firstTokenTime,
    tokensPerSecond: outputTime > 0 ? (totalTokens / outputTime) * 1000 : 0,
    tokensPerSecondTotal: totalTime > 0 ? (totalTokens / totalTime) * 1000 : 0,
    outputToken: totalTokens,
    outputTime,
    totalTime,
    content,
    index,
  }
}

/** Save test results to server database (POST /api/speed/recent via a save endpoint) */
export async function saveResultsToServer(
  baseUrl: string,
  results: SpeedTestResult[]
): Promise<void> {
  try {
    const response = await fetch('/api/speed/recent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        baseUrl,
        results: results.map((r) => ({
          prompt: r.prompt,
          model: r.model,
          firstTokenLatency: r.firstTokenLatency,
          tokensPerSecond: r.tokensPerSecond,
          tokensPerSecondTotal: r.tokensPerSecondTotal,
          outputToken: r.outputToken,
          totalTime: r.totalTime,
          outputTime: r.outputTime,
          content: r.content,
        })),
      }),
    })
    if (!response.ok) {
      console.warn('Failed to save results to server:', response.status)
    }
  } catch (e) {
    console.warn('Failed to save results to server:', e)
  }
}
