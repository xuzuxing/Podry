/**
 * 构建发布页视觉检查：画布、Select Material 弹窗、Select Image 弹窗。
 * 输出到 web/screenshots-pipeline，供人工与真实 Devtron 截图对照。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173'
const CHROME = process.env.PODRY_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = resolve(import.meta.dirname, '../screenshots-pipeline')
const PORT = 9343

const profile = mkdtempSync(join(tmpdir(), 'podry-pipe-'))
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

async function evaluate(expression) {
  const res = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return res.result?.value
}
async function shot(name) {
  const png = await call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(png.data, 'base64'))
  console.log('   shot', name)
}
async function clickText(text) {
  return evaluate(`(() => {
    const el = [...document.querySelectorAll('button,a')].find((item) => (item.textContent || '').trim() === ${JSON.stringify(text)})
    if (!el) return 'miss'
    el.click()
    return 'ok'
  })()`)
}

// 1) 构建发布画布
await call('Page.navigate', { url: `${BASE}/projects/p-shop/apps/a-checkout/trigger` })
await sleep(2600)
await shot('01-builddeploy')
console.log(' workflow:', await evaluate(`document.querySelector('.wf__name')?.textContent`))
console.log(' nodes:', await evaluate(`[...document.querySelectorAll('.tnode__name')].map((el) => el.textContent.trim()).join(' | ')`))
console.log(' triggers:', await evaluate(`[...document.querySelectorAll('.tnode__trigger')].map((el) => el.textContent.trim()).join(' | ')`))
console.log(' geometry:', await evaluate(`[...document.querySelectorAll('.tnode')].map((el) => { const r = el.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) }).join(' | ')`))

// 2) 选择提交
console.log(' open material:', await clickText('选择提交'))
await sleep(2600)
await shot('02-select-material')
console.log(' material drawer:', await evaluate(`document.querySelector('.bd-material')?.getBoundingClientRect().width`))

// 3) 选择镜像（新开页面避免弹窗叠加）
await call('Page.navigate', { url: `${BASE}/projects/p-shop/apps/a-checkout/trigger` })
await sleep(2400)
console.log(' open image:', await clickText('选择镜像'))
await sleep(2600)
await shot('03-select-image')
console.log(' image drawer:', await evaluate(`document.querySelector('.bd-image')?.getBoundingClientRect().width`))

// 4) 配置 → 工作流（同名工作流）
await call('Page.navigate', { url: `${BASE}/projects/p-shop/apps/a-checkout/config/workflow` })
await sleep(2400)
await shot('04-workflow-config')
console.log(' config workflow name:', await evaluate(`document.querySelector('.wf__name')?.textContent`))

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
