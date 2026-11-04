import 'dotenv/config'
import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import nodemailer from 'nodemailer'

const port = Number(process.env.API_PORT || 3001)
const isProduction = process.env.NODE_ENV === 'production'
const sessionCookie = 'devsecops_session'
const sessionLifetime = 8 * 60 * 60 * 1000
const resetLifetime = 10 * 60 * 1000
const resetCooldown = 60 * 1000
const maxResetAttempts = 5
const sessions = new Map()
const resetRequestWindows = new Map()
const apiVersion = '2022-11-28'
const scrypt = promisify(crypto.scrypt)
const databasePath = process.env.DATABASE_PATH || fileURLToPath(new URL('../data/accounts.sqlite', import.meta.url))
const providerKeyPath = process.env.PROVIDER_TOKEN_KEY_PATH || fileURLToPath(new URL('../data/provider-token.key', import.meta.url))

mkdirSync(dirname(databasePath), { recursive: true })
mkdirSync(dirname(providerKeyPath), { recursive: true })

function loadProviderEncryptionKey() {
  if (process.env.PROVIDER_TOKEN_ENCRYPTION_KEY) {
    const configuredKey = Buffer.from(process.env.PROVIDER_TOKEN_ENCRYPTION_KEY, 'base64')
    if (configuredKey.length !== 32) throw new Error('PROVIDER_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key')
    return configuredKey
  }
  if (existsSync(providerKeyPath)) {
    const storedKey = readFileSync(providerKeyPath)
    if (storedKey.length !== 32) throw new Error(`Provider token key at ${providerKeyPath} is invalid`)
    return storedKey
  }
  const generatedKey = crypto.randomBytes(32)
  try {
    writeFileSync(providerKeyPath, generatedKey, { flag: 'wx', mode: 0o600 })
    return generatedKey
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const storedKey = readFileSync(providerKeyPath)
    if (storedKey.length !== 32) throw new Error(`Provider token key at ${providerKeyPath} is invalid`)
    return storedKey
  }
}

const providerEncryptionKey = loadProviderEncryptionKey()
const database = new DatabaseSync(databasePath)
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    groups TEXT NOT NULL DEFAULT '["engineering"]',
    role TEXT NOT NULL DEFAULT 'reader',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS provider_credentials (
    account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    encrypted_token TEXT NOT NULL,
    config_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, provider)
  );
`)
const userInfoColumns = new Set(database.prepare('PRAGMA table_info(users)').all().map((column) => column.name))
if (!userInfoColumns.has('groups')) database.exec(`ALTER TABLE users ADD COLUMN groups TEXT NOT NULL DEFAULT '["engineering"]'`)
if (!userInfoColumns.has('role')) database.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'reader'`)

const sessionCleanup = setInterval(() => {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id)
  }
  for (const [key, window] of resetRequestWindows) {
    if (window.resetAt <= now) resetRequestWindows.delete(key)
  }
}, 60 * 60 * 1000)
sessionCleanup.unref()

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  response.end(JSON.stringify(value))
}

function cookiesFrom(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').map((cookie) => {
    const separator = cookie.indexOf('=')
    if (separator < 0) return ['', '']
    return [cookie.slice(0, separator).trim(), decodeURIComponent(cookie.slice(separator + 1).trim())]
  }).filter(([key]) => key))
}

function setSessionCookie(response, id) {
  response.setHeader('Set-Cookie', `${sessionCookie}=${encodeURIComponent(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionLifetime / 1000)}${isProduction ? '; Secure' : ''}`)
}

function clearSessionCookie(response) {
  response.setHeader('Set-Cookie', `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isProduction ? '; Secure' : ''}`)
}

function getSession(request) {
  const id = cookiesFrom(request)[sessionCookie]
  if (!id) return null
  const session = sessions.get(id)
  if (!session) return null
  if (session.expiresAt <= Date.now()) {
    sessions.delete(id)
    return null
  }
  if (!session.accountId || !database.prepare('SELECT id FROM users WHERE id = ?').get(session.accountId)) {
    sessions.delete(id)
    return null
  }
  return session
}

function publicAccount(user) {
  return { id: user.id, username: user.username, name: user.username, login: user.username }
}

function encryptProviderToken(token) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', providerEncryptionKey, iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

function decryptProviderToken(encryptedToken) {
  const payload = Buffer.from(encryptedToken, 'base64url')
  if (payload.length < 29) throw new Error('Stored provider credential is invalid')
  const iv = payload.subarray(0, 12)
  const authTag = payload.subarray(12, 28)
  const ciphertext = payload.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', providerEncryptionKey, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

function saveProviderCredential(accountId, provider, token, configuration) {
  database.prepare(`INSERT INTO provider_credentials (account_id, provider, encrypted_token, config_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id, provider) DO UPDATE SET encrypted_token=excluded.encrypted_token, config_json=excluded.config_json, updated_at=excluded.updated_at`)
    .run(accountId, provider, encryptProviderToken(token), JSON.stringify(configuration), Date.now())
}

function loadProviderCredentials(accountId) {
  const rows = database.prepare('SELECT provider, encrypted_token, config_json FROM provider_credentials WHERE account_id = ?').all(accountId)
  const credentials = {}
  for (const row of rows) {
    const token = decryptProviderToken(row.encrypted_token)
    const configuration = JSON.parse(row.config_json)
    if (row.provider === 'github') credentials.github = { token, ...configuration }
    if (row.provider === 'azure') credentials.azureDevOps = { token, ...configuration }
  }
  return credentials
}

function createAccountSession(response, user, status = 200) {
  const id = crypto.randomBytes(32).toString('base64url')
  const credentials = loadProviderCredentials(user.id)
  const session = { user: publicAccount(user), accountId: user.id, expiresAt: Date.now() + sessionLifetime }
  if (credentials.github) {
    session.token = credentials.github.token
    session.githubUser = credentials.github.profile
  }
  if (credentials.azureDevOps) session.azureDevOps = credentials.azureDevOps
  sessions.set(id, session)
  setSessionCookie(response, id)
  sendJson(response, status, { user: publicAccount(user) })
}

async function passwordHash(password, salt) {
  return (await scrypt(password, salt, 64)).toString('hex')
}

function hashesMatch(left, right) {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function getMailTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) return null
  const mailPort = Number(SMTP_PORT)
  if (!Number.isInteger(mailPort) || mailPort < 1 || mailPort > 65535) return null
  return {
    transport: nodemailer.createTransport({
      host: SMTP_HOST,
      port: mailPort,
      secure: process.env.SMTP_SECURE === 'true' || mailPort === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    }),
    from: SMTP_FROM,
  }
}

function rateLimited(key, limit, duration) {
  const now = Date.now()
  const current = resetRequestWindows.get(key)
  if (!current || current.resetAt <= now) {
    resetRequestWindows.set(key, { count: 1, resetAt: now + duration })
    return false
  }
  current.count += 1
  return current.count > limit
}

function pinHash(userId, pin) {
  const secret = process.env.RESET_PIN_SECRET || process.env.SESSION_SECRET
  if (!secret || secret.length < 32) throw new Error('Reset PIN signing secret is not configured')
  return crypto.createHmac('sha256', secret).update(`${userId}:${pin}`).digest('hex')
}

async function githubRequest(token, path, options = {}) {
  const apiBase = process.env.GITHUB_API_BASE_URL || 'https://api.github.com'
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': apiVersion,
      'User-Agent': 'Sentinel-Ops-DevSecOps-Dashboard',
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  })
  let body = null
  if (response.status !== 204) {
    try { body = await response.json() } catch { body = null }
  }
  return { response, body }
}

async function azureRequest(token, organization, path, options = {}) {
  const credentials = Buffer.from(`:${token}`).toString('base64')
  const apiBase = process.env.AZURE_DEVOPS_API_BASE_URL || 'https://dev.azure.com'
  const response = await fetch(`${apiBase}/${encodeURIComponent(organization)}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  })
  let body = null
  if (response.status !== 204) {
    try { body = await response.json() } catch { body = null }
  }
  return { response, body }
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 16 * 1024) throw new Error('Request body is too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function listRepositories(token) {
  const repositories = []
  for (let page = 1; page <= 10; page += 1) {
    const { response, body } = await githubRequest(token, `/user/repos?per_page=100&page=${page}&sort=updated&direction=desc&affiliation=owner,collaborator,organization_member`)
    if (!response.ok) return { error: body?.message || `GitHub returned ${response.status}`, status: response.status }
    if (!Array.isArray(body)) return { error: 'GitHub returned an unexpected repository response', status: 502 }
    repositories.push(...body)
    if (body.length < 100) break
  }
  return { repositories }
}

async function collectRepoData(token, repo) {
  const owner = encodeURIComponent(repo.owner.login)
  const name = encodeURIComponent(repo.name)
  const base = `/repos/${owner}/${name}`
  const [codeAlerts, dependabotAlerts, secretAlerts, pullRequests] = await Promise.all([
    githubRequest(token, `${base}/code-scanning/alerts?state=open&per_page=100`),
    githubRequest(token, `${base}/dependabot/alerts?state=open&per_page=100`),
    githubRequest(token, `${base}/secret-scanning/alerts?state=open&per_page=100`),
    githubRequest(token, `${base}/pulls?state=open&per_page=100`),
  ])

  const issues = []
  const unavailable = new Set()
  const collectAlerts = (result, kind) => {
    if (result.response.ok && Array.isArray(result.body)) {
      for (const alert of result.body) issues.push({ kind, repo: repo.full_name, repoUrl: repo.html_url, ...alert })
      return
    }
    if ([401, 403, 404].includes(result.response.status)) unavailable.add(kind)
  }
  collectAlerts(codeAlerts, 'Code scanning')
  collectAlerts(dependabotAlerts, 'Dependabot')
  collectAlerts(secretAlerts, 'Secret scanning')
  if ([401, 403].includes(pullRequests.response.status)) unavailable.add('Pull requests')

  const prs = pullRequests.response.ok && Array.isArray(pullRequests.body)
    ? pullRequests.body.map((pullRequest) => ({
      id: pullRequest.id,
      number: pullRequest.number,
      title: pullRequest.title,
      repo: repo.full_name,
      htmlUrl: pullRequest.html_url,
      author: pullRequest.user?.login || 'Unknown',
      avatarUrl: pullRequest.user?.avatar_url || '',
      branch: pullRequest.head?.ref || '',
      createdAt: pullRequest.created_at,
      draft: Boolean(pullRequest.draft),
    }))
    : []

  return { issues, pullRequests: prs, unavailable: [...unavailable] }
}

async function mapWithLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index])
    }
  }))
  return results
}

async function syncGitHubData(token) {
  const listed = await listRepositories(token)
  if (listed.error) return listed

  const repos = listed.repositories.map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    owner: repo.owner?.login || '',
    url: repo.html_url,
    private: Boolean(repo.private),
    language: repo.language || 'Unknown',
    updatedAt: repo.updated_at,
    defaultBranch: repo.default_branch || 'main',
    archived: Boolean(repo.archived),
    fork: Boolean(repo.fork),
  }))

  const scannedRepos = listed.repositories.filter((repo) => !repo.archived).slice(0, 25)
  const details = await mapWithLimit(scannedRepos, 5, (repo) => collectRepoData(token, repo))
  const findings = details.flatMap((entry) => entry.issues)
  const pullRequests = details.flatMap((entry) => entry.pullRequests)
  const unavailable = [...new Set(details.flatMap((entry) => entry.unavailable))]

  return {
    repos,
    findings,
    pullRequests,
    scannedRepositoryCount: scannedRepos.length,
    totalRepositoryCount: repos.length,
    unavailable,
    syncedAt: new Date().toISOString(),
  }
}

async function syncAzureData(token, organization) {
  const projectsResult = await azureRequest(token, organization, '/_apis/projects?$top=1000&api-version=7.1')
  if (projectsResult.response.status === 401 || projectsResult.response.status === 203) {
    return { error: 'Azure DevOps rejected this PAT. Check the token and organization.', status: 401 }
  }
  if (!projectsResult.response.ok || !Array.isArray(projectsResult.body?.value)) {
    return { error: projectsResult.body?.message || `Could not list Azure DevOps projects (${projectsResult.response.status}).`, status: projectsResult.response.status || 502 }
  }

  const projects = projectsResult.body.value
  const projectResults = await mapWithLimit(projects, 5, async (project) => {
    const projectPath = `/${encodeURIComponent(project.id)}`
    const repositoriesResult = await azureRequest(token, organization, `${projectPath}/_apis/git/repositories?api-version=7.1`)
    if (!repositoriesResult.response.ok || !Array.isArray(repositoriesResult.body?.value)) {
      return { repositories: [], error: repositoriesResult.body?.message || `Could not list repositories for project ${project.name}.` }
    }
    return { repositories: repositoriesResult.body.value.map((repository) => ({ ...repository, projectName: project.name, projectId: project.id })) }
  })
  const projectError = projectResults.find((result) => result.error)?.error
  const azureRepositories = projectResults.flatMap((result) => result.repositories)
  const prResults = await mapWithLimit(azureRepositories.slice(0, 100), 5, async (repository) => {
    const path = `/${encodeURIComponent(repository.projectId)}/_apis/git/repositories/${encodeURIComponent(repository.id)}/pullrequests?searchCriteria.status=active&$top=100&api-version=7.1`
    const result = await azureRequest(token, organization, path)
    if (!result.response.ok || !Array.isArray(result.body?.value)) {
      return { error: result.body?.message || `Could not list pull requests for ${repository.name}.`, pullRequests: [] }
    }
    return {
      pullRequests: result.body.value.map((pullRequest) => ({
        id: pullRequest.pullRequestId,
        number: pullRequest.pullRequestId,
        title: pullRequest.title,
        repo: repository.name,
        repositoryId: repository.id,
        project: repository.projectName,
        projectId: repository.projectId,
        organization,
        htmlUrl: pullRequest._links?.web?.href || repository.webUrl || repository.remoteUrl,
        author: pullRequest.createdBy?.displayName || 'Unknown',
        branch: String(pullRequest.sourceRefName || '').replace(/^refs\/heads\//, ''),
        createdAt: pullRequest.creationDate,
        status: pullRequest.status,
        isDraft: Boolean(pullRequest.isDraft),
      })),
    }
  })

  const repositories = azureRepositories.map((repository) => ({
    id: repository.id,
    name: repository.name,
    fullName: `${repository.projectName}/${repository.name}`,
    owner: repository.projectName,
    url: repository.webUrl || repository.remoteUrl,
    private: true,
    language: 'Unknown',
    updatedAt: repository.project?.lastUpdateTime || repository.updatedDate || new Date().toISOString(),
    defaultBranch: String(repository.defaultBranch || 'main').replace(/^refs\/heads\//, ''),
    archived: Boolean(repository.isDisabled),
    fork: false,
    provider: 'Azure DevOps',
    project: repository.projectName,
  }))
  const pullRequests = prResults.flatMap((result) => result.pullRequests)
  const pullRequestError = prResults.find((result) => result.error)?.error

  return {
    organization,
    projects: projects.map((project) => ({ id: project.id, name: project.name, state: project.state })),
    repos: repositories,
    pullRequests,
    totalRepositoryCount: repositories.length,
    scannedRepositoryCount: Math.min(azureRepositories.length, 100),
    unavailable: [projectError, pullRequestError].filter(Boolean),
    syncedAt: new Date().toISOString(),
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
  if (!url.pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: 'Not found' })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/signup') {
    let input
    try { input = await readJson(request) } catch {
      sendJson(response, 400, { error: 'Enter a username, email, and password.' })
      return
    }
    const username = typeof input.username === 'string' ? input.username.trim() : ''
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
    const password = typeof input.password === 'string' ? input.password : ''
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
      sendJson(response, 400, { error: 'Username must be 3–32 characters using letters, numbers, dots, underscores, or hyphens.' })
      return
    }
    if (!validEmail(email)) {
      sendJson(response, 400, { error: 'Enter a valid email address for account recovery.' })
      return
    }
    if (password.length < 8 || password.length > 128) {
      sendJson(response, 400, { error: 'Password must be between 8 and 128 characters.' })
      return
    }
    if (rateLimited(`signup:${request.socket.remoteAddress || 'local'}`, 8, 60 * 60 * 1000)) {
      sendJson(response, 429, { error: 'Too many account creation attempts. Try again later.' })
      return
    }
    try {
      const salt = crypto.randomBytes(16).toString('hex')
      const hash = await passwordHash(password, salt)
      const user = { id: crypto.randomUUID(), username, email }
      database.prepare('INSERT INTO users (id, username, email, password_hash, password_salt, groups, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(user.id, user.username, user.email, hash, salt, JSON.stringify(['engineering']), 'reader', Date.now())
      sendJson(response, 201, { message: 'Account is created successfully' })
    } catch (error) {
      if (String(error?.code || '').includes('CONSTRAINT') || String(error?.message || '').includes('UNIQUE constraint failed')) {
        sendJson(response, 409, { error: 'That username or email is already registered.' })
      } else {
        sendJson(response, 500, { error: 'Could not create this account.' })
      }
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    let input
    try { input = await readJson(request) } catch {
      sendJson(response, 400, { error: 'Enter your username and password.' })
      return
    }
    const username = typeof input.username === 'string' ? input.username.trim() : ''
    const password = typeof input.password === 'string' ? input.password : ''
    if (!username || !password || password.length > 128) {
      sendJson(response, 400, { error: 'Enter your username and password.' })
      return
    }
    if (rateLimited(`login:${request.socket.remoteAddress || 'local'}`, 12, 15 * 60 * 1000)) {
      sendJson(response, 429, { error: 'Too many sign-in attempts. Try again later.' })
      return
    }
    const user = database.prepare('SELECT id, username, email, password_hash, password_salt FROM users WHERE username = ? COLLATE NOCASE').get(username)
    const salt = user?.password_salt || 'devsecops-copilot-dummy-salt'
    const hash = await passwordHash(password, salt)
    if (!user || !hashesMatch(hash, user.password_hash)) {
      sendJson(response, 401, { error: 'Username or password is incorrect.' })
      return
    }
    createAccountSession(response, user)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/password-reset/request') {
    let input
    try { input = await readJson(request) } catch {
      sendJson(response, 400, { error: 'Enter the email address on your account.' })
      return
    }
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
    if (!validEmail(email)) {
      sendJson(response, 400, { error: 'Enter a valid email address.' })
      return
    }
    if (rateLimited(`reset:${request.socket.remoteAddress || 'local'}`, 5, 15 * 60 * 1000)) {
      sendJson(response, 429, { error: 'Too many reset requests. Try again later.' })
      return
    }
    const mailConfig = getMailTransport()
    if (!mailConfig) {
      sendJson(response, 503, { error: 'Password reset email is not configured on this server.' })
      return
    }
    let user
    try {
      user = database.prepare('SELECT id, username, email FROM users WHERE email = ? COLLATE NOCASE').get(email)
    } catch {
      sendJson(response, 500, { error: 'Could not process this reset request.' })
      return
    }
    const genericMessage = 'If an account exists for that email, a reset PIN has been sent.'
    if (!user) {
      sendJson(response, 200, { message: genericMessage })
      return
    }
    const previous = database.prepare('SELECT sent_at FROM password_resets WHERE user_id = ?').get(user.id)
    if (previous && Date.now() - previous.sent_at < resetCooldown) {
      sendJson(response, 200, { message: genericMessage })
      return
    }
    const pin = String(crypto.randomInt(0, 10000)).padStart(4, '0')
    let hashedPin
    try { hashedPin = pinHash(user.id, pin) } catch {
      sendJson(response, 503, { error: 'Password reset is not configured on this server.' })
      return
    }
    const now = Date.now()
    database.prepare(`INSERT INTO password_resets (user_id, pin_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(user_id) DO UPDATE SET pin_hash=excluded.pin_hash, expires_at=excluded.expires_at, attempts=0, sent_at=excluded.sent_at`)
      .run(user.id, hashedPin, now + resetLifetime, now)
    try {
      await mailConfig.transport.sendMail({
        from: mailConfig.from,
        to: user.email,
        subject: 'Your DevSecOps Copilot password reset PIN',
        text: `Hello ${user.username},\n\nYour password reset PIN is ${pin}. It expires in 10 minutes and can only be used once. If you did not request this, you can ignore this email.`,
      })
      sendJson(response, 200, { message: genericMessage })
    } catch {
      database.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id)
      sendJson(response, 502, { error: 'Could not send the reset email. Check the email server settings and try again.' })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/password-reset/confirm') {
    let input
    try { input = await readJson(request) } catch {
      sendJson(response, 400, { error: 'Enter your email, 4-digit PIN, and new password.' })
      return
    }
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
    const pin = typeof input.pin === 'string' ? input.pin.trim() : ''
    const password = typeof input.password === 'string' ? input.password : ''
    if (!validEmail(email) || !/^\d{4}$/.test(pin) || password.length < 8 || password.length > 128) {
      sendJson(response, 400, { error: 'Enter a valid email, 4-digit PIN, and password of at least 8 characters.' })
      return
    }
    const user = database.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email)
    const reset = user ? database.prepare('SELECT pin_hash, expires_at, attempts FROM password_resets WHERE user_id = ?').get(user.id) : null
    if (!user || !reset || reset.expires_at <= Date.now() || reset.attempts >= maxResetAttempts) {
      if (user) database.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id)
      sendJson(response, 400, { error: 'That PIN is invalid or expired. Request a new one.' })
      return
    }
    const nextAttempt = reset.attempts + 1
    database.prepare('UPDATE password_resets SET attempts = ? WHERE user_id = ?').run(nextAttempt, user.id)
    let expectedPin
    try { expectedPin = pinHash(user.id, pin) } catch {
      sendJson(response, 503, { error: 'Password reset is not configured on this server.' })
      return
    }
    if (!hashesMatch(expectedPin, reset.pin_hash)) {
      if (nextAttempt >= maxResetAttempts) database.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id)
      sendJson(response, 400, { error: 'That PIN is invalid or expired. Request a new one.' })
      return
    }
    database.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id)
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = await passwordHash(password, salt)
    database.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, user.id)
    for (const [id, session] of sessions) {
      if (session.accountId === user.id) sessions.delete(id)
    }
    sendJson(response, 200, { message: 'Password reset complete. Sign in with your new password.' })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/users') {
    const session = getSession(request)
    if (!session) {
      sendJson(response, 401, { error: 'Sign in to view user profiles.' })
      return
    }
    const rows = database.prepare('SELECT id, username, email, groups, role FROM users ORDER BY username COLLATE NOCASE').all()
    sendJson(response, 200, {
      users: rows.map((row) => ({ id: row.id, username: row.username, email: row.email, groups: parseUserGroups(row.groups), role: row.role || 'reader' })),
    })
    return
  }

  if (request.method === 'POST' && url.pathname.startsWith('/api/users/') && url.pathname.endsWith('/role')) {
    const session = getSession(request)
    if (!session) {
      sendJson(response, 401, { error: 'Sign in to manage user roles.' })
      return
    }
    const targetId = url.pathname.split('/')[2]
    let input
    try { input = await readJson(request) } catch {
      sendJson(response, 400, { error: 'Provide a role value.' })
      return
    }
    const role = typeof input.role === 'string' ? input.role.trim().toLowerCase() : ''
    if (!['reader', 'admin'].includes(role)) {
      sendJson(response, 400, { error: 'Role must be reader or admin.' })
      return
    }
    const target = database.prepare('SELECT id FROM users WHERE id = ?').get(targetId)
    if (!target) {
      sendJson(response, 404, { error: 'User not found.' })
      return
    }
    database.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId)
    sendJson(response, 200, { success: true, role })
    return
  }

  if (request.method === 'POST' && url.pathname.startsWith('/api/users/') && url.pathname.endsWith('/username')) {
    const session = getSession(request)
    if (!session) {
      sendJson(response, 401, { error: 'Sign in to update user names.' })
      return
    }
    const targetId = url.pathname.split('/')[2]
    let input
    try { input = await readJson(request) } catch {
      sendJson(response, 400, { error: 'Provide a new username.' })
      return
    }
    const username = typeof input.username === 'string' ? input.username.trim() : ''
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
      sendJson(response, 400, { error: 'Username must be 3–32 characters using letters, numbers, dots, underscores, or hyphens.' })
      return
    }
    const target = database.prepare('SELECT id FROM users WHERE id = ?').get(targetId)
    if (!target) {
      sendJson(response, 404, { error: 'User not found.' })
      return
    }
    try {
      database.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, targetId)
      sendJson(response, 200, { success: true, username })
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) {
        sendJson(response, 409, { error: 'That username is already registered.' })
      } else {
        sendJson(response, 500, { error: 'Could not update this username.' })
      }
    }
    return
  }

  if (request.method === 'POST' && url.pathname.startsWith('/api/users/') && url.pathname.endsWith('/reset-password')) {
    const session = getSession(request)
    if (!session) {
      sendJson(response, 401, { error: 'Sign in to reset a password.' })
      return
    }
    const targetId = url.pathname.split('/')[2]
    let input
    try { input = await readJson(request) } catch {
      sendJson(response, 400, { error: 'Provide a new password.' })
      return
    }
    const password = typeof input.password === 'string' ? input.password : ''
    if (password.length < 8 || password.length > 128) {
      sendJson(response, 400, { error: 'Password must be between 8 and 128 characters.' })
      return
    }
    const target = database.prepare('SELECT id FROM users WHERE id = ?').get(targetId)
    if (!target) {
      sendJson(response, 404, { error: 'User not found.' })
      return
    }
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = await passwordHash(password, salt)
    database.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, targetId)
    sendJson(response, 200, { success: true })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    const id = cookiesFrom(request)[sessionCookie]
    if (id) sessions.delete(id)
    clearSessionCookie(response)
    response.writeHead(204, { 'Cache-Control': 'no-store' })
    response.end()
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/github/connect') {
    const sessionId = cookiesFrom(request)[sessionCookie]
    const session = getSession(request)
    const registeredAccount = session?.accountId
      ? database.prepare('SELECT id FROM users WHERE id = ?').get(session.accountId)
      : null
    if (!sessionId || !session || !registeredAccount) {
      sendJson(response, 401, { error: 'Create an account and sign in before connecting GitHub.' })
      return
    }
    let input
    try { input = await readJson(request) } catch {
      sendJson(response, 400, { error: 'Provide a GitHub personal access token.' })
      return
    }
    const token = typeof input.token === 'string' ? input.token.trim() : ''
    if (!token || token.length > 512 || !/^(github_pat_|ghp_)[A-Za-z0-9_]+$/.test(token)) {
      sendJson(response, 400, { error: 'That does not look like a GitHub personal access token.' })
      return
    }
    try {
      const { response: githubResponse, body: profile } = await githubRequest(token, '/user')
      if (githubResponse.status === 401) {
        sendJson(response, 401, { error: 'GitHub rejected this token. Check it and try again.' })
        return
      }
      if (!githubResponse.ok || !profile?.id || !profile?.login) {
        sendJson(response, githubResponse.status || 502, { error: 'GitHub could not verify this account.' })
        return
      }
      saveProviderCredential(session.accountId, 'github', token, {
        profile: { id: profile.id, login: profile.login, name: profile.name || profile.login, avatarUrl: profile.avatar_url },
      })
      session.token = token
      session.githubUser = { id: profile.id, login: profile.login, name: profile.name || profile.login, avatarUrl: profile.avatar_url }
      session.expiresAt = Date.now() + sessionLifetime
      sessions.set(sessionId, session)
      setSessionCookie(response, sessionId)
      sendJson(response, 200, { githubUser: session.githubUser })
    } catch (error) {
      sendJson(response, 502, { error: error instanceof Error && error.name === 'TimeoutError' ? 'GitHub did not respond in time. Try again.' : 'Could not reach GitHub to verify this token.' })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/azure/connect') {
    const sessionId = cookiesFrom(request)[sessionCookie]
    const session = getSession(request)
    const registeredAccount = session?.accountId
      ? database.prepare('SELECT id FROM users WHERE id = ?').get(session.accountId)
      : null
    if (!sessionId || !session || !registeredAccount) {
      sendJson(response, 401, { error: 'Sign in to DevSecOps Copilot before connecting Azure DevOps.' })
      return
    }
    let input
    try { input = await readJson(request) } catch {
      sendJson(response, 400, { error: 'Enter your Azure DevOps organization and personal access token.' })
      return
    }
    const organization = typeof input.organization === 'string' ? input.organization.trim() : ''
    const token = typeof input.token === 'string' ? input.token.trim() : ''
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(organization)) {
      sendJson(response, 400, { error: 'Enter a valid Azure DevOps organization name.' })
      return
    }
    if (token.length < 20 || token.length > 256 || /\s/.test(token)) {
      sendJson(response, 400, { error: 'Enter a valid Azure DevOps personal access token.' })
      return
    }
    try {
      const { response: projectsResponse, body } = await azureRequest(token, organization, '/_apis/projects?$top=1&api-version=7.1')
      if (projectsResponse.status === 401 || projectsResponse.status === 203) {
        sendJson(response, 401, { error: 'Azure DevOps rejected this PAT or organization. Check both and try again.' })
        return
      }
      if (!projectsResponse.ok || !Array.isArray(body?.value)) {
        sendJson(response, projectsResponse.status || 502, { error: body?.message || 'Could not verify access to this Azure DevOps organization.' })
        return
      }
      let reviewerId
      try {
        const { response: profileResponse, body: profile } = await azureRequest(token, organization, '/_apis/connectionData?connectOptions=1&lastChangeId=-1&lastChangeId64=-1&api-version=7.1-preview.1')
        if (profileResponse.ok && /^[\da-f-]{36}$/i.test(profile?.authenticatedUser?.id || '')) reviewerId = profile.authenticatedUser.id
      } catch {
        reviewerId = undefined
      }
      saveProviderCredential(session.accountId, 'azure', token, { organization, reviewerId })
      session.azureDevOps = { token, organization, reviewerId }
      session.expiresAt = Date.now() + sessionLifetime
      sessions.set(sessionId, session)
      setSessionCookie(response, sessionId)
      sendJson(response, 200, { organization, projectCount: body.count ?? body.value.length })
    } catch (error) {
      sendJson(response, 502, { error: error instanceof Error && error.name === 'TimeoutError' ? 'Azure DevOps did not respond in time.' : 'Could not reach Azure DevOps to verify this token.' })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/azure/disconnect') {
    const session = getSession(request)
    if (!session?.azureDevOps) {
      sendJson(response, 401, { error: 'Azure DevOps is not connected.' })
      return
    }
    database.prepare('DELETE FROM provider_credentials WHERE account_id = ? AND provider = ?').run(session.accountId, 'azure')
    delete session.azureDevOps
    sendJson(response, 200, { connected: false })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/azure/data') {
    const session = getSession(request)
    if (!session?.azureDevOps) {
      sendJson(response, 401, { error: 'Azure DevOps is not connected. Connect an organization and PAT.' })
      return
    }
    try {
      const data = await syncAzureData(session.azureDevOps.token, session.azureDevOps.organization)
      if (data.error) {
        sendJson(response, data.status, { error: data.error })
        return
      }
      sendJson(response, 200, { ...data })
    } catch (error) {
      sendJson(response, 502, { error: error instanceof Error && error.name === 'TimeoutError' ? 'Azure DevOps took too long to return repository data.' : 'Could not load live data from Azure DevOps.' })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/azure/review') {
    const session = getSession(request)
    if (!session?.azureDevOps) {
      sendJson(response, 401, { error: 'Azure DevOps is not connected.' })
      return
    }
    let input
    try { input = await readJson(request) } catch {
      sendJson(response, 400, { error: 'Provide the Azure project, repository, pull request, and decision.' })
      return
    }
    const projectId = typeof input.projectId === 'string' ? input.projectId : ''
    const repositoryId = typeof input.repositoryId === 'string' ? input.repositoryId : ''
    const pullRequestId = Number(input.pullRequestId)
    const vote = input.decision === 'Approved' ? 10 : input.decision === 'Changes requested' ? -10 : null
    if (!/^[\da-f-]{36}$/i.test(projectId) || !/^[\da-f-]{36}$/i.test(repositoryId) || !Number.isSafeInteger(pullRequestId) || pullRequestId < 1 || vote === null) {
      sendJson(response, 400, { error: 'Invalid Azure DevOps pull request review details.' })
      return
    }
    if (!session.azureDevOps.reviewerId) {
      sendJson(response, 403, { error: 'This Azure DevOps connection cannot identify a reviewer. Reconnect with Code: Read & write permission.' })
      return
    }
    try {
      const path = `/${encodeURIComponent(projectId)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullRequests/${pullRequestId}/reviewers/${encodeURIComponent(session.azureDevOps.reviewerId)}?api-version=7.1`
      const { response: reviewResponse, body } = await azureRequest(session.azureDevOps.token, session.azureDevOps.organization, path, {
        method: 'PUT',
        body: JSON.stringify({ vote }),
      })
      if (!reviewResponse.ok) {
        sendJson(response, reviewResponse.status, { error: body?.message || `Azure DevOps rejected the review (${reviewResponse.status}).` })
        return
      }
      sendJson(response, 200, { ok: true, vote: body?.vote ?? vote })
    } catch (error) {
      sendJson(response, 502, { error: error instanceof Error && error.name === 'TimeoutError' ? 'Azure DevOps did not respond in time.' : 'Could not send this review to Azure DevOps.' })
    }
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/session') {
    const session = getSession(request)
    if (!session) {
      clearSessionCookie(response)
      sendJson(response, 200, { user: null })
      return
    }
    sendJson(response, 200, { user: session.user, githubConnected: Boolean(session.token), azureConnected: Boolean(session.azureDevOps), azureOrganization: session.azureDevOps?.organization || null })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/github/disconnect') {
    const id = cookiesFrom(request)[sessionCookie]
    const session = id ? getSession(request) : null
    if (session) {
      database.prepare('DELETE FROM provider_credentials WHERE account_id = ? AND provider = ?').run(session.accountId, 'github')
      delete session.token
      delete session.githubUser
      sessions.set(id, session)
    } else if (id) {
      sessions.delete(id)
      clearSessionCookie(response)
    }
    response.writeHead(204, { 'Cache-Control': 'no-store' })
    response.end()
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/github/review') {
    const session = getSession(request)
    if (!session) {
      sendJson(response, 401, { error: 'GitHub session expired. Connect your account again.' })
      return
    }
    let input
    try { input = await readJson(request) } catch {
      sendJson(response, 400, { error: 'Provide a repository, pull request number, and decision.' })
      return
    }
    const repository = typeof input.repository === 'string' ? input.repository : ''
    const pullNumber = Number(input.pullNumber)
    const event = input.decision === 'Approved' ? 'APPROVE' : input.decision === 'Changes requested' ? 'REQUEST_CHANGES' : ''
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !Number.isSafeInteger(pullNumber) || pullNumber < 1 || !event) {
      sendJson(response, 400, { error: 'Invalid pull request review details.' })
      return
    }
    try {
      const { response: githubResponse, body } = await githubRequest(session.token, `/repos/${repository.split('/').map(encodeURIComponent).join('/')}/pulls/${pullNumber}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event }),
      })
      if (!githubResponse.ok) {
        sendJson(response, githubResponse.status, { error: body?.message || `GitHub rejected the review (${githubResponse.status}).` })
        return
      }
      sendJson(response, 200, { ok: true, state: body?.state || event.toLowerCase() })
    } catch (error) {
      sendJson(response, 502, { error: error instanceof Error && error.name === 'TimeoutError' ? 'GitHub did not respond in time.' : 'Could not send this review to GitHub.' })
    }
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/github/data') {
    const session = getSession(request)
    if (!session) {
      sendJson(response, 401, { error: 'GitHub session expired. Connect your account again.' })
      return
    }
    try {
      const data = await syncGitHubData(session.token)
      if (data.error) {
        if (data.status === 401) {
          sessions.delete(cookiesFrom(request)[sessionCookie])
          clearSessionCookie(response)
        }
        sendJson(response, data.status, { error: data.error })
        return
      }
      sendJson(response, 200, { user: session.user, ...data })
    } catch (error) {
      sendJson(response, 502, { error: error instanceof Error && error.name === 'TimeoutError' ? 'GitHub took too long to return repository data.' : 'Could not load live data from GitHub.' })
    }
    return
  }

  sendJson(response, 404, { error: 'Not found' })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`GitHub API proxy listening on http://127.0.0.1:${port}`)
})
