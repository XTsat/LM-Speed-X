import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';

const stabilityTestSchema = z.object({
  baseUrl: z.string().url('Please enter a valid URL'),
  apiKey: z.string().min(1, 'API Key is required'),
  modelId: z.string().min(1, 'Model ID is required'),
  prompt: z.string().min(1, 'Prompt is required'),
  count: z.number()
    .int('Count must be an integer')
    .min(3, 'Minimum count is 3')
    .max(50, 'Maximum count is 50')
    .default(10),
  customHeaders: z.record(z.string(), z.string()).optional(),
});

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function calculateStats(values: number[]) {
  const n = values.length;
  if (n === 0) return { mean: 0, stdDev: 0, min: 0, max: 0, variance: 0, median: 0 };

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

  return { mean, stdDev, min, max, variance, median };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const validatedData = stabilityTestSchema.parse(body);

    const safeCustomHeaders = validatedData.customHeaders
      ? Object.fromEntries(
          Object.entries(validatedData.customHeaders)
            .filter(([key]) => key.toLowerCase() !== 'authorization')
            .map(([key, value]) => [key, String(value)] as const)
        ) as Record<string, string>
      : undefined;

    const openai = new OpenAI({
      apiKey: validatedData.apiKey,
      baseURL: validatedData.baseUrl,
      ...(safeCustomHeaders && Object.keys(safeCustomHeaders).length > 0 ? {
        defaultHeaders: safeCustomHeaders,
      } : {}),
    });

    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      try {
        const iterationResults: Array<{
          iteration: number;
          firstTokenLatency: number;
          tokensPerSecond: number;
          tokensPerSecondTotal: number;
          outputToken: number;
          totalTime: number;
          outputTime: number;
          content: string;
        }> = [];

        for (let i = 0; i < validatedData.count; i++) {
          const startTime = performance.now();
          let firstTokenTime = 0;
          let content = '';

          await writer.write(encoder.encode(JSON.stringify({
            type: 'start',
            data: { iteration: i + 1, total: validatedData.count, prompt: validatedData.prompt }
          }) + '\n'));

          const completion = await openai.chat.completions.create({
            model: validatedData.modelId,
            messages: [{ role: "user", content: validatedData.prompt }],
            stream: true,
          });

          for await (const chunk of completion) {
            if (content.length === 0) {
              firstTokenTime = performance.now() - startTime;
            }
            if (chunk.choices[0]?.delta?.content) {
              content += chunk.choices[0].delta.content;

              // Stream real-time metrics during iteration
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
                  iteration: i + 1,
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

          const result = {
            iteration: i + 1,
            firstTokenLatency: firstTokenTime,
            tokensPerSecond: tps,
            tokensPerSecondTotal: tpsTotal,
            outputToken: totalTokens,
            totalTime,
            outputTime,
            content,
          };

          iterationResults.push(result);

          await writer.write(encoder.encode(JSON.stringify({
            type: 'result',
            data: result
          }) + '\n'));
        }

        // Calculate comprehensive statistics
        const firstTokenLatencies = iterationResults.map(r => r.firstTokenLatency);
        const tokensPerSeconds = iterationResults.map(r => r.tokensPerSecond);
        const totalTimes = iterationResults.map(r => r.totalTime);
        const outputTokens = iterationResults.map(r => r.outputToken);

        const stats = {
          firstTokenLatency: calculateStats(firstTokenLatencies),
          tokensPerSecond: calculateStats(tokensPerSeconds),
          totalTime: calculateStats(totalTimes),
          outputToken: calculateStats(outputTokens),
        };

        await writer.write(encoder.encode(JSON.stringify({
          type: 'complete',
          data: { results: iterationResults, stats }
        }) + '\n'));

        await writer.close();
      } catch (error) {
        console.error('Error in stability test stream:', error);
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
    console.error('Stability test error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    );
  }
}
