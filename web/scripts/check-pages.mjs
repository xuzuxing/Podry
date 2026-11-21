// 页面巡检：用本机 Chrome（CDP）逐路由截图 + 收集运行时错误。
// 用法：node scripts/check-pages.mjs [baseURL]
// 需要先启动静态服务（npm run preview 或 npm run dev）。
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:4173'
const CHROME =
  process.env.PODRY_CHROME ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = resolve(import.meta.dirname, '../screenshots')
const PORT = 9333

const routes = [
  ['01-projects', '/'],
  ['02-project-detail', '/projects/p-shop'],
  ['03-apps', '/apps'],
  ['04-app-overview', '/projects/p-shop/apps/a-checkout/overview'],
  ['05-build-deploy', '/projects/p-shop/apps/a-checkout/trigger'],
  ['06-build-history', '/projects/p-shop/apps/a-checkout/builds'],
  ['07-deployment-history', '/projects/p-shop/apps/a-checkout/deployments'],
  ['08-config-git', '/projects/p-shop/apps/a-checkout/config/git'],
  ['09-config-build', '/projects/p-shop/apps/a-checkout/config/build'],
  ['10-config-base', '/projects/p-shop/apps/a-checkout/config/base'],
  ['11-config-workflow', '/projects/p-shop/apps/a-checkout/config/workflow'],
  ['12-config-overrides', '/projects/p-shop/apps/a-checkout/config/overrides'],
  ['13-app-resources', '/projects/p-shop/apps/a-checkout/resources'],
  ['13b-app-resources-prod', '/projects/p-shop/apps/a-checkout/resources?env=b-checkout-prod'],
  ['14-clusters', '/clusters'],
  ['15a-cluster-overview', '/clusters/c-prod'],
  ['15-cluster-workspace', '/clusters/c-prod?resource=deployments'],
  ['15-cluster-events', '/clusters/c-prod?view=events'],
  ['15-cluster-nodes', '/clusters/c-dev?view=nodes'],
  ['15-cluster-namespaces', '/clusters/c-prod?view=namespaces'],
  ['15b-cluster-resource-tab', '/clusters/c-dev?open=core,pods,shop-dev,checkout-api-5b8d7c9f4-t1n9p'],
  ['15f-cluster-terminal', '/clusters/c-prod/terminal'],
  ['15c-node-detail-summary', '/clusters/c-prod/node/detail/prod-node-01/summary'],
  ['15d-node-detail-conditions', '/clusters/c-prod/node/detail/prod-node-02/node-conditions'],
  ['15e-node-detail-issues', '/clusters/c-prod/node/detail/prod-node-02/summary'],
  ['16-resource-detail', '/clusters/c-prod/resources/apps/deployments/shop-prod/checkout-api/manifest'],
  ['17-audit', '/audit'],
  ['18-settings-members', '/settings/members'],
  ['19-settings-clusters', '/settings/clusters'],
  ['20-settings-environments', '/settings/environments'],
  ['21-settings-credentials', '/settings/credentials'],
  ['22-settings-registries', '/settings/registries'],
  ['23-login', '/login'],
]

const profile = join(tmpdir(), `podry-chrome-${Date.now()}`)
mkdirSync(profile, { recursive: true })
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function wsUrl() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      const body = await res.json()
      if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl
    } catch {
      /* 等待启动 */
    }
    await sleep(120)
  }
  throw new Error('Chrome 调试端口未就绪')
}

const socket = new WebSocket(await wsUrl())
await new Promise((res, rej) => {
  socket.addEventListener('open', res, { once: true })
  socket.addEventListener('error', rej, { once: true })
})

let seq = 0
const pending = new Map()
const problems = []

socket.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve: done, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(msg.error.message))
    else done(msg.result)
    return
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    problems.push(`exception: ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ''}`)
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    problems.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`)
  }
})

function send(method, params = {}, sessionId) {
  seq += 1
  const id = seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const call = (method, params = {}) => send(method, params, sessionId)

await call('Page.enable')
await call('Runtime.enable')
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `try {
    localStorage.setItem('podry:session', JSON.stringify({
      token: 'mock-demo-token',
      user: { id: 'u-1', email: 'admin@acme.dev', name: '张运维', isSuperAdmin: true }
    }))
  } catch (e) {}`,
})

for (const [name, path] of routes) {
  const url = `${BASE}${path}`
  await call('Page.navigate', { url })
  await sleep(name === '23-login' ? 900 : 1300)
  const shot = await call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(shot.data, 'base64'))
  const title = await call('Runtime.evaluate', { expression: 'document.title', returnByValue: true })
  const body = await call('Runtime.evaluate', {
    expression: 'document.querySelector("#app")?.innerText?.slice(0,80) ?? ""',
    returnByValue: true,
  })
  console.log(`${name.padEnd(24)} ${String(title.result.value).padEnd(28)} ${String(body.result.value).replace(/\s+/g, ' ').slice(0, 60)}`)
}

if (problems.length) {
  console.log('\n运行时问题:')
  for (const line of problems.slice(0, 40)) console.log(' -', line)
} else {
  console.log('\n无运行时错误')
}

socket.close()
chrome.kill()
await sleep(300)
try {
  rmSync(profile, { recursive: true, force: true })
} catch {
  /* 忽略清理失败 */
}
process.exit(problems.length ? 1 : 0)
