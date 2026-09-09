import { useEffect, useState, type FormEvent } from "react"
import { ZodError } from "zod"
import { Plus, Save, Trash2, LoaderCircle } from "lucide-react"
import {
  providerSchema,
  skillSchema,
  mcpSchema,
  type Settings as Configuration,
} from "../../../shared/settings"
import { Choice, Failure, IconButton } from "@/components/workspace-ui"
import { desktop } from "@/lib/desktop"
import { DirectoryInput } from "@/components/directory-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldError,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field"

type Entry =
  | Configuration["providers"][number]
  | Configuration["skills"][number]
  | Configuration["mcp"][number]
export function EntryEditor({
  kind,
  entry,
  busy,
  submit,
  existingIds,
  onDirtyChange,
}: {
  kind: "providers" | "skills" | "mcp"
  entry?: Entry
  busy: boolean
  submit: (entry: Entry) => Promise<void>
  existingIds: string[]
  onDirtyChange: (dirty: boolean) => void
}) {
  const [id, setId] = useState(entry?.id ?? "")
  const provider = entry && "baseUrl" in entry ? entry : undefined
  const skill = entry && "path" in entry ? entry : undefined
  const mcp = entry && "config" in entry ? entry : undefined
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "")
  const [key, setKey] = useState(provider?.apiKey ?? "")
  const [protocol, setProtocol] = useState(
    provider?.api ?? "openai-completions"
  )
  const [models, setModels] = useState(
    provider?.models ?? [
      {
        id: "",
        name: "",
        thinking: "default" as const,
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ]
  )
  const [path, setPath] = useState(skill?.path ?? "")
  const [mcpType, setMcpType] = useState(mcp?.config.type ?? "local")
  const [endpoint, setEndpoint] = useState(
    mcp?.config.type === "remote" ? mcp.config.url : ""
  )
  const [command, setCommand] = useState(
    mcp?.config.type === "local" ? mcp.config.command : [""]
  )
  const [secrets, setSecrets] = useState(
    Object.entries(
      mcp?.config.type === "local"
        ? mcp.config.environment
        : (mcp?.config.headers ?? {})
    ).map(([name, value]) => ({ name, value }))
  )
  const snapshot = JSON.stringify({
    id,
    baseUrl,
    key,
    protocol,
    models,
    path,
    mcpType,
    endpoint,
    command,
    secrets,
  })
  const [initial] = useState(snapshot)
  const dirty = snapshot !== initial
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => {
    if (!dirty) return
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [dirty])
  const [error, setError] = useState<Error>()
  const [invalid, setInvalid] = useState<Record<string, string>>({})
  const fieldProps = (name: string) => ({
    "aria-invalid": !!invalid[name],
    "aria-describedby": invalid[name] ? `${name}-error` : undefined,
  })
  const fieldError = (name: string) => (
    <FieldError id={`${name}-error`}>{invalid[name]}</FieldError>
  )
  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(undefined)
    setInvalid({})
    if (!entry && existingIds.includes(id)) {
      setInvalid({ id: "标识已存在" })
      return
    }
    try {
      const enabled = entry?.enabled ?? true
      if (
        kind === "mcp" &&
        new Set(secrets.map((item) => item.name)).size !== secrets.length
      ) {
        setInvalid({
          [mcpType === "local" ? "config.environment" : "config.headers"]:
            "键名不能重复",
        })
        return
      }
      const result =
        kind === "providers"
          ? providerSchema.parse({
              id,
              baseUrl,
              apiKey: key,
              api: protocol,
              enabled,
              models: models.map((model) => ({
                ...model,
                id: model.id.trim(),
              })),
            })
          : kind === "skills"
            ? skillSchema.parse({ id, path, enabled })
            : mcpSchema.parse({
                id,
                enabled,
                config:
                  mcpType === "local"
                    ? {
                        type: "local",
                        command,
                        environment: Object.fromEntries(
                          secrets.map((item) => [item.name, item.value])
                        ),
                      }
                    : {
                        type: "remote",
                        url: endpoint,
                        headers: Object.fromEntries(
                          secrets.map((item) => [item.name, item.value])
                        ),
                      },
              })
      await submit(result)
    } catch (e) {
      if (e instanceof ZodError)
        setInvalid(
          Object.fromEntries(
            e.issues.map((issue) => {
              const path = issue.path.join(".")
              const name = path.startsWith("config.command")
                ? "config.command"
                : path.startsWith("config.environment")
                  ? "config.environment"
                  : path.startsWith("config.headers")
                    ? "config.headers"
                    : path
              return [name, issue.message]
            })
          )
        )
      else setError(e as Error)
    }
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
      <Failure error={error} />
      <FieldSet disabled={busy}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="entry-id">资源标识</FieldLabel>
            <Input
              id="entry-id"
              {...fieldProps("id")}
              required
              pattern="[a-zA-Z0-9_\-]+"
              title="英文字母、数字、下划线或连字符"
              placeholder={
                kind === "providers"
                  ? "company-models"
                  : kind === "skills"
                    ? "office-tools"
                    : "workspace-mcp"
              }
              disabled={!!entry}
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
            {fieldError("id")}
          </Field>
          {kind === "providers" && (
            <>
              <Field>
                <FieldLabel htmlFor="base-url">Base URL</FieldLabel>
                <Input
                  id="base-url"
                  {...fieldProps("baseUrl")}
                  required
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                />
                {fieldError("baseUrl")}
              </Field>
              <Field>
                <FieldLabel htmlFor="api-key">API Key</FieldLabel>
                <Input
                  id="api-key"
                  {...fieldProps("apiKey")}
                  type="password"
                  autoComplete="new-password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
                {fieldError("apiKey")}
              </Field>
              <Field>
                <FieldLabel htmlFor="protocol">API 协议</FieldLabel>
                <Choice
                  id="protocol"
                  label="API 协议"
                  invalid={!!invalid.api}
                  aria-describedby={invalid.api ? "api-error" : undefined}
                  value={protocol}
                  onChange={(value) => setProtocol(value as typeof protocol)}
                  options={[
                    { value: "openai-completions", label: "Chat Completions" },
                    { value: "openai-responses", label: "Responses" },
                  ]}
                />
                {fieldError("api")}
              </Field>
              <div className="settings-section-heading">
                <h2>模型</h2>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || models.length >= 100}
                  onClick={() =>
                    setModels([
                      ...models,
                      {
                        id: "",
                        name: "",
                        thinking: "default",
                        contextWindow: 128000,
                        maxTokens: 16384,
                      },
                    ])
                  }
                >
                  <Plus data-icon="inline-start" />
                  添加模型
                </Button>
              </div>
              {fieldError("models")}
              {models.map((model, index) => (
                <div
                  className="settings-model-row"
                  key={index}
                  role="group"
                  aria-label={`模型 ${index + 1}`}
                >
                  <Field>
                    <FieldLabel htmlFor={`model-${index}-id`}>
                      模型 ID
                    </FieldLabel>
                    <Input
                      id={`model-${index}-id`}
                      {...fieldProps(`models.${index}.id`)}
                      required
                      maxLength={200}
                      value={model.id}
                      onChange={(e) =>
                        setModels(
                          models.map((item, i) =>
                            i === index ? { ...item, id: e.target.value } : item
                          )
                        )
                      }
                    />
                    {fieldError(`models.${index}.id`)}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`model-${index}-thinking`}>
                      模型思考
                    </FieldLabel>
                    <Choice
                      id={`model-${index}-thinking`}
                      label={`模型 ${index + 1} 思考`}
                      value={model.thinking}
                      onChange={(value) =>
                        setModels(
                          models.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  thinking: value as typeof item.thinking,
                                }
                              : item
                          )
                        )
                      }
                      options={[
                        { value: "default", label: "默认" },
                        { value: "off", label: "关闭思考" },
                      ]}
                    />
                  </Field>
                  {(
                    [
                      ["contextWindow", "上下文长度", 1024, 10000000],
                      ["maxTokens", "最大输出长度", 1, 1000000],
                    ] as const
                  ).map(([key, label, min, max]) => (
                    <Field key={key}>
                      <FieldLabel htmlFor={`model-${index}-${key}`}>
                        {label}
                      </FieldLabel>
                      <Input
                        id={`model-${index}-${key}`}
                        {...fieldProps(`models.${index}.${key}`)}
                        type="number"
                        required
                        min={min}
                        max={max}
                        step={1}
                        value={Number.isNaN(model[key]) ? "" : model[key]}
                        onChange={(e) =>
                          setModels(
                            models.map((item, i) =>
                              i === index
                                ? { ...item, [key]: e.target.valueAsNumber }
                                : item
                            )
                          )
                        }
                      />
                      {fieldError(`models.${index}.${key}`)}
                    </Field>
                  ))}
                  <IconButton
                    type="button"
                    label={`删除模型 ${index + 1}`}
                    disabled={busy || models.length === 1}
                    onClick={() =>
                      setModels(models.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              ))}
              <FieldDescription>
                关闭思考会请求模型禁用推理，需要模型服务支持；不会仅隐藏思考内容。保存后需在使用此模型的
                Agent 中应用配置。
              </FieldDescription>
            </>
          )}
          {kind === "skills" && (
            <>
              <Field>
                <FieldLabel htmlFor="skill-path">
                  {desktop ? "Skill 目录" : "服务器 Skill 目录"}
                </FieldLabel>
                <DirectoryInput
                  id="skill-path"
                  {...fieldProps("path")}
                  required
                  value={path}
                  onValueChange={setPath}
                  disabled={busy}
                  placeholder="/path/to/skills"
                />
                {fieldError("path")}
              </Field>
            </>
          )}
          {kind === "mcp" && (
            <>
              <Field>
                <FieldLabel htmlFor="mcp-type">连接类型</FieldLabel>
                <Choice
                  id="mcp-type"
                  label="连接类型"
                  value={mcpType}
                  onChange={(value) => {
                    setMcpType(value as typeof mcpType)
                    setSecrets([])
                  }}
                  options={[
                    { value: "local", label: "本地 stdio" },
                    { value: "remote", label: "远程 HTTP" },
                  ]}
                />
              </Field>
              {mcpType === "local" ? (
                <FieldGroup>
                  {command.map((value, index) => (
                    <Field key={index}>
                      <FieldLabel htmlFor={`mcp-command-${index}`}>
                        {index === 0 ? "服务器命令" : `参数 ${index}`}
                      </FieldLabel>
                      <div className="flex items-center gap-2">
                        <Input
                          id={`mcp-command-${index}`}
                          {...fieldProps("config.command")}
                          required
                          value={value}
                          onChange={(e) =>
                            setCommand(
                              command.map((item, i) =>
                                i === index ? e.target.value : item
                              )
                            )
                          }
                          placeholder={index === 0 ? "npx" : undefined}
                        />
                        {index > 0 && (
                          <IconButton
                            type="button"
                            label={`删除参数 ${index}`}
                            onClick={() =>
                              setCommand(command.filter((_, i) => i !== index))
                            }
                          >
                            <Trash2 />
                          </IconButton>
                        )}
                      </div>
                    </Field>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={command.length >= 100}
                    onClick={() => setCommand([...command, ""])}
                  >
                    <Plus />
                    添加参数
                  </Button>
                  {fieldError("config.command")}
                </FieldGroup>
              ) : (
                <Field>
                  <FieldLabel htmlFor="mcp-url">MCP URL</FieldLabel>
                  <Input
                    id="mcp-url"
                    {...fieldProps("config.url")}
                    required
                    type="url"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                  />
                  {fieldError("config.url")}
                </Field>
              )}
              <FieldGroup>
                <div className="settings-section-heading">
                  <h2>{mcpType === "local" ? "环境变量" : "请求头"}</h2>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setSecrets([...secrets, { name: "", value: "" }])
                    }
                  >
                    <Plus />
                    {mcpType === "local" ? "添加环境变量" : "添加请求头"}
                  </Button>
                </div>
                {secrets.map((item, index) => (
                  <div className="resource-key-value" key={index}>
                    <Field>
                      <FieldLabel htmlFor={`secret-name-${index}`}>
                        键名 {index + 1}
                      </FieldLabel>
                      <Input
                        id={`secret-name-${index}`}
                        required
                        value={item.name}
                        onChange={(e) =>
                          setSecrets(
                            secrets.map((row, i) =>
                              i === index
                                ? { ...row, name: e.target.value }
                                : row
                            )
                          )
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`secret-value-${index}`}>
                        值 {index + 1}
                      </FieldLabel>
                      <Input
                        id={`secret-value-${index}`}
                        type="password"
                        autoComplete="new-password"
                        value={item.value}
                        onChange={(e) =>
                          setSecrets(
                            secrets.map((row, i) =>
                              i === index
                                ? { ...row, value: e.target.value }
                                : row
                            )
                          )
                        }
                      />
                    </Field>
                    <IconButton
                      type="button"
                      label={`删除键值 ${index + 1}`}
                      onClick={() =>
                        setSecrets(secrets.filter((_, i) => i !== index))
                      }
                    >
                      <Trash2 />
                    </IconButton>
                  </div>
                ))}
                {fieldError(
                  mcpType === "local" ? "config.environment" : "config.headers"
                )}
              </FieldGroup>
            </>
          )}
        </FieldGroup>
      </FieldSet>
      <div className="settings-actions">
        <Button type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle
              data-icon="inline-start"
              className="motion-safe:animate-spin"
            />
          ) : (
            <Save data-icon="inline-start" />
          )}
          保存配置
        </Button>
      </div>
    </form>
  )
}
