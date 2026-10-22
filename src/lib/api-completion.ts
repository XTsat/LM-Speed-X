/**
 * 「自动补全 API 地址」开关的持久化。
 *
 * The setting lives in localStorage because every test module (speed /
 * stability / concurrency / connectivity) reads the same baseUrl from there —
 * one key keeps them in agreement without a global store. It defaults to on so
 * users who never touch the switch keep the old forgiving behaviour.
 *
 * When off, request URLs are used exactly as typed: no scheme added, no pasted
 * endpoint stripped, no /v1 probing, no failure-driven /v1 fallback.
 */
export const AUTO_COMPLETE_BASE_URL_STORAGE_KEY = 'speedtest_autoCompleteBaseUrl'

/** Whether API URLs may be auto-completed. Defaults to true (只有显式存过 'false' 才关闭) */
export function readAutoCompleteBaseUrl(): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(AUTO_COMPLETE_BASE_URL_STORAGE_KEY) !== 'false'
}

export function writeAutoCompleteBaseUrl(enabled: boolean): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(AUTO_COMPLETE_BASE_URL_STORAGE_KEY, String(enabled))
}
