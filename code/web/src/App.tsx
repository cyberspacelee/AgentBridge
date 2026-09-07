import { lazy, Suspense, useState } from "react"
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
} from "react-router-dom"
import {
  Activity,
  ListTodo,
  Network,
  RefreshCw,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon,
} from "lucide-react"
import type { RuntimeInfo } from "../../shared/contracts"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  Choice,
  Failure,
  IconButton,
  Notice,
  Status,
} from "@/components/workspace-ui"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  SheetHeader,
} from "@/components/ui/sheet"
import { Toaster } from "@/components/ui/sonner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useEvents, useQuery } from "@/lib/api"
import { GatewayContext } from "@/lib/gateway"
import { Tasks } from "@/pages/tasks"
import { useTheme } from "@/components/theme-provider"
import { Skeleton } from "@/components/ui/skeleton"
const Observability = lazy(() =>
  import("@/pages/observability").then((module) => ({
    default: module.Observability,
  }))
)
const Task = lazy(() =>
  import("@/pages/task").then((module) => ({ default: module.Task }))
)
const Settings = lazy(() =>
  import("@/pages/settings").then((module) => ({ default: module.Settings }))
)

export default function App() {
  const events = useEvents()
  const { theme, setTheme } = useTheme()
  const runtime = useQuery<RuntimeInfo>("/api/runtime", events.revision)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem("agentbridge:sidebar-collapsed")
      return saved === null ? window.innerWidth < 1280 : saved === "true"
    } catch {
      return false
    }
  })
  const navigation = (
    <nav aria-label="主导航" className="workspace-nav">
      {[
        { to: "/tasks", label: "任务工作台", icon: ListTodo },
        { to: "/observability", label: "网关观测", icon: Activity },
        { to: "/settings", label: "配置", icon: SettingsIcon },
      ].map(({ to, label, icon: Icon }) => (
        <Tooltip key={to}>
          <TooltipTrigger
            render={
              <NavLink
                to={to}
                aria-label={label}
                onClick={() => setMenuOpen(false)}
              />
            }
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      ))}
    </nav>
  )
  return (
    <BrowserRouter>
      <TooltipProvider delay={800}>
        <GatewayContext
          value={{ runtime: runtime.data, revision: events.revision }}
        >
          <div className="app-shell" data-collapsed={sidebarCollapsed}>
            <aside id="desktop-navigation" className="app-sidebar">
              <NavLink to="/tasks" className="brand" aria-label="AgentBridge">
                <Network aria-hidden="true" />
                <span>AgentBridge</span>
              </NavLink>
              {navigation}
              <div className="sidebar-meta">
                <Network aria-hidden="true" />
                <span>企业 Agent 网关</span>
              </div>
            </aside>
            <header className="app-header">
              <IconButton
                label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
                className="hidden lg:inline-flex"
                aria-expanded={!sidebarCollapsed}
                aria-controls="desktop-navigation"
                onClick={() => {
                  const collapsed = !sidebarCollapsed
                  setSidebarCollapsed(collapsed)
                  try {
                    localStorage.setItem(
                      "agentbridge:sidebar-collapsed",
                      String(collapsed)
                    )
                  } catch {
                    /* Navigation remains usable when storage is blocked. */
                  }
                }}
              >
                {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </IconButton>
              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger
                  render={<IconButton label="打开导航" className="lg:hidden" />}
                >
                  <Menu />
                </SheetTrigger>
                <SheetContent side="left" className="navigation-dialog">
                  <SheetHeader>
                    <SheetTitle>AgentBridge</SheetTitle>
                  </SheetHeader>
                  {navigation}
                </SheetContent>
              </Sheet>
              <span className="header-brand">AgentBridge</span>
              <span className="connection" role="status">
                <Status state={events.state} />
              </span>
              <div className="header-runtime">
                <Choice
                  label="主题"
                  value={theme}
                  onChange={(value) =>
                    setTheme(value as "light" | "dark" | "system")
                  }
                  options={[
                    { value: "light", label: "浅色" },
                    { value: "dark", label: "深色" },
                    { value: "system", label: "跟随系统" },
                  ]}
                />
                <IconButton label="刷新网关状态" onClick={runtime.reload}>
                  <RefreshCw />
                </IconButton>
              </div>
            </header>
            {(runtime.error || events.state === "reconnecting") && (
              <div className="runtime-error flex flex-col gap-2">
                {events.state === "reconnecting" && (
                  <Notice title="连接中断，正在重连">
                    当前显示已接收的数据，连接恢复后自动更新。
                  </Notice>
                )}
                <Failure error={runtime.error} />
              </div>
            )}
            <main id="main-content" tabIndex={-1}>
              <Suspense
                fallback={
                  <div className="page">
                    <Skeleton className="h-72" />
                  </div>
                }
              >
                <Routes>
                  <Route path="/tasks" element={<Tasks />} />
                  <Route path="/tasks/:id" element={<Task />} />
                  <Route path="/observability" element={<Observability />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/" element={<Navigate to="/tasks" replace />} />
                  <Route
                    path="*"
                    element={
                      <div className="page">
                        <h1>页面不存在</h1>
                        <NavLink to="/tasks">返回任务工作台</NavLink>
                      </div>
                    }
                  />
                </Routes>
              </Suspense>
            </main>
          </div>
          <Toaster />
        </GatewayContext>
      </TooltipProvider>
    </BrowserRouter>
  )
}
