// Public keyboard/clipboard/scroll interactions against the production Mock pages.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { parse } from 'yaml'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'

const output = resolve(import.meta.dirname, '../screenshots-config-editor-parity')
const browser = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182', output)
const { evaluate, until, call, screenshot } = browser
const cm = codeMirrorDriver(browser), checks = []
const app = '/projects/p-shop/apps/a-checkout'
const content = '.values-editor .cm-content'
const left = '.configuration-yaml-diff .cm-merge-a .cm-content'
const right = '.configuration-yaml-diff .cm-merge-b .cm-content'
const dialog = '[...document.querySelectorAll(".t-dialog")].find(el=>el.checkVisibility({visibilityProperty:true}))'
let warningCount = 0
function check(name, value) {
  if (browser.warnings.length > warningCount) { console.log('WARN near ' + name, browser.warnings.slice(warningCount)); warningCount = browser.warnings.length }
  assert.ok(value, name); checks.push(name); console.log('PASS ' + name)
}
async function tap(selector) { await until(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(180) }
async function click(text, scope = 'document') {
  assert.ok(await evaluate(`(()=>{const el=[...${scope}.querySelectorAll('button,a,.t-radio-button,.t-checkbox')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)});if(!el)return false;el.click();return true})()`), 'Missing action ' + text)
  await delay(180)
}
async function input(selector, text) {
  await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await delay(120)
}
async function go(path) { await evaluate(`void document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`); await delay(650) }
async function ready(scope = '.values-editor') { await until(`document.querySelector(${JSON.stringify(scope + ' [data-state]')})?.dataset.state==='ready'`); await delay(120) }
async function save(scope) { await click('保存修改', `document.querySelector(${JSON.stringify(scope)})`); await until(`document.querySelector(${JSON.stringify(scope)})?.textContent.includes('· 已保存')`) }
async function readonlyType(selector) {
  await cm.focus(selector)
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88, text: 'x' })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88 })
  await cm.key('Backspace', 'Backspace', 8); await cm.key('z', 'KeyZ', 90, 2)
}
async function choose(label, text) {
  await tap(`[aria-label="${label}"] .t-input`)
  await until(`[...document.querySelectorAll('.t-select-option')].some(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)})`)
  await evaluate(`[...document.querySelectorAll('.t-select-option')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)}).click()`)
  await delay(250)
}
try {
  await browser.navigate(app + '/config/base/deployment-template'); await ready()
  check('Deployment values use one native editable YAML view', await evaluate('document.querySelectorAll(".values-editor .cm-content[aria-readonly=false]").length===1&&!document.querySelector(".values-editor textarea")'))
  check('Native line numbers, folding and syntax highlighting are available', await evaluate('!!document.querySelector(".values-editor .cm-lineNumbers")&&!!document.querySelector(".values-editor .cm-foldGutter")&&!!document.querySelector(".values-editor .cm-line span")'))
  const initial = await cm.read(content)
  await cm.key('End', 'End', 35, 2); await cm.key('Tab', 'Tab', 9)
  check('Tab inserts two spaces', await cm.read(content) === initial + '  ')
  await cm.key('z', 'KeyZ', 90, 2)
  check('Native undo restores the exact values document', await cm.read(content) === initial)
  await cm.key('y', 'KeyY', 89, 2)
  check('Native redo restores indentation', await cm.read(content) === initial + '  ')
  await cm.key('z', 'KeyZ', 90, 2); await cm.key('Tab', 'Tab', 9, 8)
  check('Shift Tab leaves the editor without changing the document', await evaluate(`document.activeElement!==document.querySelector(${JSON.stringify(content)})`) && await cm.read(content) === initial)
  await tap('[aria-label="查找配置 YAML"]')
  check('Toolbar search focuses the native find input', await until('document.activeElement?.matches(".values-editor .cm-search input[name=search]")'))
  await cm.key('Escape', 'Escape', 27)
  const longValues = '# exact-config-editor-comment\nreplicaCount: 2\nenv:\n  KEEP: "original"\n' + Array.from({ length: 1000 }, (_, i) => `extra_${String(i).padStart(4, '0')}: "${'x'.repeat(180)}"`).join('\n') + '\nlast_config_marker: "tail"\n'
  await cm.write(content, longValues)
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await cm.scroll('.values-editor .cm-scroller', 15000, 180)
  check('Long deployment YAML scrolls inside the editor in both directions', await evaluate('(()=>{const el=document.querySelector(".values-editor .cm-scroller");return el.scrollTop>10000&&el.scrollLeft>100})()'))
  check('The native editor virtualizes long documents', await evaluate('document.querySelectorAll(".values-editor .cm-line").length<300'))
  check('Copy includes the complete offscreen YAML and trailing newline', await cm.read(content) === longValues)
  await tap('[aria-label="查找配置 YAML"]'); await input('.values-editor .cm-search input[name=search]', 'last_config_marker'); await click('下一项', 'document.querySelector(".values-editor .cm-search")')
  check('Native find reaches the offscreen tail', await until('document.querySelector(".values-editor .cm-searchMatch")?.textContent==="last_config_marker"'))
  await cm.key('Escape', 'Escape', 27)
  check('Long deployment YAML keeps the footer visible at 1280px', await evaluate('document.documentElement.scrollWidth<=innerWidth&&document.querySelector(".dt__footer").getBoundingClientRect().bottom<=innerHeight+2'))
  await save('.dt__footer'); await go(app + '/config/git'); await go(app + '/config/base/deployment-template'); await ready()
  check('Saved long YAML retains comments, quoting and the final newline', await cm.read(content) === longValues)
  await screenshot('01-deployment-native-1280')
  await go(app + '/config/overrides/e-dev/deployment-template?headerTab=inherited'); await ready()
  const inherited = await cm.read(content)
  await readonlyType(content)
  check('Inherited values reject typing, deletion and undo', await cm.read(content) === inherited && await evaluate('document.querySelector(".values-editor .cm-content").getAttribute("aria-readonly")==="true"'))
  await click('覆盖', 'document.querySelector(".dt__tabs")')
  check('Changing to override updates the editor access and accessible label', await until('document.querySelector(".values-editor .cm-content")?.getAttribute("aria-readonly")==="false"') && !(await cm.read(content)).includes('last_config_marker'))
  const ownValues = await cm.read(content); await cm.key('z', 'KeyZ', 90, 2)
  check('Undo cannot restore inherited values into the override draft', await cm.read(content) === ownValues)
  await click('试运行'); await ready()
  check('Dry run uses a native readonly view with its preview label', await evaluate('document.querySelector(".values-editor .cm-content").getAttribute("aria-label")==="本地清单预览"&&document.querySelector(".values-editor .cm-content").getAttribute("aria-readonly")==="true"'))

  await go(app + '/config/base/configmaps'); await click('YAML', 'document.querySelector(".config-data-editor")'); await ready()
  const longData = '# full-config-map\nLOG_LEVEL: info\n' + Array.from({ length: 1000 }, (_, i) => `KEY_${String(i).padStart(4, '0')}: "${'v'.repeat(160)}"`).join('\n') + '\nTAIL_KEY: tail-value\n'
  await cm.write(content, longData); await save('.ce__footer')
  await cm.scroll('.values-editor .cm-scroller', 14000, 150)
  check('ConfigMap form gives the native editor a bounded scrolling height', await evaluate('(()=>{const box=document.querySelector(".values-editor").getBoundingClientRect();const area=document.querySelector(".values-editor .cm-scroller");return box.height===360&&area.scrollTop>10000&&area.scrollLeft>0})()'))
  check('ConfigMap long values preserve every key in the clipboard', await cm.read(content) === longData)
  await evaluate('window.__copiedConfig="";Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{window.__copiedConfig=text}}})')
  await tap('[aria-label="复制配置 YAML"]')
  check('ConfigMap toolbar copies the full original YAML', await evaluate('window.__copiedConfig') === longData)
  check('ConfigMap toolbar and footer remain within their scrolling form', await evaluate('document.documentElement.scrollWidth<=innerWidth&&document.querySelector(".ce__footer").getBoundingClientRect().bottom<=innerHeight+2'))
  await screenshot('02-configmap-native-1280')

  await go(app + '/config/base/secrets'); await click('YAML', 'document.querySelector(".config-data-editor")'); await ready()
  const masked = await cm.read(content); await readonlyType(content)
  check('Masked Secret editor rejects keyboard changes and undo', await cm.read(content) === masked)
  await click('显示/编辑值'); await cm.write(content, '# private-comment\nTOKEN: private-draft\n')
  await click('隐藏值'); await cm.key('z', 'KeyZ', 90, 2)
  const hiddenDraft = await cm.read(content)
  check('Hiding a Secret clears private text from the native document and undo', !(await cm.read(content)).includes('private-draft') && !(await cm.read(content)).includes('private-comment'))
  await tap('[aria-label="查找配置 YAML"]'); await input('.values-editor .cm-search input[name=search]', 'private-draft')
  check('Hidden Secret search cannot find private text', await evaluate('!document.querySelector(".values-editor .cm-searchMatch")'))
  await cm.key('Escape', 'Escape', 27); await click('显示/编辑值')
  check('Explicit reveal recovers the unchanged in-memory draft', (await cm.read(content)).includes('private-draft'))
  await cm.write(content, hiddenDraft)
  await click('隐藏值'); const sameMask = await cm.read(content); await click('显示/编辑值'); await cm.key('z', 'KeyZ', 90, 2)
  check('Access changes reset undo even when masked and revealed text is identical', await cm.read(content) === sameMask && !(await cm.read(content)).includes('private-draft'))
  await click('取消修改'); await click('放弃修改', dialog)

  await go(app + '/config/compare/configmaps/checkout-api-config?left=base&leftVersion=saved&right=e-dev&rightVersion=saved')
  await until('!!document.querySelector(".configuration-diff")'); await click('YAML', 'document.querySelector(".configuration-diff")'); await ready('.configuration-yaml-diff')
  const original = await cm.read(left), modified = await cm.read(right)
  check('Application configuration comparison includes a bounded 30px minimap', await until('document.querySelector(".configuration-yaml-diff .resource-diff-minimap")?.getBoundingClientRect().width===30'))
  check('Configuration column labels align with the minimap-adjusted document divider', await evaluate('Math.abs(document.querySelector(".configuration-yaml-diff__labels>div").getBoundingClientRect().right-document.querySelector(".cm-merge-a").getBoundingClientRect().right)<2'))
  check('Both comparison panes contain complete effective ConfigMap data', parse(original).data.TAIL_KEY === 'tail-value' && parse(modified).data.TAIL_KEY === 'tail-value' && parse(modified).data.LOG_LEVEL === 'debug')
  check('Native diff exposes two readonly panes and line numbers', await evaluate('document.querySelectorAll(".configuration-yaml-diff .cm-content[aria-readonly=true]").length===2&&document.querySelectorAll(".configuration-yaml-diff .cm-lineNumbers").length===2'))
  await readonlyType(left); await readonlyType(right)
  check('Neither comparison side allows typing, deletion or undo', await cm.read(left) === original && await cm.read(right) === modified)
  await tap('[aria-label="下一处差异"]')
  check('Next difference selects a native diff chunk', await until('document.querySelector(".resource-diff-navigation [role=status]")?.textContent.includes("1 / ")'))
  await cm.key('F7', 'F7', 118)
  check('F7 cycles through native diff positions', await evaluate('document.querySelector(".resource-diff-navigation [role=status]").textContent.includes("/")'))
  await click('仅显示差异', 'document.querySelector(".configuration-diff__toolbar")')
  check('Only changes collapses unchanged ranges inside the native editor', await until('document.querySelectorAll(".configuration-yaml-diff .cm-collapsedLines").length>=2'))
  check('Only changes hides the minimap as in the upstream collapsed diff', await evaluate('document.querySelector(".resource-diff-minimap").hidden&&!document.querySelector(".resource-diff-minimap").checkVisibility({visibilityProperty:true})'))
  check('Collapsed unchanged content stays intact for full document copy', await cm.read(left) === original && await cm.read(right) === modified)
  await tap('[aria-label="查找对比配置"]'); await input('.cm-merge-b .cm-search input[name=search]', 'TAIL_KEY'); await click('下一项', 'document.querySelector(".cm-merge-b .cm-search")')
  check('Find can reveal a match inside a collapsed unchanged range', await until('document.querySelector(".cm-merge-b .cm-searchMatch")?.textContent==="TAIL_KEY"'))
  await cm.key('Escape', 'Escape', 27)
  await click('仅显示差异', 'document.querySelector(".configuration-diff__toolbar")')
  check('Disabling only changes restores all unchanged ranges', await until('!document.querySelector(".configuration-yaml-diff .cm-collapsedLines")'))
  check('Full diff restores its minimap with current viewport dimensions', await until('document.querySelector(".resource-diff-minimap").checkVisibility({visibilityProperty:true})&&document.querySelector(".resource-diff-minimap canvas").height>0'))
  await click('仅显示差异', 'document.querySelector(".configuration-diff__toolbar")')
  const collapsedCount = await evaluate('document.querySelectorAll(".configuration-yaml-diff .cm-collapsedLines").length')
  await tap('.cm-merge-a .cm-collapsedLines')
  check('Expanding a collapsed range reveals the corresponding range in both panes', await until(`document.querySelectorAll('.configuration-yaml-diff .cm-collapsedLines').length===${collapsedCount - 2}`))
  const beforeLabels = await evaluate('[...document.querySelectorAll(".configuration-yaml-diff .cm-content")].map(el=>el.getAttribute("aria-label"))')
  await tap('[aria-label="交换两侧"]')
  const afterLabels = await evaluate('[...document.querySelectorAll(".configuration-yaml-diff .cm-content")].map(el=>el.getAttribute("aria-label"))')
  check('Swapping contexts updates editor labels as well as documents', afterLabels[0] === beforeLabels[1] && afterLabels[1] === beforeLabels[0] && await cm.read(left) === modified && await cm.read(right) === original)
  check('Changing comparison contexts rebuilds collapsed ranges for the new documents', await until('document.querySelectorAll(".configuration-yaml-diff .cm-collapsedLines").length>=2'))
  await click('仅显示差异', 'document.querySelector(".configuration-diff__toolbar")')
  await cm.scroll('.cm-merge-b .cm-scroller', 14000, 130)
  check('Long native comparison panes scroll together vertically and horizontally', await evaluate('(()=>{const a=document.querySelector(".cm-merge-a .cm-scroller"),b=document.querySelector(".cm-merge-b .cm-scroller");return a.scrollTop>10000&&a.scrollTop===b.scrollTop&&a.scrollLeft===b.scrollLeft&&b.scrollLeft>0})()'))
  check('Native diff controls fit within the viewport at 1280px', await evaluate('document.documentElement.scrollWidth<=innerWidth&&document.querySelector(".configuration-yaml-diff__footer").getBoundingClientRect().bottom<=innerHeight+2'))
  await cm.focus(left); await cm.key('Home', 'Home', 36, 2)
  await cm.focus(right); await cm.key('Home', 'Home', 36, 2)
  await cm.scroll('.cm-merge-b .cm-scroller', 14000, 0)
  await screenshot('03-configmap-native-diff-1280')
  await click('仅显示差异', 'document.querySelector(".configuration-diff__toolbar")')
  await choose('对比基准环境', '基础配置（Base）')
  check('Identical comparisons report no differences and disable navigation', await until('[...document.querySelectorAll(".resource-diff-navigation button")].every(el=>el.disabled)&&document.querySelector(".resource-diff-navigation [role=status]").textContent.includes("没有配置差异")'))
  check('Identical collapsed documents still copy complete data', await cm.read(left) === original && await cm.read(right) === original)

  await go(app + '/deployments?env=e-dev&deployment=d-checkout-dev-1&tab=config')
  await until('!!document.querySelector(".deployment-snapshot")'); await click('YAML', 'document.querySelector(".deployment-snapshot")'); await ready()
  const historical = await cm.read(content)
  check('Historical YAML is readonly in a bounded editor', await evaluate('document.querySelector(".deployment-snapshot .values-editor").getBoundingClientRect().height===360&&document.querySelector(".values-editor .cm-content").getAttribute("aria-readonly")==="true"'))
  await readonlyType(content)
  check('Historical YAML cannot be changed by keyboard operations', await cm.read(content) === historical)
  await click('对比当前配置', 'document.querySelector(".deployment-snapshot")'); await click('YAML', 'document.querySelector(".configuration-diff")'); await ready('.configuration-yaml-diff')
  check('History uses the native readonly diff with a bounded height', await evaluate('document.querySelector(".deployment-snapshot .configuration-diff").getBoundingClientRect().height===420&&document.querySelectorAll(".configuration-yaml-diff .cm-content[aria-readonly=true]").length===2'))
  check('History comparison reuses the current minimap and its local scroll target', await evaluate('document.querySelectorAll(".resource-diff-minimap").length===1&&document.querySelector(".deployment-snapshot .resource-diff-minimap").getAttribute("aria-controls")===document.querySelector(".deployment-snapshot .cm-mergeView").id'))
  check('History diff keeps the original snapshot separate from saved values', await cm.read(left) === historical && (await cm.read(right)).includes('last_config_marker'))
  await evaluate('document.querySelector(".deployment-snapshot").scrollIntoView({block:"end"})'); await delay(250)
  check('History diff stays inside the configuration column without outer horizontal scrolling', await evaluate('(()=>{const box=document.querySelector(".deployment-snapshot").getBoundingClientRect(),area=document.querySelector(".dh-content");return box.width<=800&&box.right<=innerWidth&&area.scrollWidth<=area.clientWidth&&document.documentElement.scrollWidth<=innerWidth})()'))
  check('Scrolling history reveals the native diff footer inside the content viewport', await evaluate('document.querySelector(".configuration-yaml-diff__footer").getBoundingClientRect().bottom<=document.querySelector(".dh-content").getBoundingClientRect().bottom+1'))
  await screenshot('04-history-native-diff')
  await go(app + '/config/base/deployment-template'); await ready()
  check('Navigating back to configuration leaves one current native editor', await evaluate('document.querySelectorAll(".cm-editor").length===1&&!document.querySelector(".configuration-yaml-diff")') && await cm.read(content) === longValues)
  check('Leaving the history comparison disposes its minimap', await evaluate('!document.querySelector(".resource-diff-minimap")'))
  check('Zero browser runtime errors', browser.errors.length === 0)
  check('Zero console warnings', browser.warnings.length === 0)
} catch (error) {
  await screenshot('failure')
  console.error(await evaluate('({url:location.href,text:document.body.innerText.slice(-4000)})'))
  throw error
} finally {
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, errors: browser.errors, warnings: browser.warnings }, null, 2))
  await browser.close()
}
console.log(`Completed ${checks.length} native configuration editor checks; screenshots: ${output}`)
