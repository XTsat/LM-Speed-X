import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';

const concurrencyTestSchema = z.object({
  baseUrl: z.string().url('Please enter a valid URL'),
  apiKey: z.string().min(1, 'API Key is required'),
  modelId: z.string().min(1, 'Model ID is required'),
  prompt: z.string().min(1, 'Prompt is required'),
  // Multi-level concurrency list (llm-benchmark style). Backwards-compat: if absent, use `concurrency` single value.
  concurrencyLevels: z.array(z.number().int().min(1).max(200)).nonempty().optional(),
  concurrency: z.number()
    .int('Concurrency must be an integer')
    .min(1, 'Minimum concurrency is 1')
    .max(200, 'Maximum concurrency is 200')
    .default(5),
  customHeaders: z.record(z.string(), z.string()).optional(),
  maxFirstTokenLatency: z.number()
    .int('maxFirstTokenLatency must be an integer')
    .min(1, 'Minimum maxFirstTokenLatency is 1ms')
    .max(120000, 'Maximum maxFirstTokenLatency is 120000ms')
    .optional(),
});

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function calculateStats(values: number[]) {
  const n = values.length;
  if (n === 0) return { mean: 0, stdDev: 0, min: 0, max: 0, variance: 0, median: 0, p99: 0 };

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const min = sorted[0];
  const max = sorted[n - 1];
  // P99: index = ceil(0.99 * n) - 1, clamped to [0, n-1]; for small n falls back to max
  let p99 = max;
  if (n >= 2) {
    const idx = Math.min(n - 1, Math.max(0, Math.ceil(0.99 * n) - 1));
    p99 = sorted[idx];
  }

  return { mean, stdDev, min, max, variance, median, p99 };
}

interface RequestResult {
  requestId: number;
  firstTokenLatency: number;
  tokensPerSecond: number;
  tokensPerSecondTotal: number;
  outputToken: number;
  totalTime: number;
  outputTime: number;
  content: string;
  success: boolean;
  error?: string;
}

// Heuristics to detect "empty" or "error-like" outputs that stream-completed without throwing.
// Many providers will finish the stream successfully but emit an error message as content
// (e.g. "error: rate limit exceeded", "该令牌已过期", "Internal Server Error"), or simply
// return an empty string. We treat both as failures so the success rate reflects real output.
const ERROR_MARKERS = [
  // English API error patterns
  'rate limit', 'rate_limit', 'too many requests', 'quota exceeded', 'insufficient_quota',
  'unauthorized', 'invalid api key', 'invalid_api_key', 'authentication', 'forbidden',
  'internal server error', 'service unavailable', 'bad gateway', 'gateway timeout',
  'overloaded', 'capacity', 'temporarily unavailable', 'please try again',
  'context length', 'maximum context', 'context window',
  // Common error prefixes
  'error:', 'error -', 'err:', 'failed:', 'failure:',
  // Chinese error patterns
  '请求失败', '请求超时', '请求错误', '请求异常', '接口错误', '服务繁忙',
  '当前负载', '负载过高', '暂时不可用', '稍后重试', '内部错误', '系统繁忙',
  '限流', '触发限流', '速率限制', '频率限制', '配额不足', '配额已用尽',
  '令牌已过期', '令牌无效', '密钥无效', '认证失败', '无权访问', '权限不足',
  '超出上下文', '上下文长度', '上下文过长',
];

function classifyContent(content: string): { valid: boolean; reason?: string } {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'Empty response content' };
  }
  // "Just a short error sentence" — not real model output. Most genuine LLM completions
  // areParagraph-length; a sub-120-char stream that matches an error marker is an error,
  // not a completion.
  const lower = trimmed.toLowerCase();
  for (const marker of ERROR_MARKERS) {
    if (lower.includes(marker)) {
      return { valid: false, reason: `Error-like output detected: ${trimmed.slice(0, 120)}` };
    }
  }
  return { valid: true };
}


// Run a single concurrency level (N parallel streaming requests) and emit progress via writer.
async function runConcurrencyLevel(
  openai: OpenAI,
  level: number,
  modelId: string,
  prompt: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  levelIndex: number,
  totalLevels: number,
  maxFirstTokenLatency?: number,
): Promise<RequestResult[]> {
  // Emit level start
  await writer.write(encoder.encode(JSON.stringify({
    type: 'level_start',
    data: { level, levelIndex, totalLevels, prompt }
  }) + '\n'));

  const results: RequestResult[] = new Array(level).fill(null).map((_, i) => ({
    requestId: i + 1,
    firstTokenLatency: 0,
    tokensPerSecond: 0,
    tokensPerSecondTotal: 0,
    outputToken: 0,
    totalTime: 0,
    outputTime: 0,
    content: '',
    success: false,
  }));

  const levelStartTime = performance.now();

  // Watchdog error string for fast identification of serialized API endpoints
  const TTFT_TIMEOUT_REASON = 'MaxFirstTokenLatencyExceeded';

  const concurrentTasks = Array.from({ length: level }, (_, i) => (async () => {
    const requestId = i + 1;
    const startTime = performance.now();
    let firstTokenTime = 0;
    let content = '';
    let ttftTimedOut = false;

    // ── First-token timeout watchdog ──────────────────────────────
    // Some API endpoints serialize requests (one must finish before
    // the next begins generating tokens). This watchdog aborts the
    // request if the first token doesn't arrive within the configured
    // threshold, so we don't silently inflate TTFT metrics with
    // queued/sequential delays.
    const abortCtrl = new AbortController();
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    if (maxFirstTokenLatency !== undefined && maxFirstTokenLatency > 0) {
      watchdog = setTimeout(() => {
        abortCtrl.abort();
      }, maxFirstTokenLatency);
    }

    try {
      const completion = await openai.chat.completions.create({
        model: modelId,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      }, {
        signal: abortCtrl.signal,
      });

      for await (const chunk of completion) {
        if (content.length === 0) {
          // Clear the watchdog now that the first token arrived.
          if (watchdog !== undefined) clearTimeout(watchdog);
          firstTokenTime = performance.now() - startTime;
        }
        if (chunk.choices[0]?.delta?.content) {
          content += chunk.choices[0].delta.content;

          const currentTime = performance.now();
          const elapsedTime = currentTime - startTime;
          const currentTokens = estimateTokens(content);
          const currentSpeed = currentTokens > 0 && elapsedTime > firstTokenTime
            ? (currentTokens / (elapsedTime - firstTokenTime)) * 1000
            : 0;
          const currentTotalSpeed = currentTokens > 0
            ? (currentTokens / elapsedTime) * 1000
            : 0;

          await writer.write(encoder.encode(JSON.stringify({
            type: 'content',
            data: {
              levelIndex,
              requestId,
              content: chunk.choices[0].delta.content,
              currentSpeed,
              currentTotalSpeed,
              currentTokens,
              elapsedTime,
            }
          }) + '\n'));
        }
      }

      // Safety: clear watchdog if the chunk stream completed before
      // the watchdog fired (e.g. maxFirstTokenLatency set high, stream
      // is fast, or watchdog did fire but AbortError was somehow handled).
      if (watchdog !== undefined) clearTimeout(watchdog);

      const totalTokens = estimateTokens(content);
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      const outputTime = totalTime - firstTokenTime;
      const tps = outputTime > 0 ? (totalTokens / outputTime) * 1000 : 0;
      const tpsTotal = totalTime > 0 ? (totalTokens / totalTime) * 1000 : 0;

      // Validate the streamed content: empty or error-like outputs are treated as failures
      // even when the HTTP stream completed without throwing.
      const { valid, reason } = classifyContent(content);
      if (!valid) {
        results[i] = {
          requestId,
          firstTokenLatency: firstTokenTime,
          tokensPerSecond: 0,
          tokensPerSecondTotal: 0,
          outputToken: 0,
          totalTime,
          outputTime,
          content,
          success: false,
          error: reason,
        };
        return;
      }

      const result: RequestResult = {
        requestId,
        firstTokenLatency: firstTokenTime,
        tokensPerSecond: tps,
        tokensPerSecondTotal: tpsTotal,
        outputToken: totalTokens,
        totalTime,
        outputTime,
        content,
        success: true,
      };

      results[i] = result;
    } catch (err) {
      // Clean up the watchdog timer so it doesn't fire after the
      // stream has already been cancelled/errored.
      if (watchdog !== undefined) clearTimeout(watchdog);

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // Determine whether the error is a first-token timeout (watchdog).
      const isTtftTimeout = abortCtrl.signal.aborted;

      if (isTtftTimeout) {
        // First-token timeout — the endpoint was serializing or the
        // model failed to start generating within the threshold.
        ttftTimedOut = true;
        results[i] = {
          requestId,
          firstTokenLatency: totalTime, // whole request spent waiting for the token
          tokensPerSecond: 0,
          tokensPerSecondTotal: 0,
          outputToken: 0,
          totalTime,
          outputTime: 0,
          content: '',
          success: false,
          error: TTFT_TIMEOUT_REASON,
        };
      return;
      }

      const errMsg = err instanceof Error ? err.message : 'Unknown error';

      // Also classify any partial content captured before the throw — prefer a meaningful
      // error reason over the raw exception when the content itself signals the failure.
      const { valid, reason } = classifyContent(content);
      const finalError = !valid && reason ? reason : errMsg;

      results[i] = {
        requestId,
        firstTokenLatency: firstTokenTime,
        tokensPerSecond: 0,
        tokensPerSecondTotal: 0,
        outputToken: 0,
        totalTime,
        outputTime: totalTime - firstTokenTime,
        content,
        success: false,
        error: finalError,
      };
    } finally {
      // Always call cleanup of the watchdog.
      if (watchdog !== undefined) clearTimeout(watchdog);
    }
  })());

  await Promise.all(concurrentTasks);

  const levelEndTime = performance.now();
  const levelTotalTimeSec = (levelEndTime - levelStartTime) / 1000;

  // Compute per-level aggregated stats (llm-benchmark style)
  const successResults = results.filter(r => r.success);
  const successCount = successResults.length;
  const failureCount = level - successCount;
  const successRate = level > 0 ? (successCount / level) * 100 : 0;

  // RPS = successful requests / level elapsed time (seconds)
  const rps = levelTotalTimeSec > 0 ? successCount / levelTotalTimeSec : 0;

  // Average latency (totalTime) across successful requests (seconds)
  // P99 latency across successful requests (seconds)
  // Average TPS across successful requests
  // Average TTFT (first token latency, seconds)
  const latenciesMs = successResults.map(r => r.totalTime);
  const tpsValues = successResults.map(r => r.tokensPerSecond);
  const ttftsMs = successResults.map(r => r.firstTokenLatency);

  const latencyStats = calculateStats(latenciesMs);
  const ttftStats = calculateStats(ttftsMs);
  const tpsStats = calculateStats(tpsValues);

  const summary = {
    level,
    levelIndex,
    totalRequests: level,
    successCount,
    failureCount,
    successRate,
    rps,
    avgLatencySec: latencyStats.mean / 1000,
    p99LatencySec: latencyStats.p99 / 1000,
    avgTps: tpsStats.mean,
    avgTtftSec: ttftStats.mean / 1000,
    levelTotalTimeSec,
    totalOutputTokens: successResults.reduce((acc, r) => acc + r.outputToken, 0),
  };

  await writer.write(encoder.encode(JSON.stringify({
    type: 'level_result',
    data: { summary, results }
  }) + '\n'));

  return results;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const validatedData = concurrencyTestSchema.parse(body);

    const safeCustomHeaders = validatedData.customHeaders
      ? Object.fromEntries(
          Object.entries(validatedData.customHeaders).filter(
            ([key]) => key.toLowerCase() !== 'authorization'
          )
        )
      : undefined;

    const openai = new OpenAI({
      apiKey: validatedData.apiKey,
      baseURL: validatedData.baseUrl,
      ...(safeCustomHeaders && Object.keys(safeCustomHeaders).length > 0 ? {
        defaultHeaders: safeCustomHeaders as Record<string, string>,
      } : {}),
    });

    // Normalize into a list of concurrency levels (sorted ascending)
    let levels: number[];
    if (validatedData.concurrencyLevels && validatedData.concurrencyLevels.length > 0) {
      levels = [...new Set(validatedData.concurrencyLevels)].sort((a, b) => a - b);
    } else {
      levels = [validatedData.concurrency];
    }

    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      try {
        await writer.write(encoder.encode(JSON.stringify({
          type: 'start',
          data: { levels, totalLevels: levels.length, prompt: validatedData.prompt }
        }) + '\n'));

        const allLevelSummaries: Array<{
          level: number;
          levelIndex: number;
          totalRequests: number;
          successCount: number;
          failureCount: number;
          successRate: number;
          rps: number;
          avgLatencySec: number;
          p99LatencySec: number;
          avgTps: number;
          avgTtftSec: number;
          levelTotalTimeSec: number;
          totalOutputTokens: number;
        }> = [];

        const allLevelDetails: RequestResult[][] = [];

        for (let li = 0; li < levels.length; li++) {
          const level = levels[li];
          const results = await runConcurrencyLevel(
            openai,
            level,
            validatedData.modelId,
            validatedData.prompt,
            writer,
            encoder,
            li,
            levels.length,
            validatedData.maxFirstTokenLatency,
          );
          allLevelDetails.push(results);

          // Compute the summary here to push into the summary list for the final table
          const successResults = results.filter(r => r.success);
          const successCount = successResults.length;
          const failureCount = level - successCount;
          const successRate = level > 0 ? (successCount / level) * 100 : 0;
          const levelTotalTimeSec = (function () {
            // Re-derive from max totalTime (approximate; the runConcurrencyLevel already emitted this, but
            // we recompute for the summary collection so we don't have to await the writer event).
            const maxEnd = Math.max(...results.map(r => r.totalTime), 0);
            return maxEnd / 1000;
          })();

          // Recompute aggregated stats for the saved summary (mirror of runConcurrencyLevel)
          const latenciesMs = successResults.map(r => r.totalTime);
          const tpsValues = successResults.map(r => r.tokensPerSecond);
          const ttftsMs = successResults.map(r => r.firstTokenLatency);
          const latencyStats = calculateStats(latenciesMs);
          const ttftStats = calculateStats(ttftsMs);
          const tpsStats = calculateStats(tpsValues);
          const rps = levelTotalTimeSec > 0 ? successCount / levelTotalTimeSec : 0;

          allLevelSummaries.push({
            level,
            levelIndex: li,
            totalRequests: level,
            successCount,
            failureCount,
            successRate,
            rps,
            avgLatencySec: latencyStats.mean / 1000,
            p99LatencySec: latencyStats.p99 / 1000,
            avgTps: tpsStats.mean,
            avgTtftSec: ttftStats.mean / 1000,
            levelTotalTimeSec,
            totalOutputTokens: successResults.reduce((acc, r) => acc + r.outputToken, 0),
          });
        }

        // Best-config extraction (mirrors llm-benchmark's print_summary recommendations)
        let bestRpsIdx = 0;
        let bestLatencyIdx = 0;
        let bestTpsIdx = 0;
        for (let i = 1; i < allLevelSummaries.length; i++) {
          if (allLevelSummaries[i].rps > allLevelSummaries[bestRpsIdx].rps) bestRpsIdx = i;
          if (allLevelSummaries[i].avgLatencySec < allLevelSummaries[bestLatencyIdx].avgLatencySec) bestLatencyIdx = i;
          if (allLevelSummaries[i].avgTps > allLevelSummaries[bestTpsIdx].avgTps) bestTpsIdx = i;
        }
        const bestConfig = {
          bestRps: { level: allLevelSummaries[bestRpsIdx].level, value: allLevelSummaries[bestRpsIdx].rps },
          bestLatency: { level: allLevelSummaries[bestLatencyIdx].level, value: allLevelSummaries[bestLatencyIdx].avgLatencySec },
          bestTps: { level: allLevelSummaries[bestTpsIdx].level, value: allLevelSummaries[bestTpsIdx].avgTps },
        };

        await writer.write(encoder.encode(JSON.stringify({
          type: 'complete',
          data: { summaries: allLevelSummaries, details: allLevelDetails, best: bestConfig }
        }) + '\n'));

        await writer.close();
      } catch (error) {
        console.error('Error in concurrency test stream:', error);
        let errorMsg = error instanceof Error ? error.message : 'Unknown error';
        if (error && typeof error === 'object' && 'status' in error) {
          errorMsg = `HTTP ${(error as any).status}: ${errorMsg}`;
        }
        await writer.write(encoder.encode(JSON.stringify({ type: 'error', error: errorMsg }) + '\n'));
        await writer.close();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        's-maxage': '600',
        'Access-Control-Allow-Origin': '*'
      },
    });
  } catch (error) {
    console.error('Concurrency test error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    );
  }
}
