import { NextResponse } from "next/server";
import { db } from "@/db";
import { speedTestsTable, speedTestResultsTable } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import { z } from "zod";
import { getQuery } from "ufo";

export interface TestResult {
  id: number;
  timestamp: string;
  baseUrl: string;
  avgTokensPerSecond: number;
  avgFirstTokenLatency: number;
  model: string;
}

const recentQuerySchema = z.object({
  host: z.string().optional(),
});

const saveResultSchema = z.object({
  timestamp: z.string(),
  baseUrl: z.string(),
  results: z.array(z.object({
    prompt: z.string(),
    model: z.string(),
    firstTokenLatency: z.number(),
    tokensPerSecond: z.number(),
    tokensPerSecondTotal: z.number(),
    outputToken: z.number(),
    totalTime: z.number(),
    outputTime: z.number(),
    content: z.string(),
  })),
})

export async function GET(request: Request) {
  try {
    // 如果数据库不可用，返回空数组
    if (!db) {
      return NextResponse.json({ recentTests: [] });
    }

    const searchParams = getQuery(request.url);

    const query = recentQuerySchema.parse({
      host: searchParams.host || undefined,
    });

    // 获取最近的 5 条测试记录，包含其详细结果
    const recentTests = await db
      .select({
        id: speedTestsTable.id,
        timestamp: speedTestsTable.timestamp,
        baseUrl: speedTestsTable.baseUrl,
        avgTokensPerSecond: sql<number>`AVG(${speedTestResultsTable.tokensPerSecond})`,
        avgFirstTokenLatency: sql<number>`AVG(${speedTestResultsTable.firstTokenLatency})`,
        model: speedTestResultsTable.model,
      })
      .from(speedTestsTable)
      .leftJoin(
        speedTestResultsTable,
        sql`${speedTestsTable.id} = ${speedTestResultsTable.speedTestId}`
      )
      .groupBy(
        speedTestsTable.id,
        speedTestsTable.timestamp,
        speedTestsTable.baseUrl,
        speedTestResultsTable.model
      )
      .orderBy(desc(speedTestsTable.timestamp))
      .where(
        query.host
          ? sql`${speedTestsTable.baseUrl} ILIKE ${`%${query.host}%`}`
          : sql`1=1`
      )
      .limit(5);

    return NextResponse.json({ recentTests });
  } catch (error) {
    console.error("Error fetching recent tests:", error);
    return NextResponse.json(
      { error: "Failed to fetch recent tests" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    if (!db) {
      return NextResponse.json({ success: false, error: 'Database unavailable' }, { status: 503 })
    }

    const body = await request.json()
    const validated = saveResultSchema.parse(body)

    const [speedTest] = await db.insert(speedTestsTable)
      .values({
        timestamp: new Date(validated.timestamp),
        baseUrl: validated.baseUrl,
      })
      .returning()

    await db.insert(speedTestResultsTable)
      .values(validated.results.map((r) => ({
        speedTestId: speedTest.id,
        prompt: r.prompt,
        model: r.model,
        firstTokenLatency: r.firstTokenLatency,
        tokensPerSecond: r.tokensPerSecond,
        tokensPerSecondTotal: r.tokensPerSecondTotal,
        outputToken: r.outputToken,
        totalTime: r.totalTime,
        outputTime: r.outputTime,
        content: r.content,
      })))

    return NextResponse.json({ success: true, id: speedTest.id })
  } catch (error) {
    console.error('Error saving test result:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
