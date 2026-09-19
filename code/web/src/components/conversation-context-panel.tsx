import type { Run, TaskDetail } from "../../../shared/contracts"
import { date, duration, number } from "@/components/workspace-ui"

export function ConversationContextPanel({
  detail,
  selected,
  runFilter,
}: {
  detail: TaskDetail
  selected?: Run
  runFilter?: string
}) {
  return (
    <>
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
          {detail.task.interactionPolicy.permission === "auto" ? "自动" : "人工"} / {detail.task.interactionPolicy.question === "auto" ? "自动" : "人工"}
        </dd>
        <dt>排队轮次</dt>
        <dd>{detail.task.queuedCount}</dd>
      </dl>
      {selected && (
        <>
          <h2 className="mt-8">
            {runFilter ? `执行 #${selected.sequence} 用量` : `最近执行 #${selected.sequence} 用量`}
          </h2>
          <dl className="metadata">
            <dt>接收时间</dt>
            <dd>{date(selected.acceptedAt)}</dd>
            <dt>本轮总时限</dt>
            <dd>{duration(Date.parse(selected.deadlineAt) - Date.parse(selected.acceptedAt))}</dd>
            <dt>截止时间</dt>
            <dd>{date(selected.deadlineAt)}</dd>
            <dt>输入 Token</dt>
            <dd>{number(selected.usage?.input)}</dd>
            <dt>输出 Token</dt>
            <dd>{number(selected.usage?.output)}</dd>
            <dt>缓存读取 Token</dt>
            <dd>{number(selected.usage?.cacheRead)}</dd>
            <dt>费用 (USD)</dt>
            <dd>{number(selected.usage?.costUsd)}</dd>
            <dt>执行耗时</dt>
            <dd>{duration(selected.startedAt && selected.finishedAt ? Date.parse(selected.finishedAt) - Date.parse(selected.startedAt) : null)}</dd>
          </dl>
        </>
      )}
    </>
  )
}
