'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Loader2, TrendingUp, Activity } from 'lucide-react'
import { isLocalUrl, runBrowserStreamedChat } from '@/lib/browser-llm'
import { copyToClipboard } from '@/lib/clipboard'

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
  status: 'pending' | 'running' | 'completed'
}

interface StatsResult {
  mean: number; stdDev: number; min: number; max: number; variance: number; median: number
}

interface StabilityResults {
  results: IterationResult[]
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
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [modelId, setModelId] = useState('')
  const [useBrowserDirect, setUseBrowserDirect] = useState(false)

  // Live iteration status cards
  const [iterations, setIterations] = useState<IterationStatus[]>([])
  const [expandedIteration, setExpandedIteration] = useState<number | null>(null)
  const [streamContents, setStreamContents] = useState<{ [key: number]: string }>({})
  const contentRef = useRef<{ [key: number]: string }>({})

  // Read connection config from localStorage (synced from SpeedTestForm above)
  useEffect(() => {
    setBaseUrl(localStorage.getItem('speedtest_baseUrl') || '')
    setApiKey(localStorage.getItem('speedtest_apiKey') || '')
    setModelId(localStorage.getItem('speedtest_modelId') || '')
    const storedBrowserDirect = localStorage.getItem('speedtest_browserDirect')
    const baseUrlFromStorage = localStorage.getItem('speedtest_baseUrl') || ''
    if (storedBrowserDirect !== null) {
      setUseBrowserDirect(storedBrowserDirect === 'true')
    } else if (baseUrlFromStorage && isLocalUrl(baseUrlFromStorage)) {
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

    if (useBrowserDirect) {
      setLoading(true); setProgress(0); setResults(null)
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

        for (let i = 0; i < count; i++) {
          setProgress((i / count) * 100)
          setIterations(prev => { const next = [...prev]; if (next[i]) next[i] = { ...next[i], status: 'running' as const }; return next })
          setExpandedIteration(i)
          contentRef.current[i] = ''

          const result = await runBrowserStreamedChat(
            liveBaseUrl, liveApiKey, liveModelId,
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
            }}
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

          setProgress(((i + 1) / count) * 100)
          setIterations(prev => {
            const next = [...prev]
            if (next[i]) next[i] = { ...iterResult, status: 'completed' as const }
            return next
          })
          setTimeout(() => setExpandedIteration(null), 800)
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

        setResults({ results: iterationResults, stats })
        setProgress(100)
        toast.success(t('complete'))
      } catch (error) {
        console.error('Browser direct stability error:', error)
        toast.error(error instanceof Error ? error.message : t('errors.unknown'), { duration: 30000 })
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
        body: JSON.stringify({ baseUrl: liveBaseUrl, apiKey: liveApiKey, modelId: liveModelId, prompt, count }),
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
                case 'start': {
                  const idx = message.data.iteration - 1
                  setProgress((idx / count) * 100)
                  setIterations(prev => {
                    const next = [...prev]
                    if (next[idx]) next[idx] = { ...next[idx], status: 'running' }
                    return next
                  })
                  setExpandedIteration(idx)
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
                  // Auto-collapse completed iterations after a short delay
                  setTimeout(() => setExpandedIteration(null), 800)
                  break
                }
                case 'complete':
                  setResults(message.data)
                  setProgress(100)
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
      console.error('Stability test error:', error)
      toast.error(error instanceof Error ? error.message : t('errors.unknown'), { duration: 30000 })
    } finally {
      setLoading(false)
    }
  }, [prompt, count, t, useBrowserDirect])

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
              className="w-full p-2 border-2 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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

      {/* ── Summary (shown on top after completion) ── */}
      {results && (
        <div className="mb-8">
          <div id="stability-summary" className="pt-6 px-6 pb-2 bg-[#17181C] rounded-lg">
            <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
              <Activity className="w-5 h-5" />
              <span>LM Speed X {t('summary.title')}</span>
            </h3>
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

          {/* Results list (matching SpeedTest ResultsList style exactly) */}
          {results.results.length > 0 && (
            <>
              <h2 className="w-full text-xl text-center font-bold mt-8 mb-4">{tSpeed('results.title')}</h2>
              <div className="space-y-6">
              {results.results.map((r) => (
                <div
                  key={r.iteration}
                  onClick={() => setExpandedIteration(expandedIteration === r.iteration - 1 ? null : r.iteration - 1)}
                  className="p-4 rounded-lg bg-gray-200 cursor-pointer"
                >
                  <div className="flex justify-between items-center">
                    <div className="flex-1">
                      <p className="text-gray-600 text-sm mb-2">
                        {t('connection.modelId')}: {modelId}
                      </p>
                    </div>
                    <div className="ml-4">
                      <span className="text-green-400">{t('status.completed')}</span>
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

                  <div className={`max-h-96 overflow-y-auto mt-4 p-4 bg-white rounded-lg ${expandedIteration === r.iteration - 1 ? 'block' : 'hidden'}`}>
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="text-gray-700 font-medium">{tSpeed('results.output.title')}:</h4>
                      <button onClick={(e) => { e.stopPropagation(); if (r.content) copyToClipboard(r.content) }} className="text-xs text-gray-400 hover:text-gray-600 transition-colors shrink-0">{tSpeed('results.output.copy')}</button>
                    </div>
                    <div className="whitespace-pre-wrap font-mono text-sm">
                      {r.content || '-'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      )}

      {/* ── Iteration Cards (only visible during run, hidden after completion) ── */}
      {iterations.length > 0 && !results && (
        <div className="mt-8">
          <h3 className="text-xl text-center font-bold mb-4">{t('details.title')}</h3>
          <div className="space-y-4">
            {iterations.map((it, idx) => (
              <div
                key={idx}
                onClick={() => {
                  if (it.status !== 'pending') {
                    setExpandedIteration(expandedIteration === idx ? null : idx)
                  }
                }}
                className={`p-4 rounded-lg cursor-pointer ${
                  it.status === 'pending'
                    ? 'bg-gray-100 cursor-default'
                    : it.status === 'running'
                    ? 'bg-blue-50'
                    : 'bg-gray-200'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div className="flex-1">
                    <p className="text-gray-600 text-sm mb-2">
                      {t('details.iteration')} {it.iteration}
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

                <div className={`max-h-96 overflow-y-auto mt-4 p-4 bg-white rounded-lg ${expandedIteration === idx ? 'block' : 'hidden'}`}>
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-gray-700 font-medium">{tSpeed('results.output.title')}:</h4>
                    <button onClick={(e) => { e.stopPropagation(); const text = streamContents[idx]; if (text) copyToClipboard(text) }} className="text-xs text-gray-400 hover:text-gray-600 transition-colors shrink-0">{tSpeed('results.output.copy')}</button>
                  </div>
                  <div className="whitespace-pre-wrap font-mono text-sm">
                    {streamContents[idx] || '-'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
