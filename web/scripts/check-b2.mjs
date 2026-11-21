import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BASE = process.argv[2] || 'http://localhost:4232'
const CHROME = process.env.PODRY_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = resolve(import.meta.dirname, '../screenshots-b2')
const PORT = 9339

const profile = join(tmpdir(), `podry-b2-${Date.now()}`)
mkdirSync(profile, { recursive: true })
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'],
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
      /* wait */
    }
    await sleep(120)
  }
  throw new Error('chrome debug port not ready')
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
  if (msg.method === 'Runtime.exceptionThrown') problems.push(msg.params.exceptionDetails.text)
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    problems.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
})
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    seq += 1
    pending.set(seq, { resolve, reject })
    socket.send(JSON.stringify({ id: seq, method, params, ...(sessionId ? { sessionId } : {}) }))
  })

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const call = (method, params = {}) => send(method, params, sessionId)

await call('Page.enable')
await call('Runtime.enable')
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('podry:session', JSON.stringify({token:'mock-demo',user:{id:'u-1',email:'admin@acme.dev',name:'张运维',isSuperAdmin:true}}))}catch(e){}`,
})

async function evaluate(expression) {
  const res = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return res.result?.value
}
async function shot(name) {
  const png = await call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(png.data, 'base64'))
  console.log('   shot', name)
}

// 1) MONITORING 区
await call('Page.navigate', { url: `${BASE}/projects/p-shop/apps/a-checkout/resources` })
await sleep(2200)
await shot('01-monitoring')
console.log(' monitor cells:', await evaluate(`document.querySelectorAll('.res__monitor-cell').length`))

// 2) Log Analyzer：容器选择 + Live
console.log(
  ' click 日志分析:',
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('.res__tab')].find((el) => el.textContent.includes('日志分析'))
    if (!tab) return 'miss'
    tab.click()
    return 'clicked'
  })()`),
)
await sleep(1600)
await shot('02-log-analyzer')
console.log(' analyzer selects:', await evaluate(`document.querySelectorAll('.res__analyzer-select').length`))
console.log(' live control:', await evaluate(`document.querySelector('.res__analyzer-live')?.textContent.trim() ?? 'none'`))

// 3) Create Resource 抽屉
await call('Page.navigate', { url: `${BASE}/clusters/c-prod` })
await sleep(1700)
console.log(
  ' click 创建资源:',
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('创建资源'))
    if (!btn) return 'miss'
    btn.click()
    return 'clicked'
  })()`),
)
await sleep(900)
await shot('03-create-drawer')
console.log(' drawer visible:', await evaluate(`document.querySelectorAll('.t-drawer').length`))
console.log(' dialog visible:', await evaluate(`[...document.querySelectorAll('.t-dialog')].filter((el) => el.offsetParent !== null).length`))

console.log(problems.length ? `运行时问题: ${problems.slice(0, 5).join(' | ')}` : '无运行时错误')
socket.close()
chrome.kill()
await sleep(300)
try {
  rmSync(profile, { recursive: true, force: true })
} catch {
  /* ignore */
}
process.exit(problems.length ? 1 : 0)
