# 完整会话调用示例

网页：`GET /api/docs`；完整 Markdown：`GET /api/docs.md`；OpenAPI 3.1：`GET /api/openapi.json`。
以下命令使用 Bash、curl 和 jq；Base URL 替换为当前网关地址。接口无需 Authorization。

## 1. 查询可用引擎与模型

```sh
BASE=http://127.0.0.1:6217
curl -sS "$BASE/api/runtime" | jq '{engine, engines, limits}'
curl -sS "$BASE/api/agents" | jq '.agents[] | {id, enabled, health, models}'
ENGINE=pi # 从已启用且 health.status=ready 的 Agent 中选择
curl -sS "$BASE/api/engines/$ENGINE/models" | jq '.models'
```

`/api/runtime.engine` 是默认引擎，`engines[]` 是引擎清单；只有目标 Agent 启用且就绪后才能创建会话。`/api/runtimes` 查询 CLI 安装状态，已安装不等于可执行。模型接口返回 `{models:[{providerID,modelID,name}]}`；记录所选模型的两个 ID。显式模型必须属于所选 Agent。

## 2. 创建会话

```sh
WORKDIR=/absolute/workspace # 网关主机上已存在且允许访问的绝对路径
SESSION=$(curl -fsS -X POST "$BASE/session" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg dir "$WORKDIR" --arg engine "$ENGINE" \
    '{directory:$dir,engineId:$engine,interactionPolicy:{permission:"manual",question:"manual"}}')")
SID=$(printf '%s' "$SESSION" | jq -er '.id')
printf '%s\n' "$SESSION"
```

200 返回 `id/title/engineId/directory/interactionPolicy/created_at/status`。`directory` 必填；`engineId/title/interactionPolicy` 可选。省略引擎使用默认值，省略交互策略继承 Agent 已应用配置（初值为 auto）；本例显式使用人工审批。引擎、目录、交互策略创建后固定。

## 3. 订阅事件

另开终端，替换会话 ID；保留此连接：

```sh
curl -N 'http://127.0.0.1:6217/event?sessionId=<SID>'
```

每帧 `data:` 是 JSON，业务帧还含 `id:`。关注 `permission.asked`、`question.asked`、`message.part.updated`、`run.finished`、`session.error`。断线时用 `Last-Event-ID` 请求头续传；收到 `server.resync_required` 后重新查询会话、执行、消息与待处理交互。

## 4. 提交首轮消息

```sh
PROVIDER='<上一步的 providerID>'
MODEL='<上一步的 modelID>'
ACCEPTED=$(curl -fsS -X POST "$BASE/api/tasks/$SID/runs" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg provider "$PROVIDER" --arg model "$MODEL" \
    '{submissionId:"turn-001",model:{providerID:$provider,modelID:$model},parts:[{type:"text",text:"检查项目并运行测试；需要权限或信息时先询问我。"}]}')")
RID=$(printf '%s' "$ACCEPTED" | jq -er '.runId')
printf '%s\n' "$ACCEPTED"
```

202 返回 `submissionId/taskId/sessionId/runId/acceptedAt`，其中 `taskId=sessionId`。`submissionId` 和 `parts` 必填；`model` 可省略以继承会话或 Agent 默认模型。文本片段 1–16 个，总 UTF-8 文本不超过 128 KiB，不能全空白。

同操作、同会话下，使用相同 `submissionId` 和完全相同请求重试会返回原结果；不同输入返回 409。响应丢失时调用 `GET /api/submissions/turn-001?operation=append&sessionId=<SID>` 核对结果。

## 5. 处理权限审批与问题

在原终端查询当前会话、本轮执行的待处理项：

```sh
curl -sS "$BASE/permission" | jq --arg sid "$SID" --arg rid "$RID" \
  '.[] | select(.sessionID==$sid and .runId==$rid and .state=="pending")'
curl -sS "$BASE/question" | jq --arg sid "$SID" --arg rid "$RID" \
  '.[] | select(.sessionID==$sid and .runId==$rid and .state=="pending")'
```

仅在实际收到交互后回复；路径使用 **Interaction.id**，不是会话 ID。

```sh
# 替换为实际审批 ID；审阅 permission、patterns 后选择 once / always / reject
curl -fsS -X POST "$BASE/permission/<permission-id>/reply" \
  -H 'Content-Type: application/json' -d '{"reply":"once"}'
# 按实际 questions 顺序、选项 label 和多选约束填写，每题对应一个数组
curl -fsS -X POST "$BASE/question/<question-id>/reply" \
  -H 'Content-Type: application/json' -d '{"answers":[["实际选项 label"]]}'
```

成功为 200 `{"ok":true}`。审批和问题可能出现多次；持续处理到本轮终态。`always` 的范围服从原生引擎；`reject` 拒绝本次权限，不等同于中止整个会话。问题数量/选项不符返回 400，重复/过期回复返回 409，交互不存在返回 404。

## 6. 查询完成状态与输出

```sh
curl -fsS "$BASE/api/runs/$RID" | jq '.detail | {run, messages}'
curl -fsS "$BASE/session/$SID/message" | jq '.'
curl -fsS "$BASE/api/tasks/$SID" | jq '.detail.artifacts'
```

轮询 `detail.run.state`，同时继续处理人工交互。`queued/running/stopping` 尚未结束；`completed/failed/timed_out/cancelled` 是终态，仅 `completed` 成功。失败原因见 `run.error`，输出文本在 `messages[].parts[]` 的 `content`，工具输入输出在 tool part。`usage=null` 表示用量未知，不能当作零。产物 ID 来自 `detail.artifacts`，下载用 `GET /api/artifacts/{id}/content`。

`session.status=idle` / `session.idle` 只表示空闲。若依据消息确认完成，最后助手消息须 `info.finish=stop` 且包含 `step-finish`；`tool-calls` 不表示本轮完成。

## 7. 继续对话、中止或删除会话

```sh
# 下一轮复用 SID，换新幂等键；本例继承上一轮模型
curl -fsS -X POST "$BASE/api/tasks/$SID/runs" -H 'Content-Type: application/json' \
  -d '{"submissionId":"turn-002","parts":[{"type":"text","text":"总结刚才的结果。"}]}'
# 需要取消时：中止活动和排队中的执行，保留会话与消息
curl -fsS -X POST "$BASE/session/$SID/abort"
# 完成结果采集后：删除会话及关联记录（会先停止执行）
curl -fsS -X DELETE "$BASE/session/$SID"
```

一次正常执行结束无需显式 close/end；保留会话即可继续对话。`abort` 与 `stop` 是别名，返回 200 `{"ok":true}`；删除也返回该响应，随后查询会话返回 404。SSE 由客户端关闭连接。

## 另一种提交方式：prompt_async

`POST /session/{id}/prompt_async` 接受 `{parts,model?,agent?}`。虽然名称包含 async，HTTP 连接会等待本轮执行结束：204 成功且无响应体；502 执行失败；504 超时；409 取消。客户端 HTTP 超时应大于运行上限（默认 600 秒）。人工模式必须用另一连接处理审批和问题。该接口没有幂等键；以上立即返回 runId 的接口更适合人工交互流程。

自动模式验证脚本：`GET /api/examples/evaluate.mjs`。Node.js >=22.21，无额外依赖；运行 `node evaluate.mjs --url http://127.0.0.1:6217 --directory /absolute/workspace --prompt '只回复 OK'`。
