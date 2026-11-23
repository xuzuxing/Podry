// Desired/live Manifest UI checks against frontend Mock only.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'
const output = resolve(import.meta.dirname, '../screenshots-resource-comparison-parity')
const b = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182', output)
const { evaluate, until, screenshot, call } = b
const cm = codeMirrorDriver(b)
const desiredEditor = '.resource-compare .cm-merge-a .cm-content', liveEditor = '.resource-compare .cm-merge-b .cm-content'
const checks = []
const dialog = '[...document.querySelectorAll(".t-dialog")].find(el=>el.checkVisibility({visibilityProperty:true}))'
const app = (ns, cluster, binding, group, resource, name) => '/projects/p-shop/apps/a-checkout/resources?env=' + binding + '&tab=' + encodeURIComponent(`app:a-checkout:${cluster}|${cluster}|${group}|${resource}|${ns}|${name}`) + '&resourceTab=manifest'
const dev = app('shop-dev', 'c-dev', 'b-checkout-dev', 'apps', 'deployments', 'checkout-api')
const comparison = 'document.querySelector(".resource-compare")'
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function click(text, scope = 'document') {
  assert.ok(await evaluate(`(()=>{const el=[...${scope}.querySelectorAll('button')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)});if(!el)return false;el.click();return true})()`), 'Missing action ' + text)
  await delay(100)
}
async function tap(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(100) }
async function go(path) { await evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)}).then(result=>result?.message||'')`); await delay(200) }
async function read() { await until('!!document.querySelector(".resource-manifest[data-mode=read] .resource-manifest__editor .cm-content")') }
async function open() { await tap('.resource-manifest__compare'); await until(`${comparison}?.dataset.state==='ready'&&document.querySelector('.resource-compare .resource-yaml-diff')?.dataset.state==='ready'`) }
async function close() { await tap('[aria-label="关闭期望 Manifest"]'); await read() }
async function input(value) { await cm.write('.resource-manifest[data-mode=edit] .resource-yaml .cm-content', value) }
async function key(shift = false) { await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F7', code: 'F7', windowsVirtualKeyCode: 118, modifiers: shift ? 8 : 0 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F7', code: 'F7', windowsVirtualKeyCode: 118, modifiers: shift ? 8 : 0 }); await delay(100) }
try {
  await b.navigate(dev); await read()
  check('Application root resource offers desired comparison inline', await evaluate('!!document.querySelector(".resource-manifest__toolbar .resource-manifest__compare")&&document.querySelector(".resource-manifest__toolbar").getBoundingClientRect().height<=33'))
  const original = await cm.read(".resource-manifest__editor .cm-content")
  await open()
  check('Compare shows Desired left and Live right without a dialog', await evaluate(`(${comparison}).querySelectorAll('.cm-content').length===2&&[...(${comparison}).querySelectorAll('.resource-compare__title')].map(el=>el.textContent.trim()).join('|').startsWith('期望 Manifest|实时 Manifest')&&!${dialog}`))
  check('Both comparison panes are read only', await evaluate(`(${comparison}).querySelectorAll('.cm-content[aria-readonly=true]').length===2`))
  check('Matching snapshot explains no configuration differences', await evaluate(`(${comparison}).textContent.includes('没有配置差异')&&(${comparison}).querySelector('[aria-label=下一处差异]').disabled`))
  check('Compare hides live edit and apply actions', await evaluate('!document.querySelector(".resource-manifest__actions")&&!document.querySelector(".resource-manifest__review")'))
  check('Snapshot source and ignored fields are explicit', await evaluate(`(${comparison}).textContent.includes('演示期望快照')&&(${comparison}).textContent.includes('忽略 status')`))
  check('Opening comparison gives focus to close control', await evaluate('document.activeElement.getAttribute("aria-label")==="关闭期望 Manifest"'))
  await screenshot('01-equal-desired-live')
  await close()
  const restoredFocus = await evaluate('document.activeElement.classList.contains("resource-manifest__compare")')
  check('Closing restores original live text and invoker focus', restoredFocus && await cm.read('.resource-manifest__editor .cm-content') === original)
  await click('编辑实时 Manifest', 'document.querySelector(".resource-manifest")')
  const draft = original.replace('replicas: 1', 'replicas: 3').replace('v1.42.0', 'v2.0.0')
  await input(draft)
  check('Unsaved editing cannot enter comparison through toolbar', await evaluate('!document.querySelector(".resource-manifest__compare")&&!!document.querySelector(".resource-manifest[data-mode=edit]")'))
  await click('事件', 'document.querySelector(".resource-detail-tabs")'); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('Cancelled navigation preserves existing edit draft', await cm.read('.resource-manifest[data-mode=edit] .resource-yaml .cm-content') === draft)
  await click('预览并保存修改', 'document.querySelector(".resource-manifest")'); await until('!!document.querySelector(".resource-manifest__review")')
  await until('document.querySelector(".resource-manifest__review .resource-yaml-diff")?.dataset.state==="ready"')
  check('Edit review remains separate from desired comparison', await evaluate('!document.querySelector(".resource-compare")&&document.querySelectorAll(".resource-manifest__review .cm-content[aria-readonly=true]").length===1'))
  await click('应用修改', 'document.querySelector(".resource-manifest")'); await read(); await open()
  const expectedText = await cm.read(desiredEditor), liveText = await cm.read(liveEditor)
  check('Live edits leave desired replicas and image unchanged', expectedText.includes('replicas: 1')&&expectedText.includes('v1.42.0')&&liveText.includes('replicas: 3')&&liveText.includes('v2.0.0'))
  check('Changed configuration displays hunks and colored markers', await evaluate(`(${comparison}).textContent.includes('2 处差异')&&(${comparison}).querySelectorAll('.cm-changedLine').length>=4`))
  await tap('[aria-label="下一处差异"]')
  check('Next difference selects the first changed line', await evaluate(`(${comparison}).querySelector('.resource-compare__navigation').textContent.includes('1 / 2')&&document.activeElement.matches('.cm-content')&&!!document.querySelector('.cm-merge-b .cm-selectionBackground')`))
  await key()
  check('F7 advances to the next difference', await evaluate(`(${comparison}).querySelector('.resource-compare__navigation').textContent.includes('2 / 2')`))
  await key()
  check('Difference navigation wraps at the end', await evaluate(`(${comparison}).querySelector('.resource-compare__navigation').textContent.includes('1 / 2')`))
  await key(true)
  check('Shift F7 navigates backward with wrap', await evaluate(`(${comparison}).querySelector('.resource-compare__navigation').textContent.includes('2 / 2')`))
  await evaluate(`window.comparisonCopies=[];window.comparisonDownloads=[];window.comparisonBlobs=new Map();window.comparisonCopyFail=false;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{if(window.comparisonCopyFail)throw Error('denied');window.comparisonCopies.push(text)}}});const create=URL.createObjectURL;URL.createObjectURL=function(blob){const url=create.call(this,blob);window.comparisonBlobs.set(url,blob);return url};const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.comparisonDownloads.push({name:this.download,blob:window.comparisonBlobs.get(this.href)});return}return click.call(this)}`)
  await tap('[aria-label="复制期望 Manifest"]'); await tap('[aria-label="复制实时 Manifest"]')
  check('Each copy exports the corresponding complete visible pane', await evaluate(`window.comparisonCopies[0]===${JSON.stringify(expectedText)}&&window.comparisonCopies[1]===${JSON.stringify(liveText)}`))
  await tap('[aria-label="下载期望 Manifest"]'); await tap('[aria-label="下载实时 Manifest"]')
  check('Desired and live downloads have distinct filenames', await evaluate('window.comparisonDownloads[0].name==="deployment-checkout-api-desired.yaml"&&window.comparisonDownloads[1].name==="deployment-checkout-api-live.yaml"'))
  check('Downloads retain each pane full content', await evaluate(`Promise.all(window.comparisonDownloads.map(item=>item.blob.text())).then(texts=>texts[0]===${JSON.stringify(expectedText)}&&texts[1]===${JSON.stringify(liveText)})`))
  await evaluate('window.comparisonCopyFail=true'); await tap('[aria-label="复制期望 Manifest"]')
  check('Clipboard rejection explains manual copy without leaving compare', await until(`document.body.textContent.includes('复制失败，请手动选择文本')&&!!${comparison}`))
  await until('![...document.querySelectorAll(".t-message")].some(el=>el.checkVisibility({visibilityProperty:true}))')
  await screenshot('02-live-drift')
  await close(); await open()
  check('Reopening does not promote edited live state into desired', (await cm.read(desiredEditor)).includes('replicas: 1')&&(await cm.read(liveEditor)).includes('replicas: 3'))
  await click('事件', 'document.querySelector(".resource-detail-tabs")')
  check('Leaving comparison for Events does not show a draft dialog', await until(`!!document.querySelector('.rpanel__tabsbar')&&!${dialog}&&!${comparison}`))
  await click('Manifest', 'document.querySelector(".rpanel__tabsbar")'); await read(); await open()
  await tap('.res__tabs-link')
  await until('!!document.querySelector(".resource-workspace-tabs--cluster")&&!!document.querySelector(".resource-manifest__editor .cm-content")')
  check('Cluster jump keeps live resource and omits application comparison entry', (await cm.read('.resource-manifest__editor .cm-content')).includes('replicas: 3') && await evaluate('!document.querySelector(".resource-manifest__compare")'))
  await go(dev); await read()
  check('Returning to application keeps immutable expected source', await evaluate('!!document.querySelector(".resource-manifest__compare")'))
  await go(app('shop-dev', 'c-dev', 'b-checkout-dev', '', 'pods', 'checkout-api-5b8d7c9f4-t1n9p')); await read()
  check('Controller-owned Pod omits desired comparison', await evaluate('!document.querySelector(".resource-manifest__compare")'))
  await go(app('shop-dev', 'c-dev', 'b-checkout-dev', 'apps', 'replicasets', 'checkout-api-5b8d7c9f4')); await read()
  check('Controller-owned ReplicaSet omits desired comparison', await evaluate('!document.querySelector(".resource-manifest__compare")'))
  await go(app('shop-dev', 'c-dev', 'b-checkout-dev', '', 'services', 'checkout-api')); await read(); await open()
  check('Independent Service offers its own desired state', (await cm.read(desiredEditor)).includes('kind: Service')&&await evaluate(`(${comparison}).textContent.includes('没有配置差异')`))
  await go('/clusters/c-prod?resource=deployments'); await until('!!document.querySelector(".resource-table")')
  await go(app('shop-prod', 'c-prod', 'b-checkout-prod', 'apps', 'deployments', 'checkout-api')); await read(); await open()
  const productionDesired = await cm.read(desiredEditor)
  check('Environment change uses a different desired snapshot', productionDesired.includes('namespace: shop-prod')&&productionDesired.includes('replicas: 4'))
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await delay(200)
  check('1280px comparison keeps equal columns inside viewport', await evaluate(`(()=>{const [a,b]=(${comparison}).querySelectorAll('.cm-mergeViewEditor');return Math.abs(a.getBoundingClientRect().width-b.getBoundingClientRect().width)<2&&document.documentElement.scrollWidth===innerWidth&&(${comparison}).getBoundingClientRect().right<=innerWidth})()`))
  await screenshot('03-production-environment-1280')
  await close(); await click('编辑实时 Manifest', 'document.querySelector(".resource-manifest")')
  const long = await cm.read(".resource-manifest[data-mode=edit] .resource-yaml .cm-content")
  const annotations = Array.from({ length: 90 }, (_, i) => '    comparison-' + String(i).padStart(3, '0') + ': ' + 'x'.repeat(180)).join('\n')
  await input(long.replace('metadata:\n', 'metadata:\n  annotations:\n' + annotations + '\n'))
  await click('预览并保存修改', 'document.querySelector(".resource-manifest")'); await until('!!document.querySelector(".resource-manifest__review")'); await click('应用修改', 'document.querySelector(".resource-manifest")'); await read(); await open()
  await cm.scroll('.resource-compare .cm-merge-b .cm-scroller', 1000, 300)
  check('Long comparison scrolls inside panes without document overflow', await evaluate(`(${comparison}).querySelectorAll('.cm-scroller')[1].scrollTop>500&&(${comparison}).querySelectorAll('.cm-scroller')[1].scrollLeft>100&&document.documentElement.scrollWidth===innerWidth`))
  await tap('[aria-label="下一处差异"]')
  check('Difference jump selects long changed configuration', await evaluate('document.activeElement.matches(".cm-content")&&!!document.querySelector(".cm-merge-b .cm-selectionBackground")'))
  await screenshot('04-long-comparison-1280')
  await close()
  check('Closing long comparison restores live read-only editor', await evaluate('document.querySelector(".resource-manifest__editor .cm-content").getAttribute("aria-readonly")==="true"&&!document.querySelector(".resource-manifest__review")'))
  assert.deepEqual(b.errors, []); assert.deepEqual(b.warnings, [])
  check('No runtime errors or console warnings', true)
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, count: checks.length, errors: b.errors, warnings: b.warnings }, null, 2))
  console.log(`${checks.length} resource comparison browser checks passed`)
} catch (error) { await screenshot('failure'); console.error('Browser errors:', b.errors, b.warnings); throw error }
finally { await b.close() }
