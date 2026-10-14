'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ClipboardPaste, Copy } from 'lucide-react'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog'
import { copyToClipboard } from '@/lib/clipboard'
import { toast } from 'sonner'

interface ClipboardManualDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** copy: 展示内容供手动复制；input: 让用户手动粘贴内容 */
  mode: 'copy' | 'input'
  /** copy 模式下要展示的内容 */
  content?: string
  /** input 模式下用户确认输入后回调；返回 false 表示解析失败，对话框保持打开 */
  onConfirm?: (text: string) => boolean | void
}

/**
 * 剪贴板权限不可用时的兜底对话框：导出（copy）模式展示内容供用户
 * 手动复制，导入（input）模式提供输入框让用户手动粘贴。
 */
export function ClipboardManualDialog({
  open,
  onOpenChange,
  mode,
  content = '',
  onConfirm,
}: ClipboardManualDialogProps) {
  const t = useTranslations('ClipboardManual')
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isCopy = mode === 'copy'

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft('')
    onOpenChange(next)
  }

  // 打开展示模式时自动全选内容，方便用户直接 Ctrl+C
  useEffect(() => {
    if (open && isCopy && textareaRef.current) {
      textareaRef.current.select()
    }
  }, [open, isCopy, content])

  const handleRetryCopy = async () => {
    try {
      await copyToClipboard(content)
      toast.success(t('copied'))
      onOpenChange(false)
    } catch {
      toast.error(t('copyFailed'))
    }
  }

  const handleConfirm = () => {
    const ok = onConfirm ? onConfirm(draft) : true
    if (ok !== false) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isCopy ? (
              <Copy className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ClipboardPaste className="h-5 w-5 text-muted-foreground" />
            )}
            {t(isCopy ? 'copyTitle' : 'inputTitle')}
          </DialogTitle>
          <DialogDescription>{t(isCopy ? 'copyDescription' : 'inputDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <textarea
            ref={textareaRef}
            readOnly={isCopy}
            value={isCopy ? content : draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={isCopy ? undefined : t('inputPlaceholder')}
            className="w-full h-40 p-2 text-xs font-mono border rounded-md bg-white dark:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-muted-foreground">{t(isCopy ? 'copyHint' : 'inputHint')}</p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          {isCopy ? (
            <Button type="button" onClick={handleRetryCopy}>
              <Copy className="mr-1 h-4 w-4" />
              {t('retryCopy')}
            </Button>
          ) : (
            <Button type="button" onClick={handleConfirm}>
              {t('confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}