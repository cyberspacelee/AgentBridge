import { useEffect, useState, type ReactNode } from "react"
import { api, useQuery } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Failure } from "@/components/workspace-ui"

export function AccessGate({ children }: { children: ReactNode }) {
  const access = useQuery<{ authenticated: boolean }>("/api/access")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error>()
  useEffect(() => {
    window.addEventListener("agentbridge:unauthorized", access.reload)
    return () =>
      window.removeEventListener("agentbridge:unauthorized", access.reload)
  }, [access.reload])
  if (access.data?.authenticated) return children
  if (!access.data && !access.error)
    return (
      <div className="page">
        <Skeleton className="h-48" />
      </div>
    )
  return (
    <main className="page">
      <form
        className="flex max-w-lg flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          setBusy(true)
          setError(undefined)
          void api("/api/access", {
            method: "POST",
            body: JSON.stringify({ code }),
          })
            .then(() => {
              setCode("")
              access.reload()
            })
            .catch(setError)
            .finally(() => setBusy(false))
        }}
      >
        <h1>连接 AgentBridge</h1>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="access-code">实例配对码</FieldLabel>
            <Input
              id="access-code"
              type="password"
              autoComplete="off"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <FieldDescription>
              输入此服务启动终端显示的管理配对码。配对后可管理此实例的
              Agent、任务和系统设置。
            </FieldDescription>
          </Field>
        </FieldGroup>
        <Failure error={error ?? access.error} />
        <Button disabled={busy || !code} type="submit">
          {busy ? "连接中" : "连接实例"}
        </Button>
      </form>
    </main>
  )
}
