'use client'

/**
 * 测速 / 稳定性 / 并发三个模块共用的连接设置与请求构造。
 *
 * 为什么集中一份：三个模块此前各自读同一组 localStorage 键、各自实现「直连判定 /
 * 自定义请求头解析 / 超时」，结果就出现偏差——测速能跑，稳定性和并发却卡在 0%。
 * 现在设置与传输只有这一份实现，三个模块的差别只剩下测试本身（循环次数、并发度、
 * 统计指标）。
 */

import { useEffect, useState } from 'react'
import { isLocalUrl, type BrowserChatOptions } from '@/lib/browser-llm'
import { readAutoCompleteBaseUrl, writeAutoCompleteBaseUrl } from '@/lib/api-completion'

export const CONNECTION_STORAGE_KEYS = {
  baseUrl: 'speedtest_baseUrl',
  apiKey: 'speedtest_apiKey',
  modelId: 'speedtest_modelId',
  browserDirect: 'speedtest_browserDirect',
  customHeaders: 'speedtest_customHeaders',
} as const

/**
 * 设置变更事件：同一标签页内改 localStorage 不会触发 storage 事件，
 * 靠它让其它测试模块立即跟上主表单的最新配置。
 */
export const CONNECTION_CHANGED_EVENT = 'lm-speed-connection-changed'

/** 单请求超时，数值与服务端路由一致，保证代理与直连两条路径的时限相同 */
export const REQUEST_TIMEOUT_MS = {
  speed: 60 * 1000,
  stability: 60 * 1000,
  concurrency: 120 * 1000,
} as const

export interface StoredConnection {
  baseUrl: string
  apiKey: string
  modelId: string
  /** 用户显式选择过的直连开关；null 表示从未选过，交给地址自动判定 */
  browserDirect: boolean | null
  /** 自定义请求头的原始 JSON 文本（编辑中的非法内容也要保留给用户） */
  customHeadersJson: string
  autoCompleteBaseUrl: boolean
}

export interface Connection extends StoredConnection {
  /** 本次请求实际采用的传输方式 */
  browserDirect: boolean
  /** 解析后的自定义请求头；为空或 JSON 非法时 undefined */
  customHeaders?: Record<string, string>
  /** 自定义请求头 JSON 是否非法（用于提示，而不是静默忽略） */
  customHeadersInvalid: boolean
  /** Cloudflare 手工验证后强制直连（并带上 Cookie） */
  forceDirect: boolean
}

export type ConnectionField = 'baseUrl' | 'apiKey' | 'modelId'

const EMPTY_CONNECTION: StoredConnection = {
  baseUrl: '',
  apiKey: '',
  modelId: '',
  browserDirect: null,
  customHeadersJson: '',
  autoCompleteBaseUrl: true,
}

export function readStoredConnection(): StoredConnection {
  if (typeof window === 'undefined') return EMPTY_CONNECTION
  const storedDirect = localStorage.getItem(CONNECTION_STORAGE_KEYS.browserDirect)
  return {
    baseUrl: localStorage.getItem(CONNECTION_STORAGE_KEYS.baseUrl) || '',
    apiKey: localStorage.getItem(CONNECTION_STORAGE_KEYS.apiKey) || '',
    modelId: localStorage.getItem(CONNECTION_STORAGE_KEYS.modelId) || '',
    browserDirect: storedDirect === null ? null : storedDirect === 'true',
    customHeadersJson: localStorage.getItem(CONNECTION_STORAGE_KEYS.customHeaders) || '',
    autoCompleteBaseUrl: readAutoCompleteBaseUrl(),
  }
}

/** 写入共享设置并广播，其它测试模块无需轮询即可拿到最新值 */
export function writeConnection(patch: Partial<StoredConnection>): void {
  if (typeof window === 'undefined') return
  if (patch.baseUrl !== undefined) {
    localStorage.setItem(CONNECTION_STORAGE_KEYS.baseUrl, patch.baseUrl)
  }
  if (patch.apiKey !== undefined) {
    localStorage.setItem(CONNECTION_STORAGE_KEYS.apiKey, patch.apiKey)
  }
  if (patch.modelId !== undefined) {
    localStorage.setItem(CONNECTION_STORAGE_KEYS.modelId, patch.modelId)
  }
  if (patch.browserDirect !== undefined) {
    localStorage.setItem(CONNECTION_STORAGE_KEYS.browserDirect, String(patch.browserDirect))
  }
  if (patch.customHeadersJson !== undefined) {
    if (patch.customHeadersJson) {
      localStorage.setItem(CONNECTION_STORAGE_KEYS.customHeaders, patch.customHeadersJson)
    } else {
      localStorage.removeItem(CONNECTION_STORAGE_KEYS.customHeaders)
    }
  }
  if (patch.autoCompleteBaseUrl !== undefined) {
    writeAutoCompleteBaseUrl(patch.autoCompleteBaseUrl)
  }
  window.dispatchEvent(new Event(CONNECTION_CHANGED_EVENT))
}

export interface ParsedCustomHeaders {
  headers?: Record<string, string>
  invalid: boolean
}

/**
 * 解析自定义请求头 JSON。authorization 一律剔除：apiKey 已经生成了
 * Authorization，留着只会让用户以为自己换了 key。
 */
export function parseCustomHeaders(json: string): ParsedCustomHeaders {
  const text = json.trim()
  if (!text) return { invalid: false }
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { invalid: true }
    }
    const headers = Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([key]) => key.toLowerCase() !== 'authorization')
        .map(([key, value]) => [key, String(value)] as const),
    )
    return Object.keys(headers).length > 0 ? { headers, invalid: false } : { invalid: false }
  } catch {
    return { invalid: true }
  }
}

export interface ResolveConnectionOptions {
  /** Cloudflare 手工验证后强制直连；否则按用户选择/地址自动判定 */
  forceDirect?: boolean
  stored?: StoredConnection
}

/** 把设置解析成一次请求真正要用的形态：传输方式 + 请求头 */
export function resolveConnection(options: ResolveConnectionOptions = {}): Connection {
  const stored = options.stored ?? readStoredConnection()
  const forceDirect = options.forceDirect === true
  const { headers, invalid } = parseCustomHeaders(stored.customHeadersJson)
  return {
    ...stored,
    forceDirect,
    browserDirect: forceDirect ? true : stored.browserDirect ?? isLocalUrl(stored.baseUrl),
    customHeaders: headers,
    customHeadersInvalid: invalid,
  }
}

export interface ConnectionOverrides extends Partial<StoredConnection> {
  forceDirect?: boolean
}

/**
 * 主表单是设置的编辑方：提交时用「表单当前值」覆盖已存值，
 * 避免用户改完没等 effect 落盘就点开始、另一个测试模块又读到旧配置。
 */
export function buildConnection(overrides: ConnectionOverrides = {}): Connection {
  const { forceDirect, ...patch } = overrides
  return resolveConnection({ stored: { ...readStoredConnection(), ...patch }, forceDirect })
}

export function missingConnectionFields(connection: StoredConnection): ConnectionField[] {
  const missing: ConnectionField[] = []
  if (!connection.baseUrl) missing.push('baseUrl')
  if (!connection.apiKey) missing.push('apiKey')
  if (!connection.modelId) missing.push('modelId')
  return missing
}

/** 代理路径的请求体：三个路由共用同一套字段名 */
export function proxyRequestBody(
  connection: Connection,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    baseUrl: connection.baseUrl,
    apiKey: connection.apiKey,
    modelId: connection.modelId,
    autoCompleteBaseUrl: connection.autoCompleteBaseUrl,
    ...(connection.customHeaders ? { customHeaders: connection.customHeaders } : {}),
    ...extra,
  }
}

/** 直连路径的请求选项：把共享设置翻译成 runBrowserStreamedChat 的参数 */
export function directRequestOptions(
  connection: Connection,
  options: { timeoutMs: number; maxFirstTokenLatency?: number },
): BrowserChatOptions {
  return {
    autoCompleteBaseUrl: connection.autoCompleteBaseUrl,
    ...(connection.customHeaders ? { customHeaders: connection.customHeaders } : {}),
    ...(connection.forceDirect ? { credentials: 'include' as const } : {}),
    timeoutMs: options.timeoutMs,
    ...(options.maxFirstTokenLatency && options.maxFirstTokenLatency > 0
      ? { maxFirstTokenLatency: options.maxFirstTokenLatency }
      : {}),
  }
}

/**
 * 订阅共享设置（跨组件 + 跨标签页）。写入方用 writeConnection，
 * 读取方拿到变更后自动重渲染——不再需要 500ms 轮询。
 */
export function useStoredConnection(): StoredConnection {
  const [stored, setStored] = useState<StoredConnection>(EMPTY_CONNECTION)

  useEffect(() => {
    const sync = () => setStored(readStoredConnection())
    sync()
    window.addEventListener('storage', sync)
    window.addEventListener(CONNECTION_CHANGED_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(CONNECTION_CHANGED_EVENT, sync)
    }
  }, [])

  return stored
}
