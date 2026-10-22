'use client'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/** 区块条（测试结果 / 汇总明细）样式：与页面其它控件同宽，三处测试页共用一份避免走样 */
export const COLLAPSE_BAR_CLASS =
  'px-4 py-3 rounded-lg bg-gray-100 border border-gray-200 font-semibold text-lg text-gray-700'

/** 条目条（单档位 / 单请求 / 单轮）样式 */
export const COLLAPSE_ITEM_CLASS = 'p-4 rounded-lg bg-gray-200'

interface CollapsiblePanelProps {
  /** 折叠条内容：标题、状态、右侧指标等，始终可见 */
  header: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
  className?: string
  headerClassName?: string
  bodyClassName?: string
  /** 尚无内容可展开（如请求还在排队）时不可交互，也不显示箭头 */
  disabled?: boolean
}

/**
 * 结果区块/单档位通用折叠容器。
 * 用按钮而非 div 承载点击，保证键盘可操作（结果区长列表需要能用 Tab + Enter 展开）。
 */
export function CollapsiblePanel({
  header,
  open,
  onToggle,
  children,
  className,
  headerClassName,
  bodyClassName,
  disabled = false,
}: CollapsiblePanelProps) {
  if (disabled) {
    return (
      <div className={className}>
        <div className={cn('w-full flex items-center gap-3 text-left', headerClassName)}>
          <div className="flex-1 min-w-0">{header}</div>
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn('w-full flex items-center gap-3 text-left cursor-pointer transition-colors', headerClassName)}
      >
        <div className="flex-1 min-w-0">{header}</div>
        <ChevronDown
          className={cn('w-4 h-4 shrink-0 text-gray-500 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && <div className={bodyClassName}>{children}</div>}
    </div>
  )
}
