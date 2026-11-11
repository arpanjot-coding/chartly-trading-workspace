import {
  ArrowLeft,
  Bell,
  Bug,
  Check,
  CheckCircle2,
  Copy,
  FileWarning,
  FolderCheck,
  Lock,
  Mail,
  Moon,
  Palette,
  RefreshCw,
  RotateCcw,
  Send,
  Shield,
  Sun,
  User,
  Volume2,
  VolumeX,
  Wrench,
  X,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { webClient } from '@/api/client'
import TwoFactorEnforcement from '@/components/auth/TwoFactorEnforcement'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { developerApiOwnerKey, developerApiPrincipalHeaders } from '@/lib/developerApi/context'
import { type AlertCategories, type ToastPosition, useAlertStore } from '@/stores/alertStore'
import { useAuthStore } from '@/stores/authStore'
import { type ThemeColor, type ThemeMode, useThemeStore } from '@/stores/themeStore'
import { showToast, toast } from '@/utils/toast'

// Professional themes suitable for trading terminals
const THEME_MODES: { value: ThemeMode; label: string; icon: typeof Sun; description: string }[] = [
  {
    value: 'light',
    label: 'Light',
    icon: Sun,
    description: 'Clean, bright interface for daytime trading',
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: Moon,
    description: 'Reduced eye strain for extended sessions',
  },
]

// Accent colors for customization
const ACCENT_COLORS: { value: ThemeColor; label: string; color: string }[] = [
  { value: 'zinc', label: 'Chartly', color: 'bg-primary' },
  { value: 'slate', label: 'Slate', color: 'bg-slate-500' },
  { value: 'gray', label: 'Gray', color: 'bg-gray-500' },
  { value: 'neutral', label: 'Neutral', color: 'bg-neutral-500' },
  { value: 'green', label: 'Green', color: 'bg-green-500' },
  { value: 'blue', label: 'Blue', color: 'bg-blue-500' },
  { value: 'violet', label: 'Violet', color: 'bg-violet-500' },
  { value: 'orange', label: 'Orange', color: 'bg-orange-500' },
]

interface ProfileData {
  username: string
  local_guest?: boolean
  smtp_settings: {
    smtp_server: string
    smtp_port: number
    smtp_username: string
    smtp_password: boolean
    smtp_use_tls: boolean
    smtp_from_email: string
    smtp_helo_hostname: string
  } | null
  qr_code: string | null
  totp_secret: string | null
}

interface PasswordRequirements {
  length: boolean
  uppercase: boolean
  lowercase: boolean
  number: boolean
  special: boolean
}

interface PermissionCheck {
  path: string
  full_path: string
  description: string
  exists: boolean
  expected_mode: string
  expected_rwx: string
  actual_mode: string | null
  actual_rwx: string | null
  is_correct: boolean
  is_sensitive: boolean
  is_directory?: boolean
  issue: string | null
  warning: string | null
}

interface PermissionsData {
  platform: string
  base_path: string
  is_windows: boolean
  all_correct: boolean
  checks: PermissionCheck[]
}

// Toast position options
const TOAST_POSITIONS: { value: ToastPosition; label: string }[] = [
  { value: 'top-left', label: 'Top Left' },
  { value: 'top-center', label: 'Top Center' },
  { value: 'top-right', label: 'Top Right' },
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'bottom-center', label: 'Bottom Center' },
  { value: 'bottom-right', label: 'Bottom Right' },
]

// Alert category descriptions - organized by groups
const ALERT_CATEGORIES_REALTIME: {
  key: keyof AlertCategories
  label: string
  description: string
}[] = [
  {
    key: 'orders',
    label: 'Order Notifications',
    description: 'Real-time BUY/SELL order placement, cancellation, and modification alerts',
  },
  {
    key: 'analyzer',
    label: 'Legacy sandbox API',
    description: 'Notifications from the legacy broker API sandbox',
  },
  {
    key: 'system',
    label: 'System Alerts',
    description: 'Password changes, master contract downloads, and system events',
  },
  {
    key: 'actionCenter',
    label: 'Action Center',
    description: 'Pending order notifications in semi-auto mode',
  },
]

const ALERT_CATEGORIES_TRADING: {
  key: keyof AlertCategories
  label: string
  description: string
}[] = [
  {
    key: 'positions',
    label: 'Positions',
    description: 'Position close/update operations and P&L notifications',
  },
  {
    key: 'chartink',
    label: 'Chartink',
    description: 'Chartink strategy operations and scanner integrations',
  },
]

const ALERT_CATEGORIES_DATA: {
  key: keyof AlertCategories
  label: string
  description: string
}[] = [
  {
    key: 'historify',
    label: 'Historify',
    description: 'Historical data jobs, file uploads, downloads, and schedules',
  },
  {
    key: 'pythonStrategy',
    label: 'Python Strategy',
    description: 'Python strategy uploads, execution, logs, and scheduling',
  },
  {
    key: 'flow',
    label: 'Flow Workflows',
    description: 'Visual workflow creation, execution, and management',
  },
]

const ALERT_CATEGORIES_ADMIN: {
  key: keyof AlertCategories
  label: string
  description: string
}[] = [
  {
    key: 'admin',
    label: 'Admin Panel',
    description: 'Market timings, holidays, freeze quantities, and admin settings',
  },
  {
    key: 'monitoring',
    label: 'Monitoring',
    description: 'Health monitor, latency dashboard, and security alerts',
  },
  {
    key: 'clipboard',
    label: 'Clipboard',
    description: 'Copy to clipboard confirmation messages',
  },
]

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user)
  const principal = useAuthStore((s) => s.localPrincipalId)
  const owner = developerApiOwnerKey(user?.username, principal)
  const generation = useRef(0)
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null)
  const { mode, color, setMode, setColor } = useThemeStore()
  const alertStore = useAlertStore()
  const [activeTab, setActiveTab] = useState('account')
  const [isLoading, setIsLoading] = useState(true)
  const [profileData, setProfileData] = useState<ProfileData | null>(null)
  const isPersonal = user?.isLocalGuest === true || profileData?.local_guest === true

  // Password form state
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordRequirements, setPasswordRequirements] = useState<PasswordRequirements>({
    length: false,
    uppercase: false,
    lowercase: false,
    number: false,
    special: false,
  })
  const [isChangingPassword, setIsChangingPassword] = useState(false)

  // SMTP form state
  const [smtpServer, setSmtpServer] = useState('smtp.gmail.com')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpUsername, setSmtpUsername] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [smtpFromEmail, setSmtpFromEmail] = useState('')
  const [smtpHeloHostname, setSmtpHeloHostname] = useState('smtp.gmail.com')
  const [smtpUseTls, setSmtpUseTls] = useState(true)
  const [isSavingSmtp, setIsSavingSmtp] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [isSendingTest, setIsSendingTest] = useState(false)
  const [isDebugging, setIsDebugging] = useState(false)
  const [debugResult, setDebugResult] = useState<{
    success: boolean
    message: string
    details?: string[]
  } | null>(null)

  // Permissions state
  const [permissionsData, setPermissionsData] = useState<PermissionsData | null>(null)
  const [isLoadingPermissions, setIsLoadingPermissions] = useState(false)
  const [isFixingPermissions, setIsFixingPermissions] = useState(false)

  const isCurrent = (epoch: number) => {
    const state = useAuthStore.getState()
    return (
      generation.current === epoch &&
      owner === developerApiOwnerKey(state.user?.username, state.localPrincipalId)
    )
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: owner is the lifecycle key; the loader is bound to that owner.
  useEffect(() => {
    const epoch = ++generation.current
    setLoadedOwner(null)
    setIsLoading(true)
    setProfileData(null)
    setActiveTab('account')
    setOldPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setSmtpServer('smtp.gmail.com')
    setSmtpPort('587')
    setSmtpUsername('')
    setSmtpPassword('')
    setSmtpFromEmail('')
    setSmtpHeloHostname('smtp.gmail.com')
    setSmtpUseTls(true)
    setTestEmail('')
    setDebugResult(null)
    setPermissionsData(null)
    void fetchProfileData(epoch)
    return () => {
      generation.current++
    }
  }, [owner])

  const fetchProfileData = async (epoch: number) => {
    try {
      const response = principal
        ? await webClient.get<{ status: string; data: ProfileData }>('/auth/profile-data', {
            headers: developerApiPrincipalHeaders(principal),
          })
        : await webClient.get<{ status: string; data: ProfileData }>('/auth/profile-data')
      if (!isCurrent(epoch)) return
      if (response.data.status === 'success') {
        setProfileData(response.data.data)

        // Populate SMTP form with existing settings
        const smtp = response.data.data.smtp_settings
        if (smtp) {
          setSmtpServer(smtp.smtp_server || 'smtp.gmail.com')
          setSmtpPort(String(smtp.smtp_port || 587))
          setSmtpUsername(smtp.smtp_username || '')
          setSmtpFromEmail(smtp.smtp_from_email || '')
          setSmtpHeloHostname(smtp.smtp_helo_hostname || 'smtp.gmail.com')
          setSmtpUseTls(smtp.smtp_use_tls !== false)
          setTestEmail(smtp.smtp_username || '')
        }
      }
    } catch (_error) {
      if (isCurrent(epoch)) showToast.error('Failed to load profile data', 'admin')
    } finally {
      if (isCurrent(epoch)) {
        setLoadedOwner(owner)
        setIsLoading(false)
      }
    }
  }

  const fetchPermissions = async () => {
    setIsLoadingPermissions(true)
    try {
      const response = await webClient.get<{ status: string; data: PermissionsData }>(
        '/api/system/permissions'
      )
      if (response.data.status === 'success') {
        setPermissionsData(response.data.data)
      }
    } catch (_error) {
      showToast.error('Failed to load permission status', 'admin')
    } finally {
      setIsLoadingPermissions(false)
    }
  }

  const handleFixPermissions = async () => {
    setIsFixingPermissions(true)
    try {
      const response = await webClient.post<{
        status: string
        data: {
          fixed: Array<{ path: string; action: string }>
          failed: Array<{ path: string; error: string }>
          message: string
        }
      }>('/api/system/permissions/fix')

      if (response.data.status === 'success') {
        const { fixed, failed, message } = response.data.data
        if (fixed.length > 0) {
          showToast.success(`Fixed ${fixed.length} permission issues`, 'admin')
        }
        if (failed.length > 0) {
          showToast.warning(`${failed.length} issues could not be fixed automatically`, 'admin')
        }
        if (fixed.length === 0 && failed.length === 0) {
          showToast.info(message, 'admin')
        }
        // Refresh permissions after fix
        await fetchPermissions()
      } else {
        showToast.error('Failed to fix permissions', 'admin')
      }
    } catch (_error) {
      showToast.error('Failed to fix permissions', 'admin')
    } finally {
      setIsFixingPermissions(false)
    }
  }

  // Password validation
  const checkPasswordRequirements = useCallback((password: string) => {
    const requirements: PasswordRequirements = {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[!@#$%^&*]/.test(password),
    }
    setPasswordRequirements(requirements)
    return Object.values(requirements).every(Boolean)
  }, [])

  useEffect(() => {
    checkPasswordRequirements(newPassword)
  }, [newPassword, checkPasswordRequirements])

  const getPasswordStrength = () => {
    const metCount = Object.values(passwordRequirements).filter(Boolean).length
    if (metCount === 0) return { percentage: 0, label: 'None', color: 'bg-gray-400' }
    if (metCount <= 2) return { percentage: 40, label: 'Weak', color: 'bg-red-500' }
    if (metCount <= 3) return { percentage: 60, label: 'Fair', color: 'bg-yellow-500' }
    if (metCount <= 4) return { percentage: 80, label: 'Good', color: 'bg-blue-500' }
    return { percentage: 100, label: 'Strong', color: 'bg-green-500' }
  }

  const passwordsMatch = newPassword === confirmPassword && confirmPassword !== ''
  const meetsAllRequirements = Object.values(passwordRequirements).every(Boolean)
  const canSubmitPassword = passwordsMatch && meetsAllRequirements && oldPassword !== ''

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmitPassword) return

    setIsChangingPassword(true)
    try {
      const formData = new FormData()
      formData.append('old_password', oldPassword)
      formData.append('new_password', newPassword)
      formData.append('confirm_password', confirmPassword)

      const response = await webClient.post<{ status: string; message: string }>(
        '/auth/change-password',
        formData
      )

      if (response.data.status === 'success') {
        showToast.success(response.data.message || 'Password changed successfully', 'system')
        setOldPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        showToast.error(response.data.message || 'Failed to change password', 'system')
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } }
      showToast.error(err.response?.data?.message || 'Failed to change password', 'system')
    } finally {
      setIsChangingPassword(false)
    }
  }

  const handleSaveSmtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSavingSmtp(true)
    try {
      const formData = new FormData()
      formData.append('smtp_server', smtpServer)
      formData.append('smtp_port', smtpPort)
      formData.append('smtp_username', smtpUsername)
      if (smtpPassword) {
        formData.append('smtp_password', smtpPassword)
      }
      formData.append('smtp_from_email', smtpFromEmail)
      formData.append('smtp_helo_hostname', smtpHeloHostname)
      if (smtpUseTls) {
        formData.append('smtp_use_tls', 'on')
      }

      const response = await webClient.post<{ status: string; message: string }>(
        '/auth/smtp-config',
        formData
      )

      if (response.data.status === 'success') {
        showToast.success(response.data.message || 'SMTP settings saved successfully', 'admin')
        setSmtpPassword('') // Clear password field after save
      } else {
        showToast.error(response.data.message || 'Failed to save SMTP settings', 'admin')
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } }
      showToast.error(err.response?.data?.message || 'Failed to save SMTP settings', 'admin')
    } finally {
      setIsSavingSmtp(false)
    }
  }

  const handleTestEmail = async () => {
    if (!testEmail) {
      showToast.error('Please enter an email address to test', 'admin')
      return
    }

    setIsSendingTest(true)
    setDebugResult(null)
    try {
      const formData = new FormData()
      formData.append('test_email', testEmail)

      const response = await webClient.post<{ success: boolean; message: string }>(
        '/auth/test-smtp',
        formData
      )

      if (response.data.success) {
        showToast.success(response.data.message || 'Test email sent successfully', 'admin')
      } else {
        showToast.error(response.data.message || 'Failed to send test email', 'admin')
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } }
      showToast.error(err.response?.data?.message || 'Failed to send test email', 'admin')
    } finally {
      setIsSendingTest(false)
    }
  }

  const handleDebugSmtp = async () => {
    setIsDebugging(true)
    setDebugResult(null)
    try {
      const response = await webClient.post<{
        success: boolean
        message: string
        details?: string[]
      }>('/auth/debug-smtp', {})
      setDebugResult(response.data)
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } }
      setDebugResult({
        success: false,
        message: err.response?.data?.message || 'Failed to debug SMTP',
        details: [],
      })
    } finally {
      setIsDebugging(false)
    }
  }

  const handleThemeModeChange = (newMode: ThemeMode) => {
    setMode(newMode)
    showToast.success(`Theme changed to ${newMode}`, 'system')
  }

  const handleAccentColorChange = (newColor: ThemeColor) => {
    setColor(newColor)
    showToast.success(`Accent color changed to ${newColor}`, 'system')
  }

  const handleResetTheme = () => {
    setMode('light')
    setColor('zinc')
    showToast.success('Theme reset to default', 'system')
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        showToast.success('Copied to clipboard', 'clipboard')
      })
      .catch(() => {
        showToast.error('Failed to copy', 'clipboard')
      })
  }

  const strength = getPasswordStrength()

  if (isLoading || loadedOwner !== owner) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="py-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Link
            to="/settings"
            aria-label="Back to Settings"
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <User className="h-6 w-6" />
            Account & preferences
          </h1>
        </div>
        <p className="text-muted-foreground">
          Manage your account settings and security preferences
        </p>
      </div>

      {/* Tabs */}
      <Tabs
        value={isPersonal && (activeTab === 'smtp' || activeTab === 'totp') ? 'account' : activeTab}
        onValueChange={(value) => {
          setActiveTab(value)
          // Fetch permissions when tab is selected
          if (value === 'permissions' && !permissionsData) {
            fetchPermissions()
          }
        }}
      >
        <TabsList className={`grid w-full ${isPersonal ? 'grid-cols-4' : 'grid-cols-6'}`}>
          <TabsTrigger value="account" aria-label="Account" className="gap-1">
            <Lock className="h-4 w-4" />
            <span className="hidden sm:inline">Account</span>
          </TabsTrigger>
          <TabsTrigger value="alerts" aria-label="Alerts" className="gap-1">
            <Bell className="h-4 w-4" />
            <span className="hidden sm:inline">Alerts</span>
          </TabsTrigger>
          <TabsTrigger value="permissions" aria-label="System" className="gap-1">
            <FolderCheck className="h-4 w-4" />
            <span className="hidden sm:inline">System</span>
          </TabsTrigger>
          <TabsTrigger value="theme" aria-label="Theme" className="gap-1">
            <Palette className="h-4 w-4" />
            <span className="hidden sm:inline">Theme</span>
          </TabsTrigger>
          {!isPersonal && (
            <TabsTrigger value="smtp" aria-label="SMTP" className="gap-1">
              <Mail className="h-4 w-4" />
              <span className="hidden sm:inline">SMTP</span>
            </TabsTrigger>
          )}
          {!isPersonal && (
            <TabsTrigger value="totp" aria-label="TOTP" className="gap-1">
              <Shield className="h-4 w-4" />
              <span className="hidden sm:inline">TOTP</span>
            </TabsTrigger>
          )}
        </TabsList>

        {/* Account Tab */}
        <TabsContent value="account" className="space-y-6">
          {/* Account Info */}
          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{isPersonal ? 'Workspace' : 'Username'}</Label>
                <Input
                  value={
                    isPersonal ? 'Local workspace' : user?.username || profileData?.username || ''
                  }
                  disabled
                />
              </div>
              <div className="space-y-2">
                <Label>Account Type</Label>
                <div className="pt-2">
                  <Badge>{isPersonal ? 'Personal PC' : 'App account'}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Password Change */}
          {isPersonal ? (
            <Card>
              <CardHeader>
                <CardTitle>Personal workspace access</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  This computer's personal workspace opens without an app password. There is no
                  password or authenticator setup to change here.
                </p>
                <p>
                  Named accounts and shared installations use their configured sign-in and security
                  settings.
                </p>
                <Link className="inline-block underline underline-offset-2" to="/settings/storage">
                  Backup & restore
                </Link>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Change Password</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Current Password</Label>
                    <Input
                      type="password"
                      placeholder="Enter your current password"
                      value={oldPassword}
                      onChange={(e) => setOldPassword(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>New Password</Label>
                    <Input
                      type="password"
                      placeholder="Enter your new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Confirm New Password</Label>
                    <Input
                      type="password"
                      placeholder="Confirm your new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                    {confirmPassword && (
                      <p
                        className={`text-sm ${passwordsMatch ? 'text-green-500' : 'text-red-500'}`}
                      >
                        {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                      </p>
                    )}
                  </div>

                  {/* Password Strength */}
                  <div className="bg-muted rounded-lg p-4 space-y-3">
                    <div className="flex justify-between text-sm">
                      <span>Strength</span>
                      <span className="font-medium">{strength.label}</span>
                    </div>
                    <Progress value={strength.percentage} className={strength.color} />

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {Object.entries(passwordRequirements).map(([key, met]) => (
                        <div
                          key={key}
                          className={`flex items-center gap-1 px-2 py-1 rounded-full border ${
                            met
                              ? 'bg-green-500/10 border-green-500 text-green-600'
                              : 'bg-muted border-border text-muted-foreground'
                          }`}
                        >
                          {met ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                          <span>
                            {key === 'length' && '8+ chars'}
                            {key === 'uppercase' && 'A-Z'}
                            {key === 'lowercase' && 'a-z'}
                            {key === 'number' && '0-9'}
                            {key === 'special' && 'Special (@#$%^&*)'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Button type="submit" disabled={!canSubmitPassword || isChangingPassword}>
                    {isChangingPassword ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Changing...
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4 mr-2" />
                        Change Password
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Alerts Tab */}
        <TabsContent value="alerts" className="space-y-6">
          <Alert>
            <Bell className="h-4 w-4" />
            <AlertTitle>Toast Notification Settings</AlertTitle>
            <AlertDescription>
              Configure how toast notifications appear. Useful for power users running multiple
              strategies who want to reduce notification spam.
            </AlertDescription>
          </Alert>

          {/* Master Controls */}
          <Card>
            <CardHeader>
              <CardTitle>Master Controls</CardTitle>
              <CardDescription>
                Enable or disable all toast notifications and sounds
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Toasts Enabled */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="toasts-enabled">Toast Notifications</Label>
                  <p className="text-sm text-muted-foreground">
                    Show popup notifications for events
                  </p>
                </div>
                <Switch
                  id="toasts-enabled"
                  checked={alertStore.toastsEnabled}
                  onCheckedChange={alertStore.setToastsEnabled}
                />
              </div>

              {/* Sound Enabled */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="sound-enabled" className="flex items-center gap-2">
                    {alertStore.soundEnabled ? (
                      <Volume2 className="h-4 w-4" />
                    ) : (
                      <VolumeX className="h-4 w-4" />
                    )}
                    Sound Alerts
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Play audio alert for important events
                  </p>
                </div>
                <Switch
                  id="sound-enabled"
                  checked={alertStore.soundEnabled}
                  onCheckedChange={alertStore.setSoundEnabled}
                />
              </div>
            </CardContent>
          </Card>

          {/* Display Settings */}
          <Card className={!alertStore.toastsEnabled ? 'opacity-60' : ''}>
            <CardHeader>
              <CardTitle>Display Settings</CardTitle>
              <CardDescription>Customize toast appearance and behavior</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Position */}
              <div className="space-y-2">
                <Label>Toast Position</Label>
                <Select
                  value={alertStore.position}
                  onValueChange={(value) => alertStore.setPosition(value as ToastPosition)}
                  disabled={!alertStore.toastsEnabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select position" />
                  </SelectTrigger>
                  <SelectContent>
                    {TOAST_POSITIONS.map((pos) => (
                      <SelectItem key={pos.value} value={pos.value}>
                        {pos.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Max Visible Toasts */}
              <div className="space-y-2">
                <Label>Maximum Visible Toasts</Label>
                <div className="flex items-center gap-4">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={alertStore.maxVisibleToasts}
                    onChange={(e) => alertStore.setMaxVisibleToasts(Number(e.target.value))}
                    disabled={!alertStore.toastsEnabled}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">
                    (1-10) Additional toasts will be queued
                  </span>
                </div>
              </div>

              {/* Duration */}
              <div className="space-y-2">
                <Label>Auto-dismiss Duration</Label>
                <div className="flex items-center gap-4">
                  <Input
                    type="number"
                    min={1}
                    max={15}
                    value={alertStore.duration / 1000}
                    onChange={(e) => alertStore.setDuration(Number(e.target.value) * 1000)}
                    disabled={!alertStore.toastsEnabled}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">seconds (1-15)</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Category Controls - Real-time (Socket.IO) */}
          <Card className={!alertStore.toastsEnabled ? 'opacity-60' : ''}>
            <CardHeader>
              <CardTitle>Real-time Notifications</CardTitle>
              <CardDescription>
                High-frequency alerts from Socket.IO events. Disable these to reduce notification
                spam during active trading.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {ALERT_CATEGORIES_REALTIME.map((category) => (
                <div
                  key={category.key}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div className="space-y-0.5">
                    <Label htmlFor={`category-${category.key}`}>{category.label}</Label>
                    <p className="text-sm text-muted-foreground">{category.description}</p>
                  </div>
                  <Switch
                    id={`category-${category.key}`}
                    checked={alertStore.categories[category.key]}
                    onCheckedChange={(checked) =>
                      alertStore.setCategoryEnabled(category.key, checked)
                    }
                    disabled={!alertStore.toastsEnabled}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Category Controls - Trading */}
          <Card className={!alertStore.toastsEnabled ? 'opacity-60' : ''}>
            <CardHeader>
              <CardTitle>Trading Operations</CardTitle>
              <CardDescription>
                Notifications from position management, strategies, and Chartink integrations
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {ALERT_CATEGORIES_TRADING.map((category) => (
                <div
                  key={category.key}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div className="space-y-0.5">
                    <Label htmlFor={`category-${category.key}`}>{category.label}</Label>
                    <p className="text-sm text-muted-foreground">{category.description}</p>
                  </div>
                  <Switch
                    id={`category-${category.key}`}
                    checked={alertStore.categories[category.key]}
                    onCheckedChange={(checked) =>
                      alertStore.setCategoryEnabled(category.key, checked)
                    }
                    disabled={!alertStore.toastsEnabled}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Category Controls - Data & Automation */}
          <Card className={!alertStore.toastsEnabled ? 'opacity-60' : ''}>
            <CardHeader>
              <CardTitle>Data & Automation</CardTitle>
              <CardDescription>
                Notifications from historical data, Python strategies, and workflow automation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {ALERT_CATEGORIES_DATA.map((category) => (
                <div
                  key={category.key}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div className="space-y-0.5">
                    <Label htmlFor={`category-${category.key}`}>{category.label}</Label>
                    <p className="text-sm text-muted-foreground">{category.description}</p>
                  </div>
                  <Switch
                    id={`category-${category.key}`}
                    checked={alertStore.categories[category.key]}
                    onCheckedChange={(checked) =>
                      alertStore.setCategoryEnabled(category.key, checked)
                    }
                    disabled={!alertStore.toastsEnabled}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Category Controls - Admin & System */}
          <Card className={!alertStore.toastsEnabled ? 'opacity-60' : ''}>
            <CardHeader>
              <CardTitle>Admin & Utilities</CardTitle>
              <CardDescription>
                Notifications from the admin panel, monitoring, and clipboard operations
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {ALERT_CATEGORIES_ADMIN.map((category) => (
                <div
                  key={category.key}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div className="space-y-0.5">
                    <Label htmlFor={`category-${category.key}`}>{category.label}</Label>
                    <p className="text-sm text-muted-foreground">{category.description}</p>
                  </div>
                  <Switch
                    id={`category-${category.key}`}
                    checked={alertStore.categories[category.key]}
                    onCheckedChange={(checked) =>
                      alertStore.setCategoryEnabled(category.key, checked)
                    }
                    disabled={!alertStore.toastsEnabled}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
              <CardDescription>Test and manage notifications</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    toast.success('This is a test success notification')
                  }}
                  disabled={!alertStore.toastsEnabled}
                >
                  Test Toast
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    toast.dismiss()
                    toast.success('All notifications cleared')
                  }}
                >
                  Clear All Toasts
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    alertStore.resetToDefaults()
                    toast.success('Settings reset to defaults')
                  }}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset to Defaults
                </Button>
              </div>

              {/* Current Settings Summary */}
              <div className="mt-4 p-4 bg-muted rounded-lg">
                <h4 className="font-medium mb-2">Current Configuration</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="text-muted-foreground">Toasts:</span>
                  <span>{alertStore.toastsEnabled ? 'Enabled' : 'Disabled'}</span>
                  <span className="text-muted-foreground">Sound:</span>
                  <span>{alertStore.soundEnabled ? 'Enabled' : 'Disabled'}</span>
                  <span className="text-muted-foreground">Position:</span>
                  <span className="capitalize">{alertStore.position.replace('-', ' ')}</span>
                  <span className="text-muted-foreground">Max Visible:</span>
                  <span>{alertStore.maxVisibleToasts} toasts</span>
                  <span className="text-muted-foreground">Duration:</span>
                  <span>{alertStore.duration / 1000} seconds</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Help Card */}
          <Card>
            <CardHeader>
              <CardTitle>Understanding Notification Categories</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-4">
              <div>
                <p className="font-medium text-foreground mb-2">
                  Real-time Notifications (High Priority)
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>
                    <strong>Orders:</strong> BUY/SELL alerts from Socket.IO - highest frequency
                    during trading
                  </li>
                  <li>
                    <strong>Legacy sandbox API:</strong> Sandbox API operations - can be frequent
                    during sandbox trading
                  </li>
                  <li>
                    <strong>System:</strong> Password changes, master contracts - infrequent but
                    important
                  </li>
                  <li>
                    <strong>Action Center:</strong> Semi-auto pending orders - high frequency in
                    managed accounts
                  </li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground mb-2">Trading Operations</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>
                    <strong>Positions:</strong> Position close/update notifications
                  </li>
                  <li>
                    <strong>Chartink:</strong> Chartink scanner and strategy integrations
                  </li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground mb-2">Data & Automation</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>
                    <strong>Historify:</strong> Historical data jobs, uploads, downloads (67 toasts
                    - highest volume)
                  </li>
                  <li>
                    <strong>Python Strategy:</strong> Strategy uploads, execution logs, scheduling
                  </li>
                  <li>
                    <strong>Flow:</strong> Visual workflow execution and management
                  </li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground mb-2">Admin & Utilities</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>
                    <strong>Admin:</strong> Market timings, holidays, freeze quantities
                  </li>
                  <li>
                    <strong>Monitoring:</strong> Health, latency, and security dashboards
                  </li>
                  <li>
                    <strong>Clipboard:</strong> Copy-to-clipboard confirmations
                  </li>
                </ul>
              </div>
              <div className="pt-3 border-t">
                <p className="font-medium text-foreground mb-2">Tips for Power Users</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>
                    Running 5+ strategies? Set max visible to <strong>2-3</strong> and duration to{' '}
                    <strong>2 seconds</strong>
                  </li>
                  <li>
                    Disable <strong>Legacy sandbox API</strong> notifications when not using that
                    API
                  </li>
                  <li>
                    Disable <strong>Orders</strong> if you prefer checking the order book manually
                  </li>
                  <li>
                    Disable <strong>Historify</strong> during large data imports to avoid
                    notification flood
                  </li>
                  <li>
                    Keep <strong>System</strong> enabled for critical security alerts
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Permissions Tab */}
        <TabsContent value="permissions" className="space-y-6">
          <Alert>
            <FolderCheck className="h-4 w-4" />
            <AlertTitle>File Permissions Monitor</AlertTitle>
            <AlertDescription>
              Check file and directory permissions for Chartly components. Incorrect permissions may
              cause the application to malfunction.
            </AlertDescription>
          </Alert>

          {/* System Info */}
          {permissionsData && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      System Status
                      {permissionsData.all_correct ? (
                        <Badge className="bg-green-500">All OK</Badge>
                      ) : (
                        <Badge variant="destructive">Issues Found</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      Platform: {permissionsData.platform}
                      {permissionsData.is_windows && ' (Windows uses access-based checks)'}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={fetchPermissions}
                      disabled={isLoadingPermissions}
                    >
                      {isLoadingPermissions ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Refresh
                        </>
                      )}
                    </Button>
                    {!permissionsData.all_correct && !permissionsData.is_windows && (
                      <Button
                        size="sm"
                        onClick={handleFixPermissions}
                        disabled={isFixingPermissions}
                      >
                        {isFixingPermissions ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Wrench className="h-4 w-4 mr-2" />
                            Fix Issues
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
            </Card>
          )}

          {/* Loading State */}
          {isLoadingPermissions && !permissionsData && (
            <Card>
              <CardContent className="py-12 flex items-center justify-center">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  <span>Checking permissions...</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Permissions List */}
          {permissionsData && (
            <Card>
              <CardHeader>
                <CardTitle>Permission Details</CardTitle>
                <CardDescription>
                  Click on items with issues to see recommended fixes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {permissionsData.checks.map((check) => (
                    <div
                      key={check.path}
                      className={`flex items-start gap-3 p-3 rounded-lg border ${
                        check.is_correct
                          ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800'
                          : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                      }`}
                    >
                      {/* Status Icon */}
                      <div className="mt-0.5">
                        {check.is_correct ? (
                          <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                        ) : check.exists ? (
                          <FileWarning className="h-5 w-5 text-red-600 dark:text-red-400" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                        )}
                      </div>

                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium font-mono text-sm">{check.path}</span>
                          {check.is_sensitive && (
                            <Badge variant="outline" className="text-xs">
                              <Lock className="h-3 w-3 mr-1" />
                              Sensitive
                            </Badge>
                          )}
                          {check.is_directory && (
                            <Badge variant="outline" className="text-xs">
                              Directory
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">{check.description}</p>

                        {/* Permission Details */}
                        <div className="flex items-center gap-4 mt-2 text-xs">
                          <span className="text-muted-foreground">
                            Expected:{' '}
                            <code className="bg-muted px-1 rounded">{check.expected_mode}</code>
                            <span className="ml-1 text-muted-foreground/70">
                              ({check.expected_rwx})
                            </span>
                          </span>
                          {check.exists && check.actual_mode && (
                            <span
                              className={
                                check.is_correct
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-red-600 dark:text-red-400'
                              }
                            >
                              Actual:{' '}
                              <code
                                className={`px-1 rounded ${check.is_correct ? 'bg-green-100 dark:bg-green-900' : 'bg-red-100 dark:bg-red-900'}`}
                              >
                                {check.actual_mode}
                              </code>
                              <span className="ml-1 opacity-70">({check.actual_rwx})</span>
                            </span>
                          )}
                        </div>

                        {/* Issue Message */}
                        {check.issue && (
                          <div className="mt-2 p-2 bg-red-100 dark:bg-red-900/30 rounded text-sm">
                            <p className="text-red-700 dark:text-red-300 font-medium">
                              {check.issue}
                            </p>
                            {!permissionsData.is_windows && !check.exists && (
                              <p className="text-red-600 dark:text-red-400 text-xs mt-1">
                                Fix: Create the directory or file
                              </p>
                            )}
                            {!permissionsData.is_windows &&
                              check.exists &&
                              check.actual_mode !== check.expected_mode && (
                                <p className="text-red-600 dark:text-red-400 text-xs mt-1">
                                  Fix:{' '}
                                  <code className="bg-red-200 dark:bg-red-800 px-1 rounded">
                                    chmod {check.expected_mode} {check.path}
                                  </code>
                                </p>
                              )}
                          </div>
                        )}

                        {/* Warning Message (doesn't affect is_correct status) */}
                        {check.warning && !check.issue && (
                          <div className="mt-2 p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded text-sm">
                            <p className="text-yellow-700 dark:text-yellow-300 font-medium">
                              {check.warning}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Help Card */}
          <Card>
            <CardHeader>
              <CardTitle>Understanding Permissions</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-3">
              <div>
                <p className="font-medium text-foreground">Permission Format (Unix/Linux/macOS)</p>
                <p>Permissions are shown as a 3-digit number (e.g., 755) where:</p>
                <ul className="list-disc list-inside mt-1 space-y-1 ml-2">
                  <li>
                    <code className="bg-muted px-1 rounded">7</code> = Read + Write + Execute (rwx)
                  </li>
                  <li>
                    <code className="bg-muted px-1 rounded">5</code> = Read + Execute (r-x)
                  </li>
                  <li>
                    <code className="bg-muted px-1 rounded">6</code> = Read + Write (rw-)
                  </li>
                  <li>
                    <code className="bg-muted px-1 rounded">4</code> = Read only (r--)
                  </li>
                  <li>
                    <code className="bg-muted px-1 rounded">0</code> = No permission (---)
                  </li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground">Sensitive Files</p>
                <p>
                  Files marked as sensitive (like{' '}
                  <code className="bg-muted px-1 rounded">.env</code> and{' '}
                  <code className="bg-muted px-1 rounded">keys/</code>) should have restricted
                  permissions (600 or 700) to prevent unauthorized access.
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground">Windows</p>
                <p>
                  On Windows, the system checks if files/directories are readable and writable
                  instead of Unix-style permissions.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Theme Tab */}
        <TabsContent value="theme" className="space-y-6">
          {/* Current Theme Status */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Current Theme</CardTitle>
                  <CardDescription>
                    {`${mode.charAt(0).toUpperCase() + mode.slice(1)} Mode with ${color.charAt(0).toUpperCase() + color.slice(1)} accent`}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex gap-2">
                    <div className="w-6 h-6 rounded bg-primary" title="Primary" />
                    <div className="w-6 h-6 rounded bg-secondary" title="Secondary" />
                    <div className="w-6 h-6 rounded bg-accent" title="Accent" />
                    <div className="w-6 h-6 rounded bg-muted" title="Muted" />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResetTheme}
                    disabled={mode === 'light' && color === 'zinc'}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Reset
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Theme Mode Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Theme Mode</CardTitle>
              <CardDescription>Choose between light and dark interface</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {THEME_MODES.map((themeOption) => {
                  const Icon = themeOption.icon
                  const isSelected = mode === themeOption.value
                  return (
                    <button
                      type="button"
                      key={themeOption.value}
                      onClick={() => handleThemeModeChange(themeOption.value)}
                      className={`flex items-start gap-4 p-4 rounded-lg border-2 transition-all text-left ${
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      } cursor-pointer`}
                    >
                      <div
                        className={`p-2 rounded-lg ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{themeOption.label}</span>
                          {isSelected && <Check className="h-4 w-4 text-primary" />}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {themeOption.description}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Accent Color Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Accent Color</CardTitle>
              <CardDescription>Customize the primary accent color</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
                {ACCENT_COLORS.map((accentColor) => {
                  const isSelected = color === accentColor.value
                  return (
                    <button
                      type="button"
                      key={accentColor.value}
                      onClick={() => handleAccentColorChange(accentColor.value)}
                      className={`flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      } cursor-pointer`}
                      title={accentColor.label}
                    >
                      <div
                        className={`w-8 h-8 rounded-full ${accentColor.color} ring-2 ring-offset-2 ring-offset-background ${isSelected ? 'ring-primary' : 'ring-transparent'}`}
                      />
                      <span className="text-xs font-medium">{accentColor.label}</span>
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Theme Info */}
          <Card>
            <CardHeader>
              <CardTitle>About Themes</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                <strong>Light Mode:</strong> Optimized for daytime use with high contrast and
                readability.
              </p>
              <p>
                <strong>Dark Mode:</strong> Reduces eye strain during extended trading sessions,
                especially in low-light environments.
              </p>
              <p>
                <strong>Appearance:</strong> These preferences change the interface only. Trading
                accounts, paper sessions and API routing keep their own settings.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SMTP Tab */}
        {!isPersonal && (
          <TabsContent value="smtp" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>SMTP Configuration</CardTitle>
                <CardDescription>
                  Configure email settings for password reset notifications
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Alert className="mb-6">
                  <Mail className="h-4 w-4" />
                  <AlertTitle>Gmail Configuration Tips</AlertTitle>
                  <AlertDescription>
                    <ul className="text-sm list-disc list-inside mt-1 space-y-1">
                      <li>
                        <strong>Personal Gmail:</strong> Server: smtp.gmail.com:587
                      </li>
                      <li>
                        <strong>Password:</strong> Use App Password (not your regular password)
                      </li>
                      <li>
                        <strong>Setup:</strong> Google Account - Security - 2-Step Verification -
                        App passwords
                      </li>
                    </ul>
                  </AlertDescription>
                </Alert>

                <form onSubmit={handleSaveSmtp} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>SMTP Server</Label>
                      <Input
                        value={smtpServer}
                        onChange={(e) => setSmtpServer(e.target.value)}
                        placeholder="smtp.gmail.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>SMTP Port</Label>
                      <Input
                        type="number"
                        value={smtpPort}
                        onChange={(e) => setSmtpPort(e.target.value)}
                        placeholder="587"
                      />
                      <p className="text-xs text-muted-foreground">
                        587 (STARTTLS) or 465 (SSL/TLS)
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Username/Email</Label>
                    <Input
                      type="email"
                      value={smtpUsername}
                      onChange={(e) => setSmtpUsername(e.target.value)}
                      placeholder="your-email@gmail.com"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Password/App Password</Label>
                    <Input
                      type="password"
                      value={smtpPassword}
                      onChange={(e) => setSmtpPassword(e.target.value)}
                      placeholder={
                        profileData?.smtp_settings?.smtp_password
                          ? 'Password is set (enter new to change)'
                          : 'Enter your App Password'
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>From Email</Label>
                    <Input
                      type="email"
                      value={smtpFromEmail}
                      onChange={(e) => setSmtpFromEmail(e.target.value)}
                      placeholder="your-email@gmail.com"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>HELO Hostname</Label>
                    <Input
                      value={smtpHeloHostname}
                      onChange={(e) => setSmtpHeloHostname(e.target.value)}
                      placeholder="smtp.gmail.com"
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="smtp_tls"
                      checked={smtpUseTls}
                      onCheckedChange={(checked) => setSmtpUseTls(checked === true)}
                    />
                    <Label htmlFor="smtp_tls">Use TLS/SSL</Label>
                  </div>

                  <Button type="submit" disabled={isSavingSmtp}>
                    {isSavingSmtp ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Mail className="h-4 w-4 mr-2" />
                        Save SMTP Settings
                      </>
                    )}
                  </Button>

                  {/* Test Configuration */}
                  <div className="border-t pt-4 mt-4">
                    <h4 className="font-medium mb-3">Test Configuration</h4>
                    <p className="text-sm text-muted-foreground mb-4">
                      Send a test email to verify your SMTP settings.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        type="email"
                        value={testEmail}
                        onChange={(e) => setTestEmail(e.target.value)}
                        placeholder="Enter email address to test"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleTestEmail}
                        disabled={isSendingTest}
                      >
                        {isSendingTest ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Send className="h-4 w-4 mr-1" />
                            Send Test
                          </>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={handleDebugSmtp}
                        disabled={isDebugging}
                      >
                        {isDebugging ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Bug className="h-4 w-4 mr-1" />
                            Debug
                          </>
                        )}
                      </Button>
                    </div>

                    {debugResult && (
                      <Alert
                        className={`mt-4 ${debugResult.success ? 'border-green-500' : 'border-yellow-500'}`}
                      >
                        <AlertTitle>
                          {debugResult.success ? 'SMTP Debug Complete' : 'SMTP Connection Issues'}
                        </AlertTitle>
                        <AlertDescription>
                          <p>{debugResult.message}</p>
                          {debugResult.details && debugResult.details.length > 0 && (
                            <ul className="text-xs mt-2 list-disc list-inside">
                              {debugResult.details.map((detail, i) => (
                                <li key={i}>{detail}</li>
                              ))}
                            </ul>
                          )}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* TOTP Tab */}
        {!isPersonal && (
          <TabsContent value="totp" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>TOTP Authentication</CardTitle>
                <CardDescription>Manage your Two-Factor Authentication settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <Alert>
                  <Shield className="h-4 w-4" />
                  <AlertTitle>About TOTP Authentication</AlertTitle>
                  <AlertDescription>
                    TOTP (Time-based One-Time Password) provides an additional layer of security.
                    You&apos;ll need an authenticator app like Google Authenticator or Authy to
                    generate codes for password recovery.
                  </AlertDescription>
                </Alert>

                <TwoFactorEnforcement key={owner} />

                {profileData?.qr_code && profileData?.totp_secret ? (
                  <div className="bg-muted rounded-lg p-6 space-y-6">
                    <h3 className="font-semibold text-center">Your TOTP QR Code</h3>

                    {/* QR Code */}
                    <div className="flex justify-center">
                      <div className="p-4 bg-white rounded-lg shadow">
                        <img
                          src={`data:image/png;base64,${profileData.qr_code}`}
                          alt="TOTP QR Code"
                          className="w-48 h-48"
                        />
                      </div>
                    </div>

                    {/* Manual Entry */}
                    <div className="bg-background rounded-lg p-4 space-y-2">
                      <h4 className="font-semibold">Manual Entry</h4>
                      <p className="text-sm text-muted-foreground">Secret key for manual entry:</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-muted p-2 rounded text-sm break-all">
                          {profileData.totp_secret}
                        </code>
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => copyToClipboard(profileData.totp_secret!)}
                          aria-label="Copy TOTP secret"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Instructions */}
                    <div className="space-y-2">
                      <p className="font-medium">Setup Instructions:</p>
                      <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                        <li>Install an authenticator app (Google Authenticator, Authy, etc.)</li>
                        <li>Scan the QR code above or enter the secret key manually</li>
                        <li>Save your backup codes in a safe place</li>
                        <li>
                          You&apos;ll need the TOTP code to reset your password if you forget it
                        </li>
                      </ol>
                    </div>
                  </div>
                ) : (
                  <Alert variant="destructive">
                    <AlertTitle>TOTP Not Available</AlertTitle>
                    <AlertDescription>
                      Unable to load TOTP setup. Please contact your administrator.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
