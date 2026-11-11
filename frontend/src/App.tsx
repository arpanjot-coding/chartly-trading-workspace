import { lazy, type ReactNode, Suspense } from 'react'
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  StaticRouter,
  useSearchParams,
} from 'react-router'
import { Providers } from '@/app/providers'
import { AuthSync } from '@/components/auth/AuthSync'
import { FullWidthLayout, LocalChartLayout } from '@/components/layout/FullWidthLayout'
import { Layout, TraderLayout } from '@/components/layout/Layout'
import { VerifiedAccountLayout } from '@/components/layout/VerifiedAccountLayout'
import { PageLoader } from '@/components/ui/page-loader'
import { usePageTitle } from '@/hooks/usePageTitle'
import Home from '@/pages/Home'
import PublicGuide from '@/pages/PublicGuide'

// Lazy load all pages for code splitting
// Public pages
const PortfolioAnalyzer = lazy(() => import('@/pages/PortfolioAnalyzer'))
const Faq = lazy(() => import('@/pages/Faq'))
const Setup = lazy(() => import('@/pages/Setup'))
const Login = lazy(() => import('@/pages/Login'))
const ResetPassword = lazy(() => import('@/pages/ResetPassword'))
const Download = lazy(() => import('@/pages/Download'))
const ServerError = lazy(() => import('@/pages/ServerError'))
const RateLimited = lazy(() => import('@/pages/RateLimited'))
const NotFound = lazy(() => import('@/pages/NotFound'))

// Broker auth

// Main pages
const TraderWorkspace = lazy(() => import('@/pages/workspace/TraderWorkspace'))
const TraderProfileDetail = lazy(() => import('@/pages/workspace/TraderProfileDetail'))
const TraderJournal = lazy(() => import('@/pages/workspace/TraderJournal'))
const TraderConnections = lazy(() => import('@/pages/workspace/TraderConnections'))
const TraderReplay = lazy(() => import('@/pages/workspace/TraderReplay'))
const CombinedLiveAnalytics = lazy(() => import('@/pages/workspace/CombinedLiveAnalytics'))
const ApiKey = lazy(() => import('@/pages/ApiKey'))
const AgentIndex = lazy(() => import('@/pages/agent/AgentIndex'))
const AgentConfig = lazy(() => import('@/pages/agent/AgentConfig'))
const Profile = lazy(() => import('@/pages/Profile'))
const MasterContract = lazy(() => import('@/pages/MasterContract'))
const ActionCenter = lazy(() => import('@/pages/ActionCenter'))

// Platform pages
const TradingView = lazy(() => import('@/pages/TradingView'))
const PnLTracker = lazy(() => import('@/pages/PnLTracker'))

// Sandbox & Analyzer
const Sandbox = lazy(() => import('@/pages/Sandbox'))
const SandboxPnL = lazy(() => import('@/pages/SandboxPnL'))
const Analyzer = lazy(() => import('@/pages/Analyzer'))
const WebSocketTest = lazy(() => import('@/pages/WebSocketTest'))
const WebSocketOrder = lazy(() => import('@/pages/WebSocketOrder'))
const ChartTest = lazy(() => import('@/pages/ChartTest'))
const Playground = lazy(() => import('@/pages/Playground'))
const Trading = lazy(() => import('@/pages/Trading'))
const Historify = lazy(() => import('@/pages/Historify'))
const HistorifyProviderTools = lazy(() =>
  import('@/pages/Historify').then((module) => ({ default: module.ConnectedHistorify }))
)
const HistorifyCharts = lazy(() => import('@/pages/HistorifyCharts'))

// Retained charting
const Scalping = lazy(() => import('@/pages/Scalping'))

const SettingsIndex = lazy(() => import('@/pages/settings/SettingsIndex'))
const ConnectionsData = lazy(() => import('@/pages/settings/ConnectionsData'))
const StorageRecovery = lazy(() => import('@/pages/settings/StorageRecovery'))
const CustomIndicators = lazy(() => import('@/pages/settings/CustomIndicators'))
const RetiredFeature = lazy(() => import('@/pages/RetiredFeature'))

import { retiredFeaturePaths } from '@/config/retiredFeatures'

// Python Strategy pages
const PythonStrategyIndex = lazy(() => import('@/pages/python-strategy/PythonStrategyIndex'))
const NewPythonStrategy = lazy(() => import('@/pages/python-strategy/NewPythonStrategy'))
const EditPythonStrategy = lazy(() => import('@/pages/python-strategy/EditPythonStrategy'))
const PythonStrategyLogs = lazy(() => import('@/pages/python-strategy/PythonStrategyLogs'))
const SchedulePythonStrategy = lazy(() => import('@/pages/python-strategy/SchedulePythonStrategy'))
const PythonStrategyGuide = lazy(() => import('@/pages/python-strategy/PythonStrategyGuide'))

// Strategy module: multi-leg options strategies with risk management
const StrategyList = lazy(() => import('@/pages/strategy/List'))
const StrategyWizard = lazy(() => import('@/pages/strategy/Wizard'))
const StrategyDetail = lazy(() => import('@/pages/strategy/Detail'))
const StrategyEdit = lazy(() => import('@/pages/strategy/Edit'))

// Flow pages
const FlowIndex = lazy(() => import('@/pages/flow/FlowIndex'))
const FlowEditor = lazy(() => import('@/pages/flow/FlowEditor'))
const FlowKeyboardShortcuts = lazy(() => import('@/pages/flow/FlowKeyboardShortcuts'))

// (legacy leverage page removed with Indian broker stack)

// Admin pages
const AdminIndex = lazy(() => import('@/pages/admin/AdminIndex'))
const Diagnostics = lazy(() => import('@/pages/admin/Diagnostics'))
const RemoteMcp = lazy(() => import('@/pages/admin/RemoteMcp'))

// Logs & Monitoring pages
const LogsIndex = lazy(() => import('@/pages/LogsIndex'))
const LiveLogs = lazy(() => import('@/pages/Logs'))
const SecurityDashboard = lazy(() => import('@/pages/monitoring/SecurityDashboard'))
const TrafficDashboard = lazy(() => import('@/pages/monitoring/TrafficDashboard'))
const LatencyDashboard = lazy(() => import('@/pages/monitoring/LatencyDashboard'))
const HealthMonitor = lazy(() => import('@/pages/HealthMonitor'))

function LegacyJournalRedirect() {
  const [searchParams] = useSearchParams()
  const portfolioId = Number(searchParams.get('portfolio'))
  return (
    <Navigate
      to={portfolioId > 0 ? `/workspace/profiles/${portfolioId}/journal` : '/workspace'}
      replace
    />
  )
}

function PageTitleUpdater() {
  usePageTitle()
  return null
}

function SessionLayout() {
  return (
    <AuthSync>
      <Outlet />
    </AuthSync>
  )
}

function AppRouter({ location, children }: { location?: string; children: ReactNode }) {
  return location === undefined ? (
    <BrowserRouter>{children}</BrowserRouter>
  ) : (
    <StaticRouter location={location}>{children}</StaticRouter>
  )
}

function App({ location }: { location?: string }) {
  return (
    <Providers>
      <AppRouter location={location}>
        <PageTitleUpdater />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* The homepage works before an installation or account is configured. */}
            <Route path="/" element={<Home />} />
            <Route path="/guides/:slug" element={<PublicGuide />} />
            <Route element={<SessionLayout />}>
              <Route path="/faq" element={<Faq />} />
              <Route path="/setup" element={<Setup />} />
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/download" element={<Download />} />
              <Route path="/error" element={<ServerError />} />
              <Route path="/rate-limited" element={<RateLimited />} />

              {/* Local trader surfaces - no broker connection required */}
              <Route element={<TraderLayout />}>
                <Route path="/settings" element={<SettingsIndex />} />
                <Route path="/settings/connections" element={<ConnectionsData />} />
                <Route path="/settings/storage" element={<StorageRecovery />} />
                <Route path="/settings/custom-indicators" element={<CustomIndicators />} />
                <Route path="/workspace" element={<TraderWorkspace />} />
                <Route path="/workspace/combined" element={<CombinedLiveAnalytics />} />
                <Route path="/tools" element={<Navigate to="/workspace" replace />} />
                {retiredFeaturePaths.map((path) => (
                  <Route key={path} path={path} element={<RetiredFeature />} />
                ))}
                <Route path="/workspace/profiles/:profileId" element={<TraderProfileDetail />} />
                <Route path="/workspace/profiles/:profileId/journal" element={<TraderJournal />} />
                <Route
                  path="/workspace/profiles/:profileId/connections"
                  element={<TraderConnections />}
                />
                <Route path="/workspace/profiles/:profileId/replay" element={<TraderReplay />} />
                <Route
                  path="/workspace/profiles/:profileId/settings"
                  element={<TraderProfileDetail />}
                />
                <Route path="/journal" element={<LegacyJournalRedirect />} />
              </Route>

              {/* App account and developer tools work without a broker connection. */}
              <Route element={<VerifiedAccountLayout />}>
                <Route path="/apikey" element={<ApiKey />} />
                <Route path="/profile" element={<Profile />} />
              </Route>
              <Route element={<VerifiedAccountLayout fullWidth />}>
                <Route path="/playground" element={<Playground />} />
              </Route>

              {/* Protected routes - requires broker auth */}
              <Route element={<Layout />}>
                {/* Legacy global broker dashboard retired: broker/prop accounts
                    are managed inside each Trading Profile's Connections. Old
                    /dashboard links land on the profile-first Workspace. */}
                <Route path="/dashboard" element={<Navigate to="/workspace" replace />} />
                {/* Search routes - match Flask /search/* routes */}
                {/* Phase 4: Charts & Webhook Configuration */}
                <Route path="/tradingview" element={<TradingView />} />
                <Route path="/portfolio-analyzer" element={<PortfolioAnalyzer />} />
                <Route path="/pnl-tracker" element={<PnLTracker />} />
                {/* Phase 4: Sandbox & Analyzer */}
                <Route path="/sandbox" element={<Sandbox />} />
                <Route path="/sandbox/mypnl" element={<SandboxPnL />} />
                <Route path="/analyzer" element={<Analyzer />} />

                <Route path="/scalping" element={<Scalping />} />

                <Route path="/websocket/test" element={<WebSocketTest />} />
                <Route path="/websocket/order" element={<WebSocketOrder />} />
                <Route path="/chart/test" element={<ChartTest />} />
                <Route path="/websocket/test/20" element={<WebSocketTest depthLevel={20} />} />
                <Route path="/websocket/test/30" element={<WebSocketTest depthLevel={30} />} />
                <Route path="/websocket/test/50" element={<WebSocketTest depthLevel={50} />} />
                {/* Phase 6: Python Strategies */}
                <Route path="/python" element={<PythonStrategyIndex />} />
                <Route path="/python/new" element={<NewPythonStrategy />} />
                <Route path="/python/:strategyId/edit" element={<EditPythonStrategy />} />
                <Route path="/python/:strategyId/logs" element={<PythonStrategyLogs />} />
                <Route path="/python/:strategyId/schedule" element={<SchedulePythonStrategy />} />
                <Route path="/python/guide" element={<PythonStrategyGuide />} />
                {/* Strategy module. /strategy/new before /strategy/:id so the
                    literal wins over the parameter. */}
                <Route path="/strategy" element={<StrategyList />} />
                <Route path="/strategy/new" element={<StrategyWizard />} />
                <Route path="/strategy/:strategyId" element={<StrategyDetail />} />
                <Route path="/strategy/:strategyId/edit" element={<StrategyEdit />} />

                <Route />
                {/* Flow Editor */}
                <Route path="/flow" element={<FlowIndex />} />
                <Route path="/flow/shortcuts" element={<FlowKeyboardShortcuts />} />
                {/* Leverage Configuration (crypto brokers only) */}
                {/* Phase 7: Admin */}
                <Route path="/admin" element={<AdminIndex />} />
                <Route path="/admin/diagnostics" element={<Diagnostics />} />
                <Route path="/admin/remote-mcp" element={<RemoteMcp />} />
                {/* Phase 7: Logs & Monitoring */}
                <Route path="/logs" element={<LogsIndex />} />
                <Route path="/logs/live" element={<LiveLogs />} />
                <Route path="/logs/sandbox" element={<Analyzer />} />
                <Route path="/logs/security" element={<SecurityDashboard />} />
                <Route path="/logs/traffic" element={<TrafficDashboard />} />
                <Route path="/logs/latency" element={<LatencyDashboard />} />
                <Route path="/security" element={<Navigate to="/logs/security" replace />} />
                <Route path="/traffic" element={<Navigate to="/logs/traffic" replace />} />
                <Route path="/latency" element={<Navigate to="/logs/latency" replace />} />
                <Route path="/health" element={<HealthMonitor />} />
                {/* Phase 7: Settings & Action Center */}
                <Route path="/master-contract" element={<MasterContract />} />
                <Route path="/action-center" element={<ActionCenter />} />
              </Route>

              {/* Full-width protected routes */}
              <Route element={<LocalChartLayout />}>
                <Route path="/trading" element={<Trading />} />
                <Route path="/historify" element={<Historify />} />
                <Route path="/historify/charts" element={<HistorifyCharts />} />
                <Route path="/historify/charts/:symbol" element={<HistorifyCharts />} />
              </Route>
              <Route element={<FullWidthLayout />}>
                {/* The agent is an application surface, not a document: the
                    thread scrolls inside a fixed viewport with the composer
                    pinned under it, and a conversation sidebar sits beside it.
                    Layout's centred, page-scrolling container cannot hold that,
                    so it renders its own Navbar like /trading does. */}
                <Route path="/agent" element={<AgentIndex />} />
                {/* Config shares the agent's shell rather than Layout's: the
                    registry and the provider catalog are wide, and a returning
                    operator moves between the two surfaces without the chrome
                    changing under them. */}
                <Route path="/agent/config" element={<AgentConfig />} />
                <Route path="/historify/provider-tools" element={<HistorifyProviderTools />} />
                {/* Flow Editor (full-width for canvas) */}
                <Route path="/flow/editor/:id" element={<FlowEditor />} />
              </Route>

              {/* 404 Not Found */}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </AppRouter>
    </Providers>
  )
}

export default App
