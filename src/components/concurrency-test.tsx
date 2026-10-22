'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Loader2, BarChart3, TrendingUp, Zap, ChevronDown } from 'lucide-react'
import { RequestTimeoutError, runBrowserStreamedChat } from '@/lib/browser-llm'
import {
  REQUEST_TIMEOUT_MS,
  directRequestOptions,
  missingConnectionFields,
  proxyRequestBody,
  resolveConnection,
  useStoredConnection,
  writeConnection,
} from '@/lib/test-connection'
import { copyToClipboard } from '@/lib/clipboard'
import { COLLAPSE_BAR_CLASS, COLLAPSE_ITEM_CLASS, CollapsiblePanel } from './collapsible-panel'
import { ResultBody } from './result-body'
import { cn } from '@/lib/utils'

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
  const [maxFirstTokenLatency, setMaxFirstTokenLatency] = useState<number | ''>('')
  // 连接配置与测速表单共用一份（含直连开关、自定义请求头、自动补全开关）
  const stored = useStoredConnection()
  const connection = useMemo(() => resolveConnection({ stored }), [stored])
  const { baseUrl, apiKey, modelId } = connection
  // 运行中已等待秒数：并发要整轮跑完才出结果，没有这个提示时看起来像卡死
  const [waitedSeconds, setWaitedSeconds] = useState(0)

  // Live per-level request status cards
  // 结果明细默认展开、每个档位默认折叠：档位内请求数随并发数增长，全部展开页面会很长
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [openLevels, setOpenLevels] = useState<{ [key: number]: boolean }>({})
  const [activeLevel, setActiveLevel] = useState<number | null>(null)
  const [activeLevelRequests, setActiveLevelRequests] = useState<RequestStatus[]>([])
  // 总览面板、过程中的明细同样可折叠：测试跑起来后结果会长到屏幕以外
  const [summaryOpen, setSummaryOpen] = useState(true)
  const [liveOpen, setLiveOpen] = useState(true)
  const [liveLevelOpen, setLiveLevelOpen] = useState(true)
  // 已完成的单次请求 / 进行中的单次请求各自记录展开状态，两者 key 空间不同
  const [openRequests, setOpenRequests] = useState<{ [key: string]: boolean }>({})
  const [openActive, setOpenActive] = useState<{ [key: number]: boolean }>({})
  const [streamContents, setStreamContents] = useState<{ [key: number]: string }>({})
  const contentRef = useRef<{ [key: number]: string }>({})

  useEffect(() => {
    if (!loading) {
      setWaitedSeconds(0)
      return
    }
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      setWaitedSeconds(Math.round((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [loading])

  /** 单次请求失败原因：超时类给出本地化文案，其它沿用原始 message */
  const failureMessage = useCallback((error: unknown): string => {
    if (error instanceof RequestTimeoutError) {
      const seconds = (error.limitMs / 1000).toFixed(0)
      return error.kind === 'timeout'
        ? t('errors.timeout', { seconds })
        : t('errors.firstTokenTimeout', { seconds })
    }
    return error instanceof Error ? error.message : t('errors.unknown')
  }, [t])

  // Parse the comma-separated concurrency levels text into a sorted unique integer list
  const parseLevels = useCallback((text: string): number[] => {
    const parts = text.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    const nums = parts.map(p => parseInt(p, 10)).filter(n => !isNaN(n) && n >= 1 && n <= 200)
    return [...new Set(nums)].sort((a, b) => a - b)
  }, [])

  // 失败驱动的 /v1 保底确认了修正地址时，回显给用户并同步回主表单（去重）
  const resolvedNotifiedRef = useRef<string | null>(null)
  const handleBaseUrlResolved = useCallback((url: string) => {
    if (!url || resolvedNotifiedRef.current === url) return
    resolvedNotifiedRef.current = url
    writeConnection({ baseUrl: url })
    window.dispatchEvent(new CustomEvent('lm-speed-base-url-resolved', { detail: url }))
    toast.success(t('baseUrlAutoFixed', { url }))
  }, [t])

  const onSubmit = useCallback(async () => {
    // 提交时重新读一次共享设置：主表单可能刚改过地址/请求头
    const live = resolveConnection()

    if (missingConnectionFields(live).length > 0) {
      // 通知上方的速度测试表单：跳回配置区并让缺失的输入框显示错误提示
      window.dispatchEvent(new CustomEvent('lm-speed-config-required'))
      return
    }
    if (live.customHeadersInvalid) {
      toast.error(t('errors.customHeadersInvalid'))
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
      setDetailsOpen(true)
      setOpenLevels({})
      contentRef.current = {}

      // Clear live cards
      setActiveLevel(null)
      setActiveLevelRequests([])
      setOpenActive({})
      setOpenRequests({})
      setLiveLevelOpen(true)
      setStreamContents({})

      if (live.browserDirect) {
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
            // 进度按「本档已完成请求数」推进：整档并发要全部完成才出结果，否则进度条长时间不动
            setProgress((li / levels.length) * 100)
            let settled = 0
            const advanceProgress = () => {
              settled += 1
              setProgress(((li + settled / level) / levels.length) * 100)
            }
            const init: RequestStatus[] = Array.from({ length: level }, (_, i) => ({
              requestId: i + 1, status: 'running' as const,
              firstTokenLatency: 0, tokensPerSecond: 0, tokensPerSecondTotal: 0,
              outputToken: 0, totalTime: 0, outputTime: 0, content: '', success: false,
            }))
            setActiveLevelRequests(init)
            contentRef.current = {}
            setStreamContents({})
            setOpenActive({})
            setOpenRequests({})
            setLiveLevelOpen(true)
            const levelStartTime = performance.now()
            const tasks = Array.from({ length: level }, (_, i) =>
              runBrowserStreamedChat(live.baseUrl, live.apiKey, live.modelId,
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
                  onBaseUrlResolved: handleBaseUrlResolved,
                },
                undefined,
                directRequestOptions(live, {
                  timeoutMs: REQUEST_TIMEOUT_MS.concurrency,
                  maxFirstTokenLatency: typeof maxFirstTokenLatency === 'number' ? maxFirstTokenLatency : undefined,
                }),
              ).then(r => {
                const ri = r.index ?? i
                advanceProgress()
                setActiveLevelRequests(prev => {
                  const next = [...prev]
                  next[ri] = { ...r, status: 'completed' as const, success: true, requestId: ri + 1 }
                  return next
                })
                return {
                  requestId: ri + 1,
                  firstTokenLatency: r.firstTokenLatency,
                  tokensPerSecond: r.tokensPerSecond,
                  tokensPerSecondTotal: r.tokensPerSecondTotal,
                  outputToken: r.outputToken,
                  totalTime: r.totalTime,
                  outputTime: r.outputTime,
                  content: r.content,
                  success: true,
                } satisfies RequestResult
              }).catch(err => {
                advanceProgress()
                setActiveLevelRequests(prev => {
                  const next = [...prev]
                  next[i] = { ...next[i], status: 'failed' as const, success: false, error: failureMessage(err) }
                  return next
                })
                return {
                  requestId: i + 1,
                  firstTokenLatency: 0,
                  tokensPerSecond: 0,
                  tokensPerSecondTotal: 0,
                  outputToken: 0,
                  totalTime: 0,
                  outputTime: 0,
                  content: '',
                  success: false,
                  error: failureMessage(err),
                } satisfies RequestResult
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

const response = await fetch('/api/speed/concurrency', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(proxyRequestBody(live, {
              prompt,
              concurrencyLevels: levels,
              ...(maxFirstTokenLatency !== '' && maxFirstTokenLatency > 0 ? { maxFirstTokenLatency } : {}),
            })),
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
            // ── Server proxy SSE path ──
            try {
              const message = JSON.parse(line)

              switch (message.type) {
                case 'baseUrlResolved': {
                  handleBaseUrlResolved(message.data.baseUrl)
                  break
                }
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
                  setOpenActive({})
                  setOpenRequests({})
                  setLiveLevelOpen(true)
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
      toast.error(failureMessage(error), { duration: 30000 })
    } finally {
      setLoading(false)
    }
  }, [prompt, concurrencyLevelsText, t, parseLevels, maxFirstTokenLatency, failureMessage])

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
              className="w-full p-2 border-2 rounded-md bg-white dark:bg-gray-100 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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
            <div className="text-xs text-gray-400 space-y-1 p-3 bg-white dark:bg-gray-100 rounded-md border border-gray-200">
              <p><span className="text-gray-500">{t('connection.baseUrl')}:</span> <span className="text-gray-700">{baseUrl || '-'}</span></p>
              <p><span className="text-gray-500">{t('connection.apiKey')}:</span> <span className="text-gray-700">{apiKey ? '••••••' + apiKey.slice(-4) : '-'}</span></p>
              <p><span className="text-gray-500">{t('connection.modelId')}:</span> <span className="text-gray-700">{modelId || '-'}</span></p>
              <p><span className="text-gray-500">{t('connection.transport')}:</span> <span className="text-gray-700">{connection.browserDirect ? t('connection.transportDirect') : t('connection.transportProxy')}</span></p>
            </div>
          )}

          <Button type="submit" disabled={loading || !prompt.trim()} className="w-full py-2 shadow-none transition-colors text-white dark:bg-[#222326] dark:hover:bg-[#2b2c2f]">
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
      <div className="px-4 sm:px-6">
        {results && (
          <div className="mb-8">
            <div id="concurrency-summary" className={cn('pin-light-gray pt-6 px-6 bg-[#17181C] rounded-lg', summaryOpen ? 'pb-2' : 'pb-6')}>
              <button
                type="button"
                onClick={() => setSummaryOpen(!summaryOpen)}
                aria-expanded={summaryOpen}
                className="w-full flex items-center gap-2 text-left cursor-pointer"
              >
                <BarChart3 className="w-5 h-5 text-white shrink-0" />
                <span className="flex-1 text-lg font-semibold text-white">LM Speed X {t('summary.title')}</span>
                <ChevronDown className={cn('w-5 h-5 shrink-0 text-gray-500 transition-transform', summaryOpen && 'rotate-180')} />
              </button>
              <div className={summaryOpen ? undefined : 'hidden'}>

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
            </div>

            {/* Per-level details (matching SpeedTest ResultsList style) */}
            {results.summaries.length > 0 && (
              <CollapsiblePanel
                open={detailsOpen}
                onToggle={() => setDetailsOpen(!detailsOpen)}
                className="mt-8"
                headerClassName={COLLAPSE_BAR_CLASS}
                header={
                  <span>
                    {t('details.title')}
                    <span className="ml-2 text-sm font-normal text-gray-500">({results.summaries.length} {t('summary.levels')})</span>
                  </span>
                }
                bodyClassName="mt-4"
              >
                <div className="space-y-8">
                  {results.summaries.map((s, li) => {
                    const levelResults = results.details[li] || []
                    return (
                      <CollapsiblePanel
                        key={s.level}
                        open={!!openLevels[s.level]}
                        onToggle={() => setOpenLevels((prev) => ({ ...prev, [s.level]: !prev[s.level] }))}
                        className="space-y-4"
                        headerClassName="p-4 rounded-lg bg-gray-100 border-l-4 border-cyan-400"
                        bodyClassName="mt-4 space-y-4"
                        header={
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
                            <div className="text-right text-sm pr-2">
                              <p className={rowColorClass(s.successRate)}>{s.successRate.toFixed(1)}% {t('benchmark.successRate')}</p>
                              <p className="text-gray-500">{formatRps(s.rps)} req/s</p>
                            </div>
                          </div>
                        }
                      >
                        {/* 单次请求：与测试过程中使用同一套折叠条 */}
                        {levelResults.map((r) => {
                          const reqKey = `${s.level}-${r.requestId}`
                          return (
                            <CollapsiblePanel
                              key={reqKey}
                              open={!!openRequests[reqKey]}
                              onToggle={() => setOpenRequests((prev) => ({ ...prev, [reqKey]: !prev[reqKey] }))}
                              headerClassName={COLLAPSE_ITEM_CLASS}
                              bodyClassName="mt-4"
                              header={
                                <div className="flex justify-between items-center">
                                  <p className="text-gray-600 text-sm">
                                    {t('details.request')} {r.requestId}
                                  </p>
                                  <div className="pr-2">
                                    {r.success ? (
                                      <span className="text-green-400">{t('status.completed')}</span>
                                    ) : (
                                      <span className="text-red-400">{t('status.failed')}</span>
                                    )}
                                </div>
                              </div>
                            }
                          >
                            <ResultBody
                              metrics={[
                                { label: t('details.firstTokenLatency'), value: `${(r.firstTokenLatency / 1000).toFixed(2)} s` },
                                { label: t('details.totalTime'), value: `${(r.totalTime / 1000).toFixed(2)} s` },
                                { label: tRank('table.avgTokens'), value: `${r.tokensPerSecond.toFixed(2)} t/s` },
                                { label: tSpeed('results.metrics.outputToken'), value: `${r.outputToken} (${(r.outputTime / 1000).toFixed(2)}s)` },
                              ]}
                              outputTitle={`${tSpeed('results.output.title')}:`}
                              copyLabel={tSpeed('results.output.copy')}
                              onCopy={() => { if (r.content) copyToClipboard(r.content) }}
                              content={r.content || (r.error ? `${t('status.failed')}: ${r.error}` : '-')}
                            />
                          </CollapsiblePanel>
                        )
                      })}
                    </CollapsiblePanel>
                  )
                })}
              </div>
            </CollapsiblePanel>
          )}
        </div>
      )}

      </div>
      {/* ── Live level cards (only during run): 与完成后同一套折叠条，测试中也能收起 ── */}
      <div className="px-4 sm:px-6">
        {activeLevel !== null && !results && activeLevelRequests.length > 0 && (
          <CollapsiblePanel
            open={liveOpen}
            onToggle={() => setLiveOpen(!liveOpen)}
            className="mt-8"
            headerClassName={COLLAPSE_BAR_CLASS}
            header={
              <span>
                {t('details.title')}
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({t('details.level')} {activeLevel} · {progress.toFixed(0)}%)
                </span>
              </span>
            }
            bodyClassName="mt-4"
          >
            <CollapsiblePanel
              open={liveLevelOpen}
              onToggle={() => setLiveLevelOpen(!liveLevelOpen)}
              headerClassName="p-4 rounded-lg bg-gray-100 border-l-4 border-cyan-400"
              bodyClassName="mt-4 space-y-4"
              header={
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-gray-700 font-medium">
                      {t('details.level')} {activeLevel}
                      <span className="ml-3 text-gray-500 text-sm">
                        ({activeLevelRequests.filter((it) => it.status === 'completed').length}/{activeLevelRequests.length})
                      </span>
                    </p>
                    <p className="text-gray-500 text-xs mt-1">
                      {t('connection.modelId')}: {modelId}
                    </p>
                  </div>
                  <div className="text-right text-sm pr-2">
                    <p className="text-gray-500">{progress.toFixed(0)}%</p>
                    {loading && waitedSeconds > 0 && (
                      <p className="text-gray-400 text-xs mt-1">{t('details.waitingSeconds', { seconds: waitedSeconds })}</p>
                    )}
                </div>
              </div>
            }
          >
            {activeLevelRequests.map((it, idx) => {
              const itemClass =
                it.status === 'pending'
                  ? 'p-4 rounded-lg bg-gray-100 border border-gray-200'
                  : it.status === 'running'
                    ? 'p-4 rounded-lg bg-blue-50 dark:bg-blue-500/15'
                    : it.status === 'failed'
                      ? 'p-4 rounded-lg bg-red-50 dark:bg-red-500/15'
                      : COLLAPSE_ITEM_CLASS
              return (
                <CollapsiblePanel
                  key={idx}
                  open={!!openActive[idx]}
                  disabled={it.status === 'pending'}
                  onToggle={() => setOpenActive((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                  headerClassName={itemClass}
                  bodyClassName="mt-4"
                  header={
                    <div className="flex justify-between items-center">
                      <p className="text-gray-600 text-sm">
                        {t('details.request')} {it.requestId}
                      </p>
                      <div className="flex items-center gap-3 pr-2">
                        {it.status !== 'pending' && it.outputToken > 0 && (
                          <span className="text-gray-500 text-xs font-mono">
                            {it.outputToken} · {it.tokensPerSecond.toFixed(2)} t/s
                          </span>
                        )}
                        {it.status === 'pending' && <span className="text-gray-500">{t('status.pending')}</span>}
                        {it.status === 'running' && (
                          <span className="text-blue-400 flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {t('status.running')}
                          </span>
                        )}
                        {it.status === 'completed' && <span className="text-green-400">{t('status.completed')}</span>}
                        {it.status === 'failed' && <span className="text-red-400">{t('status.failed')}</span>}
                      </div>
                    </div>
                  }
                >
                  <ResultBody
                    metrics={[
                      { label: t('details.firstTokenLatency'), value: it.firstTokenLatency > 0 ? `${(it.firstTokenLatency / 1000).toFixed(2)} s` : '-' },
                      { label: t('details.totalTime'), value: it.totalTime > 0 ? `${(it.totalTime / 1000).toFixed(2)} s` : '-' },
                      { label: tRank('table.avgTokens'), value: it.tokensPerSecond > 0 ? `${it.tokensPerSecond.toFixed(2)} t/s` : '-' },
                      { label: tSpeed('results.metrics.outputToken'), value: it.outputToken > 0 ? `${it.outputToken} (${(it.outputTime / 1000).toFixed(2)}s)` : '-' },
                    ]}
                    outputTitle={`${tSpeed('results.output.title')}:`}
                    copyLabel={tSpeed('results.output.copy')}
                    error={it.status === 'failed' ? it.error : undefined}
                    onCopy={() => { const text = streamContents[idx]; if (text) copyToClipboard(text) }}
                    content={streamContents[idx] || '-'}
                  />
                </CollapsiblePanel>
              )
            })}
          </CollapsiblePanel>
        </CollapsiblePanel>
      )}
      </div>
    </div>
  )
}
