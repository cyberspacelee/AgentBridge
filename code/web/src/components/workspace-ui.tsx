import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import { toast } from "sonner"
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
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"

export const labels: Record<string, string> = {
  queued: "排队中",
  running: "执行中",
  stopping: "正在停止",
  disabled: "已停用",
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
  live: "已连接",
  reconnecting: "正在重连",
  connecting: "正在连接",
  not_checked: "未校验",
}
export function Status({ state }: { state: string }) {
  const tone = ["running", "starting", "replying", "connecting"].includes(state)
    ? "info"
    : [
          "ready",
          "completed",
          "resolved",
          "available",
          "passed",
          "live",
        ].includes(state)
      ? "success"
      : [
            "waiting_input",
            "stopping",
            "deleting",
            "changed",
            "reconnecting",
          ].includes(state)
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
    <Badge variant={tone} className="status" data-tone={tone}>
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
      onClick={async () => {
        try {
          if (navigator.clipboard) await navigator.clipboard.writeText(text)
          else {
            // LAN HTTP pages cannot use the secure-context Clipboard API.
            const active = document.activeElement as HTMLElement | null
            const field = document.createElement("textarea")
            field.value = text
            field.readOnly = true
            Object.assign(field.style, {
              position: "fixed",
              opacity: "0",
              fontSize: "16px",
            })
            ;(active?.closest('[role="dialog"]') ?? document.body).append(field)
            try {
              field.select()
              if (!document.execCommand("copy")) throw new Error("Copy failed")
            } finally {
              field.remove()
              active?.focus({ preventScroll: true })
            }
          }
          setResult("已复制")
          toast.success("已复制", { id: "clipboard" })
        } catch {
          setResult("复制失败")
          toast.error("复制失败", {
            id: "clipboard",
            description: "请检查浏览器剪贴板权限后重试。",
          })
        }
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
        {error instanceof ApiError
          ? ((
              {
                CONFLICT: "配置或状态已变化",
                VALIDATION_ERROR: "请检查配置",
                SERVICE_UNAVAILABLE: "服务暂不可用",
                NOT_FOUND: "内容不存在",
              } as Record<string, string>
            )[error.code] ?? "请求失败")
          : "请求失败"}
      </AlertTitle>
      <AlertDescription className="break-words">
        <span>{error.message}</span>
        {error instanceof ApiError && (
          <Collapsible className="mt-1 text-xs">
            <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
              诊断信息
            </CollapsibleTrigger>
            <CollapsibleContent className="font-mono">
              {error.code}
              {error.requestId ? ` · ${error.requestId}` : ""}
            </CollapsibleContent>
          </Collapsible>
        )}
      </AlertDescription>
    </Alert>
  )
}
export function Notice({
  title,
  children,
  variant = "default",
}: {
  title: string
  children?: ReactNode
  variant?: ComponentProps<typeof Alert>["variant"]
}) {
  return (
    <Alert variant={variant} role="status">
      <AlertCircle aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy,
  error,
  onOpenChange,
  onConfirm,
  finalFocus,
}: {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel: string
  busy: boolean
  error?: Error
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  finalFocus?: HTMLElement | null
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
    >
      <AlertDialogContent
        initialFocus={cancel}
        finalFocus={
          finalFocus
            ? () =>
                finalFocus.isConnected
                  ? finalFocus
                  : document.getElementById("main-content")
            : undefined
        }
        aria-busy={busy}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <Failure error={error} />
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancel} disabled={busy}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy && (
              <LoaderCircle
                data-icon="inline-start"
                className="motion-safe:animate-spin"
              />
            )}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
export function Blank({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <Empty className="workspace-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle className="tracking-normal">{children}</EmptyTitle>
      </EmptyHeader>
      {action}
    </Empty>
  )
}
export function Choice({
  label,
  value,
  options,
  onChange,
  id,
  disabled,
  invalid,
  searchable = false,
  ...triggerProps
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  id?: string
  disabled?: boolean
  invalid?: boolean
  searchable?: boolean
  "aria-describedby"?: string
}) {
  if (searchable)
    return (
      <Combobox
        items={options.map((option) => option.value)}
        value={value || null}
        itemToStringLabel={(value) =>
          options.find((option) => option.value === value)?.label ?? value
        }
        disabled={disabled}
        onValueChange={(option) => {
          if (option) onChange(option)
        }}
      >
        <ComboboxInput
          id={id}
          aria-label={label}
          aria-invalid={invalid}
          disabled={disabled}
          placeholder={`选择${label}`}
          {...triggerProps}
        />
        <ComboboxContent>
          <ComboboxEmpty>没有匹配的选项</ComboboxEmpty>
          <ComboboxList>
            {(value: string) => (
              <ComboboxItem key={value} value={value}>
                {options.find((option) => option.value === value)?.label ??
                  value}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    )
  return (
    <Select
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        if (v !== null) onChange(v)
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        aria-invalid={invalid}
        {...triggerProps}
      >
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
