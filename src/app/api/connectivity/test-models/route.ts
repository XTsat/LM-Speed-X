import { NextResponse } from 'next/server'
import OpenAI from 'openai'

export interface ModelTestResult {
  modelId: string
  reachable: boolean
  error: string
  latencyMs: number
  /** Number of retries that were attempted before final result */
  retries: number
}

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
}

async function testModel(
  openai: OpenAI,
  modelId: string,
  timeoutMs: number,
): Promise<ModelTestResult> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const resp = await openai.chat.completions.create(
        {
          model: modelId,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
          stream: false,
        },
        {
          signal: controller.signal as unknown as AbortSignal,
        },
      )

      const hasContent =
        resp.choices &&
        resp.choices.length > 0 &&
        resp.choices[0].message?.content !== undefined

      return {
        modelId,
        reachable: hasContent,
        error: hasContent ? '' : 'Empty response from model',
        latencyMs: Date.now() - start,
        retries: 0,
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (e: unknown) {
    const msg =
      e instanceof Error ? e.message : 'Unknown error'
    return {
      modelId,
      reachable: false,
      error: msg.length > 200 ? msg.slice(0, 200) + '...' : msg,
      latencyMs: Date.now() - start,
      retries: 0,
    }
  }
}

async function testModelWithRetry(
  openai: OpenAI,
  modelId: string,
  maxRetries: number,
  delayMs: number,
  timeoutMs: number,
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
    const result = await testModel(openai, modelId, timeoutMs)
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

  if (body.modelIds.length > 100) {
    return NextResponse.json(
      { error: 'Too many models (max 100)' },
      { status: 400 },
    )
  }

  const delayMs = Math.max(0, body.delayMs ?? 0)
  const maxRetries = Math.max(0, Math.min(body.retries ?? 0, 5))
  const timeoutMs = Math.max(1000, body.timeoutMs ?? 15_000)

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
            const result = await testModelWithRetry(openai, id, maxRetries, delayMs, timeoutMs)
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
            const result = await testModelWithRetry(openai, id, maxRetries, delayMs, timeoutMs)
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
