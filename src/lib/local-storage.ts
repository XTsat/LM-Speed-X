export interface SpeedTestResult {
  id: string;
  timestamp: string;
  baseUrl: string;
  results: TestResult[];
}

export interface TestResult {
  prompt: string;
  model: string;
  firstTokenLatency: number;
  tokensPerSecond: number;
  tokensPerSecondTotal: number;
  outputToken: number;
  totalTime: number;
  outputTime: number;
  content: string;
}

const STORAGE_KEY = 'lm-speed-test-results';

/**
 * 单条测试记录约 1.3–14KB（取决于回复长度），
 * 500 条上限在 5MB 配额下留有充足余量（最坏情况长回复也仅 ~370 条/5MB）。
 */
const MAX_STORED_RESULTS = 500;

/** 排序：最旧在前（时间升序） */
function sortByTimestampAsc(a: SpeedTestResult, b: SpeedTestResult): number {
  return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
}

/** 超出上限时淘汰最旧记录，最多保留 MAX_STORED_RESULTS 条 */
function trimToLimit(results: SpeedTestResult[]): SpeedTestResult[] {
  if (results.length <= MAX_STORED_RESULTS) return results;
  return [...results].sort(sortByTimestampAsc).slice(-MAX_STORED_RESULTS);
}

/**
 * 写入 localStorage。若触发 QuotaExceededError（存储配额不足），
 * 自动不断淘汰最旧的一半记录后重试，直到成功或无可淘汰。
 */
function persistResults(results: SpeedTestResult[]): void {
  let current = trimToLimit(results);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    return;
  } catch (error) {
    console.warn('Storage quota exceeded, trimming oldest results:', error);
  }

  // QuotaExceededError：淘汰最旧一半后重试，直到成功或清空
  while (current.length > 0) {
    current = current.slice(Math.floor(current.length / 2));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      return;
    } catch (error) {
      // continue trimming
    }
  }
  console.error('Unable to save test results: storage quota exceeded');
}

export function saveTestResult(result: SpeedTestResult): void {
  const existing = getTestResults();
  existing.push(result);
  persistResults(existing);
}

export function getTestResults(): SpeedTestResult[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error getting test results:', error);
    return [];
  }
}

export function getRecentTests(limit: number = 5): SpeedTestResult[] {
  const results = getTestResults();
  return results
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

export function getProviders(): string[] {
  const results = getTestResults();
  const hosts = new Set<string>();
  
  results.forEach(result => {
    try {
      const url = new URL(result.baseUrl);
      hosts.add(url.host);
    } catch {
      hosts.add(result.baseUrl);
    }
  });
  
  return Array.from(hosts);
}

export function deleteTestResult(id: string): void {
  const existing = getTestResults();
  const filtered = existing.filter(r => r.id !== id);
  persistResults(filtered);
}
