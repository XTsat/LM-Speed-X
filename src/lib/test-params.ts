/**
 * 测试参数（提示词、次数、并发档位）的持久化。
 * 为什么单独一份：这些是用户每次都要重填的输入，和连接信息一样属于“上次用的配置”，
 * 但连接信息要广播给其它模块，这里只在各自组件内读写，不进 test-connection 的事件总线。
 */
export const TEST_PARAM_KEYS = {
  stabilityPrompt: 'speedtest_stability_prompt',
  stabilityCount: 'speedtest_stability_count',
  concurrencyPrompt: 'speedtest_concurrency_prompt',
  concurrencyLevels: 'speedtest_concurrency_levels',
} as const

export function readStoredText(key: string, fallback = ''): string {
  if (typeof window === 'undefined') return fallback
  return localStorage.getItem(key) ?? fallback
}

export function writeStoredText(key: string, value: string): void {
  if (typeof window === 'undefined') return
  if (value === '') {
    localStorage.removeItem(key)
    return
  }
  localStorage.setItem(key, value)
}
