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

  const concurrentTasks = Array.from({ length: level }, (_, i) => (async () => {
    const requestId = i + 1;
    const startTime = performance.now();
    let firstTokenTime = 0;
    let content = '';

    try {
      const completion = await openai.chat.completions.create({
        model: modelId,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      });

      for await (const chunk of completion) {
        if (content.length === 0) {
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

      const totalTokens = estimateTokens(content);
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      const outputTime = totalTime - firstTokenTime;
      const tps = outputTime > 0 ? (totalTokens / outputTime) * 1000 : 0;
      const tpsTotal = totalTime > 0 ? (totalTokens / totalTime) * 1000 : 0;

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
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      const errMsg = err instanceof Error ? err.message : 'Unknown error';

      results[i] = {
        requestId,
        firstTokenLatency: firstTokenTime,
        tokensPerSecond: 0,
        tokensPerSecondTotal: 0,
        outputToken: estimateTokens(content),
        totalTime,
        outputTime: totalTime - firstTokenTime,
        content,
        success: false,
        error: errMsg,
      };
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
