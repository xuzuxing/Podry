// Production browser coverage of shared resource tabs. Frontend Mock only.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'
const output = resolve(import.meta.dirname, '../screenshots-resource-tabs-parity')
const browser = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182', output)
const { evaluate, until, screenshot, call } = browser
const cm = codeMirrorDriver(browser)
const checks = []
const dialog = '[...document.querySelectorAll(".t-dialog")].find(el=>el.checkVisibility({visibilityProperty:true}))'
const picker = '[...document.querySelectorAll(".resource-tabs-picker")].find(el=>el.checkVisibility({visibilityProperty:true}))'
const selected = 'document.querySelector(".resource-workspace-tabs__item[data-selected=true]")'
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function tap(selector) { await until(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(180) }
async function click(text, scope = 'document') {
  const target = `[...${scope}.querySelectorAll('button,a,.t-dropdown__item,.t-select-option')].find(el=>el.checkVisibility({visibilityProperty:true})&&!el.disabled&&el.textContent.trim()===${JSON.stringify(text)})`
  await until(`!!(${target})`); await evaluate(`(${target}).click()`); await delay(180)
}
async function input(selector, text, textarea = false) {
  if (selector.includes('.cm-content')) { await cm.write(selector, text); return }
  await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();Object.getOwnPropertyDescriptor(${textarea ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`); await delay(100)
}
async function go(path) { const failure = await evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)}).then(result=>result?.message||'')`); assert.ok(!failure || failure.includes('redundant'), failure); await delay(350) }
async function key(key, code = key, windowsVirtualKeyCode = 0) { await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, ...(key === 'Enter' ? { text: '\r' } : {}) }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode }); await delay(120) }
async function open(cluster, group, kind, namespace, name, tab = 'manifest') { await go(`/clusters/${cluster}/resources/${group || '_'}/${kind}/${namespace}/${name}/${tab}`); await until(`document.querySelector('.rpanel__name')?.textContent===${JSON.stringify(name)}&&!document.querySelector('.rpanel .t-loading--loading')`); await delay(100) }
async function selectTab(label) { await click(label, 'document.querySelector(".resource-workspace-tabs__strip")'); await until(`${selected}?.textContent.trim()===${JSON.stringify(label)}`); await delay(150) }
async function showPicker() { await tap('[aria-label="搜索已打开的资源页签"]'); await until(`!!${picker}`); await until('document.activeElement?.closest(".resource-tabs-picker")&&document.activeElement.tagName==="INPUT"'); await until(`!(${picker}).closest('.t-popup').getAnimations({subtree:true}).some(animation=>animation.playState==='running')`) }
async function hidePicker() { await key('Escape', 'Escape', 27); await until(`!${picker}`) }
async function selectOption(name) { const target = `[...(${picker}).querySelectorAll('.resource-tabs-picker__option')].find(el=>el.querySelector('.resource-tabs-picker__name').textContent===${JSON.stringify(name)})`; await until(`!!(${target})`); await evaluate(`(${target}).click()`); await until(`!${picker}`); await delay(250) }
async function startDraft(comment) { await click('编辑实时 Manifest', 'document.querySelector(".resource-manifest")'); const original = await cm.read(".resource-manifest[data-mode=edit] .resource-yaml .cm-content"); await input('.resource-manifest[data-mode=edit] .resource-yaml .cm-content', original + comment, true); return original + comment }
async function selectContainer(selector, name) { await tap(selector + ' .t-input'); await click(name, 'document'); await until(`document.querySelector(${JSON.stringify(selector + ' input')})?.value===${JSON.stringify(name)}`) }
try {
  await browser.navigate('/clusters/c-prod?resource=deployments&group=apps')
  await until('document.querySelectorAll(".resource-name__link").length>=3')
  await click('checkout-api', 'document.querySelector(".resource-table")')
  await until('!!document.querySelector(".resource-manifest .resource-yaml .cm-content")')
  check('List entry opens shared dynamic resource strip', await evaluate('document.querySelectorAll(".resource-workspace-tabs__item").length===1&&!!document.querySelector("[aria-label=刷新当前资源]")'))
  check('Sync indicator follows actual initial detail load', await until('document.querySelector(".resource-workspace-tabs__sync")?.textContent.includes("同步")'))
  check('Close action is a native sibling button with resource label', await evaluate(`${selected}.querySelector('.resource-workspace-tabs__close').tagName==='BUTTON'&&!${selected}.querySelector('button button')&&${selected}.querySelector('.resource-workspace-tabs__close').getAttribute('aria-label').includes('Deployment/checkout-api')`))
  for (const [group, kind, name] of [['apps','deployments','payment-worker'], ['apps','deployments','storefront'], ['', 'services', 'checkout-api'], ['', 'configmaps', 'checkout-api-config'], ['', 'secrets', 'checkout-api-secret'], ['networking.k8s.io', 'ingresses', 'checkout-api'], ['apps', 'replicasets', 'checkout-api-7d9f8b6c5'], ['', 'pods', 'checkout-api-7d9f8b6c5-x2k4m']]) await open('c-prod', group, kind, 'shop-prod', name)
  check('Many resource tabs remain within horizontally scrolling strip', await evaluate('(()=>{const el=document.querySelector(".resource-workspace-tabs__strip");return el.scrollWidth>el.clientWidth&&document.querySelectorAll(".resource-workspace-tabs__item").length===9&&document.documentElement.scrollWidth===innerWidth})()'))
  check('Active resource auto scrolls into strip without moving fixed tabs', await evaluate(`(()=>{const row=${selected}.getBoundingClientRect(),strip=document.querySelector('.resource-workspace-tabs__strip').getBoundingClientRect(),fixed=document.querySelector('.resource-workspace-tabs__fixed').getBoundingClientRect();return row.right<=strip.right+2&&row.left>=strip.left-2&&fixed.left>=0})()`))
  await showPicker()
  check('Search picker lists resources with namespace and API group', await evaluate(`(${picker}).querySelectorAll('.resource-tabs-picker__row').length===9&&(${picker}).textContent.includes('shop-prod · apps')`))
  check('Picker marks selected resource and exposes combobox relationship', await evaluate(`(${picker}).querySelector('[role=option][aria-selected=true]')?.textContent.includes('checkout-api-7d9f8b6c5-x2k4m')&&(${picker}).querySelector('[role=combobox]').getAttribute('aria-controls')===(${picker}).querySelector('[role=listbox]').id`))
  await screenshot('01-infrastructure-tab-picker')
  await input('.resource-tabs-picker input', 'configmap')
  check('Search matches Kind independently of resource name', await evaluate(`(${picker}).querySelectorAll('[role=option]').length===1&&(${picker}).textContent.includes('checkout-api-config')`))
  await input('.resource-tabs-picker input', 'no-such-resource')
  check('Unknown query shows empty picker without closing tabs', await evaluate(`(${picker}).textContent.includes('没有匹配的资源页签')&&document.querySelectorAll('.resource-workspace-tabs__item').length===9`))
  await input('.resource-tabs-picker input', 'apps')
  check('Search includes API group', await evaluate(`(${picker}).querySelectorAll('[role=option]').length===4`))
  await input('.resource-tabs-picker input', 'shop-prod')
  check('Search includes namespace', await evaluate(`(${picker}).querySelectorAll('[role=option]').length===9`))
  await key('End', 'End', 35); await key('ArrowDown', 'ArrowDown', 40)
  check('Picker keyboard wraps End through next row', await evaluate(`(${picker}).querySelector('.resource-tabs-picker__row[data-cursor=true]')===(${picker}).querySelector('.resource-tabs-picker__row')`))
  await key('Enter', 'Enter', 13)
  check('Keyboard selection opens resource and closes picker', await until(`!${picker}&&document.querySelector('.rpanel__kind')?.textContent==='Deployment'&&document.querySelector('.rpanel__name')?.textContent==='checkout-api'`))
  await showPicker(); await hidePicker()
  check('Escape returns keyboard focus to picker trigger', await evaluate('document.activeElement.getAttribute("aria-label")==="搜索已打开的资源页签"'))
  await selectTab('deployment/checkout-api'); await selectTab('service/checkout-api')
  await tap('.resource-workspace-tabs__item[data-selected=true] .resource-workspace-tabs__close')
  check('Closing current resource returns most recently visited resource', await until('document.querySelector(".rpanel__kind")?.textContent==="Deployment"&&document.querySelector(".rpanel__name")?.textContent==="checkout-api"'))
  await showPicker(); await input('.resource-tabs-picker input', 'configmap')
  await tap('.resource-tabs-picker__close')
  check('Picker can close inactive resource without selecting or dismissing list', await until(`!!${picker}&&document.querySelectorAll('.resource-workspace-tabs__item').length===7&&document.querySelector('.rpanel__kind')?.textContent==='Deployment'`))
  await hidePicker()
  await evaluate(`${selected}.querySelector('[role=tab]').focus()`); await key('ArrowRight', 'ArrowRight', 39)
  check('Arrow key moves resource tab focus without changing page', await evaluate('document.activeElement.textContent==="deployment/payment-worker"&&document.querySelector(".rpanel__name").textContent==="checkout-api"'))
  await key('Enter', 'Enter', 13)
  check('Native Enter selects focused resource tab', await until('document.querySelector(".rpanel__name")?.textContent==="payment-worker"'))
  const draft = await startDraft('\n# shared-tab-refresh-draft\n')
  await tap('[aria-label="刷新当前资源"]'); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('Refresh cancellation preserves current Manifest draft', await cm.read('.resource-manifest[data-mode=edit] .resource-yaml .cm-content') === draft)
  await tap('[aria-label="刷新当前资源"]'); await until(`!!${dialog}`); await click('放弃修改', dialog)
  check('Confirmed refresh reads live Mock manifest and updates sync label', await until('!!document.querySelector(".resource-manifest[data-mode=read] .resource-yaml .cm-content")&&document.querySelector(".resource-workspace-tabs__sync")?.textContent==="刚刚同步"'))
  await showPicker(); await input('.resource-tabs-picker input', 'secret')
  await evaluate('document.querySelector(".resource-tabs-picker__close").focus()'); await key('Enter', 'Enter', 13)
  check('Picker close button supports native Enter without selecting row', await until(`!!${picker}&&document.querySelectorAll('.resource-workspace-tabs__item').length===6&&document.querySelector('.rpanel__name')?.textContent==='payment-worker'`))
  await hidePicker()
  await click('Deployment', 'document.querySelector(".resource-workspace-tabs__fixed")')
  await until('!document.querySelector(".rpanel")')
  await selectTab('deployment/checkout-api'); await tap('.resource-workspace-tabs__item[data-selected=true] .resource-workspace-tabs__close')
  check('Closing resource opened from fixed listing returns listing', await until('!document.querySelector(".rpanel")&&!!document.querySelector(".resource-table")'))
  await selectTab('deployment/payment-worker')
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await delay(250); await showPicker()
  check('1280px keeps picker inside viewport and fixed navigation visible', await evaluate(`(()=>{const p=(${picker}).getBoundingClientRect(),fixed=document.querySelector('.resource-workspace-tabs__fixed').getBoundingClientRect();return p.left>=0&&p.right<=innerWidth&&fixed.left>=0&&document.documentElement.scrollWidth===innerWidth})()`))
  await screenshot('02-infrastructure-1280'); await hidePicker()
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await go('/projects/p-shop/apps/a-checkout/resources?env=b-checkout-dev')
  await until('[...document.querySelectorAll(".res button")].some(el=>el.textContent.trim()==="Manifest")')
  await click('Manifest', 'document.querySelector(".res")'); await until('!!document.querySelector(".res .resource-manifest .resource-yaml .cm-content")')
  check('Application uses same resource tabs with independent scope', await evaluate('!!document.querySelector(".resource-workspace-tabs--application")&&document.querySelectorAll(".resource-workspace-tabs__item").length===1'))
  await click('K8s 资源', 'document.querySelector(".resource-workspace-tabs__fixed")')
  await click('Logs', 'document.querySelector(".res")')
  await until('!!document.querySelector(".pod-logs")&&document.querySelectorAll(".res__tab-label").length===2')
  await selectContainer('.pod-logs__container', 'envoy')
  check('Application to cluster link preserves current tab and selected container', await until('(()=>{const u=new URL(document.querySelector(".res__tabs-link").href);return u.searchParams.get("openTab")==="logs"&&u.searchParams.get("openContainer")==="envoy"})()'))
  await showPicker(); await input('.resource-tabs-picker input', 'pod'); await selectOption('checkout-api-5b8d7c9f4-t1n9p')
  const appDraft = await (async () => { await click('Manifest', 'document.querySelector(".rpanel__tabsbar .resource-detail-tabs")'); return await startDraft('\n# app-picker-draft\n') })()
  await showPicker(); await input('.resource-tabs-picker input', 'deployment'); await selectOption('checkout-api'); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('Application picker selection respects active Manifest draft guard', await cm.read('.resource-manifest[data-mode=edit] .resource-yaml .cm-content') === appDraft && await evaluate(`document.querySelector('.rpanel__kind').textContent==='Pod'`))
  await tap('[aria-label="刷新当前资源"]'); await until(`!!${dialog}`); await click('放弃修改', dialog)
  await until('!!document.querySelector(".resource-manifest[data-mode=read]")')
  await evaluate('document.querySelector(".resource-detail-tabs [role=tab]").focus()'); await key('End', 'End', 35)
  check('Detail tab keyboard End focuses terminal without bypassing guards', await evaluate('document.activeElement.textContent==="终端"&&document.querySelector(".rpanel__tab--active").textContent==="Manifest"'))
  await key('Enter', 'Enter', 13)
  await until('document.querySelector(".pod-terminal__container input")?.value==="envoy"')
  await selectContainer('.pod-terminal__container', 'app')
  check('Terminal updates selected container for cluster jump', await until('(()=>{const u=new URL(document.querySelector(".res__tabs-link").href);return u.searchParams.get("openTab")==="terminal"&&u.searchParams.get("openContainer")==="app"})()'))
  await screenshot('03-application-terminal-tabs')
  await click('在集群中查看')
  await until('!!document.querySelector(".resource-workspace-tabs--cluster")&&document.querySelector(".pod-terminal__container input")?.value==="app"')
  check('Cluster jump opens same Pod terminal and selected container', await evaluate('document.querySelector(".rpanel__tab--active").textContent==="终端"&&document.querySelector(".rpanel__name").textContent==="checkout-api-5b8d7c9f4-t1n9p"'))
  await go('/projects/p-shop/apps/a-checkout/resources?env=b-checkout-dev')
  check('Returning to application retains independent resource tabs', await until('document.querySelectorAll(".res__tab-label").length===2'))
  await selectTab('deployment/checkout-api'); await showPicker(); await screenshot('04-application-tab-picker'); await hidePicker()
  await browser.navigate('/clusters/c-dev?resource=rollouts&group=argoproj.io')
  // Resolve names from the real listing rather than assuming a custom resource fixture name.
  await go('/clusters/c-dev?resource=rollouts&group=argoproj.io')
  await until('!!document.querySelector(".resource-name__link")'); await tap('.resource-name__link'); await until('!!document.querySelector(".resource-manifest .resource-yaml .cm-content")')
  await go('/clusters/c-dev?resource=rollouts&group=delivery.podry.io'); await until('!!document.querySelector(".resource-name__link")'); await tap('.resource-name__link'); await until('!!document.querySelector(".resource-manifest .resource-yaml .cm-content")')
  assert.ok((await cm.read('.resource-manifest .resource-yaml .cm-content')).includes('delivery.podry.io'))
  await showPicker(); await input('.resource-tabs-picker input', 'argoproj.io')
  check('Same-name custom group tabs are disambiguated and searchable', await evaluate(`(${picker}).querySelectorAll('[role=option]').length===1&&(${picker}).querySelector('.resource-tabs-picker__meta').textContent.includes('argoproj.io')`))
  await hidePicker()
  check('No browser runtime errors or console warnings', browser.errors.length === 0 && browser.warnings.length === 0)
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, errors: browser.errors, warnings: browser.warnings }, null, 2))
  console.log(`PASS ${checks.length} resource tabs browser checks; frontend Mock only`)
} catch (error) { console.error(JSON.stringify({ url: await evaluate('location.href'), errors: browser.errors, warnings: browser.warnings })); await screenshot('failure'); throw error }
finally { await browser.close() }
