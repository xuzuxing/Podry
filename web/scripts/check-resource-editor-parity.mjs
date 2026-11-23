// Native single Manifest editor interactions against frontend Mock only.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'

const output = resolve(import.meta.dirname, '../screenshots-resource-editor-parity')
const browser = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182', output)
const { evaluate, until, call, screenshot } = browser
const cm = codeMirrorDriver(browser), checks = []
const content = '.resource-manifest__editor .cm-content'
const root = 'document.querySelector(".resource-manifest")'
const dialog = '[...document.querySelectorAll(".t-dialog")].find(el=>el.checkVisibility({visibilityProperty:true}))'
const url = '/projects/p-shop/apps/a-checkout/resources?env=b-checkout-dev&tab=' + encodeURIComponent('app:a-checkout:c-dev|c-dev|apps|deployments|shop-dev|checkout-api') + '&resourceTab=manifest'
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function click(text, scope = root) {
  const target = `[...${scope}.querySelectorAll('button,.t-checkbox')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)})`
  await until(`!!(${target})`); await evaluate(`(${target}).click()`); await delay(120)
}
async function tap(selector) { await until(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(100) }
async function field(name, text) {
  await evaluate(`(()=>{const el=document.querySelector('.resource-yaml .cm-search input[name=${name}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await delay(100)
}
async function ready(mode) { await until(`(${root})?.dataset.mode===${JSON.stringify(mode)}&&document.querySelector('.resource-yaml')?.dataset.state==='ready'`); await delay(80) }
async function readonlyTyping(selector) {
  await cm.focus(selector)
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'q', code: 'KeyQ', text: 'q', windowsVirtualKeyCode: 81 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81 })
}
try {
  await browser.navigate(url); await ready('read')
  check('Read view uses one native editor with an accessible readonly label', await evaluate(`document.querySelectorAll('.resource-yaml .cm-editor').length===1&&document.querySelector(${JSON.stringify(content)}).getAttribute('aria-label')==='实时 Manifest'&&document.querySelector(${JSON.stringify(content)}).getAttribute('aria-readonly')==='true'`))
  check('Opening read view keeps focus outside the document', await evaluate(`!document.activeElement.matches(${JSON.stringify(content)})`))
  check('Native editor supplies line numbers, folding and a dark background', await evaluate('!!document.querySelector(".resource-yaml .cm-lineNumbers")&&!!document.querySelector(".resource-yaml .cm-foldGutter")&&getComputedStyle(document.querySelector(".resource-yaml")).backgroundColor==="rgb(30, 30, 30)"'))
  const original = await cm.read(content)
  check('Clipboard reads the complete Manifest and terminal newline', original.startsWith('apiVersion:') && original.includes('kind: Deployment') && original.endsWith('\n'))
  await readonlyTyping(content)
  check('Readonly keyboard input leaves the Manifest intact', await cm.read(content) === original)
  await tap('[aria-label="查找 Manifest"]')
  check('Visible search action opens a readonly native search panel', await until('!!document.querySelector(".resource-yaml .cm-search input[name=search]")&&!document.querySelector(".resource-yaml .cm-search input[name=replace]")'))
  await field('search', 'checkout-api')
  check('Readonly search highlights literal matches', await until('!!document.querySelector(".resource-yaml .cm-searchMatch")'))
  await cm.key('Escape', 'Escape', 27)
  check('Escape closes search and returns editor focus', await until(`!document.querySelector('.resource-yaml .cm-search')&&document.activeElement.matches(${JSON.stringify(content)})`))
  check('Resources without managed fields omit the field toggle', !original.includes('managedFields:') && await evaluate(`![...(${root}).querySelectorAll('.t-checkbox')].some(el=>el.textContent.includes('隐藏托管字段'))`))
  await click('编辑实时 Manifest'); await ready('edit')
  check('Entering edit mode automatically focuses the editable document', await evaluate(`document.activeElement.matches(${JSON.stringify(content)})&&document.activeElement.contentEditable==='true'&&document.activeElement.getAttribute('aria-label')==='编辑实时 Manifest'`))
  check('Edit starts from the currently displayed Manifest', await cm.read(content) === original)
  const draft = original + '# 中文原文 <script>literal</script>\n'
  await cm.write(content, draft)
  check('Native edits preserve Unicode, literal markup and trailing newline', await cm.read(content) === draft && await evaluate('!document.querySelector(".resource-yaml script")'))
  check('Native edits update parent dirty state and refresh protection', await evaluate(`(${root}).textContent.includes('有未保存的修改')&&(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})()`))
  await cm.key('z', 'KeyZ', 90, 2)
  check('Undo restores the prior draft without external echo resets', await cm.read(content) === original)
  await cm.key('y', 'KeyY', 89, 2)
  check('Windows redo restores the full edited document', await cm.read(content) === draft)
  await delay(600); await cm.key('Home', 'Home', 36, 2); await cm.key('Tab', 'Tab', 9)
  check('Tab indents by two spaces inside editable YAML', await cm.read(content) === '  ' + draft)
  await cm.key('z', 'KeyZ', 90, 2)
  check('Indent is a reversible native history step', await cm.read(content) === draft)
  await cm.key('Tab', 'Tab', 9, 8)
  check('Shift Tab leaves the editor without trapping keyboard focus', await evaluate(`!document.activeElement.matches(${JSON.stringify(content)})`) && await cm.read(content) === draft)
  await cm.key('f', 'KeyF', 70, 2)
  check('Ctrl F opens a compact find panel with replace initially collapsed', await until('!!document.querySelector(".resource-yaml .cm-search input[name=search]")&&!document.querySelector(".resource-yaml .cm-search input[name=replace]")'))
  await tap('.resource-yaml .cm-search [aria-label="展开或收起替换"]')
  await field('search', 'literal'); await field('replace', 'replaced')
  await click('全部替换', 'document.querySelector(".resource-yaml .cm-search")')
  check('Replace updates the parent draft and retains other text', await cm.read(content) === draft.replace('literal', 'replaced'))
  await evaluate('document.querySelector(".resource-yaml .cm-search input[name=search]").focus()'); await cm.key('Escape', 'Escape', 27)
  await cm.write(content, draft); await cm.key('Home', 'Home', 36, 2)
  await until('!!document.querySelector(".resource-yaml .cm-foldGutter [title]")')
  const point = await evaluate(`(()=>{const el=[...document.querySelectorAll('.resource-yaml .cm-foldGutter [title]')].find(el=>el.checkVisibility({visibilityProperty:true}));const box=el.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2}})()`)
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }); await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  check('Folding hides nested YAML while preserving document text', await until('!!document.querySelector(".resource-yaml .cm-foldPlaceholder")') && await cm.read(content) === draft)
  await tap('.resource-yaml .cm-foldPlaceholder')
  check('Folded YAML can be expanded', await evaluate('!document.querySelector(".resource-yaml .cm-foldPlaceholder")'))
  await click('事件', 'document.querySelector(".resource-detail-tabs")'); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('Canceled tab navigation preserves native editor text and edit mode', await cm.read(content) === draft && await evaluate(`(${root}).dataset.mode==='edit'`))
  await cm.write(content, 'metadata: [broken'); await click('预览并保存修改')
  check('Invalid YAML remains in the native editor with validation error', await until('document.querySelector(".resource-manifest__error")?.textContent.includes("YAML")') && await cm.read(content) === 'metadata: [broken')
  await cm.write(content, draft)
  check('YAML keys and comments use distinct syntax colors', await evaluate(`new Set([...document.querySelectorAll('.resource-yaml .cm-line span')].map(el=>getComputedStyle(el).color)).size>=2`))
  await screenshot('01-native-single-edit')
  await evaluate('window.previousSingleEditor=document.querySelector(".resource-yaml .cm-editor")')
  await click('预览并保存修改'); await until('document.querySelector(".resource-yaml-diff")?.dataset.state==="ready"')
  check('Entering Review destroys the old single editor DOM', await evaluate('!window.previousSingleEditor.isConnected&&!document.querySelector(".resource-yaml")'))
  await click('返回编辑'); await ready('edit')
  check('Returning from Review restores the complete draft and editor focus', await evaluate(`document.activeElement.matches(${JSON.stringify(content)})`) && await cm.read(content) === draft)
  await cm.key('z', 'KeyZ', 90, 2)
  check('Remounted editor undo cannot restore an obsolete document', await cm.read(content) === draft)
  const rows = Array.from({ length: 1000 }, (_, i) => `    editor-${String(i).padStart(4, '0')}: ${'x'.repeat(200)}`).join('\n')
  const long = original.replace('metadata:\n', 'metadata:\n  annotations:\n' + rows + '\n') + '# long-native-tail\n'
  await cm.write(content, long)
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await cm.scroll('.resource-yaml .cm-scroller', 12000, 350)
  check('Long YAML scrolls internally in both directions at 1280px', await evaluate('(()=>{const el=document.querySelector(".resource-yaml .cm-scroller");return el.scrollTop>10000&&el.scrollLeft>100&&document.documentElement.scrollWidth===innerWidth})()'))
  check('Large single editor virtualizes offscreen lines', await evaluate('document.querySelectorAll(".resource-yaml .cm-line").length<300'))
  check('Virtualized clipboard includes every offscreen line', await cm.read(content) === long)
  await screenshot('02-native-long-edit-1280')
  await click('预览并保存修改'); await until('document.querySelector(".resource-yaml-diff")?.dataset.state==="ready"'); await click('应用修改'); await ready('read')
  check('Applying a long native draft reads back the exact full Manifest', await cm.read(content) === long)
  await readonlyTyping(content)
  check('Applied document returns to readonly with no editable sibling', await cm.read(content) === long && await evaluate('document.querySelectorAll(".resource-manifest .cm-content[aria-readonly=false]").length===0'))
  await tap('[aria-label="查找 Manifest"]'); await field('search', 'long-native-tail'); await click('下一项', 'document.querySelector(".resource-yaml .cm-search")')
  check('Find reaches offscreen tail in readonly long document', await until('document.querySelector(".resource-yaml .cm-searchMatch")?.textContent==="long-native-tail"'))
  await cm.key('Escape', 'Escape', 27); await screenshot('03-native-long-read-1280')
  await evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/clusters/c-prod/resources/apps/deployments/shop-prod/checkout-api/manifest').then(result=>result?.message||'')`); await ready('read')
  const production = await cm.read(content)
  check('Resource change starts from its own namespace and replica count', production.includes('namespace: shop-prod') && production.includes('replicas: 4') && !production.includes('long-native-tail'))
  await click('编辑实时 Manifest'); await ready('edit'); await cm.key('z', 'KeyZ', 90, 2)
  check('Undo cannot bring another resource history into a fresh editor', await cm.read(content) === production)
  await click('取消'); await ready('read')
  check('Clean native editor exits without a discard dialog', await evaluate(`!${dialog}&&!(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})()`))
  assert.deepEqual(browser.errors, []); assert.deepEqual(browser.warnings, [])
  check('No browser runtime errors or console warnings', true)
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, count: checks.length, errors: browser.errors, warnings: browser.warnings }, null, 2))
  console.log(`${checks.length} native single Manifest browser checks passed`)
} catch (error) { await screenshot('failure'); console.error('Browser errors:', browser.errors, browser.warnings); throw error }
finally { await browser.close() }
