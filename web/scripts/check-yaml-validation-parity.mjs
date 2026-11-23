// Production frontend Mock: public DOM, keyboard, pointer and clipboard only.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'

const output = resolve(import.meta.dirname, '../screenshots-yaml-validation-parity')
const browser = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182', output)
const { evaluate, until, call, screenshot } = browser
const cm = codeMirrorDriver(browser), checks = []
const app = '/projects/p-shop/apps/a-checkout', content = '.values-editor .cm-content'
const hints = '.cm-tooltip-autocomplete', lint = '.cm-panel-lint'
const zh = { yaml: 'YAML', abandon: '\u653e\u5f03\u4fee\u6539', reveal: '\u663e\u793a/\u7f16\u8f91\u503c', hide: '\u9690\u85cf\u503c' }
function check(name, result) { assert.ok(result, name); checks.push(name); console.log('PASS ' + name) }
async function ready() { await until(`!!document.querySelector(${JSON.stringify(content)})`); await delay(550) }
async function click(text, scope = 'document') {
  await until(`!![...${scope}.querySelectorAll('button,.t-radio-button,.t-checkbox')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)})`)
  await evaluate(`[...${scope}.querySelectorAll('button,.t-radio-button,.t-checkbox')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)}).click()`)
  await delay(150)
}
async function go(path) { await evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)}).then(result=>result?.message||'')`); await delay(450) }
async function diagnose(text) {
  await cm.write(content, text); await delay(650)
  await cm.focus(content); await cm.key('M', 'KeyM', 77, 10)
  await until(`!!document.querySelector('${lint}')`)
  return evaluate(`document.querySelector('${lint}').innerText`)
}
async function closeLint() { await evaluate(`document.querySelector('${lint} [name=close]').click()`); await until(`!document.querySelector('${lint}')`) }
async function complete(text) {
  await cm.write(content, text); await cm.key(' ', 'Space', 32, 2)
  await until(`!!document.querySelector('${hints} [role=option]')`)
  await delay(150)
}
async function hover(text) {
  const point = await evaluate(`(()=>{const span=[...document.querySelectorAll('.values-editor .cm-line span')].find(el=>el.textContent===${JSON.stringify(text)});if(!span)return null;const r=span.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  assert.ok(point, 'Missing visible YAML token ' + text)
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await until('!!document.querySelector(".yaml-schema-hover")')
}

try {
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await browser.navigate(app + '/config/base/deployment-template'); await ready()
  const original = await cm.read(content)
  check('Saved demo Values have no schema or YAML error markers', await evaluate('!document.querySelector(".values-editor .cm-lintRange-error")'))
  const invalid = '# keep-comment\nreplicaCount: wrong\n'
  const types = await diagnose(invalid)
  check('Wrong scalar types get a positioned native diagnostic', types.includes('Expected integer') && await evaluate('!!document.querySelector(".values-editor .cm-lintRange-error")'))
  check('Diagnostics identify the offline Chart schema', types.includes('Deployment Values'))
  check('Validation preserves exact invalid text and comments', await cm.read(content) === invalid)
  check('Existing form validation continues to disable saving', await evaluate('[...document.querySelectorAll(".dt__footer button")].find(el=>el.classList.contains("t-button--theme-primary")).disabled'))
  check('Native diagnostics panel stays within the page footer at 1280px', await evaluate('document.querySelector(".dt__footer").getBoundingClientRect().bottom<=innerHeight+2'))
  await cm.focus(content); await cm.key('F8', 'F8', 119)
  check('F8 focuses the offending value without modifying it', await cm.read(content) === invalid)
  await closeLint()
  check('A numeric upper bound is diagnosed in place', (await diagnose('replicaCount: 1001\n')).includes('1000'))
  await closeLint()
  check('Environment variable values use the same string contract as the form', (await diagnose('env:\n  ENABLED: true\n')).includes('Expected string'))
  await closeLint()
  check('Nested Job fields have independent schema validation', (await diagnose('job:\n  backoffLimit: -1\n')).includes('0'))
  await closeLint()
  check('YAML syntax errors are reported independently of schema types', (await diagnose('replicaCount: [broken\n')).includes('YAMLParseError'))
  await closeLint()
  check('Duplicate YAML keys are diagnosed before saving', (await diagnose('replicaCount: 1\nreplicaCount: 2\n')).includes('unique'))
  await closeLint()
  await cm.write(content, '# keep-comment\nreplicaCount: 3\ncustom_free_field: true\n'); await delay(650)
  check('Correcting YAML clears all stale markers and keeps custom fields', await evaluate('!document.querySelector(".cm-lintRange-error")'))

  await complete('# keep-comment\nrepl')
  check('Ctrl Space filters schema property suggestions by prefix', await evaluate('document.querySelectorAll(".cm-tooltip-autocomplete [role=option]").length===1&&document.querySelector(".cm-completionLabel").textContent==="replicaCount"'))
  check('Completion includes the property type and description', await evaluate('document.querySelector(".cm-completionDetail").textContent==="integer"&&document.querySelector(".cm-completionInfo").textContent.includes("1000")'))
  check('Opening completion preserves editor focus', await evaluate(`document.activeElement.matches(${JSON.stringify(content)})`))
  await cm.key('Enter', 'Enter', 13)
  const inserted = await cm.read(content)
  check('Enter applies the native schema snippet and preserves the comment', inserted.startsWith('# keep-comment\nreplicaCount:') && !inserted.includes('repl\n'))
  await cm.key('z', 'KeyZ', 90, 2)
  check('A completed property is one undo operation', await cm.read(content) === '# keep-comment\nrepl')
  await complete('job:\n  back')
  check('Nested completion offers the matching Job property', await evaluate('document.querySelector(".cm-completionLabel").textContent==="backoffLimit"'))
  await cm.key('Enter', 'Enter', 13)
  check('Nested insertion preserves YAML indentation', (await cm.read(content)).startsWith('job:\n  backoffLimit:'))
  await complete('job:\n  ')
  check('Explicit completion on an empty nested line offers both Job fields', await evaluate('document.querySelectorAll(".cm-tooltip-autocomplete [role=option]").length===2'))
  await cm.key('Enter', 'Enter', 13)
  check('An empty-line completion inserts a complete YAML key without parser placeholders', /^job:\n  "?backoffLimit"?:/.test(await cm.read(content)))
  await cm.key('z', 'KeyZ', 90, 2)
  check('Transient completion contexts never enter the document or its undo history', await cm.read(content) === 'job:\n  ')
  await complete('replicaCount: 2\n')
  check('Root completion omits properties already in the document', await evaluate('![...document.querySelectorAll(".cm-completionLabel")].some(el=>el.textContent==="replicaCount")'))
  await cm.key('Escape', 'Escape', 27)
  check('Escape closes completion and keeps the current page', await evaluate('!document.querySelector(".cm-tooltip-autocomplete")&&location.pathname.endsWith("/deployment-template")'))
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await cm.write(content, original); await cm.key('Home', 'Home', 36, 2); await delay(650)
  await hover('replicaCount')
  check('Pointer hover shows the schema description and type', await evaluate('document.querySelector(".yaml-schema-hover").textContent.includes("1000")&&document.querySelector(".yaml-schema-hover code").textContent.includes("integer")'))
  check('Hover uses text DOM and fits within the viewport', await evaluate('!document.querySelector(".yaml-schema-hover script,.yaml-schema-hover iframe")&&document.querySelector(".yaml-schema-hover").getBoundingClientRect().right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth'))
  await screenshot('01-schema-hover-1280')
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 })

  await go(app + '/config/overrides/e-dev/deployment-template?headerTab=inherited'); await ready()
  const inherited = await cm.read(content)
  await cm.key(' ', 'Space', 32, 2); await delay(300)
  check('Inherited Values do not expose insertion completion', await evaluate('!document.querySelector(".cm-tooltip-autocomplete")'))
  await cm.key('Enter', 'Enter', 13); await cm.key('z', 'KeyZ', 90, 2)
  check('Completion shortcuts cannot mutate inherited Values', await cm.read(content) === inherited)

  await go(app + '/config/base/configmaps'); await click(zh.yaml, 'document.querySelector(".config-data-editor")'); await ready()
  const configMap = await cm.read(content)
  await cm.write(content, 'replicaCount: free-string\n'); await delay(650)
  check('ConfigMap data does not inherit the deployment Chart schema', await evaluate('!document.querySelector(".cm-lintRange-error")'))
  await cm.key(' ', 'Space', 32, 2); await delay(300)
  check('ConfigMap has no invented Chart completion menu', await evaluate('!document.querySelector(".cm-tooltip-autocomplete")'))
  check('ConfigMap duplicate keys still receive YAML diagnostics', (await diagnose('KEY: a\nKEY: b\n')).includes('unique'))
  await closeLint()
  await cm.write(content, configMap); await go(app + '/config/base/secrets'); await click(zh.yaml, 'document.querySelector(".config-data-editor")'); await ready()
  const masked = await cm.read(content)
  await cm.key(' ', 'Space', 32, 2)
  check('Masked Secret has no insertion completion', await evaluate('!document.querySelector(".cm-tooltip-autocomplete")'))
  check('Masked Secret remains readonly under diagnostics shortcuts', await cm.read(content) === masked && await evaluate('document.querySelector(".values-editor .cm-content").getAttribute("aria-readonly")==="true"'))
  await click(zh.reveal)
  const secretDraft = '# private-note\nTOKEN: [private-invalid\n'
  check('Revealed Secret can expose its current YAML syntax diagnostic', (await diagnose(secretDraft)).includes('YAMLParseError'))
  await click(zh.hide); await delay(650)
  check('Hiding a Secret disposes open diagnostics and private messages', await evaluate('!document.querySelector(".cm-panel-lint")&&!document.querySelector(".cm-tooltip")&&![...document.querySelectorAll(".values-editor")].some(el=>el.textContent.includes("private-invalid"))'))
  await cm.key('z', 'KeyZ', 90, 2)
  check('Hidden Secret undo cannot recover private diagnostic text', !(await cm.read(content)).includes('private-invalid'))
  await click(zh.reveal); await cm.write(content, masked); await click(zh.hide)

  await browser.navigate('/clusters/c-prod?resource=configmaps')
  await click('\u521b\u5efa\u8d44\u6e90'); await until('!!document.querySelector(".resource-create .cm-content")')
  const create = '.resource-create .cm-content'
  await cm.write(create, 'apiVersion: [broken\n'); await delay(650)
  check('Infrastructure creation shares native YAML diagnostics', await evaluate('!!document.querySelector(".resource-create .cm-lintRange-error,.resource-create .cm-lintPoint-error")'))
  check('Syntax diagnostics keep direct Apply available for server-style errors', await evaluate('![...document.querySelectorAll(".resource-create__actions button")].find(el=>el.textContent.trim()==="\u5e94\u7528").disabled'))
  await cm.write(create, 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: lint-one\n---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: lint-two\n'); await delay(650)
  check('Independent YAML documents do not produce false duplicate-key errors', await evaluate('!document.querySelector(".resource-create .cm-lintRange-error,.resource-create .cm-lintPoint-error")'))
  check('No extra lint gutter changes the established editor layout', await evaluate('!document.querySelector(".cm-gutter-lint")'))
  const resourceTab = encodeURIComponent('app:a-checkout:c-dev|c-dev|apps|deployments|shop-dev|checkout-api')
  await browser.navigate(app + '/resources?env=b-checkout-dev&tab=' + resourceTab + '&resourceTab=manifest')
  const single = '.resource-manifest__editor .cm-content', right = '.cm-merge-b .cm-content'
  await until(`!!document.querySelector('${single}')`)
  const baseline = await cm.read(single)
  await click('\u7f16\u8f91\u5b9e\u65f6 Manifest'); await cm.write(single, baseline + '# review-lint\n')
  await click('\u9884\u89c8\u5e76\u4fdd\u5b58\u4fee\u6539'); await until(`!!document.querySelector('${right}')`)
  await cm.write(right, 'metadata: [invalid\n'); await delay(650)
  check('Application Review diagnoses the modified pane independently', await evaluate('!!document.querySelector(".cm-merge-b .cm-lintPoint-error,.cm-merge-b .cm-lintRange-error")&&!document.querySelector(".cm-merge-a .cm-lintPoint-error,.cm-merge-a .cm-lintRange-error")'))
  await cm.key('M', 'KeyM', 77, 10); await until(`!!document.querySelector('${lint}')`)
  check('Review exposes the same native syntax diagnostic panel', (await evaluate(`document.querySelector('${lint}').innerText`)).includes('YAMLParseError'))
  await closeLint(); await cm.write(right, baseline + '# review-lint\n'); await delay(650)
  check('Correcting Review clears native diagnostics without changing the original', await evaluate('!document.querySelector(".resource-yaml-diff .cm-lintPoint-error,.resource-yaml-diff .cm-lintRange-error")') && await cm.read('.cm-merge-a .cm-content') === baseline)
  await click('\u53d6\u6d88', 'document.querySelector(".resource-manifest__actions")')
  await click(zh.abandon, '[...document.querySelectorAll(".t-dialog")].find(el=>el.checkVisibility({visibilityProperty:true}))')
  await until('document.querySelector(".resource-manifest")?.dataset.mode==="read"')
  await browser.navigate(app + '/config/compare/configmaps/checkout-api-config?left=base&leftVersion=saved&right=e-dev&rightVersion=saved')
  await until('!!document.querySelector(".configuration-diff")'); await click(zh.yaml, 'document.querySelector(".configuration-diff")')
  await until('!!document.querySelector(".configuration-yaml-diff .cm-content")')
  const beforeCollapse = await cm.read(right)
  await cm.key('M', 'KeyM', 77, 10); await until(`!!document.querySelector('${lint}')`)
  check('Full configuration comparison enables native YAML diagnostics', await evaluate(`!!document.querySelector('${lint}')`))
  await click('\u4ec5\u663e\u793a\u5dee\u5f02', 'document.querySelector(".configuration-diff__toolbar")')
  check('Only changes disposes diagnostics along with the full-view parsing extensions', await until(`!document.querySelector('${lint}')`))
  await cm.focus(right); await cm.key('M', 'KeyM', 77, 10)
  check('Collapsed comparison does not reopen syntax diagnostics', await evaluate(`!document.querySelector('${lint}')`))
  await click('\u4ec5\u663e\u793a\u5dee\u5f02', 'document.querySelector(".configuration-diff__toolbar")')
  await cm.focus(right); await cm.key('M', 'KeyM', 77, 10); await until(`!!document.querySelector('${lint}')`)
  check('Returning to full comparison restores diagnostics and the complete document', await cm.read(right) === beforeCollapse)
  check('Zero browser runtime errors', browser.errors.length === 0)
  check('Zero browser console warnings', browser.warnings.length === 0)
} catch (error) {
  await screenshot('failure'); console.error(await evaluate('({url:location.href,text:document.body.innerText.slice(-2200)})')); throw error
} finally {
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, errors: browser.errors, warnings: browser.warnings }, null, 2)); await browser.close()
}
console.log(`Completed ${checks.length} YAML validation browser checks`)
