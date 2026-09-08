import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Wrench } from "lucide-react"
import type { ToolPart } from "../../../shared/contracts"
import { Button } from "@/components/ui/button"
import { CopyText, ElapsedTime, Status } from "@/components/workspace-ui"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

export function ToolCall({ part }: { part: ToolPart }) {
  const failed = part.state.status === "failed" || part.state.status === "interrupted"
  const [view, setView] = useState({ failed, open: failed })
  const [limit, setLimit] = useState(4096)
  if (view.failed !== failed) setView({ failed, open: failed || view.open })
  const result = useMemo(() => {
    let text = part.output
    if (
      part.state.status === "completed" &&
      new TextEncoder().encode(text).length <= 65536
    ) {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        /* Plain output stays literal. */
      }
    }
    const encoded = new TextEncoder().encode(text)
    let visible = new TextDecoder().decode(encoded.subarray(0, limit), {
      stream: encoded.length > limit,
    })
    if (limit === 4096) visible = visible.split("\n").slice(0, 12).join("\n")
    return { visible, more: visible.length < text.length, size: encoded.length }
  }, [part.output, part.state.status, limit])
  const input =
    part.input && typeof part.input === "object"
      ? (part.input as Record<string, unknown>)
      : {}
  const target = [input.filePath, input.path, input.file, input.command].find(
    (v) => typeof v === "string"
  ) as string | undefined
  const elapsed = (
    <ElapsedTime
      start={part.startedAt}
      end={part.finishedAt}
      active={part.state.status === "running"}
    />
  )
  return (
    <Collapsible
      render={<section />}
      className="tool-call"
      aria-label={`工具 ${part.tool}`}
      open={view.open}
      onOpenChange={(open) => setView({ failed, open })}
    >
      <CollapsibleTrigger
        render={<Button variant="ghost" size="row" />}
        className="tool-summary"
      >
        {view.open ? (
          <ChevronDown aria-hidden="true" />
        ) : (
          <ChevronRight aria-hidden="true" />
        )}
        <Wrench aria-hidden="true" />
        <span className="tool-name">
          <strong>{part.tool}</strong>
          {target && <small>{target}</small>}
        </span>
        <Status state={part.state.status} />
        <span className="tool-duration">{elapsed}</span>
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted>
        <Separator />
        <div className="tool-content">
          <div className="flex items-center justify-between gap-2">
            <h3>{failed ? "错误详情" : "结果"}</h3>
            <CopyText text={part.output} label="复制已接收输出" />
          </div>
          <ScrollArea
            viewportProps={{
              className: "max-h-80",
              tabIndex: 0,
              "aria-label": "工具输出",
            }}
          >
            <pre>
              {result.visible ||
                (part.state.status === "pending"
                  ? "尚未开始"
                  : part.state.status === "running"
                    ? "等待工具输出"
                    : "无文本输出")}
            </pre>
          </ScrollArea>
          {result.more && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-muted-foreground">预览已省略</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setLimit((n) =>
                    n === 4096 ? Math.min(result.size, 65536) : n + 16384
                  )
                }
              >
                显示更多
              </Button>
            </div>
          )}
          <Collapsible>
            <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
              <ChevronDown data-icon="inline-start" />
              输入
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea
                viewportProps={{
                  className: "max-h-80",
                  tabIndex: 0,
                  "aria-label": "工具输入",
                }}
              >
                <pre>{JSON.stringify(part.input, null, 2)}</pre>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>
          <Collapsible>
            <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
              <ChevronDown data-icon="inline-start" />
              诊断
            </CollapsibleTrigger>
            <CollapsibleContent>
              <dl className="metadata">
                <dt>调用 ID</dt>
                <dd className="font-mono">{part.toolCallId}</dd>
                <dt>耗时</dt>
                <dd>{elapsed}</dd>
                {target && (
                  <>
                    <dt>目标</dt>
                    <dd className="font-mono">{target}</dd>
                  </>
                )}
              </dl>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
