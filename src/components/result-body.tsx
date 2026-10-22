import type { ReactNode } from 'react'

export type ResultMetric = {
  label: string
  value: string
}

type ResultBodyProps = {
  metrics: ResultMetric[]
  outputTitle: string
  copyLabel: string
  onCopy?: () => void
  contentId?: string
  content: ReactNode
  error?: string
}

/**
 * 单条请求/单轮测试展开后的正文。三个测试页共用同一套排版，
 * 指标与输出都装在与配置区只读信息框一致的白色描边区块里。
 */
export const ResultBody = ({
  metrics,
  outputTitle,
  copyLabel,
  onCopy,
  contentId,
  content,
  error,
}: ResultBodyProps) => (
  <div className="space-y-3">
    <div className="grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric.label}>
          <p className="text-xs text-gray-500">{metric.label}</p>
          <p className="mt-1 text-sm font-medium text-gray-700">{metric.value}</p>
        </div>
      ))}
    </div>
    {error && <p className="break-all px-1 text-xs text-red-400">{error}</p>}
    <div id={contentId} className="max-h-96 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-medium text-gray-500">{outputTitle}</h4>
        {onCopy && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onCopy()
            }}
            className="shrink-0 text-xs text-gray-400 transition-colors hover:text-gray-600"
          >
            {copyLabel}
          </button>
        )}
      </div>
      <div className="whitespace-pre-wrap font-mono text-sm text-gray-700">{content}</div>
    </div>
  </div>
)
