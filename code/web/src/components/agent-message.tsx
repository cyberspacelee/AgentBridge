import { Component, isValidElement, type ReactNode } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Message } from "../../../shared/contracts"
import { CopyText, date } from "@/components/workspace-ui"
import { Brain, ChevronDown } from "lucide-react"
import {
  Message as ChatMessage,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
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

export function AgentMessage({
  message,
  agentName = "Agent",
}: {
  message: Message
  agentName?: string
}) {
  const assistant = message.role === "assistant"
  const text = message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.content)
    .join("\n")
  return (
    <ChatMessage
      className="message"
      align={assistant ? "start" : "end"}
      role="article"
      aria-label={assistant ? "Agent 消息" : "用户消息"}
    >
      <MessageContent>
        <MessageHeader className="gap-3">
          <span>{assistant ? agentName : "你"}</span>
          <time dateTime={message.created_at}>{date(message.created_at)}</time>
          <CopyText text={text} />
        </MessageHeader>
        {message.parts.map((part) => {
          if (part.type === "reasoning")
            return (
              <Collapsible
                key={part.id}
                className="reasoning"
                aria-label="思考过程"
              >
                <CollapsibleTrigger
                  render={<Button variant="ghost" size="sm" />}
                >
                  <Brain data-icon="inline-start" />
                  思考过程
                  <ChevronDown data-icon="inline-end" />
                </CollapsibleTrigger>
                <CollapsibleContent keepMounted>
                  <div className="reasoning-content message-text">
                    {part.content || "等待思考内容"}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          if (part.type === "tool")
            return <ToolCall key={part.id} part={part} />
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
              <Bubble
                key={part.id}
                variant={assistant ? "ghost" : "secondary"}
                align={assistant ? "start" : "end"}
              >
                <BubbleContent>
                  <div className="message-text">{part.content}</div>
                </BubbleContent>
              </Bubble>
            )
          return (
            <TextFallback key={part.id} text={part.content}>
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
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
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
                  {part.content}
                </Markdown>
              </div>
            </TextFallback>
          )
        })}
      </MessageContent>
    </ChatMessage>
  )
}
