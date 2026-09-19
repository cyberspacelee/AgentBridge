import { useState, type FormEvent } from "react"
import { History, Send } from "lucide-react"
import type { Run } from "../../../shared/contracts"
import { promptSchema } from "../../../shared/contracts"
import { useGateway } from "@/lib/gateway"
import { submit, useRequestSignal } from "@/lib/api"
import { Failure, IconButton, Notice } from "@/components/workspace-ui"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group"

export function ConversationComposer({
  sessionId,
  disabled,
  disabledReason,
  run,
  onAccepted,
}: {
  sessionId: string
  disabled: boolean
  disabledReason?: string
  run?: Run
  onAccepted: (runId: string) => void
}) {
  const requestSignal = useRequestSignal(sessionId)
  const { runtime } = useGateway()
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error>()
  async function send(event: FormEvent) {
    event.preventDefault()
    if (busy || disabled) return
    const signal = requestSignal()
    setBusy(true)
    setError(undefined)
    try {
      const input = promptSchema.parse({ parts: [{ type: "text", text }] })
      const result = await submit(input, runtime!.storeId, sessionId, signal)
      signal.throwIfAborted()
      setText("")
      onAccepted(result.runId)
    } catch (e) {
      if (!signal.aborted) setError(e as Error)
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
  return (
    <form className="follow-up" onSubmit={send}>
      <Field>
        <FieldLabel htmlFor="follow-up" className="sr-only">
          追加任务
        </FieldLabel>
        <InputGroup>
          <InputGroupTextarea
            id="follow-up"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.ctrlKey || e.metaKey) &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            rows={1}
            required
            disabled={disabled || busy}
            placeholder="发送消息，或补充要求"
          />
          <InputGroupAddon align="inline-end">
            <IconButton
              label={busy ? "正在提交" : "提交新一轮"}
              type="submit"
              variant="default"
              disabled={disabled || busy || !text.trim()}
            >
              <Send />
            </IconButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>
      <Failure error={error} />
      {disabledReason && <Notice title={disabledReason} />}
      <div className="follow-up-actions">
        <span className="text-xs text-muted-foreground">
          {run && ["running", "queued", "stopping"].includes(run.state)
            ? "新一轮将在当前执行后排队"
            : (run?.model?.modelID ?? "引擎默认模型")}
        </span>
        <div className="flex flex-wrap gap-2">
          {run && ["failed", "timed_out", "cancelled"].includes(run.state) && (
            <Button
              variant="outline"
              disabled={disabled || busy}
              onClick={() => setText(run.inputParts.map((part) => part.text).join("\n"))}
            >
              <History data-icon="inline-start" />
              填入上轮要求
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
