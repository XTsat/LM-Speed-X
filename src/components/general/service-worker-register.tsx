'use client'

import { useEffect } from 'react'

/**
 * 在生产环境注册 Service Worker,为应用提供 PWA 离线缓存能力。
 * 开发模式下不注册,避免干扰 Next.js 热更新;不支持 SW 的环境静默跳过。
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // 注册失败不影响应用使用(仅失去离线缓存能力)
    })
  }, [])

  return null
}
