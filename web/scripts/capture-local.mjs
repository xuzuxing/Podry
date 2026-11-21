/**
 * 本地 mock 前端截图：登录态注入 + 指定路由截图，用于与真实 Devtron 逐像素对照。
 * 用法：node web/scripts/capture-local.mjs [baseUrl] [routePath] [name]
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173'
const ROUTE = process.argv[3] || '/projects/p-shop/apps/a-checkout/trigger'
const NAME = process.argv[4] || 'trigger'
const CHROME = process.env.PODRY_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = resolve(import.meta.dirname, '../screenshots-local')
// 每次运行使用独立调试端口，避免与并行截图脚本（含子代理）冲突
const PORT = 9300 + (process.pid % 600)
mkdirSync(OUT, { recursive: true })

const profile = mkdtempSync(join(tmpdir(), 'podry-local-'))

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
  new Promise((res, rej) => {
    seq += 1
    pending.set(seq, { resolve: res, reject: rej })
    socket.send(JSON.stringify({ id: seq, method, params, ...(sessionId ? { sessionId } : {}) }))
  })

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const call = (method, params = {}) => send(method, params, sessionId)

await call('Page.enable')
await call('Runtime.enable')
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('podry:session', JSON.stringify({token:'mock-demo',user:{id:'u-1',email:'admin@acme.dev',name:'张运维',isSuperAdmin:true}}))}catch(e){}`,
})

const evaluate = async (expression) => {
  const res = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text)
  return res.result?.value
}

await call('Page.navigate', { url: `${BASE}${ROUTE}` })
await sleep(3000)
const clickSequence = process.env.CLICKS ? JSON.parse(process.env.CLICKS) : process.env.CLICK_TEXT ? [process.env.CLICK_TEXT] : []
if (process.env.PRE_SCRIPT) {
  console.log('pre =>', await evaluate(process.env.PRE_SCRIPT))
  await sleep(400)
}
for (const text of clickSequence) {
  const clicked = await evaluate(`(() => {
    const label = ${JSON.stringify(text)}
    const exact = [...document.querySelectorAll('button,a')].find((item) => (item.textContent || '').trim() === label)
    const fuzzy = exact || [...document.querySelectorAll('button,a')].find((item) => (item.textContent || '').includes(label))
    if (!fuzzy) return 'miss'
    fuzzy.click()
    return 'clicked'
  })()`)
  console.log('click', text, '=>', clicked)
  await sleep(Number(process.env.CLICK_WAIT || 1200))
}
const png = await call('Page.captureScreenshot', { format: 'png' })
writeFileSync(join(OUT, `${NAME}.png`), Buffer.from(png.data, 'base64'))
writeFileSync(join(OUT, `${NAME}.txt`), await evaluate('document.body.innerText'))
console.log('shot', NAME)
console.log(problems.length ? `运行时问题: ${problems.slice(0, 5).join(' | ')}` : '无运行时错误')

socket.close()
chrome.kill()
try {
  const { execFileSync } = await import('node:child_process')
  execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' })
} catch {
  /* already gone */
}
await sleep(500)
try {
  rmSync(profile, { recursive: true, force: true })
} catch {
  /* ignore */
}
process.exit(0)
