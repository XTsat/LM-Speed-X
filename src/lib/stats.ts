export interface StatsResult {
  mean: number
  stdDev: number
  min: number
  max: number
  variance: number
  median: number
}

/** 总体标准差（除以 n），与服务端统计口径保持一致，否则前后端口径不同会出现数值跳变 */
export function calculateStats(values: number[]): StatsResult {
  const n = values.length
  if (n === 0) return { mean: 0, stdDev: 0, min: 0, max: 0, variance: 0, median: 0 }

  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  const mean = sum / n
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)]
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n
  const stdDev = Math.sqrt(variance)

  return { mean, stdDev, min: sorted[0], max: sorted[n - 1], variance, median }
}
