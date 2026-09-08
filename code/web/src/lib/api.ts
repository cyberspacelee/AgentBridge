import { useCallback, useEffect, useRef, useState } from "react"
import type {
  AcceptedRun,
  CreateTaskInput,
  Submission,
  SubmitRunInput,
} from "../../../shared/contracts"

export class ApiError extends Error {
  readonly code: string
  readonly requestId: string | null
  readonly status: number
  constructor(
    code: string,
    message: string,
    requestId: string | null,
    status: number
  ) {
    super(message)
    this.code = code
    this.requestId = requestId
    this.status = status
  }
}
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(45000)])
      : AbortSignal.timeout(45000),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new ApiError(
      body.code ?? "HTTP_ERROR",
      body.message ?? `HTTP ${response.status}`,
      response.headers.get("x-request-id"),
      response.status
    )
  }
  return response.status === 204 ? (undefined as T) : response.json()
}
// Lazily allocate per-page cancellation; StrictMode cleanup can safely discard an unused scope.
export function useRequestSignal(key: unknown = null) {
  const controller = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      controller.current?.abort()
      controller.current = null
    },
    [key]
  )
  return useCallback(
    () => (controller.current ??= new AbortController()).signal,
    []
  )
}
export function useQuery<T>(url: string | null, revision = 0, queryKey = url) {
  const [result, setResult] = useState<{
    url: string | null
    data?: T
    error?: Error
  }>({ url: null })
  const [refresh, setRefresh] = useState(0)
  const reload = useCallback(() => setRefresh((value) => value + 1), [])
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    void api<T>(url, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ url: queryKey, data })
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult((previous) => ({
            url: queryKey,
            data: previous.url === queryKey ? previous.data : undefined,
            error,
          }))
      })
    return () => controller.abort()
  }, [url, queryKey, revision, refresh])
  return {
    data: result.url === queryKey ? result.data : undefined,
    error: result.url === queryKey ? result.error : undefined,
    loading:
      !!url && (result.url !== queryKey || (!result.data && !result.error)),
    reload,
  }
}
// Retain the exact request until its outcome is known, including across reloads.
export async function submit(
  input:
    | Omit<CreateTaskInput, "submissionId">
    | Omit<SubmitRunInput, "submissionId">,
  storeId: string,
  sessionId?: string,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const key = `agentbridge:submission:${storeId}:${sessionId ?? "create"}`
  const fingerprint = JSON.stringify(input)
  let record: {
    fingerprint: string
    body: CreateTaskInput | SubmitRunInput
  } | null = null
  try {
    record = JSON.parse(sessionStorage.getItem(key) ?? "null")
  } catch {
    /* Replace invalid local state before dispatch. */
  }
  if (!record || record.fingerprint !== fingerprint)
    record = {
      fingerprint,
      body: {
        ...input,
        submissionId: Array.from(
          crypto.getRandomValues(new Uint8Array(16)),
          (byte) => byte.toString(16).padStart(2, "0")
        ).join(""),
      },
    }
  sessionStorage.setItem(key, JSON.stringify(record))
  try {
    const result = await api<AcceptedRun>(
      sessionId ? `/api/tasks/${sessionId}/runs` : "/api/tasks",
      { method: "POST", body: JSON.stringify(record.body), signal }
    )
    signal?.throwIfAborted()
    if (sessionStorage.getItem(key) === JSON.stringify(record))
      sessionStorage.removeItem(key)
    return result
  } catch (error) {
    signal?.throwIfAborted()
    const query = new URLSearchParams({
      operation: sessionId ? "append" : "create",
      sessionId: sessionId ?? "",
    })
    const outcome = await api<Submission>(
      `/api/submissions/${record.body.submissionId}?${query}`,
      { signal }
    ).catch(() => null)
    signal?.throwIfAborted()
    if (outcome?.status === "accepted" && outcome.result) {
      if (sessionStorage.getItem(key) === JSON.stringify(record))
        sessionStorage.removeItem(key)
      return outcome.result
    }
    if (
      (outcome?.status === "rejected" || outcome?.status === "gone") &&
      sessionStorage.getItem(key) === JSON.stringify(record)
    )
      sessionStorage.removeItem(key)
    throw error
  }
}
export function useEvents() {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<"connecting" | "live" | "reconnecting">(
    "connecting"
  )
  useEffect(() => {
    let source: EventSource
    let reconnect: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const invalidate = () => {
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined
          setRevision((r) => r + 1)
        }, 250)
    }
    const connect = () => {
      source = new EventSource("/event")
      source.onopen = () => {
        attempts = 0
        setState("live")
        invalidate()
      }
      source.onerror = () => {
        setState("reconnecting")
        // CONNECTING is retried by the browser; CLOSED (e.g. HTTP 503) is terminal.
        if (source.readyState === EventSource.CLOSED) {
          source.close()
          clearTimeout(reconnect)
          reconnect = setTimeout(
            connect,
            Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5))
          )
        }
      }
      source.onmessage = invalidate
    }
    connect()
    const polling = setInterval(invalidate, 5000)
    return () => {
      source.close()
      clearTimeout(reconnect)
      clearTimeout(timer)
      clearInterval(polling)
    }
  }, [])
  return { revision, state }
}
