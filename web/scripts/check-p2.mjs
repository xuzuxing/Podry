// P2 交互巡检：Secret 明文 / 集群终端 / Pod 终端会话 / 发布指标
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BASE = process.argv[2] || 'http://localhost:4205'
const CHROME = process.env.PODRY_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = resolve(import.meta.dirname, '../screenshots-p2')
const PORT = 9335

const profile = join(tmpdir(), `podry-p2-${Date.now()}`)
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
async function clickPanelTab(label) {
  return evaluate(`(() => {
    const tab = [...document.querySelectorAll('.rpanel__tab')].find((el) => el.textContent.trim() === ${JSON.stringify(label)})
    if (!tab) return 'not-found'
    tab.click()
    return 'clicked'
  })()`)
}

async function clickAnyText(text) {
  return evaluate(`(() => {
    const el = [...document.querySelectorAll('span, label, div, li, button')].find((node) => node.children.length === 0 && node.textContent.trim() === ${JSON.stringify(text)})
    if (!el) return 'not-found'
    el.click()
    return 'clicked'
  })()`)
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
    const labels = ['保存', '接入', '创建', '添加', '导入', '确认创建', '确认', '确定']
    const btn = [...scope.querySelectorAll('button')].find((b) => labels.includes(b.textContent.trim()))
    if (!btn) return 'miss:' + [...scope.querySelectorAll('button')].map((b) => b.textContent.trim()).join('|')
    btn.click()
    return 'clicked:' + btn.textContent.trim()
  })()`)
}

async function typeCommand(command) {
  return evaluate(`(() => {
    const input = document.querySelector('.term__input') || document.querySelector('.rpanel__term-input input') || document.querySelector('textarea')
    if (!input) return 'no-input'
    input.focus()
    input.value = ${JSON.stringify(command)}
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return 'typed'
  })()`)
}

// 1) Secret 明文读取
await call('Page.navigate', { url: `${BASE}/clusters/c-prod?open=core,secrets,shop-prod,checkout-api-secret` })
await sleep(1800)
await shot('01-secret-panel')
console.log(' click 查看明文:', await clickText('查看明文'))
await sleep(900)
await shot('02-secret-reveal')
console.log(' click 显示:', await clickText('显示'))
await sleep(400)
await shot('03-secret-shown')

// 2) 集群终端
await call('Page.navigate', { url: `${BASE}/clusters/c-prod/terminal` })
await sleep(1600)
await shot('04-cluster-terminal')
console.log(' 输入 kubectl get pods:', await typeCommand('kubectl get pods'))
await sleep(1000)
await shot('05-terminal-pods')
console.log(' 输入 kubectl get nodes:', await typeCommand('kubectl get nodes'))
await sleep(1000)
await shot('06-terminal-nodes')

// 3) Pod 终端会话
await call('Page.navigate', { url: `${BASE}/clusters/c-dev?open=core,pods,shop-dev,checkout-api-5b8d7c9f4-t1n9p` })
await sleep(1700)
console.log(' click terminal tab:', await clickPanelTab('终端'))
await sleep(900)
await shot('07-pod-terminal')

// 3b) 日志流控制
console.log(' click 日志 tab:', await clickPanelTab('日志'))
await sleep(900)
await shot('07b-pod-logs')

// 4) 发布指标
await call('Page.navigate', { url: `${BASE}/projects/p-shop/apps/a-checkout/deployments` })
await sleep(1800)
await shot('08-deployment-metrics')

// 5) 灰度发布：Review 选策略 → 发布 → 推进灰度
await call('Page.navigate', { url: `${BASE}/projects/p-shop/apps/a-checkout/trigger` })
await sleep(1900)
console.log(' click Select Image:', await clickText('Select Image'))
await sleep(900)
console.log(' click Review:', await clickText('Review'))
await sleep(1400)
await shot('09-review-strategy')
console.log(' click 灰度发布:', await clickAnyText('灰度发布'))
await sleep(400)
await shot('10-review-canary')
console.log(' click 确认发布:', await clickText('确认发布'))
await sleep(1600)
await shot('11-deployments')
console.log(
  ' click first deployment:',
  await evaluate(`(() => {
    const item = document.querySelector('.deploy-item')
    if (!item) return 'not-found'
    item.click()
    return 'clicked'
  })()`),
)
await sleep(1000)
await shot('12-canary-detail')
console.log(' click 推进到:', await clickText('推进到'))
await sleep(1300)
await shot('13-canary-advanced')

// 6) 资源类型页签：点树里的类型，第二个页签名称跟着变
await call('Page.navigate', { url: `${BASE}/clusters/c-prod?view=nodes` })
await sleep(1600)
console.log(' click Deployment:', await clickAnyText('Deployment'))
await sleep(1000)
console.log(
  ' active tabs:',
  await evaluate(`[...document.querySelectorAll('.ws__tab--active')].map((el) => el.textContent.trim()).join(' | ')`),
)
await shot('14-kind-tab-switch')

// 7) 应用概览：编辑描述
await call('Page.navigate', { url: `${BASE}/projects/p-shop/apps/a-checkout/overview` })
await sleep(1800)
console.log(
  ' click edit description:',
  await evaluate(`(() => {
    const el = document.querySelector('.ov__edit-btn')
    if (!el) return 'miss'
    el.click()
    return 'clicked'
  })()`),
)
await sleep(700)
await shot('15-overview-edit')
await evaluate(`(() => {
  const ta = document.querySelector('.t-dialog textarea')
  if (!ta) return 'miss'
  ta.value = '结算主链路 API（已编辑）'
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`)
await sleep(200)
console.log(' click save:', await clickDialogConfirm())
await sleep(1000)
await shot('16-overview-saved')

// 8) 运行详情：环境对比 + 日志分析
await call('Page.navigate', { url: `${BASE}/projects/p-shop/apps/a-checkout/resources` })
await sleep(1800)
console.log(
  ' click compare:',
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.res__icon-btn')].find((el) => el.getAttribute('title') === '对比环境')
    if (!btn) return 'miss'
    btn.click()
    return 'clicked'
  })()`),
)
await sleep(800)
await shot('17-compare-dialog')

// 8b) 应用状态抽屉（Application Status / Deployment Status）
await call('Page.navigate', { url: `${BASE}/projects/p-shop/apps/a-checkout/resources` })
await sleep(1700)
console.log(
  ' click Details:',
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Details')
    if (!btn) return 'miss'
    btn.click()
    return 'clicked'
  })()`),
)
await sleep(900)
await shot('17b-app-status')
console.log(' click 部署状态:', await evaluate(`(() => { const tabs = [...document.querySelectorAll('.res__status-tab')]; const tab = tabs[1]; if (!tab) return 'miss'; tab.click(); return 'clicked' })()`))
await sleep(700)
await shot('17c-deploy-status')

await call('Page.navigate', { url: `${BASE}/projects/p-shop/apps/a-checkout/resources` })
await sleep(1600)
console.log(' click analyzer:', await clickText('日志分析'))
await sleep(1800)
await shot('18-analyzer')

// 9) 新建项目
await call('Page.navigate', { url: `${BASE}/` })
await sleep(1600)
console.log(' click 新建项目:', await clickText('新建项目'))
await sleep(600)
await fillDialogInputs(['订单履约'])
await sleep(200)
console.log(' click 确认创建:', await clickDialogConfirm())
await sleep(1200)
await shot('19-project-created')

// 10) 集群连接测试
await call('Page.navigate', { url: `${BASE}/settings/clusters` })
await sleep(1600)
console.log(' click 连接测试:', await clickText('连接测试'))
await sleep(1200)
await shot('20-connection-tested')

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
