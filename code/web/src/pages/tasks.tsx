import { Fragment, useState, type FormEvent } from "react"
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom"
import {
  ArrowLeft,
  ArrowRight,
  History,
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
import { cn } from "@/lib/utils"
import { desktop } from "@/lib/desktop"
import { DirectoryInput } from "@/components/directory-input"
import {
  Blank,
  Choice,
  Failure,
  IconButton,
  labels,
  Status,
  Notice,
  date,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"

export function Conversations() {
  return (
    <div className="conversation-main">
      <Outlet />
    </div>
  )
}

function historyDay(value: string) {
  const day = new Date(value).toDateString()
  const today = new Date()
  if (day === today.toDateString()) return "今天"
  today.setDate(today.getDate() - 1)
  return day === today.toDateString() ? "昨天" : "更早"
}

export function ConversationHistory({ close }: { close?: () => void }) {
  const { revision } = useGateway()
  const [params, setParams] = useSearchParams()
  const { pathname } = useLocation()
  const queryParams = new URLSearchParams()
  for (const key of ["q", "status", "cursor"]) {
    const value = params.get(key)
    if (value) queryParams.set(key, value)
  }
  const query = useQuery<Page<TaskSummary>>(
    `/api/tasks?${queryParams}`,
    revision
  )
  const [pinned, setPinned] = useState<{ key: string; items: TaskSummary[] }>()
  const listKey = queryParams.toString()
  const items =
    pinned?.key === listKey
      ? pinned.items.map(
          (item) =>
            query.data?.items.find((next) => next.id === item.id) ?? item
        )
      : query.data?.items
  const searchQuery = params.get("q") ?? ""
  const [draft, setDraft] = useState({ query: searchQuery, text: searchQuery })
  if (draft.query !== searchQuery)
    setDraft({ query: searchQuery, text: searchQuery })
  const search = draft.query === searchQuery ? draft.text : searchQuery
  const update = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.delete("cursor")
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    })
  return (
    <div className="conversation-history">
      <div className="history-heading">
        <h2>历史会话</h2>
        <History aria-hidden="true" />
      </div>
      <Button variant="secondary" render={<Link to="/tasks" />} onClick={close}>
        <Plus data-icon="inline-start" />
        新会话
      </Button>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          update("q", search)
        }}
      >
        <InputGroup>
          <InputGroupInput
            aria-label="搜索会话"
            placeholder="搜索会话"
            value={search}
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
          { value: "", label: "全部会话" },
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
      <Failure error={query.error} />
      {query.error && (
        <Button variant="outline" onClick={query.reload}>
          重新加载会话
        </Button>
      )}
      <ScrollArea
        className="min-h-0 flex-1"
        viewportProps={{ "aria-label": "会话列表" }}
      >
        <nav
          className="flex flex-col gap-1"
          aria-label="会话列表"
          onPointerEnter={() => items && setPinned({ key: listKey, items })}
          onPointerLeave={(event) => {
            if (!event.currentTarget.contains(document.activeElement))
              setPinned(undefined)
          }}
          onFocusCapture={() =>
            items &&
            setPinned((previous) =>
              previous?.key === listKey ? previous : { key: listKey, items }
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
            items?.map((task, index) => (
              <Fragment key={task.id}>
                {(index === 0 ||
                  historyDay(items[index - 1].updatedAt) !==
                    historyDay(task.updatedAt)) && (
                  <h3 className="history-day">{historyDay(task.updatedAt)}</h3>
                )}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <NavLink
                        aria-label={task.title}
                        to={`/tasks/${task.id}${listKey ? `?${listKey}` : ""}`}
                        onClick={close}
                        className={cn(
                          "conversation-link",
                          pathname === `/tasks/${task.id}` && "active"
                        )}
                      />
                    }
                  >
                    <span className="history-title">{task.title}</span>
                    <span className="history-meta">
                      <span className="truncate">
                        {agentNames[task.engineId] ?? task.engineId}
                      </span>
                      <time dateTime={task.updatedAt}>
                        {new Date(task.updatedAt).toLocaleDateString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                        })}
                      </time>
                      {task.status === "completed" ? (
                        <span className="history-completed">
                          <Check aria-hidden="true" />
                          已完成
                        </span>
                      ) : (
                        <Status state={task.status} />
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-72 break-words">
                    {task.title}
                    <br />
                    更新于 {date(task.updatedAt)}
                  </TooltipContent>
                </Tooltip>
              </Fragment>
            ))
          )}
          {!query.loading && !query.error && !query.data?.items.length && (
            <Blank>
              {params.get("q") || params.get("status")
                ? "没有符合条件的会话"
                : "暂无会话"}
            </Blank>
          )}
        </nav>
      </ScrollArea>
      {(params.get("cursor") || query.data?.nextCursor) && (
        <Pagination aria-label="会话分页">
          <PaginationContent>
            <PaginationItem>
              <IconButton
                label="返回第一页"
                disabled={!params.get("cursor")}
                onClick={() => update("cursor", "")}
              >
                <ArrowLeft />
              </IconButton>
            </PaginationItem>
            <PaginationItem>
              <IconButton
                label="下一页"
                disabled={!query.data?.nextCursor}
                onClick={() => update("cursor", query.data?.nextCursor ?? "")}
              >
                <ArrowRight />
              </IconButton>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  )
}

export function Tasks() {
  const { runtime } = useGateway()
  const navigate = useNavigate()
  const ready = runtime?.engines.some(
    (engine) => engine.enabled !== false && engine.health.status === "ready"
  )
  return (
    <div className="new-conversation">
      <div className="new-conversation-content">
        <h1>新会话</h1>
        <p className="mt-2 mb-6 text-sm text-muted-foreground">
          描述要完成的工作，让 Agent 从这里开始。
        </p>
        {!runtime ? (
          <Skeleton className="h-64" />
        ) : ready ? (
          <CreateTask onAccepted={(id) => navigate(`/tasks/${id}`)} />
        ) : (
          <Blank>
            暂无可用 Agent
            <Button className="mt-4" render={<Link to="/agents" />}>
              配置 Agent
            </Button>
          </Blank>
        )}
      </div>
    </div>
  )
}

function CreateTask({ onAccepted }: { onAccepted: (id: string) => void }) {
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
    <form onSubmit={send} className="task-create-form" aria-label="新会话">
      <FieldSet disabled={busy}>
        <FieldGroup>
          <Field data-invalid={!!invalid.parts}>
            <FieldLabel htmlFor="prompt">消息</FieldLabel>
            <InputGroup>
              <InputGroupTextarea
                id="prompt"
                aria-invalid={!!invalid.parts}
                aria-describedby={invalid.parts ? "prompt-error" : undefined}
                name="prompt"
                required
                rows={4}
                placeholder="你想完成什么？"
              />
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
          <div className="conversation-submit">
            <Button type="submit" disabled={busy || !canSubmit}>
              <Send data-icon="inline-start" />
              {busy ? "正在提交" : "发送消息"}
            </Button>
          </div>
        </FieldGroup>
      </FieldSet>
    </form>
  )
}
