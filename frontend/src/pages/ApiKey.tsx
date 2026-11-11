import {
  AlertCircle,
  ArrowRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  Info,
  Key,
  RefreshCw,
  Zap,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { DeveloperApiContext } from '@/components/developer/DeveloperApiContext'
import { SettingsBackLink } from '@/components/layout/SettingsNavigation'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { developerApiOwnerKey, developerApiPrincipalHeaders } from '@/lib/developerApi/context'
import { useAuthStore } from '@/stores/authStore'
import { showToast } from '@/utils/toast'

async function fetchCSRFToken(principal: string | null): Promise<string> {
  const response = await fetch('/auth/csrf-token', {
    credentials: 'include',
    headers: developerApiPrincipalHeaders(principal),
  })
  const data = await response.json()
  return data.csrf_token
}

export default function ApiKey() {
  const { user, localPrincipalId, setApiKey: setStoredApiKey } = useAuthStore()
  const owner = developerApiOwnerKey(user?.username, localPrincipalId)
  const generation = useRef(0)
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false)

  // Order mode state
  const [orderMode, setOrderMode] = useState<'auto' | 'semi_auto' | null>(null)
  const [isTogglingMode, setIsTogglingMode] = useState(false)

  const isCurrent = (epoch: number) => {
    const state = useAuthStore.getState()
    return (
      generation.current === epoch &&
      owner === developerApiOwnerKey(state.user?.username, state.localPrincipalId)
    )
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the owner identity is the lifecycle key; the fetch closure is bound to that exact owner.
  useEffect(() => {
    const epoch = ++generation.current
    setLoadedOwner(null)
    setApiKey(null)
    setStoredApiKey(null)
    setHasApiKey(false)
    setShowApiKey(false)
    setShowRegenerateDialog(false)
    setIsRegenerating(false)
    setIsTogglingMode(false)
    setOrderMode(null)
    void fetchApiKeyData(epoch)
    return () => {
      generation.current++
    }
  }, [owner])

  const fetchApiKeyData = async (epoch: number) => {
    setIsLoading(true)
    try {
      const response = await fetch('/apikey', {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...developerApiPrincipalHeaders(localPrincipalId),
        },
      })

      if (response.ok) {
        const contentType = response.headers.get('content-type')
        if (contentType?.includes('application/json')) {
          const data = await response.json()
          if (!isCurrent(epoch)) return
          setApiKey(data.api_key || null)
          setStoredApiKey(data.api_key || null)
          setHasApiKey(!!data.api_key)
          setOrderMode(
            data.order_mode === 'auto' || data.order_mode === 'semi_auto' ? data.order_mode : null
          )
        } else {
          if (!isCurrent(epoch)) return
          // Backend returned HTML - this shouldn't happen now
          showToast.error('Failed to load API key - please refresh', 'system')
        }
      }
    } catch (_error) {
      if (isCurrent(epoch)) showToast.error('Failed to load API key', 'system')
    } finally {
      if (isCurrent(epoch)) {
        setLoadedOwner(owner)
        setIsLoading(false)
      }
    }
  }

  const handleCopyApiKey = async () => {
    if (apiKey && isCurrent(generation.current)) {
      try {
        await navigator.clipboard.writeText(apiKey)
        showToast.success('API key copied to clipboard', 'clipboard')
      } catch {
        showToast.error('Failed to copy API key', 'clipboard')
      }
    }
  }

  const handleRegenerateApiKey = async () => {
    const epoch = generation.current
    setIsRegenerating(true)
    setShowRegenerateDialog(false)

    try {
      const csrfToken = await fetchCSRFToken(localPrincipalId)
      if (!isCurrent(epoch)) return

      const response = await fetch('/apikey', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrfToken,
          ...developerApiPrincipalHeaders(localPrincipalId),
        },
        body: JSON.stringify({}),
      })

      const data = await response.json()
      if (!isCurrent(epoch)) return

      if (data.api_key) {
        setApiKey(data.api_key)
        setStoredApiKey(data.api_key)
        setHasApiKey(true)
        setShowApiKey(true)
        showToast.success('API key generated successfully', 'system')
      } else {
        showToast.error(data.error || 'Failed to generate API key', 'system')
      }
    } catch (_error) {
      if (isCurrent(epoch)) showToast.error('Failed to generate API key', 'system')
    } finally {
      if (isCurrent(epoch)) setIsRegenerating(false)
    }
  }

  const handleToggleOrderMode = async () => {
    if (orderMode === null) return
    const epoch = generation.current
    const newMode = orderMode === 'auto' ? 'semi_auto' : 'auto'
    setIsTogglingMode(true)

    try {
      const csrfToken = await fetchCSRFToken(localPrincipalId)
      if (!isCurrent(epoch)) return

      const response = await fetch('/apikey/mode', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrfToken,
          ...developerApiPrincipalHeaders(localPrincipalId),
        },
        body: JSON.stringify({
          mode: newMode,
        }),
      })

      const data = await response.json()
      if (!isCurrent(epoch)) return

      if (data.mode === 'auto' || data.mode === 'semi_auto') {
        setOrderMode(data.mode)
        showToast.success(
          `Order mode updated to ${data.mode === 'semi_auto' ? 'Semi-Auto' : 'Auto'}`,
          'system'
        )
      } else {
        showToast.error(data.error || 'Failed to update order mode', 'system')
      }
    } catch (_error) {
      if (isCurrent(epoch)) showToast.error('Failed to update order mode', 'system')
    } finally {
      if (isCurrent(epoch)) setIsTogglingMode(false)
    }
  }

  if (isLoading || loadedOwner !== owner) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6 py-6">
      <SettingsBackLink />
      <header className="space-y-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Developer API key</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            This is Chartly’s own access key. It is <strong className="text-foreground">not</strong>{' '}
            your broker password and not a broker API credential. Scripts, webhooks and the API
            Playground use it to call this instance's supported integration endpoints. Read-only
            account connections and saved-history imports use their own workspace access and
            provider setup.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="border bg-card p-4 text-sm">
            <strong>Use it for</strong>
            <p className="mt-1 text-muted-foreground">
              Supported scripts, webhooks, external alerts, and API Playground requests.
            </p>
          </div>
          <div className="border bg-card p-4 text-sm">
            <strong>Keep it secret</strong>
            <p className="mt-1 text-muted-foreground">
              Anyone with this key can act through the API. Regenerate it if it was shared or
              leaked.
            </p>
          </div>
          <div className="border bg-card p-4 text-sm">
            <strong>Broker API approvals</strong>
            <p className="mt-1 text-muted-foreground">
              Eligible Semi-Auto API orders are queued for review. Approval policy does not select a
              paper account or grant execution access.
            </p>
          </div>
        </div>
      </header>
      <DeveloperApiContext />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* API Key Management Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Developer API key
            </CardTitle>
            <CardDescription>
              Scripts and integrations use this key to access supported Chartly API endpoints. Keep
              it secret; regenerate it any time.
              {hasApiKey
                ? ' You can view it below or generate a new one if needed.'
                : ' No key was found yet, so generate one to unlock chart data and API tools.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* API Key Display */}
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Key className="h-4 w-4 shrink-0 text-muted-foreground" />
              <code className="flex-1 font-mono text-sm truncate">
                {hasApiKey
                  ? showApiKey
                    ? apiKey
                    : `${apiKey?.slice(0, 8)}${'•'.repeat(32)}${apiKey?.slice(-8)}`
                  : 'No API key generated'}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setShowApiKey(!showApiKey)}
                disabled={!hasApiKey}
                title={showApiKey ? 'Hide API key' : 'Show API key'}
                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleCopyApiKey} disabled={!hasApiKey} size="sm">
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRegenerateDialog(true)}
                disabled={isRegenerating}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isRegenerating ? 'animate-spin' : ''}`} />
                {hasApiKey ? 'Regenerate' : 'Generate'}
              </Button>
            </div>

            {/* Divider */}
            <div className="border-t pt-6">
              {/* Order Mode Toggle */}
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg">Broker API approval policy</h3>
                  <p className="text-sm text-muted-foreground">
                    Choose whether eligible broker API orders require review. Routing, provider
                    permissions and server validation still apply.
                  </p>
                </div>

                <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                  <Button
                    variant={orderMode === 'auto' ? 'default' : 'outline'}
                    className={`flex-1 ${orderMode === 'auto' ? 'bg-green-600 hover:bg-green-700' : ''}`}
                    onClick={() => orderMode !== 'auto' && handleToggleOrderMode()}
                    disabled={isTogglingMode || orderMode === null}
                  >
                    <Check className="h-4 w-4 mr-2" />
                    Automatic approval
                  </Button>

                  <Button
                    variant={orderMode === 'semi_auto' ? 'default' : 'outline'}
                    className={`flex-1 ${orderMode === 'semi_auto' ? 'bg-yellow-600 hover:bg-yellow-700' : ''}`}
                    onClick={() => orderMode !== 'semi_auto' && handleToggleOrderMode()}
                    disabled={isTogglingMode || orderMode === null}
                  >
                    <AlertCircle className="h-4 w-4 mr-2" />
                    Review before execution
                  </Button>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground px-4">
                  <span>No manual approval step</span>
                  <span>Queue eligible orders for approval</span>
                </div>

                {/* Current Mode Status */}
                <Alert
                  variant={orderMode === 'semi_auto' ? 'default' : 'default'}
                  className={
                    orderMode === 'semi_auto'
                      ? 'border-yellow-500 bg-yellow-500/10'
                      : orderMode === 'auto'
                        ? 'border-green-500 bg-green-500/10'
                        : ''
                  }
                >
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Current approval policy:{' '}
                    <strong>
                      {orderMode === 'semi_auto'
                        ? 'Review before execution'
                        : orderMode === 'auto'
                          ? 'Automatic approval'
                          : 'Unknown'}
                    </strong>
                    {orderMode === 'semi_auto' ? (
                      <span>
                        {' '}
                        — Eligible API orders are queued in{' '}
                        <Link
                          to="/action-center"
                          className="font-bold underline hover:text-primary"
                        >
                          Automation approvals
                        </Link>{' '}
                        for approval
                      </span>
                    ) : orderMode === 'auto' ? (
                      <span>
                        {' '}
                        — Eligible API orders proceed without manual approval; this does not
                        guarantee broker execution.
                      </span>
                    ) : (
                      <span>
                        {' '}
                        — Reload this page to observe the stored policy before changing it.
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* API Playground Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-500 to-amber-600 flex items-center justify-center">
                <Zap className="h-4 w-4 text-white" />
              </div>
              API Playground
            </CardTitle>
            <CardDescription>
              Send actual requests to Chartly's integration endpoints and inspect responses in your
              browser. Endpoint availability depends on its API and provider support.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-3">Features</h3>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  Edit and send supported same-origin GET/POST requests
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  Syntax highlighted JSON responses
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  Copy response or cURL command
                </li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-3">How it Works</h3>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>Select an endpoint from the sidebar</li>
                <li>Modify the request body as needed</li>
                <li>Click Send to execute the request</li>
                <li>View the JSON response instantly</li>
              </ol>
            </div>

            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">
                <strong>Tip:</strong> Your API key is automatically injected into requests when you
                select catalog endpoints in the Playground. Sending a request calls the actual API;
                server routing and approval policy still apply.
              </p>
            </div>

            <Button asChild className="w-full sm:w-auto">
              <Link to="/playground">
                <ArrowRight className="h-4 w-4 mr-2" />
                Open Playground
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Regenerate Confirmation Dialog */}
      <AlertDialog open={showRegenerateDialog} onOpenChange={setShowRegenerateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasApiKey ? 'Regenerate API Key?' : 'Generate API Key?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasApiKey
                ? 'Are you sure you want to regenerate your API key? The current key will be invalidated and any applications using it will need to be updated.'
                : 'Generate a new API key for authenticating your API requests?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRegenerateApiKey}>
              {hasApiKey ? 'Regenerate' : 'Generate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
