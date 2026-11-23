// Tucano Auto on the built app with the real engines: no simulator, and every request costs money.
// Three requests go through the Tuca: one he answers himself, one for one specialist, and one with two
// independent parts for two specialists. Build first, then run it by hand:
//   npm run build && node scripts/e2e-tuca-auto-real.mjs [outdir]
// It is not part of `npm test`. The data folder is kept when the run fails, so the db can be read.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const repo = fileURLToPath(new URL('..', import.meta.url))
const output = resolve(process.argv[2] ?? join(repo, '.tucano-local/audit/e2e-tuca-auto-real'))
const deadline = Date.now() + 15 * 60_000 // the whole run, from the first launch to the last screenshot
const SETTLE_MS = 240_000 // one request, from sending it to its delivery
// What a run is still doing: the Tuca's reply, or a question or approval that holds it.
const UNFINISHED = new Set(['working', 'waiting_approval', 'waiting_input'])
// The seeded team (src/core/seed.ts): Lia does engineering, Theo data, Nina content.
const REQUESTS = [
  { key: 'r1', expect: 'answers', text: 'Oi! Em uma frase, o que você faz por mim aqui?' },
  { key: 'r2', expect: 'one', text: 'Escreve um post curto para o Instagram anunciando o cardápio de sábado, no meu tom.' },
  { key: 'r3', expect: 'two', text: 'Duas coisas independentes, cada uma para quem entende: (a) uma função em JavaScript que soma uma lista de números; (b) quanto dá 120 clientes crescendo 8% ao mês por 6 meses.' }
]

const sleep = (ms) => new Promise((yes) => setTimeout(yes, ms))
const clip = (text, n = 300) => (text ?? '').slice(0, n)

// The app binds the webhook port and webhook + 100 (the MCP port), so both are held with the git
// port until just before launch. Loopback only, like the app.
const hold = (port = 0) =>
  new Promise((yes, no) => {
    const server = createServer()
    server.once('error', no)
    server.listen(port, '127.0.0.1', () => yes({ server, port: server.address().port }))
  })
const release = (held) => Promise.all(held.map(({ server }) => new Promise((yes) => server.close(() => yes()))))
async function reservePorts() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const webhook = await hold()
    if (webhook.port + 100 > 65535) {
      await release([webhook])
      continue
    }
    const mcp = await hold(webhook.port + 100).catch(() => undefined)
    if (!mcp) {
      await release([webhook])
      continue
    }
    const git = await hold()
    return { held: [webhook, mcp, git], webhook: webhook.port, git: git.port }
  }
  throw new Error('could not reserve the webhook, MCP and git ports')
}

// The app keeps everything in one sqlite file. It is opened only once it exists: opening a missing
// path would create an empty db, and the app would take it for its own and skip the seed.
let dbFile
let ids
function withDb(run) {
  const db = new DatabaseSync(dbFile)
  try {
    db.exec('PRAGMA busy_timeout = 5000') // the app may be writing at the same moment
    return run(db)
  } finally {
    db.close()
  }
}
function readIds() {
  if (!existsSync(dbFile)) return undefined
  return withDb((db) => {
    const tuca = db.prepare("SELECT id FROM agents WHERE kind = 'tuca' AND archived = 0").get()
    const dm = tuca && db.prepare("SELECT id FROM conversations WHERE kind = 'dm' AND name = ?").get(tuca.id)
    if (!tuca || !dm) return undefined
    const agents = db.prepare('SELECT id, name, handle FROM agents').all()
    return {
      tuca: tuca.id,
      dm: dm.id,
      names: new Map(agents.map((a) => [a.id, a.name])),
      seeded: agents.filter((a) => ['lia', 'theo', 'nina'].includes(a.handle)).map((a) => a.name)
    }
  })
}

// The Tuca's replies and the delegations he made since the request was sent. Settled means: no reply
// of his is still running, nothing he handed out is open, and the work that came back has been
// delivered. A delivery is a reply of his that did not hand work on.
function snapshot(sentAt) {
  const since = sentAt - 500 // clock slack: messages are stamped by the core, the send time comes from here
  return withDb((db) => {
    const msgs = db
      .prepare("SELECT id, text, at, json_extract(run, '$.status') AS status, json_extract(run, '$.error') AS error FROM messages WHERE conversation_id = ? AND author_id = ? AND at >= ? ORDER BY at")
      .all(ids.dm, ids.tuca, since)
    const dels = db
      .prepare('SELECT id, to_agent AS toAgent, origin_message_id AS origin, state, text, result, created_at AS createdAt, ended_at AS endedAt FROM delegations WHERE from_agent = ? AND created_at >= ? ORDER BY created_at')
      .all(ids.tuca, since)
    const handing = new Set(dels.map((d) => d.origin))
    const deliveries = msgs.filter((m) => !handing.has(m.id))
    // Done or failed work is delivered; a cancelled one is not.
    const ended = dels.filter((d) => d.state === 'done' || d.state === 'failed')
    const lastEnd = Math.max(0, ...ended.map((d) => d.endedAt ?? 0))
    const settled =
      msgs.length > 0 &&
      !msgs.some((m) => UNFINISHED.has(m.status)) &&
      !dels.some((d) => d.state === 'open') &&
      (ended.length === 0 || deliveries.some((m) => m.at >= lastEnd))
    return { settled, msgs, dels, deliveries }
  })
}

// Two looks, two seconds apart, both settled: a delivery that is about to start is not missed.
async function settle(request, sentAt) {
  const until = Math.min(Date.now() + SETTLE_MS, deadline)
  let calm = 0
  for (;;) {
    const s = snapshot(sentAt)
    calm = s.settled ? calm + 1 : 0
    if (calm >= 2) return s
    if (Date.now() >= until) {
      const states = { replies: s.msgs.map((m) => m.status ?? null), delegations: s.dels.map((d) => d.state) }
      throw new Error(`${request.key} did not settle within ${SETTLE_MS / 1000} s (or the 15-minute cap): ${JSON.stringify(states)}`)
    }
    await sleep(2000)
  }
}

async function waitFor(label, read, ms = 90_000) {
  const until = Math.min(Date.now() + ms, deadline)
  while (Date.now() < until) {
    const value = read()
    if (value) return value
    await sleep(1000)
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function waitForAuto(page) {
  await page.locator('.auto-composer textarea').waitFor({ timeout: 60_000 })
  await page.locator('.auto-opening').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
}

async function namesInChat(page) {
  const text = await page.locator('.auto-chat').innerText().catch(() => '')
  return ids.seeded.filter((name) => new RegExp(`\\b${name}\\b`).test(text))
}

function describe(request, s, durationMs) {
  const handing = new Set(s.dels.map((d) => d.origin))
  return {
    key: request.key,
    text: request.text,
    durationMs,
    delegations: s.dels.map((d) => ({ id: d.id, to: ids.names.get(d.toAgent) ?? d.toAgent, state: d.state, origin: d.origin, text: clip(d.text) })),
    deliveries: s.deliveries.length,
    delivery: clip(s.deliveries.find((m) => m.text.trim())?.text),
    replies: s.msgs.map((m) => ({ id: m.id, status: m.status ?? null, error: m.error ?? null, handing: handing.has(m.id), text: clip(m.text) }))
  }
}

// What each request must show. Failures are collected, so the later requests still run and report.
function judge(request, s) {
  const failures = []
  const { dels, deliveries, msgs } = s
  const handed = (n) => `${request.key}: ${n} delegation(s)`
  if (request.expect === 'answers') {
    if (dels.length) failures.push(`${handed(dels.length)}, expected none: the Tuca should answer himself`)
    if (!deliveries.some((m) => m.text.trim())) failures.push(`${request.key}: no answer text`)
  }
  if (request.expect === 'one') {
    if (dels.length !== 1) failures.push(`${handed(dels.length)}, expected exactly 1`)
    else if (dels[0].state !== 'done') failures.push(`${request.key}: the delegation is ${dels[0].state}, expected done`)
    if (deliveries.length !== 1) failures.push(`${request.key}: ${deliveries.length} deliveries, expected 1`)
    else if (!deliveries[0].text.trim()) failures.push(`${request.key}: the delivery is empty`)
  }
  if (request.expect === 'two') {
    const byOrigin = new Map()
    for (const d of dels) byOrigin.set(d.origin, [...(byOrigin.get(d.origin) ?? []), d])
    const shared = [...byOrigin.values()].find((group) => group.length >= 2)
    if (!shared) failures.push(`${request.key}: no two delegations share one origin message`)
    if (dels.length < 2 || dels.some((d) => d.state !== 'done')) failures.push(`${request.key}: ${dels.length} delegation(s), states ${dels.map((d) => d.state).join(', ')}; expected at least 2, all done`)
    if (deliveries.length !== 1) failures.push(`${request.key}: ${deliveries.length} deliveries, expected one joint delivery`)
    else if (!deliveries[0].text.trim()) failures.push(`${request.key}: the delivery is empty`)
  }
  // He never tells the person to open a thread: the Auto DM has none.
  if (msgs.some((m) => /thread/i.test(m.text))) failures.push(`${request.key}: a Tuca reply mentions a thread`)
  return failures
}

const report = {
  source: (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
    } catch {
      return 'unknown'
    }
  })(),
  output,
  data: null,
  ports: null,
  steps: [],
  requests: [],
  screenshots: [],
  failures: [],
  errors: [],
  threadViolations: 0,
  passed: false
}
const summary = (r) => ({
  passed: r.passed,
  failure: r.failure ?? null,
  failures: r.failures,
  pageerrors: r.errors,
  output: r.output,
  data: r.data,
  screenshots: r.screenshots,
  requests: r.requests.map((q) => ({
    key: q.key,
    durationMs: q.durationMs,
    delegations: q.delegations.map((d) => ({ to: d.to, state: d.state })),
    deliveries: q.deliveries,
    delivery: q.delivery,
    failures: q.failures
  }))
})

mkdirSync(output, { recursive: true })
let data
let app
let page
try {
  if (!existsSync(join(repo, 'out/main/index.js'))) throw new Error('out/main/index.js is missing: run npm run build first')
  data = mkdtempSync(join(tmpdir(), 'tucano-auto-real-'))
  report.data = data
  dbFile = join(data, 'tucano.db')
  // The Tucano keeps the Codex login inside its own data folder: a fresh one has none. The login of
  // the installed Tucano is copied in for this run, and removed again at the end however it goes.
  const auth = process.env.TUCANO_E2E_CODEX_AUTH ?? join(homedir(), '.config', 'Tucano', 'codex-home', '.codex', 'auth.json')
  if (!existsSync(auth)) throw new Error(`no Codex login to copy at ${auth} (set TUCANO_E2E_CODEX_AUTH)`)
  mkdirSync(join(data, 'codex-home', '.codex'), { recursive: true })
  copyFileSync(auth, join(data, 'codex-home', '.codex', 'auth.json'))
  const ports = await reservePorts()
  report.ports = { webhook: ports.webhook, git: ports.git, mcp: ports.webhook + 100 }
  await release(ports.held)
  const env = { ...process.env, TUCANO_DATA: data, TUCANO_SEED: '1', TUCANO_WEBHOOK_PORT: String(ports.webhook), TUCANO_GIT_PORT: String(ports.git) }
  // The real engines: no fake ones, and no Node-mode or dev-server variables from the caller.
  delete env.TUCANO_FAKE_ENGINES
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL

  const launch = async () => {
    const started = await electron.launch({ args: ['.'], cwd: repo, env })
    const win = await started.firstWindow()
    win.setDefaultTimeout(60_000)
    win.on('pageerror', (error) => report.errors.push(String(error)))
    await win.setViewportSize({ width: 1360, height: 840 })
    return { app: started, page: win }
  }
  const shot = (win, name) => {
    const path = join(output, `${name}.png`)
    report.screenshots.push(path)
    return win.screenshot({ path })
  }

  // First launch: the db and the seeded team. Auto is switched on from the workspace menu, which
  // makes the Tuca and his DM.
  ;({ app, page } = await launch())
  await page.locator('.sidebar').waitFor()
  await page.locator('.workspace-picker__button').click()
  await page.locator('.menu__item', { hasText: 'Tucano Auto' }).click()
  await waitForAuto(page)
  ids = await waitFor('the Tuca and his DM', readIds)
  await app.close()
  app = undefined
  report.steps.push('first launch: Tucano Auto switched on, the Tuca and his DM made')

  // Fixed, cheap models with no computer or web access, for the Tuca and the three seeded agents.
  // Auto stays on in the settings, so the next launch opens in it.
  const changed = withDb((db) => {
    const agents = db.prepare("UPDATE agents SET model = 'codex:gpt-6-luna', effort = 'low', computer = 0, web = 0 WHERE kind = 'tuca' OR handle IN ('lia', 'theo', 'nina')").run().changes
    db.prepare("INSERT INTO settings (key, value) VALUES ('auto', 'true') ON CONFLICT (key) DO UPDATE SET value = excluded.value").run()
    return agents
  })
  if (changed !== 4) throw new Error(`expected the Tuca and the three seeded agents, changed ${changed} rows`)
  report.steps.push('db: models set, effort low, computer and web off; auto on')

  ;({ app, page } = await launch())
  await waitForAuto(page) // the mode is on, so it opens in Tucano Auto
  ids = readIds()
  if (!ids) throw new Error('the Tuca or his DM is missing after the relaunch')
  await shot(page, '00-auto-reaberto')
  report.steps.push('relaunch: opened in Tucano Auto')

  for (const request of REQUESTS) {
    const sentAt = Date.now()
    await page.locator('.auto-composer textarea').fill(request.text)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('.auto-composer textarea')?.value === '')
    const s = await settle(request, sentAt)
    const durationMs = Date.now() - sentAt
    await shot(page, `${request.key}-pronto`)
    const failures = judge(request, s)
    const hits = await namesInChat(page)
    if (hits.length) failures.push(`${request.key}: the Auto chat shows ${hits.join(', ')}`)
    report.requests.push({ ...describe(request, s, durationMs), failures })
    report.failures.push(...failures)
  }

  // Every message the Tuca wrote in his DM, not only this run's, must be outside any thread.
  report.threadViolations = withDb((db) =>
    db.prepare('SELECT count(*) AS n FROM messages WHERE conversation_id = ? AND author_id = ? AND thread_id IS NOT NULL').get(ids.dm, ids.tuca).n
  )
  if (report.threadViolations) report.failures.push(`${report.threadViolations} Tuca message(s) in his DM sit in a thread`)
  report.passed = report.failures.length === 0 && report.errors.length === 0
  if (report.errors.length) report.failures.push(`${report.errors.length} pageerror(s)`)
} catch (error) {
  report.failure = String(error?.stack ?? error)
  const current = app ? app.windows()[0] : undefined
  if (current) {
    report.visibleText = clip(await current.locator('body').innerText().catch(() => ''), 4000)
    report.screenshots.push(join(output, 'failure.png'))
    await current.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => {})
  // The copied login never stays behind, even when the rest of the folder is kept to look at.
  if (data) rmSync(join(data, 'codex-home'), { recursive: true, force: true })
  if (report.passed && data) rmSync(data, { recursive: true, force: true })
  report.data = report.passed ? null : data ?? null
  // A failed assertion does not throw, so the exit code is set here for every way out.
  if (!report.passed) process.exitCode = 1
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(summary(report), null, 2))
}
