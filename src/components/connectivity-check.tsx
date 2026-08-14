'use client'

import { useState, useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle, XCircle, Loader2, Wifi, ChevronDown, Download, FlaskConical, AlertTriangle, Copy } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/lib/clipboard'
import { toast } from 'sonner'
import { isLocalUrl, fetchModelsDirect, testConnectivityDirect } from '@/lib/browser-llm'
import type { ValidationLevel } from '@/lib/browser-llm'

interface ModelTestResult {
  modelId: string
  reachable: boolean
  error: string
  latencyMs: number
  retries: number
  tierRestricted?: boolean
  contentValid?: boolean | null
}

// When the model list exceeds this many models, auto-apply a request interval to
// avoid slamming the server with too many concurrent probes. The user can still
// override it manually (e.g. set it to 0 for parallel testing).
const AUTO_DELAY_THRESHOLD = 100
const AUTO_DELAY_MS = 500

export function ConnectivityCheck({
  onModelsFound,
  baseUrl,
  apiKey,
}: {
  onModelsFound?: (models: { id: string; latencyMs: number | null; status?: 'ok' | 'validation_failed' | 'unreachable' }[]) => void
  baseUrl: string
  apiKey: string
}) {
  const t = useTranslations('ConnectivityCheck')

  // Model list
  const [modelIds, setModelIds] = useState<string[]>([])
  const [customModelInput, setCustomModelInput] = useState('')
  const [delayMs, setDelayMs] = useState('')
  const [retries, setRetries] = useState('')
  const [timeoutMs, setTimeoutMs] = useState('')
  const [fetchingModels, setFetchingModels] = useState(false)
  const [testing, setTesting] = useState(false)
  const [results, setResults] = useState<ModelTestResult[] | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [validationLevel, setValidationLevel] = useState<ValidationLevel>(null)
  // Track whether the user has manually edited the delay field; once touched,
  // the auto-apply logic (for 100+ model lists) will stop overriding it.
  const [delayTouched, setDelayTouched] = useState(false)

  // Merge upstream models with custom IDs
  const allModelIds = (() => {
    const customIds = customModelInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const merged = new Set([...modelIds, ...customIds])
    return [...merged]
  })()

  // Auto-apply a request interval when the model list exceeds the threshold,
  // unless the user has manually adjusted the delay field.
  useEffect(() => {
    if (allModelIds.length > AUTO_DELAY_THRESHOLD && !delayTouched) {
      setDelayMs(String(AUTO_DELAY_MS))
    }
  }, [allModelIds.length, delayTouched])

  const fetchModels = useCallback(async () => {
    if (!baseUrl || !apiKey) {
      toast.error(t('errors.noConfig'))
      return
    }
    setFetchingModels(true)
    try {
      // Browser-direct mode for local/private IPs — bypasses server proxy
      if (isLocalUrl(baseUrl)) {
        const models = await fetchModelsDirect(baseUrl, apiKey)
        const ids: string[] = models.map((m) => m.id).filter(Boolean)
        setModelIds(ids)
        toast.success(t('modelsFetched', { count: ids.length }))
        return
      }

      const resp = await fetch('/api/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey }),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      const ids: string[] = (data.models || [])
        .map((m: { id: string }) => m.id)
        .filter(Boolean)
      setModelIds(ids)
      toast.success(t('modelsFetched', { count: ids.length }))
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t('errors.fetchFailed'),
      )
    } finally {
      setFetchingModels(false)
    }
  }, [baseUrl, apiKey, t])

  const runTests = useCallback(async () => {
    if (!baseUrl || !apiKey) {
      toast.error(t('errors.noConfig'))
      return
    }
    if (allModelIds.length === 0) {
      toast.error(t('errors.noModels'))
      return
    }
    setTesting(true)
    setResults([])

    const effectiveTimeout = timeoutMs ? Number(timeoutMs) : 15000
    const effectiveRetries = retries ? Number(retries) : 0
    const effectiveDelay = delayMs ? Number(delayMs) : 0

    try {
      // Browser-direct mode for local/private IPs — test from browser directly
      if (isLocalUrl(baseUrl)) {
        const collectedResults: ModelTestResult[] = []
        const abortController = new AbortController()

        const testOne = async (id: string) => {
          const result = await testConnectivityDirect(
            baseUrl, apiKey, id,
            effectiveTimeout, effectiveRetries, effectiveDelay,
            abortController.signal,
            validationLevel,
          )
          collectedResults.push(result)
          setResults((prev) => {
            const existing = prev ? [...prev] : []
            const idx = existing.findIndex((r) => r.modelId === result.modelId)
            if (idx >= 0) {
              existing[idx] = result
            } else {
              existing.push(result)
            }
            return existing
          })
          return result
        }

        if (effectiveDelay > 0) {
          for (const id of allModelIds) {
            await testOne(id)
          }
        } else {
          await Promise.all(allModelIds.map(testOne))
        }

        if (onModelsFound) {
          onModelsFound(collectedResults.map((r) => ({
            id: r.modelId,
            latencyMs: r.reachable && r.contentValid !== false ? r.latencyMs : null,
            status: (r.reachable && r.contentValid !== false ? 'ok' : r.reachable ? 'validation_failed' : 'unreachable') as 'ok' | 'validation_failed' | 'unreachable',
          })))
        }
        return
      }

      // Server-proxy mode: use streaming NDJSON endpoint
      const resp = await fetch('/api/connectivity/test-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          apiKey,
          modelIds: allModelIds,
          delayMs: delayMs ? Number(delayMs) : 0,
          retries: retries ? Number(retries) : 0,
          timeoutMs: timeoutMs ? Number(timeoutMs) : undefined,
          validationLevel: validationLevel || undefined,
        }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(err.error || `HTTP ${resp.status}`)
      }

        // Read streaming NDJSON response
        const reader = resp.body?.getReader()
        if (!reader) throw new Error('No response body')
        const decoder = new TextDecoder()
        let buffer = ''
        const collectedResults: ModelTestResult[] = []

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const msg = JSON.parse(line)
              if (msg.result) {
                collectedResults.push(msg.result)
                setResults((prev) => {
                  const existing = prev ? [...prev] : []
                  const idx = existing.findIndex((r) => r.modelId === msg.result.modelId)
                  if (idx >= 0) {
                    existing[idx] = msg.result
                  } else {
                    existing.push(msg.result)
                  }
                  return existing
                })
              }
            } catch {
              // skip unparseable lines
            }
          }
        }

        // Notify parent of all tested models — validation-failed ones get null latency
        if (onModelsFound) {
          onModelsFound(collectedResults.map((r) => ({
            id: r.modelId,
            latencyMs: r.reachable && r.contentValid !== false ? r.latencyMs : null,
            status: (r.reachable && r.contentValid !== false ? 'ok' : r.reachable ? 'validation_failed' : 'unreachable') as 'ok' | 'validation_failed' | 'unreachable',
          })))
        }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t('errors.testFailed'),
      )
    } finally {
      setTesting(false)
    }
  }, [baseUrl, apiKey, allModelIds, delayMs, retries, timeoutMs, onModelsFound, t])

  const reachableCount = results?.filter((r) => r.reachable && r.contentValid !== false).length ?? 0
  const totalCount = results?.length ?? 0
  const hasConfig = !!(baseUrl && apiKey)

  // Display order: success (green) → warning (yellow) → failed (red)
  const statusRank = (r: ModelTestResult): number => {
    const contentInvalid = r.reachable && r.contentValid === false
    const tierRestricted = !r.reachable && r.tierRestricted
    if (r.reachable && r.contentValid !== false) return 0
    if (contentInvalid || tierRestricted) return 1
    return 2
  }

  return (
    <div className="border border-input rounded-md">
      {/* Collapse header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-4 py-2 text-sm hover:bg-muted/50 transition-colors rounded-md"
      >
        <div className="flex items-center gap-2">
          <Wifi className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{t('title')}</span>
          {results && (
            <span className={cn(
              'text-xs px-1.5 py-0.5 rounded-full font-medium',
              testing
                ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                : reachableCount === totalCount
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
            )}>
              {testing ? `${results.length}/${allModelIds.length}` : `${reachableCount}/${totalCount}`}
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            'ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform',
            !expanded && 'rotate-90',
          )}
        />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 pt-3 space-y-3 border-t border-input/60">
          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={fetchModels}
              disabled={fetchingModels || !hasConfig}
              size="sm"
            >
              {fetchingModels ? (
                <>
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  {t('fetchingModels')}
                </>
              ) : (
                <>
                  <Download className="mr-2 h-3 w-3" />
                  {t('fetchModels')}
                </>
              )}
            </Button>
            <Button
              type="button"
              onClick={runTests}
              disabled={testing || !hasConfig || allModelIds.length === 0}
              size="sm"
            >
              {testing ? (
                <>
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  {t('testing')}
                </>
              ) : (
                <>
                  <FlaskConical className="mr-2 h-3 w-3" />
                  {t('testAll')}
                </>
              )}
            </Button>
            {!hasConfig && (
              <span className="text-xs text-muted-foreground self-center">
                {t('errors.noConfig')}
              </span>
            )}
            {modelIds.length > 0 && (
              <span className="text-xs text-muted-foreground self-center">
                {modelIds.length} {t('modelCount').toLowerCase()}
              </span>
            )}
          </div>

          {/* Validation mode selector */}
          <TooltipProvider>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground shrink-0">
                {t('validationModes.label')}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={validationLevel === null ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs px-2"
                    disabled={testing}
                    onClick={() => setValidationLevel(null)}
                  >
                    {t('validationModes.none')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs max-w-[200px]">{t('validationModes.noneDesc')}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={validationLevel === 'repeat' ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs px-2"
                    disabled={testing}
                    onClick={() => setValidationLevel('repeat')}
                  >
                    {t('validationModes.repeat')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs max-w-[200px]">{t('validationModes.repeatDesc')}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={validationLevel === 'self' ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs px-2"
                    disabled={testing}
                    onClick={() => setValidationLevel('self')}
                  >
                    {t('validationModes.self')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs max-w-[200px]">{t('validationModes.selfDesc')}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={validationLevel === 'math' ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs px-2"
                    disabled={testing}
                    onClick={() => setValidationLevel('math')}
                  >
                    {t('validationModes.math')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs max-w-[200px]">{t('validationModes.mathDesc')}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={validationLevel === 'vision' ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs px-2"
                    disabled={testing}
                    onClick={() => setValidationLevel('vision')}
                  >
                    {t('validationModes.vision')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs max-w-[200px]">{t('validationModes.visionDesc')}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>

          {/* Custom model IDs + delay + retry + timeout in one row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="min-w-0">
              <label className="text-xs text-muted-foreground mb-1 block truncate">
                {t('customModelsLabel')}
              </label>
              <Input
                placeholder={t('customModelsPlaceholder')}
                value={customModelInput}
                onChange={(e) => setCustomModelInput(e.target.value)}
                disabled={testing}
                className="text-xs h-8"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {t('delayLabel')} (ms)
              </label>
              <Input
                type="number"
                placeholder="0"
                value={delayMs}
                onChange={(e) => {
                  setDelayMs(e.target.value)
                  setDelayTouched(true)
                }}
                disabled={testing}
                className="text-xs h-8"
                min="0"
                step="100"
              />
              {allModelIds.length > AUTO_DELAY_THRESHOLD && !delayTouched && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400 block mt-1">
                  {t('autoDelayHint', {
                    count: allModelIds.length,
                    delay: AUTO_DELAY_MS,
                  })}
                </span>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {t('retryLabel')}
              </label>
              <Input
                type="number"
                placeholder="0"
                value={retries}
                onChange={(e) => setRetries(e.target.value)}
                disabled={testing}
                className="text-xs h-8"
                min="0"
                max="5"
                step="1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {t('timeoutLabel')} (ms)
              </label>
              <Input
                type="number"
                placeholder="15000"
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(e.target.value)}
                disabled={testing}
                className="text-xs h-8"
                min="1000"
                step="1000"
              />
            </div>
          </div>

          {/* Results grid */}
          {results && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-[400px] overflow-y-auto">
              {results.slice().sort((a, b) => {
                const rankDiff = statusRank(a) - statusRank(b)
                if (rankDiff !== 0) return rankDiff
                // 同组内按延迟升序（快在前）；不可达项延迟为 0，自然排在组末
                return a.latencyMs - b.latencyMs
              }).map((r) => {
                const tierRestricted = !r.reachable && r.tierRestricted
                const contentInvalid = r.reachable && r.contentValid === false
                return (
                <div
                  key={r.modelId}
                  className={cn(
                    'flex items-start gap-1.5 rounded border px-2 py-1.5 text-xs',
                    contentInvalid
                      ? 'border-amber-200 bg-amber-50 dark:border-amber-900/30 dark:bg-amber-950/20'
                      : r.reachable
                        ? 'border-green-200 bg-green-50 dark:border-green-900/30 dark:bg-green-950/20'
                        : tierRestricted
                          ? 'border-amber-200 bg-amber-50 dark:border-amber-900/30 dark:bg-amber-950/20'
                          : 'border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20',
                  )}
                >
                  {contentInvalid ? (
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
                  ) : r.reachable ? (
                    <CheckCircle className="mt-0.5 h-3 w-3 shrink-0 text-green-600 dark:text-green-400" />
                  ) : tierRestricted ? (
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-500 dark:text-red-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate" title={r.modelId}>
                      {r.modelId}
                    </div>
                    {contentInvalid ? (
                      <span className="text-amber-600 dark:text-amber-400 block truncate">
                        {r.latencyMs}ms — {t('contentInvalid')}
                      </span>
                    ) : r.reachable ? (
                      <span className="text-muted-foreground">
                        {r.latencyMs}ms
                        {r.retries > 0 && (
                          <span className="text-amber-600 dark:text-amber-400 ml-1">
                            ({t('retried', { count: r.retries })})
                          </span>
                        )}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'truncate block',
                          tierRestricted
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-red-600 dark:text-red-400',
                        )}
                        title={r.error}
                      >
                        {tierRestricted && (
                          <span className="font-medium">
                            [{t('tierRestricted')}]{' '}
                          </span>
                        )}
                        {r.error}
                        {r.retries > 0 && (
                          <span className="text-amber-600 dark:text-amber-400 ml-1">
                            ({t('retried', { count: r.retries })})
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          )}

          {/* Copy model IDs button */}
          {results && reachableCount > 0 && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  const ids = results
                    .filter((r) => r.reachable && r.contentValid !== false)
                    .map((r) => r.modelId)
                    .join(',')
                  try {
                    await copyToClipboard(ids)
                    toast.success(t('modelIdsCopied'))
                  } catch {
                    toast.error(t('errors.copyFailed'))
                  }
                }}
              >
                <Copy className="mr-1 h-3 w-3" />
                {t('copyModelIds')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
