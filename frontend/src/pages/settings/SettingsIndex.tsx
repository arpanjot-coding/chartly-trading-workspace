import { ArrowRight, Bot, Database, HardDrive, Key, LineChart, Settings, User } from 'lucide-react'
import { Link } from 'react-router'

const groups = [
  {
    title: 'Workspace data',
    items: [
      {
        title: 'Connections & Data',
        description: 'Brokerages, crypto exchanges, desktop platforms and saved market history.',
        href: '/settings/connections',
        icon: Database,
      },
      {
        title: 'Storage & recovery',
        description: 'Back up your workspace, migrate browser records and recover drafts.',
        href: '/settings/storage',
        icon: HardDrive,
      },
      {
        title: 'Custom Indicators',
        description: 'Write, validate and manage your chart indicators.',
        href: '/settings/custom-indicators',
        icon: LineChart,
      },
    ],
  },
  {
    title: 'Integrations',
    items: [
      {
        title: 'AI configuration',
        description: 'Connect AI providers, test models and manage the Agent’s permissions.',
        href: '/agent/config',
        icon: Bot,
      },
      {
        title: 'Developer API',
        description: 'Manage Chartly’s key for scripts, external alerts and integrations.',
        href: '/apikey',
        icon: Key,
      },
    ],
  },
  {
    title: 'Account & system',
    items: [
      {
        title: 'Account & preferences',
        description: 'Account security, appearance, notifications and email.',
        href: '/profile',
        icon: User,
      },
      {
        title: 'System & advanced',
        description: 'Market calendars, diagnostics, access controls and monitoring.',
        href: '/admin',
        icon: Settings,
      },
    ],
  },
]

export default function SettingsIndex() {
  return (
    <div className="mx-auto max-w-6xl space-y-7 py-4 sm:py-6">
      <header className="border-b pb-5">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Manage workspace data, integrations and account preferences.
        </p>
      </header>
      <div className="grid gap-7 lg:grid-cols-3 lg:gap-4 xl:gap-5">
        {groups.map((group) => (
          <section key={group.title} aria-label={group.title} className="min-w-0 space-y-2.5">
            <h2 className="px-0.5 text-sm font-semibold text-muted-foreground">{group.title}</h2>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  className="group flex min-h-25 items-start gap-3 rounded-xl border bg-card p-4 shadow-xs outline-none transition-colors hover:border-foreground/25 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                    <item.icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block text-sm font-semibold">{item.title}</span>
                    <span className="block text-[13px] leading-5 text-muted-foreground">
                      {item.description}
                    </span>
                  </span>
                  <ArrowRight
                    className="mt-1 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                    aria-hidden="true"
                  />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
