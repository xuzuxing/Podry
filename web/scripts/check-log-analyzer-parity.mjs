// Production browser interaction checks for the local Mock Log Analyzer.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'
const output = resolve(import.meta.dirname, '../screenshots-log-analyzer-parity')
const browser = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182', output)
const { evaluate, until, screenshot, call } = browser
const cm = codeMirrorDriver(browser)
const checks = []
const text = `[...document.querySelectorAll('.log-analyzer .xterm-rows>div')].map(el=>el.textContent).join('\\n')`
const scope = `document.querySelector('.log-analyzer')`
const dialog = `[...document.querySelectorAll('.t-dialog')].find(el=>el.checkVisibility({visibilityProperty:true}))`
const base = '/projects/p-shop/apps/a-checkout/resources?env=b-checkout-dev'
const first = 'checkout-api-5b8d7c9f4-t1n9p', second = 'checkout-api-5b8d7c9f4-v8m2q'
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function tap(selector) { await until(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(220) }
async function click(label, root = scope) {
  const target = `[...${root}.querySelectorAll('button,a,.t-checkbox,.t-radio')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(label)})`
  await until(`!!(${target})`); await evaluate(`(${target}).click()`); await delay(120)
}
async function input(selector, value) { await evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(selector)});const el=root instanceof HTMLInputElement?root:root.querySelector('input');el.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`); await delay(80) }
async function key(key, code, windowsVirtualKeyCode, modifiers = 0) { await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers }); await delay(100) }
async function select(selector, label) {
  await tap(selector + ' .t-input')
  const option = `[...document.querySelectorAll('.t-select-option')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(label)})`
  await until(`!!(${option})`); await evaluate(`(${option}).click()`); await delay(350)
}
async function ready(needle) { await until(`!!document.querySelector('.log-analyzer .xterm')&&!document.querySelector('.log-analyzer__state')`); if (needle) await until(`${text}.includes(${JSON.stringify(needle)})`) }
async function search(value) { await input('.log-analyzer__search input', value); await click('搜索') }
async function custom(type) { await select('.log-analyzer__range', '自定义…'); await until(`!!${dialog}`); await click(type, dialog) }
try {
  await browser.navigate(base + '&view=analyzer'); await ready('replica metrics')
  await tap('[aria-label="停止打印日志"]')
  check('Analyzer deep link loads workload aggregate automatically', await evaluate(`location.search.includes('view=analyzer')&&document.querySelector('.log-analyzer__pod input').value==='全部 checkout-api'&&document.querySelector('.log-analyzer__counts').textContent.includes('2 / 2 个 Pod')`))
  check('Single xterm viewer includes both named source prefixes', await evaluate(`${text}.includes('${first}:')&&${text}.includes('${second}:')&&document.querySelectorAll('.log-analyzer .xterm').length===1`))
  check('Upstream style log toolbar replaces severity statistics', await evaluate(`!document.querySelector('.res__analyzer-cell')&&!!document.querySelector('[aria-label="清空日志视窗"]')&&!!document.querySelector('.log-analyzer__search')`))
  await tap('.log-analyzer__pod .t-input')
  check('Pod selector separates workload aggregate and individual Pods', await evaluate(`(()=>{const items=[...document.querySelectorAll('.t-select-option')].filter(el=>el.checkVisibility({visibilityProperty:true}));return items.length===3&&items.some(el=>el.textContent.trim()==='${first}')&&items.some(el=>el.textContent.trim()==='${second}')})()`))
  await key('Escape', 'Escape', 27)
  await tap('.log-analyzer__container .t-input')
  check('Concrete containers are grouped without an All Containers choice', await until(`(()=>{const items=[...document.querySelectorAll('.t-select-option')].filter(el=>el.checkVisibility({visibilityProperty:true})).map(el=>el.textContent.trim());return items.length===4&&['app','envoy','migrate','debugger'].every(name=>items.includes(name))&&!items.includes('全部容器')})()`))
  await key('Escape', 'Escape', 27)
  await input('.log-analyzer__search input', 'replica')
  check('Typing waits for explicit search submission', await evaluate(`document.querySelector('.log-analyzer__counts').textContent.startsWith('11 / 11')`))
  await key('Enter', 'Enter', 13)
  check('Enter searches scoped source content', await until(`document.querySelector('.log-analyzer__counts').textContent.startsWith('4 / 11')&&${text}.includes('replica server')&&!${text}.includes('dev matrix')`))
  await search('grep -C 1 "dev matrix"')
  check('Grep context stays inside matching Pod stream', await until(`document.querySelector('.log-analyzer__counts').textContent.startsWith('2 / 11')&&${text}.includes('loaded 3 keys')&&!${text}.includes('${second}:')`))
  await search(`grep "${second}:"`)
  check('Pod name can filter aggregate logs', await until(`document.querySelector('.log-analyzer__counts').textContent.startsWith('4 / 11')`))
  await search('grep -x unsupported')
  check('Invalid grep shows explicit local matching explanation', await until(`document.querySelector('.log-analyzer__notice')?.textContent.includes('支持 grep')`))
  await search('never-found')
  check('No match state leaves source download available', await until(`document.querySelector('.log-analyzer__state')?.textContent.includes('没有匹配')&&!document.querySelector('[aria-label="下载各 Pod 日志"]').disabled`))
  await evaluate(`window.analyzerDownloads=[];const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{const record={};window.analyzerDownloads.push(record);void blob.text().then(text=>record.text=text);return create(blob)};HTMLAnchorElement.prototype.click=function(){window.analyzerDownloads.at(-1).name=this.download}`)
  await tap('[aria-label="下载各 Pod 日志"]')
  check('Download creates separate full range files for both Pods', await until(`window.analyzerDownloads.length===2&&window.analyzerDownloads.every(item=>item.text&&item.name.endsWith('-app.log'))&&window.analyzerDownloads.some(item=>item.text.includes('dev matrix'))&&window.analyzerDownloads.some(item=>item.text.includes('replica server'))`))
  await search(''); await custom('设置行数'); await input('#pod-log-range-number', '0')
  check('Custom range validates zero before committing', await evaluate(`${dialog}.querySelector('.t-dialog__footer .t-button--theme-primary').disabled`))
  await input('#pod-log-range-number', '2'); await click('完成', dialog); await ready('replica metrics')
  check('Tail range applies independently to each selected Pod', await evaluate(`document.querySelector('.log-analyzer__counts').textContent.startsWith('4 / 4')&&document.querySelector('.log-analyzer__range input').value==='2 行'`))
  await custom('设置行数'); await input('#pod-log-range-number', '50'); await click('取消', dialog)
  check('Custom cancel preserves applied range and records', await evaluate(`document.querySelector('.log-analyzer__range input').value==='2 行'&&document.querySelector('.log-analyzer__counts').textContent.startsWith('4 / 4')`))
  await click('上一容器'); await ready('previous instance exited')
  check('Missing previous logs show source specific partial failure', await evaluate(`document.querySelector('.log-analyzer__failures').textContent.includes('${first}')&&document.querySelector('.log-analyzer__failures').textContent.includes('上一次终止')&&${text}.includes('${second}:')&&document.querySelector('.log-analyzer__counts').textContent.startsWith('2 / 2')`))
  await tap('[aria-label="下载各 Pod 日志"]')
  check('Partial download includes only available previous instance', await until(`window.analyzerDownloads.length===3&&window.analyzerDownloads.at(-1).name==='${second}-app-previous.log'&&window.analyzerDownloads.at(-1).text.includes('previous instance')`))
  await select('.log-analyzer__container', 'envoy'); await ready('recovered')
  check('Container switch clears previous instance and partial failure', await evaluate(`!document.querySelector('.log-analyzer__failures')&&!document.querySelector('.log-analyzer__filters .t-checkbox').classList.contains('t-is-checked')&&document.querySelector('.log-analyzer__counts').textContent.startsWith('4 / 4')`))
  await select('.log-analyzer__range', '500 行'); await ready('recovered')
  check('Aggregate counts include long virtualized Pod histories', await evaluate(`document.querySelector('.log-analyzer__counts').textContent.startsWith('163 / 163')&&document.querySelectorAll('.log-analyzer .xterm-rows>div').length<163`))
  await tap('[aria-label="分析器滚动到顶部"]')
  check('Top navigation reveals beginning and pauses following', await until(`${text}.includes('request=1 ')&&document.querySelector('.log-analyzer__status').textContent.includes('已暂停滚动')`))
  await click('自动滚动'); await ready('recovered')
  await select('.log-analyzer__container', 'debugger'); await ready('debugger attached')
  check('Missing containers are skipped with exact Pod count', await evaluate(`document.querySelector('.log-analyzer__notice').textContent.includes('1 个 Pod')&&document.querySelector('.log-analyzer__counts').textContent.includes('1 / 2 个 Pod')`))
  check('Analyzer preserves ANSI colors and literal markup safely', await evaluate(`!!document.querySelector('.log-analyzer .xterm-fg-2')&&${text}.includes('<script>')&&!document.querySelector('.log-analyzer script')&&!window.logMarkupExecuted`))
  await select('.log-analyzer__pod', second)
  check('Incompatible Pod switch asks for explicit container selection', await until(`document.querySelector('.log-analyzer__state')?.textContent.includes('请选择容器')&&!document.querySelector('.log-analyzer .xterm')`))
  await select('.log-analyzer__container', 'app'); await ready('replica metrics')
  check('Individual Pod choice never includes another source', await evaluate(`${text}.includes('${second}:')&&!${text}.includes('${first}:')`))
  await search('replica'); await click('K8s 资源', `document.querySelector('.resource-workspace-tabs__fixed')`)
  check('Switching resource tab hides analyzer', await until(`!document.querySelector('.log-analyzer').checkVisibility()&&!!document.querySelector('.res__main')`))
  await click('日志分析', `document.querySelector('.resource-workspace-tabs__fixed')`); await ready('replica metrics')
  check('Returning preserves pod container search and range selections', await evaluate(`document.querySelector('.log-analyzer__pod input').value==='${second}'&&document.querySelector('.log-analyzer__container input').value==='app'&&document.querySelector('.log-analyzer__search input').value==='replica'&&document.querySelector('.log-analyzer__range input').value==='500 行'`))
  await search(''); await select('.log-analyzer__pod', '全部 checkout-api'); await ready('replica metrics')
  await tap('[aria-label="清空日志视窗"]')
  check('Clear removes printed records without losing selectors', await until(`document.querySelector('.log-analyzer__counts').textContent.startsWith('0 / 0')&&document.querySelector('.log-analyzer__pod input').value==='全部 checkout-api'&&document.querySelector('[aria-label="下载各 Pod 日志"]').disabled`))
  await tap('[aria-label="继续打印日志"]')
  check('Resume prints independently labelled Mock lines for both Pods', await until(`document.querySelector('.log-analyzer__counts').textContent.startsWith('2 / 2')&&${text}.includes('${first}:')&&${text}.includes('${second}:')&&${text}.includes('[Mock/app]')`, 7000))
  await tap('[aria-label="停止打印日志"]'); const before = await evaluate(text); await delay(5200)
  check('Pause stops all streams without changing source history', await evaluate(`${text}===${JSON.stringify(before)}&&document.querySelector('.log-analyzer__paused').textContent.includes('Ctrl+C')`))
  await evaluate(`document.querySelector('.log-analyzer .xterm-log-viewport').focus();getSelection().removeAllRanges()`); await key('c', 'KeyC', 67, 2)
  check('Ctrl C toggles log printing from focused viewport', await until(`!document.querySelector('.log-analyzer__paused')`))
  await tap('[aria-label="停止打印日志"]'); await tap('[aria-label="重新连接分析器"]'); await ready('replica metrics')
  check('Reconnect restores history after clear', await evaluate(`document.querySelector('.log-analyzer__counts').textContent.startsWith('11 / 11')`))
  await click('自动换行')
  check('Wrap uses shared xterm viewport', await evaluate(`document.querySelector('.log-analyzer .xterm-log-viewport').classList.contains('is-wrapped')`))
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await delay(250)
  check('1280px fits sidebar toolbar and log viewport without page overflow', await evaluate(`document.scrollingElement.scrollWidth<=innerWidth&&document.querySelector('.log-analyzer').getBoundingClientRect().right<=innerWidth`))
  await screenshot('01-aggregate-1280')
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await click('K8s 资源', `document.querySelector('.resource-workspace-tabs__fixed')`)
  await click('Manifest', `document.querySelector('.res__main')`); await until(`!!document.querySelector('.resource-manifest .cm-content')`)
  await click('编辑实时 Manifest', `document.querySelector('.resource-manifest')`)
  const content = '.resource-manifest[data-mode=edit] .cm-content'
  await cm.write(content, await cm.read(content) + '\n# analyzer guard\n')
  await click('日志分析', `document.querySelector('.resource-workspace-tabs__fixed')`); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('Analyzer entry respects resource Manifest draft guard', await evaluate(`!!document.querySelector('.resource-manifest[data-mode=edit]')&&!document.querySelector('.log-analyzer').checkVisibility()`))
  await click('日志分析', `document.querySelector('.resource-workspace-tabs__fixed')`); await until(`!!${dialog}`); await click('放弃修改', dialog); await ready('replica metrics')
  check('Discarding draft opens analyzer without stale resource tab', await evaluate(`!document.querySelector('.rpanel')&&location.search.includes('view=analyzer')&&!location.search.includes('tab=')`))
  await click('上一容器'); await ready('previous instance exited'); await screenshot('02-partial-previous')
  await browser.navigate('/projects/p-shop/apps/a-checkout/resources?env=b-checkout-prod&view=analyzer'); await ready('metrics flush')
  check('Environment deep link cannot reuse dev source records', await evaluate(`!${text}.includes('${first}')&&!${text}.includes('${second}')&&document.querySelector('.log-analyzer__counts').textContent.includes('1 / 1 个 Pod')`))
  await browser.navigate('/projects/p-shop/apps/a-checkout/resources?env=b-checkout-staging&view=analyzer')
  check('No Pod environment hides analyzer and repairs invalid deep link', await until(`!!document.querySelector('.res__main')&&!document.querySelector('.log-analyzer')&&!location.search.includes('view=analyzer')&&![...document.querySelectorAll('.resource-workspace-tabs__fixed button')].some(el=>el.textContent.includes('日志分析'))`))
  check('No browser errors or console warnings', browser.errors.length === 0 && browser.warnings.length === 0)
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, errors: browser.errors, warnings: browser.warnings }, null, 2))
  console.log(`Passed ${checks.length} Log Analyzer browser checks; frontend Mock only`)
} catch (error) { console.error(JSON.stringify({ url: await evaluate('location.href'), errors: browser.errors, warnings: browser.warnings })); await screenshot('failure-round40'); throw error }
finally { await browser.close() }
