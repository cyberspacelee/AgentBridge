import { useRef, useState, type FormEvent } from "react"
import { ZodError } from "zod"
import { toast } from "sonner"
import {
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
  MoreHorizontal,
  LoaderCircle,
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
import {
  Blank,
  Choice,
  ConfirmDialog,
  Failure,
  IconButton,
  Notice,
} from "@/components/workspace-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
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
  const actionTrigger = useRef<HTMLElement | null>(null)
  const [confirmationFocus, setConfirmationFocus] =
    useState<HTMLElement | null>(null)
  const [confirmation, setConfirmation] = useState<{
    title: string
    description: string
    label: string
    execute: () => Promise<boolean>
  }>()
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
      setEditing(undefined)
      toast.success("配置已保存")
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
    if (busy) return false
    setBusy(true)
    setError(undefined)
    const notification = toast.loading(
      action === "install" ? "正在安装插件" : "正在卸载插件"
    )
    try {
      setView(
        await api<SettingsView>("/api/settings/pi/packages", {
          method: "POST",
          body: JSON.stringify({ action, source: packageSource }),
          signal: AbortSignal.timeout(135000),
        })
      )
      setSource("")
      toast.success(
        action === "install"
          ? "插件已安装，新建 Pi 任务后生效"
          : "插件已卸载，新建 Pi 任务后生效",
        { id: notification }
      )
      return true
    } catch (e) {
      setError(e as Error)
      toast.error(action === "install" ? "插件安装失败" : "插件卸载失败", {
        id: notification,
      })
      return false
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
            onClick={(event) => {
              actionTrigger.current = event.currentTarget
              setError(undefined)
              setEditing({ kind })
            }}
          >
            <Plus data-icon="inline-start" />
            添加
          </Button>
        </div>
        {!items.length ? (
          editing?.kind !== kind && <Blank>暂无配置</Blank>
        ) : (
          <Table className="stacked-table settings-list">
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>配置</TableHead>
                <TableHead>启用</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-48 break-all whitespace-normal">
                    <strong>{item.id}</strong>
                  </TableCell>
                  <TableCell
                    className="max-w-lg break-all whitespace-normal"
                    data-label="配置"
                  >
                    {"baseUrl" in item
                      ? `${item.baseUrl} · ${item.models.map((model) => model.id).join(", ")}`
                      : "path" in item
                        ? `${item.path} · ${item.engine}`
                        : item.config.type === "remote"
                          ? item.config.url
                          : item.config.command.join(" ")}
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
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <IconButton
                            label={`配置操作 ${item.id}`}
                            disabled={busy}
                          />
                        }
                        onClick={(event) => {
                          actionTrigger.current = event.currentTarget
                        }}
                      >
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            onClick={() => {
                              setError(undefined)
                              setEditing({ kind, id: item.id })
                            }}
                          >
                            <Pencil />
                            编辑 {item.id}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => {
                              setError(undefined)
                              setConfirmationFocus(actionTrigger.current)
                              setConfirmation({
                                title: `删除配置 ${item.id}`,
                                description:
                                  kind === "skills"
                                    ? "移除网关中的 Skill 引用，保留原目录及附件。原生配置中的引用不受影响。"
                                    : "删除网关中的此项配置。原生文件和环境变量配置不受影响；配置变更的生效范围保持不变。",
                                label: "确认删除",
                                execute: () =>
                                  save({
                                    ...settings,
                                    [kind]: items.filter(
                                      (entry) => entry.id !== item.id
                                    ),
                                  }),
                              })
                            }}
                          >
                            <Trash2 />
                            删除 {item.id}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {editing?.kind === kind && (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open && !busy) {
                setEditing(undefined)
                setError(undefined)
              }
            }}
          >
            <DialogContent
              className="max-h-[90svh] overflow-y-auto sm:max-w-2xl"
              showCloseButton={!busy}
              finalFocus={() => actionTrigger.current}
            >
              <DialogHeader>
                <DialogTitle>
                  {editing.id ? `编辑 ${editing.id}` : "添加配置"}
                </DialogTitle>
                <DialogDescription>
                  保存后应用到网关配置，具体生效范围见页面状态。
                </DialogDescription>
              </DialogHeader>
              <Failure error={error} />
              <EntryEditor
                key={`${kind}:${editing.id ?? "new"}`}
                kind={kind}
                entry={items.find((item) => item.id === editing.id)}
                existingIds={items.map((item) => item.id)}
                busy={busy}
                cancel={() => setEditing(undefined)}
                submit={async (entry) => {
                  if (
                    !editing.id &&
                    items.some((item) => item.id === entry.id)
                  ) {
                    setError(new Error("名称已存在"))
                    return
                  }
                  await save({
                    ...settings,
                    [kind]: editing.id
                      ? items.map((item) =>
                          item.id === editing.id ? entry : item
                        )
                      : [...items, entry],
                  })
                }}
              />
            </DialogContent>
          </Dialog>
        )}
      </>
    )
  }
  return (
    <>
      {!editing && !confirmation && <Failure error={error} />}
      <div className="flex flex-col gap-3">
        {view.restartRequired && (
          <Notice title="OpenCode 配置待生效">
            需要重启网关并新建任务。Pi 变更对新建任务生效。
          </Notice>
        )}
        {view.externalOpenCode && (
          <Notice title="当前连接外部 OpenCode">
            模型、Skill 和 MCP 配置需在该服务端应用。
          </Notice>
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
            <Notice title="已加载 env 模型配置">同名供应商以 env 为准。</Notice>
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
              <Table className="stacked-table settings-list">
                <TableHeader>
                  <TableRow>
                    <TableHead>插件来源</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.packages.map((item) => (
                    <TableRow key={item}>
                      <TableCell className="max-w-lg break-all whitespace-normal">
                        {item}
                      </TableCell>
                      <TableCell data-label="操作">
                        <IconButton
                          label={`卸载 ${item}`}
                          disabled={busy}
                          onClick={(event) => {
                            setError(undefined)
                            setConfirmationFocus(event.currentTarget)
                            setConfirmation({
                              title: `卸载 ${item}`,
                              description: `作用于 Pi 配置目录 ${view.effectivePiDirectory}。本地插件只移除引用；卸载后新建 Pi 任务生效。`,
                              label: "确认卸载",
                              execute: () => packageAction("remove", item),
                            })
                          }}
                        >
                          <Trash2 />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
      <ConfirmDialog
        open={!!confirmation}
        title={confirmation?.title ?? "确认操作"}
        description={confirmation?.description}
        confirmLabel={confirmation?.label ?? "确认"}
        busy={busy}
        error={error}
        finalFocus={confirmationFocus}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmation(undefined)
            setError(undefined)
          }
        }}
        onConfirm={() => {
          void confirmation?.execute().then((saved) => {
            if (saved) setConfirmation(undefined)
          })
        }}
      />
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
  existingIds,
}: {
  kind: "providers" | "skills" | "mcp"
  entry?: Entry
  busy: boolean
  cancel: () => void
  submit: (entry: Entry) => Promise<void>
  existingIds: string[]
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
  const [invalid, setInvalid] = useState<Record<string, string>>({})
  const fieldProps = (name: string) => ({
    "aria-invalid": !!invalid[name],
    "aria-describedby": invalid[name] ? `${name}-error` : undefined,
  })
  const fieldError = (name: string) => (
    <FieldError id={`${name}-error`}>{invalid[name]}</FieldError>
  )
  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(undefined)
    setInvalid({})
    if (!entry && existingIds.includes(id)) {
      setInvalid({ id: "名称已存在" })
      return
    }
    let jsonField = "config.command"
    try {
      const enabled = entry?.enabled ?? true
      let parsedCommand: unknown
      let parsedSecrets: unknown
      if (kind === "mcp") {
        if (mcpType === "local") parsedCommand = JSON.parse(command)
        jsonField =
          mcpType === "local" ? "config.environment" : "config.headers"
        parsedSecrets = JSON.parse(secrets)
      }
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
                        command: parsedCommand,
                        environment: parsedSecrets,
                      }
                    : {
                        type: "remote",
                        url: endpoint,
                        headers: parsedSecrets,
                      },
              })
      await submit(result)
    } catch (e) {
      if (e instanceof ZodError)
        setInvalid(
          Object.fromEntries(
            e.issues.map((issue) => {
              const path = issue.path.join(".")
              const name = path.startsWith("config.command")
                ? "config.command"
                : path.startsWith("config.environment")
                  ? "config.environment"
                  : path.startsWith("config.headers")
                    ? "config.headers"
                    : path
              return [name, issue.message]
            })
          )
        )
      else if (e instanceof SyntaxError)
        setInvalid({ [jsonField]: "JSON 格式不正确" })
      else setError(e as Error)
    }
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
      <div className="settings-section-heading">
        <IconButton
          label="取消编辑"
          type="button"
          disabled={busy}
          onClick={cancel}
        >
          <X />
        </IconButton>
      </div>
      <Failure error={error} />
      <FieldSet disabled={busy}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="entry-id">名称</FieldLabel>
            <Input
              id="entry-id"
              {...fieldProps("id")}
              required
              pattern="[a-zA-Z0-9_-]+"
              disabled={!!entry}
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
            {fieldError("id")}
          </Field>
          {kind === "providers" && (
            <>
              <Field>
                <FieldLabel htmlFor="base-url">Base URL</FieldLabel>
                <Input
                  id="base-url"
                  {...fieldProps("baseUrl")}
                  required
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                />
                {fieldError("baseUrl")}
              </Field>
              <Field>
                <FieldLabel htmlFor="api-key">API Key</FieldLabel>
                <Input
                  id="api-key"
                  {...fieldProps("apiKey")}
                  type="password"
                  autoComplete="new-password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
                {fieldError("apiKey")}
              </Field>
              <Field>
                <FieldLabel htmlFor="protocol">API 协议</FieldLabel>
                <Choice
                  id="protocol"
                  label="API 协议"
                  invalid={!!invalid.api}
                  aria-describedby={invalid.api ? "api-error" : undefined}
                  value={protocol}
                  onChange={(value) => setProtocol(value as typeof protocol)}
                  options={[
                    { value: "openai-completions", label: "Chat Completions" },
                    { value: "openai-responses", label: "Responses" },
                  ]}
                />
                {fieldError("api")}
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
              {fieldError("models")}
              {models.map((model, index) => (
                <div
                  className="settings-model-row"
                  key={index}
                  role="group"
                  aria-label={`模型 ${index + 1}`}
                >
                  <Field>
                    <FieldLabel htmlFor={`model-${index}-id`}>
                      模型 ID
                    </FieldLabel>
                    <Input
                      id={`model-${index}-id`}
                      {...fieldProps(`models.${index}.id`)}
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
                    {fieldError(`models.${index}.id`)}
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
                        {...fieldProps(`models.${index}.${key}`)}
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
                      {fieldError(`models.${index}.${key}`)}
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
                  {...fieldProps("path")}
                  required
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/path/to/skills"
                />
                {fieldError("path")}
              </Field>
              <Field>
                <FieldLabel htmlFor="skill-engine">引擎</FieldLabel>
                <Choice
                  id="skill-engine"
                  label="Skill 引擎"
                  invalid={!!invalid.engine}
                  aria-describedby={invalid.engine ? "engine-error" : undefined}
                  value={engine}
                  onChange={(value) => setEngine(value as typeof engine)}
                  options={[
                    { value: "both", label: "OpenCode + Pi" },
                    { value: "opencode", label: "OpenCode" },
                    { value: "pi", label: "Pi" },
                  ]}
                />
                {fieldError("engine")}
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
                    {...fieldProps("config.command")}
                    required
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    rows={3}
                    placeholder={'["npx", "-y", "package"]'}
                  />
                  {fieldError("config.command")}
                </Field>
              ) : (
                <Field>
                  <FieldLabel htmlFor="mcp-url">MCP URL</FieldLabel>
                  <Input
                    id="mcp-url"
                    {...fieldProps("config.url")}
                    required
                    type="url"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                  />
                  {fieldError("config.url")}
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="mcp-secrets">
                  {mcpType === "local" ? "环境变量" : "请求头"}（JSON 对象）
                </FieldLabel>
                <Textarea
                  id="mcp-secrets"
                  {...fieldProps(
                    mcpType === "local"
                      ? "config.environment"
                      : "config.headers"
                  )}
                  value={secrets}
                  onChange={(e) => setSecrets(e.target.value)}
                  rows={3}
                  autoComplete="off"
                />
                {fieldError(
                  mcpType === "local" ? "config.environment" : "config.headers"
                )}
              </Field>
            </>
          )}
        </FieldGroup>
      </FieldSet>
      <div className="settings-actions">
        <Button type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle
              data-icon="inline-start"
              className="motion-safe:animate-spin"
            />
          ) : (
            <Save data-icon="inline-start" />
          )}
          保存配置
        </Button>
      </div>
    </form>
  )
}
