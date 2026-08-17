'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ExternalLink, CheckCircle2, ShieldAlert, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog'

interface CloudflareBypassDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** API base URL — the domain to verify against */
  baseUrl: string
  /** Called after the user confirms they've completed the challenge */
  onVerified: () => void
}

/** Build the URL that triggers the Cloudflare challenge (the models endpoint) */
function toVerifyUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '')
  // If base URL already ends with /v1, use the /models path directly.
  // Otherwise, include /v1 in the path so the Cloudflare challenge is hit.
  if (normalized.endsWith('/v1')) {
    return `${normalized}/models`
  }
  return `${normalized}/v1/models`
}

export function CloudflareBypassDialog({
  open,
  onOpenChange,
  baseUrl,
  onVerified,
}: CloudflareBypassDialogProps) {
  const t = useTranslations('CloudflareBypass')
  const [iframeError, setIframeError] = useState(false)
  const [iframeKey, setIframeKey] = useState(0)

  const verifyUrl = toVerifyUrl(baseUrl)

  // Reset iframe error state whenever the dialog (re)opens or URL changes
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setIframeError(false)
      setIframeKey((k) => k + 1)
    }
    onOpenChange(next)
  }

  const handleOpenPopup = () => {
    window.open(verifyUrl, '_blank', 'noopener,noreferrer,width=900,height=720')
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-border bg-card">
            {iframeError ? (
              <div className="flex h-72 flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-muted-foreground">{t('iframeUnavailable')}</p>
                <Button type="button" variant="outline" size="sm" onClick={handleOpenPopup}>
                  <ExternalLink className="h-4 w-4" />
                  {t('openInNewWindow')}
                </Button>
              </div>
            ) : (
              <iframe
                key={iframeKey}
                src={verifyUrl}
                title={t('title')}
                className="h-72 w-full rounded-md"
                onError={() => setIframeError(true)}
              />
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {iframeError ? t('openInNewWindowHint') : t('iframeHint')}
          </p>
          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">{t('note')}</p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button type="button" variant="outline" onClick={handleOpenPopup}>
            <ExternalLink className="h-4 w-4" />
            {t('openInNewWindow')}
          </Button>
          {iframeError && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIframeError(false)
                setIframeKey((k) => k + 1)
              }}
            >
              <RefreshCw className="h-4 w-4" />
              {t('retryIframe')}
            </Button>
          )}
          <Button type="button" onClick={onVerified}>
            <CheckCircle2 className="h-4 w-4" />
            {t('verifiedAndRetry')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}