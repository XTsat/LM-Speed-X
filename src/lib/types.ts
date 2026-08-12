// 单个 prompt 测试结果类型(从 src/db/schema.ts 迁移,原 schema 已随数据库移除)
export interface SpeedTestResult {
  prompt: string;
  model: string;
  firstTokenLatency: number;
  tokensPerSecond: number;
  tokensPerSecondTotal: number;
  outputToken: number;
  totalTime: number;
  outputTime: number;
  content?: string;
}
