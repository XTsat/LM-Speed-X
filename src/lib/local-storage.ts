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

export function saveTestResult(result: SpeedTestResult): void {
  try {
    const existing = getTestResults();
    existing.push(result);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch (error) {
    console.error('Error saving test result:', error);
  }
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
  try {
    const existing = getTestResults();
    const filtered = existing.filter(r => r.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error deleting test result:', error);
  }
}
