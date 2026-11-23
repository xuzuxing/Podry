// Native CodeMirror workflows against frontend Mock, using keyboard/clipboard DOM only.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'

const output = resolve(import.meta.dirname, '../screenshots-resource-diff-parity')
const browser = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182', output)
const { evaluate, until, call, screenshot } = browser
const cm = codeMirrorDriver(browser), checks = []
const workspace = 'document.querySelector(".resource-manifest")'
const review = '.resource-manifest__review'
const left = `${review} .cm-merge-a .cm-content`, right = `${review} .cm-merge-b .cm-content`
const dialog = '[...document.querySelectorAll(".t-dialog")].find(el=>el.checkVisibility({visibilityProperty:true}))'
const url = '/projects/p-shop/apps/a-checkout/resources?env=b-checkout-dev&tab=' + encodeURIComponent('app:a-checkout:c-dev|c-dev|apps|deployments|shop-dev|checkout-api') + '&resourceTab=manifest'
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS '+name) }
async function click(text, scope = workspace) {
  await evaluate(`(()=>{const target=[...${scope}.querySelectorAll('button')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)});if(!target)throw Error('Missing action');target.click()})()`)
  await delay(100)
}
async function input(selector, text) {
  if (selector.includes('.cm-content')) { await cm.write(selector, text); return }
  await evaluate(`(()=>{const target=document.querySelector(${JSON.stringify(selector)});const prototype=target.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(target,${JSON.stringify(text)});target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await delay(100)
}
async function waitReview() { await until('document.querySelector(".resource-manifest__review .resource-yaml-diff")?.dataset.state==="ready"'); await delay(200) }
async function waitRead() { await until('!!document.querySelector(".resource-manifest__editor .cm-content[aria-readonly=true]")') }
async function tap(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(150) }
async function mapPoint(fraction, thumb = false) {
  return evaluate(`(()=>{const box=document.querySelector('.resource-diff-minimap${thumb ? '__viewport' : ''}').getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height*${fraction}}})()`)
}
async function mapClick(fraction) {
  const point = await mapPoint(fraction)
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  await delay(200)
}
const scrollPosition = '(()=>{const a=document.querySelector(".cm-merge-a .cm-scroller"),b=document.querySelector(".cm-merge-b .cm-scroller");return {a:a.scrollTop,b:b.scrollTop,maxA:a.scrollHeight-a.clientHeight,max:b.scrollHeight-b.clientHeight}})()'
try {
  await browser.navigate(url); await waitRead()
  const baseline = await cm.read(".resource-manifest__editor .cm-content")
  const inserted = '  annotations:\n    diff-tag: "中文 <script>literal</script>"\n    enabled: true\n    amount: 3\n'
  const draft = baseline.replace('metadata:\n', 'metadata:\n'+inserted).replace('v1.42.0', 'v2.0.0')+'# preserved end comment\n'
  await click('编辑实时 Manifest'); await input('.resource-manifest__editor .cm-content', draft); await click('预览并保存修改'); await waitReview()
  check('Review has one upstream-width 30px minimap with an accessible scrollbar', await until('document.querySelectorAll(".resource-diff-minimap").length===1&&document.querySelector(".resource-diff-minimap").getBoundingClientRect().width===30&&document.querySelector(".resource-diff-minimap[role=scrollbar][aria-controls]")?.tabIndex===0'))
  check('Review column labels remain aligned with the narrower document panes', await evaluate('Math.abs(document.querySelector(".resource-manifest__review-head>span").getBoundingClientRect().right-document.querySelector(".cm-merge-a").getBoundingClientRect().right)<2'))
  check('Minimap does not duplicate editable DOM or expose raw YAML attributes', await evaluate('document.querySelectorAll(".resource-yaml-diff .cm-content").length===2&&!document.querySelector(".resource-diff-minimap [contenteditable]")&&!document.querySelector(".resource-diff-minimap").outerHTML.includes("literal</script>")'))
  check('Review uses native merge editors with separate accessible labels', await evaluate(`document.querySelector(${JSON.stringify(left)}).getAttribute('aria-label')==='当前实时 Manifest'&&document.querySelector(${JSON.stringify(right)}).getAttribute('aria-label')==='修改后的 Manifest'`))
  check('Review original is noneditable and modified is editable', await evaluate(`document.querySelector(${JSON.stringify(left)}).contentEditable==='false'&&document.querySelector(${JSON.stringify(right)}).contentEditable==='true'`))
  check('Visual alignment never inserts whitespace into either document', await cm.read(left)===baseline&&await cm.read(right)===draft)
  check('Inserted lines create visual spacers in the opposite pane', await until('!!document.querySelector(".cm-merge-a .cm-mergeSpacer")'))
  check('Unchanged spec lines align after a multiline insertion', await until(`(()=>{const find=side=>[...document.querySelectorAll(side+' .cm-line')].find(el=>el.textContent==='spec:');const a=find('.cm-merge-a'),b=find('.cm-merge-b');return a&&b&&Math.abs(a.getBoundingClientRect().top-b.getBoundingClientRect().top)<2})()`))
  check('YAML keys and quoted values have different syntax colors', await evaluate(`(()=>{const colors=[...document.querySelectorAll('.cm-merge-b .cm-line span')].map(el=>getComputedStyle(el).color);return new Set(colors).size>=2})()`))
  check('Manifest markup is rendered as literal text', await evaluate('!document.querySelector(".resource-yaml-diff script")&&document.querySelector(".cm-merge-b .cm-content").textContent.includes("<script>literal</script>")'))
  check('Changed blocks include inline character highlights', await evaluate('!!document.querySelector(".cm-changedLine")&&!!document.querySelector(".cm-changedText")'))
  await cm.focus(left); await call('Input.dispatchKeyEvent', {type:'keyDown',key:'q',code:'KeyQ',text:'q',windowsVirtualKeyCode:81}); await cm.key('q','KeyQ',81)
  check('Typing cannot change original document or redirect into modified draft', await cm.read(left)===baseline&&await cm.read(right)===draft)
  await tap('.resource-manifest__review-head [aria-label="下一处差异"]')
  check('Review difference navigation selects modified pane', await evaluate('document.activeElement.matches(".cm-merge-b .cm-content")&&document.querySelector(".resource-diff-navigation").textContent.includes("1 /")'))
  await cm.key('F7', 'F7', 118)
  check('F7 advances the shared native chunk navigation', await evaluate('document.querySelector(".resource-diff-navigation").textContent.includes("2 /")'))
  await cm.key('F7', 'F7', 118, 8)
  check('Shift F7 returns to previous native chunk', await evaluate('document.querySelector(".resource-diff-navigation").textContent.includes("1 /")'))
  await tap('[aria-label="查找修改后的 Manifest"]')
  check('Search action opens native panel inside modified pane', await until('!!document.querySelector(".cm-merge-b .cm-search input[name=search]")'))
  await input('.cm-merge-b .cm-search input[name=search]', 'diff-tag')
  check('Native search highlights the requested literal', await until('!!document.querySelector(".cm-merge-b .cm-searchMatch")'))
  await tap('.cm-merge-b .cm-search [aria-label="展开或收起替换"]')
  await input('.cm-merge-b .cm-search input[name=replace]', 'diff-replaced')
  await click('全部替换', 'document.querySelector(".cm-merge-b .cm-search")')
  check('Native replace updates modified content and invalidates validation', (await cm.read(right)).includes('diff-replaced')&&await evaluate('[...document.querySelectorAll(".resource-manifest__actions button")].find(el=>el.textContent.trim()==="应用修改").disabled'))
  await cm.write(right,draft)
  await evaluate('document.querySelector(".cm-merge-b .cm-search input[name=search]").focus()'); await cm.key('Escape', 'Escape', 27)
  check('Escape closes search and returns focus to modified editor', await until('!document.querySelector(".cm-merge-b .cm-search")&&document.activeElement.matches(".cm-merge-b .cm-content")'))
  await cm.key('f', 'KeyF', 70, 2)
  check('Ctrl F opens in-editor search instead of browser find', await until('!!document.querySelector(".cm-merge-b .cm-search")'))
  await cm.key('Escape', 'Escape', 27)
  await tap('[aria-label="查找当前实时 Manifest"]')
  check('Original pane has independent readonly search', await until('!!document.querySelector(".cm-merge-a .cm-search")&&!document.querySelector(".cm-merge-a .cm-search input[name=replace]")'))
  await cm.key('Escape', 'Escape', 27)
  const edited = draft+'# native undo-redo\n'
  await cm.write(right, edited)
  check('Native modified edits immediately invalidate saved validation', await evaluate('[...document.querySelectorAll(".resource-manifest__actions button")].find(el=>el.textContent.trim()==="应用修改").disabled&&document.querySelector(".resource-manifest__review-head").textContent.includes("重新校验")'))
  check('Native edits preserve complete text and terminal newline', await cm.read(right)===edited)
  await cm.key('z', 'KeyZ', 90, 2)
  check('Native undo restores the prior draft', await cm.read(right)===draft)
  await cm.key('y', 'KeyY', 89, 2)
  check('Native redo restores modified draft', await cm.read(right)===edited)
  await cm.write(right, 'metadata: [invalid')
  await click('重新校验')
  check('Invalid YAML remains visible in Review with failed apply blocked', await until('document.querySelector(".resource-manifest__error")?.textContent.includes("YAML")')&&await cm.read(right)==='metadata: [invalid')
  await cm.write(right, edited); await click('重新校验')
  check('Corrected Review draft can be validated again', await until('[...document.querySelectorAll(".resource-manifest__actions button")].some(el=>el.textContent.trim()==="应用修改"&&!el.disabled)'))
  await click('事件', 'document.querySelector(".resource-detail-tabs")'); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('Canceled detail navigation retains native Review draft', await cm.read(right)===edited)
  await cm.focus(left); await cm.key('Home', 'Home', 36, 2)
  check('YAML folding controls are available for nested sections', await until('!!document.querySelector(".cm-merge-a .cm-foldGutter [title]")'))
  const foldPoint = await evaluate(`(()=>{const control=[...document.querySelectorAll('.cm-merge-a .cm-foldGutter [title]')].find(el=>el.checkVisibility({visibilityProperty:true}));control.scrollIntoView({block:'nearest'});const rect=control.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}})()`)
  // The discard modal still intercepts pointer events during its closing animation.
  await until(`!!document.elementFromPoint(${foldPoint.x},${foldPoint.y})?.closest('.cm-merge-a .cm-foldGutter')`)
  await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...foldPoint}); await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...foldPoint})
  check('Folding collapses a section without changing original text', await until('!!document.querySelector(".cm-merge-a .cm-foldPlaceholder")')&&await cm.read(left)===baseline)
  await evaluate('document.querySelector(".cm-merge-a .cm-foldPlaceholder").click()'); await delay(150)
  check('Folded section can be expanded', await evaluate('!document.querySelector(".cm-merge-a .cm-foldPlaceholder")'))
  await screenshot('01-native-review')
  await click('应用修改'); await waitRead()
  check('Applying native Review reads back exact draft and comments', await cm.read('.resource-manifest__editor .cm-content') === edited)
  check('Leaving Review destroys both native editor DOMs', await evaluate('!document.querySelector(".cm-mergeView")'))
  await tap('.resource-manifest__compare'); await until('document.querySelector(".resource-compare .resource-yaml-diff")?.dataset.state==="ready"')
  const originalDesired = await cm.read('.resource-compare .cm-merge-a .cm-content')
  const comparedLive = await cm.read('.resource-compare .cm-merge-b .cm-content')
  await cm.focus('.resource-compare .cm-merge-b .cm-content'); await call('Input.dispatchKeyEvent', {type:'keyDown',key:'q',code:'KeyQ',text:'q',windowsVirtualKeyCode:81}); await cm.key('q','KeyQ',81)
  check('Desired comparison also prevents typing in live pane', await cm.read('.resource-compare .cm-merge-b .cm-content')===comparedLive)
  await tap('[aria-label="关闭期望 Manifest"]'); await waitRead(); await click('编辑实时 Manifest')
  const rows = Array.from({length:800},(_,index)=>`    long-${String(index).padStart(4,'0')}: ${'x'.repeat(180)}`).join('\n')
  const long = baseline.replace('metadata:\n', 'metadata:\n  annotations:\n'+rows+'\n')+'# long-tail-marker\n'
  await input('.resource-manifest__editor .cm-content', long); await click('预览并保存修改'); await waitReview()
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false})
  await until('document.querySelector(".resource-diff-minimap canvas")?.height>0')
  check('Minimap draws both deletion and insertion colors from native chunks', await evaluate('(()=>{const el=document.querySelector(".resource-diff-minimap canvas"),pixels=el.getContext("2d").getImageData(0,0,el.width,el.height).data;let red=false,green=false;for(let i=0;i<pixels.length;i+=4){red ||= pixels[i]>100&&pixels[i]>pixels[i+1]*1.5;green ||= pixels[i+1]>70&&pixels[i+1]>pixels[i]*1.5}return red&&green})()'))
  await cm.focus(right); await cm.key('Home', 'Home', 36, 2); await cm.scroll('.cm-merge-b .cm-scroller', 0, 0)
  await mapClick(0.8)
  const clicked = await evaluate(scrollPosition)
  check('Clicking the lower minimap jumps both aligned documents', clicked.b > clicked.max * 0.65 && Math.abs(clicked.a - clicked.b) <= 1)
  check('Minimap position reports scrolling through its accessible value', await until('Number(document.querySelector(".resource-diff-minimap").getAttribute("aria-valuenow"))>65'))
  const dragStart = await mapPoint(0.5, true), dragEnd = await mapPoint(0.2)
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...dragStart })
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, ...dragEnd })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...dragEnd }); await delay(200)
  check('Dragging the viewport returns both panes to the selected earlier range', await evaluate(`(${scrollPosition}).b<${clicked.b * 0.5}`))
  check('Finishing a drag releases capture without changing global pointer styles', await evaluate('!document.querySelector(".resource-diff-minimap--dragging")&&document.body.style.pointerEvents!=="none"&&document.body.style.userSelect!=="none"'))
  await cm.focus('.resource-diff-minimap'); await cm.key('End', 'End', 35)
  check('Keyboard End reaches each pane end with its own horizontal scrollbar height', await until(`(()=>{const p=${scrollPosition};return Math.abs(p.b-p.max)<2&&Math.abs(p.a-p.maxA)<2})()`))
  await cm.key('Home', 'Home', 36)
  check('Keyboard Home returns to the start', await until(`(${scrollPosition}).a===0&&(${scrollPosition}).b===0`))
  await cm.key('PageDown', 'PageDown', 34)
  check('PageDown scrolls one viewport while keeping focus on the minimap', await evaluate(`(${scrollPosition}).b>100&&document.activeElement.matches('.resource-diff-minimap')`))
  await cm.key('PageUp', 'PageUp', 33)
  check('PageUp returns one viewport without leaving the minimap', await until(`(${scrollPosition}).b===0`))
  await cm.key('PageDown', 'PageDown', 34)
  const pageDown = await evaluate(`(${scrollPosition}).b`)
  await cm.key('ArrowDown', 'ArrowDown', 40)
  check('ArrowDown scrolls a line without changing the draft', await evaluate(`(${scrollPosition}).b>${pageDown}`) && await cm.read(right) === long)
  check('Minimap navigation preserves the validated draft and enabled Apply action', await evaluate('[...document.querySelectorAll(".resource-manifest__actions button")].some(el=>el.textContent.trim()==="应用修改"&&!el.disabled)'))
  const nextLong = long + '# minimap-history-marker\n'
  await cm.write(right, nextLong); await mapClick(0.6); await cm.focus(right); await cm.key('z', 'KeyZ', 90, 2)
  check('Minimap refresh and navigation preserve native undo history', await cm.read(right) === long)
  await cm.key('y', 'KeyY', 89, 2)
  check('Minimap refresh also preserves native redo history', await cm.read(right) === nextLong)
  check('Edited review still requires validation after minimap interactions', await evaluate('[...document.querySelectorAll(".resource-manifest__actions button")].find(el=>el.textContent.trim()==="应用修改").disabled'))
  await cm.write(right, long); await click('重新校验')
  await until('[...document.querySelectorAll(".resource-manifest__actions button")].some(el=>el.textContent.trim()==="应用修改"&&!el.disabled)')
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false }); await delay(250)
  // Force a compositor frame: headless Chrome defers resolution media-query changes until painting.
  await screenshot('02-high-density-minimap')
  check('Minimap follows high density display dimensions without overflowing', await until('(()=>{const el=document.querySelector(".resource-diff-minimap"),canvas=el.querySelector("canvas");return canvas.width===el.clientWidth*2&&Math.abs(canvas.height-el.clientHeight*2)<=1&&document.documentElement.scrollWidth<=innerWidth})()'))
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await delay(200)
  await cm.scroll(`${review} .cm-merge-b .cm-scroller`, 10000, 300)
  check('Large Review scrolls internally in both dimensions', await evaluate('(()=>{const area=document.querySelector(".cm-merge-b .cm-scroller");return area.scrollTop>9000&&area.scrollLeft>100&&document.documentElement.scrollWidth===innerWidth})()'))
  check('Large documents render a bounded set of visible lines', await evaluate('document.querySelectorAll(".cm-merge-b .cm-line").length<300'))
  check('Virtualized clipboard still contains the entire long document', await cm.read(right)===long)
  await screenshot('02-long-virtual-review-1280')
  await click('应用修改'); await waitRead(); await tap('.resource-manifest__compare'); await until('document.querySelector(".resource-compare .resource-yaml-diff")?.dataset.state==="ready"')
  check('Repeated mount keeps the original fixed desired snapshot', await cm.read('.resource-compare .cm-merge-a .cm-content')===originalDesired)
  check('Comparison keeps both panes readonly after long live edits', await evaluate('document.querySelectorAll(".resource-compare .cm-content[aria-readonly=true]").length===2'))
  const readonlyPair = [await cm.read('.resource-compare .cm-merge-a .cm-content'), await cm.read('.resource-compare .cm-merge-b .cm-content')]
  check('Desired comparison header and exports align with both minimap-adjusted panes', await evaluate('[".resource-compare__title",".resource-compare__exports>div"].every(selector=>Math.abs(document.querySelector(selector).getBoundingClientRect().right-document.querySelector(".cm-merge-a").getBoundingClientRect().right)<2)'))
  await mapClick(0.7); await cm.focus('.resource-diff-minimap'); await cm.key('End', 'End', 35)
  check('Desired and live minimap navigation preserves both readonly documents', await cm.read('.resource-compare .cm-merge-a .cm-content') === readonlyPair[0] && await cm.read('.resource-compare .cm-merge-b .cm-content') === readonlyPair[1])
  await screenshot('03-native-comparison-1280')
  await tap('[aria-label="关闭期望 Manifest"]'); await waitRead()
  check('Closing comparison releases native editor DOM and restores trigger focus', await evaluate('!document.querySelector(".cm-mergeView")&&document.activeElement.classList.contains("resource-manifest__compare")'))
  check('Closing comparison also disposes the minimap and viewport DOM', await evaluate('!document.querySelector(".resource-diff-minimap")'))
  await evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/clusters/c-prod/resources/apps/deployments/shop-prod/checkout-api/manifest').then(result=>result?.message||'')`)
  await until('location.pathname==="/clusters/c-prod"'); await waitRead()
  const infraBase = await cm.read('.resource-manifest__editor .cm-content')
  const infraDraft = infraBase.replace('metadata:\n', 'metadata:\n  annotations:\n' + rows + '\n')
  await click('编辑实时 Manifest'); await cm.write('.resource-manifest__editor .cm-content', infraDraft); await click('预览并保存修改'); await waitReview()
  check('Infrastructure Manager shares the same minimap and original readonly boundary', await evaluate('document.querySelector(".resource-diff-minimap").getBoundingClientRect().width===30&&document.querySelector(".cm-merge-a .cm-content").contentEditable==="false"'))
  await mapClick(0.75)
  check('Infrastructure minimap jumps into long YAML without changing documents', await evaluate(`(${scrollPosition}).b>1000`) && await cm.read(left) === infraBase && await cm.read(right) === infraDraft)
  await cm.focus('.resource-diff-minimap'); await cm.key('Home', 'Home', 36); await delay(200)
  await screenshot('04-infrastructure-minimap-1280')
  await click('应用修改'); await waitRead()
  check('Infrastructure Apply reads back exact YAML and removes the minimap', await cm.read('.resource-manifest__editor .cm-content') === infraDraft && await evaluate('!document.querySelector(".resource-diff-minimap")'))
  assert.deepEqual(browser.errors,[]); assert.deepEqual(browser.warnings,[])
  check('No browser runtime errors or console warnings',true)
  writeFileSync(resolve(output,'results.json'),JSON.stringify({checks,count:checks.length,errors:browser.errors,warnings:browser.warnings},null,2))
  console.log(`${checks.length} native resource diff browser checks passed`)
} catch(error) { await screenshot('failure'); console.error('Browser errors:',browser.errors,browser.warnings); console.error(await evaluate('({panes:[...document.querySelectorAll(".cm-scroller")].map(el=>({top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight})),map:document.querySelector(".resource-diff-minimap")?.outerHTML,mapSize:document.querySelector(".resource-diff-minimap")&&{width:document.querySelector(".resource-diff-minimap").clientWidth,height:document.querySelector(".resource-diff-minimap").clientHeight},viewport:{innerWidth,scrollWidth:document.documentElement.scrollWidth},focus:document.activeElement?.className})')); throw error }
finally {await browser.close()}
