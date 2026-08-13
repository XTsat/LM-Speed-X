import { NextResponse } from 'next/server'
import OpenAI from 'openai'

export interface ModelTestResult {
  modelId: string
  reachable: boolean
  error: string
  latencyMs: number
  /** Number of retries that were attempted before final result */
  retries: number
  /** True when the model is gated by a subscription tier (e.g. OpenRouter Plus/Ultra) */
  tierRestricted?: boolean
  /** True when challenge-response validation passed (null when no validation was requested) */
  contentValid?: boolean | null
}

/** Validation challenge definitions */
const VALIDATION_CHALLENGES = {
  repeat: {
    prompt: 'Reply with exactly the word "PONG" and nothing else. Do not add any other text.',
    validate: (content: string) => {
      const cleaned = content.trim().toLowerCase()
      return cleaned.includes('pong') && cleaned.length <= 10
    },
  },
  self: {
    prompt: 'State your exact model name and nothing else. Do not add explanations.',
    validate: (content: string) => {
      const lower = content.trim().toLowerCase()
      if (lower.length < 3) return false
      const errorSignals = ['error', 'overloaded', 'unavailable', 'try again', 'rate limit', 'quota', 'billing']
      if (errorSignals.some((s) => lower.includes(s))) return false
      const genericTemplates = [
        'how can i assist', 'how may i help', 'i am an ai assistant',
        'i am a large language model', 'i am here to help', 'what can i help you with',
      ]
      if (genericTemplates.some((s) => lower.includes(s))) return false
      return true
    },
  },
  math: {
    prompt: 'Calculate 173 + 289. Reply with only the number, no explanation.',
    validate: (content: string) => {
      const cleaned = content.trim().replace(/[^\d]/g, '')
      return cleaned === '462'
    },
  },
} as const

type ValidationLevel = keyof typeof VALIDATION_CHALLENGES | null

interface RequestBody {
  baseUrl: string
  apiKey: string
  modelIds: string[]
  /** Delay between each model test in ms (0 = parallel, no delay) */
  delayMs?: number
  /** Number of automatic retries on failure (0 = no retry) */
  retries?: number
  /** Per-model timeout in ms (default 15000) */
  timeoutMs?: number
  /** Challenge-response validation level: 'repeat' | 'self' | 'math' (null = no validation) */
  validationLevel?: ValidationLevel
}

interface AttemptResult {
  ok: boolean
  error: string
  status?: number
}

function truncateError(msg: string): string {
  return msg.length > 200 ? msg.slice(0, 200) + '...' : msg
}

/** Detect errors caused by subscription-tier gating (e.g. OpenRouter Plus/Ultra models) */
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
 * Run a single connectivity probe against one model.
 *
 * Strategy: try a streaming request first (most modern APIs support it and it
 * measures first-token latency). If the stream fails and the error suggests the
 * endpoint does not support streaming — or is an auth-class error (some proxies
 * route streaming vs non-streaming through different backends) — fall back to a
 * non-streaming request with max_tokens=1.
 */
async function testModel(
  openai: OpenAI,
  modelId: string,
  timeoutMs: number,
  validationLevel: ValidationLevel,
): Promise<ModelTestResult> {
  const start = Date.now()
  const challenge = validationLevel ? VALIDATION_CHALLENGES[validationLevel] : null
  const probeMessage = challenge ? challenge.prompt : 'Hi'

  const attempt = async (stream: boolean): Promise<AttemptResult & { content?: string }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      if (stream) {
        let fullContent = ''
        const completion = await openai.chat.completions.create(
          {
            model: modelId,
            messages: [{ role: 'user', content: probeMessage }],
            stream: true,
          },
          { signal: controller.signal as unknown as AbortSignal },
        )
        // Read all content chunks to get the full response for validation
        for await (const chunk of completion) {
          const delta = chunk.choices?.[0]?.delta?.content
          if (delta) fullContent += delta
        }
        return { ok: fullContent.length > 0, error: '', content: fullContent }
      } else {
        const resp = await openai.chat.completions.create(
          {
            model: modelId,
            messages: [{ role: 'user', content: probeMessage }],
            max_tokens: challenge ? 64 : 1,
            stream: false,
          },
          { signal: controller.signal as unknown as AbortSignal },
        )
        const hasContent =
          resp.choices?.length > 0 &&
          resp.choices[0].message?.content !== undefined
        if (!hasContent) {
          return { ok: false, error: 'Empty response from model' }
        }
        return { ok: true, error: '', content: resp.choices[0].message.content ?? '' }
      }
    } catch (e: unknown) {
      const status =
        typeof e === 'object' && e !== null && 'status' in e
          ? (e as { status?: number }).status
          : undefined
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        status,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  // Detect errors that warrant falling back to non-streaming:
  // - The API explicitly rejects stream:true (400/404/405/406/422/501)
  // - Auth-class errors (some proxies validate keys differently per mode)
  const shouldFallbackToNonStreaming = (a: AttemptResult): boolean => {
    if (a.ok) return false
    const msg = a.error.toLowerCase()
    const streamUnsupported =
      /stream/i.test(msg) &&
      /(not supported|unsupported|not allow|does not support|not.*support|invalid|expected|must|require)/i.test(
        msg,
      )
    const badStatus =
      a.status === 400 ||
      a.status === 404 ||
      a.status === 405 ||
      a.status === 406 ||
      a.status === 422 ||
      a.status === 501
    const authFailed =
      a.status === 401 || /invalid api key|unauthorized|authentication/i.test(msg)
    return streamUnsupported || badStatus || authFailed
  }

  const failure = (error: string, retries: number): ModelTestResult => ({
    modelId,
    reachable: false,
    error: truncateError(error),
    latencyMs: Date.now() - start,
    retries,
    tierRestricted: isTierRestricted(error),
    contentValid: validationLevel ? false : null,
  })

  const success = (content: string | undefined, retries: number): ModelTestResult => ({
    modelId,
    reachable: true,
    error: '',
    latencyMs: Date.now() - start,
    retries,
    contentValid: challenge ? challenge.validate(content ?? '') : null,
  })

  const streaming = await attempt(true)
  if (streaming.ok) {
    return success(streaming.content, 0)
  }

  if (shouldFallbackToNonStreaming(streaming)) {
    const nonStreaming = await attempt(false)
    if (nonStreaming.ok) {
      return success(nonStreaming.content, 1)
    }
    // Both modes failed — prefer the more meaningful error (the one that is
    // not a "streaming not supported" hint)
    const streamHint =
      /stream/i.test(streaming.error) &&
      /(not supported|unsupported|not allow|does not support|not.*support|invalid|expected|must|require)/i.test(
        streaming.error,
      )
    const error = streamHint ? nonStreaming.error : streaming.error
    return failure(error, 1)
  }

  return failure(streaming.error, 0)
}

async function testModelWithRetry(
  openai: OpenAI,
  modelId: string,
  maxRetries: number,
  delayMs: number,
  timeoutMs: number,
  validationLevel: ValidationLevel,
): Promise<ModelTestResult> {
  let lastResult: ModelTestResult = {
    modelId,
    reachable: false,
    error: '',
    latencyMs: 0,
    retries: 0,
  }

  const retryInterval = Math.max(500, delayMs)

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await testModel(openai, modelId, timeoutMs, validationLevel)
    if (result.reachable) {
      return { ...result, retries: attempt }
    }
    lastResult = { ...result, retries: attempt }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, retryInterval))
    }
  }

  return lastResult
}

// Utility: push a result as NDJSON line into the stream
function sendResult(
  controller: ReadableStreamDefaultController,
  writer: ReturnType<typeof createWriter>,
  result: ModelTestResult,
  done: boolean,
  total: number,
  completed: number,
) {
  const line = JSON.stringify({ result, done, total, completed }) + '\n'
  writer.enqueue(line)
}

function createWriter(controller: ReadableStreamDefaultController) {
  const encoder = new TextEncoder()
  return {
    enqueue: (data: string) => {
      controller.enqueue(encoder.encode(data))
    },
  }
}

export async function POST(request: Request) {
  const body: RequestBody = await request.json().catch(() => null)
  if (!body || !body.baseUrl || !body.apiKey || !Array.isArray(body.modelIds)) {
    return NextResponse.json(
      { error: 'Missing required fields: baseUrl, apiKey, modelIds' },
      { status: 400 },
    )
  }

  if (body.modelIds.length === 0) {
    return NextResponse.json({ results: [] }, { status: 200 })
  }

  const delayMs = Math.max(0, body.delayMs ?? 0)
  const maxRetries = Math.max(0, Math.min(body.retries ?? 0, 5))
  const timeoutMs = Math.max(1000, body.timeoutMs ?? 15_000)
  const validationLevel: ValidationLevel = body.validationLevel ?? null

  const openai = new OpenAI({
    apiKey: body.apiKey,
    baseURL: body.baseUrl,
    timeout: timeoutMs,
    maxRetries: 0,
  })

  const total = body.modelIds.length

  const stream = new ReadableStream({
    async start(controller) {
      const writer = createWriter(controller)
      let completed = 0

      try {
        if (delayMs > 0) {
          // Sequential with delay — stream each result as it completes
          for (const id of body.modelIds) {
            const result = await testModelWithRetry(openai, id, maxRetries, delayMs, timeoutMs, validationLevel)
            completed++
            const done = completed >= total
            sendResult(controller, writer, result, done, total, completed)
            if (!done) {
              await new Promise((r) => setTimeout(r, delayMs))
            }
          }
        } else {
          // Parallel — stream each result as it settles
          const promises = body.modelIds.map(async (id) => {
            const result = await testModelWithRetry(openai, id, maxRetries, delayMs, timeoutMs, validationLevel)
            completed++
            const done = completed >= total
            sendResult(controller, writer, result, done, total, completed)
          })
          await Promise.all(promises)
        }

        controller.close()
      } catch (e) {
        console.error('Stream error:', e)
        controller.error(e)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
