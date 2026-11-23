import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const delay = (ms) => new Promise((done) => setTimeout(done, ms))

/** 独立 Chrome profile 和动态 CDP 端口，避免影响正在使用的浏览器。 */
export async function launchBrowser(baseURL, output) {
  const profile = mkdtempSync(join(tmpdir(), 'podry-parity-'))
  mkdirSync(output, { recursive: true })
  const chrome = spawn(process.env.PODRY_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let stderr = ''
  chrome.stderr.on('data', (chunk) => { stderr += chunk })
  let socket
  try {
    for (let attempt = 0; !stderr.includes('DevTools listening on ') && attempt < 100; attempt++) await delay(100)
    const address = /DevTools listening on (ws:\/\/\S+)/.exec(stderr)?.[1]
    if (!address) throw new Error(`Chrome 未启动: ${stderr}`)
    socket = new WebSocket(address)
    await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }) })
    let seq = 0
    const pending = new Map()
    const errors = []
    const warnings = []
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      if (message.id) {
        const task = pending.get(message.id)
        if (!task) return
        clearTimeout(task.timer); pending.delete(message.id)
        if (message.error) task.fail(new Error(message.error.message))
        else task.done(message.result)
      } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
      else if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
        const text = message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')
        ;(message.params.type === 'error' ? errors : warnings).push(text)
      }
    })
    function send(method, params = {}, sessionId) {
      const id = ++seq
      return new Promise((done, fail) => {
        const timer = setTimeout(() => { pending.delete(id); fail(new Error(`CDP timeout: ${method}`)) }, 20000)
        pending.set(id, { done, fail, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }))
      })
    }
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    const call = (method, params) => send(method, params, sessionId)
    await call('Page.enable'); await call('Runtime.enable')
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('podry:session',JSON.stringify({token:'mock-parity-token',user:{id:'u-1',email:'admin@acme.dev',name:'张运维',isSuperAdmin:true}}))` })
    async function evaluate(expression) {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      return result.result.value
    }
    async function until(expression, timeout = 12000) {
      const start = Date.now()
      while (Date.now() - start < timeout) { const value = await evaluate(expression); if (value) return value; await delay(100) }
      throw new Error(`等待超时: ${expression}`)
    }
    async function navigate(path) { await call('Page.navigate', { url: `${baseURL}${path}` }); await until('!!document.querySelector(".shell")'); await delay(700) }
    async function screenshot(name) { const shot = await call('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(output, `${name}.png`), Buffer.from(shot.data, 'base64')) }
    async function close() {
      try { await send('Browser.close') } catch { chrome.kill() }
      socket.close()
      // Windows Chrome descendants can retain stderr after Browser.close.
      // Release our handles so completed checks can exit.
      chrome.stderr.destroy()
      chrome.unref()
      await delay(1000)
      // 此绝对路径来自 mkdtempSync，只清理由本次测试创建的临时 profile。
      if (resolve(profile).startsWith(resolve(tmpdir()) + '\\podry-parity-')) {
        try { rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 }) }
        catch { console.warn('Chrome 临时目录仍被占用，保留：' + profile) }
      }
    }
    return { call, evaluate, until, navigate, screenshot, errors, warnings, close }
  } catch (error) { socket?.close(); chrome.kill(); chrome.stderr.destroy(); chrome.unref(); throw error }
}
