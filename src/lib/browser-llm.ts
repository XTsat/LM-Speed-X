'use client'

/**
 * Browser-direct LLM utilities.
 * Used when baseUrl is a local/private IP — the browser connects to the API directly,
 * bypassing the Next.js server proxy.
 */

import { isCloudflareError } from '@/lib/cloudflare'
import { createTimeoutSignal } from '@/lib/timeout-signal'
import { detectApiPath, getChatBaseUrl, getFallbackBaseUrl, isPathError, normalizeApiBaseUrl, rememberChatBaseUrl } from '@/lib/api-path'
import {
  VALIDATION_CHALLENGES,
  buildProbeContent,
  type ContentPart,
  type ValidationLevel,
} from '@/lib/validation'

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
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      // CGNAT 100.64.0.0/10 — tailnet/overlay addresses an upstream server can
      // never reach, so they need the same browser-direct treatment as RFC1918.
      // Keep this in sync with normalizeScheme() in api-path.ts.
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname)
    )
  } catch {
    return false
  }
}

/**
 * Whether the address carries an explicit port. URLs drop the scheme default
 * (:80/:443), so this reports only ports a user actually typed.
 */
export function hasExplicitPort(url: string): boolean {
  try {
    return new URL(url).port !== ''
  } catch {
    return false
  }
}

// ── Token estimation ──

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
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
  apiKey: string,
  options?: { credentials?: RequestCredentials; autoCompleteBaseUrl?: boolean }
): Promise<ModelsListResult[]> {
  const autoComplete = options?.autoCompleteBaseUrl !== false
  const normalized = normalizeApiBaseUrl(baseUrl, autoComplete)

  // Detect the correct API path prefix, fall back to /v1 if unreachable
  const prefix = autoComplete
    ? (await detectApiPath(baseUrl, apiKey)) ?? (normalized.endsWith('/v1') ? '' : '/v1')
    : ''
  const url = `${normalized}${prefix}/models`

  // Try without credentials first — avoids CORS issues when the API responds
  // with Access-Control-Allow-Origin: * (incompatible with credentials: 'include').
  let response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch((e) => {
    // Chrome extensions may monkey-patch window.fetch and throw synchronously
    // Also handles general network errors like CORS, mixed content, etc.
    throw new Error(`Failed to fetch models: ${e instanceof Error ? e.message : 'Network error'}`)
  })

  // If credentials were requested and the response looks like a Cloudflare
  // challenge, retry with credentials to send the cf_clearance cookie.
  if (!response.ok && options?.credentials === 'include') {
    const clone = response.clone()
    const text = await clone.text().catch(() => '')
    if (isCloudflareError(text)) {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        credentials: 'include',
      }).catch((e) => {
        throw new Error(`Failed to fetch models: ${e instanceof Error ? e.message : 'Network error'}`)
      })
    }
  }

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
  contentValid?: boolean | null
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
  validationLevel?: ValidationLevel,
  onBaseUrlResolved?: (url: string) => void,
  autoCompleteBaseUrl: boolean = true,
): Promise<ConnectivityResult> {
  const normalized = normalizeApiBaseUrl(baseUrl, autoCompleteBaseUrl)
  // Fail-based /v1 fallback: requests go to the address as filled in first;
  // only a path-type failure retries once at the /v1 alternative, and only a
  // successful retry is remembered and surfaced back to the user. With
  // completion off there is no fallback and no cached correction.
  const knownBase = autoCompleteBaseUrl ? getChatBaseUrl(normalized) : null
  let apiBase = knownBase ?? normalized
  let resolvedNotified = false
  if (knownBase) onBaseUrlResolved?.(knownBase)
  const challenge = validationLevel ? VALIDATION_CHALLENGES[validationLevel] : null
  const probeContent = buildProbeContent(challenge)

  const mkHeaders = () => ({
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  })

  const probe = async (stream: boolean, abortSignal: AbortSignal, base: string = apiBase): Promise<{ ok: boolean; error: string; status?: number; content?: string }> => {
    // Per-request timeout — shared logic with the server proxy route. The
    // request aborts when either the timeout elapses or the caller cancels.
    const { signal: requestSignal, done } = createTimeoutSignal(abortSignal, timeoutMs)
    try {
      const resp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: mkHeaders(),
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: probeContent }],
          ...(stream ? { stream: true } : { max_tokens: challenge ? 256 : 1, stream: false }),
        }),
        signal: requestSignal,
      })

      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        return { ok: false, error: text || `HTTP ${resp.status}`, status: resp.status }
      }

      if (stream) {
        // Read all content chunks to get the full response for validation
        if (!resp.body) return { ok: false, error: 'No response body', status: resp.status }
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let fullContent = ''
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
                const delta = chunk.choices?.[0]?.delta?.content
                if (delta) fullContent += delta
              } catch { /* skip */ }
            }
          }
          return { ok: fullContent.length > 0, error: '', status: resp.status, content: fullContent }
        } finally {
          reader.releaseLock()
        }
      } else {
        const data = await resp.json()
        const content = data.choices?.[0]?.message?.content
        const hasContent = content !== undefined && content !== null
        return { ok: hasContent, error: hasContent ? '' : 'Empty response from model', status: resp.status, content: content ?? '' }
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        // External cancel and per-request timeout both produce an AbortError —
        // distinguish them so the UI reports the real cause.
        if (abortSignal.aborted) {
          return { ok: false, error: 'Cancelled' }
        }
        return { ok: false, error: `Request timed out after ${timeoutMs}ms` }
      }
      return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }
    } finally {
      done()
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

  const makeResult = (reachable: boolean, error: string, latencyMs: number, retries: number, contentValid?: boolean | null): ConnectivityResult => ({
    modelId,
    reachable,
    error: truncateError(error),
    latencyMs,
    retries,
    tierRestricted: !reachable ? isTierRestricted(error) : undefined,
    contentValid: contentValid ?? (reachable ? null : (validationLevel ? false : null)),
  })

  const attemptOnce = async (abortSignal: AbortSignal) => {
    const start = Date.now()

    // Check external abort signal
    if (abortSignal.aborted) {
      return makeResult(false, 'Cancelled', 0, 0)
    }

    let streaming = await probe(true, abortSignal)
    if (
      autoCompleteBaseUrl &&
      !streaming.ok &&
      isPathError(streaming.status, streaming.error) &&
      !resolvedNotified
    ) {
      // Path-type failure at the address as filled in — retry once at the /v1
      // alternative; only a successful retry is remembered and written back.
      const fallback = getFallbackBaseUrl(normalized)
      const fbStreaming = await probe(true, abortSignal, fallback)
      if (fbStreaming.ok) {
        streaming = fbStreaming
        apiBase = fallback
        rememberChatBaseUrl(normalized, fallback)
        resolvedNotified = true
        onBaseUrlResolved?.(fallback)
      }
    }
    if (streaming.ok) {
      const valid = challenge ? challenge.validate(streaming.content ?? '') : null
      return makeResult(true, '', Date.now() - start, 0, valid)
    }

    if (shouldFallbackToNonStreaming(streaming)) {
      // Check external abort before fallback
      if (abortSignal.aborted) {
        return makeResult(false, 'Cancelled', Date.now() - start, 1)
      }
      const nonStreaming = await probe(false, abortSignal)
      if (nonStreaming.ok) {
        const valid = challenge ? challenge.validate(nonStreaming.content ?? '') : null
        return makeResult(true, '', Date.now() - start, 1, valid)
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

/** 浏览器直连单次流式请求的可选项，语义与服务端代理路由保持一致 */
export interface BrowserChatOptions {
  autoCompleteBaseUrl?: boolean
  /** 自定义请求头（authorization 已在上游被过滤，避免覆盖 apiKey） */
  customHeaders?: Record<string, string>
  /** Cloudflare 手工验证后需要带 Cookie 才能通过，走 fetch 的 credentials: 'include' */
  credentials?: RequestCredentials
  /** 单请求总超时；数值与服务端路由一致：测速/稳定性 60s，并发 120s */
  timeoutMs?: number
  /** 首个 token 的等待上限；超过即按请求失败计入（服务端 maxFirstTokenLatency 的浏览器端等价实现） */
  maxFirstTokenLatency?: number
}

/**
 * 超时类失败单独成类：组件需要按 kind 给出本地化文案，
 * 而普通网络/HTTP 错误继续使用原始 message。
 */
export class RequestTimeoutError extends Error {
  readonly kind: 'timeout' | 'firstToken'
  readonly limitMs: number

  constructor(kind: 'timeout' | 'firstToken', limitMs: number) {
    super(
      kind === 'timeout'
        ? `Request timed out after ${limitMs}ms`
        : `No first token within ${limitMs}ms`,
    )
    this.name = 'RequestTimeoutError'
    this.kind = kind
    this.limitMs = limitMs
  }
}

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
    onBaseUrlResolved?: (url: string) => void
  },
  externalSignal?: AbortSignal,
  options?: BrowserChatOptions,
): Promise<SpeedTestResult> {
  const autoComplete = options?.autoCompleteBaseUrl !== false
  const normalized = normalizeApiBaseUrl(baseUrl, autoComplete)
  // Fail-based /v1 fallback: the request goes to the address as filled in
  // first; only a path-type failure retries once at the /v1 alternative, and
  // only a successful retry is remembered and surfaced back to the user. With
  // completion off both the retry and the cached correction are disabled.
  const knownBase = autoComplete ? getChatBaseUrl(normalized) : null
  let apiBase = knownBase ?? normalized
  if (knownBase) callbacks.onBaseUrlResolved?.(knownBase)

  const startTime = performance.now()
  let firstTokenTime = 0
  let content = ''

  // 三条中断来源要给出不同语义（外部取消 / 总超时 / 首字超时），所以不用
  // createTimeoutSignal —— 它只暴露一个合成信号，分不清是被谁中断的。
  let abortKind: 'external' | 'timeout' | 'firstToken' | null = null
  const controller = new AbortController()
  const abortWith = (kind: 'external' | 'timeout' | 'firstToken') => {
    if (!abortKind) abortKind = kind
    controller.abort()
  }
  const onExternalAbort = () => abortWith('external')
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort()
    else externalSignal.addEventListener('abort', onExternalAbort)
  }
  const timeoutMs = options?.timeoutMs
  const timeoutTimer = timeoutMs ? setTimeout(() => abortWith('timeout'), timeoutMs) : null
  const firstTokenLimitMs = options?.maxFirstTokenLatency
  const firstTokenTimer = firstTokenLimitMs
    ? setTimeout(() => abortWith('firstToken'), firstTokenLimitMs)
    : null
  const releaseScope = () => {
    if (timeoutTimer !== null) clearTimeout(timeoutTimer)
    if (firstTokenTimer !== null) clearTimeout(firstTokenTimer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
  const timeoutFailure = (): RequestTimeoutError | null => {
    if (abortKind === 'timeout' && timeoutMs) return new RequestTimeoutError('timeout', timeoutMs)
    if (abortKind === 'firstToken' && firstTokenLimitMs) {
      return new RequestTimeoutError('firstToken', firstTokenLimitMs)
    }
    return null
  }

  const perform = (base: string): Promise<Response> =>
    fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(options?.customHeaders ?? {}),
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
      ...(options?.credentials ? { credentials: options.credentials } : {}),
    })

  try {
    let response: Response
    try {
      response = await perform(apiBase)
    } catch (e) {
      const timedOut = timeoutFailure()
      if (timedOut) throw timedOut
      const errMsg = (e as Error).message || 'Failed to fetch'
      const pageIsHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'
      const apiIsHttp = baseUrl.startsWith('http://')

      let hint = ''
      if (pageIsHttps && apiIsHttp) {
        hint = ' — Mixed content blocked: HTTPS pages cannot fetch HTTP endpoints'
      } else if (isLocalUrl(baseUrl)) {
        hint = ' — CORS may be blocking cross-origin requests to this local address'
      }

      throw new Error(`Network error: ${errMsg} (${apiBase})${hint}`)
    }

    if (!response.ok) {
      const status = response.status
      const text = await response.text().catch(() => '')
      if (autoComplete && isPathError(status, text) && !knownBase) {
        // Retry once at the /v1 alternative — only a successful retry is
        // remembered and written back to the user (never a guess).
        const fallback = getFallbackBaseUrl(normalized)
        const retry = await perform(fallback).catch(() => null)
        if (retry && retry.ok) {
          response = retry
          rememberChatBaseUrl(normalized, fallback)
          callbacks.onBaseUrlResolved?.(fallback)
        } else {
          const timedOut = timeoutFailure()
          if (timedOut) throw timedOut
          throw new Error(`HTTP ${status}: ${text}`)
        }
      } else {
        throw new Error(`HTTP ${status}: ${text}`)
      }
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
                // 首字已到，看门狗不再有意义，及时清掉避免长回答被误杀
                if (firstTokenTimer !== null) clearTimeout(firstTokenTimer)
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
    } catch (e) {
      // 流中途被超时/外部取消：转成对应的失败语义，而不是抛裸 AbortError
      const timedOut = timeoutFailure()
      if (timedOut) throw timedOut
      throw e
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
  } finally {
    releaseScope()
  }
}
