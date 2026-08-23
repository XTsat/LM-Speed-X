/**
 * Shared per-request timeout signal.
 *
 * Used by BOTH the server-side proxy routes (api/connectivity/test-models) and the
 * browser-direct connectivity probe (lib/browser-llm.ts) so request timing behaves
 * identically on every path.
 *
 * The returned signal aborts as soon as EITHER:
 *   - `timeoutMs` elapses, OR
 *   - the external signal (the caller's abort controller) aborts.
 *
 * Call `done()` once the request finishes to stop the timer and detach the
 * external listener so nothing leaks.
 */
export interface TimeoutScope {
  signal: AbortSignal
  done: () => void
}

export function createTimeoutSignal(
  external: AbortSignal | undefined,
  timeoutMs: number,
): TimeoutScope {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const onExternalAbort = () => controller.abort()
  const activeExternal = external && !external.aborted ? external : null
  activeExternal?.addEventListener('abort', onExternalAbort)

  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      activeExternal?.removeEventListener('abort', onExternalAbort)
    },
  }
}