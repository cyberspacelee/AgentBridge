import { useContext, useRef, useState, type FormEvent } from "react"
import { FileInput, RefreshCw, Save, Trash2, Zap } from "lucide-react"
import { desktop } from "@/lib/desktop"
import type {
  NetworkSettings,
  NetworkView,
  SystemView,
} from "../../../shared/system"
import { api, useQuery } from "@/lib/api"
import { GatewayContext } from "@/lib/gateway"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Choice, Failure, IconButton, Notice } from "@/components/workspace-ui"

export function NetworkSettingsPanel() {
  const { revision } = useContext(GatewayContext)
  const system = useQuery<SystemView>("/api/system", revision)
  const network = useQuery<NetworkView>(
    system.data?.capabilities.network ? "/api/system/network" : null,
    revision
  )
  return (
    <section
      className="settings-section min-w-0"
      aria-labelledby="network-heading"
    >
      <h2 id="network-heading">网络与代理</h2>
      <Failure error={system.error ?? network.error} />
      {network.data ? (
        <NetworkForm
          key={network.data.appliedRevision}
          initial={network.data}
        />
      ) : system.data && !system.data.capabilities.network ? (
        <Notice title="启动管理器未连接">
          请通过 pnpm start、pnpm dev 或桌面入口启动服务，以管理网络和重启。
        </Notice>
      ) : (
        <Skeleton className="h-64" />
      )}
    </section>
  )
}

function NetworkForm({ initial }: { initial: NetworkView }) {
  const [view, setView] = useState(initial)
  const [draft, setDraft] = useState(initial.settings)
  const [password, setPassword] = useState<string>()
  const [target, setTarget] = useState("https://registry.npmjs.org/")
  const [busy, setBusy] = useState<
    "save" | "test" | "certificate" | "restart" | "refresh"
  >()
  const [error, setError] = useState<Error>()
  const [invalid, setInvalid] = useState<Record<string, string>>({})
  const [result, setResult] = useState<{ status: number; durationMs: number }>()
  const [saved, setSaved] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const certificateInput = useRef<HTMLInputElement>(null)
  const dirty =
    password !== undefined ||
    JSON.stringify(draft) !== JSON.stringify(view.settings)
  const input = {
    ...draft,
    ...(password !== undefined ? { proxyPassword: password } : {}),
  }
  function change(patch: Partial<NetworkSettings>) {
    setDraft((previous) => ({ ...previous, ...patch }))
    setSaved(false)
    setResult(undefined)
    setInvalid({})
  }
  function validate(testing = false) {
    const fields: Record<string, string> = {}
    const checkUrl = (value: string, name: string) => {
      try {
        const url = new URL(value)
        if (!["http:", "https:"].includes(url.protocol))
          fields[name] = "请输入 HTTP 或 HTTPS 地址"
        else if (url.username || url.password)
          fields[name] = "地址中不能包含用户名或密码"
      } catch {
        fields[name] = "请输入完整的 HTTP 或 HTTPS 地址"
      }
    }
    if (draft.mode === "manual") checkUrl(draft.proxyUrl, "proxyUrl")
    if (testing) checkUrl(target, "target")
    setInvalid(fields)
    return !Object.keys(fields).length
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy || !validate()) return
    setBusy("save")
    setError(undefined)
    try {
      const next = await api<NetworkView>("/api/system/network", {
        method: "PUT",
        body: JSON.stringify({ settings: input, revision: view.revision }),
      })
      setView(next)
      setDraft(next.settings)
      setPassword(undefined)
      setSaved(true)
      setResult(undefined)
    } catch (error) {
      setError(error as Error)
    } finally {
      setBusy(undefined)
    }
  }
  async function testConnection() {
    if (busy || !validate(true)) return
    setBusy("test")
    setError(undefined)
    setResult(undefined)
    try {
      setResult(
        await api<{ status: number; durationMs: number }>(
          "/api/system/network/test",
          {
            method: "POST",
            body: JSON.stringify({ settings: input, url: target }),
          }
        )
      )
    } catch (error) {
      setError(error as Error)
    } finally {
      setBusy(undefined)
    }
  }
  async function certificate() {
    if (busy) return
    setBusy("certificate")
    setError(undefined)
    try {
      if (!desktop) {
        certificateInput.current?.click()
        return
      }
      const file = await desktop.selectCertificate()
      if (file) change({ caFile: file })
    } catch (error) {
      setError(error as Error)
    } finally {
      setBusy(undefined)
    }
  }
  async function restart(mode: "wait" | "stop") {
    if (busy) return
    setBusy("restart")
    setError(undefined)
    try {
      await api("/api/system/lifecycle", {
        method: "POST",
        body: JSON.stringify({ action: "restart", mode }),
      })
      setConfirmRestart(false)
    } catch (error) {
      setError(error as Error)
    } finally {
      setBusy(undefined)
    }
  }
  return (
    <form
      onSubmit={save}
      noValidate
      className="flex w-full max-w-2xl min-w-0 flex-col gap-5"
    >
      <Failure
        error={error ?? (initial.error ? new Error(initial.error) : undefined)}
      />
      <Input
        ref={certificateInput}
        type="file"
        accept=".pem,.crt,.cer"
        className="hidden"
        aria-label="上传 CA 证书"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (!file) return
          if (file.size > 2 * 1024 * 1024) {
            setError(new Error("证书不能超过 2 MiB"))
            return
          }
          setBusy("certificate")
          void file
            .text()
            .then((pem) =>
              api<{ path: string }>("/api/system/certificates", {
                method: "POST",
                body: JSON.stringify({ pem }),
              })
            )
            .then((result) => change({ caFile: result.path }))
            .catch(setError)
            .finally(() => setBusy(undefined))
        }}
      />
      <FieldSet className="min-w-0" disabled={!!busy}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="network-mode">代理模式</FieldLabel>
            <Choice
              id="network-mode"
              label="代理模式"
              value={draft.mode}
              disabled={!!busy}
              options={[
                { value: "environment", label: "继承环境代理" },
                { value: "manual", label: "手动代理" },
                { value: "direct", label: "不使用代理" },
              ]}
              onChange={(mode) =>
                change({ mode: mode as NetworkSettings["mode"] })
              }
            />
            {draft.mode === "environment" && (
              <FieldDescription>
                使用启动应用时的 HTTP_PROXY、HTTPS_PROXY 和 NO_PROXY 环境变量。
              </FieldDescription>
            )}
          </Field>
          {draft.mode === "manual" && (
            <>
              <Field data-invalid={!!invalid.proxyUrl}>
                <FieldLabel htmlFor="network-proxy">代理地址</FieldLabel>
                <Input
                  id="network-proxy"
                  value={draft.proxyUrl}
                  onChange={(event) => change({ proxyUrl: event.target.value })}
                  aria-invalid={!!invalid.proxyUrl}
                  aria-describedby={
                    invalid.proxyUrl ? "network-proxy-error" : undefined
                  }
                  placeholder="http://proxy.example.com:8080"
                  autoComplete="off"
                />
                <FieldError id="network-proxy-error">
                  {invalid.proxyUrl}
                </FieldError>
              </Field>
              <FieldGroup className="sm:grid sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="network-username">代理用户名</FieldLabel>
                  <Input
                    id="network-username"
                    value={draft.proxyUsername}
                    onChange={(event) =>
                      change({ proxyUsername: event.target.value })
                    }
                    autoComplete="off"
                    placeholder="可选"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="network-password">代理密码</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="network-password"
                      type="password"
                      value={password ?? ""}
                      autoComplete="new-password"
                      placeholder={
                        password === ""
                          ? "保存后清除密码"
                          : view.hasPassword
                            ? "已配置，留空保留"
                            : "未配置"
                      }
                      onChange={(event) => {
                        setPassword(event.target.value || undefined)
                        setResult(undefined)
                        setSaved(false)
                      }}
                    />
                    {(view.hasPassword || !!password) && (
                      <InputGroupAddon align="inline-end">
                        <IconButton
                          type="button"
                          label="清除代理密码"
                          disabled={!!busy}
                          onClick={() => {
                            setPassword("")
                            setResult(undefined)
                            setSaved(false)
                          }}
                        >
                          <Trash2 />
                        </IconButton>
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                </Field>
              </FieldGroup>
            </>
          )}
          <Field>
            <FieldLabel htmlFor="network-no-proxy">绕过代理的地址</FieldLabel>
            <Input
              id="network-no-proxy"
              value={draft.noProxy}
              onChange={(event) => change({ noProxy: event.target.value })}
              placeholder=".example.com,10.0.0.1"
            />
            <FieldDescription>
              多个地址以逗号分隔；localhost 和本地回环地址始终直连。
            </FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="network-system-ca"
              checked={draft.useSystemCa}
              disabled={!!busy}
              onCheckedChange={(useSystemCa) =>
                change({ useSystemCa: !!useSystemCa })
              }
            />
            <FieldLabel htmlFor="network-system-ca">
              信任系统证书（含企业 CA）
            </FieldLabel>
          </Field>
          <Field>
            <FieldLabel htmlFor="network-ca">附加 CA 证书</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="network-ca"
                value={draft.caFile}
                onChange={(event) => change({ caFile: event.target.value })}
                placeholder="PEM 证书文件的绝对路径，可选"
              />
              <InputGroupAddon align="inline-end">
                <IconButton
                  type="button"
                  label="选择 CA 证书"
                  disabled={!!busy}
                  onClick={() => void certificate()}
                >
                  <FileInput />
                </IconButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>
              证书设置用于 Node 网关和连接测试；附加 CA 也用于支持 Node
              证书设置的 Agent。应用更新的企业根证书需安装到操作系统。
            </FieldDescription>
          </Field>
          <Field data-invalid={!!invalid.target}>
            <FieldLabel htmlFor="network-target">测试目标 URL</FieldLabel>
            <Input
              id="network-target"
              value={target}
              onChange={(event) => {
                setTarget(event.target.value)
                setResult(undefined)
                setInvalid({})
              }}
              aria-invalid={!!invalid.target}
              aria-describedby={
                invalid.target ? "network-target-error" : undefined
              }
            />
            <FieldError id="network-target-error">{invalid.target}</FieldError>
            <FieldDescription>
              使用当前表单测试，不改变正在运行的网络设置。
            </FieldDescription>
          </Field>
        </FieldGroup>
      </FieldSet>
      {result && (
        <Notice
          title={
            result.status >= 200 && result.status < 400
              ? "连接成功"
              : "服务器返回错误"
          }
          variant={result.status >= 400 ? "destructive" : "default"}
        >
          网关连接：HTTP {result.status} · {result.durationMs} ms。Agent
          的模型连接请在模型页单独测试。
        </Notice>
      )}
      {(saved || view.restartRequired) && (
        <Notice
          title={
            view.restartRequired
              ? "网络设置已保存，重启后生效"
              : "网络设置已保存"
          }
        >
          {view.restartRequired &&
            "重启会进入现有退出流程，可等待任务完成或停止任务。"}
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!!busy}
          onClick={() => void testConnection()}
        >
          <Zap data-icon="inline-start" />
          {busy === "test" ? "测试中" : "测试连接"}
        </Button>
        <Button type="submit" disabled={!!busy || !dirty}>
          <Save data-icon="inline-start" />
          {busy === "save" ? "保存中" : "保存"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!!busy}
          onClick={async () => {
            setBusy("refresh")
            try {
              const next = await api<NetworkView>("/api/system/network")
              setView(next)
              setDraft(next.settings)
              setPassword(undefined)
              setError(undefined)
              setSaved(false)
            } catch (error) {
              setError(error as Error)
            } finally {
              setBusy(undefined)
            }
          }}
        >
          重新加载
        </Button>
        {
          <Button
            type="button"
            variant="outline"
            disabled={!!busy || dirty}
            onClick={() => setConfirmRestart(true)}
          >
            <RefreshCw data-icon="inline-start" />
            {view.restartRequired ? "应用设置并重启服务" : "重启服务"}
          </Button>
        }
      </div>
      <p className="text-sm text-muted-foreground">
        代理凭据保护：
        {view.protection === "os" ? "系统密钥存储" : "实例私有文件"}
        。运行中的连接使用已生效配置。
      </p>
      <Dialog open={confirmRestart} onOpenChange={setConfirmRestart}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>应用网络设置并重启服务？</DialogTitle>
            <DialogDescription>
              等待期间仍可处理审批。停止会取消排队任务和当前执行；历史记录保留。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmRestart(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={!!busy}
              onClick={() => void restart("wait")}
            >
              等待任务完成
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!!busy}
              onClick={() => void restart("stop")}
            >
              停止任务后重启
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  )
}
