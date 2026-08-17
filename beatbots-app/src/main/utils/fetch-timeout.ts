/** Per-request ceiling for Target API calls during checkout (ms). */
export const CHECKOUT_REQUEST_TIMEOUT_MS = 30_000

/**
 * Combines caller abort (task stop) with a hard request timeout so hung TCP
 * cannot leave checkout tasks stuck in `running` forever.
 */
export function mergeAbortSignals(userSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  if (!userSignal) return timeoutSignal
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([userSignal, timeoutSignal])
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (userSignal.aborted || timeoutSignal.aborted) {
    abort()
    return controller.signal
  }
  userSignal.addEventListener('abort', abort, { once: true })
  timeoutSignal.addEventListener('abort', abort, { once: true })
  return controller.signal
}

export function fetchWithTimeout(
  url: string,
  init: RequestInit & { signal?: AbortSignal },
  timeoutMs = CHECKOUT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const { signal: userSignal, ...rest } = init
  return fetch(url, {
    ...rest,
    signal: mergeAbortSignals(userSignal, timeoutMs),
  })
}
