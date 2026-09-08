import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import {
  ArrowLeft,
  ArrowDown,
  Maximize2,
  Minimize2,
  PanelRight,
  Download,
  Eye,
  FileText,
  History,
  Send,
  ShieldCheck,
  MessageCircleQuestion,
  Square,
  Trash2,
} from "lucide-react"
import type {
  Artifact,
  Interaction,
  InteractionReply,
  Message,
  Run,
  TaskDetail,
} from "../../../shared/contracts"
import { promptSchema } from "../../../shared/contracts"
import { agentNames } from "@/lib/agent-draft"
import { useGateway } from "@/lib/gateway"
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire"
import { AgentMessage } from "@/components/agent-message"
import { api, submit, useQuery, useRequestSignal } from "@/lib/api"
import {
  Blank,
  bytes,
  Choice,
  CopyText,
  date,
  duration,
  ElapsedTime,
  Failure,
  IconButton,
  labels,
  number,
  Status,
  ConfirmDialog,
  Notice,
} from "@/components/workspace-ui"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function Task() {
  const { id = "" } = useParams()
  const requestSignal = useRequestSignal()
  const { revision, runtime } = useGateway()
  const [params, setParams] = useSearchParams()
  const query = useQuery<{ detail: TaskDetail }>(`/api/tasks/${id}`, revision)
  const [action, setAction] = useState<"stop" | "delete" | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error>()
  const [actionFocus, setActionFocus] = useState<HTMLElement | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [focused, setFocused] = useState(false)
  const [positions] = useState(
    () => new Map<string, { top: number; follow: boolean }>()
  )
  const navigate = useNavigate()
  const detail = query.data?.detail
  const selected =
    detail?.runs.find((r) => r.id === params.get("run")) ?? detail?.runs.at(-1)
  const runFilter = detail?.runs.find((r) => r.id === params.get("run"))?.id
  const tab = [
    "execution",
    "artifacts",
    "interactions",
    "diagnostics",
  ].includes(params.get("tab") ?? "")
    ? params.get("tab")!
    : "execution"
  const pending =
    detail?.interactions.filter(
      (i) =>
        (!runFilter || i.runId === runFilter) &&
        ["pending", "replying"].includes(i.state)
    ) ?? []
  const change = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    })
  async function confirm() {
    if (busy || !action) return
    const signal = requestSignal()
    setBusy(true)
    setError(undefined)
    try {
      await api(`/session/${id}${action === "stop" ? "/abort" : ""}`, {
        method: action === "stop" ? "POST" : "DELETE",
        signal,
      })
      signal.throwIfAborted()
      setAction(null)
      toast.success(action === "delete" ? "任务已删除" : "停止请求已提交")
      if (action === "delete") navigate("/tasks")
      else query.reload()
    } catch (e) {
      if (!signal.aborted) setError(e as Error)
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
  return (
    <div
      className="page task-page"
      data-focused={focused && tab === "execution"}
    >
      <div className="task-heading">
        <Link
          to={
            params.get("return")?.startsWith("/observability?")
              ? params.get("return")!
              : "/tasks"
          }
          className="back-link"
        >
          <ArrowLeft className="size-3.5" />
          {params.get("return")?.startsWith("/observability?")
            ? "返回网关观测"
            : "会话"}
        </Link>
        {detail && (
          <div className="page-heading">
            <div className="min-w-0">
              <h1 className="break-words">{detail.task.title}</h1>
            </div>
            <div className="flex items-center gap-2">
              <Status state={detail.task.status} />
              <IconButton
                label="任务信息"
                aria-expanded={showInfo}
                onClick={() => {
                  if (window.matchMedia("(min-width: 1280px)").matches)
                    setShowInfo((v) => !v)
                  else setInfoOpen(true)
                }}
              >
                <PanelRight />
              </IconButton>
              <IconButton
                label="停止任务"
                disabled={
                  !detail.runs.some((r) =>
                    ["queued", "running", "stopping"].includes(r.state)
                  )
                }
                onClick={(event) => {
                  setActionFocus(event.currentTarget)
                  setError(undefined)
                  setAction("stop")
                }}
              >
                <Square />
              </IconButton>
              <IconButton
                label="删除任务"
                onClick={(event) => {
                  setActionFocus(event.currentTarget)
                  setError(undefined)
                  setAction("delete")
                }}
              >
                <Trash2 />
              </IconButton>
            </div>
          </div>
        )}
      </div>
      <Failure error={query.error} />
      {query.loading && <Skeleton className="mt-4 h-72 w-full" />}
      {detail && (
        <>
          <div className="task-layout" data-info={showInfo}>
            <div className="task-main min-w-0">
              <Tabs
                className="task-tabs"
                value={tab}
                onValueChange={(v) => change("tab", String(v))}
              >
                <div className="task-navigation">
                  <Choice
                    label="执行筛选"
                    value={runFilter ?? ""}
                    options={[
                      { value: "", label: "完整对话" },
                      ...detail.runs.map((r) => ({
                        value: r.id,
                        label: `执行 #${r.sequence} · ${labels[r.state]}`,
                      })),
                    ]}
                    onChange={(v) => change("run", v)}
                  />
                  <TabsList variant="line" className="max-w-full">
                    <TabsTrigger value="execution">对话</TabsTrigger>
                    <TabsTrigger value="artifacts">交付物</TabsTrigger>
                    <TabsTrigger value="interactions" aria-label="交互">
                      交互{pending.length ? ` (${pending.length})` : ""}
                    </TabsTrigger>
                    <TabsTrigger value="diagnostics">诊断</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="execution" data-execution>
                  <Execution
                    agentName={
                      agentNames[detail.task.engineId] ?? detail.task.engineId
                    }
                    positionKey={runFilter ?? id}
                    runs={runFilter ? [] : detail.runs}
                    positions={positions}
                    messages={detail.messages.filter(
                      (m) => !runFilter || m.runId === runFilter
                    )}
                    run={runFilter ? selected : undefined}
                    focused={focused}
                    onFocusChange={() => setFocused((value) => !value)}
                  >
                    {!!pending.length && (
                      <section
                        className="pending-interactions"
                        aria-label="待处理交互"
                      >
                        <h2 className="text-sm font-semibold">
                          等待处理 · {pending.length}
                        </h2>
                        {pending.map((i) => (
                          <InteractionRow
                            key={i.id}
                            interaction={i}
                            onReply={query.reload}
                          />
                        ))}
                      </section>
                    )}
                    {!!detail.artifacts.filter(
                      (a) => !runFilter || a.runId === runFilter
                    ).length && (
                      <Button
                        variant="link"
                        onClick={() => change("tab", "artifacts")}
                      >
                        <FileText data-icon="inline-start" />
                        查看交付物
                      </Button>
                    )}
                  </Execution>
                  <FollowUp
                    key={id}
                    sessionId={id}
                    disabled={
                      detail.task.availability !== "ready" ||
                      runtime?.engines.find(
                        (engine) => engine.id === detail.task.engineId
                      )?.health.status !== "ready"
                    }
                    disabledReason={
                      detail.task.availability !== "ready"
                        ? "任务不可继续执行"
                        : runtime?.engines.find(
                              (engine) => engine.id === detail.task.engineId
                            )?.health.status !== "ready"
                          ? "引擎尚未就绪"
                          : undefined
                    }
                    run={detail.runs.at(-1)}
                    onAccepted={() => {
                      change("run", "")
                      query.reload()
                    }}
                  />
                </TabsContent>
                <TabsContent value="artifacts">
                  <Artifacts
                    artifacts={detail.artifacts.filter(
                      (a) => !runFilter || a.runId === runFilter
                    )}
                  />
                </TabsContent>
                <TabsContent value="interactions">
                  <div className="list-body divide-y">
                    {detail.interactions
                      .filter((i) => !runFilter || i.runId === runFilter)
                      .map((i) => (
                        <InteractionRow
                          key={i.id}
                          interaction={i}
                          onReply={query.reload}
                        />
                      ))}
                    {!detail.interactions.some(
                      (i) => !runFilter || i.runId === runFilter
                    ) && <Blank>没有交互请求</Blank>}
                  </div>
                </TabsContent>
                <TabsContent value="diagnostics" data-diagnostics>
                  {selected ? (
                    <Diagnostics run={selected} revision={revision} />
                  ) : (
                    <Blank>暂无执行记录</Blank>
                  )}
                </TabsContent>
              </Tabs>
            </div>
            <aside className="task-aside" aria-label="任务信息">
              <h2>任务信息</h2>
              <dl className="metadata">
                <dt>工作目录</dt>
                <dd className="font-mono">{detail.task.directory}</dd>
                <dt>引擎</dt>
                <dd>{detail.task.engineId}</dd>
                <dt>{runFilter ? "执行模型" : "最近执行模型"}</dt>
                <dd>
                  {selected?.model
                    ? `${selected.model.providerID} / ${selected.model.modelID}`
                    : "引擎默认"}
                </dd>
                <dt>创建时间</dt>
                <dd>{date(detail.task.createdAt)}</dd>
                <dt>权限 / 反问</dt>
                <dd>
                  {detail.task.interactionPolicy.permission === "auto"
                    ? "自动"
                    : "人工"}{" "}
                  /{" "}
                  {detail.task.interactionPolicy.question === "auto"
                    ? "自动"
                    : "人工"}
                </dd>
                <dt>排队轮次</dt>
                <dd>{detail.task.queuedCount}</dd>
              </dl>
              {selected && (
                <>
                  <h2 className="mt-8">
                    {runFilter
                      ? `执行 #${selected.sequence} 用量`
                      : `最近执行 #${selected.sequence} 用量`}
                  </h2>
                  <dl className="metadata">
                    <dt>接收时间</dt>
                    <dd>{date(selected.acceptedAt)}</dd>
                    <dt>输入 Token</dt>
                    <dd>{number(selected.usage?.input)}</dd>
                    <dt>输出 Token</dt>
                    <dd>{number(selected.usage?.output)}</dd>
                    <dt>缓存读取 Token</dt>
                    <dd>{number(selected.usage?.cacheRead)}</dd>
                    <dt>费用 (USD)</dt>
                    <dd>{number(selected.usage?.costUsd)}</dd>
                    <dt>执行耗时</dt>
                    <dd>
                      {duration(
                        selected.startedAt && selected.finishedAt
                          ? Date.parse(selected.finishedAt) -
                              Date.parse(selected.startedAt)
                          : null
                      )}
                    </dd>
                  </dl>
                </>
              )}
            </aside>
          </div>
        </>
      )}
      <ConfirmDialog
        open={action !== null}
        title={action === "delete" ? "删除任务" : "停止任务"}
        description={
          action === "delete"
            ? "删除会话、执行记录与消息。工作目录中的文件会保留。"
            : "停止当前执行并取消该任务中尚未开始的轮次。"
        }
        confirmLabel={action === "delete" ? "确认删除" : "确认停止"}
        busy={busy}
        error={error}
        finalFocus={actionFocus}
        onOpenChange={(open) => {
          if (!open) {
            setAction(null)
            setError(undefined)
          }
        }}
        onConfirm={() => void confirm()}
      />
      <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
        <SheetContent
          className="overflow-hidden"
          finalFocus={() =>
            document.querySelector<HTMLButtonElement>(
              'button[aria-label="任务信息"]'
            )
          }
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>任务信息</SheetTitle>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
            <dl className="metadata px-4 pb-4">
              <dt>工作目录</dt>
              <dd className="font-mono">{detail?.task.directory}</dd>
              <dt>引擎</dt>
              <dd>{detail?.task.engineId}</dd>
              <dt>{runFilter ? "执行模型" : "最近执行模型"}</dt>
              <dd>
                {selected?.model
                  ? `${selected.model.providerID} / ${selected.model.modelID}`
                  : "引擎默认"}
              </dd>
              <dt>创建时间</dt>
              <dd>{date(detail?.task.createdAt)}</dd>
              <dt>排队轮次</dt>
              <dd>{detail?.task.queuedCount}</dd>
              <dt>输入 / 输出 Token</dt>
              <dd>
                {number(selected?.usage?.input)} /{" "}
                {number(selected?.usage?.output)}
              </dd>
              <dt>{runFilter ? "所选执行接收时间" : "最近执行接收时间"}</dt>
              <dd>{date(selected?.acceptedAt)}</dd>
              <dt>费用 (USD)</dt>
              <dd>{number(selected?.usage?.costUsd)}</dd>
            </dl>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function Execution({
  agentName,
  messages,
  positionKey,
  runs,
  run,
  children,
  positions,
  focused,
  onFocusChange,
}: {
  messages: Message[]
  agentName: string
  positionKey: string
  runs: Run[]
  run?: Run
  children?: ReactNode
  positions: Map<string, { top: number; follow: boolean }>
  focused: boolean
  onFocusChange: () => void
}) {
  const runId = positionKey
  const [follow, setFollow] = useState(true)
  const [atBottom, setAtBottom] = useState(
    () => positions.get(runId ?? "")?.follow ?? true
  )
  const log = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  useLayoutEffect(() => {
    const element = log.current
    if (!element || !runId) return
    const saved = positions.get(runId)
    element.scrollTop = saved?.top ?? element.scrollHeight
    following.current = saved?.follow ?? true
    const track = () => {
      const near =
        element.scrollHeight - element.scrollTop - element.clientHeight <= 64
      following.current = near
      setAtBottom(near)
      positions.set(runId, { top: element.scrollTop, follow: near })
    }
    element.addEventListener("scroll", track)
    return () => {
      positions.set(runId, {
        top: element.scrollTop,
        follow: following.current,
      })
      element.removeEventListener("scroll", track)
    }
  }, [runId, positions])
  useLayoutEffect(() => {
    const element = log.current
    if (element && follow && following.current)
      element.scrollTop = element.scrollHeight
  }, [messages, follow])
  useLayoutEffect(() => {
    const element = log.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (follow && following.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [follow])
  return (
    <div className="execution-view">
      <div className="execution-controls">
        <div className="execution-context">
          <h2 className="text-sm font-semibold">
            {run ? `执行 #${run.sequence}` : "完整对话"}
          </h2>
          <span role="status">{run && <Status state={run.state} />}</span>
          {run && (
            <span
              className="execution-time text-xs text-muted-foreground"
              title={date(run.acceptedAt)}
            >
              <ElapsedTime
                start={run.startedAt}
                end={run.finishedAt}
                active={run.state === "running"}
              />
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Field orientation="horizontal" className="w-auto">
            <Switch
              id="follow"
              size="sm"
              checked={follow}
              onCheckedChange={setFollow}
            />
            <FieldLabel htmlFor="follow" className="text-xs">
              跟随输出
            </FieldLabel>
          </Field>
          <IconButton
            label={focused ? "退出专注阅读" : "专注阅读"}
            aria-pressed={focused}
            onClick={onFocusChange}
          >
            {focused ? <Minimize2 /> : <Maximize2 />}
          </IconButton>
        </div>
      </div>
      <div className="execution-feed">
        <ScrollArea
          className="execution-scroll"
          viewportProps={{
            className: "execution-log",
            ref: log,
            tabIndex: 0,
            "aria-label": "执行消息",
          }}
        >
          {messages.map((message, index) => {
            const execution = runs.find((item) => item.id === message.runId)
            return (
              <div key={message.id}>
                {execution && messages[index - 1]?.runId !== message.runId && (
                  <>
                    <div className="run-divider">
                      <span>执行 #{execution.sequence}</span>
                      <Status state={execution.state} />
                      <ElapsedTime
                        start={execution.startedAt}
                        end={execution.finishedAt}
                        active={execution.state === "running"}
                      />
                    </div>
                    {execution.error && (
                      <Failure
                        error={
                          new Error(
                            `执行 #${execution.sequence}：${execution.error.message}`
                          )
                        }
                      />
                    )}
                  </>
                )}
                <AgentMessage message={message} agentName={agentName} />
              </div>
            )
          })}
          {!messages.length && (
            <Blank>
              {(run ?? runs.at(-1))?.state === "queued"
                ? "等待执行"
                : "暂无消息"}
            </Blank>
          )}
          {runs
            .filter(
              (execution) =>
                execution.error &&
                !messages.some((message) => message.runId === execution.id)
            )
            .map((execution) => (
              <Failure
                key={execution.id}
                error={
                  new Error(
                    `执行 #${execution.sequence}：${execution.error!.message}`
                  )
                }
              />
            ))}
          {children}
        </ScrollArea>
        {!atBottom && (
          <Button
            variant="outline"
            size="sm"
            className="execution-latest"
            onClick={() => {
              const element = log.current
              if (element) element.scrollTop = element.scrollHeight
              following.current = true
              setAtBottom(true)
            }}
          >
            <ArrowDown data-icon="inline-start" />
            回到最新进度
          </Button>
        )}
      </div>
      {run?.error && (
        <Failure error={new Error(`${run.error.code}: ${run.error.message}`)} />
      )}
    </div>
  )
}
function FollowUp({
  sessionId,
  disabled,
  disabledReason,
  run,
  onAccepted,
}: {
  sessionId: string
  disabled: boolean
  disabledReason?: string
  run?: Run
  onAccepted: (runId: string) => void
}) {
  const requestSignal = useRequestSignal(sessionId)
  const { runtime } = useGateway()
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error>()
  async function send(event: FormEvent) {
    event.preventDefault()
    if (busy || disabled) return
    const signal = requestSignal()
    setBusy(true)
    setError(undefined)
    try {
      const input = promptSchema.parse({
        parts: [{ type: "text", text }],
      })
      const result = await submit(input, runtime!.storeId, sessionId, signal)
      signal.throwIfAborted()
      setText("")
      onAccepted(result.runId)
    } catch (e) {
      if (!signal.aborted) setError(e as Error)
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
  return (
    <form className="follow-up" onSubmit={send}>
      <Field>
        <FieldLabel htmlFor="follow-up" className="sr-only">
          追加任务
        </FieldLabel>
        <InputGroup>
          <InputGroupTextarea
            id="follow-up"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.ctrlKey || e.metaKey) &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            rows={1}
            required
            disabled={disabled || busy}
            placeholder="发送消息，或补充要求"
          />
          <InputGroupAddon align="inline-end">
            <IconButton
              label={busy ? "正在提交" : "提交新一轮"}
              type="submit"
              variant="default"
              disabled={disabled || busy || !text.trim()}
            >
              <Send />
            </IconButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>
      <Failure error={error} />
      {disabledReason && <Notice title={disabledReason} />}
      <div className="follow-up-actions">
        <span className="text-xs text-muted-foreground">
          {run && ["running", "queued", "stopping"].includes(run.state)
            ? "新一轮将在当前执行后排队"
            : (run?.model?.modelID ?? "引擎默认模型")}
        </span>
        <div className="flex flex-wrap gap-2">
          {run && ["failed", "timed_out", "cancelled"].includes(run.state) && (
            <Button
              variant="outline"
              disabled={disabled || busy}
              onClick={() =>
                setText(run.inputParts.map((p) => p.text).join("\n"))
              }
            >
              <History data-icon="inline-start" />
              填入上轮要求
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}

function InteractionRow({
  interaction: i,
  onReply,
}: {
  interaction: Interaction
  onReply: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error>()
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const questions = i.questions.map((q, index) => ({
    ...q,
    name: `question-${index}`,
    required: true,
    choices: q.options.map((option) => ({ value: option.label })),
  }))
  async function reply(body: InteractionReply) {
    if (busy || i.state !== "pending") return
    setBusy(true)
    setError(undefined)
    try {
      await api(`/${i.kind}/${i.id}/reply`, {
        method: "POST",
        body: JSON.stringify(body),
      })
      onReply()
    } catch (e) {
      setError(e as Error)
      onReply()
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="interaction"
      aria-label={i.title}
      aria-busy={busy || i.state === "replying"}
    >
      <div className="mb-3 flex items-center gap-2">
        {i.kind === "permission" ? (
          <ShieldCheck className="size-4 shrink-0" />
        ) : (
          <MessageCircleQuestion className="size-4 shrink-0" />
        )}
        <h3 className="min-w-0 flex-1 font-medium break-words">{i.title}</h3>
        <Status state={busy ? "replying" : i.state} />
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        {i.policy === "auto" ? "自动策略" : "人工处理"} · {date(i.created_at)}
      </p>
      {i.state === "pending" && i.kind === "permission" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {i.permission} · 始终允许的范围由当前引擎权限策略决定。
          </p>
          {i.patterns.length > 0 && (
            <pre className="max-h-40 overflow-auto text-xs break-words whitespace-pre-wrap">
              {i.patterns.join("\n")}
            </pre>
          )}
          <div className="flex flex-wrap gap-2">
            {(["once", "always", "reject"] as const).map((decision, index) => (
              <Button
                key={decision}
                variant={decision === "reject" ? "destructive" : "outline"}
                disabled={busy}
                onClick={() => void reply({ reply: decision })}
              >
                {["允许本次", "始终允许", "拒绝"][index]}
              </Button>
            ))}
          </div>
        </div>
      )}
      {i.kind === "question" && i.state === "expired" && !i.reply && (
        <dl className="flex flex-col gap-3">
          {i.questions.map((q, index) => (
            <div key={index}>
              <dt>{q.question}</dt>
              <dd className="text-sm text-muted-foreground">未回答 · 已过期</dd>
            </div>
          ))}
        </dl>
      )}
      {i.kind === "question" && !i.reply && i.state !== "expired" && (
        <Questionnaire
          items={questions}
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            const answers = questions.map((q) =>
              data
                .getAll(q.name)
                .map(String)
                .filter((value) => value.trim())
            )
            if (answers.some((answer) => !answer.length)) return
            void reply({ answers })
          }}
        >
          {questions.length > 1 && (
            <QuestionnaireProgress
              render={(props, state) => (
                <div {...props}>
                  问题 {state.current} / {state.total}
                </div>
              )}
            />
          )}
          {questions.map((q) => (
            <QuestionnaireItem
              key={q.name}
              name={q.name}
              multiple={q.multiple}
              required
            >
              <QuestionnaireTitle>{q.question}</QuestionnaireTitle>
              <QuestionnaireChoices>
                {q.options.map((option) => (
                  <QuestionnaireChoice
                    key={option.label}
                    value={option.label}
                    disabled={busy || i.state !== "pending"}
                    onChange={(event) => {
                      if (event.target.checked && !q.multiple)
                        setCustomAnswers((previous) => ({
                          ...previous,
                          [q.name]: "",
                        }))
                    }}
                  >
                    <span>{option.label}</span>
                    {option.description && (
                      <QuestionnaireChoiceDescription>
                        {option.description}
                      </QuestionnaireChoiceDescription>
                    )}
                  </QuestionnaireChoice>
                ))}
                {(q.allowCustom || !q.options.length) && (
                  <QuestionnaireInput
                    disabled={busy || i.state !== "pending"}
                    value={customAnswers[q.name] ?? ""}
                    onChange={(event) =>
                      setCustomAnswers((previous) => ({
                        ...previous,
                        [q.name]: event.target.value,
                      }))
                    }
                    aria-label={`${q.question} 自定义回答`}
                    placeholder="输入你的回答"
                  />
                )}
              </QuestionnaireChoices>
              <QuestionnaireError>请先选择或填写回答</QuestionnaireError>
            </QuestionnaireItem>
          ))}
          {i.state === "pending" && (
            <QuestionnaireActions>
              <QuestionnairePrevious disabled={busy}>
                上一题
              </QuestionnairePrevious>
              <QuestionnaireNext disabled={busy}>下一题</QuestionnaireNext>
              <QuestionnaireSubmit disabled={busy}>
                {busy ? "正在提交" : "提交回答"}
              </QuestionnaireSubmit>
            </QuestionnaireActions>
          )}
        </Questionnaire>
      )}
      {i.reply && (
        <p className="text-sm break-words">
          {"reply" in i.reply
            ? {
                once: "已允许本次",
                always: "已按引擎策略允许",
                reject: "已拒绝",
              }[i.reply.reply]
            : i.reply.answers.map((a) => a.join("、")).join("；")}{" "}
          · {date(i.resolvedAt)}
        </p>
      )}
      <Failure error={error ?? (i.error ? new Error(i.error) : undefined)} />
    </section>
  )
}

function Artifacts({ artifacts }: { artifacts: Artifact[] }) {
  const [downloadError, setDownloadError] = useState<Error>()
  const [downloading, setDownloading] = useState(false)
  async function download(artifact: Artifact) {
    if (downloading) return
    setDownloading(true)
    setDownloadError(undefined)
    try {
      const response = await fetch(`/api/artifacts/${artifact.id}/content`, {
        signal: AbortSignal.timeout(60000),
      })
      if (!response.ok) throw new Error((await response.json()).message)
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement("a")
      link.href = url
      link.download = artifact.displayName
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setDownloadError(error as Error)
    } finally {
      setDownloading(false)
    }
  }
  const [preview, setPreview] = useState<Artifact | null>(null)
  const [content, setContent] = useState<{
    id: string
    text?: string
    error?: Error
  }>()
  useEffect(() => {
    if (!preview) return
    const controller = new AbortController()
    void fetch(`/api/artifacts/${preview.id}/content?disposition=inline`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).message)
        return response.text()
      })
      .then((text) => setContent({ id: preview.id, text }))
      .catch((error) => {
        if (!controller.signal.aborted) setContent({ id: preview.id, error })
      })
    return () => controller.abort()
  }, [preview])
  return (
    <>
      {artifacts.length ? (
        <Table className="stacked-table artifact-list">
          <TableHeader>
            <TableRow>
              <TableHead>文件</TableHead>
              <TableHead>大小</TableHead>
              <TableHead>可用性</TableHead>
              <TableHead>校验</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {artifacts.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="max-w-80">
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 shrink-0" />
                    <span className="break-all whitespace-normal">
                      {a.displayName}
                    </span>
                  </div>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <div
                          tabIndex={0}
                          className="mt-1 truncate text-xs text-muted-foreground"
                        />
                      }
                    >
                      {a.relativePath}
                    </TooltipTrigger>
                    <TooltipContent className="break-all">
                      {a.relativePath}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell data-label="大小">{bytes(a.sizeBytes)}</TableCell>
                <TableCell data-label="可用性">
                  <Status state={a.availability} />
                </TableCell>
                <TableCell data-label="校验">
                  {a.validation === "not_checked"
                    ? "未校验"
                    : a.validation === "passed"
                      ? "文件检查通过"
                      : "文件检查失败"}
                </TableCell>
                <TableCell data-label="操作">
                  <div className="flex gap-1">
                    <IconButton
                      label={`预览 ${a.displayName}`}
                      disabled={
                        !a.mediaType.startsWith("text/") ||
                        a.sizeBytes > 1048576 ||
                        a.availability !== "available"
                      }
                      onClick={() => setPreview(a)}
                    >
                      <Eye />
                    </IconButton>
                    <IconButton
                      label={`下载 ${a.displayName}`}
                      disabled={downloading || a.availability !== "available"}
                      onClick={() => void download(a)}
                    >
                      <Download />
                    </IconButton>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Blank>暂无交付物</Blank>
      )}
      <Failure error={downloadError} />
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
      >
        <DialogContent className="flex max-h-[90svh] flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader className="shrink-0">
            <DialogTitle className="pr-6 break-all">
              {preview?.displayName}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea
            className="flex min-h-0 flex-1 flex-col"
            viewportProps={{
              className: "min-h-0",
              tabIndex: 0,
              "aria-label": "文件预览",
            }}
          >
            {content?.id === preview?.id ? (
              <>
                <Failure error={content?.error} />
                <pre className="text-xs break-words whitespace-pre-wrap">
                  {content?.text}
                </pre>
              </>
            ) : (
              <Skeleton className="h-64" />
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Diagnostics({ run, revision }: { run: Run; revision: number }) {
  const query = useQuery<{
    spans: {
      name: string
      startedAt: string | null
      finishedAt: string | null
      state?: string
    }[]
    logs: { id: number; occurredAt: string; code: string; message: string }[]
  }>(`/api/observability/runs/${run.id}`, revision)
  return (
    <ScrollArea
      className="diagnostics-view"
      viewportProps={{ tabIndex: 0, "aria-label": "诊断信息" }}
    >
      <div className="grid gap-6">
        <dl className="diagnostic-ids">
          <dt>Run ID</dt>
          <dd>
            {run.id}
            <CopyText text={run.id} />
          </dd>
          <dt>Trace ID</dt>
          <dd>
            {run.traceId}
            <CopyText text={run.traceId} />
          </dd>
        </dl>
        <Failure error={query.error} />
        <h3 className="font-medium">执行阶段</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>阶段</TableHead>
              <TableHead>开始</TableHead>
              <TableHead>耗时</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data?.spans.map((span, index) => (
              <TableRow key={index}>
                <TableCell className="max-w-64 truncate">{span.name}</TableCell>
                <TableCell>{date(span.startedAt)}</TableCell>
                <TableCell>
                  {duration(
                    span.startedAt && span.finishedAt
                      ? Date.parse(span.finishedAt) - Date.parse(span.startedAt)
                      : null
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <h3 className="font-medium">错误日志</h3>
        {query.data?.logs.length ? (
          <section aria-label="错误日志">
            {query.data.logs.map((log) => (
              <div key={log.id} className="border-b py-3">
                <div className="mb-1 text-xs text-muted-foreground">
                  {date(log.occurredAt)} · {log.code}
                </div>
                <p className="break-words">{log.message}</p>
              </div>
            ))}
          </section>
        ) : (
          <Blank>暂无错误日志</Blank>
        )}
      </div>
    </ScrollArea>
  )
}
