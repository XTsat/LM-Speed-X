'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Loader2, TrendingUp, Activity, ChevronDown } from 'lucide-react'
import { RequestTimeoutError, runBrowserStreamedChat } from '@/lib/browser-llm'
import { copyToClipboard } from '@/lib/clipboard'
import { COLLAPSE_BAR_CLASS, COLLAPSE_ITEM_CLASS, CollapsiblePanel } from './collapsible-panel'
import { ResultBody } from './result-body'
import { cn } from '@/lib/utils'
import {
  REQUEST_TIMEOUT_MS,
  directRequestOptions,
  missingConnectionFields,
  proxyRequestBody,
  resolveConnection,
  useStoredConnection,
  writeConnection,
} from '@/lib/test-connection'

// ── Types ──

interface IterationResult {
  iteration: number
  firstTokenLatency: number
  tokensPerSecond: number
  tokensPerSecondTotal: number
  outputToken: number
  totalTime: number
  outputTime: number
  content: string
}

interface IterationStatus extends IterationResult {
  status: 'pending' | 'running' | 'completed' | 'failed'
  /** 失败原因（本地化文案），仅 status === 'failed' 时有值 */
  error?: string
}

interface StatsResult {
  mean: number; stdDev: number; min: number; max: number; variance: number; median: number
}

interface StabilityResults {
  results: IterationResult[]
  /** 失败的轮次：不计入统计，但要原样留痕，否则失败样本被静默丢弃 */
  failures?: Array<{ iteration: number; error: string }>
  stats: {
    firstTokenLatency: StatsResult
    tokensPerSecond: StatsResult
    totalTime: StatsResult
    outputToken: StatsResult
  }
}

// ── Helpers ──

const formatMs = (ms: number) => `${(ms / 1000).toFixed(3)}s`
const formatTps = (tps: number) => `${tps.toFixed(2)} t/s`

// ── Component ──

export function StabilityTest() {
const t = useTranslations('StabilityTest')
const tSpeed = useTranslations('SpeedTest')
const tRank = useTranslations('rank')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<StabilityResults | null>(null)
  const [prompt, setPrompt] = useState('Explain the concept of quantum computing in simple terms.')
  const [count, setCount] = useState(10)
  // 连接配置与测速表单共用一份（含直连开关、自定义请求头、自动补全开关）
  const stored = useStoredConnection()
  const connection = useMemo(() => resolveConnection({ stored }), [stored])
  const { baseUrl, apiKey, modelId } = connection
  // 运行中已等待秒数：稳定测要跑多轮，没有这个提示时整轮静默看起来像卡死
  const [waitedSeconds, setWaitedSeconds] = useState(0)

  // Live iteration status cards
  const [iterations, setIterations] = useState<IterationStatus[]>([])
  // 总览面板与过程中的轮次卡片同样可折叠，跑起来后结果会长到屏幕外
  const [summaryOpen, setSummaryOpen] = useState(true)
  const [liveOpen, setLiveOpen] = useState(true)
  // 每轮展开状态按索引记录：测试中与结果页用同一套点击折叠
  const [openLive, setOpenLive] = useState<{ [key: number]: boolean }>({})
  // 结果明细默认展开、每轮记录默认折叠：轮数最多 50，全部展开会把页面拉得很长
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [failuresOpen, setFailuresOpen] = useState(false)
  const [openIterations, setOpenIterations] = useState<{ [key: number]: boolean }>({})
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

    if (live.browserDirect) {
      setLoading(true); setProgress(0); setResults(null)
      setDetailsOpen(true); setOpenIterations({})
      contentRef.current = {}

      const initIterations: IterationStatus[] = Array.from({ length: count }, (_, i) => ({
        iteration: i + 1, status: 'pending' as const,
        firstTokenLatency: 0, tokensPerSecond: 0, tokensPerSecondTotal: 0,
        outputToken: 0, totalTime: 0, outputTime: 0, content: '',
      }))
      setIterations(initIterations); setStreamContents({})

      const timer = window.setInterval(() => setStreamContents({ ...contentRef.current }), 50)

      try {
        const iterationResults: IterationResult[] = []
        const failures: Array<{ iteration: number; error: string }> = []
        let failedCount = 0

        for (let i = 0; i < count; i++) {
          // 进度按「已完成 + 在飞」推进：开跑先吃掉半格，整轮等待就不会看起来卡在 0%
          setProgress(((i + 0.5) / count) * 100)
          setIterations(prev => { const next = [...prev]; if (next[i]) next[i] = { ...next[i], status: 'running' as const }; return next })
          contentRef.current[i] = ''

          try {
            const result = await runBrowserStreamedChat(
              live.baseUrl, live.apiKey, live.modelId,
              [{ role: 'user', content: prompt }],
              i, prompt,
              { onContent: (cd) => {
                contentRef.current[i] = (contentRef.current[i] || '') + cd.content
                setIterations(prev => {
                  const next = [...prev]
                  if (next[i]) {
                    next[i] = { ...next[i],
                      tokensPerSecond: cd.currentSpeed, tokensPerSecondTotal: cd.currentTotalSpeed,
                      outputToken: cd.currentTokens, outputTime: cd.elapsedTime }
                  }
                  return next
                })
              },
              onBaseUrlResolved: handleBaseUrlResolved,
            },
            undefined,
            directRequestOptions(live, { timeoutMs: REQUEST_TIMEOUT_MS.stability }),
            )

            const iterResult: IterationResult = {
              iteration: i + 1,
              firstTokenLatency: result.firstTokenLatency,
              tokensPerSecond: result.tokensPerSecond,
              tokensPerSecondTotal: result.tokensPerSecondTotal,
              outputToken: result.outputToken,
              totalTime: result.totalTime,
              outputTime: result.outputTime,
              content: result.content,
            }
            iterationResults.push(iterResult)

            setIterations(prev => {
              const next = [...prev]
              if (next[i]) next[i] = { ...iterResult, status: 'completed' as const }
              return next
            })
          } catch (error) {
            // 单次失败不中断整轮：稳定性测的就是抖动，失败率本身也是结论
            failedCount += 1
            const message = failureMessage(error)
            failures.push({ iteration: i + 1, error: message })
            setIterations(prev => {
              const next = [...prev]
              if (next[i]) next[i] = { ...next[i], status: 'failed' as const, error: message }
              return next
            })
          }

          setProgress(((i + 1) / count) * 100)
        }

        if (iterationResults.length === 0) {
          throw new Error(t('errors.allFailed'))
        }

        function calcStats(vals: number[]) {
          if (vals.length === 0) return { mean: 0, stdDev: 0, min: 0, max: 0, variance: 0, median: 0 }
          const sorted = [...vals].sort((a, b) => a - b)
          const sum = sorted.reduce((a, v) => a + v, 0)
          const mean = sum / vals.length
          const median = vals.length % 2 === 0 ? (sorted[vals.length/2-1] + sorted[vals.length/2]) / 2 : sorted[Math.floor(vals.length/2)]
          const variance = sorted.reduce((a, v) => a + (v-mean)**2, 0) / vals.length
          const stdDev = Math.sqrt(variance)
          return { mean, stdDev, min: sorted[0], max: sorted[vals.length-1], variance, median }
        }

        const stats = {
          firstTokenLatency: calcStats(iterationResults.map(r => r.firstTokenLatency)),
          tokensPerSecond: calcStats(iterationResults.map(r => r.tokensPerSecond)),
          totalTime: calcStats(iterationResults.map(r => r.totalTime)),
          outputToken: calcStats(iterationResults.map(r => r.outputToken)),
        }

        setResults({ results: iterationResults, stats, failures })
        setProgress(100)
        if (failedCount > 0) {
          toast.error(t('errors.partialFailure', { count: failedCount, total: count }), { duration: 30000 })
        } else {
          toast.success(t('complete'))
        }
      } catch (error) {
        console.error('Browser direct stability error:', error)
        toast.error(failureMessage(error), { duration: 30000 })
      } finally {
        clearInterval(timer)
        setLoading(false)
      }
      return
    }

    try {
      setLoading(true)
      setProgress(0)
      setResults(null)
      setDetailsOpen(true); setOpenIterations({})
      contentRef.current = {}

      // Init iteration status cards
      const initIterations: IterationStatus[] = Array.from({ length: count }, (_, i) => ({
        iteration: i + 1,
        status: 'pending',
        firstTokenLatency: 0,
        tokensPerSecond: 0,
        tokensPerSecondTotal: 0,
        outputToken: 0,
        totalTime: 0,
        outputTime: 0,
        content: '',
      }))
      setIterations(initIterations)
      setStreamContents({})

      const response = await fetch('/api/speed/stability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proxyRequestBody(live, { prompt, count })),
      })

      if (!response.ok) {
        let errorMsg = `Failed to run stability test (${response.status})`
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
            try {
              const message = JSON.parse(line)

              switch (message.type) {
                case 'baseUrlResolved': {
                  handleBaseUrlResolved(message.data.baseUrl)
                  break
                }
                case 'start': {
                  const idx = message.data.iteration - 1
                  setProgress((idx / count) * 100)
                  setIterations(prev => {
                    const next = [...prev]
                    if (next[idx]) next[idx] = { ...next[idx], status: 'running' }
                    return next
                  })
                  contentRef.current[idx] = ''
                  break
                }
                case 'content': {
                  const ci = message.data.iteration - 1
                  contentRef.current[ci] = (contentRef.current[ci] || '') + message.data.content
                  // Update real-time metrics on the card
                  setIterations(prev => {
                    const next = [...prev]
                    if (next[ci]) {
                      next[ci] = {
                        ...next[ci],
                        tokensPerSecond: message.data.currentSpeed || next[ci].tokensPerSecond,
                        tokensPerSecondTotal: message.data.currentTotalSpeed || next[ci].tokensPerSecondTotal,
                        outputToken: message.data.currentTokens || next[ci].outputToken,
                        outputTime: message.data.elapsedTime || next[ci].outputTime,
                      }
                    }
                    return next
                  })
                  break
                }
                case 'result': {
                  const ri = message.data.iteration - 1
                  setProgress(((ri + 1) / count) * 100)
                  setIterations(prev => {
                    const next = [...prev]
                    if (next[ri]) {
                      next[ri] = {
                        ...message.data,
                        status: 'completed',
                      }
                    }
                    return next
                  })
                  break
                }
                case 'iterationError': {
                  const ei = message.data.iteration - 1
                  setIterations(prev => {
                    const next = [...prev]
                    if (next[ei]) next[ei] = { ...next[ei], status: 'failed', error: message.data.error }
                    return next
                  })
                  break
                }
                case 'complete':
                  setResults(message.data)
                  setProgress(100)
                  if (message.data.failures?.length > 0) {
                    toast.error(t('errors.partialFailure', { count: message.data.failures.length, total: count }), { duration: 30000 })
                  } else {
                    toast.success(t('complete'))
                  }
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
      console.error('Stability test error:', error)
      toast.error(failureMessage(error), { duration: 30000 })
    } finally {
      setLoading(false)
    }
  }, [prompt, count, t, failureMessage])

  // ── Render ──

  return (
    <div className="container mx-auto px-4 sm:px-0">
      {/* ── Form ── */}
      <div className="bg-gray-50 p-4 sm:p-6 rounded-lg">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5" />
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
            <label className="text-sm text-gray-600">{t('count.label')}</label>
            <Input
              type="number" min={3} max={50}
              value={count}
              onChange={(e) => setCount(Math.max(3, Math.min(50, parseInt(e.target.value) || 10)))}
              className="w-full p-2 border-2 rounded-md bg-transparent text-gray-700"
            />
            <p className="text-xs text-gray-400">{t('count.hint')}</p>
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

      {/* ── Summary (shown on top after completion) ── */}
      <div className="px-4 sm:px-6">
        {results && (
          <div className="mb-8">
            <div id="stability-summary" className={cn('group pin-light-gray pt-6 px-6 bg-[#17181C] rounded-lg', summaryOpen ? 'pb-2' : 'pb-6')}>
              <button
                type="button"
                onClick={() => setSummaryOpen(!summaryOpen)}
                aria-expanded={summaryOpen}
                className="w-full flex items-center gap-2 text-left cursor-pointer"
              >
                <Activity className="w-5 h-5 text-white shrink-0" />
                <span className="flex-1 text-lg font-semibold text-white">LM Speed X {t('summary.title')}</span>
                <ChevronDown className={cn('w-5 h-5 shrink-0 text-gray-500 transition-all opacity-0 group-hover:opacity-100 group-focus-within:opacity-100', summaryOpen && 'rotate-180')} />
              </button>
              <div className={summaryOpen ? undefined : 'hidden'}>
              <div className="text-sm font-normal mb-4">
                <span className="text-gray-400 mr-2">{tRank('table.model')}:</span>
                <span className="text-white mr-8">{modelId}</span>
                <span className="text-gray-400 mr-2">{tRank('table.baseUrl')}:</span>
                <span className="text-white mr-8">{(() => { try { return new URL(baseUrl).host } catch { return baseUrl || '-' } })()}</span>
                <span className="text-gray-400 mr-2">{t('summary.iterations')}:</span>
                <span className="text-white mr-8">{results.results.length}</span>
                <span className="text-gray-400 mr-2">{t('summary.prompt')}:</span>
                <span className="text-white">{results.results[0]?.content.length ?? 0} chars</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left py-2 px-3 text-gray-400 font-medium">{t('summary.metric')}</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">{t('summary.avg')}</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">{t('summary.stdDev')}</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">{t('summary.min')}</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">{t('summary.max')}</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">{t('summary.median')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      { label: t('summary.firstTokenLatency'), key: 'firstTokenLatency' as const, fmt: formatMs },
                      { label: t('summary.tokensPerSecond'), key: 'tokensPerSecond' as const, fmt: formatTps },
                      { label: t('summary.totalTime'), key: 'totalTime' as const, fmt: formatMs },
                      { label: t('summary.outputToken'), key: 'outputToken' as const, fmt: (v: number) => v.toFixed(0) },
                    ]).map(({ label, key, fmt }, i) => {
                      const s = results.stats[key]
                      return (
                        <tr key={key} className={i < 3 ? 'border-b border-gray-800' : ''}>
                          <td className="py-3 px-3 text-gray-300">{label}</td>
                          <td className="text-right py-3 px-3 text-white font-mono">{fmt(s.mean)}</td>
                          <td className="text-right py-3 px-3 text-gray-300 font-mono">±{fmt(s.stdDev)}</td>
                          <td className="text-right py-3 px-3 font-mono text-red-400">{fmt(s.min)}</td>
                          <td className="text-right py-3 px-3 font-mono text-green-400">{fmt(s.max)}</td>
                          <td className="text-right py-3 px-3 text-gray-300 font-mono">{fmt(s.median)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-start gap-2 text-xs text-gray-400">
                <TrendingUp className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <p className="flex-1 pb-2">{t('summary.stdDevHint')}</p>
                <a href="https://lm-speed-x.xtsat.cc.cd" target="_blank" rel="noopener noreferrer" className="text-xs text-gray-600 hover:text-gray-400 transition-colors shrink-0">lm-speed-x.xtsat.cc.cd</a>
                </div>
              </div>
            </div>

            {/* Results list (matching SpeedTest ResultsList style exactly) */}
            {results.results.length > 0 && (
              <CollapsiblePanel
                open={detailsOpen}
                onToggle={() => setDetailsOpen(!detailsOpen)}
                className="mt-8"
                headerClassName={COLLAPSE_BAR_CLASS}
                header={
                  <span>
                    {tSpeed('results.title')}
                    <span className="ml-2 text-sm font-normal text-gray-500">({results.results.length})</span>
                  </span>
                }
                bodyClassName="mt-4"
              >
                <div className="space-y-6">
                {results.results.map((r) => {
                  const open = !!openIterations[r.iteration]
                  return (
                  <CollapsiblePanel
                    key={r.iteration}
                    open={open}
                    onToggle={() => setOpenIterations((prev) => ({ ...prev, [r.iteration]: !prev[r.iteration] }))}
                    headerClassName={COLLAPSE_ITEM_CLASS}
                    bodyClassName="mt-4"
                    header={
                      <div className="flex justify-between items-center">
                        <div className="flex-1">
                          <p className="text-gray-700 font-medium">
                            {t('details.iteration')} {r.iteration}
                          </p>
                        </div>
                        <div className="ml-4">
                          <span className="text-green-400">{t('status.completed')}</span>
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
                      content={r.content || '-'}
                    />
                  </CollapsiblePanel>
                  )
                })}
              </div>
              </CollapsiblePanel>
            )}
          {results.failures && results.failures.length > 0 && (
            <CollapsiblePanel
              open={failuresOpen}
              onToggle={() => setFailuresOpen(!failuresOpen)}
              className="mt-4"
              headerClassName={COLLAPSE_BAR_CLASS}
              header={
                <span>
                  {t('details.failures')}
                  <span className="ml-2 text-sm font-normal text-gray-500">({results.failures.length})</span>
                </span>
              }
              bodyClassName="mt-4"
            >
              <div className="space-y-2">
                {results.failures.map((f) => (
                  <div key={f.iteration} className="px-4 py-3 rounded-lg bg-gray-200">
                    <p className="text-sm font-medium text-gray-700">
                      {t('details.iteration')} {f.iteration}
                    </p>
                    <p className="mt-1 break-all text-xs text-red-500">{f.error}</p>
                  </div>
                ))}
              </div>
            </CollapsiblePanel>
          )}
        </div>
      )}

      </div>
      {/* Iteration cards during run: 与结果页共用同一套折叠条，跑起来后长列表也能收起 */}
      <div className="px-4 sm:px-6">
        {iterations.length > 0 && !results && (
          <CollapsiblePanel
            open={liveOpen}
            onToggle={() => setLiveOpen(!liveOpen)}
            className="mt-8"
            headerClassName={COLLAPSE_BAR_CLASS}
            header={
              <span>
                {tSpeed('results.title')}
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({iterations.filter((it) => it.status === 'completed').length}/{iterations.length})
                </span>
                {loading && waitedSeconds > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-400">{t('details.waitingSeconds', { seconds: waitedSeconds })}</span>
                )}
            </span>
          }
          bodyClassName="mt-4"
        >
          <div className="space-y-4">
            {iterations.map((it, idx) => {
              const itemClass =
                it.status === 'pending'
                  ? 'p-4 rounded-lg bg-gray-100 border border-gray-200'
                  : it.status === 'running'
                    ? 'p-4 rounded-lg bg-blue-50 dark:bg-blue-500/15'
                    : it.status === 'failed'
                      ? 'p-4 rounded-lg bg-red-50 dark:bg-red-500/10'
                      : COLLAPSE_ITEM_CLASS
              return (
                <CollapsiblePanel
                  key={idx}
                  open={!!openLive[idx]}
                  disabled={it.status === 'pending'}
                  onToggle={() => setOpenLive((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                  headerClassName={itemClass}
                  bodyClassName="mt-4"
                  header={
                    <div className="flex justify-between items-center">
                      <p className="text-gray-600 text-sm">
                        {t('details.iteration')} {it.iteration}
                      </p>
                      <div className="flex items-center gap-3 pr-2">
                        {it.status !== 'pending' && it.outputToken > 0 && (
                          <span className="text-gray-500 text-xs font-mono">
                            {it.outputToken} · {it.tokensPerSecond.toFixed(2)} t/s
                          </span>
                        )}
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
          </div>
        </CollapsiblePanel>
      )}
      </div>
    </div>
  )
}
