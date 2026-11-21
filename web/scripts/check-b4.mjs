import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BASE = process.argv[2] || 'http://localhost:4235'
const CHROME = process.env.PODRY_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = resolve(import.meta.dirname, '../screenshots-b4')
const PORT = 9341

const profile = join(tmpdir(), `podry-b4-${Date.now()}`)
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

await call('Page.navigate', { url: `${BASE}/projects/p-shop/apps/a-checkout/resources` })
await sleep(2200)

// 1) 环境操作菜单
console.log(
  ' open env menu:',
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.res__icon-btn')].find((el) => el.title === '环境操作')
    if (!btn) return 'miss'
    btn.click()
    return 'clicked'
  })()`),
)
await sleep(700)
await shot('01-env-actions-menu')
console.log(' menu items:', await evaluate(`[...document.querySelectorAll('.t-dropdown__item')].map((el) => el.textContent.trim()).join(' | ')`))

// 2) Restart workloads 弹窗
console.log(
  ' click restart:',
  await evaluate(`(() => {
    const item = [...document.querySelectorAll('.t-dropdown__item')].find((el) => el.textContent.includes('Restart'))
    if (!item) return 'miss'
    item.click()
    return 'clicked'
  })()`),
)
await sleep(800)
await shot('02-restart-workloads')
console.log(' workload options:', await evaluate(`document.querySelectorAll('.res__workloads .t-checkbox').length`))

// 关闭弹窗
await evaluate(`document.querySelector('.t-dialog__close')?.click()`)
await sleep(400)

// 3) Pod 行 ⋮ 菜单 → Check vulnerabilities
console.log(
  ' click Pod kind:',
  await evaluate(`(() => {
    const item = [...document.querySelectorAll('.t-tree__item')].find((el) => el.textContent.trim().startsWith('Pod'))
    if (!item) return 'miss'
    item.click()
    return 'clicked'
  })()`),
)
await sleep(900)
await shot('03-pod-rows')
console.log(
  ' open pod menu:',
  await evaluate(`(() => {
    const btn = document.querySelector('.rnode__more')
    if (!btn) return 'miss'
    btn.click()
    return 'clicked'
  })()`),
)
await sleep(700)
await shot('04-pod-menu')
console.log(' pod menu items:', await evaluate(`[...document.querySelectorAll('.t-dropdown__item')].map((el) => el.textContent.trim()).join(' | ')`))

console.log(
  ' click vulnerabilities:',
  await evaluate(`(() => {
    const item = [...document.querySelectorAll('.t-dropdown__item')].find((el) => el.textContent.includes('vulnerabilities'))
    if (!item) return 'miss'
    item.click()
    return 'clicked'
  })()`),
)
await sleep(1400)
await shot('05-vulnerabilities')
console.log(' vuln rows:', await evaluate(`document.querySelectorAll('.t-table tbody tr').length`))

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
