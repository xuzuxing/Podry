// P1 交互巡检：Manifest 编辑 → Dry run → Review → Apply；创建资源；发布未知结果核对
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BASE = process.argv[2] || 'http://localhost:4200'
const CHROME = process.env.PODRY_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = resolve(import.meta.dirname, '../screenshots-p1')
const PORT = 9334

const profile = join(tmpdir(), `podry-p1-${Date.now()}`)
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
async function clickText(text) {
  return evaluate(
    `(() => { const el = [...document.querySelectorAll('button,a')].find((node) => node.textContent.trim().includes(${JSON.stringify(text)})); if (!el) return 'not-found'; el.click(); return 'clicked' })()`,
  )
}

async function fillDialogInputs(values) {
  return evaluate(`(() => {
    const values = ${JSON.stringify(values)}
    const dialogs = [...document.querySelectorAll('.t-dialog')].filter((node) => node.offsetParent !== null)
    const scope = dialogs[dialogs.length - 1]
    if (!scope) return 'no-dialog'
    const fields = [...scope.querySelectorAll('input, textarea')].filter((el) => el.type !== 'hidden' && !el.closest('.t-select'))
    const out = []
    values.forEach((value, index) => {
      const el = fields[index]
      if (!el) { out.push('#' + index + ':miss'); return }
      el.focus()
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      out.push('#' + index + ':ok')
    })
    return out.join(', ')
  })()`)
}
async function clickDialogConfirm() {
  return evaluate(`(() => {
    const dialogs = [...document.querySelectorAll('.t-dialog')].filter((node) => node.offsetParent !== null)
    const scope = dialogs[dialogs.length - 1]
    if (!scope) return 'no-dialog'
    const labels = ['保存', '接入', '创建', '添加', '导入', '确认', '确定']
    const btn = [...scope.querySelectorAll('button')].find((b) => labels.includes(b.textContent.trim()))
    if (!btn) return 'miss:' + [...scope.querySelectorAll('button')].map((b) => b.textContent.trim()).join('|')
    btn.click()
    return 'clicked:' + btn.textContent.trim()
  })()`)
}
// 1) Manifest 编辑 → Dry run → Review
await call('Page.navigate', { url: `${BASE}/clusters/c-prod?open=core,configmaps,shop-prod,checkout-api-config` })
await sleep(1600)
await shot('01-manifest-read')
console.log(' click 编辑:', await clickText('编辑实时 Manifest'))
await sleep(600)
await shot('02-manifest-edit')
// 改一行内容：把 LOG_LEVEL 改成 debug
await evaluate(`(() => {
  const ta = document.querySelector('textarea')
  if (!ta) return 'no-textarea'
  ta.value = ta.value.replace('LOG_LEVEL: info', 'LOG_LEVEL: debug')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  ta.dispatchEvent(new Event('change', { bubbles: true }))
  return ta.value.includes('debug') ? 'edited' : 'edit-failed'
})()`)
await sleep(300)
console.log(' click DryRun:', await clickText('Dry run 并预览'))
await sleep(900)
await shot('03-review-dialog')
console.log(' click 应用:', await clickText('应用'))
await sleep(900)
await shot('04-after-apply')

// 2) 创建资源
await call('Page.navigate', { url: `${BASE}/clusters/c-prod?view=list&resource=configmaps` })
await sleep(1500)
console.log(' click 创建资源:', await clickText('创建资源'))
await sleep(500)
await shot('05-create-dialog')
console.log(' click DryRun(创建):', await clickText('Dry run'))
await sleep(800)
await shot('06-create-dryrun')

// 3) 发布未知结果核对
await call('Page.navigate', { url: `${BASE}/projects/p-shop/apps/a-payment/deployments` })
await sleep(1600)
await shot('07-deployments')
const hasUnknown = await evaluate(`document.body.innerText.includes('待核对') || document.body.innerText.includes('未知')`)
console.log(' 未就绪列表命中未知:', hasUnknown)
console.log(' click 待核对条目:', await evaluate(`(() => {
  const el = [...document.querySelectorAll('button, div, span')].find((n) => n.className && String(n.className).includes('deploy-item') && n.textContent.includes('待核对'))
  if (!el) return 'not-found'; el.click(); return 'clicked'
})()`))
await sleep(800)
await shot('08-unknown-selected')
console.log(' click 核对结果:', await clickText('核对结果'))
await sleep(1000)
await shot('09-after-reconcile')


// 4) 环境覆盖保存
await call('Page.navigate', { url: `${BASE}/projects/p-shop/apps/a-checkout/config/overrides` })
await sleep(1600)
console.log(' click 保存覆盖:', await clickText('保存'))
await sleep(900)
await shot('10-overrides-saved')

// 5) 集群接入
await call('Page.navigate', { url: `${BASE}/settings/clusters` })
await sleep(1500)
console.log(' click 接入集群:', await clickText('接入集群'))
await sleep(500)
await fillDialogInputs(['staging-k8s', 'https://10.0.0.9:6443'])
await shot('11-cluster-dialog')
console.log(' click 接入(确认):', await clickDialogConfirm())
await sleep(900)
await shot('12-cluster-created')

// 6) 凭据创建
await call('Page.navigate', { url: `${BASE}/settings/credentials` })
await sleep(1500)
console.log(' click 新建凭据:', await clickText('新建凭据'))
await sleep(500)
await fillDialogInputs(['harbor-bot-2026', 'demo-token-value'])
await shot('13-credential-dialog')
console.log(' click 创建(确认):', await clickDialogConfirm())
await sleep(900)
await shot('14-credential-created')

// 7) 镜像仓库添加
await call('Page.navigate', { url: `${BASE}/settings/registries` })
await sleep(1500)
console.log(' click 添加镜像仓库:', await clickText('添加镜像仓库'))
await sleep(500)
await fillDialogInputs(['harbor-staging', 'https://harbor.staging.acme.dev'])
await shot('15-registry-dialog')
console.log(' click 保存(确认):', await clickDialogConfirm())
await sleep(900)
await shot('16-registry-created')

// 8) 导入外部镜像（选择镜像抽屉）
await call('Page.navigate', { url: `${BASE}/projects/p-shop/apps/a-checkout/trigger` })
await sleep(1800)
console.log(' click Select Image:', await clickText('Select Image'))
await sleep(900)
await shot('17-image-drawer')
console.log(' click 导入外部镜像:', await clickText('导入外部镜像'))
await sleep(600)
await shot('18-import-dialog')
await fillDialogInputs(['harbor.acme.dev/acme/checkout-api:v1.40.2-legacy', 'sha256:'.padEnd(71, 'a')])
await sleep(200)
console.log(' click 导入:', await clickDialogConfirm())
await sleep(1000)
await shot('19-import-done')
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
