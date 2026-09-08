import { useContext } from "react"
import { Link } from "react-router-dom"
import { RefreshCw, Bot } from "lucide-react"
import type { SettingsView } from "../../../shared/settings"
import { useQuery } from "@/lib/api"
import { GatewayContext } from "@/lib/gateway"
import { Failure, IconButton, duration, bytes } from "@/components/workspace-ui"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { NetworkSettingsPanel } from "./network-settings"

export function Settings() {
  const { runtime } = useContext(GatewayContext)
  const settings = useQuery<SettingsView>("/api/settings")
  return (
    <div className="page settings-page">
      <div className="page-heading">
        <h1>系统信息</h1>
        <IconButton label="刷新系统配置" onClick={settings.reload}>
          <RefreshCw />
        </IconButton>
      </div>
      <NetworkSettingsPanel />
      <Failure error={settings.error} />
      {!runtime || !settings.data ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          <section className="settings-section">
            <h2>网关</h2>
            <dl className="agent-facts">
              <div>
                <dt>实例</dt>
                <dd>{runtime.instanceId}</dd>
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
          </section>
          <div className="py-4">
            <Button variant="outline" render={<Link to="/agents" />}>
              <Bot />
              管理 Agents
            </Button>
          </div>
          <section className="settings-section">
            <h2>运行限制</h2>
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
          </section>
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
