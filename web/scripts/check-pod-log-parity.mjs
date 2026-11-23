// Production browser checks of local Pod logs/events. No real cluster connection.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
const output = resolve(import.meta.dirname, '../screenshots-pod-log-parity')
const browser = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182', output)
const { evaluate, until, screenshot, call } = browser
const checks = []
const workspace = 'document.querySelector(".pod-logs")'
const logText = `[...document.querySelectorAll('.pod-logs .xterm-rows>div')].map(el=>el.textContent).join('\\n')`
const dialog = '[...document.querySelectorAll(".t-dialog")].find(el=>el.checkVisibility({visibilityProperty:true}))'
const dev = '/clusters/c-dev/resources/core/pods/shop-dev/checkout-api-5b8d7c9f4-t1n9p/logs'
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function click(text, scope = 'document') {
  const item = `[...${scope}.querySelectorAll('button,a,.t-checkbox,.t-radio')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)})`
  await until(`!!(${item})`); await evaluate(`(${item}).click()`); await delay(170)
}
async function tap(selector) { await until(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(150) }
async function input(selector, value) {
  await evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(selector)});const el=root instanceof HTMLInputElement?root:root.querySelector('input');el.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`); await delay(100)
}
async function key(key, code, windowsVirtualKeyCode, modifiers = 0) { await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers }); await delay(100) }
async function select(selector, label) {
  await tap(selector + ' .t-input')
  const option = `[...document.querySelectorAll('.t-select-option')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(label)})`
  await until(`!!(${option})`); await evaluate(`(${option}).click()`); await delay(400)
}
async function go(path) { await evaluate(`void document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`); await delay(700) }
async function ready(text) {
  await until(`!!document.querySelector('.pod-logs__viewport')&&!document.querySelector('.pod-logs__state')`)
  if (!await evaluate(`document.querySelector('.pod-logs__viewport').textContent.includes(${JSON.stringify(text)})`)) await tap('[aria-label="滚动到日志底部"]')
  await until(`document.querySelector('.pod-logs__viewport').textContent.includes(${JSON.stringify(text)})`)
}
async function custom(type) { await select('.pod-logs__range', '自定义…'); await until(`!!${dialog}`); if (type) await click(type, dialog) }
try {
  await browser.navigate(dev + '?container=envoy'); await ready('envoy request=160')
  check('Cluster log deep link preserves tab and initial container', await evaluate('document.querySelector(".rpanel__tabsbar .rpanel__tab--active").textContent==="日志"&&document.querySelector(".pod-logs__container input").value==="envoy"'))
  check('Unified container/range/search toolbar and explicit Mock stream', await evaluate('!!document.querySelector(".pod-logs__toolbar .pod-logs__search")&&document.querySelector(".pod-logs__status").textContent.includes("Mock")'))
  await tap('.pod-logs__container .t-input')
  check('Grouped ordinary/init/ephemeral options exclude env names', await evaluate(`(()=>{const options=[...document.querySelectorAll('.t-select-option')].filter(el=>el.checkVisibility({visibilityProperty:true})).map(el=>el.textContent.trim());return ['app','envoy','migrate','debugger'].every(name=>options.includes(name))&&!options.includes('LOG_LEVEL')})()`))
  await key('Escape', 'Escape', 27)
  await click('暂停', workspace)
  await input('.pod-logs__search input', 'grep status=503 | grep request=1')
  check('Typing search waits for explicit submit', await evaluate('Number(document.querySelector(".pod-logs__view-tools > span").textContent.split("/")[0])>=160'))
  await key('Enter', 'Enter', 13)
  check('Enter applies grep pipeline in display order', await until('Number(document.querySelector(".pod-logs__view-tools > span").textContent.split("/")[0])===8&&[...document.querySelectorAll(".pod-logs .xterm-rows>div")].filter(el=>el.textContent.trim()).every(el=>el.textContent.includes("status=503")&&el.textContent.includes("request=1"))'))
  await input('.pod-logs__search input', 'grep -C 1 "request=42 "'); await click('搜索', workspace)
  check('Context includes only selected line and neighboring lines', await until('Number(document.querySelector(".pod-logs__view-tools > span").textContent.split("/")[0])===3&&document.querySelector(".pod-logs .xterm-rows>div").textContent.includes("request=41 ")'))
  await input('.pod-logs__search input', 'grep -x error'); await click('搜索', workspace)
  check('Unsupported grep expression is explained without execution', await until('document.querySelector(".pod-logs__notice")?.textContent.includes("支持 grep")'))
  await input('.pod-logs__search input', '<script>'); await click('搜索', workspace)
  check('No-match state and text-only rendering', await until('document.querySelector(".pod-logs__state")?.textContent.includes("没有匹配")&&!document.querySelector(".pod-logs script")'))
  await input('.pod-logs__search input', 'status=503'); await click('搜索', workspace)
  await evaluate(`window.podLogDownloads=[];const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{void blob.text().then(text=>window.podLogDownloads.push({text}));return create(blob)};HTMLAnchorElement.prototype.click=function(){window.podLogDownloadName=this.download}`)
  await tap('[aria-label="下载日志"]')
  check('Download contains full selected range despite search filter', await until('window.podLogDownloads[0]?.text.includes("request=160")&&window.podLogDownloads[0].text.includes("status=200")&&window.podLogDownloadName.endsWith("-envoy.log")'))
  await input('.pod-logs__search input', ''); await click('搜索', workspace)
  await custom('设置行数'); await input('#pod-log-range-number', '0')
  check('Zero line range disables confirm with validation', await evaluate(`${dialog}.textContent.includes('大于 0')&&${dialog}.querySelector('.t-dialog__footer .t-button--theme-primary').disabled`))
  await input('#pod-log-range-number', '2'); await click('完成', dialog); await ready('envoy request=160')
  check('Custom tail line count applied atomically', await evaluate('Number(document.querySelector(".pod-logs__view-tools > span").textContent.split("/")[0])===2&&document.querySelector(".pod-logs .xterm-rows>div").textContent.includes("request=159")'))
  await custom('设置时长'); await input('#pod-log-range-number', '1.5')
  check('Fractional duration rejected', await evaluate(`${dialog}.textContent.includes('整数')`))
  await input('#pod-log-range-number', '20'); await click('取消', dialog)
  check('Cancel custom range restores saved range and logs', await evaluate('document.querySelector(".pod-logs__range input").value==="2 行"&&Number(document.querySelector(".pod-logs__view-tools > span").textContent.split("/")[0])===2'))
  await custom('指定日期和时间'); await input('#pod-log-range-date', '2099-01-01T10:00')
  check('Future absolute start time rejected and browser timezone visible', await evaluate(`${dialog}.textContent.includes('不能晚于')&&${dialog}.textContent.includes('浏览器时区')`))
  check('Custom dialog has no clipped radio controls or horizontal overflow', await evaluate(`(()=>{const body=${dialog}.querySelector('.t-dialog__body');const group=document.querySelector('.pod-log-range__types').getBoundingClientRect();return body.scrollWidth<=body.clientWidth+1&&[...document.querySelectorAll('.pod-log-range__types .t-radio')].every(el=>{const icon=el.querySelector('.t-radio__input').getBoundingClientRect(),label=el.querySelector('.t-radio__label').getBoundingClientRect();return icon.left>=group.left&&label.left>=icon.right&&Math.abs(icon.top-label.top)<8})})()`))
  await screenshot('04-custom-log-range')
  await input('#pod-log-range-date', '2026-11-21T00:00'); await click('完成', dialog)
  check('Out-of-range log time displays empty with download disabled', await until('document.querySelector(".pod-logs__state")?.textContent.includes("当前范围内没有日志")&&document.querySelector("[aria-label=下载日志]").disabled'))
  await custom('全部可用日志'); await click('完成', dialog); await ready('envoy request=160')
  check('All available range restores full history', await evaluate('Number(document.querySelector(".pod-logs__view-tools > span").textContent.split("/")[0])>=160&&document.querySelector(".pod-logs__range input").value==="全部可用日志"'))
  await click('继续', workspace)
  check('Resume prints new explicitly marked Mock lines', await until('document.querySelector(".pod-logs__viewport")?.textContent.includes("[Mock/envoy]")', 7000))
  await click('暂停', workspace)
  const pausedText = await evaluate(logText)
  await delay(5200)
  check('Pause stops simulated printing and shows resume strip', await evaluate(logText + '===' + JSON.stringify(pausedText) + '&&document.querySelector(".pod-logs__paused").textContent.includes("Ctrl+C")'))
  await evaluate('document.querySelector(".pod-logs__viewport").focus();getSelection().removeAllRanges()'); await key('c', 'KeyC', 67, 2)
  check('Ctrl+C resumes from focused log viewport', await until('!document.querySelector(".pod-logs__paused")'))
  const point = await evaluate(`(()=>{const r=document.querySelector('.pod-logs .xterm-screen').getBoundingClientRect();return {x:r.x+100,y:r.y+50}})()`)
  await call('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: -100000 }); await delay(250)
  check('Manual scroll pauses following', await evaluate('document.querySelector(".pod-logs__status").textContent.includes("已暂停滚动")'))
  await click('自动滚动', workspace)
  check('Follow toggle returns to bottom', await until(`${logText}.includes('[Mock/envoy]')`))
  await tap('[aria-label="滚动到日志顶部"]')
  check('Top navigation stays in log viewport and pauses follow', await until(`document.querySelector('.pod-logs .xterm-rows>div')?.textContent.includes('request=1 ')&&document.querySelector('.pod-logs__status').textContent.includes('已暂停滚动')`))
  await tap('[aria-label="滚动到日志底部"]')
  check('Bottom navigation does not implicitly enable following', await until(`${logText}.includes('[Mock/envoy]')&&document.querySelector('.pod-logs__status').textContent.includes('已暂停滚动')`))
  await click('自动换行', workspace)
  check('Wrap enabled without changing log text', await evaluate('document.querySelector(".pod-logs__viewport").classList.contains("is-wrapped")'))
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await delay(180)
  await screenshot('01-cluster-logs-1280')
  check('1280px toolbar wraps and viewport scrolls internally', await evaluate('document.scrollingElement.scrollWidth<=innerWidth&&!!document.querySelector(".pod-logs .xterm-scrollable-element")'))
  await click('上一容器', workspace)
  check('Missing previous instance has explicit unavailable state', await until('document.querySelector(".pod-logs__state")?.textContent.includes("上一次终止")&&document.querySelector("[aria-label=下载日志]").disabled'))
  await select('.pod-logs__container', 'migrate'); await ready('migration version=42')
  check('Container change clears previous instance and shows init history', await evaluate('!document.querySelector(".pod-logs__filters .t-checkbox").classList.contains("t-is-checked")&&document.querySelector(".pod-logs__status").textContent.includes("历史日志")'))
  await select('.pod-logs__container', 'debugger'); await ready('debugger attached')
  check('Ephemeral container has own history', await evaluate('!document.querySelector(".pod-logs__viewport").textContent.includes("migration")'))
  await select('.pod-logs__container', 'app'); await select('.pod-logs__container', 'envoy'); await ready('envoy request=160')
  check('Rapid container change displays latest container only', await evaluate('!document.querySelector(".pod-logs__viewport").textContent.includes("dev matrix")'))
  await click('Manifest', 'document.querySelector(".rpanel__tabsbar")')
  check('Inactive logs stop presenting stream', await evaluate('!document.querySelector(".pod-logs").checkVisibility()'))
  await click('日志', 'document.querySelector(".resource-manifest")'); await ready('envoy request=160')
  check('Returning to logs keeps container and saved range', await evaluate('document.querySelector(".pod-logs__container input").value==="envoy"&&document.querySelector(".pod-logs__range input").value==="全部可用日志"'))
  await go('/clusters/c-prod/resources/core/pods/shop-prod/payment-worker-6b5c4d3e2-q8w7r/logs'); await ready('worker  booting')
  await click('上一容器', workspace); await ready('previous instance exited')
  check('Previous logs use independent terminated instance fixture', await evaluate('Number(document.querySelector(".pod-logs__view-tools > span").textContent.split("/")[0])===3&&!document.querySelector(".pod-logs__viewport").textContent.includes("worker  booting")'))
  await tap('[aria-label="下载日志"]')
  check('Previous log download filename distinguishes instance', await until('window.podLogDownloadName.endsWith("-app-previous.log")'))
  const tabs = 'document.querySelector(".rpanel__tabsbar")'
  await click('事件', tabs)
  check('Events workspace sorts latest first and shows six upstream columns', await until('document.querySelectorAll(".resource-events th").length===6&&document.querySelector(".resource-events tbody tr").textContent.includes("BackOff")&&document.querySelectorAll(".resource-events tbody tr").length===3'))
  check('Events distinguish warning/normal and include age', await evaluate('document.querySelectorAll(".resource-events .is-warning").length===2&&document.querySelectorAll(".resource-events .is-normal").length===1&&document.querySelector(".resource-events tbody tr td:nth-child(5)").textContent!=="—"'))
  await click('刷新事件', 'document.querySelector(".resource-events")')
  check('Events refresh restores correct resource rows', await until('document.querySelectorAll(".resource-events tbody tr").length===3'))
  await screenshot('02-resource-events')
  await go('/clusters/c-prod/resources/apps/deployments/shop-prod/checkout-api/logs')
  check('Non-Pod invalid log deep link falls back to Manifest', await until('!!document.querySelector(".resource-manifest")?.checkVisibility()&&!document.querySelector(".pod-logs")'))
  await go('/projects/p-shop/apps/a-checkout/resources?env=b-checkout-dev')
  await until('!!document.querySelector(".rnode__row--container")')
  check('Application resource hierarchy excludes environment variable names', await evaluate('![...document.querySelectorAll(".rnode__row--container")].some(el=>el.textContent.includes("LOG_LEVEL"))'))
  await evaluate(`(()=>{const row=[...document.querySelectorAll('.rnode__row--container')].find(el=>el.textContent.includes('envoy'));row.querySelector('button').click()})()`); await ready('envoy request=160')
  check('Application container Logs opens same workspace with selected container', await evaluate('document.querySelector(".pod-logs__container input").value==="envoy"&&location.pathname.includes("/apps/a-checkout/resources")'))
  await screenshot('03-application-logs-1280')
  check('Application log workspace fits 1280px without root overflow', await evaluate('document.scrollingElement.scrollWidth<=innerWidth'))
  await click('事件', 'document.querySelector(".rpanel__tabsbar")')
  check('Resource with no events shows scoped empty state', await until('document.querySelector(".resource-events").textContent.includes("最近没有产生")&&!document.querySelector(".resource-events tbody")'))
  check('No runtime errors', browser.errors.length === 0)
  check('No console warnings', browser.warnings.length === 0)
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, errors: browser.errors, warnings: browser.warnings }, null, 2))
  console.log(`Passed ${checks.length} Pod log browser checks`)
} catch (error) { await screenshot('failure-round39'); console.error(browser.errors, browser.warnings); throw error }
finally { await browser.close() }
