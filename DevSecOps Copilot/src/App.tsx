import { useEffect, useState, type FormEvent } from 'react'
import {
  Activity, AlertTriangle, ArrowDown, ArrowRight, ArrowUpRight, Bell,
  Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Cloud, Code2, KeyRound, Mail,
  GitBranch, GitPullRequest, LayoutDashboard, LockKeyhole, LogOut,
  Menu, Search, Settings, ShieldAlert, ShieldCheck, SlidersHorizontal, UserRound, X, XCircle,
} from 'lucide-react'
import './App.css'
import './live.css'

type Section = 'Overview' | 'Repositories' | 'Findings' | 'Pull requests'
type FindingSeverity = 'Critical' | 'High' | 'Medium' | 'Low'
type ReviewState = 'Needs review' | 'Approved' | 'Changes requested'
type LiveRepository = { id: number; name: string; fullName: string; owner: string; url: string; private: boolean; language: string; updatedAt: string; defaultBranch: string; archived: boolean; fork: boolean }
type LiveFinding = { kind: string; repo: string; repoUrl: string; number?: number; created_at?: string; updated_at?: string; rule?: { description?: string; security_severity_level?: string; severity?: string }; security_advisory?: { summary?: string; severity?: string }; secret_type?: string; secret_type_display_name?: string; most_recent_instance?: { location?: { path?: string } }; manifest_path?: string }
type LivePullRequest = { id: number; number: number; title: string; repo: string; htmlUrl: string; author: string; avatarUrl: string; branch: string; createdAt: string; draft: boolean }
type GitHubData = { repos: LiveRepository[]; findings: LiveFinding[]; pullRequests: LivePullRequest[]; scannedRepositoryCount: number; totalRepositoryCount: number; unavailable: string[]; syncedAt: string }
type AzureLiveRepository = { id: string; name: string; fullName: string; owner: string; url: string; private: boolean; language: string; updatedAt: string; defaultBranch: string; archived: boolean; fork: boolean; provider: 'Azure DevOps'; project: string }
type AzureLivePullRequest = { id: number; number: number; title: string; repo: string; repositoryId: string; project: string; projectId: string; organization: string; htmlUrl: string; author: string; branch: string; createdAt: string; status: string; isDraft: boolean }
type AzureData = { organization: string; projects: { id: string; name: string; state: string }[]; repos: AzureLiveRepository[]; pullRequests: AzureLivePullRequest[]; totalRepositoryCount: number; scannedRepositoryCount: number; unavailable: string[]; syncedAt: string }
type PullRequestRow = typeof initialPullRequests[number] & { url?: string; pullNumber?: number; provider?: 'GitHub' | 'Azure DevOps'; projectId?: string; repositoryId?: string }
type AppNotification = { id: string; title: string; detail: string; createdAt: string; read: boolean; level: 'success' | 'warning' }
type IdentityUser = { id: string; username: string; email: string; groups: string[]; role: 'reader' | 'admin' }

function readNotifications(): AppNotification[] {
  try {
    const stored = JSON.parse(localStorage.getItem('devsecops.notifications') || '[]') as AppNotification[]
    return Array.isArray(stored) ? stored.slice(0, 20) : []
  } catch {
    return []
  }
}

const repositories = [
  { name: 'payments-api', org: 'acme-platform', provider: 'GitHub', language: 'TypeScript', findings: 8, quality: 'A', updated: '12 min ago', branch: 'main' },
  { name: 'customer-portal', org: 'acme-platform', provider: 'Azure', language: 'C#', findings: 3, quality: 'A', updated: '38 min ago', branch: 'main' },
  { name: 'infra-modules', org: 'cloud-foundation', provider: 'GitHub', language: 'Terraform', findings: 12, quality: 'B', updated: '1 hr ago', branch: 'main' },
  { name: 'identity-service', org: 'acme-platform', provider: 'Azure', language: 'C#', findings: 2, quality: 'A', updated: '2 hrs ago', branch: 'main' },
]

const initialFindings: { title: string; repo: string; severity: FindingSeverity; type: string; age: string; file: string }[] = [
  { title: 'Hardcoded credential detected', repo: 'payments-api', severity: 'Critical', type: 'Secret scanning', age: '12 min ago', file: 'src/config.ts' },
  { title: 'SQL query built from user input', repo: 'customer-portal', severity: 'High', type: 'Code scanning', age: '38 min ago', file: 'Controllers/Orders.cs' },
  { title: 'Container image runs as root', repo: 'infra-modules', severity: 'High', type: 'IaC scanning', age: '1 hr ago', file: 'modules/api/Dockerfile' },
  { title: 'Outdated cryptography package', repo: 'payments-api', severity: 'Medium', type: 'Dependency review', age: '2 hrs ago', file: 'package-lock.json' },
]

const initialPullRequests: { id: number; title: string; repo: string; author: string; initials: string; branch: string; checks: string; time: string; state: ReviewState }[] = [
  { id: 284, title: 'Rotate payment gateway credentials', repo: 'payments-api', author: 'Maya Chen', initials: 'MC', branch: 'security/rotate-gateway-keys', checks: '6 / 6 passed', time: '18 min ago', state: 'Needs review' },
  { id: 119, title: 'Add request validation to order endpoint', repo: 'customer-portal', author: 'Leo Martin', initials: 'LM', branch: 'fix/order-validation', checks: '5 / 5 passed', time: '42 min ago', state: 'Needs review' },
  { id: 67, title: 'Pin base image to supported release', repo: 'infra-modules', author: 'Ava Patel', initials: 'AP', branch: 'chore/pin-base-image', checks: '3 / 4 passed', time: '1 hr ago', state: 'Needs review' },
]

const navItems: { label: Section; icon: typeof LayoutDashboard }[] = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Repositories', icon: GitBranch },
  { label: 'Findings', icon: ShieldAlert },
  { label: 'Pull requests', icon: GitPullRequest },
]

function relativeTime(value?: string) {
  if (!value) return 'Unknown'
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function formatLocalDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(value)
}

function formatLocalTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(value)
}

function normalizeSeverity(value: string): FindingSeverity {
  const severity = value.toLowerCase()
  if (severity === 'critical') return 'Critical'
  if (severity === 'high' || severity === 'error') return 'High'
  if (severity === 'medium' || severity === 'warning') return 'Medium'
  return 'Low'
}

function PasswordResetFlow({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [complete, setComplete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function requestPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const result = await response.json() as { message?: string; error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not send the reset PIN.')
      setSent(true)
      setMessage(result.message || 'If an account exists for that email, a PIN has been sent.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not send the reset PIN.')
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, pin, password }),
      })
      const result = await response.json() as { message?: string; error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not reset the password.')
      setComplete(true)
      setMessage(result.message || 'Password reset complete.')
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not reset the password.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="auth-form-wrap reset-form-wrap">
    <div className="form-kicker">ACCOUNT RECOVERY</div>
    <h2>{complete ? 'Password updated' : sent ? 'Check your email' : 'Forgot password?'}</h2>
    <p className="form-description">{complete ? 'You can now sign in with your new password.' : sent ? 'Enter the 4-digit PIN and choose a new password.' : 'We’ll email a one-time 4-digit PIN to your account.'}</p>
    {complete ? <><p className="auth-success" role="status">{message}</p><button className="submit-button" type="button" onClick={onBack}>Back to sign in <ArrowRight size={16} /></button></> : sent ? <form onSubmit={resetPassword}>
      <label>Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      {message && <p className="reset-message" role="status">{message}</p>}
      <label>4-digit PIN<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4}" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" /></label>
      <label>New password<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></label>
      {error && <span className="pat-error" role="alert">{error}</span>}
      <button className="submit-button" type="submit" disabled={busy}>{busy ? 'Updating password…' : 'Reset password'} <KeyRound size={15} /></button>
      <button className="forgot-link reset-resend" type="button" onClick={() => { setSent(false); setPin(''); setPassword(''); setError('') }}>Request another PIN</button>
    </form> : <form onSubmit={requestPin}>
      <label>Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label>
      {error && <span className="pat-error" role="alert">{error}</span>}
      <button className="submit-button" type="submit" disabled={busy}>{busy ? 'Sending PIN…' : 'Send 4-digit PIN'} <Mail size={15} /></button>
    </form>}
    {!complete && <button className="forgot-link reset-back" type="button" onClick={onBack}>Back to sign in</button>}
  </div>
}

function AuthScreen({ onAccountLogin }: { onAccountLogin: (name: string) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [forgotOpen, setForgotOpen] = useState(false)
  const [accountError, setAccountError] = useState('')
  const [accountBusy, setAccountBusy] = useState(false)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submitAccount()
  }

  async function submitAccount() {
    setAccountBusy(true)
    setAccountError('')
    try {
      const response = await fetch(`/api/auth/${mode === 'signup' ? 'signup' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'signup' ? { username, email, password } : { username, password }),
      })
      const result = await response.json() as { user?: { username: string }; message?: string; error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not authenticate this account.')
      if (mode === 'signup') {
        if (!result.message) throw new Error('Could not create this account.')
        window.alert('Account is created successfully')
        setMode('login')
        setEmail('')
        setPassword('')
        return
      }
      if (!result.user) throw new Error('Could not authenticate this account.')
      onAccountLogin(result.user.username)
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Could not authenticate this account.')
    } finally {
      setAccountBusy(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-art" aria-label="Security operations workspace">
        <div className="auth-brand"><span className="brand-mark"><ShieldCheck size={19} /></span><span className="brand-name">DevSecOps Copilot</span></div>
        <div className="auth-art-copy">
          <p className="eyebrow"><span className="status-dot" /> SECURITY OPERATIONS, IN FOCUS</p>
          <h1>Ship with<br /><em>confidence.</em></h1>
          <p className="auth-intro">One clear view of your code, cloud posture, and the changes moving through your pipeline.</p>
          <div className="mini-scan">
            <div className="mini-scan-top"><span><Activity size={15} /> LIVE POSTURE</span><span className="scan-live">MONITORING</span></div>
            <div className="scan-score"><strong>94</strong><span>/ 100<br />security score</span><div className="score-ring"><ShieldCheck size={21} /></div></div>
            <div className="scan-track"><i /></div>
            <div className="scan-bottom"><span>12 repositories monitored</span><span><ArrowUpRight size={13} /> +4 this month</span></div>
          </div>
        </div>
        <div className="auth-art-footer"><span>AZURE DEVOPS</span><i /><span>GITHUB</span><i /><span>CONTINUOUS ASSURANCE</span></div>
      </section>
      <section className="auth-panel">
        <div className="auth-panel-top"><span>{forgotOpen ? 'Need to sign in?' : mode === 'login' ? 'New to the workspace?' : 'Already registered?'}</span><button className="text-button" onClick={() => { if (forgotOpen) setForgotOpen(false); else setMode(mode === 'login' ? 'signup' : 'login'); setAccountError('') }}>{forgotOpen ? 'Sign in' : mode === 'login' ? 'Create account' : 'Sign in'} <ArrowRight size={15} /></button></div>
        {forgotOpen ? <PasswordResetFlow onBack={() => setForgotOpen(false)} /> : <div className="auth-form-wrap">
          <div className="form-kicker">{mode === 'login' ? 'WELCOME BACK' : 'GET STARTED'}</div>
          <h2>{mode === 'login' ? 'Sign in to your workspace' : 'Create your account'}</h2>
          <p className="form-description">{mode === 'login' ? 'Enter your username and password to continue.' : 'Choose a username, password, and recovery email.'}</p>
          <form onSubmit={submit}>
            <label>Username<input required autoComplete="username" minLength={3} maxLength={32} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="jordan.lee" /></label>
            {mode === 'signup' && <label>Recovery email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label>}
            <label>Password<input required type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'login' ? 'Enter your password' : 'At least 8 characters'} /></label>
            {accountError && <span className="pat-error" role="alert">{accountError}</span>}
            {mode === 'login' && <button className="forgot-link" type="button" onClick={() => { setForgotOpen(true); setAccountError('') }}>Forgot password?</button>}
            <button className="submit-button" type="submit" disabled={accountBusy}>{accountBusy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={17} /></button>
          </form>
          <p className="auth-notice"><LockKeyhole size={13} /> Sign in with an account you have registered.</p>
        </div>}
        <div className="auth-legal">By continuing, you agree to our <button>Terms</button> and <button>Privacy Policy</button>.</div>
      </section>
    </main>
  )
}

function App() {
  const [user, setUser] = useState<string | null>(null)
  const [serverAuthenticated, setServerAuthenticated] = useState(false)
  const [githubConnected, setGithubConnected] = useState(false)
  const [azureConnected, setAzureConnected] = useState(false)
  const [azureOrganization, setAzureOrganization] = useState('')
  const [authLoading, setAuthLoading] = useState(true)
  const [liveData, setLiveData] = useState<GitHubData | null>(null)
  const [azureData, setAzureData] = useState<AzureData | null>(null)
  const [liveDataLoading, setLiveDataLoading] = useState(false)
  const [azureDataLoading, setAzureDataLoading] = useState(false)
  const [liveDataError, setLiveDataError] = useState('')
  const [azureDataError, setAzureDataError] = useState('')
  const [section, setSection] = useState<Section>('Overview')
  const [pullRequests, setPullRequests] = useState(initialPullRequests)
  const [githubReviewStates, setGithubReviewStates] = useState<Record<number, ReviewState>>({})
  const [azureReviewStates, setAzureReviewStates] = useState<Record<string, ReviewState>>({})
  const [query, setQuery] = useState('')
  const [severityFilter, setSeverityFilter] = useState('All severity')
  const [notice, setNotice] = useState('')
  const [notifications, setNotifications] = useState<AppNotification[]>(readNotifications)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [iamUsers, setIamUsers] = useState<IdentityUser[]>([])
  const [iamLoading, setIamLoading] = useState(false)
  const [iamError, setIamError] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [accountPanel, setAccountPanel] = useState<'Profile' | 'Settings' | 'IAM' | null>(null)
  const [githubDialogOpen, setGithubDialogOpen] = useState(false)
  const [dashboardGithubToken, setDashboardGithubToken] = useState('')
  const [dashboardGithubError, setDashboardGithubError] = useState('')
  const [dashboardGithubConnecting, setDashboardGithubConnecting] = useState(false)
  const [azureDialogOpen, setAzureDialogOpen] = useState(false)
  const [dashboardAzureOrganization, setDashboardAzureOrganization] = useState('')
  const [dashboardAzureToken, setDashboardAzureToken] = useState('')
  const [dashboardAzureError, setDashboardAzureError] = useState('')
  const [dashboardAzureConnecting, setDashboardAzureConnecting] = useState(false)
  const [autoSync, setAutoSync] = useState(() => localStorage.getItem('devsecops.autoSync') === 'true')
  const [compactRows, setCompactRows] = useState(() => localStorage.getItem('devsecops.compactRows') === 'true')
  const [clockNow, setClockNow] = useState(() => new Date())

  useEffect(() => {
    fetch('/api/session')
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to restore GitHub session')
        return response.json() as Promise<{ user: { name?: string; username?: string; login?: string } | null; githubConnected?: boolean; azureConnected?: boolean; azureOrganization?: string | null }>
      })
      .then((session) => {
        if (session.user) {
          setUser(session.user.name || session.user.username || session.user.login || 'User')
          setServerAuthenticated(true)
          setGithubConnected(Boolean(session.githubConnected))
          setAzureConnected(Boolean(session.azureConnected))
          setAzureOrganization(session.azureOrganization || '')
          if (session.githubConnected) setLiveDataLoading(true)
          if (session.azureConnected) setAzureDataLoading(true)
        }
      })
      .catch(() => undefined)
      .finally(() => setAuthLoading(false))
  }, [])

  function addNotification(title: string, detail: string, level: AppNotification['level'] = 'success') {
    const notification: AppNotification = { id: crypto.randomUUID(), title, detail, createdAt: new Date().toISOString(), read: false, level }
    setNotifications((current) => {
      const updated = [notification, ...current].slice(0, 20)
      localStorage.setItem('devsecops.notifications', JSON.stringify(updated))
      return updated
    })
  }

  async function refreshLiveData(notify = true) {
    setLiveDataLoading(true)
    setLiveDataError('')
    try {
      const response = await fetch('/api/github/data')
      const result = await response.json() as GitHubData & { error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not load GitHub data.')
      setLiveData(result)
      if (notify) addNotification('GitHub sync completed', `${result.totalRepositoryCount} repositories and ${result.pullRequests.length} open pull requests loaded.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load GitHub data.'
      setLiveDataError(message)
      if (notify) addNotification('GitHub sync failed', message, 'warning')
    } finally {
      setLiveDataLoading(false)
    }
  }

  async function refreshAzureData(notify = true) {
    setAzureDataLoading(true)
    setAzureDataError('')
    try {
      const response = await fetch('/api/azure/data')
      const result = await response.json() as AzureData & { error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not load Azure DevOps data.')
      setAzureData(result)
      if (notify) addNotification('Azure DevOps sync completed', `${result.totalRepositoryCount} repositories and ${result.pullRequests.length} active pull requests loaded from ${result.organization}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load Azure DevOps data.'
      setAzureDataError(message)
      if (notify) addNotification('Azure DevOps sync failed', message, 'warning')
    } finally {
      setAzureDataLoading(false)
    }
  }

  useEffect(() => {
    if (!githubConnected) return
    let active = true
    async function loadData() {
      try {
        const response = await fetch('/api/github/data')
        const result = await response.json() as GitHubData & { error?: string }
        if (!response.ok) throw new Error(result.error || 'Could not load GitHub data.')
        if (active) setLiveData(result)
      } catch (error) {
        if (active) setLiveDataError(error instanceof Error ? error.message : 'Could not load GitHub data.')
      } finally {
        if (active) setLiveDataLoading(false)
      }
    }
    void loadData()
    return () => { active = false }
  }, [githubConnected])

  useEffect(() => {
    if (!azureConnected) return
    let active = true
    async function loadAzureData() {
      try {
        const response = await fetch('/api/azure/data')
        const result = await response.json() as AzureData & { error?: string }
        if (!response.ok) throw new Error(result.error || 'Could not load Azure DevOps data.')
        if (active) setAzureData(result)
      } catch (error) {
        if (active) setAzureDataError(error instanceof Error ? error.message : 'Could not load Azure DevOps data.')
      } finally {
        if (active) setAzureDataLoading(false)
      }
    }
    void loadAzureData()
    return () => { active = false }
  }, [azureConnected])

  useEffect(() => {
    if ((!githubConnected && !azureConnected) || !autoSync) return
    const timer = window.setInterval(async () => {
      if (githubConnected) void refreshLiveData(false)
      if (azureConnected) void refreshAzureData(false)
    }, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [autoSync, azureConnected, githubConnected])

  useEffect(() => {
    if (!accountMenuOpen && !accountPanel && !notificationsOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setAccountMenuOpen(false)
        setAccountPanel(null)
        setNotificationsOpen(false)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [accountMenuOpen, accountPanel, notificationsOpen])

  useEffect(() => {
    if (accountPanel !== 'IAM') return
    void loadIamUsers()
  }, [accountPanel])

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  if (authLoading) return <main className="auth-loading" aria-label="Checking connection"><span className="brand-mark"><ShieldCheck size={19} /></span></main>
  if (!user) return <AuthScreen onAccountLogin={(name) => { setUser(name); setServerAuthenticated(true); setGithubConnected(false); setAzureConnected(false) }} />

  const hasLiveProviders = githubConnected || azureConnected
  const dashboardRepositories = [
    ...(githubConnected ? (liveData?.repos || []).map((repo) => ({ name: repo.name, org: repo.owner, provider: 'GitHub', language: repo.language, findings: liveData?.findings.filter((finding) => finding.repo === repo.fullName).length || 0, quality: '—', updated: relativeTime(repo.updatedAt), branch: repo.defaultBranch })) : []),
    ...(azureConnected ? (azureData?.repos || []).map((repo) => ({ name: repo.name, org: repo.owner, provider: 'Azure DevOps', language: repo.language, findings: 0, quality: '—', updated: relativeTime(repo.updatedAt), branch: repo.defaultBranch })) : []),
    ...(!hasLiveProviders ? repositories : []),
  ]
  const dashboardFindings = githubConnected
    ? (liveData?.findings || []).map((finding) => ({ title: finding.rule?.description || finding.security_advisory?.summary || finding.secret_type_display_name || finding.secret_type || `${finding.kind} alert`, repo: finding.repo.split('/').at(-1) || finding.repo, severity: normalizeSeverity(finding.rule?.security_severity_level || finding.security_advisory?.severity || (finding.kind === 'Secret scanning' ? 'high' : 'low')), type: finding.kind, age: relativeTime(finding.updated_at || finding.created_at), file: finding.most_recent_instance?.location?.path || finding.manifest_path || 'View alert on GitHub' }))
    : azureConnected ? [] : initialFindings
  const dashboardPullRequests: PullRequestRow[] = [
    ...(githubConnected ? (liveData?.pullRequests || []).map((pullRequest) => ({ id: pullRequest.id, pullNumber: pullRequest.number, title: pullRequest.title, repo: pullRequest.repo, author: pullRequest.author, initials: pullRequest.author.slice(0, 2).toUpperCase(), branch: pullRequest.branch, checks: 'Status not loaded', time: relativeTime(pullRequest.createdAt), state: githubReviewStates[pullRequest.id] || 'Needs review' as ReviewState, url: pullRequest.htmlUrl, provider: 'GitHub' as const })) : []),
    ...(azureConnected ? (azureData?.pullRequests || []).map((pullRequest) => ({ id: pullRequest.id, pullNumber: pullRequest.number, title: pullRequest.title, repo: `${pullRequest.project}/${pullRequest.repo}`, author: pullRequest.author, initials: pullRequest.author.slice(0, 2).toUpperCase(), branch: pullRequest.branch, checks: 'Status not loaded', time: relativeTime(pullRequest.createdAt), state: azureReviewStates[`${pullRequest.repositoryId}:${pullRequest.id}`] || 'Needs review' as ReviewState, url: pullRequest.htmlUrl, provider: 'Azure DevOps' as const, projectId: pullRequest.projectId, repositoryId: pullRequest.repositoryId })) : []),
    ...(!hasLiveProviders ? pullRequests : []),
  ]
  const pendingReviews = dashboardPullRequests.filter((pullRequest) => pullRequest.state === 'Needs review').length
  const repoCount = hasLiveProviders ? dashboardRepositories.length : 12
  const findingCount = githubConnected ? liveData?.findings.length || 0 : azureConnected ? 0 : 25
  const severityCounts = dashboardFindings.reduce<Record<FindingSeverity, number>>((counts, finding) => ({ ...counts, [finding.severity]: counts[finding.severity] + 1 }), { Critical: 0, High: 0, Medium: 0, Low: 0 })
  const filteredRepositories = dashboardRepositories.filter((repo) => `${repo.name} ${repo.org} ${repo.provider}`.toLowerCase().includes(query.toLowerCase()))
  const filteredFindings = dashboardFindings.filter((finding) => (severityFilter === 'All severity' || finding.severity === severityFilter) && `${finding.title} ${finding.repo} ${finding.type}`.toLowerCase().includes(query.toLowerCase()))
  const chartDates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(clockNow)
    date.setDate(date.getDate() - (6 - index))
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
  })

  async function decidePullRequest(id: number, decision: 'Approved' | 'Changes requested', repository?: string, pullNumber?: number, provider: PullRequestRow['provider'] = 'GitHub', projectId?: string, repositoryId?: string) {
    if (provider === 'Azure DevOps') {
      const pullRequest = azureData?.pullRequests.find((item) => item.id === id && item.repositoryId === repositoryId)
      if (!pullRequest) return
      try {
        const response = await fetch('/api/azure/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: projectId || pullRequest.projectId, repositoryId: repositoryId || pullRequest.repositoryId, pullRequestId: pullNumber || pullRequest.number, decision }),
        })
        const result = await response.json() as { error?: string }
        if (!response.ok) throw new Error(result.error || 'Azure DevOps rejected this review.')
        setAzureReviewStates((current) => ({ ...current, [`${pullRequest.repositoryId}:${id}`]: decision }))
        setNotice(`Azure DevOps recorded PR #${pullNumber || pullRequest.number} as ${decision.toLowerCase()}.`)
        await refreshAzureData()
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Could not send this review to Azure DevOps.')
      }
      window.setTimeout(() => setNotice(''), 5000)
      return
    }
    if (githubConnected) {
      const pullRequest = liveData?.pullRequests.find((item) => item.id === id)
      if (!pullRequest) return
      try {
        const response = await fetch('/api/github/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repository: repository || pullRequest.repo, pullNumber: pullNumber || pullRequest.number, decision }),
        })
        const result = await response.json() as { error?: string }
        if (!response.ok) throw new Error(result.error || 'GitHub rejected this review.')
        setGithubReviewStates((current) => ({ ...current, [id]: decision }))
        setNotice(`GitHub recorded pull request #${pullNumber || pullRequest.number} as ${decision.toLowerCase()}.`)
        await refreshLiveData()
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Could not send this review to GitHub.')
      }
      window.setTimeout(() => setNotice(''), 5000)
      return
    }
    setPullRequests((current) => current.map((pullRequest) => pullRequest.id === id ? { ...pullRequest, state: decision } : pullRequest))
    setNotice(`Pull request #${id} marked ${decision.toLowerCase()}.`)
    window.setTimeout(() => setNotice(''), 3200)
  }

  function signOut() {
    if (serverAuthenticated) void fetch('/api/auth/logout', { method: 'POST' })
    setServerAuthenticated(false)
    setGithubConnected(false)
    setAzureConnected(false)
    setAzureOrganization('')
    setGithubReviewStates({})
    setAzureReviewStates({})
    setLiveData(null)
    setAzureData(null)
    setUser(null)
  }

  function updateAutoSync(enabled: boolean) {
    setAutoSync(enabled)
    localStorage.setItem('devsecops.autoSync', String(enabled))
  }

  function updateCompactRows(enabled: boolean) {
    setCompactRows(enabled)
    localStorage.setItem('devsecops.compactRows', String(enabled))
  }

  const unreadNotificationCount = notifications.filter((notification) => !notification.read).length

  function markNotificationsRead() {
    setNotifications((current) => {
      const updated = current.map((notification) => ({ ...notification, read: true }))
      localStorage.setItem('devsecops.notifications', JSON.stringify(updated))
      return updated
    })
  }

  function dismissNotification(id: string) {
    setNotifications((current) => {
      const updated = current.filter((notification) => notification.id !== id)
      localStorage.setItem('devsecops.notifications', JSON.stringify(updated))
      return updated
    })
  }

  function clearNotifications() {
    setNotifications([])
    localStorage.removeItem('devsecops.notifications')
  }

  function toggleNotifications() {
    const opening = !notificationsOpen
    setNotificationsOpen(opening)
    setAccountMenuOpen(false)
    if (opening) markNotificationsRead()
  }

  async function loadIamUsers() {
    setIamLoading(true)
    setIamError('')
    try {
      const response = await fetch('/api/users')
      const result = await response.json() as { users?: IdentityUser[]; error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not load user profiles.')
      setIamUsers(result.users || [])
    } catch (error) {
      setIamError(error instanceof Error ? error.message : 'Could not load user profiles.')
    } finally {
      setIamLoading(false)
    }
  }

  async function updateUserRole(targetId: string, role: 'reader' | 'admin') {
    const response = await fetch(`/api/users/${targetId}/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    const result = await response.json() as { error?: string; role?: string }
    if (!response.ok) throw new Error(result.error || 'Could not update role.')
    setIamUsers((current) => current.map((entry) => entry.id === targetId ? { ...entry, role } : entry))
    setNotice(`Role updated to ${result.role || role}.`)
  }

  async function updateUsername(targetId: string, username: string) {
    const response = await fetch(`/api/users/${targetId}/username`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    })
    const result = await response.json() as { error?: string; username?: string }
    if (!response.ok) throw new Error(result.error || 'Could not update username.')
    setIamUsers((current) => current.map((entry) => entry.id === targetId ? { ...entry, username: result.username || username } : entry))
    setNotice('Username updated.')
  }

  async function resetUserPassword(targetId: string) {
    const nextPassword = window.prompt('Enter a new password for this user (8–128 chars):')
    if (!nextPassword) return
    const response = await fetch(`/api/users/${targetId}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: nextPassword }),
    })
    const result = await response.json() as { error?: string }
    if (!response.ok) throw new Error(result.error || 'Could not reset password.')
    setNotice('Password reset for this user.')
  }

  async function connectDashboardGitHub(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const token = dashboardGithubToken
    setDashboardGithubToken('')
    setDashboardGithubConnecting(true)
    setDashboardGithubError('')
    try {
      const response = await fetch('/api/github/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const result = await response.json() as { githubUser?: { name: string; login: string }; error?: string }
      if (!response.ok || !result.githubUser) throw new Error(result.error || 'Could not verify GitHub token.')
      setGithubReviewStates({})
      setLiveData(null)
      setLiveDataLoading(true)
      setGithubConnected(true)
      setGithubDialogOpen(false)
      setNotice(`GitHub connected as ${result.githubUser.login}.`)
      window.setTimeout(() => setNotice(''), 5000)
    } catch (error) {
      setDashboardGithubError(error instanceof Error ? error.message : 'Could not connect to GitHub.')
    } finally {
      setDashboardGithubConnecting(false)
    }
  }

  async function connectDashboardAzure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const token = dashboardAzureToken
    setDashboardAzureToken('')
    setDashboardAzureConnecting(true)
    setDashboardAzureError('')
    try {
      const response = await fetch('/api/azure/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization: dashboardAzureOrganization, token }),
      })
      const result = await response.json() as { organization?: string; error?: string }
      if (!response.ok || !result.organization) throw new Error(result.error || 'Could not verify Azure DevOps PAT.')
      setAzureOrganization(result.organization)
      setAzureReviewStates({})
      setAzureData(null)
      setAzureDataLoading(true)
      setAzureConnected(true)
      setAzureDialogOpen(false)
      setNotice(`Azure DevOps connected to ${result.organization}.`)
      window.setTimeout(() => setNotice(''), 5000)
    } catch (error) {
      setDashboardAzureError(error instanceof Error ? error.message : 'Could not connect to Azure DevOps.')
    } finally {
      setDashboardAzureConnecting(false)
    }
  }

  async function disconnectAzure() {
    await fetch('/api/azure/disconnect', { method: 'POST' })
    setAzureConnected(false)
    setAzureOrganization('')
    setAzureData(null)
    setAzureReviewStates({})
    setAzureDialogOpen(false)
  }

  return (
    <div className={`app-shell ${compactRows ? 'compact-rows' : ''}`}>
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand"><span className="brand-mark"><ShieldCheck size={18} /></span><span className="brand-name">DevSecOps Copilot</span><button className="sidebar-close" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={18} /></button></div>
        <div className="workspace-switch"><div className="workspace-icon">A</div><div><span className="workspace-label">WORKSPACE</span><strong>Acme Engineering</strong></div><ChevronDown size={15} /></div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">{navItems.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${section === label ? 'active' : ''}`} onClick={() => { setSection(label); setMobileNavOpen(false) }}><Icon size={17} /><span>{label}</span>{label === 'Pull requests' && <span className="nav-count">{pendingReviews}</span>}</button>)}</nav>
        <div className="nav-caption integrations-caption">CONNECTED SOURCES</div>
        <button className="source-link source-link-action" aria-label={githubConnected ? 'Manage GitHub connection' : 'Connect GitHub'} onClick={() => { setDashboardGithubToken(''); setDashboardGithubError(''); setGithubDialogOpen(true) }}><span className="source-icon github-source"><GitBranch size={15} /></span><span>GitHub</span><span className={`connection-dot ${githubConnected ? '' : 'disconnected-dot'}`} /></button>
        <button className="source-link source-link-action" aria-label={azureConnected ? 'Manage Azure DevOps connection' : 'Connect Azure DevOps'} onClick={() => { setDashboardAzureOrganization(azureOrganization); setDashboardAzureToken(''); setDashboardAzureError(''); setAzureDialogOpen(true) }}><span className="source-icon azure-source"><Cloud size={15} /></span><span>Azure DevOps</span><span className={`connection-dot ${azureConnected ? '' : 'disconnected-dot'}`} /></button>
        <div className="sidebar-bottom"><button className="help-link"><CircleHelp size={16} /> Help center <ArrowUpRight size={13} /></button><div className="profile"><button className="profile-trigger" aria-label="Open account menu" aria-expanded={accountMenuOpen} onClick={() => { setNotificationsOpen(false); setAccountMenuOpen((open) => !open) }}><div className="profile-avatar">{user.slice(0, 1).toUpperCase()}</div><div className="profile-info"><strong>{user}</strong><span>{githubConnected && azureConnected ? 'GitHub + Azure account' : githubConnected ? 'GitHub account' : azureConnected ? 'Azure DevOps account' : 'DevSecOps Copilot account'}</span></div><ChevronRight size={14} /></button><button className="icon-button logout-button" title="Sign out" aria-label="Sign out" onClick={signOut}><LogOut size={16} /></button></div></div>
      </aside>
      {mobileNavOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <main className="main-area">
        <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button><span className="breadcrumb">Workspace</span><span className="breadcrumb-slash">/</span><strong>{section}</strong></div><div className="topbar-right"><div className="sync-status"><span className="connection-dot" /> {githubConnected && azureConnected ? 'GitHub + Azure connected' : githubConnected ? liveDataLoading ? 'Syncing GitHub' : 'GitHub connected' : azureConnected ? azureDataLoading ? 'Syncing Azure DevOps' : 'Azure DevOps connected' : 'Demo workspace'} <span className="sync-time">{liveData ? relativeTime(liveData.syncedAt) : azureData ? relativeTime(azureData.syncedAt) : ''}</span></div><button className="icon-button notification-button" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={toggleNotifications}><Bell size={17} />{unreadNotificationCount > 0 && <span className="notification-badge">{unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}</span>}</button><button className="top-avatar-button" aria-label="Open account menu" aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => { setNotificationsOpen(false); setAccountMenuOpen((open) => !open) }}>{user.slice(0, 1).toUpperCase()}</button></div></header>
        {notificationsOpen && <><button className="account-menu-dismiss" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)} /><section className="notifications-popover" role="region" aria-label="Notifications"><header><div><strong>Notifications</strong><small>{unreadNotificationCount ? `${unreadNotificationCount} unread` : 'All caught up'}</small></div>{notifications.length > 0 && <button className="link-button" onClick={clearNotifications}>Clear all</button>}</header>{notifications.length ? <div className="notifications-list">{notifications.map((notification) => <article className={`notification-item ${notification.level} ${notification.read ? 'read' : ''}`} key={notification.id}><span className="notification-status"><i /></span><div><strong>{notification.title}</strong><p>{notification.detail}</p><time dateTime={notification.createdAt}>{relativeTime(notification.createdAt)}</time></div><button className="notification-dismiss" aria-label={`Dismiss ${notification.title}`} onClick={() => dismissNotification(notification.id)}><X size={14} /></button></article>)}</div> : <div className="notifications-empty"><Bell size={20} /><span>No notifications yet</span><small>Sync a connected source to see updates here.</small></div>}</section></>}
        {accountMenuOpen && <><button className="account-menu-dismiss" aria-label="Close account menu" onClick={() => setAccountMenuOpen(false)} /><div className="account-menu" role="menu"><div className="account-menu-user"><span className="profile-avatar">{user.slice(0, 1).toUpperCase()}</span><span><strong>{user}</strong><small>{githubConnected && azureConnected ? 'GitHub + Azure connected' : githubConnected ? 'GitHub connected' : azureConnected ? 'Azure DevOps connected' : 'DevSecOps Copilot account'}</small></span></div><div className="account-menu-divider" /><button role="menuitem" onClick={() => { setAccountMenuOpen(false); setAccountPanel('Profile') }}><UserRound size={16} /> Profile <ChevronRight size={14} /></button><button role="menuitem" onClick={() => { setAccountMenuOpen(false); setAccountPanel('Settings') }}><Settings size={16} /> Settings <ChevronRight size={14} /></button><button role="menuitem" onClick={() => { setAccountMenuOpen(false); setAccountPanel('IAM') }}><KeyRound size={16} /> Identity &amp; Access Management <ChevronRight size={14} /></button><div className="account-menu-divider" /><button className="account-menu-signout" role="menuitem" onClick={signOut}><LogOut size={16} /> Sign out</button></div></>}
        <div className="page-content">
          <div className="page-heading"><div><div className="page-kicker"><span>{formatLocalDate(clockNow).toUpperCase()}</span><span className="kicker-divider" /><span>{formatLocalTime(clockNow)}</span><span className="kicker-divider" /><span>{hasLiveProviders ? githubConnected && azureConnected ? 'LIVE GITHUB + AZURE DATA' : githubConnected ? 'LIVE GITHUB DATA' : 'LIVE AZURE DEVOPS DATA' : 'SECURITY OVERVIEW'}</span></div><h1>{section === 'Overview' ? 'Good morning, ' + user.split(' ')[0] + '.' : section}</h1><p>{section === 'Overview' ? 'Here’s your engineering security posture at a glance.' : section === 'Repositories' ? 'Monitor code health and security across connected sources.' : section === 'Findings' ? 'Prioritized issues detected across your repositories.' : 'Review and decide on changes waiting for your team.'}</p></div><button className="outline-button" onClick={() => { if (githubConnected) void refreshLiveData(); if (azureConnected) void refreshAzureData(); if (!hasLiveProviders) setNotice('A fresh demo scan has been queued.') }} disabled={liveDataLoading || azureDataLoading}><Activity size={15} /> {hasLiveProviders ? liveDataLoading || azureDataLoading ? 'Syncing…' : 'Sync sources' : 'Run scan'}</button></div>
          {liveDataError && <div className="data-warning" role="alert"><AlertTriangle size={15} />{liveDataError}<button onClick={() => void refreshLiveData()}>Retry</button></div>}
          {azureDataError && <div className="data-warning" role="alert"><AlertTriangle size={15} />{azureDataError}<button onClick={() => void refreshAzureData()}>Retry</button></div>}
          {liveData?.unavailable.length ? <div className="data-warning"><LockKeyhole size={15} />GitHub did not return these features (permission or feature may be unavailable): {liveData.unavailable.join(', ')}. Check the PAT's repository access and feature permissions.</div> : null}
          {githubConnected && liveData && <div className="live-caption"><span className="connection-dot" /> GitHub synced {relativeTime(liveData.syncedAt)} · security alerts checked in {liveData.scannedRepositoryCount} of {liveData.totalRepositoryCount} repositories</div>}
          {azureConnected && azureData && <div className="live-caption"><span className="connection-dot" /> Azure DevOps · {azureData.organization} · synced {relativeTime(azureData.syncedAt)} · {azureData.projects.length} projects{azureData.unavailable.length ? ` · ${azureData.unavailable.join('; ')}` : ''}</div>}
          {notice && <div className="toast" role="status"><Check size={16} />{notice}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={15} /></button></div>}
          {section === 'Overview' && <>
            <section className="metric-grid" aria-label="Security metrics">
              <article className="metric-card"><div className="metric-top"><span>SECURITY SCORE</span><span className="metric-icon score-icon"><ShieldCheck size={17} /></span></div><div className="metric-value">{hasLiveProviders ? '—' : '94'}<span className="metric-unit">{hasLiveProviders ? '' : '/100'}</span></div><div className={`metric-foot ${hasLiveProviders ? 'neutral' : 'positive'}`}>{hasLiveProviders ? 'Scoring model not configured' : <><ArrowUpRight size={14} /> 6 points <span>vs. last month</span><div className="sparkline green-spark"><i /><i /><i /><i /><i /><i /><i /><i /></div></>}</div></article>
              <article className="metric-card"><div className="metric-top"><span>OPEN FINDINGS</span><span className="metric-icon finding-icon"><ShieldAlert size={17} /></span></div><div className="metric-value">{findingCount}</div><div className="metric-foot negative">{githubConnected ? <><ShieldAlert size={14} /> Live GitHub alerts</> : azureConnected ? 'Azure security alerts not loaded' : <><ArrowDown size={14} /> 4 findings <span>resolved this week</span><div className="sparkline coral-spark"><i /><i /><i /><i /><i /><i /><i /><i /></div></>}</div></article>
              <article className="metric-card"><div className="metric-top"><span>REPOSITORIES</span><span className="metric-icon repo-icon"><Code2 size={17} /></span></div><div className="metric-value">{repoCount}</div><div className="metric-foot neutral">{hasLiveProviders ? <>{githubConnected && <span className="provider-mini"><GitBranch size={13} /> {liveData?.totalRepositoryCount || 0}</span>}{azureConnected && <span className="provider-mini"><Cloud size={14} /> {azureData?.totalRepositoryCount || 0}</span>}<span>live repositories</span></> : <><span className="provider-mini"><GitBranch size={13} /> 7</span><span className="provider-mini"><Cloud size={14} /> 5</span><span>demo repositories</span></>}</div></article>
              <article className="metric-card"><div className="metric-top"><span>PENDING REVIEWS</span><span className="metric-icon review-icon"><GitPullRequest size={17} /></span></div><div className="metric-value">{pendingReviews.toString().padStart(2, '0')}</div><div className="metric-foot review-foot"><Clock3 size={14} /> Oldest waiting <strong>1h 24m</strong></div></article>
            </section>
            <section className="content-grid">
              <div className="panel findings-panel"><div className="panel-heading"><div><div className="panel-kicker">NEEDS ATTENTION</div><h2>Priority findings</h2></div><button className="link-button" onClick={() => setSection('Findings')}>View all <ArrowRight size={14} /></button></div><div className="finding-list">{dashboardFindings.slice(0, 3).map((finding) => <div className="finding-row" key={`${finding.repo}-${finding.title}`}><span className={`severity-mark ${finding.severity.toLowerCase()}`}><AlertTriangle size={15} /></span><div className="finding-copy"><strong>{finding.title}</strong><span>{finding.repo}<b>·</b>{finding.file}</span></div><span className={`severity-pill ${finding.severity.toLowerCase()}`}>{finding.severity}</span></div>)}</div><button className="panel-footer-link" onClick={() => setSection('Findings')}>Explore all findings <ArrowRight size={14} /></button></div>
              <div className={`panel posture-panel ${hasLiveProviders ? 'live-posture-panel' : ''}`}><div className="panel-heading"><div><div className="panel-kicker">LAST 7 DAYS</div><h2>Posture trend</h2></div><button className="icon-button more-button" title="More posture options" aria-label="More posture options"><SlidersHorizontal size={16} /></button></div><div className="chart-summary"><strong>94<span>/100</span></strong><span className="chart-change"><ArrowUpRight size={14} /> 6.2%</span><span className="chart-period">vs. previous week</span></div><div className="chart" aria-label="Security score increased over the last seven days"><div className="chart-y-labels"><span>100</span><span>75</span><span>50</span><span>25</span></div><div className="chart-plot"><div className="chart-gridlines"><i /><i /><i /><i /></div><svg viewBox="0 0 540 150" preserveAspectRatio="none" role="img" aria-label="Rising trend line"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#4f9a79" stopOpacity=".19" /><stop offset="100%" stopColor="#4f9a79" stopOpacity="0" /></linearGradient></defs><path className="chart-area" d="M0 115 C36 104 48 110 75 94 S126 102 154 84 S197 79 230 86 S275 68 307 69 S351 57 385 65 S425 42 462 48 S510 25 540 17 L540 150 L0 150 Z" /><path className="chart-line" d="M0 115 C36 104 48 110 75 94 S126 102 154 84 S197 79 230 86 S275 68 307 69 S351 57 385 65 S425 42 462 48 S510 25 540 17" /><circle cx="540" cy="17" r="4" /></svg><div className="chart-x-labels">{chartDates.map((date, index) => <span key={`${date}-${index}`}>{index === chartDates.length - 1 ? 'Today' : date}</span>)}</div></div></div><div className="chart-legend"><span><i /> Security score</span><span><i /> Baseline</span></div></div>
            </section>
            {githubConnected && <section className="panel live-severity-panel"><div className="panel-heading"><div><div className="panel-kicker">LIVE GITHUB ALERTS</div><h2>Open alerts by severity</h2></div><span className="live-alert-total">{findingCount} total</span></div><div className="live-severity-grid">{(['Critical', 'High', 'Medium', 'Low'] as const).map((severity) => <div className="live-severity-item" key={severity}><span className={`severity-pill ${severity.toLowerCase()}`}>{severity}</span><strong>{severityCounts[severity]}</strong></div>)}</div></section>}
            <section className="panel pull-panel"><div className="panel-heading"><div><div className="panel-kicker">TEAM WORKFLOW</div><h2>Pull requests awaiting review <span className="heading-count">{pendingReviews}</span></h2></div><button className="link-button" onClick={() => setSection('Pull requests')}>View queue <ArrowRight size={14} /></button></div><PullRequestTable pullRequests={dashboardPullRequests.slice(0, 2)} onDecision={decidePullRequest} /></section>
            <section className="panel repo-panel"><div className="panel-heading"><div><div className="panel-kicker">CONNECTED SOURCES</div><h2>Repository health</h2></div><button className="link-button" onClick={() => setSection('Repositories')}>All repositories <ArrowRight size={14} /></button></div><RepositoryTable rows={dashboardRepositories.slice(0, 3)} /></section>
          </>}
          {section === 'Repositories' && <section className="panel full-panel"><div className="table-toolbar"><div className="search-box"><Search size={16} /><input aria-label="Search repositories" placeholder="Search repositories" value={query} onChange={(event) => setQuery(event.target.value)} /></div><span className="result-count">{filteredRepositories.length} repositories</span></div>{hasLiveProviders && (githubConnected && liveDataLoading || azureConnected && azureDataLoading) && !liveData && !azureData ? <div className="empty-state">Loading repositories from connected providers…</div> : filteredRepositories.length ? <RepositoryTable rows={filteredRepositories} /> : <div className="empty-state">No repositories returned for the connected sources.</div>}</section>}
          {section === 'Findings' && <section className="panel full-panel"><div className="table-toolbar"><div className="search-box"><Search size={16} /><input aria-label="Search findings" placeholder="Search findings or repositories" value={query} onChange={(event) => setQuery(event.target.value)} /></div><select aria-label="Filter by severity" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}><option>All severity</option><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select><span className="result-count">{filteredFindings.length} findings</span></div><div className="data-table finding-table"><div className="table-head finding-table-row"><span>FINDING</span><span>SEVERITY</span><span>TYPE</span><span>REPOSITORY</span><span>DETECTED</span></div>{filteredFindings.map((finding) => <div className="table-row finding-table-row" key={`${finding.repo}-${finding.title}`}><span className="table-main"><span className={`severity-mark ${finding.severity.toLowerCase()}`}><AlertTriangle size={14} /></span><span><strong>{finding.title}</strong><small>{finding.file}</small></span></span><span><span className={`severity-pill ${finding.severity.toLowerCase()}`}>{finding.severity}</span></span><span className="muted-cell">{finding.type}</span><span className="repo-cell"><Code2 size={14} />{finding.repo}</span><span className="muted-cell">{finding.age}</span></div>)}</div>{hasLiveProviders && !githubConnected && <div className="empty-state">Azure DevOps repositories are live. Azure security alert ingestion is not configured.</div>}{githubConnected && liveData && filteredFindings.length === 0 && <div className="empty-state">No open GitHub security alerts were returned for this filter.</div>}</section>}
          {section === 'Pull requests' && <section className="panel full-panel"><div className="table-toolbar"><div className="review-summary"><span className="review-dot" /> {pendingReviews} need review <span>·</span> {dashboardPullRequests.length - pendingReviews} decided</div><button className="outline-button small-outline" onClick={() => { if (githubConnected) void refreshLiveData(); if (azureConnected) void refreshAzureData(); if (!hasLiveProviders) setNotice('Pull request list refreshed.') }} disabled={liveDataLoading || azureDataLoading}><Activity size={14} /> {liveDataLoading || azureDataLoading ? 'Syncing…' : 'Refresh'}</button></div><PullRequestTable pullRequests={dashboardPullRequests} onDecision={decidePullRequest} showDescription /></section>}
          <footer className="page-footer"><span><span className={`connection-dot ${hasLiveProviders ? '' : 'disconnected-dot'}`} /> {githubConnected && azureConnected ? `GitHub + Azure live data · GitHub ${relativeTime(liveData?.syncedAt)} · Azure ${relativeTime(azureData?.syncedAt)}` : githubConnected ? `GitHub live data · Last synced ${relativeTime(liveData?.syncedAt)}` : azureConnected ? `Azure DevOps live data · Last synced ${relativeTime(azureData?.syncedAt)}` : `Demo data · Local time ${formatLocalTime(clockNow)}`}</span><span>DevSecOps Copilot <b>v0.1.0</b></span></footer>
        </div>
      </main>
      {githubDialogOpen && <div className="account-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setGithubDialogOpen(false) }}><section className="account-dialog github-connect-dialog" role="dialog" aria-modal="true" aria-labelledby="github-dialog-title"><header><div><span className="panel-kicker">CONNECTED SOURCES</span><h2 id="github-dialog-title">{githubConnected ? 'GitHub connection' : 'Connect GitHub'}</h2></div><button className="icon-button" aria-label="Close GitHub connection dialog" onClick={() => setGithubDialogOpen(false)}><X size={18} /></button></header><div className="github-connection-body">{githubConnected && <div className="github-connected-status"><span className="connection-dot" /><span><strong>Connected as {user}</strong><small>{liveDataLoading ? 'Fetching repositories and pull requests…' : liveData ? `${liveData.totalRepositoryCount} repositories · ${liveData.pullRequests.length} open pull requests` : 'Connection is active'}</small></span><button className="link-button" onClick={() => void refreshLiveData()} disabled={liveDataLoading}>{liveDataLoading ? 'Syncing…' : 'Sync now'}</button></div>}<p>Enter a GitHub personal access token to verify your account and load repositories and pull requests into this dashboard.</p><form className="dashboard-pat-form" onSubmit={connectDashboardGitHub}><label htmlFor="dashboard-github-pat">Personal access token</label><input id="dashboard-github-pat" type="password" autoComplete="off" spellCheck={false} required value={dashboardGithubToken} onChange={(event) => setDashboardGithubToken(event.target.value)} placeholder="github_pat_…" /><small>Token is sent to the backend for verification and is not saved in browser storage.</small><small>Repository metadata and pull request read access are needed. Security alert permissions are optional; pull request write access is needed to submit reviews.</small>{dashboardGithubError && <span className="pat-error" role="alert">{dashboardGithubError}</span>}<button className="submit-button" type="submit" disabled={dashboardGithubConnecting}>{dashboardGithubConnecting ? 'Verifying and loading…' : githubConnected ? 'Reconnect GitHub' : 'Verify and connect'} <ArrowRight size={16} /></button></form></div><footer><button className="outline-button" onClick={() => setGithubDialogOpen(false)}>Done</button></footer></section></div>}
      {azureDialogOpen && <div className="account-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAzureDialogOpen(false) }}><section className="account-dialog github-connect-dialog" role="dialog" aria-modal="true" aria-labelledby="azure-dialog-title"><header><div><span className="panel-kicker">CONNECTED SOURCES</span><h2 id="azure-dialog-title">{azureConnected ? 'Azure DevOps connection' : 'Connect Azure DevOps'}</h2></div><button className="icon-button" aria-label="Close Azure DevOps connection dialog" onClick={() => setAzureDialogOpen(false)}><X size={18} /></button></header><div className="github-connection-body">{azureConnected && <div className="github-connected-status"><span className="connection-dot" /><span><strong>Connected to {azureOrganization}</strong><small>{azureDataLoading ? 'Fetching projects, repositories, and pull requests…' : azureData ? `${azureData.projects.length} projects · ${azureData.totalRepositoryCount} repositories · ${azureData.pullRequests.length} open pull requests` : 'Connection is active'}</small></span><button className="link-button" onClick={() => void refreshAzureData()} disabled={azureDataLoading}>{azureDataLoading ? 'Syncing…' : 'Sync now'}</button></div>}<p>Enter your Azure DevOps organization and a personal access token. The token is verified by the backend and is never saved in browser storage.</p><form className="dashboard-pat-form" onSubmit={connectDashboardAzure}><label htmlFor="azure-organization">Organization</label><input id="azure-organization" type="text" autoComplete="organization" required value={dashboardAzureOrganization} onChange={(event) => setDashboardAzureOrganization(event.target.value)} placeholder="your-organization" /><label htmlFor="azure-pat">Personal access token</label><input id="azure-pat" type="password" autoComplete="off" spellCheck={false} required value={dashboardAzureToken} onChange={(event) => setDashboardAzureToken(event.target.value)} placeholder="Paste Azure DevOps PAT" /><small>Grant Code: Read to list projects, repositories, and pull requests. Code: Read & write enables pull-request review votes.</small>{dashboardAzureError && <span className="pat-error" role="alert">{dashboardAzureError}</span>}<button className="submit-button" type="submit" disabled={dashboardAzureConnecting}>{dashboardAzureConnecting ? 'Verifying and loading…' : azureConnected ? 'Reconnect Azure DevOps' : 'Verify and connect'} <ArrowRight size={16} /></button></form>{azureConnected && <button className="azure-disconnect-button" onClick={() => void disconnectAzure()}>Disconnect Azure DevOps</button>}</div><footer><button className="outline-button" onClick={() => setAzureDialogOpen(false)}>Done</button></footer></section></div>}
      {accountPanel && <div className="account-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAccountPanel(null) }}><section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title"><header><div><span className="panel-kicker">ACCOUNT</span><h2 id="account-dialog-title">{accountPanel}</h2></div><button className="icon-button" aria-label="Close account dialog" onClick={() => setAccountPanel(null)}><X size={18} /></button></header>{accountPanel === 'Profile' ? <div className="profile-details"><div className="profile-hero"><span className="profile-avatar large-avatar">{user.slice(0, 1).toUpperCase()}</span><div><strong>{user}</strong><small>{githubConnected && azureConnected ? 'GitHub and Azure DevOps connected' : githubConnected ? 'GitHub-connected account' : azureConnected ? `Azure DevOps · ${azureOrganization}` : 'DevSecOps Copilot account'}</small></div></div><dl><div><dt>Display name</dt><dd>{user}</dd></div><div><dt>Account type</dt><dd>{githubConnected && azureConnected ? 'GitHub + Azure PATs' : githubConnected ? 'GitHub personal access token' : azureConnected ? 'Azure DevOps personal access token' : 'Username and password'}</dd></div><div><dt>Workspace</dt><dd>Acme Engineering</dd></div><div><dt>Role</dt><dd>Security lead</dd></div><div><dt>Session</dt><dd>Active</dd></div></dl></div> : accountPanel === 'IAM' ? <div className="iam-panel"><div className="iam-toolbar"><strong>Identity &amp; Access Management</strong><button className="link-button" onClick={() => void loadIamUsers()}>{iamLoading ? 'Loading…' : 'Refresh'}</button></div>{iamError && <div className="data-warning" role="alert"><AlertTriangle size={15} />{iamError}</div>}<div className="iam-list">{iamUsers.map((entry) => <div className="iam-row" key={entry.id}><div className="iam-user"><strong>{entry.username}</strong><small>{entry.email}</small><span>{entry.groups.length ? entry.groups.join(', ') : 'No groups'}</span></div><div className="iam-actions"><label>Role<select value={entry.role} onChange={(event) => { const value = event.target.value as 'reader' | 'admin'; void updateUserRole(entry.id, value).catch(() => undefined) }}><option value="reader">reader</option><option value="admin">admin</option></select></label><div className="iam-inline-actions"><button className="outline-button small-outline" onClick={() => { const nextName = window.prompt('Edit username:', entry.username); if (nextName && nextName.trim()) { void updateUsername(entry.id, nextName.trim()).catch(() => undefined) } }}>Edit username</button><button className="outline-button small-outline" onClick={() => { void resetUserPassword(entry.id).catch(() => undefined) }}>Reset password</button></div></div></div>)}</div>{!iamLoading && iamUsers.length === 0 && <div className="empty-state">No users found.</div>}</div> : <div className="settings-list"><label className="setting-row"><span><strong>Auto-sync connected sources</strong><small>Refresh GitHub and Azure DevOps data every 5 minutes.</small></span><input type="checkbox" checked={autoSync} onChange={(event) => updateAutoSync(event.target.checked)} /></label><label className="setting-row"><span><strong>Compact repository rows</strong><small>Reduce row height in repository tables.</small></span><input type="checkbox" checked={compactRows} onChange={(event) => updateCompactRows(event.target.checked)} /></label><div className="settings-note"><LockKeyhole size={15} /> Preferences are saved in this browser.</div></div>}<footer><button className="outline-button" onClick={() => setAccountPanel(null)}>Done</button></footer></section></div>}
    </div>
  )
}

function RepositoryTable({ rows }: { rows: typeof repositories }) {
  return <div className="data-table"><div className="table-head repository-table-row"><span>REPOSITORY</span><span>SOURCE</span><span>LANGUAGE</span><span>FINDINGS</span><span>QUALITY</span><span>LAST SCAN</span></div>{rows.map((repo) => <div className="table-row repository-table-row" key={repo.name}><span className="repo-name"><span className="repo-avatar">{repo.name.slice(0, 1).toUpperCase()}</span><span><strong>{repo.name}</strong><small>{repo.org}/{repo.branch}</small></span></span><span className="provider-cell">{repo.provider === 'GitHub' ? <GitBranch size={15} /> : <Cloud size={16} />}{repo.provider}</span><span className="muted-cell">{repo.language}</span><span><span className={`finding-count ${repo.findings > 8 ? 'count-high' : ''}`}>{repo.findings}</span></span><span><span className="quality-grade">{repo.quality}</span></span><span className="muted-cell scan-time"><span className="connection-dot" />{repo.updated}</span></div>)}</div>
}

function PullRequestTable({ pullRequests, onDecision, showDescription = false }: { pullRequests: PullRequestRow[]; onDecision: (id: number, decision: 'Approved' | 'Changes requested', repository?: string, pullNumber?: number, provider?: PullRequestRow['provider'], projectId?: string, repositoryId?: string) => void; showDescription?: boolean }) {
  return <div className="pr-list">{pullRequests.map((pullRequest) => {
    const checkClass = pullRequest.checks.includes('failed') ? 'checks-warning' : pullRequest.checks.includes('passed') ? 'checks-good' : 'checks-neutral'
    return <article className="pr-row" key={`${pullRequest.provider || 'demo'}-${pullRequest.repo}-${pullRequest.id}`}>
      <div className="pr-avatar">{pullRequest.initials}</div>
      <div className="pr-main">
        <div className="pr-title-line"><strong>{pullRequest.url ? <a className="pr-title-link" href={pullRequest.url} target="_blank" rel="noreferrer">{pullRequest.title}</a> : pullRequest.title}</strong><span className="pr-number">#{pullRequest.pullNumber || pullRequest.id}</span></div>
        <div className="pr-meta"><span className="pr-repo"><Code2 size={13} />{pullRequest.repo}</span><span className="meta-separator">·</span><span className="branch-label"><GitBranch size={13} />{pullRequest.branch}</span><span className="meta-separator">·</span><span>by {pullRequest.author}</span><span className="meta-separator">·</span><span>{pullRequest.time}</span></div>
        {showDescription && <div className="pr-checks"><span className={checkClass}>{pullRequest.checks}</span><span className={`pr-state ${pullRequest.state.toLowerCase().replaceAll(' ', '-')}`}>{pullRequest.state}</span></div>}
      </div>
      <div className="pr-actions"><span className={checkClass}>{pullRequest.checks}</span>{pullRequest.state === 'Needs review' ? <><button className="approve-button" onClick={() => onDecision(pullRequest.id, 'Approved', pullRequest.repo, pullRequest.pullNumber, pullRequest.provider, pullRequest.projectId, pullRequest.repositoryId)} title="Approve pull request"><Check size={14} /> Approve</button><button className="decline-button" onClick={() => onDecision(pullRequest.id, 'Changes requested', pullRequest.repo, pullRequest.pullNumber, pullRequest.provider, pullRequest.projectId, pullRequest.repositoryId)} title="Request changes"><XCircle size={14} /></button></> : <span className={`pr-state ${pullRequest.state.toLowerCase().replaceAll(' ', '-')}`}>{pullRequest.state === 'Approved' ? <Check size={13} /> : <XCircle size={13} />}{pullRequest.state}</span>}</div>
    </article>
  })}</div>
}

export default App
