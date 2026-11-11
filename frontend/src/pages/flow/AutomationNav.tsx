import { Link } from 'react-router'
import { cn } from '@/lib/utils'

const pages = [
  { id: 'workflows', to: '/flow', label: 'Create automations' },
  { id: 'approvals', to: '/action-center', label: 'Approvals & executions' },
] as const

export function AutomationNav({ current }: { current: (typeof pages)[number]['id'] }) {
  return (
    <nav aria-label="Automations" className="flex flex-wrap items-center gap-1 border-b">
      {pages.map(({ id, to, label }) => (
        <Link
          key={id}
          to={to}
          aria-current={id === current ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-10 items-center border-b-2 px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-3',
            id === current
              ? 'border-teal-700 text-foreground dark:border-teal-400'
              : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}
