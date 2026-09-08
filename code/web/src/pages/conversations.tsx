import { useLayoutEffect, useRef, useState, type FormEvent } from "react"
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom"
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  Plus,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
} from "lucide-react"
import type { ModelOption, Page, TaskSummary } from "../../../shared/contracts"
import { createTaskSchema } from "../../../shared/contracts"
import { useGateway } from "@/lib/gateway"
import { agentNames } from "@/lib/agent-draft"
import { submit, useQuery, useRequestSignal } from "@/lib/api"
import { desktop } from "@/lib/desktop"
import { DirectoryInput } from "@/components/directory-input"
import {
  Blank,
  Choice,
  Failure,
  labels,
  Status,
  Notice,
} from "@/components/workspace-ui"
import {
  InputGroup,
  InputGroupInput,
  InputGroupTextarea,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"

export function Conversations() {
  return (
    <div className="conversation-main">
      <Outlet />
    </div>
  )
}

const historyPositions = new Map<string, number>()

export function ConversationHistory() {
  const { revision } = useGateway()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const viewport = useRef<HTMLDivElement>(null)
  const queryParams = new URLSearchParams()
  for (const key of ["q", "status", "cursor"]) {
    const value = params.get(key)
    if (value) queryParams.set(key, value)
  }
  const listKey = queryParams.toString()
  const query = useQuery<Page<TaskSummary>>(
    `/api/tasks?${queryParams}`,
    revision
  )
  const [pinned, setPinned] = useState<{ key: string; ids: string[] }>()
  const current = new Map(query.data?.items.map((item) => [item.id, item]))
  const items =
    pinned?.key === listKey
      ? pinned.ids.flatMap((id) => current.get(id) ?? [])
      : query.data?.items
  const cursors: string[] = location.state?.cursors ?? []
  const searchQuery = params.get("q") ?? ""
  const [draft, setDraft] = useState({ query: searchQuery, text: searchQuery })
  if (draft.query !== searchQuery)
    setDraft({ query: searchQuery, text: searchQuery })
  useLayoutEffect(() => {
    if (!query.loading && viewport.current)
      viewport.current.scrollTop = historyPositions.get(listKey) ?? 0
  }, [listKey, query.loading])
  const update = (key: string, value: string, previous: string[] = []) => {
    const next = new URLSearchParams(params)
    next.delete("cursor")
    if (value) next.set(key, value)
    else next.delete(key)
    historyPositions.delete(next.toString())
    setParams(next, { state: { cursors: previous } })
  }
  const filtered = Boolean(searchQuery || params.get("status"))
  return (
    <section
      className="page conversation-history"
      aria-labelledby="history-title"
    >
      <div className="page-heading">
        <div>
          <h1 id="history-title">历史会话</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            查找之前的工作，继续尚未完成的会话。
          </p>
        </div>
        <Button render={<Link to="/conversations" />}>
          <Plus data-icon="inline-start" />
          新会话
        </Button>
      </div>
      <div className="history-toolbar">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            update("q", draft.text)
          }}
        >
          <InputGroup>
            <InputGroupInput
              aria-label="搜索会话"
              placeholder="搜索会话名称或 ID"
              value={draft.text}
              onChange={(event) =>
                setDraft({ query: searchQuery, text: event.target.value })
              }
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton type="submit" size="icon-sm" aria-label="搜索">
                <Search />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
        <Choice
          label="会话状态"
          value={params.get("status") ?? ""}
          options={[
            { value: "", label: "全部状态" },
            ...[
              "waiting_input",
              "running",
              "queued",
              "completed",
              "failed",
              "timed_out",
              "cancelled",
              "unavailable",
            ].map((value) => ({ value, label: labels[value] })),
          ]}
          onChange={(value) => update("status", value)}
        />
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => setParams({}, { state: { cursors: [] } })}
          >
            清除筛选
          </Button>
        )}
      </div>
      <Failure error={query.error} />
      {query.error && (
        <Button variant="outline" onClick={query.reload}>
          重新加载会话
        </Button>
      )}
      <div className="history-columns" aria-hidden="true">
        <span>会话 / 工作目录</span>
        <span>Agent</span>
        <span>状态</span>
        <span>更新时间</span>
      </div>
      <ScrollArea
        className="history-scroll"
        viewportProps={{
          ref: viewport,
          "aria-label": "会话列表",
          onScroll: (event) =>
            historyPositions.set(listKey, event.currentTarget.scrollTop),
        }}
      >
        <nav
          aria-label="会话列表"
          aria-busy={query.loading}
          onPointerEnter={() =>
            items &&
            setPinned({ key: listKey, ids: items.map((item) => item.id) })
          }
          onPointerLeave={(event) => {
            if (!event.currentTarget.contains(document.activeElement))
              setPinned(undefined)
          }}
          onFocusCapture={() =>
            items &&
            setPinned((previous) =>
              previous?.key === listKey
                ? previous
                : { key: listKey, ids: items.map((item) => item.id) }
            )
          }
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget) &&
              !event.currentTarget.matches(":hover")
            )
              setPinned(undefined)
          }}
        >
          {query.loading ? (
            <Skeleton className="h-40" />
          ) : (
            items?.map((task) => (
              <Link
                key={task.id}
                aria-label={task.title}
                className="conversation-link"
                to={`/conversations/${task.id}?return=${encodeURIComponent(`/conversations/history${listKey ? `?${listKey}` : ""}`)}`}
                state={{ cursors }}
              >
                <span className="history-summary">
                  <span className="history-title">{task.title}</span>
                  <span className="history-directory" title={task.directory}>
                    {task.directory}
                  </span>
                </span>
                <span className="history-agent">
                  {agentNames[task.engineId] ?? task.engineId}
                </span>
                <span className="history-status">
                  {task.status === "completed" ? (
                    <span className="history-completed">
                      <Check aria-hidden="true" />
                      已完成
                    </span>
                  ) : (
                    <Status state={task.status} />
                  )}
                </span>
                <time className="history-time" dateTime={task.updatedAt}>
                  {new Date(task.updatedAt).toLocaleString("zh-CN", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </Link>
            ))
          )}
          {!query.loading && !query.error && !query.data?.items.length && (
            <Blank
              action={
                filtered ? (
                  <Button variant="outline" onClick={() => setParams({})}>
                    清除筛选
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    render={<Link to="/conversations" />}
                  >
                    开始新会话
                  </Button>
                )
              }
            >
              {filtered ? "没有符合条件的会话" : "暂无会话"}
            </Blank>
          )}
        </nav>
      </ScrollArea>
      <div className="history-pagination">
        <span className="text-sm text-muted-foreground" role="status">
          {query.loading
            ? "正在加载"
            : `本页 ${query.data?.items.length ?? 0} 条 · 按创建时间排序`}
        </span>
        <Pagination aria-label="会话分页" className="mx-0 w-auto">
          <PaginationContent>
            {params.get("cursor") && !cursors.length ? (
              <PaginationItem>
                <Button variant="outline" onClick={() => update("cursor", "")}>
                  返回第一页
                </Button>
              </PaginationItem>
            ) : (
              <PaginationItem>
                <Button
                  variant="outline"
                  disabled={!cursors.length || query.loading}
                  onClick={() =>
                    update("cursor", cursors.at(-1) ?? "", cursors.slice(0, -1))
                  }
                >
                  <ArrowLeft data-icon="inline-start" />
                  上一页
                </Button>
              </PaginationItem>
            )}
            <PaginationItem>
              <Button
                variant="outline"
                disabled={
                  !query.data?.nextCursor ||
                  query.loading ||
                  Boolean(query.error)
                }
                onClick={() =>
                  update("cursor", query.data?.nextCursor ?? "", [
                    ...cursors,
                    params.get("cursor") ?? "",
                  ])
                }
              >
                下一页
                <ArrowRight data-icon="inline-end" />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </section>
  )
}

export function NewConversation() {
  const { runtime } = useGateway()
  const navigate = useNavigate()
  const ready = runtime?.engines.some(
    (engine) => engine.enabled !== false && engine.health.status === "ready"
  )
  return (
    <div className="new-conversation">
      <div className="new-conversation-content">
        {!runtime ? (
          <>
            <h1>新会话</h1>
            <Skeleton className="mt-6 h-64" />
          </>
        ) : ready ? (
          <>
            <header className="conversation-welcome">
              <h1>开始一段新的工作</h1>
              <p>描述你的目标，让 Agent 帮你推进。</p>
            </header>
            <CreateConversation
              onAccepted={(id) => navigate(`/conversations/${id}`)}
            />
          </>
        ) : (
          <Empty className="conversation-onboarding">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Bot aria-hidden="true" />
              </EmptyMedia>
              <h1>连接你的第一个 Agent</h1>
              <EmptyDescription>
                配置并启用一个 Agent，即可开始对话、处理工作并查看执行结果。
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button render={<Link to="/agents" />}>
                配置 Agent
                <ArrowRight data-icon="inline-end" />
              </Button>
              <Button
                variant="link"
                render={<Link to="/conversations/history" />}
              >
                查看历史会话
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </div>
    </div>
  )
}

function CreateConversation({
  onAccepted,
}: {
  onAccepted: (id: string) => void
}) {
  const requestSignal = useRequestSignal()
  const { runtime } = useGateway()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error>()
  const [invalid, setInvalid] = useState<Record<string, string>>({})
  const [directory, setDirectory] = useState("")
  const initialEngine =
    runtime?.engines.find(
      (item) => item.id === runtime.engine && item.health.status === "ready"
    ) ?? runtime?.engines.find((item) => item.health.status === "ready")
  const [manualPermission, setManualPermission] = useState(
    initialEngine?.interactionPolicy?.permission !== "auto"
  )
  const [manualQuestion, setManualQuestion] = useState(
    initialEngine?.interactionPolicy?.question !== "auto"
  )
  const [engineId, setEngineId] = useState(
    initialEngine?.id ?? runtime?.engine ?? "pi"
  )
  const [selectedProvider, setSelectedProvider] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const engine = runtime?.engines.find((item) => item.id === engineId)
  const catalog = useQuery<{ models: ModelOption[] }>(
    `/api/engines/${encodeURIComponent(engineId)}/models`
  )
  const models = catalog.error ? [] : (catalog.data?.models ?? [])
  const providers = [...new Set(models.map((model) => model.providerID))]
  const provider = providers.includes(selectedProvider)
    ? selectedProvider
    : providers.includes(engine?.defaultModel?.providerID ?? "")
      ? engine!.defaultModel!.providerID
      : (providers[0] ?? "")
  const providerModels = models.filter((model) => model.providerID === provider)
  const model = providerModels.some((item) => item.modelID === selectedModel)
    ? selectedModel
    : (providerModels.find(
        (item) => item.modelID === engine?.defaultModel?.modelID
      )?.modelID ??
      providerModels[0]?.modelID ??
      "")
  const canSubmit =
    engine?.health.status === "ready" &&
    !!provider &&
    !!model &&
    !catalog.loading &&
    !catalog.error
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !canSubmit) return
    const fields = new FormData(event.currentTarget)
    const result = createTaskSchema.safeParse({
      engineId,
      submissionId: "validate",
      title: String(fields.get("title") ?? ""),
      directory: String(fields.get("directory") ?? ""),
      parts: [{ type: "text", text: String(fields.get("prompt") ?? "") }],
      ...(provider || model
        ? { model: { providerID: provider, modelID: model } }
        : {}),
      interactionPolicy: {
        permission: manualPermission ? "manual" : "auto",
        question: manualQuestion ? "manual" : "auto",
      },
    })
    if (!result.success) {
      setInvalid(
        Object.fromEntries(
          result.error.issues.map((i) => [String(i.path[0]), i.message])
        )
      )
      return
    }
    setInvalid({})
    setError(undefined)
    const signal = requestSignal()
    setBusy(true)
    try {
      const { submissionId: _id, ...input } = result.data
      void _id
      const accepted = await submit(input, runtime!.storeId, undefined, signal)
      signal.throwIfAborted()
      onAccepted(accepted.taskId)
    } catch (e) {
      if (!signal.aborted) setError(e as Error)
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
  return (
    <form
      onSubmit={send}
      className="conversation-create-form"
      aria-label="新会话"
    >
      <FieldSet disabled={busy}>
        <FieldGroup>
          <Field data-invalid={!!invalid.parts}>
            <FieldLabel htmlFor="prompt" className="sr-only">
              消息
            </FieldLabel>
            <InputGroup className="conversation-composer">
              <InputGroupTextarea
                id="prompt"
                aria-invalid={!!invalid.parts}
                aria-describedby={invalid.parts ? "prompt-error" : undefined}
                name="prompt"
                required
                className="max-h-72 min-h-36 px-5 pt-5"
                rows={4}
                placeholder="你想完成什么？"
              />
              <InputGroupAddon
                align="block-end"
                className="flex-wrap justify-between gap-3 px-4 pb-4"
              >
                <span
                  className="min-w-0 flex-1 truncate text-xs"
                  title={`${provider} / ${model}`}
                >
                  {model ? `${provider} / ${model}` : "选择 Agent 后开始"}
                </span>
                <Button type="submit" disabled={busy || !canSubmit}>
                  <Send data-icon="inline-start" />
                  {busy ? "正在提交" : "发送消息"}
                </Button>
              </InputGroupAddon>
            </InputGroup>
            <FieldError id="prompt-error">{invalid.parts}</FieldError>
          </Field>
          <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(140px,1fr)_minmax(0,2fr)]">
            <Field>
              <FieldLabel htmlFor="engine">Agent</FieldLabel>
              <Choice
                id="engine"
                label="Agent"
                value={engineId}
                disabled={busy}
                options={(runtime?.engines ?? [])
                  .filter(
                    (item) =>
                      item.enabled !== false && item.health.status === "ready"
                  )
                  .map((item) => ({
                    value: item.id,
                    label: `${agentNames[item.id] ?? item.id}${item.id === runtime?.engine ? " · 默认" : ""}`,
                  }))}
                onChange={(value) => {
                  setEngineId(value)
                  const policy = runtime?.engines.find(
                    (item) => item.id === value
                  )?.interactionPolicy
                  setManualPermission(policy?.permission !== "auto")
                  setManualQuestion(policy?.question !== "auto")
                  setSelectedProvider("")
                  setSelectedModel("")
                  setError(undefined)
                }}
              />
            </Field>
            <Field data-invalid={!!invalid.directory}>
              <FieldLabel htmlFor="directory">
                {desktop ? "工作目录" : "服务器工作目录"}
              </FieldLabel>
              <DirectoryInput
                id="directory"
                value={directory}
                onValueChange={setDirectory}
                aria-invalid={!!invalid.directory}
                aria-describedby={
                  invalid.directory ? "directory-error" : undefined
                }
                name="directory"
                required
                placeholder={
                  desktop ? "工作目录的绝对路径" : "服务器上的绝对路径"
                }
              />
              <FieldError id="directory-error">{invalid.directory}</FieldError>
            </Field>
          </FieldGroup>
          <Collapsible>
            <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
              <SlidersHorizontal data-icon="inline-start" />
              模型与会话设置
              <ChevronDown data-icon="inline-end" />
            </CollapsibleTrigger>
            <CollapsibleContent keepMounted>
              <FieldGroup className="pt-4">
                <Field data-invalid={!!invalid.title}>
                  <FieldLabel htmlFor="title">会话名称（可选）</FieldLabel>
                  <Input
                    id="title"
                    aria-invalid={!!invalid.title}
                    aria-describedby={invalid.title ? "title-error" : undefined}
                    name="title"
                    maxLength={200}
                    placeholder="例如：汇总本月销售数据"
                  />
                  <FieldError id="title-error">{invalid.title}</FieldError>
                </Field>
                <FieldGroup className="sm:grid sm:grid-cols-2">
                  <Field data-invalid={!!invalid.model}>
                    <FieldLabel htmlFor="provider">模型供应商</FieldLabel>
                    <Choice
                      id="provider"
                      label="模型供应商"
                      searchable
                      aria-describedby={
                        invalid.model ? "model-error" : undefined
                      }
                      invalid={!!invalid.model}
                      disabled={busy || !providers.length}
                      value={provider}
                      options={
                        providers.length
                          ? providers.map((value) => ({ value, label: value }))
                          : [
                              {
                                value: "",
                                label: catalog.loading
                                  ? "正在加载"
                                  : "无可用供应商",
                              },
                            ]
                      }
                      onChange={(value) => {
                        setSelectedProvider(value)
                        setSelectedModel("")
                      }}
                    />
                  </Field>
                  <Field data-invalid={!!invalid.model}>
                    <FieldLabel htmlFor="model">模型名称</FieldLabel>
                    <Choice
                      id="model"
                      label="模型名称"
                      searchable
                      aria-describedby={
                        invalid.model ? "model-error" : undefined
                      }
                      invalid={!!invalid.model}
                      disabled={busy || !providerModels.length}
                      value={model}
                      options={
                        providerModels.length
                          ? providerModels.map((item) => ({
                              value: item.modelID,
                              label: item.name,
                            }))
                          : [
                              {
                                value: "",
                                label: catalog.loading
                                  ? "正在加载"
                                  : "无可用模型",
                              },
                            ]
                      }
                      onChange={setSelectedModel}
                    />
                  </Field>
                </FieldGroup>
                <FieldError id="model-error">{invalid.model}</FieldError>
                <FieldGroup className="sm:grid sm:grid-cols-2">
                  <Field orientation="horizontal">
                    <Switch
                      id="manual-permission"
                      disabled={engine?.capabilities?.permissions === false}
                      checked={manualPermission}
                      onCheckedChange={setManualPermission}
                    />
                    <FieldLabel htmlFor="manual-permission">
                      人工审批权限
                    </FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <Switch
                      id="manual-question"
                      disabled={engine?.capabilities?.questions === false}
                      checked={manualQuestion}
                      onCheckedChange={setManualQuestion}
                    />
                    <FieldLabel htmlFor="manual-question">
                      人工回答反问
                    </FieldLabel>
                  </Field>
                </FieldGroup>
              </FieldGroup>
            </CollapsibleContent>
          </Collapsible>
          <Failure error={catalog.error} />
          {!catalog.loading && !catalog.error && !models.length && (
            <Notice title="此引擎尚未配置可用模型或供应商凭据。">
              <Link to={`/agents/${engineId}?tab=models`}>前往配置模型</Link>
            </Notice>
          )}
          {engine && engine.health.status !== "ready" && (
            <Notice title="引擎尚未就绪">
              {engine.health.message || "等待 Agent 恢复后再发送消息。"}
            </Notice>
          )}
          {catalog.error && (
            <Button variant="outline" type="button" onClick={catalog.reload}>
              <RefreshCw data-icon="inline-start" />
              重新加载模型
            </Button>
          )}
          <Failure error={error} />
        </FieldGroup>
      </FieldSet>
    </form>
  )
}
