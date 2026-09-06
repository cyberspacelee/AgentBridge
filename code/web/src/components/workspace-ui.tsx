import { useEffect, useState, type ComponentProps, type ReactNode } from "react"
import {
  AlertCircle,
  Check,
  Clock,
  Copy,
  Inbox,
  LoaderCircle,
  MessageSquare,
  Square,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ApiError } from "@/lib/api"

export const labels: Record<string, string> = {
  queued: "排队中",
  running: "执行中",
  stopping: "正在停止",
  completed: "已完成",
  failed: "失败",
  timed_out: "超时",
  cancelled: "已取消",
  not_started: "未开始",
  waiting_input: "等待回复",
  unavailable: "不可用",
  deleting: "正在删除",
  ready: "就绪",
  starting: "启动中",
  degraded: "异常",
  pending: "待处理",
  replying: "正在回复",
  resolved: "已回复",
  expired: "已过期",
  interrupted: "已中断",
  available: "可用",
  missing: "文件缺失",
  changed: "文件已修改",
  passed: "检查通过",
}
export function Status({ state }: { state: string }) {
  const tone = ["running", "starting", "replying"].includes(state)
    ? "info"
    : ["ready", "completed", "resolved", "available", "passed"].includes(state)
      ? "success"
      : ["waiting_input", "stopping", "deleting", "changed"].includes(state)
        ? "warning"
        : [
              "failed",
              "timed_out",
              "degraded",
              "unavailable",
              "interrupted",
              "missing",
            ].includes(state)
          ? "danger"
          : "neutral"
  const Icon =
    tone === "info"
      ? LoaderCircle
      : tone === "success"
        ? Check
        : tone === "danger"
          ? AlertCircle
          : state === "waiting_input"
            ? MessageSquare
            : state === "cancelled"
              ? Square
              : Clock
  return (
    <Badge variant={tone} className="status rounded" data-tone={tone}>
      <Icon
        aria-hidden="true"
        className={tone === "info" ? "status-spinner" : undefined}
      />
      {labels[state] ?? state}
    </Badge>
  )
}
export function CopyText({
  text,
  label = "复制文本",
}: {
  text: string
  label?: string
}) {
  const [result, setResult] = useState("")
  useEffect(() => {
    if (!result) return
    const timer = setTimeout(() => setResult(""), 2500)
    return () => clearTimeout(timer)
  }, [result])
  return (
    <IconButton
      label={result || label}
      disabled={!text}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => setResult("已复制"),
          () => setResult("复制失败")
        )
      }}
    >
      {result === "已复制" ? <Check /> : <Copy />}
    </IconButton>
  )
}
export function ElapsedTime({
  start,
  end,
  active = false,
}: {
  start: string | null | undefined
  end: string | null | undefined
  active?: boolean
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active || !start || end) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active, start, end])
  return (
    <span>
      {active && start && !end ? "已用 " : ""}
      {duration(
        start && (end || active)
          ? Math.max(0, (end ? Date.parse(end) : now) - Date.parse(start))
          : null
      )}
    </span>
  )
}
export function IconButton({
  label,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={label} {...props} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
export function Failure({ error }: { error?: Error | null }) {
  if (!error) return null
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>
        {error instanceof ApiError ? error.code : "请求失败"}
      </AlertTitle>
      <AlertDescription className="break-words">
        {error.message}
        {error instanceof ApiError && error.requestId && (
          <div className="mt-1 font-mono text-xs">
            Request ID: {error.requestId}
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}
export function Blank({ children }: { children: ReactNode }) {
  return (
    <Empty className="min-h-48">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle className="tracking-normal">{children}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  )
}
export function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v)
      }}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
export const date = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        hour12: false,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "未知"
export const number = (value: number | null | undefined) =>
  value == null
    ? "未知"
    : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value)
export const duration = (value: number | null | undefined) =>
  value == null
    ? "未知"
    : value >= 60000
      ? `${number(value / 60000)} 分钟`
      : `${number(value / 1000)} 秒`
export const bytes = (value: number | null | undefined) =>
  value == null
    ? "未知"
    : value >= 1048576
      ? `${number(value / 1048576)} MB`
      : `${number(value / 1024)} KB`
