// UI-only frontend Mock verification; no image registry or backend writes.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
const output = resolve(import.meta.dirname, '../screenshots-artifact-detail-parity')
const browser = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182', output)
const { evaluate, until, screenshot, call } = browser
const checks = [], app = '/projects/p-shop/apps/a-checkout'
const drawer = 'document.querySelector(".artifact-details-drawer.t-drawer--open")'
const editor = '[...document.querySelectorAll(".t-dialog")].find(el=>el.checkVisibility({visibilityProperty:true})&&el.querySelector(".artifact-metadata"))'
const discard = '[...document.querySelectorAll(".t-dialog")].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.includes("放弃未保存的镜像"))'
const imageDrawer = 'document.querySelector(".bd-image.t-drawer--open")'
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function click(text, scope = 'document') {
  const target = `[...${scope}.querySelectorAll('button,a')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)})`
  await until(`!!(${target})`); await evaluate(`(${target}).click()`); await delay(180)
}
async function tap(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(180) }
async function input(selector, text) {
  await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));el.focus()})()`); await delay(80)
}
async function enter() { await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await delay(100) }
async function go(path) { await evaluate(`void document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`); await delay(400) }
async function closeDetails() { await tap('.artifact-details-drawer .t-drawer__close-btn'); await until(`!${drawer}`) }
async function tag(text) { await input('.artifact-metadata .t-tag-input input', text); await enter() }
const safeNote = 'Verified image round20\n<img src=x onerror="window.__unsafeArtifact=true">'
try {
  await browser.navigate(app + '/overview?tab=environments'); await until('!!document.querySelector(".env-row .tag-chip")')
  await tap('.env-row .tag-chip'); await until(`!!${drawer}?.querySelector('.artifact-summary')`)
  check('Overview opens right-side 800px source/image drawer', await evaluate(`(()=>{const r=${drawer}.querySelector('.t-drawer__content-wrapper').getBoundingClientRect();return Math.abs(r.width-800)<2&&Math.abs(r.right-innerWidth)<2})()`))
  check('Drawer preserves environment and operator context', await evaluate(`${drawer}.querySelector('.artifact-details-heading').textContent.includes('部署到')&&${drawer}.querySelector('.artifact-details-heading').textContent.includes('张运维')`))
  check('Source precedes image with connector', await evaluate(`!!${drawer}.querySelector('.build-source-card')&&!!${drawer}.querySelector('.artifact-details-body__connector')&&(${drawer}.querySelector('.build-source-snapshot').compareDocumentPosition(${drawer}.querySelector('.artifact-summary'))&Node.DOCUMENT_POSITION_FOLLOWING)>0`))
  check('Legacy source remains explicitly incomplete', await evaluate(`${drawer}.querySelector('.build-source-snapshot__notice').textContent.includes('未保存完整源码')`))
  check('Full digest retained', await evaluate(`${drawer}.querySelector('.artifact-summary__digest').textContent.includes('sha256:8f14e45fceea167a5a36dedd4bea2543c4b3f4b1d0f9a7e2c6b8d5a1f3e7c9b2')`))
  await evaluate('window.__copiedArtifact=[];Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async value=>window.__copiedArtifact.push(value)}})')
  await tap('.artifact-details-drawer [aria-label="复制镜像标签"]'); await tap('.artifact-details-drawer [aria-label="复制完整镜像地址"]'); await tap('.artifact-details-drawer [aria-label="复制镜像 Digest"]')
  check('Tag, complete reference and digest copy separately', await evaluate('window.__copiedArtifact[0]==="v1.42.0"&&window.__copiedArtifact[1]==="harbor.acme.dev/acme/checkout-api:v1.42.0"&&window.__copiedArtifact[2].startsWith("sha256:8f14")'))
  await click('添加标签/备注', drawer); await until(`!!${editor}`)
  await input('.artifact-metadata textarea', 'unsaved image note'); await click('取消', editor); await click('继续编辑', discard)
  check('Cancel can continue with original note draft', await evaluate('document.querySelector(".artifact-metadata textarea").value==="unsaved image note"'))
  check('Unsaved metadata guards browser refresh', await evaluate('(()=>{const event=new Event("beforeunload",{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})()'))
  await go(app + '/builds?build=bd-1011&tab=artifacts'); await click('继续编辑', discard)
  check('Route leave cancellation keeps drawer and draft', await evaluate(`location.pathname.endsWith('/overview')&&!!${drawer}&&document.querySelector('.artifact-metadata textarea').value==='unsaved image note'`))
  await click('取消', editor); await click('放弃修改', discard); await until(`!${editor}`)
  await click('添加标签/备注', drawer); await until(`!!${editor}`)
  check('Discard resets note to last saved value', await evaluate('document.querySelector(".artifact-metadata textarea").value===""'))
  await tag('x'.repeat(65)); await click('保存', editor)
  check('Overlong release tag rejected inside editor', await evaluate('document.querySelector(".artifact-metadata .t-alert").textContent.includes("64")'))
  await click('取消', editor); await click('放弃修改', discard); await until(`!${editor}`)
  await click('添加标签/备注', drawer); await until(`!!${editor}`); await tag('verified-r20'); await tag('verified-r20'); await input('.artifact-metadata textarea', safeNote); await click('保存', editor); await until(`!${editor}`)
  check('Image metadata saves back into open drawer', await until(`${drawer}?.querySelector('.artifact-summary__notes')?.textContent===${JSON.stringify(safeNote)}`))
  check('Notes render as text and release tags deduplicate', await evaluate(`!window.__unsafeArtifact&&!${drawer}.querySelector('.artifact-summary__notes img')&&${drawer}.querySelectorAll('.artifact-summary__tags .t-tag').length===1`))
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await delay(200)
  check('1280px drawer has internal scrolling and no horizontal overflow', await evaluate(`${drawer}.querySelector('.t-drawer__body').scrollWidth<=${drawer}.querySelector('.t-drawer__body').clientWidth+1&&document.documentElement.scrollWidth<=innerWidth`))
  await delay(3100); await screenshot('01-overview-image-1280'); await closeDetails(); await tap('.env-row .sha-chip'); await until(`!!${drawer}?.querySelector('.artifact-summary')`)
  check('Commit chip opens the same saved image', await evaluate(`${drawer}.querySelector('.artifact-summary__tags').textContent.includes('verified-r20')`))
  await closeDetails(); await go(app + '/builds?build=bd-1011&tab=artifacts'); await until('!!document.querySelector(".bh-artifact")')
  check('Build artifact reads overview metadata in same session', await evaluate(`document.querySelector('.bh-artifact .artifact-summary__notes').textContent===${JSON.stringify(safeNote)}`))
  await click('源码与镜像详情', 'document.querySelector(".bh-artifact")'); await until(`!!${drawer}?.querySelector('.artifact-summary')`)
  check('Build history opens shared image drawer', await evaluate(`${drawer}.textContent.includes('v1.42.0')&&${drawer}.textContent.includes('9d2b5e8')`))
  await closeDetails(); await go(app + '/deployments?env=e-dev&deployment=d-checkout-dev-2&tab=source'); await until('!!document.querySelector(".dh-artifact")')
  check('Deployment history reads artifact tags and notes', await evaluate(`document.querySelector('.dh-artifact .artifact-summary__notes').textContent===${JSON.stringify(safeNote)}`))
  await click('编辑标签/备注', 'document.querySelector(".dh-artifact")'); await until(`!!${editor}`); await input('.artifact-metadata textarea', 'Deployment shared image note'); await click('保存', editor); await until(`!${editor}`)
  check('Deployment editor replaces old local-only label behavior', await until('document.querySelector(".dh-artifact .artifact-summary__notes")?.textContent==="Deployment shared image note"'))
  await go(app + '/deployments?env=e-dev&deployment=d-checkout-dev-1&tab=source'); await until('document.querySelector(".dh-artifact")?.textContent.includes("v1.41.3")')
  check('Different image retains independent metadata', await evaluate('!document.querySelector(".dh-artifact .artifact-summary__notes")&&!document.querySelector(".dh-artifact .artifact-summary__tags")'))
  await go(app + '/deployments?env=e-dev&deployment=d-checkout-dev-2&tab=config'); await until('!!document.querySelector(".dh-image-link")'); await tap('.dh-image-link'); await until(`!!${drawer}?.querySelector('.artifact-summary')`)
  check('Configuration image link opens recorded deployment image', await evaluate(`${drawer}.textContent.includes('Deployment shared image note')&&${drawer}.textContent.includes('开发环境')`))
  await delay(400); await screenshot('02-deployment-image'); await closeDetails()
  await go(app + '/deployments?env=e-dev&deployment=d-checkout-dev-2&tab=source')
  check('History query switches Configuration back to Source', await until('!!document.querySelector(".dh-artifact")&&!document.querySelector(".dh-config")'))
  await go(app + '/trigger'); await until('!!document.querySelector(".tnode__btn--cd")'); await tap('.tnode__btn--cd'); await until(`!!${imageDrawer}?.querySelector('.img-card')`)
  check('Image picker reads metadata updated from history', await evaluate('document.querySelectorAll(".img-card")[0].textContent.includes("Deployment shared image note")&&document.querySelectorAll(".img-card")[0].textContent.includes("verified-r20")'))
  await evaluate('document.querySelectorAll(".img-card__labels")[1].click()'); await until(`!!${editor}`)
  check('Editing unselected image does not select it', await evaluate('document.querySelectorAll(".img-card")[0].getAttribute("aria-pressed")==="true"&&document.querySelectorAll(".img-card")[1].getAttribute("aria-pressed")==="false"'))
  await input('.artifact-metadata textarea', 'draft during background refresh')
  // Trigger the existing list refresh to exercise a same-ID record replacement during editing.
  await evaluate('document.querySelector(".im__refresh").click()'); await delay(700)
  check('Refreshing the same image record preserves unsaved metadata', await evaluate('document.querySelector(".artifact-metadata textarea").value==="draft during background refresh"'))
  await tag('older-image-r20'); await input('.artifact-metadata textarea', 'Older image note'); await click('保存', editor); await until(`!${editor}`)
  check('Picker metadata save preserves image selection', await until('document.querySelectorAll(".img-card")[1]?.textContent.includes("Older image note")&&document.querySelectorAll(".img-card")[0].getAttribute("aria-pressed")==="true"'))
  await input('.im__search input', 'older-image-r20')
  check('Image search includes release tags', await until('document.querySelectorAll(".img-card").length===1&&document.querySelector(".img-card").textContent.includes("v1.41.3")'))
  await click('展开详情', imageDrawer); await until('!!document.querySelector(".img-card__expanded .build-source-card")')
  check('Expanded image shows source and full digest', await evaluate('document.querySelector(".img-card__info").textContent.includes("sha256:c9f0f895fb98ab9159f51fd0297e236d80fe5e4b5e7c1d2a3b4c5d6e7f8091a2")&&document.querySelector(".img-card__expanded .build-source-snapshot__notice").textContent.includes("未保存完整源码")'))
  check('Expanding details does not select image', await evaluate('document.querySelector(".img-card").getAttribute("aria-pressed")==="false"'))
  await evaluate('document.querySelector(".img-card").focus()'); await enter()
  check('Keyboard Enter selects image card', await evaluate('document.querySelector(".img-card").getAttribute("aria-pressed")==="true"'))
  await screenshot('03-image-selection-source-1280'); await click('部署', 'document.querySelector(".im__foot")'); await until('!!document.querySelector(".rv .tk-kv")')
  check('Existing review pins selected image and config', await evaluate('document.querySelector(".rv .tk-kv").textContent.includes("v1.41.3")&&document.querySelector(".rv .tk-kv").textContent.includes("配置版本")'))
  await click('取消', 'document.querySelector(".rv__foot")'); await tap('.bd-image .t-drawer__close-btn'); await until(`!${imageDrawer}`)
  await go('/projects/p-shop/apps/a-storefront/trigger'); await until('!!document.querySelector(".tnode__btn--cd")'); await tap('.tnode__btn--cd'); await until(`!!${imageDrawer}?.querySelector('.img-card')`)
  await click('展开详情', imageDrawer); await until('document.querySelector(".img-card__expanded")?.textContent.includes("外部导入镜像")')
  check('External image expansion has no fabricated source', await evaluate('!document.querySelector(".img-card__expanded .build-source-card")'))
  await click('部署', 'document.querySelector(".im__foot")'); await until('!!document.querySelector(".rv .tk-kv")'); await click('确认发布', 'document.querySelector(".rv__foot")'); await until('location.pathname.includes("/a-storefront/deployments")&&!!document.querySelector(".dh-artifact")')
  check('Confirm deployment navigates to its environment and record', await evaluate('new URLSearchParams(location.search).get("env")==="e-prod"&&!!new URLSearchParams(location.search).get("deployment")&&new URLSearchParams(location.search).get("tab")==="source"'))
  await click('源码与镜像详情', 'document.querySelector(".dh-artifact")'); await until(`!!${drawer}?.querySelector('.artifact-summary')`)
  check('External image keeps image details without fabricated source', await evaluate(`${drawer}.textContent.includes('外部导入镜像')&&!${drawer}.querySelector('.build-source-card')&&${drawer}.querySelector('.artifact-summary__fields').textContent.includes('外部镜像')`))
  await delay(3100)
  check('External image drawer settles within viewport with visible close control', await evaluate(`(()=>{const r=${drawer}.querySelector('.t-drawer__content-wrapper').getBoundingClientRect();const close=${drawer}.querySelector('.t-drawer__close-btn').getBoundingClientRect();return Math.abs(r.right-innerWidth)<2&&close.right<=innerWidth&&close.left>=r.left})()`))
  await screenshot('04-external-image'); await closeDetails()
  await go(app + '/builds?build=bd-1011&tab=artifacts'); await until('!!document.querySelector(".bh-artifact")')
  check('Cross-route metadata survives frontend navigation', await evaluate('document.querySelector(".bh-artifact").textContent.includes("Deployment shared image note")'))
  await click('编辑标签/备注', 'document.querySelector(".bh-artifact")'); await until(`!!${editor}`); await input('.artifact-metadata textarea', 'discard on switch'); await go(app + '/builds?build=bd-1008&tab=artifacts'); await click('放弃修改', discard); await until('document.querySelector(".bh-artifact")?.textContent.includes("v1.41.3")')
  check('Build switch discards confirmed draft and shows correct saved image', await evaluate('document.querySelector(".bh-artifact").textContent.includes("Older image note")&&!document.querySelector(".bh-artifact").textContent.includes("discard on switch")'))
  check('Browser has no runtime errors', browser.errors.length === 0)
  check('Browser has no console warnings', browser.warnings.length === 0)
} catch (error) { await screenshot('failure'); console.error(await evaluate('({url:location.href,text:document.body.innerText.slice(-5000)})')); throw error }
finally { writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, errors: browser.errors, warnings: browser.warnings }, null, 2)); await browser.close() }
console.log(`Completed ${checks.length} artifact browser checks; screenshots: ${output}`)
