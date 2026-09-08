import { desktop, desktopVersion, saveDesktopPreference } from "@/lib/desktop"
import { lazy, Suspense, useState, useEffect } from "react"
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom"
import {
  Activity,
  Bot,
  MessagesSquare,
  Network,
  Menu,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon,
  Plug,
  SunMoon,
} from "lucide-react"
import type { RuntimeInfo } from "../../shared/contracts"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Failure, IconButton, Notice, Status } from "@/components/workspace-ui"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  SheetHeader,
} from "@/components/ui/sheet"
import { toast } from "sonner"
import { Toaster } from "@/components/ui/sonner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useEvents, useQuery } from "@/lib/api"
import { GatewayContext } from "@/lib/gateway"
import { ConversationHistory, Conversations, Tasks } from "@/pages/tasks"
import { useTheme } from "@/components/theme-provider"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"
const navigationItems = [
  { to: "/tasks", label: "会话", icon: MessagesSquare },
  { to: "/agents", label: "Agent 管理", icon: Bot },
  { to: "/agents/resources", label: "共享资源", icon: Plug },
  { to: "/observability", label: "运行观测", icon: Activity },
  { to: "/settings", label: "系统信息", icon: SettingsIcon },
]
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
const Agents = lazy(() =>
  import("@/pages/agents").then((module) => ({ default: module.Agents }))
)

export default function App() {
  useEffect(() => {
    const failed = () => toast.error("桌面偏好保存失败，当前窗口的设置仍然保留")
    window.addEventListener("agentbridge:preference-error", failed)
    return () =>
      window.removeEventListener("agentbridge:preference-error", failed)
  }, [])
  return (
    <BrowserRouter>
      <WorkspaceApp />
    </BrowserRouter>
  )
}

function WorkspaceApp() {
  const { pathname } = useLocation()
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
  const [wide, setWide] = useState(
    () => window.matchMedia("(min-width: 1024px)").matches
  )
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)")
    const update = () => {
      setWide(media.matches)
      setMenuOpen(false)
    }
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  const isConversation = pathname === "/tasks" || pathname.startsWith("/tasks/")
  const inlineHistory = wide && !sidebarCollapsed
  const closeMenu = () => setMenuOpen(false)
  const navigation = <WorkspaceNavigation close={closeMenu} />
  const connection = (
    <span
      className="connection"
      role="status"
      aria-label={`网关事件连接：${events.state}`}
    >
      <span className="connection-label">网关</span>
      <Status state={events.state} />
    </span>
  )
  const auxiliary = <WorkspaceNavigation auxiliary close={closeMenu} />
  return (
    <TooltipProvider delay={800}>
      <GatewayContext
        value={{ runtime: runtime.data, revision: events.revision }}
      >
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <div
            className="app-shell"
            data-collapsed={sidebarCollapsed}
            data-desktop={Boolean(desktop)}
          >
            <aside id="desktop-navigation" className="app-sidebar">
              <NavLink to="/tasks" className="brand" aria-label="AgentBridge">
                <Network aria-hidden="true" />
                <span>AgentBridge</span>
              </NavLink>
              {navigation}
              {isConversation && inlineHistory && <ConversationHistory />}
              <div className="sidebar-footer">
                {auxiliary}
                <IconButton
                  label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
                  className="sidebar-toggle gap-3 text-muted-foreground"
                  size={sidebarCollapsed ? "icon" : "row"}
                  aria-expanded={!sidebarCollapsed}
                  aria-controls="desktop-navigation"
                  onClick={() => {
                    const collapsed = !sidebarCollapsed
                    setSidebarCollapsed(collapsed)
                    saveDesktopPreference(
                      "agentbridge:sidebar-collapsed",
                      String(collapsed)
                    )
                    try {
                      localStorage.setItem(
                        "agentbridge:sidebar-collapsed",
                        String(collapsed)
                      )
                    } catch {
                      /* Optional layout preference. */
                    }
                  }}
                >
                  {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                  {!sidebarCollapsed && <span>收起侧边栏</span>}
                </IconButton>
              </div>
            </aside>
            <header className="app-header">
              <SheetTrigger
                render={<IconButton label="打开导航" className="lg:hidden" />}
              >
                <Menu />
              </SheetTrigger>
              {isConversation && !inlineHistory && (
                <SheetTrigger render={<IconButton label="历史会话" />}>
                  <History />
                </SheetTrigger>
              )}
              <span className="header-brand">AgentBridge</span>
              <div className="header-context">
                <span>工作空间</span>
                <span aria-hidden="true">/</span>
                <span>
                  {[...navigationItems]
                    .reverse()
                    .find(
                      ({ to }) =>
                        pathname === to || pathname.startsWith(`${to}/`)
                    )?.label ?? "AgentBridge"}
                </span>
              </div>
              {!desktop && connection}
              <div className="header-runtime">
                <DropdownMenu>
                  <DropdownMenuTrigger render={<IconButton label="主题" />}>
                    <SunMoon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuRadioGroup
                      value={theme}
                      onValueChange={(value) => {
                        setTheme(value as "light" | "dark" | "system")
                      }}
                    >
                      <DropdownMenuRadioItem value="light" closeOnClick>
                        浅色
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="dark" closeOnClick>
                        深色
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="system" closeOnClick>
                        跟随系统
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
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
                key={pathname}
                fallback={
                  <div className="page">
                    <Skeleton className="h-72" />
                  </div>
                }
              >
                <Routes>
                  <Route path="/tasks" element={<Conversations />}>
                    <Route index element={<Tasks />} />
                    <Route path=":id" element={<Task />} />
                  </Route>
                  <Route path="/observability" element={<Observability />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/agents" element={<Agents />} />
                  <Route path="/agents/:id" element={<Agents />} />
                  <Route path="/" element={<Navigate to="/tasks" replace />} />
                  <Route
                    path="*"
                    element={
                      <div className="page">
                        <h1>页面不存在</h1>
                        <NavLink to="/tasks">返回会话</NavLink>
                      </div>
                    }
                  />
                </Routes>
              </Suspense>
            </main>
            {desktop && (
              <footer className="desktop-statusbar" aria-label="桌面状态栏">
                {connection}
                <span className="desktop-version">
                  AgentBridge {desktopVersion}
                </span>
              </footer>
            )}
          </div>
          <SheetContent
            side="left"
            className="navigation-dialog gap-3 bg-sidebar p-3 data-[side=left]:w-[min(320px,calc(100vw-24px))]"
            initialFocus={
              isConversation
                ? () =>
                    document.querySelector<HTMLInputElement>(
                      '.navigation-dialog input[aria-label="搜索会话"]'
                    )
                : undefined
            }
          >
            <SheetHeader className="px-3 pt-1 pr-10 pb-2">
              <SheetTitle>AgentBridge</SheetTitle>
            </SheetHeader>
            {navigation}
            {isConversation && <ConversationHistory close={closeMenu} />}
            <div className="sidebar-footer">{auxiliary}</div>
          </SheetContent>
        </Sheet>
        <Toaster />
      </GatewayContext>
    </TooltipProvider>
  )
}

function WorkspaceNavigation({
  close,
  auxiliary = false,
}: {
  close: () => void
  auxiliary?: boolean
}) {
  const { pathname } = useLocation()
  return (
    <nav
      aria-label={auxiliary ? "辅助导航" : "主导航"}
      className="workspace-nav"
    >
      {navigationItems
        .filter(({ to }) => (to === "/settings") === auxiliary)
        .map(({ to, label, icon: Icon }) => (
          <Tooltip key={to}>
            <TooltipTrigger
              render={
                <NavLink
                  to={to}
                  className={({ isActive }) =>
                    isActive &&
                    !(to === "/agents" && pathname === "/agents/resources")
                      ? "active"
                      : ""
                  }
                  aria-label={label}
                  onClick={close}
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
}
