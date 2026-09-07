import { useState, type FormEvent } from "react"
import {
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react"
import {
  settingsSchema,
  providerSchema,
  skillSchema,
  mcpSchema,
  type Settings as Configuration,
  type SettingsView,
} from "../../../shared/settings"
import { api, useQuery } from "@/lib/api"
import { Blank, Choice, Failure, IconButton } from "@/components/workspace-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"

export function Settings() {
  const query = useQuery<SettingsView>("/api/settings")
  return (
    <div className="page settings-page">
      <div className="page-heading">
        <h1>配置</h1>
        <IconButton label="刷新配置" onClick={query.reload}>
          <RefreshCw />
        </IconButton>
      </div>
      <Failure error={query.error} />
      {query.data ? (
        <SettingsEditor
          key={query.data.revision + query.data.packages.join()}
          initial={query.data}
        />
      ) : (
        !query.error && <Skeleton className="h-72" />
      )}
    </div>
  )
}

function SettingsEditor({ initial }: { initial: SettingsView }) {
  const [view, setView] = useState(initial)
  const [error, setError] = useState<Error>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [editing, setEditing] = useState<{
    kind: "providers" | "skills" | "mcp"
    id?: string
  }>()
  const [piPath, setPiPath] = useState(initial.settings.piConfigDirectory)
  const [openCodePath, setOpenCodePath] = useState(
    initial.settings.opencodeConfigFile
  )
  const [source, setSource] = useState("")
  const settings = view.settings
  async function save(next: Configuration) {
    setBusy(true)
    setError(undefined)
    setNotice("")
    try {
      const result = await api<SettingsView>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          settings: settingsSchema.parse(next),
          revision: view.revision,
        }),
      })
      setView(result)
      setEditing(undefined)
      setNotice("配置已保存")
      return true
    } catch (e) {
      setError(e as Error)
      return false
    } finally {
      setBusy(false)
    }
  }
  async function packageAction(
    action: "install" | "remove",
    packageSource: string
  ) {
    if (action === "remove" && !window.confirm(`卸载 ${packageSource}？`))
      return
    setBusy(true)
    setError(undefined)
    setNotice("")
    try {
      setView(
        await api<SettingsView>("/api/settings/pi/packages", {
          method: "POST",
          body: JSON.stringify({ action, source: packageSource }),
          signal: AbortSignal.timeout(135000),
        })
      )
      setSource("")
      setNotice(
        action === "install"
          ? "插件已安装，新建 Pi 任务后生效"
          : "插件已卸载，新建 Pi 任务后生效"
      )
    } catch (e) {
      setError(e as Error)
    } finally {
      setBusy(false)
    }
  }
  function rows(kind: "providers" | "skills" | "mcp") {
    const items = settings[kind]
    return (
      <>
        <div className="settings-section-heading">
          <h2>
            {kind === "providers"
              ? "OpenAI 兼容模型"
              : kind === "skills"
                ? "Skills"
                : "MCP · OpenCode"}
          </h2>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setEditing({ kind })}
          >
            <Plus data-icon="inline-start" />
            添加
          </Button>
        </div>
        {!items.length ? (
          editing?.kind !== kind && <Blank>暂无配置</Blank>
        ) : (
          <ul className="settings-list">
            {items.map((item) => (
              <li key={item.id}>
                <div className="min-w-0 flex-1">
                  <strong>{item.id}</strong>
                  <p className="text-sm break-all text-muted-foreground">
                    {"baseUrl" in item
                      ? `${item.baseUrl} · ${item.models.map((model) => model.id).join(", ")}`
                      : "path" in item
                        ? `${item.path} · ${item.engine}`
                        : item.config.type === "remote"
                          ? item.config.url
                          : item.config.command.join(" ")}
                  </p>
                </div>
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
                <IconButton
                  label={`编辑 ${item.id}`}
                  disabled={busy}
                  onClick={() => setEditing({ kind, id: item.id })}
                >
                  <Pencil />
                </IconButton>
                <IconButton
                  label={`删除 ${item.id}`}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`删除配置 ${item.id}？`))
                      void save({
                        ...settings,
                        [kind]: items.filter((entry) => entry.id !== item.id),
                      })
                  }}
                >
                  <Trash2 />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        {editing?.kind === kind && (
          <EntryEditor
            key={`${kind}:${editing.id ?? "new"}`}
            kind={kind}
            entry={items.find((item) => item.id === editing.id)}
            busy={busy}
            cancel={() => setEditing(undefined)}
            submit={async (entry) => {
              if (!editing.id && items.some((item) => item.id === entry.id)) {
                setError(new Error("名称已存在"))
                return
              }
              await save({
                ...settings,
                [kind]: editing.id
                  ? items.map((item) => (item.id === editing.id ? entry : item))
                  : [...items, entry],
              })
            }}
          />
        )}
      </>
    )
  }
  return (
    <>
      <Failure error={error} />
      <div role="status" className="settings-status">
        {busy ? "正在处理…" : notice}
        {view.restartRequired && (
          <p>
            OpenCode 配置待生效：需要重启网关并新建任务。Pi 变更对新建任务生效。
          </p>
        )}
        {view.externalOpenCode && (
          <p>
            当前连接外部 OpenCode；模型、Skill 和 MCP 配置需在该服务端应用。
          </p>
        )}
      </div>
      <Tabs defaultValue="models" onValueChange={() => setEditing(undefined)}>
        <TabsList variant="line" className="w-full justify-start border-b">
          <TabsTrigger value="models">模型</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="mcp">MCP</TabsTrigger>
          <TabsTrigger value="pi">Pi 插件</TabsTrigger>
        </TabsList>
        <TabsContent value="models">
          {view.environmentProvider && (
            <p className="py-3 text-sm text-muted-foreground">
              已加载 env 模型配置，同名供应商以 env 为准。
            </p>
          )}
          {rows("providers")}
          <form
            className="settings-section"
            onSubmit={(e) => {
              e.preventDefault()
              void save({ ...settings, opencodeConfigFile: openCodePath })
            }}
          >
            <h2>OpenCode 本地配置</h2>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="oc-path">
                  配置文件（留空使用原生默认配置）
                </FieldLabel>
                <Input
                  id="oc-path"
                  value={openCodePath}
                  onChange={(e) => setOpenCodePath(e.target.value)}
                  placeholder={view.local.opencode}
                />
              </Field>
            </FieldGroup>
            <div className="settings-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpenCodePath(view.local.opencode)}
              >
                使用个人配置
              </Button>
              <Button type="submit" disabled={busy}>
                <Save data-icon="inline-start" />
                保存
              </Button>
            </div>
          </form>
        </TabsContent>
        <TabsContent value="skills">{rows("skills")}</TabsContent>
        <TabsContent value="mcp">
          {rows("mcp")}
          <p className="py-4 text-sm text-muted-foreground">
            Pi MCP 由已安装插件提供，使用对应插件的配置文件。
          </p>
        </TabsContent>
        <TabsContent value="pi">
          <form
            className="settings-section"
            onSubmit={(e) => {
              e.preventDefault()
              void save({ ...settings, piConfigDirectory: piPath })
            }}
          >
            <h2>Pi 本地配置</h2>
            <Field>
              <FieldLabel htmlFor="pi-path">配置目录</FieldLabel>
              <Input
                id="pi-path"
                value={piPath}
                onChange={(e) => setPiPath(e.target.value)}
                placeholder={view.local.pi}
              />
            </Field>
            <p className="text-sm break-all text-muted-foreground">
              当前目录：{view.effectivePiDirectory}
            </p>
            <div className="settings-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPiPath(view.local.pi)}
              >
                使用个人配置
              </Button>
              <Button type="submit" disabled={busy}>
                <Save data-icon="inline-start" />
                保存
              </Button>
            </div>
          </form>
          <section className="settings-section">
            <h2>已安装插件</h2>
            {!view.packages.length ? (
              <Blank>暂无插件</Blank>
            ) : (
              <ul className="settings-list">
                {view.packages.map((item) => (
                  <li key={item}>
                    <span className="min-w-0 flex-1 break-all">{item}</span>
                    <IconButton
                      label={`卸载 ${item}`}
                      disabled={busy}
                      onClick={() => void packageAction("remove", item)}
                    >
                      <Trash2 />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void packageAction("install", source)
              }}
            >
              <Field>
                <FieldLabel htmlFor="package-source">插件来源</FieldLabel>
                <Input
                  id="package-source"
                  required
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="npm:package / git:host/repo / 绝对路径"
                />
              </Field>
              <div className="settings-actions">
                <Button type="submit" disabled={busy || !source}>
                  <Download data-icon="inline-start" />
                  安装插件
                </Button>
              </div>
            </form>
          </section>
        </TabsContent>
      </Tabs>
    </>
  )
}

type Entry =
  | Configuration["providers"][number]
  | Configuration["skills"][number]
  | Configuration["mcp"][number]
function EntryEditor({
  kind,
  entry,
  busy,
  cancel,
  submit,
}: {
  kind: "providers" | "skills" | "mcp"
  entry?: Entry
  busy: boolean
  cancel: () => void
  submit: (entry: Entry) => Promise<void>
}) {
  const [id, setId] = useState(entry?.id ?? "")
  const provider = entry && "baseUrl" in entry ? entry : undefined
  const skill = entry && "path" in entry ? entry : undefined
  const mcp = entry && "config" in entry ? entry : undefined
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "")
  const [key, setKey] = useState(provider?.apiKey ?? "")
  const [protocol, setProtocol] = useState(
    provider?.api ?? "openai-completions"
  )
  const [models, setModels] = useState(
    provider?.models ?? [
      { id: "", name: "", contextWindow: 128000, maxTokens: 16384 },
    ]
  )
  const [path, setPath] = useState(skill?.path ?? "")
  const [engine, setEngine] = useState(skill?.engine ?? "both")
  const [mcpType, setMcpType] = useState(mcp?.config.type ?? "local")
  const [endpoint, setEndpoint] = useState(
    mcp?.config.type === "remote" ? mcp.config.url : ""
  )
  const [command, setCommand] = useState(
    JSON.stringify(
      mcp?.config.type === "local" ? mcp.config.command : [],
      null,
      2
    )
  )
  const [secrets, setSecrets] = useState(
    JSON.stringify(
      mcp?.config.type === "local"
        ? mcp.config.environment
        : (mcp?.config.headers ?? {}),
      null,
      2
    )
  )
  const [error, setError] = useState<Error>()
  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    try {
      const enabled = entry?.enabled ?? true
      const result =
        kind === "providers"
          ? providerSchema.parse({
              id,
              baseUrl,
              apiKey: key,
              api: protocol,
              enabled,
              models: models.map((model) => ({
                ...model,
                id: model.id.trim(),
              })),
            })
          : kind === "skills"
            ? skillSchema.parse({ id, path, engine, enabled })
            : mcpSchema.parse({
                id,
                enabled,
                config:
                  mcpType === "local"
                    ? {
                        type: "local",
                        command: JSON.parse(command),
                        environment: JSON.parse(secrets),
                      }
                    : {
                        type: "remote",
                        url: endpoint,
                        headers: JSON.parse(secrets),
                      },
              })
      await submit(result)
    } catch (e) {
      setError(e as Error)
    }
  }
  return (
    <form className="settings-section" onSubmit={(e) => void onSubmit(e)}>
      <div className="settings-section-heading">
        <h2>{entry ? `编辑 ${entry.id}` : "添加配置"}</h2>
        <IconButton label="取消编辑" type="button" onClick={cancel}>
          <X />
        </IconButton>
      </div>
      <Failure error={error} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="entry-id">名称</FieldLabel>
          <Input
            id="entry-id"
            required
            pattern="[a-zA-Z0-9_-]+"
            disabled={!!entry}
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </Field>
        {kind === "providers" && (
          <>
            <Field>
              <FieldLabel htmlFor="base-url">Base URL</FieldLabel>
              <Input
                id="base-url"
                required
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="api-key">API Key</FieldLabel>
              <Input
                id="api-key"
                type="password"
                autoComplete="new-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="protocol">API 协议</FieldLabel>
              <Choice
                id="protocol"
                label="API 协议"
                value={protocol}
                onChange={(value) => setProtocol(value as typeof protocol)}
                options={[
                  { value: "openai-completions", label: "Chat Completions" },
                  { value: "openai-responses", label: "Responses" },
                ]}
              />
            </Field>
            <div className="settings-section-heading">
              <h2>模型</h2>
              <Button
                type="button"
                variant="outline"
                disabled={busy || models.length >= 100}
                onClick={() =>
                  setModels([
                    ...models,
                    {
                      id: "",
                      name: "",
                      contextWindow: 128000,
                      maxTokens: 16384,
                    },
                  ])
                }
              >
                <Plus data-icon="inline-start" />
                添加模型
              </Button>
            </div>
            {models.map((model, index) => (
              <div
                className="settings-model-row"
                key={index}
                role="group"
                aria-label={`模型 ${index + 1}`}
              >
                <Field>
                  <FieldLabel htmlFor={`model-${index}-id`}>模型 ID</FieldLabel>
                  <Input
                    id={`model-${index}-id`}
                    required
                    maxLength={200}
                    value={model.id}
                    onChange={(e) =>
                      setModels(
                        models.map((item, i) =>
                          i === index ? { ...item, id: e.target.value } : item
                        )
                      )
                    }
                  />
                </Field>
                {(
                  [
                    ["contextWindow", "上下文长度", 1024, 10000000],
                    ["maxTokens", "最大输出长度", 1, 1000000],
                  ] as const
                ).map(([key, label, min, max]) => (
                  <Field key={key}>
                    <FieldLabel htmlFor={`model-${index}-${key}`}>
                      {label}
                    </FieldLabel>
                    <Input
                      id={`model-${index}-${key}`}
                      type="number"
                      required
                      min={min}
                      max={max}
                      step={1}
                      value={Number.isNaN(model[key]) ? "" : model[key]}
                      onChange={(e) =>
                        setModels(
                          models.map((item, i) =>
                            i === index
                              ? { ...item, [key]: e.target.valueAsNumber }
                              : item
                          )
                        )
                      }
                    />
                  </Field>
                ))}
                <IconButton
                  type="button"
                  label={`删除模型 ${index + 1}`}
                  disabled={busy || models.length === 1}
                  onClick={() =>
                    setModels(models.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 />
                </IconButton>
              </div>
            ))}
          </>
        )}
        {kind === "skills" && (
          <>
            <Field>
              <FieldLabel htmlFor="skill-path">Skill 目录</FieldLabel>
              <Input
                id="skill-path"
                required
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/path/to/skills"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="skill-engine">引擎</FieldLabel>
              <Choice
                id="skill-engine"
                label="Skill 引擎"
                value={engine}
                onChange={(value) => setEngine(value as typeof engine)}
                options={[
                  { value: "both", label: "OpenCode + Pi" },
                  { value: "opencode", label: "OpenCode" },
                  { value: "pi", label: "Pi" },
                ]}
              />
            </Field>
          </>
        )}
        {kind === "mcp" && (
          <>
            <Field>
              <FieldLabel htmlFor="mcp-type">连接类型</FieldLabel>
              <Choice
                id="mcp-type"
                label="连接类型"
                value={mcpType}
                onChange={(value) => {
                  setMcpType(value as typeof mcpType)
                  setSecrets("{}")
                }}
                options={[
                  { value: "local", label: "本地 stdio" },
                  { value: "remote", label: "远程 HTTP" },
                ]}
              />
            </Field>
            {mcpType === "local" ? (
              <Field>
                <FieldLabel htmlFor="mcp-command">
                  命令和参数（JSON 数组）
                </FieldLabel>
                <Textarea
                  id="mcp-command"
                  required
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  rows={3}
                  placeholder={'["npx", "-y", "package"]'}
                />
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="mcp-url">MCP URL</FieldLabel>
                <Input
                  id="mcp-url"
                  required
                  type="url"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="mcp-secrets">
                {mcpType === "local" ? "环境变量" : "请求头"}（JSON 对象）
              </FieldLabel>
              <Textarea
                id="mcp-secrets"
                value={secrets}
                onChange={(e) => setSecrets(e.target.value)}
                rows={3}
                autoComplete="off"
              />
            </Field>
          </>
        )}
      </FieldGroup>
      <div className="settings-actions">
        <Button type="submit" disabled={busy}>
          <Save data-icon="inline-start" />
          保存配置
        </Button>
      </div>
    </form>
  )
}
