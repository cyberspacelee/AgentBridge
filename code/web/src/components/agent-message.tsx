import { Component, isValidElement, type ReactNode } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Message } from "../../../shared/contracts"
import { CopyText, date } from "@/components/workspace-ui"
import { ToolCall } from "@/components/tool-call"

function safeUrl(value: string) {
  try {
    const url = new URL(value)
    return ["https:", "http:"].includes(url.protocol) ? url.href : ""
  } catch {
    return ""
  }
}

class TextFallback extends Component<
  { text: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <div className="message-text">{this.props.text}</div>
    ) : (
      this.props.children
    )
  }
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const props = isValidElement<{ children?: ReactNode; className?: string }>(
    children
  )
    ? children.props
    : undefined
  const text = String(props?.children ?? "").replace(/\n$/, "")
  const language = props?.className?.replace(/^language-/, "") || "文本"
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{language}</span>
        <CopyText text={text} label="复制代码" />
      </div>
      <pre tabIndex={0}>{children}</pre>
    </div>
  )
}

export function AgentMessage({ message }: { message: Message }) {
  const assistant = message.role === "assistant"
  const text = message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n")
  return (
    <article
      className={`message${assistant ? "" : "message-user"}`}
      aria-label={assistant ? "Agent 消息" : "用户消息"}
    >
      <header>
        <span>{assistant ? "Agent" : "用户"}</span>
        <time dateTime={message.createdAt}>{date(message.createdAt)}</time>
        <CopyText text={text} />
      </header>
      {message.parts.map((part) => {
        if (part.type === "tool") return <ToolCall key={part.id} part={part} />
        if (part.type === "step-finish")
          return (
            <p key={part.id} className="step-finish">
              {part.reason === "stop"
                ? "本轮生成结束"
                : `生成结束：${part.reason}`}
            </p>
          )
        if (part.type !== "text")
          return (
            <p key={(part as { id: string }).id} className="message-notice">
              暂不支持此消息内容
            </p>
          )
        if (!assistant || !message.completedAt)
          return (
            <div key={part.id} className="message-text">
              {part.text}
            </div>
          )
        return (
          <TextFallback key={part.id} text={part.text}>
            <div className="markdown">
              <Markdown
                skipHtml
                remarkPlugins={[remarkGfm]}
                urlTransform={safeUrl}
                components={{
                  h1: ({ children }) => <h3>{children}</h3>,
                  h2: ({ children }) => <h3>{children}</h3>,
                  a: ({ href, children }) =>
                    href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ) : (
                      <span>{children}</span>
                    ),
                  img: ({ src, alt }) =>
                    src ? (
                      <a
                        href={typeof src === "string" ? src : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {alt || "查看图片"}
                      </a>
                    ) : (
                      <span>{alt || "图片地址不可用"}</span>
                    ),
                  pre: CodeBlock,
                  table: ({ children }) => (
                    <div
                      className="markdown-table"
                      tabIndex={0}
                      role="region"
                      aria-label="消息表格"
                    >
                      <table>{children}</table>
                    </div>
                  ),
                }}
              >
                {part.text}
              </Markdown>
            </div>
          </TextFallback>
        )
      })}
    </article>
  )
}
