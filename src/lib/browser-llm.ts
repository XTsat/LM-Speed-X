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
async function detectApiPath(baseUrl: string, apiKey: string): Promise<string> {
  const normalized = baseUrl.replace(/\/+$/, '')
  
  const cached = _pathCache.get(normalized)
  if (cached !== undefined) return cached
  
  const attempts = [
    { path: '', url: `${normalized}/models` },
    { path: '/v1', url: `${normalized}/v1/models` },
  ]
  
  for (const { path, url } of attempts) {
    try {
      const response = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      }).catch(() => null)
      
      if (!response?.ok) continue
      
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
  
  // Default to no prefix (openai SDK default behavior)
  return ''
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
  
  // Detect the correct API path prefix
  const prefix = await detectApiPath(baseUrl, apiKey)
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
  const prefix = await detectApiPath(baseUrl, apiKey)
  const url = `${normalized}${prefix}/chat/completions`

  const startTime = performance.now()
  let firstTokenTime = 0
  let content = ''

  const response = await fetch(url, {
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
