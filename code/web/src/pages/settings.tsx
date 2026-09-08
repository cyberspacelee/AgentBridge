import { desktop } from "@/lib/desktop"
import type { SystemView } from "../../../shared/system"
import { useContext, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronDown, RefreshCw, Bot } from "lucide-react"
import type { SettingsView } from "../../../shared/settings"
import { api, useQuery } from "@/lib/api"
import { GatewayContext } from "@/lib/gateway"
import { Failure, IconButton, duration, bytes } from "@/components/workspace-ui"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import { NetworkSettingsPanel } from "./network-settings"

export function Settings() {
  const [accessError, setAccessError] = useState<Error>()
  const { runtime, revision } = useContext(GatewayContext)
  const system = useQuery<SystemView>("/api/system", revision)
  const settings = useQuery<SettingsView>("/api/settings")
  return (
    <div className="page settings-page flex flex-col gap-6">
      <div className="page-heading mb-0 flex-nowrap items-start">
        <div className="min-w-0 flex-1">
          <h1>系统信息</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            管理下载源、网络连接与实例运行信息。
          </p>
        </div>
        <IconButton
          label="刷新系统配置"
          onClick={() => {
            settings.reload()
            system.reload()
          }}
        >
          <RefreshCw />
        </IconButton>
      </div>
      <NetworkSettingsPanel />
      <Failure error={accessError ?? settings.error ?? system.error} />
      {system.data?.maintenance !== "ready" && system.data && (
        <p role="status">
          服务正在
          {system.data.maintenance === "draining" ? "等待任务完成" : "停止"}
          ，暂不接受新操作。
        </p>
      )}
      {!runtime || !settings.data ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>实例信息</h2>
              </CardTitle>
              <CardDescription>
                当前网关的版本、存储与运行环境。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="agent-facts">
                <div>
                  <dt>实例</dt>
                  <dd>{runtime.instanceId}</dd>
                </div>
                <div>
                  <dt>应用版本</dt>
                  <dd>{system.data?.version ?? "未知"}</dd>
                </div>
                <div>
                  <dt>Node.js</dt>
                  <dd>{system.data?.nodeVersion ?? "未知"}</dd>
                </div>
                <div>
                  <dt>存储</dt>
                  <dd>{runtime.storage}</dd>
                </div>
                <div>
                  <dt>服务器数据目录</dt>
                  <dd>{settings.data.dataDirectory}</dd>
                </div>
                <div>
                  <dt>配置版本</dt>
                  <dd>{settings.data.revision.slice(0, 12)}</dd>
                </div>
              </dl>
              <Collapsible className="mt-4">
                <CollapsibleTrigger
                  render={<Button variant="ghost" className="group px-0" />}
                >
                  程序路径
                  <ChevronDown
                    data-icon="inline-end"
                    className="transition-transform group-data-panel-open:rotate-180"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <dl className="agent-facts pt-4">
                    <div>
                      <dt>Node 路径</dt>
                      <dd className="break-all">
                        {system.data?.nodePath ?? "未知"}
                      </dd>
                    </div>
                    <div>
                      <dt>npm 路径</dt>
                      <dd className="break-all">
                        {system.data?.npmPath ?? "未发现"}
                      </dd>
                    </div>
                  </dl>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
            <CardFooter className="flex-wrap gap-2">
              <Button variant="outline" render={<Link to="/agents" />}>
                <Bot data-icon="inline-start" />
                管理 Agents
              </Button>
              {!desktop && system.data?.capabilities.restart && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await api("/api/access", { method: "DELETE" })
                      window.dispatchEvent(
                        new CustomEvent("agentbridge:unauthorized")
                      )
                    } catch (error) {
                      setAccessError(error as Error)
                    }
                  }}
                >
                  断开浏览器连接
                </Button>
              )}
            </CardFooter>
          </Card>
          <Card>
            <Collapsible>
              <CardHeader>
                <CardTitle>
                  <h2>
                    <CollapsibleTrigger
                      render={
                        <Button
                          variant="ghost"
                          className="group w-full justify-between px-0 text-base"
                        />
                      }
                    >
                      运行限制
                      <ChevronDown
                        data-icon="inline-end"
                        className="transition-transform group-data-panel-open:rotate-180"
                      />
                    </CollapsibleTrigger>
                  </h2>
                </CardTitle>
                <CardDescription>
                  当前实例的超时、并发与数据保留上限。
                </CardDescription>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="pt-4">
                  <dl className="agent-facts">
                    {Object.entries(runtime.limits).map(([key, value]) => (
                      <div key={key}>
                        <dt>{limitNames[key] ?? key}</dt>
                        <dd>
                          {key.endsWith("Ms")
                            ? duration(value)
                            : key.endsWith("Bytes")
                              ? bytes(value)
                              : value.toLocaleString()}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </>
      )}
    </div>
  )
}

const limitNames: Record<string, string> = {
  startupTimeoutMs: "启动超时",
  runTimeoutMs: "执行超时",
  abortTimeoutMs: "停止超时",
  maxConcurrentRuns: "最大并发执行数",
  maxSessions: "最大会话数",
  maxSseConnections: "最大事件连接数",
  maxQueuedRuns: "最大排队数",
  maxBodyBytes: "请求大小上限",
  maxQueuedPerSession: "单会话排队上限",
  maxArtifactDownloads: "并发文件下载上限",
  maxEvents: "保留事件数",
  maxEventBytes: "事件存储上限",
  maxPartBytes: "消息片段大小上限",
  interactionTimeoutMs: "交互等待超时",
  shutdownTimeoutMs: "关闭超时",
}
