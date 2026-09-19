import { useContext, useState, type FormEvent } from "react"
import type { GatewayView, LlmProxyView, SystemView } from "../../../shared/system"
import { api, useQuery } from "@/lib/api"
import { GatewayContext } from "@/lib/gateway"
import { desktop } from "@/lib/desktop"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Field, FieldLabel, FieldDescription, FieldGroup } from "@/components/ui/field"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { CopyText, Failure } from "@/components/workspace-ui"

export function GatewaySettingsPanel({ system }: { system?: SystemView }) {
  const { revision, runtime } = useContext(GatewayContext)
  const query = useQuery<GatewayView>(system?.capabilities.gateway ? "/api/system/gateway" : null, revision)
  return <section aria-label="网关服务" className="flex min-w-0 flex-col gap-4">
    <Failure error={query.error} />
    {query.data && <GatewayForm key={`${runtime?.instanceId}:${query.data.appliedRevision}`} initial={query.data} />}
  </section>
}

export function LlmProxySettingsPanel({ system }: { system?: SystemView }) {
  const { revision, runtime } = useContext(GatewayContext)
  const query = useQuery<LlmProxyView>(system?.capabilities.gateway ? "/api/system/llm-proxy" : null, revision)
  return <section aria-label="LLM 代理" className="flex min-w-0 flex-col gap-4">
    <Failure error={query.error} />
    {query.data && <LlmProxyForm key={`${runtime?.instanceId}:${query.data.appliedRevision}`} initial={query.data} />}
  </section>
}

function LlmProxyForm({ initial }: { initial: LlmProxyView }) {
  const [view, setView] = useState(initial)
  const [host, setHost] = useState(initial.settings.host)
  const [port, setPort] = useState(String(initial.settings.port))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error>()
  const [confirm, setConfirm] = useState(false)
  const dirty = host !== view.settings.host || port !== String(view.settings.port)
  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      setView(await api<LlmProxyView>("/api/system/llm-proxy", {
        method: "PUT", body: JSON.stringify({ revision: view.revision, settings: { host, port: Number(port) } }),
      }))
    } catch (error) { setError(error as Error) }
    finally { setBusy(false) }
  }
  async function restart(mode: "wait" | "stop") {
    setBusy(true)
    setError(undefined)
    try {
      await api("/api/system/lifecycle", { method: "POST", body: JSON.stringify({ action: "restart", mode }) })
      setConfirm(false)
    } catch (error) { setError(error as Error) }
    finally { setBusy(false) }
  }
  return <>
    <form onSubmit={save}>
      <Card>
        <CardHeader>
          <CardTitle><h2>LLM 代理</h2></CardTitle>
          <CardDescription>为需要协议转换的 Agent 提供本机 OpenAI 兼容入口；Provider 的请求头、参数、密钥和上游地址保存后对下一次请求立即生效。</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <Failure error={error ?? (initial.error ? new Error(initial.error) : undefined)} />
          <FieldGroup className="sm:grid sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="llm-proxy-host">监听地址</FieldLabel>
              <Input id="llm-proxy-host" required value={host} disabled={busy} onChange={(event) => setHost(event.target.value)} />
              <FieldDescription>127.0.0.1 供本机 Agent 使用；0.0.0.0 开放监听到局域网。远程 Agent 仍需单独部署代理。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="llm-proxy-port">代理端口</FieldLabel>
              <Input id="llm-proxy-port" type="number" min={0} max={65535} step={1} required value={port} disabled={busy} onChange={(event) => setPort(event.target.value)} />
              <FieldDescription>固定端口方便 Agent 配置；0 表示自动分配。</FieldDescription>
            </Field>
          </FieldGroup>
          {view.restartRequired && <p role="status" className="text-sm text-muted-foreground">LLM 代理监听设置已保存，重启服务后生效；重启也会应用其他待生效的系统配置。</p>}
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button type="submit" disabled={busy || !dirty}>保存代理设置</Button>
          <Button type="button" variant="outline" disabled={busy || dirty || !view.restartRequired} onClick={() => setConfirm(true)}>重启服务应用</Button>
        </CardFooter>
      </Card>
    </form>
    <Dialog open={confirm} onOpenChange={setConfirm}>
      <DialogContent>
        <DialogHeader><DialogTitle>重启服务应用 LLM 代理设置</DialogTitle><DialogDescription>连接会短暂中断。可等待任务完成，或停止任务后重启。</DialogDescription></DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>取消</Button>
          <Button variant="outline" disabled={busy} onClick={() => void restart("stop")}>停止任务并重启</Button>
          <Button disabled={busy} onClick={() => void restart("wait")}>等待任务完成后重启</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}

function GatewayForm({ initial }: { initial: GatewayView }) {
  const [view, setView] = useState(initial)
  const [host, setHost] = useState(initial.settings.host)
  const [port, setPort] = useState(String(initial.settings.port))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error>()
  const [confirm, setConfirm] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const dirty = host !== view.settings.host || port !== String(view.settings.port)
  const nextUrl = new URL(window.location.href)
  if (!["0.0.0.0", "::"].includes(view.settings.host))
    nextUrl.hostname = view.settings.host.includes(":") ? `[${view.settings.host}]` : view.settings.host
  nextUrl.port = String(view.settings.port)
  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      setView(await api<GatewayView>("/api/system/gateway", {
        method: "PUT", body: JSON.stringify({ revision: view.revision, settings: { host, port: Number(port) } }),
      }))
    } catch (error) { setError(error as Error) }
    finally { setBusy(false) }
  }
  async function restart(mode: "wait" | "stop") {
    setBusy(true)
    setError(undefined)
    try {
      await api("/api/system/lifecycle", { method: "POST", body: JSON.stringify({ action: "restart", mode }) })
      setConfirm(false)
      setRestarting(true)
    } catch (error) { setError(error as Error) }
    finally { setBusy(false) }
  }
  return <>
    <form onSubmit={save}>
      <Card>
        <CardHeader>
          <CardTitle><h2>网关服务</h2></CardTitle>
          <CardDescription>Web、桌面端和自动化评测共用 HTTP / SSE 服务，无需配对码或 Token。</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <Failure error={error ?? (initial.error ? new Error(initial.error) : undefined)} />
          <FieldGroup className="sm:grid sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="gateway-host">监听地址</FieldLabel>
              <Input id="gateway-host" required value={host} disabled={busy} onChange={(event) => setHost(event.target.value)} />
              <FieldDescription>127.0.0.1 供本机访问；0.0.0.0 开放局域网。也支持指定本机 IP。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="gateway-port">网关端口</FieldLabel>
              <Input id="gateway-port" type="number" min={0} max={65535} step={1} required value={port} disabled={busy} onChange={(event) => setPort(event.target.value)} />
              <FieldDescription>固定端口方便评测脚本连接；0 表示自动分配。</FieldDescription>
            </Field>
          </FieldGroup>
          <div className="flex min-w-0 flex-col gap-2 text-sm">
            <p>当前访问地址</p>
            {initial.urls.map((url) => <div key={url} className="flex min-w-0 items-center gap-2"><code className="break-all">{url}</code><CopyText text={url} label="复制网关地址" /></div>)}
            <a className="text-primary underline" href="/api/docs" target="_blank" rel="noreferrer">API 文档（OpenAPI）</a>
          </div>
          {view.restartRequired && <p role="status" className="text-sm text-muted-foreground">网关设置已保存，重启后生效。重启会一并应用已保存的网络设置。</p>}
          {restarting && <p role="status" className="text-sm">
            {desktop ? "服务重启后，桌面窗口会自动连接。" : "服务重启中，等待任务结束后生效。"}
            {!desktop && view.settings.port !== 0 && <> <a className="text-primary underline" href={nextUrl.href}>使用新地址打开工作台</a></>}
            {!desktop && view.settings.port === 0 && " 自动端口请在启动终端查看；修改地址失败时刷新当前页面查看原因。"}
          </p>}
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button type="submit" disabled={busy || !dirty}>保存网关设置</Button>
          <Button type="button" variant="outline" disabled={busy || dirty} onClick={() => setConfirm(true)}>重启网关</Button>
        </CardFooter>
      </Card>
    </form>
    <Dialog open={confirm} onOpenChange={setConfirm}>
      <DialogContent>
        <DialogHeader><DialogTitle>重启网关</DialogTitle><DialogDescription>可等待任务完成，或停止任务后重启。连接将短暂中断。</DialogDescription></DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>取消</Button>
          <Button variant="outline" disabled={busy} onClick={() => void restart("stop")}>停止任务并重启</Button>
          <Button disabled={busy} onClick={() => void restart("wait")}>等待任务完成后重启</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
