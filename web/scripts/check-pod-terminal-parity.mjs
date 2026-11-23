// Production browser UI checks. Mock sessions and literal commands only.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
import { terminalDriver } from './lib/terminal.mjs'
const output = resolve(import.meta.dirname, '../screenshots-pod-terminal-parity')
const browser = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182', output)
const { evaluate, until, screenshot, call } = browser
const terminal = terminalDriver(browser)
const checks = []
const dev = '/clusters/c-dev/resources/core/pods/shop-dev/checkout-api-5b8d7c9f4-t1n9p/terminal'
const scope = 'document.querySelector(".pod-terminal")'
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function tap(selector) { await until(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click()})()`); await delay(100) }
async function input(value) {
  await terminal.input(value)
}
async function key(key, code, windowsVirtualKeyCode, modifiers = 0) { await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers }); await delay(100) }
async function command(value) { await input(value); await key('Enter', 'Enter', 13) }
async function select(selector, label) {
  await tap(selector + ' .t-input')
  const option = `[...document.querySelectorAll('.t-select-option')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(label)})`
  await until(`!!(${option})`); await evaluate(`(${option}).click()`); await delay(150)
}
async function connected(container = 'envoy') {
  await terminal.connected()
  await until(`document.querySelector('.pod-terminal__container input').value===${JSON.stringify(container)}&&${terminal.rowsExpression}[0]?.includes(${JSON.stringify('/ ' + container)})&&${terminal.rowsExpression}[0]?.endsWith(document.querySelector('.pod-terminal__shell input').value)`)
}
async function go(path) { await evaluate(`void document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`); await delay(600) }
async function tab(label) {
  await evaluate(`([...document.querySelectorAll('.rpanel__tab')].find(el=>el.textContent.trim()===${JSON.stringify(label)})).click()`); await delay(250)
}
async function selectOutput() { await terminal.selectOutput() }
try {
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.terminalCopies=[];window.terminalCopyFail=false;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{if(window.terminalCopyFail)throw Error('denied');window.terminalCopies.push(text)}}})` })
  await browser.navigate(dev + '?container=envoy'); await connected()
  check('Terminal deep link auto connects requested container', await evaluate(`document.querySelector('.rpanel__tab--active').textContent==='终端'&&${terminal.textExpression}.includes('/ envoy')`))
  check('Compact toolbar and upstream terminal background', await evaluate('document.querySelector(".pod-terminal__toolbar").getBoundingClientRect().height<=40&&getComputedStyle(document.querySelector(".pod-terminal")).backgroundColor==="rgb(24, 25, 32)"'))
  check('Command entry belongs to dark viewport', await evaluate('!!document.querySelector(".pod-terminal__viewport textarea")&&document.querySelector(".pod-terminal__footer").textContent.includes("Mock")'))
  await tap('.pod-terminal__container .t-input')
  check('Main/init/ephemeral grouped without env names', await evaluate(`(()=>{const options=[...document.querySelectorAll('.t-select-option')].filter(el=>el.checkVisibility()).map(el=>el.textContent.trim());const groups=[...document.querySelectorAll('.t-select-option-group')].filter(el=>el.checkVisibility()).map(el=>el.textContent);return ['app','envoy','migrate','debugger'].every(name=>options.includes(name))&&!options.includes('LOG_LEVEL')&&groups.length===3})()`))
  await key('Escape', 'Escape', 27)
  await command('echo <script>window.executed=1</script> $(whoami)')
  check('Shell markup and substitution render literally', await evaluate('document.querySelector(".pod-terminal__viewport").textContent.includes("<script>window.executed=1</script> $(whoami)")&&!window.executed&&!document.querySelector(".pod-terminal script")'))
  await input('draft'); await key('ArrowUp', 'ArrowUp', 38)
  check('Up arrow recalls submitted command', await evaluate(`${terminal.rowsExpression}.at(-1).startsWith('$ echo <script>')`))
  await key('ArrowDown', 'ArrowDown', 40)
  check('Down arrow restores unsent draft', await evaluate(`${terminal.rowsExpression}.at(-1).trim()==='$ draft'`))
  await key('c', 'KeyC', 67, 2)
  check('Ctrl+C interrupts draft and retains session', await evaluate(`${terminal.rowsExpression}.at(-1).trim()==='$'&&!document.querySelector('.pod-terminal textarea').disabled&&${terminal.textExpression}.includes('draft^C')`))
  await selectOutput()
  check('Selected output copies full text and shows toast', await until('window.terminalCopies.length>=1&&document.querySelector(".pod-terminal__copy")?.textContent==="已复制"'))
  check('Copy preserves terminal text selection', await evaluate('!!document.querySelector(".pod-terminal .xterm-selection div")&&window.terminalCopies.at(-1).includes("checkout-api")'))
  await evaluate('window.terminalCopyFail=true'); await terminal.selectOutput(180)
  check('Clipboard failure offers native copy and preserves selection', await until('document.querySelector(".pod-terminal__copy")?.textContent.includes("手动复制")&&!!document.querySelector(".pod-terminal .xterm-selection div")'))
  await evaluate('window.terminalCopyFail=false')
  await tap('[aria-label="清空终端"]')
  check('Clear toolbar removes output without disconnecting', await evaluate(`${terminal.rowsExpression}.length===1&&!document.querySelector('.pod-terminal textarea').disabled`))
  await command('pwd'); await key('l', 'KeyL', 76, 2)
  check('Ctrl+L clears the screen', await evaluate(`${terminal.rowsExpression}.length===1`))
  const firstSession = await evaluate('document.querySelector(".pod-terminal__session").textContent')
  await select('.pod-terminal__shell', 'bash'); await connected()
  check('Shell switch creates fresh connection', await evaluate(`document.querySelector('.pod-terminal__session').textContent!==${JSON.stringify(firstSession)}&&${terminal.rowsExpression}[0].endsWith('bash')`))
  await select('.pod-terminal__shell', 'powershell'); await connected(); await command('pwd')
  check('Powershell selection updates prompt and demo directory', await evaluate(`${terminal.rowsExpression}.at(-1).trim()===${JSON.stringify('PS C:\\app>')}&&${terminal.textExpression}.includes(${JSON.stringify('C:\\app')})`))
  await select('.pod-terminal__shell', 'cmd'); await connected()
  check('Cmd shell uses Windows prompt', await evaluate(`${terminal.rowsExpression}.at(-1).trim()===${JSON.stringify('C:\\app>')}`))
  await select('.pod-terminal__shell', 'sh'); await connected()
  await select('.pod-terminal__container', 'app'); await connected('app')
  check('Container switch clears former output', await evaluate(`${terminal.rowsExpression}[0].includes('/ app')&&!${terminal.textExpression}.includes('/ envoy')`))
  await select('.pod-terminal__container', 'migrate')
  check('Completed init container displays reason and disables input', await until('document.querySelector(".pod-terminal__banner").textContent.includes("Completed")&&document.querySelector(".pod-terminal textarea").disabled&&!document.querySelector(".pod-terminal__session")'))
  await select('.pod-terminal__container', 'debugger'); await connected('debugger')
  check('Ephemeral container connects through shared workspace', await evaluate(`${terminal.rowsExpression}[0].includes('/ debugger')`))
  await tap('[aria-label="断开终端"]')
  check('Disconnect banner offers Resume and disables input', await until('document.querySelector(".pod-terminal__banner").textContent.includes("继续连接")&&document.querySelector(".pod-terminal textarea").disabled'))
  await tap('.pod-terminal__banner button'); await connected('debugger')
  check('Resume reconnects selected ephemeral container', await evaluate(`${terminal.rowsExpression}[0].includes('/ debugger')`))
  await tap('[aria-label="断开终端"]'); await tap('[aria-label="连接终端"]'); await tap('[aria-label="断开终端"]'); await delay(500)
  check('Disconnect while pending cannot revive session', await evaluate('document.querySelector(".pod-terminal textarea").disabled&&!document.querySelector(".pod-terminal__session")'))
  await tap('.pod-terminal__banner button'); await connected('debugger')
  await tap('[aria-label="终端全屏"]')
  check('Fullscreen occupies viewport with cluster/namespace/Pod metadata', await evaluate('(()=>{const el=document.querySelector(".pod-terminal--fullscreen"),r=el.getBoundingClientRect();return r.x===0&&r.y===0&&r.width===innerWidth&&r.height===innerHeight&&el.getAttribute("aria-modal")==="true"&&el.querySelector(".pod-terminal__metadata").textContent.includes("shop-dev")})()'))
  await screenshot('01-cluster-terminal-fullscreen')
  await key('Escape', 'Escape', 27)
  check('Escape restores view and invoker focus', await evaluate('!document.querySelector(".pod-terminal--fullscreen")&&document.activeElement.getAttribute("aria-label")==="终端全屏"'))
  await input(''); await key('F', 'KeyF', 70, 10)
  check('Ctrl+Shift+F toggles fullscreen from command input', await until('!!document.querySelector(".pod-terminal--fullscreen")'))
  await key('Escape', 'Escape', 27)
  const savedSession = await evaluate('document.querySelector(".pod-terminal__session").textContent')
  await tab('Manifest')
  check('Inactive terminal hides its complete workspace', await evaluate('!document.querySelector(".pod-terminal").checkVisibility()'))
  await tab('终端'); await connected('debugger')
  check('Returning to terminal retains container, shell and session', await evaluate(`document.querySelector('.pod-terminal__session').textContent===${JSON.stringify(savedSession)}&&document.querySelector('.pod-terminal__shell input').value==='sh'`))
  await call('Network.enable'); await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  check('Offline event disconnects and explains connection state', await until('document.querySelector(".pod-terminal__banner").textContent.includes("离线")&&document.querySelector(".pod-terminal textarea").disabled'))
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await delay(250)
  await tap('.pod-terminal__banner button'); await connected('debugger')
  check('Online Resume restores connection', await evaluate('!document.querySelector(".pod-terminal__banner")'))
  await command('exit')
  check('Exit command closes session', await until('document.querySelector(".pod-terminal textarea").disabled&&document.querySelector(".pod-terminal__viewport").textContent.includes("会话已关闭")'))
  await tap('.pod-terminal__banner button'); await connected('debugger'); await input(''); await key('d', 'KeyD', 68, 2)
  check('Ctrl+D closes an empty prompt', await until('document.querySelector(".pod-terminal textarea").disabled'))
  await tap('.pod-terminal__banner button'); await connected('debugger')
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await delay(300)
  check('1280px terminal fits workspace without root overflow', await evaluate('document.scrollingElement.scrollWidth<=innerWidth&&document.querySelector(".pod-terminal__viewport").getBoundingClientRect().right<=innerWidth'))
  await screenshot('02-cluster-terminal-1280')
  await go('/clusters/c-prod/resources/core/pods/shop-prod/payment-worker-6b5c4d3e2-q8w7r/terminal')
  check('Unavailable Pod state offers explicit reason and retry', await until('document.querySelector(".pod-terminal__banner").textContent.includes("CrashLoopBackOff")&&document.querySelector(".pod-terminal textarea").disabled'))
  await screenshot('03-unavailable-pod')
  await go('/projects/p-shop/apps/a-checkout/resources?env=b-checkout-dev')
  await until('!!document.querySelector(".rnode__row--container")')
  await evaluate(`(()=>{const row=[...document.querySelectorAll('.rnode__row--container')].find(el=>el.textContent.includes('envoy'));row.querySelector('button').click()})()`)
  await until('document.querySelector(".pod-logs__container input")?.value==="envoy"'); await tab('终端')
  await connected('envoy')
  check('Application container Terminal opens same selected-container component', await evaluate(`location.pathname.includes('/apps/a-checkout/resources')&&${terminal.rowsExpression}[0].includes('/ envoy')`))
  await tap('[aria-label="终端全屏"]')
  check('Application fullscreen metadata uses app/environment context', await evaluate('document.querySelector(".pod-terminal__metadata").textContent.includes("应用:")&&document.querySelector(".pod-terminal__metadata").textContent.includes("环境:")&&!document.querySelector(".pod-terminal__metadata").textContent.includes("集群:" )'))
  await screenshot('04-app-terminal-fullscreen'); await key('Escape', 'Escape', 27)
  await command('help'); await screenshot('05-app-terminal-1280')
  await go('/clusters/c-prod/terminal'); await until('!!document.querySelector(".cterm")||document.body.textContent.includes("kubectl")')
  check('Existing cluster admin terminal remains reachable', await evaluate('!document.querySelector(".pod-terminal")&&document.body.textContent.includes("kubectl")'))
  check('No browser runtime errors or warnings', browser.errors.length === 0 && browser.warnings.length === 0)
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, errors: browser.errors, warnings: browser.warnings }, null, 2))
  console.log(`Passed ${checks.length} Pod terminal browser checks`)
} catch (error) { await screenshot('failure-round39'); console.error(JSON.stringify({ errors: browser.errors, warnings: browser.warnings })); throw error }
finally { await browser.close() }
