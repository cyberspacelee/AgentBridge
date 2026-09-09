import { useState, type FormEvent } from "react"
import {
  defaultRunTimeoutMs,
  runTimeoutSetting,
  type SettingsView,
} from "../../../shared/settings"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field"
import { Failure, duration } from "@/components/workspace-ui"

export function TimeoutSettingsPanel({
  initial,
  fallback,
  onSaved,
}: {
  initial: SettingsView
  fallback: number
  onSaved: (view: SettingsView) => void
}) {
  const [draft, setDraft] = useState<{ view: SettingsView; minutes: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error>()
  const [saved, setSaved] = useState(false)
  const effective = initial.settings.runTimeoutMs ?? fallback
  const minutes = draft?.minutes ?? String(effective / 60000)
  const valid =
    Number.isInteger(Number(minutes)) &&
    runTimeoutSetting.safeParse(Number(minutes) * 60000).success
  const conflict = !!draft && draft.view.revision !== initial.revision
  function edit(minutes: string) {
    setDraft((previous) => ({ view: previous?.view ?? initial, minutes }))
    setSaved(false)
    setError(undefined)
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || !valid || conflict || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const view = await api<SettingsView>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          revision: draft.view.revision,
          settings: {
            ...draft.view.settings,
            runTimeoutMs: Number(minutes) * 60000,
          },
        }),
      })
      onSaved(view)
      setDraft(undefined)
      setSaved(true)
    } catch (error) {
      setError(error as Error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={save} aria-label="任务超时设置">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>任务超时</h2>
          </CardTitle>
          <CardDescription>
            Pi、OpenCode、Codex 和 Grok 共用任务总时限，默认 30 分钟。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm">当前生效：{duration(effective)}</p>
          <Field data-invalid={!!draft && !valid} className="max-w-md">
            <FieldLabel htmlFor="run-timeout-minutes">
              任务总时限（分钟）
            </FieldLabel>
            <Input
              id="run-timeout-minutes"
              type="number"
              min={1}
              max={1440}
              step={1}
              required
              value={minutes}
              disabled={busy}
              aria-invalid={!!draft && !valid}
              aria-describedby="run-timeout-help run-timeout-error"
              onChange={(event) => edit(event.target.value)}
            />
            <FieldDescription id="run-timeout-help">
              可设置 1–1440
              分钟。从提交开始计时，包含排队和等待审批；持续输出不会延长期限。Agent
              完成后的产物登记单独计时。
            </FieldDescription>
            <FieldError id="run-timeout-error">
              {draft && !valid ? "请输入 1–1440 之间的整数分钟数。" : null}
            </FieldError>
          </Field>
          <p className="text-sm text-muted-foreground">
            保存后立即用于新提交的任务，无需重启。已提交的任务保留原期限。模型服务或代理自身的超时仍由对应服务控制。
          </p>
          {conflict && (
            <div
              role="alert"
              className="flex flex-col items-start gap-2 text-sm"
            >
              <p>
                配置已在其他位置修改，当前分钟数已保留。请使用最新配置后再保存。
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setDraft({ view: initial, minutes })
                  setError(undefined)
                }}
              >
                使用最新配置并保留分钟数
              </Button>
            </div>
          )}
          <Failure error={error} />
          {saved && (
            <p role="status" className="text-sm">
              任务超时设置已保存，对新任务生效。
            </p>
          )}
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button type="submit" disabled={busy || !draft || !valid || conflict}>
            {busy ? "正在保存…" : "保存超时设置"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => edit(String(defaultRunTimeoutMs / 60000))}
          >
            恢复默认 30 分钟
          </Button>
          {draft && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDraft(undefined)
                setError(undefined)
              }}
            >
              放弃更改
            </Button>
          )}
        </CardFooter>
      </Card>
    </form>
  )
}
