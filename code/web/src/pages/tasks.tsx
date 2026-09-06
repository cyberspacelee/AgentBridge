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
import type { Page, TaskSummary } from "../../../shared/contracts"
import { createTaskSchema } from "../../../shared/contracts"
import { useGateway } from "@/lib/gateway"
import { submit, useQuery } from "@/lib/api"
import {
  Blank,
  Choice,
  date,
  duration,
  Failure,
  IconButton,
  labels,
  Status,
} from "@/components/workspace-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
  const [search, setSearch] = useState(params.get("q") ?? "")
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
  const update = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.delete("cursor")
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    })
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>任务工作台</h1>
        </div>
        <Button
          onClick={() => setOpen(true)}
          disabled={runtime?.health.status !== "ready"}
        >
          <Plus data-icon="inline-start" />
          分派任务
        </Button>
      </div>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          update("q", search)
        }}
      >
        <div className="search-input">
          <Search className="size-4" />
          <Input
            className="pl-9"
            aria-label="搜索任务"
            placeholder="搜索任务名称或 ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
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
      {query.loading ? (
        <div className="space-y-4 py-5">
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
                    <span className="max-w-80 truncate" title={task.directory}>
                      {task.directory}
                    </span>
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
                  <Link
                    aria-label={`打开 ${task.title}`}
                    to={`/tasks/${task.id}`}
                  >
                    <ArrowRight className="size-4" />
                  </Link>
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
      <div className="pagination">
        <span>
          {query.data ? `本页 ${query.data.items.length} 个任务` : ""}
        </span>
        <div className="flex gap-2">
          <IconButton
            label="返回第一页"
            disabled={!params.get("cursor")}
            onClick={() => update("cursor", "")}
          >
            <ArrowLeft />
          </IconButton>
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
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>分派任务</DialogTitle>
          </DialogHeader>
          <CreateTask
            onAccepted={(id) => {
              setOpen(false)
              navigate(`/tasks/${id}`)
            }}
          />
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
  const [manualPermission, setManualPermission] = useState(false)
  const [manualQuestion, setManualQuestion] = useState(false)
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const fields = new FormData(event.currentTarget)
    const provider = String(fields.get("provider") ?? "").trim(),
      model = String(fields.get("model") ?? "").trim()
    const result = createTaskSchema.safeParse({
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
      const accepted = await submit(input)
      onAccepted(accepted.taskId)
    } catch (e) {
      setError(e as Error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={send}>
      <fieldset disabled={busy} className="min-w-0">
        <FieldGroup>
          <Field>
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
            <FieldLabel htmlFor="directory">工作目录</FieldLabel>
            <Input
              id="directory"
              aria-invalid={!!invalid.directory}
              aria-describedby={
                invalid.directory ? "directory-error" : undefined
              }
              name="directory"
              required
              placeholder="D:\test_data\sales"
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="provider">模型供应商</FieldLabel>
              <Input
                id="provider"
                aria-invalid={!!invalid.model}
                aria-describedby={invalid.model ? "model-error" : undefined}
                name="provider"
                defaultValue={runtime?.models[0]?.providerID}
                placeholder="引擎默认"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="model">模型名称</FieldLabel>
              <Input
                id="model"
                aria-invalid={!!invalid.model}
                aria-describedby={invalid.model ? "model-error" : undefined}
                name="model"
                defaultValue={runtime?.models[0]?.modelID}
                placeholder="引擎默认"
              />
            </Field>
          </div>
          <FieldError id="model-error">{invalid.model}</FieldError>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field orientation="horizontal">
              <Switch
                id="manual-permission"
                checked={manualPermission}
                onCheckedChange={setManualPermission}
              />
              <FieldLabel htmlFor="manual-permission">人工审批权限</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Switch
                id="manual-question"
                checked={manualQuestion}
                onCheckedChange={setManualQuestion}
              />
              <FieldLabel htmlFor="manual-question">人工回答反问</FieldLabel>
            </Field>
          </div>
          <Failure error={error} />
          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-xs text-muted-foreground">
              {runtime?.engine}
            </span>
            <Button type="submit" disabled={busy}>
              <Send data-icon="inline-start" />
              {busy ? "正在提交" : "分派任务"}
            </Button>
          </div>
        </FieldGroup>
      </fieldset>
    </form>
  )
}
