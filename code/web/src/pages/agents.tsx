import { useContext, useEffect, useRef, useState } from "react"
import {
  NavLink,
  useParams,
  useNavigate,
  useSearchParams,
} from "react-router-dom"
import {
  Bot,
  ArrowLeft,
  ArrowRight,
  Check,
  FileInput,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Square,
  Trash2,
  Unplug,
  Zap,
  Undo2,
} from "lucide-react"
import {
  agentIds,
  settingsSchema,
  type AgentId,
  type AgentView,
  type SettingsView,
  type Settings,
  type AgentConfiguration,
} from "../../../shared/settings"
import type { RuntimeView } from "../../../shared/runtimes"
import { api, ApiError, useQuery } from "@/lib/api"
import { GatewayContext } from "@/lib/gateway"
import { agentNames as names, useAgentDraft } from "@/lib/agent-draft"
import {
  Blank,
  Choice,
  ConfirmDialog,
  Failure,
  IconButton,
  Status,
  Notice,
} from "@/components/workspace-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { EntryEditor } from "./resource-editor"
import { RuntimeInstaller } from "./runtime-installer"

const modelKey = (model: { providerID: string; modelID: string }) =>
  JSON.stringify([model.providerID, model.modelID])
type Resource = "providers" | "skills" | "mcp"
type Imported = Pick<Settings, Resource> & { warnings: string[] }

export function Agents() {
  const { id } = useParams()
  const { revision } = useContext(GatewayContext)
  const query = useQuery<SettingsView>("/api/settings")
  const agents = useQuery<{ agents: AgentView[] }>("/api/agents", revision)
  const runtimes = useQuery<{ runtimes: RuntimeView[] }>(
    "/api/runtimes",
    revision
  )
  const operating = runtimes.data?.runtimes.some((runtime) => runtime.operation)
  const wasOperating = useRef(false)
  const reloadSettings = query.reload
  const reloadAgents = agents.reload
  useEffect(() => {
    if (wasOperating.current && !operating) {
      reloadSettings()
      reloadAgents()
    }
    wasOperating.current = !!operating
  }, [operating, reloadSettings, reloadAgents])
  useEffect(() => {
    if (!operating) return
    const timer = setInterval(runtimes.reload, 1500)
    return () => clearInterval(timer)
  }, [operating, runtimes.reload])
  return (
    <div className="page agents-page">
      <div className="page-heading">
        <h1>
          {id === "resources"
            ? "共享资源"
            : id && names[id]
              ? names[id]
              : "Agent 管理"}
        </h1>
        <Button variant="outline" size="sm"
          onClick={() => {
            query.reload()
            agents.reload()
            runtimes.reload()
          }}
        >
          刷新 Agent 配置
        </Button>
      </div>
      <Failure error={query.error ?? agents.error} />
      {query.data && agents.data ? (
        <AgentsEditor
          key={query.data.revision}
          initial={query.data}
          agents={agents.data.agents}
          refresh={agents.reload}
          runtimes={runtimes.data?.runtimes}
          runtimeError={runtimes.error}
          refreshRuntimes={runtimes.reload}
        />
      ) : (
        <Skeleton className="h-72" />
      )}
    </div>
  )
}

function AgentsEditor({
  initial,
  agents,
  refresh,
  runtimes,
  runtimeError,
  refreshRuntimes,
}: {
  initial: SettingsView
  agents: AgentView[]
  refresh: () => void
  runtimes?: RuntimeView[]
  runtimeError?: Error
  refreshRuntimes: () => void
}) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const resourceTab =
    (["providers", "skills", "mcp"] as const).find(
      (tab) => tab === params.get("tab")
    ) ?? "providers"
  const sourceAgent = agentIds.find((agent) => agent === params.get("agent"))
  const [view, setView] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error>()
  const [editing, setEditing] = useState<{ kind: Resource; id?: string }>()
  const [editorDirty, setEditorDirty] = useState(false)
  const [confirmation, setConfirmation] = useState<{
    title: string
    description: string
    run: () => Promise<void>
  }>()
  const [importing, setImporting] = useState(false)
  const [file, setFile] = useState("")
  const [preview, setPreview] = useState<Imported>()
  const [testing, setTesting] = useState<string>()
  const [testModels, setTestModels] = useState<Record<string, string>>({})
  const [testResults, setTestResults] = useState<
    Record<
      string,
      { revision: string; model: string; message: string; failed: boolean }
    >
  >({})
  const settings = view.settings
  const selected = settings.agents.find((a) => a.id === id)
  const state = agents.find((a) => a.id === id)
  const selectedRuntime = runtimes?.find((runtime) => runtime.id === id)
  async function save(next: Settings) {
    if (busy) return false
    setBusy(true)
    setError(undefined)
    try {
      const result = await api<SettingsView>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          settings: settingsSchema.parse(next),
          revision: view.revision,
        }),
      })
      setView(result)
      refresh()
      return true
    } catch (e) {
      setError(e as Error)
      return false
    } finally {
      setBusy(false)
    }
  }
  async function action(
    agent: AgentId,
    action: "enable" | "disable" | "stop" | "apply"
  ) {
    setBusy(true)
    setError(undefined)
    try {
      await api(`/api/agents/${agent}/actions`, {
        method: "POST",
        body: JSON.stringify({ action }),
      })
      setView(await api<SettingsView>("/api/settings"))
      refresh()
    } catch (e) {
      setError(e as Error)
    } finally {
      setBusy(false)
      setConfirmation(undefined)
    }
  }
  function requestAction(
    agent: AgentId,
    operation: "enable" | "disable" | "stop" | "apply"
  ) {
    const current = agents.find((item) => item.id === agent)!
    if (current.activeRuns || current.queuedRuns) {
      setConfirmation({
        title: `${operation === "apply" ? "应用配置" : operation === "enable" ? "启用" : "停用"} ${names[agent]}`,
        description: `取消 ${current.queuedRuns} 个排队任务${current.activeRuns ? `，等待 ${current.activeRuns} 个正在执行的任务结束` : ""}后更新 Agent。`,
        run: () => action(agent, operation),
      })
    } else void action(agent, operation)
  }
  function remove(kind: Resource, resourceId: string) {
    const references = settings.agents.filter((a) =>
      kind === "providers"
        ? a.models.some((m) => m.providerID === resourceId)
        : a[kind === "skills" ? "skillIds" : "mcpIds"].includes(resourceId)
    )
    if (references.length) {
      setError(
        new Error(
          `先解除 Agent 引用：${references.map((a) => names[a.id]).join("、")}`
        )
      )
      return
    }
    setConfirmation({
      title: `删除 ${resourceId}`,
      description: "删除共享配置，保留磁盘上的原始文件。",
      run: async () => {
        if (
          await save({
            ...settings,
            [kind]: settings[kind].filter((item) => item.id !== resourceId),
          })
        )
          setConfirmation(undefined)
      },
    })
  }
  function resources(kind: Resource) {
    const items = settings[kind]
    return (
      <section className="settings-section">
        <div className="settings-section-heading">
          <h2>
            {kind === "providers"
              ? "OpenAI 兼容连接"
              : kind === "skills"
                ? "Skills"
                : "MCP 服务"}
          </h2>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setEditorDirty(false)
              setEditing({ kind })
            }}
          >
            <Plus />
            添加
          </Button>
        </div>
        {!items.length ? (
          <Blank>
            {kind === "providers"
              ? "尚未添加模型连接"
              : kind === "skills"
                ? "尚未添加 Skill"
                : "尚未添加 MCP 服务"}
          </Blank>
        ) : (
          <Table className="stacked-table settings-list">
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>配置</TableHead>
                <TableHead>引用</TableHead>
                <TableHead>启用</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <strong>{item.id}</strong>
                  </TableCell>
                  <TableCell
                    data-label="配置"
                    className="max-w-lg break-all whitespace-normal"
                  >
                    {"baseUrl" in item ? (
                      <>
                        {item.baseUrl}
                        <div className="text-muted-foreground">
                          {item.api === "openai-responses"
                            ? "Responses"
                            : "Chat Completions"}{" "}
                          · {item.models.map((m) => m.id).join(", ")}
                        </div>
                      </>
                    ) : "path" in item ? (
                      item.path
                    ) : item.config.type === "remote" ? (
                      item.config.url
                    ) : (
                      item.config.command.join(" ")
                    )}
                  </TableCell>
                  <TableCell data-label="引用">
                    {settings.agents
                      .filter((a) =>
                        kind === "providers"
                          ? a.models.some((m) => m.providerID === item.id)
                          : a[
                              kind === "skills" ? "skillIds" : "mcpIds"
                            ].includes(item.id)
                      )
                      .map((a) => (
                        <NavLink
                          className="block text-primary underline underline-offset-4"
                          key={a.id}
                          to={`/agents/${a.id}?tab=${kind === "providers" ? "models" : kind}`}
                        >
                          {names[a.id]}
                        </NavLink>
                      ))}
                  </TableCell>
                  <TableCell data-label="启用">
                    <Switch
                      aria-label={`启用 ${item.id}`}
                      checked={item.enabled}
                      disabled={busy}
                      onCheckedChange={(enabled) =>
                        void save({
                          ...settings,
                          [kind]: items.map((entry) =>
                            entry.id === item.id ? { ...entry, enabled } : entry
                          ),
                        })
                      }
                    />
                  </TableCell>
                  <TableCell data-label="操作">
                    <div className="flex flex-wrap gap-1">
                      <IconButton
                        label={`编辑 ${item.id}`}
                        disabled={busy}
                        onClick={() => {
                          setEditorDirty(false)
                          setEditing({ kind, id: item.id })
                        }}
                      >
                        <Pencil />
                      </IconButton>
                      {"baseUrl" in item && (
                        <div className="provider-test">
                          <Choice
                            label={`测试模型 ${item.id}`}
                            value={
                              item.models.some(
                                (m) => m.id === testModels[item.id]
                              )
                                ? testModels[item.id]
                                : item.models[0].id
                            }
                            options={item.models.map((m) => ({
                              value: m.id,
                              label: m.name || m.id,
                            }))}
                            disabled={!!testing}
                            onChange={(value) =>
                              setTestModels({ ...testModels, [item.id]: value })
                            }
                          />
                          <IconButton
                            label={`测试连接 ${item.id}`}
                            disabled={busy || !!testing}
                            onClick={() => {
                              setTesting(item.id)
                              setError(undefined)
                              const model = item.models.some(
                                (m) => m.id === testModels[item.id]
                              )
                                ? testModels[item.id]
                                : item.models[0].id
                              void api<{ durationMs: number }>(
                                `/api/providers/${encodeURIComponent(item.id)}/test`,
                                {
                                  method: "POST",
                                  body: JSON.stringify({
                                    modelID: model,
                                  }),
                                }
                              )
                                .then(
                                  (result) =>
                                    setTestResults((previous) => ({
                                      ...previous,
                                      [item.id]: {
                                        revision: view.revision,
                                        model,
                                        message: `连接成功 · ${result.durationMs} ms`,
                                        failed: false,
                                      },
                                    })),
                                  (e) =>
                                    setTestResults((previous) => ({
                                      ...previous,
                                      [item.id]: {
                                        revision: view.revision,
                                        model,
                                        message: (e as Error).message,
                                        failed: true,
                                      },
                                    }))
                                )
                                .finally(() => setTesting(undefined))
                            }}
                          >
                            {testing === item.id ? (
                              <LoaderCircle className="animate-spin" />
                            ) : (
                              <Zap />
                            )}
                          </IconButton>
                          {testResults[item.id]?.revision === view.revision && (
                            <p
                              role="status"
                              className={
                                testResults[item.id].failed
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                              }
                            >
                              {testResults[item.id].model} ·{" "}
                              {testResults[item.id].message}
                            </p>
                          )}
                        </div>
                      )}
                      <IconButton
                        label={`删除 ${item.id}`}
                        disabled={busy}
                        onClick={() => remove(kind, item.id)}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    )
  }
  async function importPreview() {
    if (!selected) return
    setBusy(true)
    setError(undefined)
    try {
      setPreview(
        await api<Imported>(`/api/agents/${selected.id}/import`, {
          method: "POST",
          body: JSON.stringify({ file }),
        })
      )
    } catch (e) {
      setError(e as Error)
    } finally {
      setBusy(false)
    }
  }
  async function acceptImport() {
    if (!preview || !selected) return
    const next = structuredClone(settings)
    for (const kind of ["providers", "skills", "mcp"] as const)
      for (const item of preview[kind]) {
        if (next[kind].some((existing) => existing.id === item.id)) {
          setError(new Error(`名称冲突：${item.id}`))
          return
        }
      }
    next.providers.push(...preview.providers)
    next.skills.push(...preview.skills)
    next.mcp.push(...preview.mcp)
    const agent = next.agents.find((a) => a.id === selected.id)!
    agent.models.push(
      ...preview.providers.flatMap((p) =>
        p.models.map((m) => ({ providerID: p.id, modelID: m.id }))
      )
    )
    agent.defaultModel ??= agent.models[0] ?? null
    agent.skillIds.push(...preview.skills.map((s) => s.id))
    agent.mcpIds.push(...preview.mcp.map((m) => m.id))
    if (await save(next)) {
      setImporting(false)
      setPreview(undefined)
    }
  }
  return (
    <>
      {!editing && !importing && !confirmation && <Failure error={error} />}
      {id && id !== "resources" && (
        <nav className="agent-navigation" aria-label="Agent 管理">
          <NavLink end to="/agents">
            <ArrowLeft />
            全部 Agents
          </NavLink>
          <Choice
            label="选择 Agent"
            value={id}
            onChange={(value) => navigate(`/agents/${value}`)}
            options={agentIds.map((value) => ({ value, label: names[value] }))}
          />
        </nav>
      )}
      {id === "resources" && sourceAgent && (
        <NavLink
          className="back-link mb-4"
          to={`/agents/${sourceAgent}?tab=${resourceTab === "providers" ? "models" : resourceTab}`}
        >
          <ArrowLeft />
          返回 {names[sourceAgent]} 配置
        </NavLink>
      )}
      {!id ? (
        <>
          <div className="agent-default">
            <FieldLabel htmlFor="default-agent">新任务默认 Agent</FieldLabel>
            <Choice
              id="default-agent"
              label="默认 Agent"
              value={settings.defaultAgent}
              onChange={(defaultAgent) =>
                void save({
                  ...settings,
                  defaultAgent: defaultAgent as AgentId,
                })
              }
              disabled={busy}
              options={agentIds.map((value) => ({
                value,
                label: names[value],
              }))}
            />
          </div>
          <Table className="stacked-table">
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>安装与版本</TableHead>
                <TableHead>默认模型</TableHead>
                <TableHead>执行 / 排队</TableHead>
                <TableHead>配置</TableHead>
                <TableHead>启用</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => {
                const saved = settings.agents.find((a) => a.id === agent.id)!
                const installed = runtimes?.find(
                  (runtime) => runtime.id === agent.id
                )
                return (
                  <TableRow key={agent.id}>
                    <TableCell>
                      <NavLink
                        className="agent-name"
                        to={`/agents/${agent.id}`}
                      >
                        <Bot />
                        {names[agent.id]}
                      </NavLink>
                    </TableCell>
                    <TableCell data-label="状态">
                      <Status state={agent.health.status} />
                      {agent.error && (
                        <span className="block max-w-sm text-xs break-words text-destructive">
                          {agent.error}
                        </span>
                      )}
                    </TableCell>
                    <TableCell data-label="安装与版本">
                      <NavLink
                        to={`/agents/${agent.id}?tab=installation`}
                        className="text-primary underline underline-offset-4"
                      >
                        {!installed
                          ? "查看安装状态"
                          : installed.operation
                            ? "处理中"
                            : (installed.installedVersion ??
                              (installed.managed ? "安装最新版" : "主机 CLI"))}
                      </NavLink>
                    </TableCell>
                    <TableCell
                      data-label="默认模型"
                      className="max-w-64 break-all whitespace-normal"
                    >
                      {saved.defaultModel ? (
                        `${saved.defaultModel.providerID} / ${saved.defaultModel.modelID}`
                      ) : (
                        <NavLink
                          to={`/agents/${agent.id}?tab=models`}
                          className="text-primary underline underline-offset-4"
                        >
                          配置模型
                        </NavLink>
                      )}
                    </TableCell>
                    <TableCell data-label="执行 / 排队">
                      {agent.activeRuns} / {agent.queuedRuns}
                    </TableCell>
                    <TableCell data-label="配置">
                      {agent.operation
                        ? "处理中"
                        : !saved.defaultModel
                          ? "待配置模型"
                          : !agent.enabled
                            ? "启用后生效"
                            : agent.pendingChanges
                              ? "已保存待应用"
                              : "已生效"}
                    </TableCell>
                    <TableCell data-label="启用">
                      <Switch
                        aria-label={`启用 ${names[agent.id]}`}
                        checked={agent.enabled}
                        disabled={
                          busy ||
                          !!agent.operation ||
                          (!agent.enabled &&
                            (!saved.defaultModel ||
                              !installed ||
                              !installed.usable)) ||
                          !!installed?.operation
                        }
                        onCheckedChange={(enabled) =>
                          requestAction(
                            agent.id,
                            enabled ? "enable" : "disable"
                          )
                        }
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </>
      ) : id === "resources" ? (
        <Tabs
          value={resourceTab}
          onValueChange={(tab) =>
            setParams((previous) => {
              const next = new URLSearchParams(previous)
              next.set("tab", String(tab))
              return next
            })
          }
        >
          <TabsList variant="line">
            <TabsTrigger value="providers">模型连接</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
            <TabsTrigger value="mcp">MCP</TabsTrigger>
          </TabsList>
          {(["providers", "skills", "mcp"] as const).map((kind) => (
            <TabsContent value={kind} key={kind}>
              {resources(kind)}
            </TabsContent>
          ))}
        </Tabs>
      ) : selected && state ? (
        <>
          <div className="agent-detail-heading">
            <div>
              <Status state={state.health.status} />
              <span className="text-sm text-muted-foreground">
                {selected.defaultModel?.modelID ?? "尚未配置模型"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <IconButton
                label="导入原生配置"
                disabled={busy || !!state.operation}
                onClick={() => {
                  setImporting(true)
                  setPreview(undefined)
                  setError(undefined)
                }}
              >
                <FileInput />
              </IconButton>
              {state.enabled && (
                <Button
                  variant="outline"
                  disabled={busy || !!state.operation}
                  onClick={() => requestAction(selected.id, "disable")}
                >
                  {state.enabled ? <Unplug /> : <Play />}
                  {state.enabled ? "停用" : "启用"}
                </Button>
              )}
              {state.enabled && (
                <IconButton
                  label="立即停止"
                  disabled={
                    busy || (!!state.operation && !selectedRuntime?.operation)
                  }
                  onClick={() =>
                    setConfirmation({
                      title: `立即停止 ${names[selected.id]}`,
                      description: `中断 ${state.activeRuns} 个正在执行的任务，取消排队任务并停用 Agent。`,
                      run: () => action(selected.id, "stop"),
                    })
                  }
                >
                  <Square />
                </IconButton>
              )}
            </div>
          </div>
          {state.error && <Failure error={new Error(state.error)} />}
          <AgentEditor
            key={selected.id}
            agent={selected}
            state={state}
            installed={selectedRuntime}
            runtimeError={runtimeError}
            refreshRuntimes={refreshRuntimes}
            settings={settings}
            busy={busy || !!state.operation}
            save={async (agent) =>
              save({
                ...settings,
                agents: settings.agents.map((a) =>
                  a.id === agent.id ? agent : a
                ),
              })
            }
            resources={(kind) =>
              navigate(`/agents/resources?tab=${kind}&agent=${selected.id}`)
            }
            action={() =>
              requestAction(selected.id, state.enabled ? "apply" : "enable")
            }
          />
        </>
      ) : (
        <Blank>Agent 不存在</Blank>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !busy) {
            if (editorDirty) {
              setConfirmation({
                title: "放弃未保存的资源配置？",
                description: "已输入的资源配置将被清除。",
                run: async () => {
                  setEditing(undefined)
                  setEditorDirty(false)
                  setError(undefined)
                  setConfirmation(undefined)
                },
              })
              return
            }
            setEditing(undefined)
            setError(undefined)
          }
        }}
      >
        <DialogContent
          className="max-h-[90svh] overflow-y-auto sm:max-w-2xl"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>
              {editing?.id
                ? `编辑 ${editing.id}`
                : editing?.kind === "providers"
                  ? "添加模型连接"
                  : editing?.kind === "skills"
                    ? "添加 Skill"
                    : "添加 MCP 服务"}
            </DialogTitle>
          </DialogHeader>
          <Failure error={error} />
          {error instanceof ApiError && error.code === "CONFLICT" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                setConfirmation({
                  title: "加载最新配置并保留输入？",
                  description:
                    "再次保存会用当前表单替换此资源的配置，其他资源使用服务器最新版本。",
                  run: async () => {
                    try {
                      setView(await api<SettingsView>("/api/settings"))
                      setError(undefined)
                      setConfirmation(undefined)
                    } catch (e) {
                      setError(e as Error)
                    }
                  },
                })
              }
            >
              <RefreshCw />
              加载最新配置
            </Button>
          )}
          {editing && (
            <EntryEditor
              key={editing.kind + editing.id}
              kind={editing.kind}
              entry={settings[editing.kind].find(
                (item) => item.id === editing.id
              )}
              busy={busy}
              onDirtyChange={setEditorDirty}
              existingIds={settings[editing.kind].map((item) => item.id)}
              submit={async (entry) => {
                const kind = editing.kind
                if (
                  editing.id &&
                  !settings[kind].some((item) => item.id === editing.id)
                ) {
                  setError(
                    new Error(
                      "此资源已被删除。当前输入仍保留，请重新添加资源。"
                    )
                  )
                  return
                }
                if (
                  await save({
                    ...settings,
                    [kind]: editing.id
                      ? settings[kind].map((item) =>
                          item.id === editing.id ? entry : item
                        )
                      : [...settings[kind], entry],
                  })
                )
                  setEditing(undefined)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={importing}
        onOpenChange={(open) => {
          if (!busy) {
            setImporting(open)
            setError(undefined)
          }
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              导入 {selected && names[selected.id]} 配置
            </DialogTitle>
          </DialogHeader>
          <Failure error={error} />
          <Field>
            <FieldLabel htmlFor="import-file">原生配置文件</FieldLabel>
            <Input
              id="import-file"
              value={file}
              onChange={(e) => {
                setFile(e.target.value)
                setPreview(undefined)
              }}
              placeholder="/absolute/path/config.toml"
            />
          </Field>
          <Button
            variant="outline"
            disabled={busy || !file}
            onClick={() => void importPreview()}
          >
            <FileInput />
            读取预览
          </Button>
          {preview && (
            <>
              <dl className="agent-facts">
                {(["providers", "skills", "mcp"] as const).map((kind) => (
                  <div key={kind}>
                    <dt>{kind}</dt>
                    <dd>
                      {preview[kind].map((item) => item.id).join(", ") || "无"}
                    </dd>
                  </div>
                ))}
              </dl>
              {preview.warnings.map((warning, index) => (
                <p className="text-sm text-muted-foreground" key={index}>
                  {warning}
                </p>
              ))}
              <Button
                disabled={
                  busy ||
                  (!preview.providers.length &&
                    !preview.skills.length &&
                    !preview.mcp.length)
                }
                onClick={() => void acceptImport()}
              >
                <Check />
                确认导入
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        confirmLabel="确认"
        open={!!confirmation}
        title={confirmation?.title ?? "确认"}
        description={confirmation?.description}
        busy={busy}
        error={error}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmation(undefined)
            setError(undefined)
          }
        }}
        onConfirm={() => void confirmation?.run()}
      />
    </>
  )
}

function AgentEditor({
  agent,
  state,
  installed,
  runtimeError,
  refreshRuntimes,
  settings,
  busy,
  save,
  resources,
  action,
}: {
  agent: AgentConfiguration
  state: AgentView
  installed?: RuntimeView
  runtimeError?: Error
  refreshRuntimes: () => void
  settings: Settings
  busy: boolean
  save: (agent: AgentConfiguration) => Promise<boolean>
  resources: (kind: Resource) => void
  action: () => void
}) {
  const { runtime } = useContext(GatewayContext)
  const { draft, setDraft, dirty, conflict, reset, accept, rebase } =
    useAgentDraft(agent, runtime?.storeId ?? "unknown")
  const [params, setParams] = useSearchParams()
  const tab =
    ["models", "skills", "mcp", "runtime", "installation"].find(
      (value) => value === params.get("tab")
    ) ?? "models"
  const changeTab = (value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set("tab", value)
      return next
    })
  const configured =
    !!draft.defaultModel &&
    settings.providers.some(
      (p) =>
        p.enabled &&
        p.id === draft.defaultModel?.providerID &&
        p.models.some((m) => m.id === draft.defaultModel?.modelID)
    )
  async function commit(apply: boolean) {
    if (conflict) return
    if (dirty) {
      if (!(await save(draft))) return
      accept(draft)
    }
    if (apply) action()
  }
  const configurationStatus = state.operation
    ? {
        enable: "正在启用",
        disable: "正在停用",
        stop: "正在停止",
        apply: "正在应用配置",
      }[state.operation]
    : dirty
      ? "有未保存的更改"
      : state.error
        ? "操作失败"
        : !configured
          ? "待配置模型"
          : !state.enabled
            ? "已保存 · 启用后生效"
            : state.pendingChanges
              ? "已保存待应用"
              : "配置已生效"
  const availableModels = settings.providers
    .filter((p) => agent.id !== "codex" || p.api === "openai-responses")
    .flatMap((p) =>
      p.models.map((m) => ({
        providerID: p.id,
        modelID: m.id,
        name: m.name || m.id,
        enabled: p.enabled,
      }))
    )
  const options = availableModels
    .filter(
      (m) =>
        m.enabled && draft.models.some((ref) => modelKey(ref) === modelKey(m))
    )
    .map((m) => ({ value: modelKey(m), label: `${m.providerID} / ${m.name}` }))
  const refs = (kind: "skills" | "mcp") => {
    const field = kind === "skills" ? "skillIds" : "mcpIds"
    return (
      <section className="settings-section">
        <div className="settings-section-heading">
          <h2>{kind === "skills" ? "Skills" : "MCP 服务"}</h2>
          <Button variant="outline" onClick={() => resources(kind)}>
            <ArrowRight />
            共享资源
          </Button>
        </div>
        {!settings[kind].length ? (
          <Blank>暂无资源</Blank>
        ) : (
          settings[kind].map((resource) => (
            <label className="agent-resource-row" key={resource.id}>
              <Checkbox
                checked={draft[field].includes(resource.id)}
                disabled={
                  busy ||
                  (!resource.enabled && !draft[field].includes(resource.id))
                }
                onCheckedChange={(checked) =>
                  setDraft({
                    ...draft,
                    [field]: checked
                      ? [...draft[field], resource.id]
                      : draft[field].filter((id) => id !== resource.id),
                  })
                }
              />
              <strong>{resource.id}</strong>
              <span className="break-all">
                {"path" in resource
                  ? resource.path
                  : resource.config.type === "remote"
                    ? resource.config.url
                    : resource.config.command.join(" ")}
              </span>
              <span className="text-muted-foreground">
                {resource.enabled ? "" : "已停用"}
              </span>
            </label>
          ))
        )}
      </section>
    )
  }
  return (
    <>
      {conflict && (
        <Notice title="此 Agent 的配置已在其他位置修改">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={reset}>
              <Undo2 />
              使用已保存配置
            </Button>
            <Button variant="outline" onClick={rebase}>
              保留我的更改
            </Button>
          </div>
        </Notice>
      )}
      <Tabs value={tab} onValueChange={(value) => changeTab(String(value))}>
        <TabsList variant="line" className="h-auto flex-wrap">
          <TabsTrigger value="models">模型</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="mcp">MCP</TabsTrigger>
          <TabsTrigger value="runtime">运行</TabsTrigger>
          <TabsTrigger value="installation">安装与版本</TabsTrigger>
        </TabsList>
        <TabsContent value="installation">
          {tab === "installation" && (
            <RuntimeInstaller
              key={agent.id}
              runtime={installed}
              agent={state}
              error={runtimeError}
              reload={refreshRuntimes}
            />
          )}
        </TabsContent>
        <TabsContent value="runtime" className="agent-runtime">
          <Collapsible className="agent-diagnostics">
            <CollapsibleTrigger render={<Button variant="ghost" />}>
              <ArrowRight />
              运行诊断
            </CollapsibleTrigger>
            <CollapsibleContent>
              <dl className="agent-facts">
                <div>
                  <dt>配置目录</dt>
                  <dd>{state.directory}</dd>
                </div>
                <div>
                  <dt>原生配置</dt>
                  <dd>{state.configFile}</dd>
                </div>
                <div>
                  <dt>已保存版本</dt>
                  <dd>{state.savedRevision.slice(0, 12)}</dd>
                </div>
                <div>
                  <dt>已应用版本</dt>
                  <dd>
                    {state.appliedRevision?.slice(0, 12) ?? "未应用"}
                    {state.pendingChanges ? " · 待应用" : ""}
                  </dd>
                </div>
                <div>
                  <dt>执行 / 排队</dt>
                  <dd>
                    {state.activeRuns} / {state.queuedRuns}
                  </dd>
                </div>
                <div>
                  <dt>原生进程</dt>
                  <dd>{state.health.processes}</dd>
                </div>
                <div>
                  <dt>CLI 版本</dt>
                  <dd>{state.health.version ?? "未知"}</dd>
                </div>
                <div>
                  <dt>能力</dt>
                  <dd>
                    {[
                      state.capabilities.permissions && "权限审批",
                      state.capabilities.questions && "问题交互",
                      state.capabilities.recovery && "会话恢复",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </dd>
                </div>
              </dl>
            </CollapsibleContent>
          </Collapsible>
          <section className="settings-section">
            <h2>默认交互策略</h2>
            <div className="agent-policy">
              {(["permission", "question"] as const).map((kind) => (
                <Field key={kind}>
                  <FieldLabel>
                    {kind === "permission" ? "工具权限" : "问题回复"}
                  </FieldLabel>
                  <Choice
                    label={
                      kind === "permission" ? "默认权限策略" : "默认问题策略"
                    }
                    value={draft.interactionPolicy[kind]}
                    disabled={
                      busy ||
                      !state.capabilities[
                        kind === "permission" ? "permissions" : "questions"
                      ]
                    }
                    onChange={(value) =>
                      setDraft({
                        ...draft,
                        interactionPolicy: {
                          ...draft.interactionPolicy,
                          [kind]: value,
                        },
                      })
                    }
                    options={[
                      { value: "manual", label: "人工处理" },
                      { value: "auto", label: "自动处理" },
                    ]}
                  />
                </Field>
              ))}
            </div>
          </section>
        </TabsContent>
        <TabsContent value="models">
          <section className="settings-section">
            <div className="settings-section-heading">
              <h2>可用模型{agent.id === "codex" ? " · Responses" : ""}</h2>
              {availableModels.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => resources("providers")}
                >
                  <Plus />
                  模型连接
                </Button>
              )}
            </div>
            {availableModels.length ? (
              availableModels.map((model) => (
                <label className="agent-resource-row" key={modelKey(model)}>
                  <Checkbox
                    checked={draft.models.some(
                      (m) => modelKey(m) === modelKey(model)
                    )}
                    disabled={
                      busy ||
                      (!model.enabled &&
                        !draft.models.some(
                          (m) => modelKey(m) === modelKey(model)
                        ))
                    }
                    onCheckedChange={(checked) => {
                      const ref = {
                        providerID: model.providerID,
                        modelID: model.modelID,
                      }
                      const models = checked
                        ? [...draft.models, ref]
                        : draft.models.filter(
                            (m) => modelKey(m) !== modelKey(model)
                          )
                      const defaultModel =
                        draft.defaultModel &&
                        models.some(
                          (m) => modelKey(m) === modelKey(draft.defaultModel!)
                        )
                          ? draft.defaultModel
                          : (models[0] ?? null)
                      setDraft({ ...draft, models, defaultModel })
                    }}
                  />
                  <strong>{model.providerID}</strong>
                  <span>{model.name}</span>
                  {!model.enabled && (
                    <span className="text-muted-foreground">连接已停用</span>
                  )}
                </label>
              ))
            ) : (
              <Blank
                action={
                  <Button onClick={() => resources("providers")}>
                    <Plus />
                    添加模型连接
                  </Button>
                }
              >
                暂无兼容模型
                {agent.id === "codex" ? " · 需要 Responses 协议" : ""}
              </Blank>
            )}
            {availableModels.length > 0 && (
              <Field className="mt-6 max-w-xl">
                <FieldLabel>默认模型</FieldLabel>
                <Choice
                  label="Agent 默认模型"
                  value={draft.defaultModel ? modelKey(draft.defaultModel) : ""}
                  disabled={busy || !options.length}
                  options={
                    options.length ? options : [{ value: "", label: "未配置" }]
                  }
                  onChange={(value) => {
                    const model = availableModels.find(
                      (m) => modelKey(m) === value
                    )
                    if (model)
                      setDraft({
                        ...draft,
                        defaultModel: {
                          providerID: model.providerID,
                          modelID: model.modelID,
                        },
                      })
                  }}
                />
              </Field>
            )}
          </section>
        </TabsContent>
        <TabsContent value="skills">{refs("skills")}</TabsContent>
        <TabsContent value="mcp">{refs("mcp")}</TabsContent>
      </Tabs>
      <div
        className="config-action-bar"
        style={tab === "installation" ? { position: "static" } : undefined}
      >
        <span role="status" className="config-action-status">
          {configurationStatus}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <IconButton
            label="撤销更改"
            disabled={busy || !dirty}
            onClick={reset}
          >
            <Undo2 />
          </IconButton>
          <Button
            variant="outline"
            disabled={busy || !dirty || conflict}
            onClick={() => void commit(false)}
          >
            <Save />
            保存配置
          </Button>
          <Button
            disabled={
              busy ||
              conflict ||
              !configured ||
              (!state.enabled && (!installed || !installed.usable)) ||
              !!installed?.operation ||
              (state.enabled && !dirty && !state.pendingChanges && !state.error)
            }
            onClick={() => void commit(true)}
          >
            {busy ? (
              <LoaderCircle className="animate-spin" />
            ) : state.enabled ? (
              <Rocket />
            ) : (
              <Play />
            )}
            {state.operation
              ? "处理中"
              : dirty
                ? state.enabled
                  ? "保存并应用"
                  : "保存并启用"
                : state.enabled
                  ? "应用配置"
                  : "启用"}
          </Button>
        </div>
      </div>
    </>
  )
}
