import {
  Activity,
  ArrowRight,
  Bot,
  Gauge,
  Globe,
  Settings,
  Shield,
  Zap,
} from 'lucide-react'
import { Link } from 'react-router'
import { SettingsBackLink } from '@/components/layout/SettingsNavigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface AdminCard {
  title: string
  description: string
  icon: typeof Shield
  href: string
  count?: number
  countLabel: string
  color: string
}

export default function AdminIndex() {
  const isLoading = false

  const adminCards: AdminCard[] = [
    {
      title: 'Security Dashboard',
      description: 'Monitor IP bans, API abuse, and security threats',
      icon: Shield,
      href: '/logs/security',
      countLabel: 'monitoring',
      color: 'bg-red-500',
    },
    {
      title: 'Traffic Dashboard',
      description: 'Monitor HTTP traffic and API request logs',
      icon: Activity,
      href: '/logs/traffic',
      countLabel: 'monitoring',
      color: 'bg-cyan-500',
    },
    {
      title: 'Latency Dashboard',
      description: 'Monitor order execution and API latency',
      icon: Zap,
      href: '/logs/latency',
      countLabel: 'monitoring',
      color: 'bg-orange-500',
    },
    {
      title: 'Diagnostics',
      description: 'System info, errors, latency probes, and downloadable report for support',
      icon: Gauge,
      href: '/admin/diagnostics',
      countLabel: 'troubleshoot',
      color: 'bg-indigo-500',
    },
    {
      title: 'Agent Config',
      description: 'LLM providers and models, API keys, trading switch, and web search',
      icon: Bot,
      href: '/agent/config',
      countLabel: 'models and keys',
      color: 'bg-violet-500',
    },
    {
      title: 'Remote MCP',
      description: 'Approve OAuth clients, browse tool-call audit log, kill switch',
      icon: Globe,
      href: '/admin/remote-mcp',
      countLabel: 'AI clients',
      color: 'bg-teal-500',
    },
  ]

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="py-6 space-y-6">
      <SettingsBackLink />
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="h-6 w-6" />
          System & advanced
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage system settings, market data, and configurations
        </p>
      </div>

      {/* Admin Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {adminCards.map((card) => (
          <Link key={card.href} to={card.href}>
            <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer group">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div
                    className={`w-10 h-10 rounded-lg ${card.color} flex items-center justify-center`}
                  >
                    <card.icon className="h-5 w-5 text-white" />
                  </div>
                  {card.count !== undefined && (
                    <Badge variant="secondary">
                      {card.count} {card.countLabel}
                    </Badge>
                  )}
                </div>
                <CardTitle className="flex items-center gap-2 group-hover:text-primary transition-colors">
                  {card.title}
                  <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                </CardTitle>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground">
                  Click to manage {card.title.toLowerCase()}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Info Section */}
      <Card>
        <CardHeader>
          <CardTitle>About Admin Settings</CardTitle>
        </CardHeader>
        <CardContent className="prose prose-sm dark:prose-invert max-w-none">
          <p className="text-muted-foreground">
            The admin dashboard provides tools to manage critical system configurations:
          </p>
          <ul className="text-muted-foreground space-y-2 list-disc list-inside">
            <li>
              <strong>Security & traffic:</strong> Monitor IP bans, API abuse and HTTP request
              logs for this local installation.
            </li>
            <li>
              <strong>Latency & health:</strong> Inspect local engine latency and service health.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
