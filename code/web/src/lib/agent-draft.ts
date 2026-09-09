import { useEffect, useState } from "react"
import { agentSchema, type AgentConfiguration } from "../../../shared/settings"

export const agentNames: Record<string, string> = {
  pi: "Pi",
  opencode: "OpenCode",
  codex: "Codex CLI",
  grok: "Grok Build",
}

const editable = [
  "models",
  "defaultModel",
  "contextCompaction",
  "skillIds",
  "mcpIds",
  "interactionPolicy",
] as const
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b)
type Draft = { base: AgentConfiguration; value: AgentConfiguration }
const memory = new Map<string, Draft>()

export function useAgentDraft(agent: AgentConfiguration, instance: string) {
  const key = `agentbridge:agent-draft:${instance}:${agent.id}`
  const [stored, setStored] = useState<Draft>(() => {
    if (memory.has(key)) return memory.get(key)!
    try {
      const item = JSON.parse(sessionStorage.getItem(key) ?? "null")
      const base = agentSchema.parse(item?.base)
      const value = agentSchema.parse(item?.value)
      if (base.id === agent.id && value.id === agent.id) return { base, value }
    } catch {
      /* Invalid or unavailable storage starts with the server snapshot. */
    }
    return { base: agent, value: agent }
  })
  // Merge only edited fields; lifecycle state always comes from the server.
  const changed = editable.filter(
    (field) => !equal(stored.base[field], stored.value[field])
  )
  const draft = {
    ...agent,
    ...Object.fromEntries(changed.map((field) => [field, stored.value[field]])),
  }
  const dirty = !equal(draft, agent)
  if (!dirty && changed.length) setStored({ base: agent, value: agent })
  const conflict = changed.some(
    (field) =>
      !equal(agent[field], stored.base[field]) &&
      !equal(agent[field], stored.value[field])
  )
  const update = (next: Draft) => {
    setStored(next)
    if (equal(next.base, next.value)) memory.delete(key)
    else memory.set(key, next)
    try {
      if (equal(next.base, next.value)) sessionStorage.removeItem(key)
      else sessionStorage.setItem(key, JSON.stringify(next))
    } catch {
      /* beforeunload still protects the in-memory draft. */
    }
  }
  useEffect(() => {
    if (!dirty) {
      memory.delete(key)
      try {
        sessionStorage.removeItem(key)
      } catch {
        /* Optional storage. */
      }
      return
    }
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [dirty, key])
  return {
    draft,
    dirty,
    conflict,
    setDraft: (value: AgentConfiguration) =>
      update({
        base: {
          ...agent,
          ...Object.fromEntries(
            changed.map((field) => [field, stored.base[field]])
          ),
        },
        value,
      }),
    reset: () => update({ base: agent, value: agent }),
    accept: (value: AgentConfiguration) => update({ base: value, value }),
    rebase: () => update({ base: agent, value: draft }),
  }
}
