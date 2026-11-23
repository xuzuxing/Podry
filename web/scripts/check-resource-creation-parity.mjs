// Resource creation drawer against the production frontend Mock. No Kubernetes writes.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'

const output = resolve(import.meta.dirname, '../screenshots-resource-creation-parity')
const browser = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182', output)
const { evaluate, until, call, screenshot } = browser
const cm = codeMirrorDriver(browser), checks = []
const content = '.resource-create__editor .cm-content'
const root = 'document.querySelector(".resource-create")'
const actions = 'document.querySelector(".resource-create__actions")'
const button = (text, scope = actions) => `[...${scope}.querySelectorAll('button')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)})`
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function click(text, scope = actions) { const target = button(text, scope); await until(`!!(${target})`); await evaluate(`(${target}).click()`); await delay(120) }
async function editReady() { await until(`(${root})?.dataset.phase==='edit'&&document.querySelector('.resource-create .resource-yaml')?.dataset.state==='ready'`); await delay(200) }
async function open() { await click('创建资源', 'document'); await editReady() }
async function closed() { await until(`!${root}`); await delay(250) }
async function resultReady() { await until(`(${root})?.dataset.phase==='result'`); await delay(100) }
async function field(name, value) {
  await evaluate(`(()=>{const el=document.querySelector('.resource-create .cm-search input[name=${name}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await delay(100)
}
const seed = '# 中文注释 <script>literal</script>\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: creation-browser\n  namespace: default\ndata:\n  value: before\n'
try {
  await browser.navigate('/clusters/c-prod?resource=configmaps'); await until('!!document.querySelector(".resource-table")'); await open()
  check('Desktop drawer matches the upstream 1024px width', await evaluate('Math.round(document.querySelector(".resource-create-drawer .t-drawer__content-wrapper").getBoundingClientRect().width)===1024'))
  check('Opening the drawer focuses its YAML document', await until(`document.activeElement.matches(${JSON.stringify(content)})`))
  check('Creation opens a blank native editable document', await cm.read(content) === '' && await evaluate(`document.querySelector(${JSON.stringify(content)}).getAttribute('aria-label')==='创建资源 YAML'&&document.querySelector(${JSON.stringify(content)}).getAttribute('aria-readonly')==='false'`))
  check('Empty Apply is disabled and no Dry run step is required', await evaluate(`(${button('应用')}).disabled&&!(${root}).textContent.includes('Dry run')`))
  check('Multi-document guidance and footer remain visible', await evaluate(`(${root}).textContent.includes('---')&&(()=>{const rect=${actions}.getBoundingClientRect();return rect.height>50&&rect.bottom<=innerHeight})()`))
  await cm.write(content, ' \n\t')
  check('Whitespace-only YAML keeps Apply disabled', await evaluate(`(${button('应用')}).disabled`))
  await cm.write(content, seed)
  check('Native creation edits retain Unicode, comments and terminal newline', await cm.read(content) === seed && await evaluate('!document.querySelector(".resource-create script")'))
  check('Nonempty YAML enables direct Apply', await evaluate(`!(${button('应用')}).disabled`))
  await cm.key('z', 'KeyZ', 90, 2)
  check('Creation supports native undo', await cm.read(content) === ' \n\t')
  await cm.key('y', 'KeyY', 89, 2)
  check('Creation supports native Windows redo', await cm.read(content) === seed)
  await evaluate(`document.querySelector('[aria-label="查找创建资源 YAML"]').click()`)
  check('Visible find action opens compact find with collapsed replace', await until('!!document.querySelector(".resource-create .cm-search input[name=search]")&&!document.querySelector(".resource-create .cm-search input[name=replace]")'))
  await evaluate(`document.querySelector('.resource-create .cm-search [aria-label="展开或收起替换"]').click()`); await delay(120)
  await field('search', 'literal'); await field('replace', 'changed')
  await click('全部替换', 'document.querySelector(".resource-create .cm-search")')
  check('Native replace changes only matching draft text', await cm.read(content) === seed.replace('literal', 'changed'))
  await evaluate('document.querySelector(".resource-create .cm-search input[name=search]").focus()'); await cm.key('Escape', 'Escape', 27)
  check('Escape closes editor search before closing the drawer', await until(`!!${root}&&!document.querySelector('.resource-create .cm-search')&&document.activeElement.matches(${JSON.stringify(content)})`))
  await evaluate(`(${button('取消')}).focus()`); await cm.key('k', 'KeyK', 75)
  check('Global Jump to Kind shortcut is suspended while creation is open', await evaluate('document.activeElement.closest(".resource-create")!==null&&!document.querySelector(".kind-search__results")'))
  await cm.key('k', 'KeyK', 75, 2)
  check('Ctrl K cannot open global navigation over the creation drawer', await evaluate('!document.querySelector(".command-search")?.checkVisibility({visibilityProperty:true})&&!!document.activeElement.closest(".resource-create")'))
  await cm.key('/', 'Slash', 191)
  check('Slash cannot move focus to the underlying resource list', await evaluate('!!document.activeElement.closest(".resource-create")'))
  await cm.write(content, 'metadata: [broken'); await click('应用'); await editReady()
  check('Malformed YAML stays editable with an inline error', await evaluate('document.querySelector(".resource-create__error")?.textContent.includes("YAML")') && await cm.read(content) === 'metadata: [broken')
  check('Rejected submission permits another direct Apply', await evaluate(`!(${button('应用')}).disabled&&!document.querySelector('.resource-create-results')`))
  const partial = seed + '---\napiVersion: v1\nkind: ConfigMap\nmetadata: {}\n'
  await cm.write(content, partial)
  const busy = await evaluate(`(async()=>{(${button('应用')}).click();await Promise.resolve();await Promise.resolve();const view=${root};const snapshot={phase:view.dataset.phase,status:!!view.querySelector('[role=status]'),disabled:[...${actions}.querySelectorAll('button')].every(el=>el.disabled),editor:!!view.querySelector('.cm-content')};(${button('取消')}).click();document.querySelector('.resource-create-drawer .t-drawer__close-btn').click();snapshot.stillOpen=!!${root};return snapshot})()`)
  check('Submitting uses a dedicated loading state with disabled actions', busy.phase === 'submitting' && busy.status && busy.disabled && !busy.editor)
  check('Cancel and header close cannot dismiss an active submission', busy.stillOpen)
  await cm.key('Escape', 'Escape', 27)
  check('Native Escape cannot dismiss an active submission', await evaluate(`!!${root}`))
  const blockedPath = await evaluate(`(async()=>{await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/clusters/c-dev?resource=configmaps');return location.pathname})()`)
  check('Cluster navigation is blocked during submission', blockedPath === '/clusters/c-prod')
  await resultReady()
  check('Partial response remains open with one result for every YAML object', await evaluate('document.querySelectorAll(".resource-create-results tbody tr").length===2&&document.querySelectorAll(".resource-create-results [data-status=created]").length===1&&document.querySelectorAll(".resource-create-results [data-status=failed]").length===1'))
  check('Result table has Kind, Name, Status and Message columns', await evaluate('[...document.querySelectorAll(".resource-create-results th")].map(el=>el.textContent).join("/")==="类型/名称/状态/说明"'))
  check('Each result exposes an icon and the failed item reason', await evaluate('document.querySelectorAll(".resource-create-results tbody .t-icon").length===2&&document.querySelector(".resource-create-results [data-status=failed]").textContent.includes("metadata.name")'))
  check('Result footer keeps Edit YAML left and Close right', await evaluate(`(()=>{const edit=(${button('编辑 YAML')}).getBoundingClientRect(),close=(${button('关闭')}).getBoundingClientRect(),footer=${actions}.getBoundingClientRect();return edit.left<footer.left+30&&close.right>footer.right-30&&close.left>edit.right})()`))
  await screenshot('01-partial-results')
  await click('编辑 YAML'); await editReady()
  check('Edit YAML restores the complete submitted multi-document draft', await cm.read(content) === partial)
  await cm.write(content, seed.replace('value: before', 'value: after')); await click('应用'); await resultReady()
  check('Reapplying an existing resource reports Updated rather than Created', await evaluate('document.querySelectorAll(".resource-create-results [data-status=updated]").length===1&&document.querySelectorAll(".resource-create-results [data-status=created]").length===0'))
  await click('编辑 YAML'); await editReady(); await cm.write(content, 'kind: [broken'); await click('应用'); await editReady(); await cm.key('Escape', 'Escape', 27); await closed()
  check('Closing after a later failed retry still refreshes earlier successful writes', await until('document.querySelector(".resource-table")?.textContent.includes("creation-browser")'))
  check('Closing returns keyboard focus to Create Resource', await evaluate('document.activeElement.textContent.trim()==="创建资源"'))
  await cm.key('k', 'KeyK', 75)
  check('Jump to Kind shortcut resumes after drawer closes', await until('!!document.activeElement.closest(".kind-search")'))
  await cm.key('Escape', 'Escape', 27); await open()
  check('Reopening starts blank with no stale error or results', await cm.read(content) === '' && await evaluate('!document.querySelector(".resource-create__error,.resource-create-results")'))
  await cm.key('z', 'KeyZ', 90, 2)
  check('Fresh creation history cannot restore an earlier draft', await cm.read(content) === '')
  const long = seed + Array.from({ length: 1000 }, (_, i) => `# row-${i} ${'x'.repeat(200)}`).join('\n') + '\n# long-creation-tail\n'
  await cm.write(content, long)
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await cm.scroll('.resource-create .cm-scroller', 14000, 350)
  check('Long creation YAML scrolls inside the drawer in both directions', await evaluate('(()=>{const el=document.querySelector(".resource-create .cm-scroller");return el.scrollTop>10000&&el.scrollLeft>100&&document.documentElement.scrollWidth===innerWidth})()'))
  check('Long creation editor virtualizes its offscreen lines', await evaluate('document.querySelectorAll(".resource-create .cm-line").length<300'))
  check('Native clipboard retains the complete long creation document', await cm.read(content) === long)
  await screenshot('02-long-yaml-1280')
  await call('Emulation.setDeviceMetricsOverride', { width: 640, height: 780, deviceScaleFactor: 1, mobile: false }); await delay(300)
  check('Narrow drawer and footer fit the viewport', await evaluate(`(()=>{const rect=document.querySelector('.resource-create-drawer .t-drawer__content-wrapper').getBoundingClientRect(),footer=${actions}.getBoundingClientRect();return Math.round(rect.width)===640&&footer.bottom<=innerHeight&&footer.right<=innerWidth})()`))
  await click('取消'); await closed()
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await open()
  const many = Array.from({ length: 80 }, (_, i) => seed.replace('creation-browser', `creation-bulk-${String(i).padStart(3, '0')}`)).join('---\n')
  await cm.write(content, many); await click('应用'); await resultReady()
  check('Large apply retains every per-object result', await evaluate('document.querySelectorAll(".resource-create-results tbody tr[data-status=created]").length===80'))
  await evaluate('document.querySelector(".resource-create-results").scrollTop=2000'); await delay(150)
  check('Large result list scrolls internally under a sticky header', await evaluate('(()=>{const root=document.querySelector(".resource-create-results"),header=root.querySelector("thead");return root.scrollTop>1000&&Math.abs(header.getBoundingClientRect().top-root.getBoundingClientRect().top)<2})()'))
  check('Result footer stays visible while results scroll', await evaluate(`(()=>{const rect=${actions}.getBoundingClientRect();return rect.bottom<=innerHeight&&rect.top>100})()`))
  await screenshot('03-long-results-1280')
  await call('Emulation.setDeviceMetricsOverride', { width: 640, height: 780, deviceScaleFactor: 1, mobile: false }); await delay(300)
  check('Narrow result rows keep all four columns within their scroll container', await evaluate('(()=>{const root=document.querySelector(".resource-create-results");return root.clientWidth<=640&&root.querySelector("tr").getBoundingClientRect().width<=640&&root.querySelectorAll("th").length===4})()'))
  await screenshot('04-results-640'); await click('关闭'); await closed()
  check('Close refreshes resource pagination after bulk creation', await until('document.querySelector(".resource-pagination__range")?.textContent.trim()==="1 - 82 of 82"&&document.querySelector(".resource-table")?.textContent.includes("creation-bulk-")'))
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await open()
  await cm.write(content, seed.replace('creation-browser', 'creation-header-close')); await click('应用'); await resultReady()
  await evaluate('document.querySelector(".resource-create-drawer .t-drawer__close-btn").click()'); await closed()
  check('Header close dismisses a completed result and refreshes the list', await until('document.querySelector(".resource-table")?.textContent.includes("creation-header-close")'))
  await open(); await cm.write(content, seed.replace('creation-browser', 'creation-canceled')); await click('取消'); await closed(); await open()
  check('Canceled drafts are discarded on the next creation', await cm.read(content) === '')
  await cm.key('Escape', 'Escape', 27); await closed()
  await evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/clusters/c-dev?resource=configmaps').then(result=>result?.message||'')`)
  await until('location.pathname==="/clusters/c-dev"&&!!document.querySelector(".resource-table")'); await open()
  check('Another cluster opens an independent blank creation session', await cm.read(content) === '')
  await cm.write(content, seed); await click('应用'); await resultReady()
  check('Same identity in another cluster creates a distinct object', await evaluate('document.querySelectorAll(".resource-create-results [data-status=created]").length===1'))
  await click('关闭'); await closed()
  assert.deepEqual(browser.errors, []); assert.deepEqual(browser.warnings, [])
  check('No browser runtime errors or console warnings', true)
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ count: checks.length, checks, errors: browser.errors, warnings: browser.warnings }, null, 2))
  console.log(`${checks.length} resource creation browser checks passed; frontend Mock only`)
} catch (error) { await screenshot('failure'); console.error('Browser errors:', browser.errors, browser.warnings); throw error }
finally { await browser.close() }
