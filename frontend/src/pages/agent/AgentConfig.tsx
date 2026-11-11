import { ArrowLeft, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { AddModelDialog } from '@/components/agent/config/AddModelDialog'
import { ChatGptSubscriptionPanel } from '@/components/agent/config/ChatGptSubscriptionPanel'
import { McpPanel } from '@/components/agent/config/McpPanel'
import { ProviderCatalogPanel } from '@/components/agent/config/ProviderCatalogPanel'
import { RegisteredModelsTable } from '@/components/agent/config/RegisteredModelsTable'
import { TradingPanel } from '@/components/agent/config/TradingPanel'
import { VoicePanel } from '@/components/agent/config/VoicePanel'
import { WebSearchPanel } from '@/components/agent/config/WebSearchPanel'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Navbar } from '@/components/layout/Navbar'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function ModelsPanel() {
  return (
    <section aria-labelledby="agent-models-heading" className="space-y-3">
      <div className="space-y-1">
        <h2 id="agent-models-heading" className="text-base font-semibold">
          Models
        </h2>
        <p className="text-sm text-muted-foreground">
          Test registered models, choose a default and manage which models appear in chat.
        </p>
        <p className="text-sm text-muted-foreground">
          The Agent uses your{' '}
          <Link
            to="/apikey"
            className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline"
          >
            Chartly Developer API key
          </Link>{' '}
          for chart and account tools.
        </p>
      </div>
      <RegisteredModelsTable />
    </section>
  )
}

const sections = [
  { id: 'models', label: 'Models', Panel: ModelsPanel, surface: true },
  { id: 'subscription', label: 'ChatGPT subscription', Panel: ChatGptSubscriptionPanel },
  { id: 'trading-permissions', label: 'Trading', Panel: TradingPanel, surface: true },
  { id: 'voice', label: 'Voice', Panel: VoicePanel },
  { id: 'providers', label: 'Providers', Panel: ProviderCatalogPanel },
  { id: 'web-search', label: 'Web search', Panel: WebSearchPanel },
  { id: 'external-data', label: 'External data', Panel: McpPanel, surface: true },
]

export default function AgentConfig() {
  const [addOpen, setAddOpen] = useState(false)
  const scrollRegion = useRef<HTMLElement>(null)

  return (
    <>
      <Navbar fluid />
      <main ref={scrollRegion} className="min-h-0 flex-1 overflow-y-auto bg-muted/25">
        <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-5 sm:px-6 sm:pt-7">
          <header className="space-y-3 border-b pb-5">
            <Link
              to="/agent"
              className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to chat
            </Link>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <h1 className="text-3xl font-semibold tracking-tight">Agent configuration</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Manage model providers, Agent permissions, search and voice.
                </p>
              </div>
              <Button onClick={() => setAddOpen(true)}>
                <Plus aria-hidden="true" />
                Add model
              </Button>
            </div>
          </header>

          <div className="group/agent-sections mt-5 grid items-start gap-5 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-6">
            <nav
              aria-label="Agent configuration sections"
              className="flex flex-wrap gap-1 rounded-xl border bg-card p-1.5 shadow-xs lg:sticky lg:top-4 lg:flex-col"
            >
              {sections.map(({ id, label }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                    const region = scrollRegion.current
                    const panel = document.getElementById(id)
                    if (!region || !panel) return
                    event.preventDefault()
                    // Move within the settings scrollport so the app bar stays visible.
                    region.scrollTop +=
                      panel.getBoundingClientRect().top - region.getBoundingClientRect().top - 16
                    panel.focus({ preventScroll: true })
                  }}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:py-2',
                    id === 'external-data' &&
                      'hidden group-has-[#external-data:not(:empty)]/agent-sections:block'
                  )}
                >
                  {label}
                </a>
              ))}
            </nav>

            <div className="min-w-0 space-y-5">
              {sections.map(({ id, label, Panel, surface }) => (
                <div
                  key={id}
                  id={id}
                  tabIndex={-1}
                  className={cn(
                    'min-w-0 scroll-mt-4 empty:hidden',
                    surface && 'rounded-xl border bg-card p-4 shadow-xs sm:p-5'
                  )}
                >
                  <ErrorBoundary
                    fallback={
                      <Alert variant="destructive">
                        <AlertDescription>
                          {label} could not be shown. Reload the page to try again.
                        </AlertDescription>
                      </Alert>
                    }
                  >
                    <Panel />
                  </ErrorBoundary>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <AddModelDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  )
}
