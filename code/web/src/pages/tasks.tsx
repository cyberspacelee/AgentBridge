import { useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import {
  ArrowLeft,
  ArrowRight,
  FolderOpen,
  Plus,
  RefreshCw,
  Search,
  Send,
} from "lucide-react"
import type { ModelOption, Page, TaskSummary } from "../../../shared/contracts"
import { createTaskSchema } from "../../../shared/contracts"
import { useGateway } from "@/lib/gateway"
import { agentNames } from "@/lib/agent-draft"
import { submit, useQuery } from "@/lib/api"
import { desktop } from "@/lib/desktop"
import { DirectoryInput } from "@/components/directory-input"
import {
  Blank,
  Choice,
  date,
  duration,
  Failure,
  IconButton,
  labels,
  Status,
  Notice,
} from "@/components/workspace-ui"
import {
  InputGroup,
  InputGroupInput,
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
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
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
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
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

export function Tasks() {
  const { revision, runtime } = useGateway()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const searchQuery = params.get("q") ?? ""
  const [searchDraft, setSearchDraft] = useState({
    query: searchQuery,
    text: searchQuery,
  })
  const search =
    searchDraft.query === searchQuery ? searchDraft.text : searchQuery
  if (searchDraft.query !== searchQuery)
    setSearchDraft({ query: searchQuery, text: searchQuery })
  const query = useQuery<Page<TaskSummary>>(`/api/tasks?${params}`, revision)
  const [pinned, setPinned] = useState<{ key: string; items: TaskSummary[] }>()
  const items =
    pinned?.key === params.toString()
      ? pinned.items.map(
          (item) =>
            query.data?.items.find((next) => next.id === item.id) ?? item
        )
      : query.data?.items
  const navigate = useNavigate()
  const ready = runtime?.engines.some(
    (engine) => engine.health.status === "ready"
  )
  const update = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.delete("cursor")
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    })
  return (
    <div className="page list-page">
      <div className="page-heading">
        <div>
          <h1>任务工作台</h1>
        </div>
        {ready ? (
          <Button
            onClick={() => setOpen(true)}
            disabled={
              !runtime?.engines.some(
                (engine) => engine.health.status === "ready"
              )
            }
          >
            <Plus data-icon="inline-start" />
            分派任务
          </Button>
        ) : (
          <Button render={<Link to="/agents" />}>
            <Plus data-icon="inline-start" />
            配置 Agent
          </Button>
        )}
      </div>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          update("q", search)
        }}
      >
        <InputGroup className="max-w-80">
          <InputGroupInput
            aria-label="搜索任务"
            placeholder="搜索任务名称或 ID"
            value={search}
            onChange={(e) =>
              setSearchDraft({ query: searchQuery, text: e.target.value })
            }
          />
          <InputGroupAddon align="inline-end">
            <Tooltip>
              <TooltipTrigger
                render={
                  <InputGroupButton
                    type="submit"
                    size="icon-sm"
                    aria-label="搜索"
                  />
                }
              >
                <Search />
              </TooltipTrigger>
              <TooltipContent>搜索</TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
        <Choice
          label="任务状态"
          value={params.get("status") ?? ""}
          options={[
            { value: "", label: "全部状态" },
            ...[
              "running",
              "queued",
              "waiting_input",
              "completed",
              "failed",
              "timed_out",
              "cancelled",
              "unavailable",
            ].map((value) => ({ value, label: labels[value] })),
          ]}
          onChange={(v) => update("status", v)}
        />
        <IconButton label="刷新任务列表" onClick={query.reload}>
          <RefreshCw />
        </IconButton>
      </form>
      <Failure error={query.error} />
      {runtime && !ready && (
        <Notice title="暂无可用 Agent">
          <Link
            className="text-primary underline underline-offset-4"
            to="/agents"
          >
            配置模型并启用 Agent
          </Link>
        </Notice>
      )}
      <div className="list-body">
        {query.loading ? (
          <div className="flex flex-col gap-4 py-5">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-14 w-full" />
            ))}
          </div>
        ) : items?.length ? (
          <Table
            className="task-list"
            onPointerEnter={() => setPinned({ key: params.toString(), items })}
            onPointerLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement))
                setPinned(undefined)
            }}
            onFocusCapture={() =>
              setPinned((previous) =>
                previous?.key === params.toString()
                  ? previous
                  : { key: params.toString(), items }
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
            <TableHeader>
              <TableRow>
                <TableHead>任务</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>引擎 / 模型</TableHead>
                <TableHead>轮次</TableHead>
                <TableHead>最近更新</TableHead>
                <TableHead>执行耗时</TableHead>
                <TableHead>
                  <span className="sr-only">打开</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="max-w-96">
                    <Link to={`/tasks/${task.id}`} className="task-title">
                      {task.title}
                    </Link>
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <FolderOpen className="size-3 shrink-0" />
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span tabIndex={0} className="max-w-80 truncate" />
                          }
                        >
                          {task.directory}
                        </TooltipTrigger>
                        <TooltipContent className="break-all">
                          {task.directory}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Status state={task.status} />
                  </TableCell>
                  <TableCell>
                    <div>{task.engineId}</div>
                    <div className="max-w-52 truncate text-xs text-muted-foreground">
                      {task.lastRun?.model?.modelID ?? "引擎默认模型"}
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums" data-secondary>
                    {task.lastRun?.sequence ?? 0}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {date(task.updatedAt)}
                  </TableCell>
                  <TableCell
                    className="text-xs text-muted-foreground"
                    data-secondary
                  >
                    {duration(
                      task.lastRun?.startedAt && task.lastRun.finishedAt
                        ? Date.parse(task.lastRun.finishedAt) -
                            Date.parse(task.lastRun.startedAt)
                        : null
                    )}
                  </TableCell>
                  <TableCell data-secondary>
                    <IconButton
                      label={`打开 ${task.title}`}
                      nativeButton={false}
                      render={<Link to={`/tasks/${task.id}`} />}
                    >
                      <ArrowRight />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          !query.error && (
            <Blank>
              {params.get("q") || params.get("status")
                ? "没有符合条件的任务"
                : "暂无任务"}
            </Blank>
          )
        )}
      </div>
      <div className="pagination">
        <span>
          {query.data ? `本页 ${query.data.items.length} 个任务` : ""}
        </span>
        <Pagination aria-label="任务分页" className="mx-0 w-auto">
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
                onClick={() => {
                  if (query.data?.nextCursor)
                    update("cursor", query.data.nextCursor)
                }}
              >
                <ArrowRight />
              </IconButton>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90svh] flex-col overflow-hidden sm:max-w-xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>分派任务</DialogTitle>
          </DialogHeader>
          <ScrollArea
            className="-m-1 flex min-h-0 flex-1 flex-col"
            viewportProps={{ className: "min-h-0 p-1" }}
          >
            <CreateTask
              onAccepted={(id) => {
                setOpen(false)
                navigate(`/tasks/${id}`)
              }}
            />
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CreateTask({ onAccepted }: { onAccepted: (id: string) => void }) {
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
    setBusy(true)
    try {
      const { submissionId: _id, ...input } = result.data
      void _id
      const accepted = await submit(input, runtime!.storeId)
      onAccepted(accepted.taskId)
    } catch (e) {
      setError(e as Error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={send} className="task-create-form">
      <FieldSet disabled={busy}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="engine">执行引擎</FieldLabel>
            <Choice
              id="engine"
              label="执行引擎"
              value={engineId}
              disabled={busy}
              options={(runtime?.engines ?? [])
                .filter((item) => item.enabled !== false)
                .map((item) => ({
                  value: item.id,
                  label: agentNames[item.id] ?? item.id,
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
          <Field data-invalid={!!invalid.title}>
            <FieldLabel htmlFor="title">任务名称</FieldLabel>
            <Input
              id="title"
              aria-invalid={!!invalid.title}
              aria-describedby={invalid.title ? "title-error" : undefined}
              name="title"
              maxLength={200}
              autoFocus
              placeholder="例如：汇总本月销售数据"
            />
            <FieldError id="title-error">{invalid.title}</FieldError>
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
          <Field data-invalid={!!invalid.parts}>
            <FieldLabel htmlFor="prompt">任务要求</FieldLabel>
            <Textarea
              id="prompt"
              aria-invalid={!!invalid.parts}
              aria-describedby={invalid.parts ? "prompt-error" : undefined}
              name="prompt"
              required
              rows={5}
              placeholder="分析目标、输入文件与交付要求"
            />
            <FieldError id="prompt-error">{invalid.parts}</FieldError>
          </Field>
          <FieldGroup className="sm:grid sm:grid-cols-2">
            <Field data-invalid={!!invalid.model}>
              <FieldLabel htmlFor="provider">模型供应商</FieldLabel>
              <Choice
                id="provider"
                label="模型供应商"
                searchable
                aria-describedby={invalid.model ? "model-error" : undefined}
                invalid={!!invalid.model}
                disabled={busy || !providers.length}
                value={provider}
                options={
                  providers.length
                    ? providers.map((value) => ({ value, label: value }))
                    : [
                        {
                          value: "",
                          label: catalog.loading ? "正在加载" : "无可用供应商",
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
                aria-describedby={invalid.model ? "model-error" : undefined}
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
                          label: catalog.loading ? "正在加载" : "无可用模型",
                        },
                      ]
                }
                onChange={setSelectedModel}
              />
            </Field>
          </FieldGroup>
          <FieldError id="model-error">{invalid.model}</FieldError>
          <Failure error={catalog.error} />
          {!catalog.loading && !catalog.error && !models.length && (
            <Notice title="此引擎尚未配置可用模型或供应商凭据。">
              <Link to={`/agents/${engineId}?tab=models`}>前往配置模型</Link>
            </Notice>
          )}
          {engine && engine.health.status !== "ready" && (
            <Notice title="引擎尚未就绪">
              {engine.health.message || "等待引擎恢复后再分派任务。"}
            </Notice>
          )}
          {catalog.error && (
            <Button variant="outline" type="button" onClick={catalog.reload}>
              <RefreshCw data-icon="inline-start" />
              重新加载模型
            </Button>
          )}
          <FieldGroup className="sm:grid sm:grid-cols-2">
            <Field orientation="horizontal">
              <Switch
                id="manual-permission"
                disabled={engine?.capabilities?.permissions === false}
                checked={manualPermission}
                onCheckedChange={setManualPermission}
              />
              <FieldLabel htmlFor="manual-permission">人工审批权限</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Switch
                id="manual-question"
                disabled={engine?.capabilities?.questions === false}
                checked={manualQuestion}
                onCheckedChange={setManualQuestion}
              />
              <FieldLabel htmlFor="manual-question">人工回答反问</FieldLabel>
            </Field>
          </FieldGroup>
          <Failure error={error} />
          <Separator />
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !canSubmit}>
              <Send data-icon="inline-start" />
              {busy ? "正在提交" : "分派任务"}
            </Button>
          </div>
        </FieldGroup>
      </FieldSet>
    </form>
  )
}
