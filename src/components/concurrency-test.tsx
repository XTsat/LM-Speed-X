'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Loader2, BarChart3, TrendingUp, Zap } from 'lucide-react'
import { isLocalUrl, runBrowserStreamedChat } from '@/lib/browser-llm'

// ── Types ──

interface RequestResult {
  requestId: number
  firstTokenLatency: number
  tokensPerSecond: number
  tokensPerSecondTotal: number
  outputToken: number
  totalTime: number
  outputTime: number
  content: string
  success: boolean
  error?: string
}

interface RequestStatus extends RequestResult {
  status: 'pending' | 'running' | 'completed' | 'failed'
}

// llm-benchmark style per-level summary row
interface LevelSummary {
  level: number
  levelIndex: number
  totalRequests: number
  successCount: number
  failureCount: number
  successRate: number
  rps: number
  avgLatencySec: number
  p99LatencySec: number
  avgTps: number
  avgTtftSec: number
  levelTotalTimeSec: number
  totalOutputTokens: number
}

interface BestConfig {
  bestRps: { level: number; value: number }
  bestLatency: { level: number; value: number }
  bestTps: { level: number; value: number }
}

interface ConcurrencyResults {
  summaries: LevelSummary[]
  details: RequestResult[][]
  best: BestConfig
}

// ── Helpers ──

const formatSec = (s: number) => `${s.toFixed(3)}s`
const formatTps = (tps: number) => `${tps.toFixed(2)} t/s`
const formatRps = (rps: number) => `${rps.toFixed(2)}`

// Row color by success rate (matches llm-benchmark run_benchmarks.py: >=95 green, >=80 yellow, else red)
function rowColorClass(successRate: number): string {
  if (successRate >= 95) return 'text-green-400'
  if (successRate >= 80) return 'text-yellow-400'
  return 'text-red-400'
}
function rowBgClass(successRate: number): string {
  if (successRate >= 95) return 'bg-green-900/20'
  if (successRate >= 80) return 'bg-yellow-900/20'
  return 'bg-red-900/20'
}

// ── Component ──

export function ConcurrencyTest() {
const t = useTranslations('ConcurrencyTest')
const tSpeed = useTranslations('SpeedTest')
const tRank = useTranslations('rank')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<ConcurrencyResults | null>(null)
  const [prompt, setPrompt] = useState('Explain the concept of quantum computing in simple terms.')
  // Multi-level concurrency input: free-text comma separated, parsed to a sorted unique integer list
  const [concurrencyLevelsText, setConcurrencyLevelsText] = useState('1, 5, 10, 20')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [modelId, setModelId] = useState('')
  const [maxFirstTokenLatency, setMaxFirstTokenLatency] = useState<number | ''>('')
  const [useBrowserDirect, setUseBrowserDirect] = useState(false)

  // Live per-level request status cards
  const [activeLevel, setActiveLevel] = useState<number | null>(null)
  const [activeLevelRequests, setActiveLevelRequests] = useState<RequestStatus[]>([])
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null)
  const [streamContents, setStreamContents] = useState<{ [key: number]: string }>({})
  const contentRef = useRef<{ [key: number]: string }>({})

  // Read connection config from localStorage (synced from SpeedTestForm above)
  useEffect(() => {
    setBaseUrl(localStorage.getItem('speedtest_baseUrl') || '')
    setApiKey(localStorage.getItem('speedtest_apiKey') || '')
    setModelId(localStorage.getItem('speedtest_modelId') || '')
    const storedBrowserDirect = localStorage.getItem('speedtest_browserDirect')
    const baseUrl = localStorage.getItem('speedtest_baseUrl') || ''
    if (storedBrowserDirect !== null) {
      setUseBrowserDirect(storedBrowserDirect === 'true')
    } else if (baseUrl && isLocalUrl(baseUrl)) {
      setUseBrowserDirect(true)
      localStorage.setItem('speedtest_browserDirect', 'true')
    }
  }, [])

  // Re-sync when SpeedTestForm saves new values
  useEffect(() => {
    const handleStorage = () => {
      setBaseUrl(localStorage.getItem('speedtest_baseUrl') || '')
      setApiKey(localStorage.getItem('speedtest_apiKey') || '')
      setModelId(localStorage.getItem('speedtest_modelId') || '')
      const bd = localStorage.getItem('speedtest_browserDirect')
      if (bd !== null) setUseBrowserDirect(bd === 'true')
    }
    window.addEventListener('storage', handleStorage)
    const interval = setInterval(handleStorage, 500)
    return () => {
      window.removeEventListener('storage', handleStorage)
      clearInterval(interval)
    }
  }, [])

  // Parse the comma-separated concurrency levels text into a sorted unique integer list
  const parseLevels = useCallback((text: string): number[] => {
    const parts = text.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    const nums = parts.map(p => parseInt(p, 10)).filter(n => !isNaN(n) && n >= 1 && n <= 200)
    return [...new Set(nums)].sort((a, b) => a - b)
  }, [])

  const onSubmit = useCallback(async () => {
    const liveBaseUrl = localStorage.getItem('speedtest_baseUrl') || ''
    const liveApiKey = localStorage.getItem('speedtest_apiKey') || ''
    const liveModelId = localStorage.getItem('speedtest_modelId') || ''
    setBaseUrl(liveBaseUrl)
    setApiKey(liveApiKey)
    setModelId(liveModelId)

    if (!liveBaseUrl || !liveApiKey || !liveModelId) {
      toast.error(t('errors.noConfig'))
      return
    }

    const levels = parseLevels(concurrencyLevelsText)
    if (levels.length === 0) {
      toast.error(t('errors.invalidLevels'))
      return
    }

    try {
      setLoading(true)
      setProgress(0)
      setResults(null)
      contentRef.current = {}

      // Clear live cards
      setActiveLevel(null)
      setActiveLevelRequests([])
      setExpandedRequest(null)
      setStreamContents({})

const response = await fetch('/api/speed/concurrency', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
            baseUrl: liveBaseUrl, apiKey: liveApiKey, modelId: liveModelId, prompt, concurrencyLevels: levels,
            ...(maxFirstTokenLatency !== '' && maxFirstTokenLatency > 0 ? { maxFirstTokenLatency } : {}),
            }),
          })

      if (!response.ok) {
        let errorMsg = `Failed to run concurrency test (${response.status})`
        try {
          const errorData = await response.json()
          if (errorData?.error) errorMsg = errorData.error
        } catch { /* ignore */ }
        throw new Error(errorMsg)
      }

      if (!response.body) throw new Error('No response body from server')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let updateTimer: number | null = null
      let totalLevels = levels.length

      // Periodic UI sync for streaming content
      const startPeriodicUpdate = () => {
        updateTimer = window.setInterval(() => {
          setStreamContents({ ...contentRef.current })
        }, 50) as unknown as number
      }
      startPeriodicUpdate()

      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n').filter(Boolean)

          for (const line of lines) {
    if (useBrowserDirect) {
      setLoading(true)
      setProgress(0)
      setResults(null)
      contentRef.current = {}
      setActiveLevel(null)
      setActiveLevelRequests([])
      setExpandedRequest(null)
      setStreamContents({})

      const allSummaries: LevelSummary[] = []
      const allDetails: RequestResult[][] = []

      const startPeriodicUpdate = () => {
        const timer = window.setInterval(() => setStreamContents({ ...contentRef.current }), 50)
        return timer
      }
      const timer = startPeriodicUpdate()

      try {
        for (let li = 0; li < levels.length; li++) {
          const level = levels[li]
          setActiveLevel(level)
          const init: RequestStatus[] = Array.from({ length: level }, (_, i) => ({
            requestId: i + 1, status: 'running' as const,
            firstTokenLatency: 0, tokensPerSecond: 0, tokensPerSecondTotal: 0,
            outputToken: 0, totalTime: 0, outputTime: 0, content: '', success: false,
          }))
          setActiveLevelRequests(init)
          contentRef.current = {}
          setStreamContents({})
          setExpandedRequest(null)

          const levelStartTime = performance.now()
          const tasks = Array.from({ length: level }, (_, i) =>
            runBrowserStreamedChat(liveBaseUrl, liveApiKey, liveModelId,
              [{ role: 'user' as const, content: prompt }], i, prompt,
              {
                onContent: (cd) => {
                  contentRef.current[cd.index] = (contentRef.current[cd.index] || '') + cd.content
                  setActiveLevelRequests(prev => {
                    const next = [...prev]
                    if (next[cd.index]) {
                      next[cd.index] = { ...next[cd.index],
                        tokensPerSecond: cd.currentSpeed, tokensPerSecondTotal: cd.currentTotalSpeed,
                        outputToken: cd.currentTokens, outputTime: cd.elapsedTime }
                    }
                    return next
                  })
                },
              }
            ).then(r => {
              setActiveLevelRequests(prev => {
                const next = [...prev]
                const ri = r.index ?? i
                next[ri] = { ...r, status: 'completed' as const, success: true }
                return next
              })
              return { ...r, success: true } as RequestResult
            }).catch(err => {
              setActiveLevelRequests(prev => {
                const next = [...prev]
                next[i] = { ...next[i], status: 'failed' as const, success: false, error: err instanceof Error ? err.message : String(err) }
                return next
              })
              return { requestId: i + 1, firstTokenLatency: 0, tokensPerSecond: 0, tokensPerSecondTotal: 0, outputToken: 0, totalTime: 0, outputTime: 0, content: '', success: false, error: err instanceof Error ? err.message : String(err), index: i, prompt, model: liveModelId } as unknown as RequestResult
            })
          )

          const results = await Promise.all(tasks)
          allDetails.push(results)

          const levelEndTime = performance.now()
          const levelTotalTimeSec = (levelEndTime - levelStartTime) / 1000
          const successResults = results.filter(r => r.success)
          const successCount = successResults.length
          const failureCount = level - successCount
          const successRate = level > 0 ? (successCount / level) * 100 : 0
          const rps = levelTotalTimeSec > 0 ? successCount / levelTotalTimeSec : 0

          function calcStats(vals: number[]) {
            if (vals.length === 0) return { mean: 0, stdDev: 0, min: 0, max: 0, variance: 0, median: 0, p99: 0 }
            const sorted = [...vals].sort((a, b) => a - b)
            const sum = sorted.reduce((a, v) => a + v, 0)
            const mean = sum / vals.length
            const median = vals.length % 2 === 0 ? (sorted[vals.length / 2 - 1] + sorted[vals.length / 2]) / 2 : sorted[Math.floor(vals.length / 2)]
            const variance = sorted.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length
            const stdDev = Math.sqrt(variance)
            const p99 = vals.length >= 2 ? sorted[Math.min(vals.length - 1, Math.max(0, Math.ceil(0.99 * vals.length) - 1))] : sorted[vals.length - 1]
            return { mean, stdDev, min: sorted[0], max: sorted[vals.length - 1], variance, median, p99 }
          }

          const latenciesMs = successResults.map(r => r.totalTime)
          const tpsVals = successResults.map(r => r.tokensPerSecond)
          const ttftsMs = successResults.map(r => r.firstTokenLatency)
          const latencyStats = calcStats(latenciesMs)
          const ttftStats = calcStats(ttftsMs)
          const tpsStats = calcStats(tpsVals)

          const summary: LevelSummary = {
            level, levelIndex: li, totalRequests: level,
            successCount, failureCount, successRate, rps,
            avgLatencySec: latencyStats.mean / 1000, p99LatencySec: latencyStats.p99 / 1000,
            avgTps: tpsStats.mean, avgTtftSec: ttftStats.mean / 1000,
            levelTotalTimeSec, totalOutputTokens: successResults.reduce((a, r) => a + r.outputToken, 0),
          }
          allSummaries.push(summary)
          setProgress(((li + 1) / levels.length) * 100)
        }

        // Compute best config
        let bestRpsIdx = 0, bestLatencyIdx = 0, bestTpsIdx = 0
        for (let i = 1; i < allSummaries.length; i++) {
          if (allSummaries[i].rps > allSummaries[bestRpsIdx].rps) bestRpsIdx = i
          if (allSummaries[i].avgLatencySec < allSummaries[bestLatencyIdx].avgLatencySec) bestLatencyIdx = i
          if (allSummaries[i].avgTps > allSummaries[bestTpsIdx].avgTps) bestTpsIdx = i
        }
        const best: BestConfig = {
          bestRps: { level: allSummaries[bestRpsIdx].level, value: allSummaries[bestRpsIdx].rps },
          bestLatency: { level: allSummaries[bestLatencyIdx].level, value: allSummaries[bestLatencyIdx].avgLatencySec },
          bestTps: { level: allSummaries[bestTpsIdx].level, value: allSummaries[bestTpsIdx].avgTps },
        }

        setResults({ summaries: allSummaries, details: allDetails, best })
        setProgress(100)
        setActiveLevel(null)
        toast.success(t('complete'))
      } catch (error) {
        console.error('Browser direct concurrency error:', error)
        toast.error(error instanceof Error ? error.message : t('errors.unknown'), { duration: 30000 })
      } finally {
        clearInterval(timer)
        setLoading(false)
      }
      return
    }

    // ── Server proxy SSE path ──
    try {
              const message = JSON.parse(line)

              switch (message.type) {
                case 'start': {
                  totalLevels = message.data.totalLevels || levels.length
                  setProgress(0)
                  break
                }
                case 'level_start': {
                  const li: number = message.data.levelIndex
                  const lvl: number = message.data.level
                  setActiveLevel(lvl)
                  // Init request cards for this level all to 'running'
                  const init: RequestStatus[] = Array.from({ length: lvl }, (_, i): RequestStatus => ({
                    requestId: i + 1,
                    status: 'running' as const,
                    firstTokenLatency: 0,
                    tokensPerSecond: 0,
                    tokensPerSecondTotal: 0,
                    outputToken: 0,
                    totalTime: 0,
                    outputTime: 0,
                    content: '',
                    success: false,
                  }))
                  setActiveLevelRequests(init)
                  contentRef.current = {}
                  setStreamContents({})
                  setExpandedRequest(null)
                  break
                }
                case 'content': {
                  const ri: number = message.data.requestId - 1
                  contentRef.current[ri] = (contentRef.current[ri] || '') + message.data.content
                  setActiveLevelRequests(prev => {
                    const next = [...prev]
                    if (next[ri]) {
                      next[ri] = {
                        ...next[ri],
                        tokensPerSecond: message.data.currentSpeed || next[ri].tokensPerSecond,
                        tokensPerSecondTotal: message.data.currentTotalSpeed || next[ri].tokensPerSecondTotal,
                        outputToken: message.data.currentTokens || next[ri].outputToken,
                        outputTime: message.data.elapsedTime || next[ri].outputTime,
                      }
                    }
                    return next
                  })
                  break
                }
                case 'level_result': {
                  // Finalize per-request cards from the server-side result list, then advance progress
                  const li: number = message.data.summary.levelIndex
                  const rs: RequestResult[] = message.data.results
                  setActiveLevelRequests(prev => prev.map((r, idx) => {
                    const fresh = rs[idx]
                    if (!fresh) return r
                    return {
                      ...r,
                      ...fresh,
                      status: fresh.success === false ? 'failed' as const : 'completed' as const,
                    }
                  }))
                  setProgress(((li + 1) / totalLevels) * 100)
                  break
                }
                case 'complete':
                  setResults(message.data)
                  setProgress(100)
                  setActiveLevel(null)
                  toast.success(t('complete'))
                  break
                case 'error':
                  throw new Error(message.error)
              }
            } catch (error) {
              if (error instanceof SyntaxError) continue
              throw error
            }
          }
          buffer = lines[lines.length - 1]
            ? buffer.slice(buffer.lastIndexOf('\n') + 1)
            : buffer
        }
      } finally {
        if (updateTimer !== null) clearInterval(updateTimer)
      }
    } catch (error) {
      console.error('Concurrency test error:', error)
      toast.error(error instanceof Error ? error.message : t('errors.unknown'), { duration: 30000 })
    } finally {
      setLoading(false)
    }
  }, [prompt, concurrencyLevelsText, t, parseLevels])

  // ── Render ──

  return (
    <div className="container mx-auto px-4 sm:px-0">
      {/* ── Form ── */}
      <div className="bg-gray-50 p-4 sm:p-6 rounded-lg">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          {t('title')}
        </h2>

        <form onSubmit={(e) => { e.preventDefault(); onSubmit() }} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-gray-600">{t('prompt.label')}</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('prompt.placeholder')}
              rows={3}
              className="w-full p-2 border-2 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-600">{t('concurrencyLevels.label')}</label>
            <Input
              type="text"
              value={concurrencyLevelsText}
              onChange={(e) => setConcurrencyLevelsText(e.target.value)}
              placeholder={t('concurrencyLevels.placeholder')}
              className="w-full p-2 border-2 rounded-md bg-transparent text-gray-700"
            />
<p className="text-xs text-gray-400">{t('concurrencyLevels.hint')}</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm text-gray-600">{t('maxFirstTokenLatency.label')}</label>
                <Input
                  type="text"
                  value={maxFirstTokenLatency}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '') {
                      setMaxFirstTokenLatency('')
                      return
                    }
                    const n = parseInt(v, 10)
                    if (!isNaN(n) && n >= 1 && n <= 120000) setMaxFirstTokenLatency(n)
                  }}
                  placeholder={t('maxFirstTokenLatency.placeholder')}
                  className="w-full p-2 border-2 rounded-md bg-transparent text-gray-700"
                />
                <p className="text-xs text-gray-400">{t('maxFirstTokenLatency.hint')}</p>
              </div>

          {/* Connection info (read-only) */}
          {(baseUrl || modelId) && (
            <div className="text-xs text-gray-400 space-y-1 p-3 bg-white rounded-md border border-gray-200">
              <p><span className="text-gray-500">{t('connection.baseUrl')}:</span> <span className="text-gray-700">{baseUrl || '-'}</span></p>
              <p><span className="text-gray-500">{t('connection.apiKey')}:</span> <span className="text-gray-700">{apiKey ? '••••••' + apiKey.slice(-4) : '-'}</span></p>
              <p><span className="text-gray-500">{t('connection.modelId')}:</span> <span className="text-gray-700">{modelId || '-'}</span></p>
            </div>
          )}

          <Button type="submit" disabled={loading || !prompt.trim()} className="w-full py-2 shadow-none transition-colors">
            {loading ? (
              <div className="flex items-center justify-center space-x-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t('running')}</span>
                <span>{progress.toFixed(0)}%</span>
              </div>
            ) : t('submit')}
          </Button>
        </form>
      </div>

      {/* ── Summary (shown on top after completion) - llm-benchmark style comparison table ── */}
      {results && (
        <div className="mb-8">
          <div id="concurrency-summary" className="pt-6 px-6 pb-2 bg-[#17181C] rounded-lg">
            <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              <span>LM Speed X {t('summary.title')}</span>
            </h3>

            {/* Basic info row — Model + Base URL fixed at positions 1/2 */}
            <div className="text-sm font-normal mb-4 space-x-6 flex flex-wrap">
              <span className="text-gray-400 mr-2">{tRank('table.model')}:</span>
              <span className="text-white mr-8">{modelId || '-'}</span>
              <span className="text-gray-400 mr-2">{tRank('table.baseUrl')}:</span>
              <span className="text-white mr-8">{(() => { try { return new URL(baseUrl).host } catch { return baseUrl || '-' } })()}</span>
              <span className="text-gray-400 mr-2">{t('summary.levels')}:</span>
              <span className="text-white mr-8">{results.summaries.length}</span>
              <span className="text-gray-400 mr-2">{t('summary.totalTokens')}:</span>
              <span className="text-white">{results.summaries.reduce((acc, s) => acc + s.totalOutputTokens, 0).toLocaleString()}</span>
            </div>

            {/* Comparison table (columns aligned with the requested benchmark format) */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-center py-2 px-3 text-gray-400 font-medium">{t('benchmark.concurrency')}</th>
                    <th className="text-center py-2 px-3 text-gray-400 font-medium">{t('benchmark.ttft')}</th>
                    <th className="text-center py-2 px-3 text-gray-400 font-medium">{t('benchmark.avgLatency')}</th>
                    <th className="text-center py-2 px-3 text-gray-400 font-medium">{t('benchmark.rps')}</th>
                    <th className="text-center py-2 px-3 text-gray-400 font-medium">{t('benchmark.avgTps')}</th>
                    <th className="text-center py-2 px-3 text-gray-400 font-medium">{t('benchmark.successTotal')}</th>
                    <th className="text-center py-2 px-3 text-gray-400 font-medium">{t('benchmark.successRate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.summaries.map((s) => (
                    <tr key={s.level} className={`border-b border-gray-800 ${rowBgClass(s.successRate)}`}>
                      <td className="text-center py-3 px-3 text-cyan-300 font-mono">{s.level}</td>
                      <td className="text-center py-3 px-3 text-gray-200 font-mono">{formatSec(s.avgTtftSec)}</td>
                      <td className="text-center py-3 px-3 text-gray-200 font-mono">{formatSec(s.avgLatencySec)}</td>
                      <td className="text-center py-3 px-3 text-white font-mono">{formatRps(s.rps)}</td>
                      <td className="text-center py-3 px-3 text-gray-200 font-mono">{formatTps(s.avgTps)}</td>
                      <td className="text-center py-3 px-3 text-gray-200 font-mono">{s.successCount}/{s.totalRequests}</td>
                      <td className={`text-center py-3 px-3 font-mono ${rowColorClass(s.successRate)}`}>{s.successRate.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Std dev hint */}
            <div className="mt-4 flex items-start gap-2 text-xs text-gray-400">
              <TrendingUp className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <p>{t('summary.stdDevHint')}</p>
            </div>

            {/* Best-config block (mirrors llm-benchmark "性能最佳配置") */}
            <div className="mt-4 pt-4 border-t border-gray-800">
              <h4 className="text-base font-semibold text-white mb-3">{t('best.title')}</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div className="p-3 bg-gray-900/40 rounded-md border border-gray-800">
                  <p className="text-gray-400">{t('best.bestRps')}</p>
                  <p className="text-white mt-1">
                    <span className="text-cyan-300">{t('benchmark.concurrency')} {results.best.bestRps.level}</span>
                    <span className="mx-2 text-gray-500">·</span>
                    <span className="font-mono">{formatRps(results.best.bestRps.value)} req/s</span>
                  </p>
                </div>
                <div className="p-3 bg-gray-900/40 rounded-md border border-gray-800">
                  <p className="text-gray-400">{t('best.bestLatency')}</p>
                  <p className="text-white mt-1">
                    <span className="text-cyan-300">{t('benchmark.concurrency')} {results.best.bestLatency.level}</span>
                    <span className="mx-2 text-gray-500">·</span>
                    <span className="font-mono">{formatSec(results.best.bestLatency.value)}</span>
                  </p>
                </div>
                <div className="p-3 bg-gray-900/40 rounded-md border border-gray-800">
                  <p className="text-gray-400">{t('best.bestTps')}</p>
                  <p className="text-white mt-1">
                    <span className="text-cyan-300">{t('benchmark.concurrency')} {results.best.bestTps.level}</span>
                    <span className="mx-2 text-gray-500">·</span>
                    <span className="font-mono">{formatTps(results.best.bestTps.value)}</span>
                  </p>
                </div>
              </div>
            </div>
            <a href="https://lm-speed-x.xtsat.cc.cd" target="_blank" rel="noopener noreferrer" className="block mt-1 text-right text-xs text-gray-600 hover:text-gray-400 transition-colors">lm-speed-x.xtsat.cc.cd</a>
          </div>

          {/* Per-level details (matching SpeedTest ResultsList style) */}
          {results.summaries.length > 0 && (
            <>
              <h2 className="w-full text-xl text-center font-bold mt-8 mb-4">{t('details.title')}</h2>
              <div className="space-y-8">
                {results.summaries.map((s, li) => {
                  const levelResults = results.details[li] || []
                  const levelKey = (rid: number) => `${li}-${rid - 1}`
                  return (
                    <div key={s.level} className="space-y-4">
                      <div className="p-4 rounded-lg bg-gray-100 border-l-4 border-cyan-400">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-gray-700 font-medium">
                              {t('details.level')} {s.level}
                              <span className="ml-3 text-gray-500 text-sm">({s.successCount}/{s.totalRequests} {t('status.completed')})</span>
                            </p>
                            <p className="text-gray-500 text-xs mt-1">
                              {t('connection.modelId')}: {modelId}
                            </p>
                          </div>
                          <div className="text-right text-sm">
                            <p className={rowColorClass(s.successRate)}>{s.successRate.toFixed(1)}% {t('benchmark.successRate')}</p>
                            <p className="text-gray-500">{formatRps(s.rps)} req/s</p>
                          </div>
                        </div>
                      </div>

                      {/* Single-request cards inside this level */}
                      <div className="space-y-6">
                        {levelResults.map((r) => (
                          <div
                            key={`${s.level}-${r.requestId}`}
                            onClick={() => setExpandedRequest(expandedRequest === levelKey(r.requestId) ? null : levelKey(r.requestId))}
                            className="p-4 rounded-lg bg-gray-200 cursor-pointer"
                          >
                            <div className="flex justify-between items-center">
                              <div className="flex-1">
                                <p className="text-gray-600 text-sm mb-2">
                                  {t('details.request')} {r.requestId}
                                </p>
                              </div>
                              <div className="ml-4">
                                {r.success ? (
                                  <span className="text-green-400">{t('status.completed')}</span>
                                ) : (
                                  <span className="text-red-400">{t('status.failed')}</span>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-row gap-12">
                              <div>
                                <p className="text-gray-600 text-sm">{t('details.firstTokenLatency')}</p>
                                <p className="text-gray-700">{(r.firstTokenLatency / 1000).toFixed(2)} s</p>
                              </div>
                              <div>
                                <p className="text-gray-600 text-sm">{t('details.totalTime')}</p>
                                <p className="text-gray-700">{(r.totalTime / 1000).toFixed(2)} s</p>
                              </div>
                              <div>
                                <p className="text-gray-600 text-sm">{tRank('table.avgTokens')}</p>
                                <p className="text-gray-700">{r.tokensPerSecond.toFixed(2)} t/s</p>
                              </div>
                              <div>
                                <p className="text-gray-600 text-sm">{tSpeed('results.metrics.outputToken')}</p>
                                <p className="text-gray-700">{r.outputToken} ({(r.outputTime / 1000).toFixed(2)}s)</p>
                              </div>
                            </div>

                            <div className={`max-h-96 overflow-y-auto mt-4 p-4 bg-white rounded-lg ${expandedRequest === levelKey(r.requestId) ? 'block' : 'hidden'}`}>
                              <div className="flex justify-between items-center mb-2">
                                <h4 className="text-gray-700 font-medium">{tSpeed('results.output.title')}:</h4>
                                <button onClick={(e) => { e.stopPropagation(); if (r.content) navigator.clipboard.writeText(r.content) }} className="text-xs text-gray-400 hover:text-gray-600 transition-colors shrink-0">{tSpeed('results.output.copy')}</button>
                              </div>
                              <div className="whitespace-pre-wrap font-mono text-sm">
                                {r.content || (r.error ? `${t('status.failed')}: ${r.error}` : '-')}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Active Level Request Cards (only visible during run, hidden after completion) ── */}
      {activeLevel !== null && !results && activeLevelRequests.length > 0 && (
        <div className="mt-8">
          <h3 className="text-xl text-center font-bold mb-4">
            {t('details.title')} — {t('details.level')} {activeLevel}
            <span className="ml-3 text-gray-500 text-base">({progress.toFixed(0)}%)</span>
          </h3>
          <div className="space-y-4">
            {activeLevelRequests.map((it, idx) => {
              const activeKey = `active-${idx}`
              return (
              <div
                key={idx}
                onClick={() => {
                  if (it.status !== 'pending') {
                    setExpandedRequest(expandedRequest === activeKey ? null : activeKey)
                  }
                }}
                className={`p-4 rounded-lg cursor-pointer ${
                  it.status === 'pending'
                    ? 'bg-gray-100 cursor-default'
                    : it.status === 'running'
                    ? 'bg-blue-50'
                    : it.status === 'failed'
                    ? 'bg-red-50'
                    : 'bg-gray-200'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div className="flex-1">
                    <p className="text-gray-600 text-sm mb-2">
                      {t('details.request')} {it.requestId}
                    </p>
                  </div>
                  <div className="ml-4">
                    {it.status === 'pending' && (
                      <span className="text-gray-500">{t('status.pending')}</span>
                    )}
                    {it.status === 'running' && (
                      <span className="text-blue-400 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {t('status.running')}
                      </span>
                    )}
                    {it.status === 'completed' && (
                      <span className="text-green-400">{t('status.completed')}</span>
                    )}
                    {it.status === 'failed' && (
                      <span className="text-red-400">{t('status.failed')}</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-row gap-12">
                  <div>
                    <p className="text-gray-600 text-sm">{t('details.firstTokenLatency')}</p>
                    <p className="text-gray-700">
                      {it.firstTokenLatency > 0 ? `${(it.firstTokenLatency / 1000).toFixed(2)} s` : '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600 text-sm">{t('details.totalTime')}</p>
                    <p className="text-gray-700">
                      {it.totalTime > 0 ? `${(it.totalTime / 1000).toFixed(2)} s` : '-'}
                    </p>
                  </div>
                    <div>
                      <p className="text-gray-600 text-sm">{tRank('table.avgTokens')}</p>
                      <p className="text-gray-700">
                        {it.tokensPerSecond > 0 ? `${it.tokensPerSecond.toFixed(2)} t/s` : '-'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-sm">{tSpeed('results.metrics.outputToken')}</p>
                      <p className="text-gray-700">
                        {it.outputToken > 0 ? `${it.outputToken} (${(it.outputTime / 1000).toFixed(2)}s)` : '-'}
                      </p>
                    </div>
                  </div>

                <div className={`max-h-96 overflow-y-auto mt-4 p-4 bg-white rounded-lg ${expandedRequest === activeKey ? 'block' : 'hidden'}`}>
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-gray-700 font-medium">{tSpeed('results.output.title')}:</h4>
                    <button onClick={(e) => { e.stopPropagation(); const text = streamContents[idx]; if (text) navigator.clipboard.writeText(text) }} className="text-xs text-gray-400 hover:text-gray-600 transition-colors shrink-0">{tSpeed('results.output.copy')}</button>
                  </div>
                  <div className="whitespace-pre-wrap font-mono text-sm">
                    {streamContents[idx] || '-'}
                  </div>
                </div>
              </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
