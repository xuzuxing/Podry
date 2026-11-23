// Public DOM, keyboard and clipboard checks against production frontend Mock.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'

const output = resolve(import.meta.dirname, '../screenshots-editor-search-parity')
const browser = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182', output)
const { evaluate, until, call, screenshot } = browser
const cm = codeMirrorDriver(browser), checks = []
const app = '/projects/p-shop/apps/a-checkout'
const content = '.values-editor .cm-content', panel = '.values-editor .cm-search'
const zh = { toggle: '\u5c55\u5f00\u6216\u6536\u8d77\u66ff\u6362', word: '\u5168\u8bcd\u5339\u914d', matchCase: '\u533a\u5206\u5927\u5c0f\u5199', regex: '\u4f7f\u7528\u6b63\u5219\u8868\u8fbe\u5f0f' }
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function tap(selector) { await until(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(130) }
async function input(selector, text) {
  await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await delay(100)
}
async function count(number, scope = panel) { return until(`document.querySelector(${JSON.stringify(scope + ' [role=status]')})?.textContent.trim().endsWith(${JSON.stringify('/ ' + number)})`) }
async function toggle(label) { await tap(panel + ' [aria-label="' + label + '"]') }
async function open() { await cm.focus(content); await cm.key('f', 'KeyF', 70, 2); await until(`document.activeElement?.matches(${JSON.stringify(panel + ' input[name=search]')})`) }
async function query(text) { await input(panel + ' input[name=search]', text) }
async function selected(selector) { return evaluate(`(()=>{const target=document.querySelector(${JSON.stringify(selector)}),data=new DataTransfer();target.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return data.getData('text/plain')})()`) }
async function clickText(text, scope) { await evaluate(`(()=>{const button=[...document.querySelector(${JSON.stringify(scope)}).querySelectorAll('button,.t-radio-button')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('Missing action '+${JSON.stringify(text)});button.click()})()`); await delay(180) }

try {
  await browser.navigate(app + '/config/base/deployment-template')
  await until('!!document.querySelector(".values-editor .cm-content")')
  const original = await cm.read(content)
  const fixture = '# ITEM item items\nnote: item\nend: final\n'
  await cm.write(content, fixture); await open(); await query('item')
  check('Shared compact toolbar counts every literal match', await count(4))
  check('Replace starts collapsed with an accessible toggle', await evaluate(`!document.querySelector('${panel} input[name=replace]')&&document.querySelector('${panel} [aria-expanded=false]')!==null`))
  await cm.key('Enter', 'Enter', 13)
  check('Enter selects the first match and updates current index', await until(`document.querySelector('${panel} [role=status]').textContent.trim()==='1 / 4'`))
  await cm.key('Enter', 'Enter', 13, 8)
  check('Shift Enter wraps backwards to the last match', await until(`document.querySelector('${panel} [role=status]').textContent.trim()==='4 / 4'`))
  await cm.key('F3', 'F3', 114)
  check('F3 wraps forwards inside the panel', await until(`document.querySelector('${panel} [role=status]').textContent.trim()==='1 / 4'`))
  await cm.key('g', 'KeyG', 71, 2)
  check('Ctrl G uses the same native query and selection', await until(`document.querySelector('${panel} [role=status]').textContent.trim()==='2 / 4'`))
  await toggle(zh.matchCase)
  check('Case sensitivity excludes uppercase matches', await count(3))
  check('Case toggle exposes its checked state', await evaluate(`document.querySelector('${panel} [aria-label="${zh.matchCase}"]').getAttribute('aria-pressed')==='true'`))
  await toggle(zh.word)
  check('Whole word excludes longer words', await count(2))
  await toggle(zh.matchCase)
  check('Whole word combines with case-insensitive search', await count(3))
  await query('missing_search_value')
  check('No matches disables native navigation and replace actions', await until(`[...document.querySelectorAll('${panel} button[name=next],${panel} button[name=prev],${panel} button[name=select]')].every(el=>el.disabled)&&!document.querySelector('${panel} .cm-searchMatch')`))
  await toggle(zh.regex); await query('[')
  check('Invalid regex has accessible error state', await until(`document.querySelector('${panel} input[name=search]').getAttribute('aria-invalid')==='true'`))
  check('Invalid regex leaves the full document unchanged', await cm.read(content) === fixture)
  await cm.focus(panel + ' input[name=search]'); await cm.key('Enter', 'Enter', 13)
  check('Enter keeps an invalid query available for correction', await evaluate(`document.querySelector('${panel} input[name=search]').value==='['&&document.querySelector('${panel} input[name=search]').getAttribute('aria-invalid')==='true'`))
  await query('i.em'); await toggle(zh.word)
  check('Valid regex recovers from errors with correct count', await count(4))
  await toggle(zh.regex); await query('item'); await toggle(zh.matchCase); await toggle(zh.word)
  await toggle(zh.toggle)
  check('Replace expands into a second toolbar row', await until(`!!document.querySelector('${panel} input[name=replace]')&&document.querySelector('${panel} [aria-expanded=true]')!==null`))
  await input(panel + ' input[name=replace]', 'value')
  await toggle(zh.toggle); await toggle(zh.toggle)
  check('Collapsing replace preserves the current query and replacement', await evaluate(`document.querySelector('${panel} input[name=replace]').value==='value'&&document.querySelector('${panel} input[name=search]').value==='item'`))
  await cm.focus(panel + ' input[name=search]'); await cm.key('Enter', 'Enter', 13)
  await cm.focus(panel + ' input[name=replace]'); await cm.key('Enter', 'Enter', 13)
  check('Enter in replacement edits one selected match using native history', (await cm.read(content)).includes('value') && await count(1))
  await cm.key('z', 'KeyZ', 90, 2)
  check('Undo restores the replacement and its match count', await cm.read(content) === fixture && await count(2))
  await tap(panel + ' button[name=replaceAll]')
  check('Replace all respects whole-word and case flags', await cm.read(content) === fixture.replaceAll('item\n', 'value\n').replace('item items', 'value items'))
  check('Replace all updates the match count without closing the panel', await until(`!!document.querySelector('${panel}')&&document.querySelector('${panel} button[name=next]').disabled`))
  await cm.key('z', 'KeyZ', 90, 2)
  check('Replace all is one undo transaction', await cm.read(content) === fixture)
  await tap(panel + ' button[name=close]')
  check('Closing toolbar returns focus to its native editor', await until(`!document.querySelector('${panel}')&&document.activeElement.matches('${content}')`))
  await open()
  check('Reopening find retains the replacement expansion in this editor context', await until(`!!document.querySelector('${panel} input[name=replace]')`))
  await toggle(zh.toggle); await cm.key('Escape', 'Escape', 27)
  await cm.key('h', 'KeyH', 72, 2)
  check('Ctrl H opens the replacement row directly', await until(`!!document.querySelector('${panel} input[name=replace]')`))
  await query('item'); await input(panel + ' input[name=replace]', 'shortcut'); await cm.focus(panel + ' input[name=replace]'); await cm.key('Enter', 'Enter', 13, 3)
  check('Ctrl Alt Enter replaces all through the same native command', await cm.read(content) === fixture.replaceAll('item\n', 'shortcut\n').replace('item items', 'shortcut items'))
  await cm.key('z', 'KeyZ', 90, 2); await cm.focus(panel + ' input[name=replace]'); await cm.key('Enter', 'Enter', 13, 2)
  check('Upstream Ctrl Enter also replaces all while replace is expanded', await cm.read(content) === fixture.replaceAll('item\n', 'shortcut\n').replace('item items', 'shortcut items'))
  await cm.key('z', 'KeyZ', 90, 2); await cm.key('Escape', 'Escape', 27); await cm.key('f', 'KeyF', 70, 3)
  check('Upstream Ctrl Alt F opens replacement with keyboard focus', await until(`!!document.querySelector('${panel} input[name=replace]')&&document.activeElement.matches('${panel} input[name=search]')`))
  await query('item'); await tap(panel + ' button[name=select]'); await cm.focus(content)
  check('Select all keeps every whole-word matching range', await selected(content) === 'item\nitem')
  await call('Input.insertText', { text: 'multi' }); await delay(150)
  check('Typing changes every selected native match', await cm.read(content) === fixture.replaceAll('item\n', 'multi\n').replace('item items', 'multi items'))
  await cm.key('z', 'KeyZ', 90, 2)
  check('Multi-selection edits remain one undo transaction', await cm.read(content) === fixture)
  await query('item'); await cm.key('Escape', 'Escape', 27)
  await cm.write(content, '# ' + Array.from({ length: 1001 }, () => 'bounded').join(' ') + '\n')
  await open(); await query('bounded')
  check('Counting includes matches beyond the native select-all limit', await count(1001))
  check('Select all is disabled beyond the native 1000-match limit', await evaluate(`document.querySelector('${panel} button[name=select]').disabled`))
  await query('')
  check('Empty query clears matches and disables actions', await until(`document.querySelector('${panel} button[name=next]').disabled&&!document.querySelector('.values-editor .cm-searchMatch')`))
  await cm.key('Escape', 'Escape', 27); await cm.write(content, original)
  await evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(app + '/config/overrides/e-dev/deployment-template?headerTab=inherited')}).then(result=>result?.message||'')`)
  await until(`document.querySelector('${content}')?.getAttribute('aria-readonly')==='true'`)
  const inherited = await cm.read(content)
  await cm.focus(content); await cm.key('h', 'KeyH', 72, 2)
  check('Readonly Ctrl H permits find but omits all replace controls', await until(`!!document.querySelector('${panel} input[name=search]')&&!document.querySelector('${panel} input[name=replace]')&&!document.querySelector('${panel} [aria-expanded]')`))
  await query('replicaCount'); await cm.key('Enter', 'Enter', 13)
  check('Readonly configuration supports the same match counting', await count(1))
  await cm.key('Escape', 'Escape', 27)
  check('Readonly search leaves inherited configuration intact', await cm.read(content) === inherited)

  const resource = '/projects/p-shop/apps/a-checkout/resources?env=b-checkout-dev&tab=' + encodeURIComponent('app:a-checkout:c-dev|c-dev|apps|deployments|shop-dev|checkout-api') + '&resourceTab=manifest'
  await evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(resource)}).then(result=>result?.message||'')`)
  await until('!!document.querySelector(".resource-manifest__editor .cm-content")')
  await clickText('\u7f16\u8f91\u5b9e\u65f6 Manifest', '.resource-manifest')
  await until('!!document.querySelector(".resource-manifest__editor .cm-content[aria-readonly=false]")')
  await cm.write('.resource-manifest__editor .cm-content', await cm.read('.resource-manifest__editor .cm-content') + '# search-toolbar\n')
  await clickText('\u9884\u89c8\u5e76\u4fdd\u5b58\u4fee\u6539', '.resource-manifest')
  await until('!!document.querySelector(".cm-merge-b .cm-content")')
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  const left = '.cm-merge-a .cm-content', right = '.cm-merge-b .cm-content'
  await cm.focus(left); await cm.key('f', 'KeyF', 70, 2); await input('.cm-merge-a .cm-search input[name=search]', 'metadata')
  await cm.focus(right); await cm.key('h', 'KeyH', 72, 2); await input('.cm-merge-b .cm-search input[name=search]', 'checkout-api')
  check('Both diff panes keep independent search queries', await evaluate('document.querySelector(".cm-merge-a input[name=search]").value==="metadata"&&document.querySelector(".cm-merge-b input[name=search]").value==="checkout-api"'))
  check('Only the editable diff side exposes replacement', await evaluate('!document.querySelector(".cm-merge-a input[name=replace]")&&!!document.querySelector(".cm-merge-b input[name=replace]")'))
  check('Both compact panels fit their columns at 1280px', await evaluate(`(()=>{return [...document.querySelectorAll('.cm-code-search')].every(el=>{const panel=el.getBoundingClientRect(),pane=el.closest('.cm-editor').getBoundingClientRect();return panel.left>=pane.left&&panel.right<=pane.right+1&&el.scrollWidth<=el.clientWidth+1})&&document.documentElement.scrollWidth<=innerWidth})()`))
  check('Panel buttons keep an accessible keyboard focus target', await evaluate('[...document.querySelectorAll(".cm-code-search button")].every(el=>el.getAttribute("aria-label")&&el.tabIndex===0)'))
  await screenshot('01-two-pane-search-1280')
  await cm.focus('.cm-merge-b input[name=search]'); await cm.key('Escape', 'Escape', 27)
  check('Escape closes only the focused diff search', await until('!document.querySelector(".cm-merge-b .cm-search")&&!!document.querySelector(".cm-merge-a .cm-search")&&document.activeElement.matches(".cm-merge-b .cm-content")'))
  await cm.focus('.cm-merge-a input[name=search]'); await cm.key('Escape', 'Escape', 27)
  check('The remaining readonly panel closes independently', await until('!document.querySelector(".cm-code-search")&&document.activeElement.matches(".cm-merge-a .cm-content")'))
  check('Zero browser runtime errors', browser.errors.length === 0)
  check('Zero browser console warnings', browser.warnings.length === 0)
} catch (error) {
  await screenshot('failure'); console.error(await evaluate('({url:location.href,text:document.body.innerText.slice(-2500),focus:document.activeElement.outerHTML})')); throw error
} finally {
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, errors: browser.errors, warnings: browser.warnings }, null, 2)); await browser.close()
}
console.log(`Completed ${checks.length} editor search browser checks`)
