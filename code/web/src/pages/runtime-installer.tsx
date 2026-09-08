import { useEffect, useRef, useState } from "react"
import { Download, RefreshCw, Trash2, X } from "lucide-react"
import type { RuntimeAction, RuntimeView } from "../../../shared/runtimes"
import type { AgentView } from "../../../shared/settings"
import { api } from "@/lib/api"
import { agentNames } from "@/lib/agent-draft"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  bytes,
  date,
  ConfirmDialog,
  Failure,
  IconButton,
  Notice,
} from "@/components/workspace-ui"

const installationLabels = {
  not_installed: "未安装",
  installed: "已安装",
  installing: "安装中",
  uninstalling: "卸载中",
  failed: "操作失败",
}
const updateLabels = {
  idle: "尚未检查",
  checking: "检查中",
  available: "有更新",
  downloading: "下载中",
  switching: "等待任务结束并切换版本",
  failed: "更新失败",
}

export function RuntimeInstaller({
  runtime,
  agent,
  error,
  reload,
}: {
  runtime?: RuntimeView
  agent: AgentView
  error?: Error
  reload: () => void
}) {
  const [pending, setPending] = useState<RuntimeAction>()
  const [actionError, setActionError] = useState<Error>()
  const [confirming, setConfirming] = useState(false)
  const checked = useRef(false)
  async function perform(action: RuntimeAction) {
    setPending(action)
    setActionError(undefined)
    try {
      await api(`/api/runtimes/${agent.id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action }),
      })
      setConfirming(false)
    } catch (error) {
      setActionError(error as Error)
    } finally {
      setPending(undefined)
      reload()
    }
  }
  useEffect(() => {
    if (!runtime?.managed || checked.current) return
    checked.current = true
    if (!runtime.operation)
      void api(`/api/runtimes/${agent.id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: "check" }),
      })
        .catch(setActionError)
        .finally(reload)
  }, [runtime, agent.id, reload])

  if (!runtime)
    return error ? <Failure error={error} /> : <Skeleton className="h-64" />
  const busy = !!pending || !!runtime.operation
  const latest = runtime.latestVersion
  const isLatest =
    !runtime.checkError && !!latest && latest === runtime.installedVersion
  const progress =
    runtime.progress === null
      ? undefined
      : Math.min(100, Math.max(0, runtime.progress))
  return (
    <section
      className="settings-section flex min-w-0 flex-col gap-5"
      aria-label="安装与版本"
    >
      <div className="settings-section-heading">
        <h2>{agentNames[agent.id]} CLI</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={runtime.status === "failed" ? "destructive" : "secondary"}
          >
            {!runtime.managed
              ? "主机 CLI"
              : runtime.status === "installed" && !runtime.usable
                ? "程序不可用"
                : installationLabels[runtime.status]}
          </Badge>
          {runtime.managed && (
            <IconButton
              label="检查更新"
              disabled={busy}
              onClick={() => void perform("check")}
            >
              <RefreshCw />
            </IconButton>
          )}
        </div>
      </div>
      <Failure error={error} />
      {!confirming && <Failure error={actionError} />}
      <Failure error={runtime.error ? new Error(runtime.error) : undefined} />
      {runtime.checkError && (
        <Notice title="最新版查询失败" variant="destructive">
          <span className="break-words">
            {runtime.checkError}
            {latest ? " · 下方保留上次查询结果" : ""}
          </span>
        </Notice>
      )}
      <dl className="agent-facts">
        <div>
          <dt>平台</dt>
          <dd>{runtime.platform}</dd>
        </div>
        <div>
          <dt>磁盘占用</dt>
          <dd>{bytes(runtime.sizeBytes)}</dd>
        </div>
        <div>
          <dt>已安装版本</dt>
          <dd>{runtime.installedVersion ?? "未安装"}</dd>
        </div>
        <div>
          <dt>当前运行版本</dt>
          <dd>{runtime.runningVersion ?? "未运行"}</dd>
        </div>
        <div>
          <dt>最新稳定版</dt>
          <dd>
            {latest ?? "未知"}
            {runtime.checkError && latest ? " · 缓存" : ""}
          </dd>
        </div>
        <div>
          <dt>上次查询成功</dt>
          <dd>{date(runtime.checkedAt)}</dd>
        </div>
        {runtime.managed && (
          <div>
            <dt>更新状态</dt>
            <dd role="status">
              {runtime.updateStatus === "idle" && isLatest
                ? "已是最新版"
                : updateLabels[runtime.updateStatus]}
            </dd>
          </div>
        )}
        {runtime.source && (
          <div>
            <dt>安装来源</dt>
            <dd>{runtime.source}</dd>
          </div>
        )}
      </dl>
      {runtime.operation && runtime.operation !== "check" && (
        <div className="flex min-w-0 flex-col gap-2" aria-live="polite">
          <p className="text-sm">
            {runtime.operation === "uninstall"
              ? "等待当前任务结束后卸载"
              : runtime.updateStatus === "switching"
                ? updateLabels.switching
                : "正在下载并校验"}
            {progress !== undefined ? ` · ${Math.round(progress)}%` : ""}
          </p>
          <progress
            className="h-2 w-full accent-primary"
            aria-label="运行时安装进度"
            max={100}
            value={progress}
          />
          {runtime.downloadedBytes > 0 && (
            <span className="text-sm text-muted-foreground">
              {bytes(runtime.downloadedBytes)} / {bytes(runtime.totalBytes)}
            </span>
          )}
        </div>
      )}
      {runtime.managed && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || (runtime.usable && isLatest && !runtime.error)}
            onClick={() =>
              void perform(
                runtime.installedVersion && runtime.usable
                  ? "update"
                  : "install"
              )
            }
          >
            <Download data-icon="inline-start" />
            {runtime.installedVersion
              ? runtime.usable
                ? "更新到最新版"
                : "重新安装最新版"
              : "安装最新版"}
          </Button>
          {(runtime.installedVersion || runtime.status === "failed") && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              <Trash2 data-icon="inline-start" />
              卸载
            </Button>
          )}
          {runtime.cancelable && (
            <Button
              variant="outline"
              disabled={!!pending}
              onClick={() => void perform("cancel")}
            >
              <X data-icon="inline-start" />
              取消下载
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title={`卸载 ${agentNames[agent.id]}？`}
        description={`取消 ${agent.queuedRuns} 个排队任务，等待 ${agent.activeRuns} 个正在执行的任务及审批结束后停用并卸载。保留模型配置、API Key、会话、任务历史和产物。`}
        confirmLabel="卸载"
        busy={!!pending}
        error={actionError}
        onOpenChange={(open) => {
          setConfirming(open)
          setActionError(undefined)
        }}
        onConfirm={() => void perform("uninstall")}
      />
    </section>
  )
}
