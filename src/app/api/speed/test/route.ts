import { NextResponse } from 'next/server';
import { speedTestSchema } from '@/lib/schema';
import OpenAI from 'openai';
import { db } from '@/db';
import { speedTestResultSchema, speedTestsTable, speedTestResultsTable } from '@/db/schema';

const TEST_PROMPTS = [
  "Explain the concept of quantum computing in simple terms.",
  "Write a short story about a robot learning to paint.",
  "What are the main differences between REST and GraphQL?",
  "Describe the taste of your favorite food.",
  "How does photosynthesis work?"
];

// Simple token estimation function using character count
// This is a fallback when tiktoken is not available
function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Validate input
    const validatedData = speedTestSchema.parse(body);
    
    // Create OpenAI client with optional custom headers
    // Filter out 'Authorization' and 'authorization' to avoid overriding the API key
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
        defaultHeaders: safeCustomHeaders,
      } : {}),
    });

    // Create a TransformStream for streaming the results
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    // Process prompts in background
    const timestamp = new Date().toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = [];

    (async () => {
      try {
        for (let i = 0; i < TEST_PROMPTS.length; i++) {
          const prompt = TEST_PROMPTS[i];
          console.log(validatedData.modelId, prompt);
          const startTime = performance.now();
          let firstTokenTime = 0;
          let totalTokens = 0;
          let content = '';
          
          const completion = await openai.chat.completions.create({
            model: validatedData.modelId,
            messages: [{ role: "user", content: prompt }],
            stream: true,
          });

          // 发送开始标记
          await writer.write(encoder.encode(JSON.stringify({
            type: 'start',
            data: {
              prompt,
              model: validatedData.modelId,
              index: i
            }
          }) + '\n'));

          for await (const chunk of completion) {
            console.log(chunk)
            if (content.length === 0) {
              firstTokenTime = performance.now() - startTime;
            }
            if (chunk.choices[0]?.delta?.content) {
              
              const newContent = chunk.choices[0].delta.content;
              content += newContent;          
              
              // 计算实时速度指标
              const currentTime = performance.now();
              const elapsedTime = currentTime - startTime;
              const currentTokens = estimateTokens(content);
              const currentSpeed = currentTokens > 0 ? (currentTokens / (elapsedTime - firstTokenTime)) * 1000 : 0;
              const currentTotalSpeed = currentTokens > 0 ? (currentTokens / elapsedTime) * 1000 : 0;

              // 实时发送内容和速度更新
              await writer.write(encoder.encode(JSON.stringify({
                type: 'content',
                data: {
                  index: i,
                  content: chunk.choices[0].delta.content,
                  currentSpeed,
                  currentTotalSpeed,
                  currentTokens,
                  elapsedTime
                }
              }) + '\n'));
            }
          }

          totalTokens = estimateTokens(content);
          const endTime = performance.now();
          const totalTime = endTime - startTime;
          const outputTime = totalTime - firstTokenTime;
          const result = {
            prompt,
            model: validatedData.modelId,
            firstTokenLatency: firstTokenTime,
            tokensPerSecond: (totalTokens / outputTime) * 1000,
            tokensPerSecondTotal: (totalTokens / totalTime) * 1000,
            outputToken: totalTokens,
            outputTime,
            totalTime,
            content,
            index: i
          };
          
          results.push(result);
          
          // 发送完成标记
          await writer.write(encoder.encode(JSON.stringify({ type: 'result', data: result }) + '\n'));

        }

        // Save results to database (optional - skip if database is unavailable)
        if (db) {
          const resultsWithMeta = {
            timestamp,
            baseUrl: validatedData.baseUrl,
            results
          };

          try {
            // Validate data with Zod schema
            const validatedSpeedTest = speedTestResultSchema.parse(resultsWithMeta);

            // Insert main speed test record
            const [speedTest] = await db.insert(speedTestsTable)
              .values({
                timestamp: new Date(validatedSpeedTest.timestamp),
                baseUrl: validatedSpeedTest.baseUrl
              })
              .returning();

            // Insert individual test results
            await db.insert(speedTestResultsTable)
              .values(validatedSpeedTest.results.map(result => ({
                speedTestId: speedTest.id,
                prompt: result.prompt,
                model: result.model,
                firstTokenLatency: result.firstTokenLatency,
                tokensPerSecond: result.tokensPerSecond,
                tokensPerSecondTotal: result.tokensPerSecondTotal,
                outputToken: result.outputToken,
                totalTime: result.totalTime,
                outputTime: result.outputTime,
                content: result.content
              })));

            console.log('Results saved to database');
          } catch (error) {
            console.error('Error saving results to database (continuing without saving):', error);
            // Don't throw error, just log it and continue
          }
        } else {
          console.log('Database not available, skipping save');
        }

        // Close the stream
        await writer.write(encoder.encode(JSON.stringify({ type: 'complete', data: results }) + '\n'));
        await writer.close();
      } catch (error) {
        console.error('Error in stream:', error);
        // 尝试获取更详细的错误信息
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
    console.error('Speed test error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    );
  }
}