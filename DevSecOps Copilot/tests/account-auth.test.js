import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

let smtpServer
let azureMockServer
let apiProcess
let temporaryDirectory
let apiPort
let smtpPort
let azureMockPort
const deliveredMessages = []

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(server.address().port)
    })
  })
}

function createMockSmtp() {
  return net.createServer((socket) => {
    socket.setEncoding('utf8')
    socket.write('220 local test mail server\r\n')
    let buffer = ''
    let inMessage = false
    let authStep = 0
    const message = []

    socket.on('data', (chunk) => {
      buffer += chunk
      let boundary = buffer.indexOf('\r\n')
      while (boundary >= 0) {
        const line = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        if (inMessage) {
          if (line === '.') {
            inMessage = false
            deliveredMessages.push(message.join('\n'))
            message.length = 0
            socket.write('250 queued\r\n')
          } else {
            message.push(line.startsWith('..') ? line.slice(1) : line)
          }
        } else if (/^(EHLO|HELO)\b/i.test(line)) {
          socket.write('250-local test mail server\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 1000000\r\n')
        } else if (/^AUTH LOGIN\b/i.test(line)) {
          socket.write('334 VXNlcm5hbWU6\r\n')
          authStep = 1
        } else if (/^AUTH PLAIN\s+\S+/i.test(line)) {
          socket.write('235 authenticated\r\n')
        } else if (/^AUTH PLAIN/i.test(line)) {
          socket.write('334 \r\n')
          authStep = 3
        } else if (authStep === 1) {
          socket.write('334 UGFzc3dvcmQ6\r\n')
          authStep = 2
        } else if (authStep === 2 || authStep === 3) {
          socket.write('235 authenticated\r\n')
          authStep = 0
        } else if (/^(MAIL FROM|RCPT TO|RSET)\b/i.test(line)) {
          socket.write('250 accepted\r\n')
        } else if (/^DATA\b/i.test(line)) {
          inMessage = true
          socket.write('354 send message\r\n')
        } else if (/^QUIT\b/i.test(line)) {
          socket.write('221 closing connection\r\n')
          socket.end()
        } else {
          socket.write('250 ok\r\n')
        }
        boundary = buffer.indexOf('\r\n')
      }
    })
  })
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}

function createAzureMock() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost')
    const authorization = request.headers.authorization || ''
    if (url.pathname.startsWith('/test-org/')) {
      const auth = Buffer.from(authorization.replace(/^Basic\s+/i, ''), 'base64').toString()
      if (auth !== ':synthetic-azure-pat-token') {
        sendJson(response, 401, { message: 'Unauthorized' })
        return
      }
    } else if (authorization !== 'Bearer ghp_syntheticgithubpatvalue123456') {
      sendJson(response, 401, { message: 'Unauthorized' })
      return
    }
    if (url.pathname === '/user') {
      sendJson(response, 200, { id: 88, login: 'connected-github', name: 'Connected GitHub' })
      return
    }
    if (url.pathname === '/user/repos') {
      sendJson(response, 200, [{ id: 99, name: 'smoke-repo', full_name: 'connected-github/smoke-repo', owner: { login: 'connected-github' }, html_url: 'https://github.com/connected-github/smoke-repo', private: true, language: 'TypeScript', updated_at: '2026-11-03T08:00:00Z', default_branch: 'main', archived: false }])
      return
    }
    if (/^\/repos\/connected-github\/smoke-repo\/(code-scanning|dependabot|secret-scanning)\/alerts$/.test(url.pathname)) {
      sendJson(response, 200, [])
      return
    }
    if (url.pathname === '/repos/connected-github/smoke-repo/pulls') {
      sendJson(response, 200, [{ id: 901, number: 7, title: 'Persist GitHub connection', html_url: 'https://github.com/connected-github/smoke-repo/pull/7', user: { login: 'author' }, head: { ref: 'feature/persistence' }, created_at: '2026-11-03T08:00:00Z', draft: false }])
      return
    }
    if (url.pathname === '/test-org/_apis/projects') {
      if (request.method === 'GET') {
        sendJson(response, 200, { count: 1, value: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Platform', state: 'wellFormed' }] })
        return
      }
    }
    if (url.pathname === '/test-org/_apis/connectionData') {
      sendJson(response, 200, { authenticatedUser: { id: '33333333-3333-4333-8333-333333333333' } })
      return
    }
    if (url.pathname === '/test-org/11111111-1111-4111-8111-111111111111/_apis/git/repositories') {
      sendJson(response, 200, { value: [{ id: '22222222-2222-4222-8222-222222222222', name: 'azure-api', defaultBranch: 'refs/heads/main', webUrl: 'https://dev.azure.com/test-org/Platform/_git/azure-api', isDisabled: false }] })
      return
    }
    if (url.pathname === '/test-org/11111111-1111-4111-8111-111111111111/_apis/git/repositories/22222222-2222-4222-8222-222222222222/pullrequests') {
      sendJson(response, 200, { value: [{ pullRequestId: 17, title: 'Add Azure endpoint', status: 'active', sourceRefName: 'refs/heads/feature/endpoint', creationDate: '2026-11-03T08:00:00Z', createdBy: { displayName: 'Azure Dev' }, _links: { web: { href: 'https://dev.azure.com/test-org/Platform/_git/azure-api/pullrequest/17' } } }] })
      return
    }
    if (request.method === 'PUT' && url.pathname.endsWith('/reviewers/33333333-3333-4333-8333-333333333333')) {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => sendJson(response, 200, JSON.parse(body)))
      return
    }
    sendJson(response, 404, { message: `Unhandled mock path: ${url.pathname}` })
  })
}

function startApi() {
  apiProcess = spawn(process.execPath, ['server/api.js'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    env: {
      ...process.env,
      API_PORT: String(apiPort),
      DATABASE_PATH: join(temporaryDirectory, 'accounts.sqlite'),
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtpPort),
      SMTP_SECURE: 'false',
      SMTP_USER: 'test-user',
      SMTP_PASSWORD: 'test-password',
      SMTP_FROM: 'DevSecOps Copilot <no-reply@example.test>',
      RESET_PIN_SECRET: 'test-reset-pin-secret-0123456789-abcdefgh',
      AZURE_DEVOPS_API_BASE_URL: `http://127.0.0.1:${azureMockPort}`,
      GITHUB_API_BASE_URL: `http://127.0.0.1:${azureMockPort}`,
      PROVIDER_TOKEN_KEY_PATH: join(temporaryDirectory, 'provider-token.key'),
    },
  })
}

async function waitForApi() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/session`)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw new Error('Test API did not start')
}

async function post(path, body, cookie) {
  return fetch(`http://127.0.0.1:${apiPort}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function stopApi() {
  if (!apiProcess || apiProcess.exitCode !== null) return
  await new Promise((resolve) => {
    apiProcess.once('exit', resolve)
    apiProcess.kill()
  })
  apiProcess = null
}

test('accounts, email PIN reset, Azure DevOps PAT data, votes, and SQLite persistence', async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'devsecops-auth-test-'))
  smtpServer = createMockSmtp()
  smtpPort = await listen(smtpServer)
  azureMockServer = createAzureMock()
  azureMockPort = await listen(azureMockServer)
  const portProbe = net.createServer()
  apiPort = await listen(portProbe)
  await new Promise((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()))
  startApi()
  await waitForApi()

  const account = { username: 'auth_test_user', email: 'auth-test@example.test', password: 'InitialPassword123!' }
  const signup = await post('/api/auth/signup', account)
  assert.equal(signup.status, 201)
  assert.equal((await signup.json()).message, 'Account is created successfully')
  assert.equal(signup.headers.get('set-cookie'), null)
  const signedOutSession = await fetch(`http://127.0.0.1:${apiPort}/api/session`)
  assert.equal((await signedOutSession.json()).user, null)

  const duplicate = await post('/api/auth/signup', account)
  assert.equal(duplicate.status, 409)
  const unknownAccount = await post('/api/auth/login', { username: 'not_registered', password: 'SomePassword123!' })
  assert.equal(unknownAccount.status, 401)
  assert.equal(unknownAccount.headers.get('set-cookie'), null)
  const wrongPassword = await post('/api/auth/login', { username: account.username, password: 'WrongPassword123!' })
  assert.equal(wrongPassword.status, 401)
  const providerOnlyAttempt = await post('/api/github/connect', { token: 'ghp_syntheticpatvalue1234567890' })
  assert.equal(providerOnlyAttempt.status, 401)
  assert.equal(providerOnlyAttempt.headers.get('set-cookie'), null)
  const providerDataWithoutAccount = await fetch(`http://127.0.0.1:${apiPort}/api/github/data`)
  assert.equal(providerDataWithoutAccount.status, 401)
  const correctPassword = await post('/api/auth/login', { username: account.username, password: account.password })
  assert.equal(correctPassword.status, 200)
  const sessionCookie = correctPassword.headers.get('set-cookie').split(';')[0]
  assert.match(correctPassword.headers.get('set-cookie'), /HttpOnly/i)
  const session = await fetch(`http://127.0.0.1:${apiPort}/api/session`, { headers: { Cookie: sessionCookie } })
  const loggedInSession = await session.json()
  assert.equal(loggedInSession.user.username, account.username)

  const azureConnect = await post('/api/azure/connect', { organization: 'test-org', token: 'synthetic-azure-pat-token' }, sessionCookie)
  assert.equal(azureConnect.status, 200)
  assert.equal((await azureConnect.json()).organization, 'test-org')
  const combinedSession = await fetch(`http://127.0.0.1:${apiPort}/api/session`, { headers: { Cookie: sessionCookie } })
  assert.deepEqual(await combinedSession.json(), { user: { id: loggedInSession.user.id, username: account.username, name: account.username, login: account.username }, githubConnected: false, azureConnected: true, azureOrganization: 'test-org' })
  const azureDataResponse = await fetch(`http://127.0.0.1:${apiPort}/api/azure/data`, { headers: { Cookie: sessionCookie } })
  assert.equal(azureDataResponse.status, 200)
  const azureData = await azureDataResponse.json()
  assert.equal(azureData.totalRepositoryCount, 1)
  assert.equal(azureData.repos[0].name, 'azure-api')
  assert.equal(azureData.pullRequests[0].title, 'Add Azure endpoint')
  assert.equal(JSON.stringify(azureData).includes('synthetic-azure-pat-token'), false)
  const azureReview = await post('/api/azure/review', { projectId: '11111111-1111-4111-8111-111111111111', repositoryId: '22222222-2222-4222-8222-222222222222', pullRequestId: 17, decision: 'Approved' }, sessionCookie)
  assert.equal(azureReview.status, 200)
  assert.equal((await azureReview.json()).vote, 10)

  const githubConnect = await post('/api/github/connect', { token: 'ghp_syntheticgithubpatvalue123456' }, sessionCookie)
  assert.equal(githubConnect.status, 200)
  assert.equal((await githubConnect.json()).githubUser.login, 'connected-github')
  const bothProvidersSession = await fetch(`http://127.0.0.1:${apiPort}/api/session`, { headers: { Cookie: sessionCookie } })
  assert.deepEqual(await bothProvidersSession.json(), { user: { id: loggedInSession.user.id, username: account.username, name: account.username, login: account.username }, githubConnected: true, azureConnected: true, azureOrganization: 'test-org' })
  const githubDataResponse = await fetch(`http://127.0.0.1:${apiPort}/api/github/data`, { headers: { Cookie: sessionCookie } })
  assert.equal(githubDataResponse.status, 200)
  const githubData = await githubDataResponse.json()
  assert.equal(githubData.repos[0].name, 'smoke-repo')
  assert.equal(githubData.pullRequests[0].title, 'Persist GitHub connection')

  const resetRequest = await post('/api/auth/password-reset/request', { email: account.email })
  assert.equal(resetRequest.status, 200)
  assert.match((await resetRequest.json()).message, /If an account exists/)
  assert.equal(deliveredMessages.length, 1)
  const deliveredPin = deliveredMessages[0].match(/reset PIN is (\d{4})/i)?.[1]
  assert.ok(deliveredPin, 'email should contain a 4-digit PIN')

  const reset = await post('/api/auth/password-reset/confirm', { email: account.email, pin: deliveredPin, password: 'UpdatedPassword456!' })
  assert.equal(reset.status, 200)
  const oldPassword = await post('/api/auth/login', { username: account.username, password: account.password })
  assert.equal(oldPassword.status, 401)
  const newPassword = await post('/api/auth/login', { username: account.username, password: 'UpdatedPassword456!' })
  assert.equal(newPassword.status, 200)
  const pinReuse = await post('/api/auth/password-reset/confirm', { email: account.email, pin: deliveredPin, password: 'AnotherPassword789!' })
  assert.equal(pinReuse.status, 400)

  await stopApi()
  startApi()
  await waitForApi()
  const persistedLogin = await post('/api/auth/login', { username: account.username, password: 'UpdatedPassword456!' })
  assert.equal(persistedLogin.status, 200)
  const persistedCookie = persistedLogin.headers.get('set-cookie').split(';')[0]
  const restoredProviders = await fetch(`http://127.0.0.1:${apiPort}/api/session`, { headers: { Cookie: persistedCookie } })
  assert.deepEqual(await restoredProviders.json(), { user: { id: loggedInSession.user.id, username: account.username, name: account.username, login: account.username }, githubConnected: true, azureConnected: true, azureOrganization: 'test-org' })
  const restoredAzureData = await fetch(`http://127.0.0.1:${apiPort}/api/azure/data`, { headers: { Cookie: persistedCookie } })
  assert.equal((await restoredAzureData.json()).repos[0].name, 'azure-api')
  const restoredGithubData = await fetch(`http://127.0.0.1:${apiPort}/api/github/data`, { headers: { Cookie: persistedCookie } })
  assert.equal((await restoredGithubData.json()).repos[0].name, 'smoke-repo')
  await stopApi()
  const credentialDb = new DatabaseSync(join(temporaryDirectory, 'accounts.sqlite'), { readOnly: true })
  const savedCredentials = credentialDb.prepare('SELECT provider, encrypted_token FROM provider_credentials ORDER BY provider').all()
  credentialDb.close()
  assert.deepEqual(savedCredentials.map((credential) => credential.provider), ['azure', 'github'])
  assert.equal(savedCredentials.some((credential) => credential.encrypted_token.includes('synthetic')), false)
})

after(async () => {
  await stopApi()
  if (smtpServer?.listening) await new Promise((resolve) => smtpServer.close(resolve))
  if (azureMockServer?.listening) await new Promise((resolve) => azureMockServer.close(resolve))
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})
