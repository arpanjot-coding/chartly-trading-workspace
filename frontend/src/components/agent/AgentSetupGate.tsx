/**
 * The "configure the agent first" state, for any surface that hosts a chat.
 *
 * Every agent surface needs this and for the same reason: until a model is
 * registered and its key has passed a test, there is nothing to talk to, and a
 * composer that accepts a question and then fails is worse than one that
 * explains itself. `/agent` grew its own copy first; this is that behaviour
 * lifted so the chart panel and anything after it share one answer rather than
 * three that drift.
 *
 * **An unreachable status reads as "not configured", never as an error.** That
 * is the honest interpretation: a status call that cannot be answered is not
 * evidence of a working agent behind it. The failure mode that matters is
 * showing a working chat when there is none, not the reverse.
 *
 * `compact` exists because a rail panel is roughly a third the width of the
 * page. The same words at page scale wrap into a wall in a narrow column, so
 * the compact form drops to the two sentences that actually decide what the
 * operator does next.
 */

import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Bot, CheckCircle2, Circle } from 'lucide-react'
import { Link } from 'react-router'
import { agentQueryKeys, getStatus } from '@/api/agent'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface AgentStatusGate {
  /** True once a model is registered, enabled and has passed a test. */
  configured: boolean
  /** True once the user has a Chartly API key for the agent's tools. */
  hasChartlyApiKey: boolean
  /** True only when both setup steps are complete and chat can be used. */
  ready: boolean
  /** True while the answer is unknown. Render nothing rather than guessing. */
  loading: boolean
}

/**
 * Whether the agent is usable on this instance.
 *
 * Shared across surfaces through one query key, so opening the chart panel
 * after the chat costs no second request and both agree about the answer.
 */
export function useAgentConfigured(): AgentStatusGate {
  const { data, isLoading } = useQuery({
    queryKey: agentQueryKeys.status(),
    queryFn: async () => {
      try {
        return await getStatus()
      } catch {
        // See the module docstring: unanswerable is treated as unconfigured.
        return {
          configured: false,
          default_model_id: null,
          model_count: 0,
          trading_enabled: false,
          agent_available: false,
          has_chartly_api_key: false,
        }
      }
    },
    staleTime: 30_000,
  })
  const configured = Boolean(data?.configured)
  const hasChartlyApiKey = data ? data.has_chartly_api_key !== false : false
  return { configured, hasChartlyApiKey, ready: configured && hasChartlyApiKey, loading: isLoading }
}

export interface AgentSetupGateProps {
  /** Narrow form, for a rail panel rather than a page. */
  compact?: boolean
  className?: string
}

export function AgentSetupGate({ compact = false, className }: AgentSetupGateProps) {
  const { configured, hasChartlyApiKey } = useAgentConfigured()
  const steps = [
    {
      done: configured,
      title: '1. Connect an AI model',
      description: compact
        ? 'Add a provider/model and test its key.'
        : 'Choose a provider, add its key, and test it. Keys are stored encrypted in your own database; a local provider is supported.',
      href: '/agent/config',
      action: configured ? 'Model settings' : 'Configure the agent',
    },
    {
      done: hasChartlyApiKey,
      title: '2. Add your Chartly API key',
      description: compact
        ? 'Lets the agent’s tools reach your Chartly data.'
        : 'This key lets the agent’s tools read your charts and account data in Chartly. Without it, the first message would fail.',
      href: '/apikey',
      action: hasChartlyApiKey ? 'View API key' : 'Get API key',
    },
  ]

  return (
    <div
      className={cn(
        'flex h-full flex-col items-center justify-center gap-3 text-center',
        compact ? 'px-4 py-6' : 'mx-auto max-w-xl px-6 py-10 gap-4',
        className
      )}
    >
      <div className="rounded-xl border bg-muted/40 p-3">
        <Bot className={cn('text-muted-foreground', compact ? 'h-6 w-6' : 'h-8 w-8')} aria-hidden />
      </div>
      <h2 className={cn('font-semibold tracking-tight', compact ? 'text-base' : 'text-2xl')}>
        Set up your agent
      </h2>
      <p className={cn('leading-relaxed text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
        The Agent can read your charts after both steps are complete. Finish a step, come back
        here, and its tick will update.
      </p>
      <ol className={cn('w-full space-y-2 text-left', compact ? 'text-xs' : 'text-sm')}>
        {steps.map((step) => (
          <li key={step.title} className="flex items-start justify-between gap-3 border bg-card p-3">
            <span className="flex min-w-0 gap-2">
              {step.done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span>
                <span className="block font-medium">{step.title}</span>
                <span className="mt-0.5 block leading-relaxed text-muted-foreground">
                  {step.description}
                </span>
              </span>
            </span>
            <Button asChild size="sm" variant={step.done ? 'outline' : 'default'} className="shrink-0">
              <Link to={step.href}>
                {step.action}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          </li>
        ))}
      </ol>
    </div>
  )
}
