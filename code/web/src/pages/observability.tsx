import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { ArrowUpRight, Download, RefreshCw, Server } from "lucide-react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { EngineHealth } from "../../../shared/contracts"
import { useGateway } from "@/lib/gateway"
import { useQuery } from "@/lib/api"
import {
  Blank,
  bytes,
  Choice,
  date,
  duration,
  Failure,
  IconButton,
  number,
  Status,
} from "@/components/workspace-ui"
import { buttonVariants } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Field, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"

interface Overview {
  capturedAt: string
  health: EngineHealth
  accepted: number
  completed: number
  failed: number
  timedOut: number
  cancelled: number
  running: number
  queued: number
  successRate: number | null
  p50ExecutionMs: number | null
  p95ExecutionMs: number | null
  resource: {
    rss: number
    heapUsed: number
    uptimeSeconds: number
    eventLoop: { utilization: number }
    childProcessMemoryBytes: number | null
  }
  toolCalls: number
  toolErrors: number
  tools: { name: string; calls: number; failed: number }[]
  usage: {
    reportedRuns: number
    missingRuns: number
    costUsd: number | null
    input: number | null
    output: number | null
  }
  pendingInteractions: number
  unavailableSessions: number
  oldestQueuedAt: string | null
  http: { requests: number; errors4xx: number; errors5xx: number }
  events: {
    connections: number
    sentBytes: number
    droppedConnections: number
    retained: number
    oldestAt: string | null
  }
  storage: {
    healthy: boolean
    allocatedBytes: number
    sessions: number
    runs: number
  }
}
interface Series {
  metric: string
  unit: string
  points: { at: string; value: number }[]
  availableFrom: string | null
}
interface Log {
  id: number
  occurredAt: string
  stage: string
  code: string
  message: string
  runId: string | null
  sessionId: string | null
}

export function Observability() {
  const { revision, runtime } = useGateway()
  const [params, setParams] = useSearchParams()
  const window = ["15", "60", "1440", "10080"].includes(
    params.get("window") ?? ""
  )
    ? params.get("window")!
    : "60"
  const metric = [
    "activeRuns",
    "queueDepth",
    "rssBytes",
    "heapBytes",
    "completed",
    "failed",
  ].includes(params.get("metric") ?? "")
    ? params.get("metric")!
    : "activeRuns"
  const stage = params.get("stage") ?? ""
  const code = params.get("code") ?? ""
  const change = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    })
  const [refreshPolicy, setRefreshPolicy] = useState({ auto: true, revision })
  const queryRevision = refreshPolicy.auto ? revision : refreshPolicy.revision
  const [clock, setClock] = useState(Date.now)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!refreshPolicy.auto) return
    const timer = setInterval(() => setClock(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [refreshPolicy.auto])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const tab = ["overview", "engine", "tools", "errors"].includes(
    params.get("tab") ?? ""
  )
    ? params.get("tab")!
    : "overview"
  const range = `from=${encodeURIComponent(new Date(clock - Number(window) * 60000).toISOString())}&to=${encodeURIComponent(new Date(clock).toISOString())}`
  const overview = useQuery<Overview>(
    `/api/observability/overview?${range}`,
    queryRevision,
    `overview:${window}`
  )
  const series = useQuery<Series>(
    `/api/observability/series?${range}&metric=${metric}`,
    queryRevision,
    `series:${window}:${metric}`
  )
  const errors = useQuery<{ items: Log[] }>(
    tab === "errors"
      ? `/api/observability/errors?${range}&stage=${encodeURIComponent(stage)}&code=${encodeURIComponent(code)}`
      : null,
    queryRevision,
    tab === "errors" ? `errors:${window}:${stage}:${code}` : null
  )
  const data = overview.data
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>网关观测</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Field orientation="horizontal" className="w-auto">
            <Switch
              id="auto-refresh"
              checked={refreshPolicy.auto}
              onCheckedChange={(auto) => {
                setRefreshPolicy({ auto, revision })
                if (auto) setClock(Date.now())
              }}
            />
            <FieldLabel htmlFor="auto-refresh">自动刷新</FieldLabel>
          </Field>
          <Choice
            label="时间范围"
            value={window}
            options={[
              { value: "15", label: "最近 15 分钟" },
              { value: "60", label: "最近 1 小时" },
              { value: "1440", label: "最近 24 小时" },
              { value: "10080", label: "最近 7 天" },
            ]}
            onChange={(value) => change("window", value)}
          />
          <IconButton
            label="刷新观测数据"
            onClick={() => {
              setClock(Date.now())
              overview.reload()
              series.reload()
              errors.reload()
            }}
          >
            <RefreshCw />
          </IconButton>
        </div>
      </div>
      <div className="observation-meta">
        <span>
          {runtime?.engine ?? "Gateway"} · {runtime?.instanceId.slice(0, 8)}
        </span>
        <span role="status">
          {data
            ? `更新于 ${date(data.capturedAt)}${now - Date.parse(data.capturedAt) > 15000 ? " · 数据已陈旧" : ""}${refreshPolicy.auto ? "" : " · 自动刷新已暂停"}`
            : "正在读取"}
        </span>
      </div>
      <div className="observation-tab-select mb-4">
        <Choice
          label="观测视图"
          value={tab}
          onChange={(value) => change("tab", value)}
          options={[
            { value: "overview", label: "运行概览" },
            { value: "engine", label: "引擎与资源" },
            { value: "tools", label: "工具与用量" },
            { value: "errors", label: "异常与调用链" },
          ]}
        />
      </div>
      <Tabs
        className="observation-tabs"
        value={tab}
        onValueChange={(v) => change("tab", String(v))}
      >
        <TabsList variant="line" className="mb-4">
          <TabsTrigger value="overview">运行概览</TabsTrigger>
          <TabsTrigger value="engine">引擎与资源</TabsTrigger>
          <TabsTrigger value="tools">工具与用量</TabsTrigger>
          <TabsTrigger value="errors">异常与调用链</TabsTrigger>
        </TabsList>
        <Failure error={overview.error} />
        {overview.loading && <Skeleton className="h-64" />}
        <TabsContent value="overview">
          {data && (
            <>
              <dl className="metric-band">
                <Metric
                  label="运行中"
                  value={number(data.running)}
                  detail={`并发上限 ${runtime?.limits.maxConcurrentRuns ?? "未知"}`}
                />
                <Metric
                  label="队列深度"
                  value={number(data.queued)}
                  detail={`待交互 ${data.pendingInteractions}`}
                />
                <Metric
                  label="执行成功率"
                  value={
                    data.successRate === null
                      ? "未知"
                      : `${number(data.successRate * 100)}%`
                  }
                  detail={`完成 ${data.completed} / 失败 ${data.failed + data.timedOut}`}
                />
                <Metric
                  label="P95 执行耗时"
                  value={duration(data.p95ExecutionMs)}
                  detail={`P50 ${duration(data.p50ExecutionMs)}`}
                />
              </dl>
              <section className="chart-section">
                <div className="section-heading">
                  <h2>运行趋势</h2>
                  <Choice
                    label="趋势指标"
                    value={metric}
                    options={[
                      { value: "activeRuns", label: "运行中" },
                      { value: "queueDepth", label: "队列深度" },
                      { value: "rssBytes", label: "网关内存" },
                      { value: "heapBytes", label: "堆内存" },
                      { value: "completed", label: "累计完成" },
                      { value: "failed", label: "累计失败" },
                    ]}
                    onChange={(value) => change("metric", value)}
                  />
                </div>
                <Failure error={series.error} />
                <Trend data={series.data} />
              </section>
              <div className="overview-bottom">
                <section>
                  <h2>执行结果</h2>
                  <dl className="outcome-list">
                    {[
                      ["已受理", data.accepted],
                      ["已完成", data.completed],
                      ["失败", data.failed],
                      ["超时", data.timedOut],
                      ["已取消", data.cancelled],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section>
                  <h2>运行状态</h2>
                  <dl className="outcome-list">
                    <div>
                      <dt>引擎</dt>
                      <dd>
                        <Status state={data.health.status} />
                      </dd>
                    </div>
                    <div>
                      <dt>待处理交互</dt>
                      <dd>{data.pendingInteractions}</dd>
                    </div>
                    <div>
                      <dt>不可用会话</dt>
                      <dd>{data.unavailableSessions}</dd>
                    </div>
                    <div>
                      <dt>最早排队时间</dt>
                      <dd>
                        {data.oldestQueuedAt ? date(data.oldestQueuedAt) : "无"}
                      </dd>
                    </div>
                  </dl>
                </section>
              </div>
            </>
          )}
        </TabsContent>
        <TabsContent value="engine">
          {data && (
            <>
              <div className="section-heading">
                <h2 className="flex items-center gap-2">
                  <Server className="size-4" />
                  {runtime?.engine}
                </h2>
                <Status state={data.health.status} />
              </div>
              <dl className="metric-band">
                <Metric label="网关 RSS" value={bytes(data.resource.rss)} />
                <Metric label="堆内存" value={bytes(data.resource.heapUsed)} />
                <Metric
                  label="事件循环占用"
                  value={`${number(data.resource.eventLoop.utilization * 100)}%`}
                />
                <Metric
                  label="网关运行时长"
                  value={duration(data.resource.uptimeSeconds * 1000)}
                />
              </dl>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>属性</TableHead>
                    <TableHead>当前值</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    ["引擎版本", data.health.version ?? "未知"],
                    ["引擎进程数", data.health.processes],
                    ["进程重启次数", data.health.restarts],
                    [
                      "引擎进程内存",
                      bytes(data.resource.childProcessMemoryBytes),
                    ],
                    ["存储", runtime?.storage],
                    ["启动超时", duration(runtime?.limits.startupTimeoutMs)],
                    ["执行超时", duration(runtime?.limits.runTimeoutMs)],
                    ["会话容量", runtime?.limits.maxSessions],
                    ["SSE 连接上限", runtime?.limits.maxSseConnections],
                    ["引擎诊断", data.health.message ?? "无"],
                  ].map(([label, value]) => (
                    <TableRow key={label}>
                      <TableCell>{label}</TableCell>
                      <TableCell className="max-w-lg break-words whitespace-normal">
                        {value}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-5">
                <a
                  href="/metrics"
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "outline" })}
                >
                  <Download data-icon="inline-start" className="size-4" />
                  Prometheus 指标
                </a>
              </div>
            </>
          )}
        </TabsContent>
        <TabsContent value="tools">
          {data && (
            <>
              <dl className="metric-band">
                <Metric label="工具调用" value={number(data.toolCalls)} />
                <Metric label="工具失败" value={number(data.toolErrors)} />
                <Metric
                  label="输入 / 输出 Token"
                  value={`${number(data.usage.input)} / ${number(data.usage.output)}`}
                  detail={`有用量 ${data.usage.reportedRuns} 轮 / 缺失 ${data.usage.missingRuns} 轮`}
                />
                <Metric
                  label="已报告费用 (USD)"
                  value={number(data.usage.costUsd)}
                />
              </dl>
              {data.tools.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>工具</TableHead>
                      <TableHead>调用次数</TableHead>
                      <TableHead>失败次数</TableHead>
                      <TableHead>失败率</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.tools.map((tool) => (
                      <TableRow key={tool.name}>
                        <TableCell className="max-w-md font-mono break-all whitespace-normal">
                          {tool.name}
                        </TableCell>
                        <TableCell>{tool.calls}</TableCell>
                        <TableCell>{tool.failed}</TableCell>
                        <TableCell>
                          {number((tool.failed / tool.calls) * 100)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Blank>该时间范围内暂无工具调用</Blank>
              )}
            </>
          )}
        </TabsContent>
        <TabsContent value="errors">
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault()
              errors.reload()
            }}
          >
            <Input
              aria-label="错误阶段"
              placeholder="阶段，例如 engine"
              value={stage}
              onChange={(e) => change("stage", e.target.value)}
              className="max-w-56"
            />
            <Input
              aria-label="错误代码"
              placeholder="错误代码"
              value={code}
              onChange={(e) => change("code", e.target.value)}
              className="max-w-64"
            />
          </form>
          <Failure error={errors.error} />
          {errors.data?.items.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>发生时间</TableHead>
                  <TableHead>阶段 / 代码</TableHead>
                  <TableHead>错误信息</TableHead>
                  <TableHead>执行</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errors.data.items.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs">
                      {date(log.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <div>{log.stage}</div>
                      <div className="text-xs text-destructive">{log.code}</div>
                    </TableCell>
                    <TableCell className="max-w-lg break-words whitespace-normal">
                      {log.message}
                    </TableCell>
                    <TableCell>
                      {log.sessionId ? (
                        <Link
                          to={`/tasks/${log.sessionId}?tab=diagnostics${log.runId ? `&run=${log.runId}` : ""}&return=${encodeURIComponent(`/observability?${params}`)}`}
                          className="inline-flex items-center gap-1 text-info underline"
                        >
                          查看
                          <ArrowUpRight className="size-3.5" />
                        </Link>
                      ) : (
                        "无关联执行"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : !errors.loading && !errors.error ? (
            <Blank>该时间范围内暂无错误</Blank>
          ) : errors.loading ? (
            <Skeleton className="h-48" />
          ) : null}
        </TabsContent>
      </Tabs>
      {data && (
        <section className="mt-8 border-t pt-6">
          <h2 className="text-sm font-medium">网关基础指标 · 本实例</h2>
          <dl className="metric-band mt-5">
            <Metric
              label="HTTP 请求"
              value={number(data.http.requests)}
              detail={`4xx ${data.http.errors4xx} / 5xx ${data.http.errors5xx}`}
            />
            <Metric
              label="SSE 连接"
              value={number(data.events.connections)}
              detail={`背压断开 ${data.events.droppedConnections}`}
            />
            <Metric
              label="SSE 已发送"
              value={bytes(data.events.sentBytes)}
              detail={`保留事件 ${data.events.retained}`}
            />
            <Metric
              label="SQLite 已分配"
              value={bytes(data.storage.allocatedBytes)}
              detail={`会话 ${data.storage.sessions} / 执行 ${data.storage.runs}`}
            />
          </dl>
        </section>
      )}
    </div>
  )
}
function Metric({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail && <p>{detail}</p>}
    </div>
  )
}
function Trend({ data }: { data?: Series }) {
  if (!data) return <Skeleton className="h-64" />
  return (
    <>
      <div className="trend">
        {data.points.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data.points}
              margin={{ top: 12, right: 20, bottom: 5, left: 0 }}
              accessibilityLayer
            >
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="at"
                tickFormatter={(value) =>
                  new Date(value).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }
                minTickGap={45}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, "auto"]}
                width={60}
                tickFormatter={(value) =>
                  data.unit === "bytes" ? bytes(value) : number(value)
                }
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                labelFormatter={(value) => date(String(value))}
                formatter={(value) => [
                  data.unit === "bytes"
                    ? bytes(Number(value))
                    : number(Number(value)),
                  data.unit === "bytes" ? "内存" : "数量",
                ]}
                contentStyle={{
                  background: "var(--popover)",
                  color: "var(--popover-foreground)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Line
                type="stepAfter"
                dataKey="value"
                stroke="var(--chart-1)"
                strokeWidth={2}
                dot={data.points.length < 3}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Blank>该时间范围内暂无采样</Blank>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        采样起点 {date(data.availableFrom)}
      </p>
      {!!data.points.length && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer py-2">
            采样数据 · {data.points.length} 条
          </summary>
          <div className="max-h-64 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>采样时间</TableHead>
                  <TableHead>数值 ({data.unit})</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.points.map((point, index) => (
                  <TableRow key={`${point.at}:${index}`}>
                    <TableCell>{date(point.at)}</TableCell>
                    <TableCell>{number(point.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      )}
    </>
  )
}
