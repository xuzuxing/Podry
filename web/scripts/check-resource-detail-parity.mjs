// Shared detail toolbar, URL restoration and navigation guards. Frontend Mock only.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'
const output = resolve(import.meta.dirname, '../screenshots-resource-detail-parity')
const b = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182', output)
const { evaluate, until, screenshot, call } = b
const cm = codeMirrorDriver(b)
const checks = []
const dialog = '[...document.querySelectorAll(".t-dialog")].find(el=>el.checkVisibility({visibilityProperty:true}))'
const bar = '[...document.querySelectorAll(".resource-manifest__toolbar,.rpanel__tabsbar")].find(el=>el.checkVisibility({visibilityProperty:true}))'
const podId = 'c-dev|c-dev||pods|shop-dev|checkout-api-5b8d7c9f4-t1n9p'
const appId = 'app:a-checkout:c-dev|c-dev||pods|shop-dev|checkout-api-5b8d7c9f4-t1n9p'
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function click(text, scope = 'document') {
  assert.ok(await evaluate(`(()=>{const el=[...${scope}.querySelectorAll('button,.t-dropdown__item')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)});if(!el)return false;el.click();return true})()`), 'Missing action ' + text)
  await delay(120)
}
async function tap(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(120) }
async function go(path) { await evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)}).then(result=>result?.message||'')`); await delay(200) }
async function mode(value) { await click(value, `(${bar}).querySelector('.resource-detail-tabs')`) }
async function selectContainer(selector, name) {
  await tap(selector + ' .t-input')
  const option = `[...document.querySelectorAll('.t-select-option')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(name)})`
  await until(`!!(${option})`); await evaluate(`(${option}).click()`)
  await until(`new URLSearchParams(location.search).get('container')===${JSON.stringify(name)}`)
}
async function read() { await until('!!document.querySelector(".resource-manifest[data-mode=read] .resource-yaml .cm-content")') }
async function draft() {
  await click('编辑实时 Manifest', 'document.querySelector(".resource-manifest")')
  const selector = '.resource-manifest[data-mode=edit] .resource-yaml .cm-content'
  const value = await cm.read(selector) + '\n# detail-location-draft\n'
  await cm.write(selector, value); return value
}
try {
  await b.navigate('/clusters/c-prod/resources/apps/deployments/shop-prod/checkout-api/manifest'); await read()
  check('Detail removes the extra visible identity bar', await evaluate('!document.querySelector(".rpanel__bar")&&document.querySelector(".rpanel").getAttribute("aria-label")==="Deployment / checkout-api"'))
  check('Tabs and edit action share a compact row', await evaluate(`(()=>{const el=${bar},a=el.querySelector('.resource-detail-tabs').getBoundingClientRect(),c=el.querySelector('.resource-manifest__actions').getBoundingClientRect();return el.getBoundingClientRect().height<=33&&Math.abs(a.top-c.top)<2&&c.left-a.right<=14})()`))
  check('Workload restart follows Manifest actions', await evaluate(`(${bar}).querySelector('.resource-detail-actions__primary').textContent.includes('重启')`))
  check('Infrastructure delete aligns with right edge', await evaluate(`(()=>{const a=(${bar}).getBoundingClientRect(),d=(${bar}).querySelector('.resource-detail-actions__delete').getBoundingClientRect();return a.right-d.right>=16&&a.right-d.right<=24})()`))
  check('Exports stay in the editor footer', await evaluate(`!!document.querySelector('.resource-manifest__footer [aria-label="复制 Manifest"]')&&!document.querySelector('.resource-manifest__toolbar [aria-label="复制 Manifest"]')`))
  await tap('[aria-label="更多资源操作"]'); await click('扩缩容')
  check('Overflow retains scale workflow with resource identity', await until(`!!${dialog}&&${dialog}.textContent.includes('扩缩容')&&${dialog}.textContent.includes('checkout-api')`))
  await click('取消', dialog)
  await until(`!${dialog}`); await delay(250)
  await screenshot('01-infrastructure-manifest')
  const dirty = await draft()
  const before = await evaluate('location.href')
  await mode('事件'); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('Cancelled subtab navigation retains URL and draft', await evaluate(`location.href===${JSON.stringify(before)}`) && await cm.read('.resource-manifest[data-mode=edit] .resource-yaml .cm-content') === dirty)
  await mode('事件'); await until(`!!${dialog}`); await click('放弃修改', dialog)
  check('Confirmed navigation records events in URL', await until('new URLSearchParams(location.search).get("resourceTab")==="events"&&!!document.querySelector(".rpanel__tabsbar")'))
  check('Events keeps Infrastructure delete in the same compact row', await evaluate(`(${bar}).getBoundingClientRect().height<=33&&!!(${bar}).querySelector('.resource-detail-actions__delete')`))
  await evaluate('history.back()'); await read()
  check('Browser Back restores Manifest detail mode', await evaluate('new URLSearchParams(location.search).get("resourceTab")==="manifest"'))
  await evaluate('history.forward()'); await until('new URLSearchParams(location.search).get("resourceTab")==="events"')
  check('Browser Forward restores Events detail mode', await evaluate(`(${bar}).querySelector('[aria-selected=true]').textContent.includes('事件')`))
  await go('/clusters/c-dev?tab=' + encodeURIComponent(podId) + '&resourceTab=logs&container=envoy&namespace=shop-dev&searchKey=checkout')
  await until('document.querySelector(".pod-logs__container input")?.value==="envoy"')
  check('Canonical Pod URL restores a resource absent from saved tabs', await evaluate('document.querySelector(".rpanel__kind").textContent==="Pod"&&document.querySelector(".resource-workspace-tabs__item[data-selected=true]").textContent.includes("checkout-api")'))
  check('Logs respects URL container and retains list query', await evaluate('new URLSearchParams(location.search).get("namespace")==="shop-dev"&&new URLSearchParams(location.search).get("searchKey")==="checkout"&&document.querySelector(".pod-logs__container input").value==="envoy"'))
  await mode('终端'); await until('document.querySelector(".pod-terminal__container input")?.value==="envoy"')
  check('Terminal transition updates URL and retains container', await evaluate('new URLSearchParams(location.search).get("resourceTab")==="terminal"&&new URLSearchParams(location.search).get("container")==="envoy"'))
  await selectContainer('.pod-terminal__container', 'app')
  check('Container selection writes URL without leaving Terminal', await evaluate('new URLSearchParams(location.search).get("resourceTab")==="terminal"'))
  await mode('日志'); await until('document.querySelector(".pod-logs__container input")?.value==="app"')
  await evaluate('history.back()'); await until(`(${bar}).querySelector('[aria-selected=true]').textContent==='终端'`)
  check('Back restores previous mode and chosen container', await evaluate('document.querySelector(".pod-terminal__container input").value==="app"'))
  const fresh = await evaluate('location.pathname+location.search')
  await evaluate('localStorage.removeItem("podry:resource-tabs")')
  await b.navigate(fresh); await until('document.querySelector(".pod-terminal__container input")?.value==="app"')
  check('Fresh browser session restores terminal from URL alone', await evaluate('document.querySelector(".resource-workspace-tabs__item[data-selected=true]").textContent.includes("checkout-api")&&new URLSearchParams(location.search).get("resourceTab")==="terminal"'))
  await screenshot('02-infrastructure-terminal')
  await mode('Manifest'); await read(); await draft()
  const dirtyURL = await evaluate('location.href')
  await evaluate('history.back()'); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('Cancelled browser Back restores history URL and editor', await until(`location.href===${JSON.stringify(dirtyURL)}&&!!document.querySelector('.resource-manifest[data-mode=edit] .resource-yaml .cm-content')`))
  await mode('事件'); await until(`!!${dialog}`); await click('放弃修改', dialog)
  await click('Deployment', 'document.querySelector(".resource-workspace-tabs__fixed")')
  check('Fixed listing clears detail-only URL parameters', await until('!document.querySelector(".rpanel")&&!new URLSearchParams(location.search).has("resourceTab")&&!new URLSearchParams(location.search).has("container")'))
  await go('/clusters/c-prod?tab=' + encodeURIComponent('c-prod|c-prod|apps|deployments|shop-prod|checkout-api') + '&resourceTab=terminal&container=envoy')
  await read()
  check('Non Pod deep link falls back to Manifest and clears stale container state', await evaluate('document.querySelector(".resource-detail-tabs [aria-selected=true]").textContent==="Manifest"&&!document.querySelector(".pod-terminal")'))
  await go('/clusters/c-dev?tab=' + encodeURIComponent('c-prod|c-prod|apps|deployments|shop-prod|checkout-api') + '&resourceTab=logs')
  check('Foreign cluster tab ID cannot open a resource panel', await until('!document.querySelector(".rpanel")&&!!document.querySelector(".ws")'))
  await go('/projects/p-shop/apps/a-checkout/resources?env=b-checkout-dev&tab=' + encodeURIComponent(appId) + '&resourceTab=terminal&container=envoy')
  await until('document.querySelector(".pod-terminal__container input")?.value==="envoy"')
  check('Application canonical URL restores a fresh resource tab', await evaluate('!!document.querySelector(".resource-workspace-tabs--application")&&document.querySelectorAll(".resource-workspace-tabs__item").length===1'))
  check('Application details hide Infrastructure-only delete', await evaluate(`!(${bar}).querySelector('.resource-detail-actions__delete')`))
  await mode('Manifest'); await read()
  check('Application Manifest also uses the shared compact toolbar', await evaluate(`(${bar}).getBoundingClientRect().height<=33&&!(${bar}).querySelector('.resource-detail-actions__delete')`))
  await mode('日志'); await until('document.querySelector(".pod-logs__container input")?.value==="envoy"')
  await selectContainer('.pod-logs__container', 'app')
  check('Application changes container in URL and cluster jump link', await until('(()=>{const a=new URL(document.querySelector(".res__tabs-link").href);return a.searchParams.get("openTab")==="logs"&&a.searchParams.get("openContainer")==="app"})()'))
  await evaluate('history.back()'); await read()
  check('Application history restores Manifest with environment intact', await evaluate('new URLSearchParams(location.search).get("env")==="b-checkout-dev"&&new URLSearchParams(location.search).get("resourceTab")==="manifest"'))
  await mode('终端'); await until('!!document.querySelector(".pod-terminal__input")')
  const appURL = await evaluate('location.pathname+location.search')
  await evaluate('localStorage.removeItem("podry:resource-tabs")'); await b.navigate(appURL)
  check('Application deep link survives cleared saved tab state', await until('!!document.querySelector(".pod-terminal__input")&&new URLSearchParams(location.search).get("env")==="b-checkout-dev"'))
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await delay(200)
  check('1280px application detail and toolbar stay within viewport', await evaluate(`document.documentElement.scrollWidth===innerWidth&&(${bar}).getBoundingClientRect().right<=innerWidth`))
  await screenshot('03-application-terminal-1280')
  await mode('Manifest'); await read(); const appDraft = await draft()
  await mode('日志'); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('Application cancelled detail transition preserves URL and draft', await evaluate(`new URLSearchParams(location.search).get('resourceTab')==='manifest'`) && await cm.read('.resource-manifest[data-mode=edit] .resource-yaml .cm-content') === appDraft)
  await click('预览并保存修改', 'document.querySelector(".resource-manifest")'); await until('!!document.querySelector(".resource-manifest__review")')
  check('Review actions remain inline with tabs at 1280px', await evaluate(`(()=>{const el=${bar};return el.getBoundingClientRect().height<=33&&el.querySelector('.resource-manifest__actions').getBoundingClientRect().right<=innerWidth&&document.querySelector('.resource-manifest__review').getBoundingClientRect().width>500})()`))
  await screenshot('04-application-review-1280')
  await click('取消', 'document.querySelector(".resource-manifest")'); await until(`!!${dialog}`); await click('放弃修改', dialog)
  await click('K8s 资源', 'document.querySelector(".resource-workspace-tabs__fixed")')
  check('Application fixed resource list drops mode and container query', await until('!document.querySelector(".rpanel")&&!new URLSearchParams(location.search).has("resourceTab")&&!new URLSearchParams(location.search).has("container")'))
  await go('/clusters/c-prod/resources/core/secrets/shop-prod/checkout-api-secret/manifest'); await read()
  await tap('[aria-label="更多资源操作"]'); await click('查看明文')
  check('Secret reveal workflow remains available from overflow', await until(`!!${dialog}&&${dialog}.textContent.includes('Secret 明文')&&${dialog}.textContent.includes('secret.reveal')`))
  assert.deepEqual(b.errors, []); assert.deepEqual(b.warnings, [])
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, count: checks.length, errors: b.errors, warnings: b.warnings }, null, 2))
  console.log(`${checks.length} resource detail browser checks passed`)
} catch (error) { await screenshot('failure'); console.error('Browser errors:', b.errors, b.warnings); throw error }
finally { await b.close() }
