// 生产前端 Mock 的资源 Manifest 交互；不连接后端或 Kubernetes。
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'

const baseURL = process.argv[2] || 'http://127.0.0.1:5182'
const output = resolve(import.meta.dirname, '../screenshots-resource-manifest-parity')
const browser = await launchBrowser(baseURL, output)
const { evaluate, until, screenshot, call } = browser
const cm = codeMirrorDriver(browser)
const checks = []
const dialog = '[...document.querySelectorAll(".t-dialog")].find(el=>el.checkVisibility({visibilityProperty:true}))'
const workspace = 'document.querySelector(".resource-manifest")'
const editSelector = '.resource-manifest[data-mode="edit"] .resource-yaml .cm-content'
const modified = '.resource-manifest__review .cm-merge-b .cm-content'
const readSelector = '.resource-manifest[data-mode="read"] .resource-yaml .cm-content'
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function click(text, scope = 'document') {
  const target = `(()=>{const root=${scope};return root&&[...root.querySelectorAll('button,a,.t-dropdown__item,.t-select-option,.t-checkbox')].find(item=>item.checkVisibility({visibilityProperty:true})&&item.textContent.trim()===${JSON.stringify(text)})})()`
  await until(`Boolean(${target})`)
  await evaluate(`(${target}).click()`)
  await delay(160)
}
async function input(selector, value) {
  if (selector.includes('.cm-content')) { await cm.write(selector, value); return }
  await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing editor');el.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await delay(80)
}
async function go(path) { await evaluate(`void document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`); await delay(600) }
async function value(selector) { return selector.includes('.cm-content') ? cm.read(selector) : evaluate(`document.querySelector(${JSON.stringify(selector)})?.value`) }
async function begin(comment = '# unsaved\n') { await click('编辑实时 Manifest', workspace); const text = await value(editSelector); await input(editSelector, text + comment); return text + comment }
async function discard() { await click('放弃修改', dialog); await delay(300) }
async function context(selector, text) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).parentElement.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:610,clientY:110}))`); await delay(180); await click(text) }
async function waitRead() { await until('!!document.querySelector(' + JSON.stringify(readSelector) + ')') }
try {
  await browser.navigate('/clusters/c-prod?resource=configmaps')
  await until('!!document.querySelector(".resource-table")')
  await click('创建资源')
  const seed = `# exact Manifest comment
apiVersion: v1
kind: ConfigMap
metadata:
  name: manifest-browser
  namespace: default
  uid: metadata-stable
  resourceVersion: "19"
  generation: 3
  creationTimestamp: "2026-11-22T00:00:00Z"
  managedFields:
    - manager: browser-controller
      fieldsV1:
        f:data: {}
data:
  managedFields: business-value
  value: before
`
  await input('.resource-create__editor .cm-content', seed); await click('应用', 'document.querySelector(".resource-create__actions")')
  await until('document.querySelector(".resource-create-results")?.textContent.includes("已创建")')
  await click('关闭', 'document.querySelector(".resource-create__actions")')
  await until('!document.querySelector(".resource-create")')
  await go('/clusters/c-prod/resources/_/configmaps/default/manifest-browser/manifest')
  await waitRead()
  let original = await value(readSelector)
  check('资源详情使用带行号的深色只读编辑器', await evaluate(`document.querySelector(${JSON.stringify(readSelector)}).getAttribute('aria-readonly')==='true'&&!!document.querySelector('.resource-yaml .cm-lineNumbers')&&getComputedStyle(document.querySelector('.resource-yaml')).backgroundColor==='rgb(30, 30, 30)'`))
  check('只隐藏完整托管子树', !original.includes('browser-controller') && !original.includes('fieldsV1:') && original.includes('managedFields: business-value'))
  check('其他元数据完整保留', ['uid: metadata-stable', 'resourceVersion: "19"', 'generation: 3', 'creationTimestamp:'].every(text => original.includes(text)))
  await click('隐藏托管字段', workspace)
  check('切换显示恢复托管字段子树', (await value(readSelector)).includes('browser-controller'))
  await click('隐藏托管字段', workspace)
  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.manifestCopied=text}}});window.manifestDownloads=[];const previousClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.manifestDownloads.push({name:this.download,url:this.href});return}return previousClick.call(this)}`)
  await evaluate(`document.querySelector('[aria-label="复制 Manifest"]').click()`)
  check('复制当前显示的完整原文', await until('window.manifestCopied===' + JSON.stringify(original)))
  await evaluate(`document.querySelector('[aria-label="下载 Manifest"]').click()`)
  check('下载使用资源 Kind 与名称', await evaluate('window.manifestDownloads[0]?.name==="configmap-manifest-browser.yaml"'))
  await click('编辑实时 Manifest', workspace)
  check('编辑从当前过滤视图开始', await value(editSelector) === original)
  await input(editSelector, 'metadata: [broken'); await click('预览并保存修改', workspace)
  check('无效 YAML 原位报错且保留草稿', await until('document.querySelector(".resource-manifest__error")?.textContent.includes("YAML")') && await value(editSelector) === 'metadata: [broken')
  await input(editSelector, original.replace('name: manifest-browser', 'name: different')); await click('预览并保存修改', workspace)
  check('禁止在编辑现有对象时更名', await until('document.querySelector(".resource-manifest__error")?.textContent.includes("metadata.name")'))
  await input(editSelector, original + '\n---\n' + original); await click('预览并保存修改', workspace)
  check('禁止将现有对象编辑变成多文档创建', await until('document.querySelector(".resource-manifest__error")?.textContent.includes("一个文档")'))
  const firstDraft = original.replace('value: before', 'value: after')
  await input(editSelector, firstDraft); await click('预览并保存修改', workspace)
  await until('!!document.querySelector(".resource-manifest__review")')
  await until('document.querySelector(".resource-manifest__review .resource-yaml-diff")?.dataset.state==="ready"')
  check('预览为同页左右分栏且左侧只读', await evaluate('document.querySelectorAll(".resource-manifest__review .cm-content").length===2&&document.querySelectorAll(".resource-manifest__review .cm-content[aria-readonly=true]").length===1&&!'+dialog))
  check('预览显示增删行标记和校验状态', await evaluate('document.querySelectorAll(".cm-changedLine").length>=2&&document.querySelector(".resource-manifest__review-head").textContent.includes("本地字段检查通过")'))
  await until('![...document.querySelectorAll(".t-message")].some(el=>el.checkVisibility({visibilityProperty:true}))')
  await screenshot('01-review-split')
  await input(modified, firstDraft + '# right side edited\n')
  check('预览右侧可继续编辑并立即禁用应用', await evaluate('[...document.querySelectorAll(".resource-manifest__actions button")].find(el=>el.textContent.trim()==="应用修改").disabled&&document.querySelector(".resource-manifest__review-head").textContent.includes("重新校验")'))
  await click('重新校验', workspace); await until('[...document.querySelectorAll(".resource-manifest__actions button")].some(el=>el.textContent.trim()==="应用修改"&&!el.disabled)')
  await click('返回编辑', workspace)
  check('返回编辑保留预览右侧的内容', (await value(editSelector)).includes('# right side edited'))
  await click('预览并保存修改', workspace); await until('!!document.querySelector(".resource-manifest__review")'); await click('应用修改', workspace); await waitRead()
  check('应用后读回当前资源和修改注释', (await value(readSelector)).includes('value: after') && (await value(readSelector)).includes('# right side edited'))
  await click('隐藏托管字段', workspace)
  check('过滤视图保存后托管字段仍保留', (await value(readSelector)).includes('browser-controller'))
  await click('隐藏托管字段', workspace)
  const draft = await begin()
  await cm.focus(editSelector); await cm.key('End', 'End', 35, 2)
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  check('Tab 在编辑器插入两空格', await value(editSelector) === draft + '  ')
  check('Shift Tab 保留正常焦点导航', await evaluate(`(()=>{const e=new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true});document.querySelector(${JSON.stringify(editSelector)}).dispatchEvent(e);return !e.defaultPrevented})()`))
  check('有草稿时 beforeunload 触发离开保护', await evaluate(`(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented})()`))
  await click('事件', workspace)
  check('详情页签切换提示放弃草稿', await until(`!!${dialog}&&${dialog}.textContent.includes('放弃未保存')`))
  await click('继续编辑', dialog)
  check('取消离开保留草稿与 Manifest 页签', await value(editSelector) === draft + '  ')
  await click('删除', 'document.querySelector(".rpanel__actions")')
  check('资源操作也先保护 Manifest 草稿', await until(`!!${dialog}&&${dialog}.textContent.includes('放弃未保存')`) && !await evaluate('!!document.querySelector(".resource-action")?.checkVisibility({visibilityProperty:true})'))
  await click('继续编辑', dialog)
  await click('取消', workspace); await click('继续编辑', dialog)
  check('取消编辑的放弃确认可撤回', !!await value(editSelector))
  await click('取消', workspace); await discard(); await waitRead()
  check('确认取消恢复实时只读内容', !(await value(readSelector)).includes('# unsaved'))
  check('干净状态无刷新保护', await evaluate(`(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return !e.defaultPrevented})()`))
  await click('事件', workspace)
  check('确认退出编辑后事件页签正常切换', await until('!!document.querySelector(".rpanel__tabsbar")&&[...document.querySelectorAll(".rpanel__tab--active")].some(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.includes("事件"))'))
  await click('Manifest', 'document.querySelector(".rpanel__tabsbar")'); await waitRead()
  await go('/clusters/c-prod/resources/apps/deployments/shop-prod/checkout-api/manifest'); await waitRead()
  check('多个资源页签同时保留', await evaluate('document.querySelectorAll(".ws__tab-label").length===2'))
  const deploymentDraft = await begin('# deployment dirty\n')
  await evaluate('document.querySelector(".resource-workspace-tabs__item[data-selected=true] .ws__tab-close").click()')
  check('关闭活动页签先提示，未提前删 store', await until(`!!${dialog}`) && await evaluate('document.querySelectorAll(".ws__tab-label").length===2'))
  await click('继续编辑', dialog)
  await evaluate('document.querySelector(".ws__tab-label").parentElement.click()'); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('切换资源被取消时保留原草稿和活动页签', await value(editSelector) === deploymentDraft && await evaluate('document.querySelector(".ws__tab--active .ws__tab-label").textContent.includes("checkout-api")'))
  await context('.ws__tab-label', '关闭其他页签'); await until(`!!${dialog}`)
  check('关闭其他页签不会在确认前销毁活动草稿', await evaluate('document.querySelectorAll(".ws__tab-label").length===2') && await value(editSelector) === deploymentDraft)
  await click('继续编辑', dialog)
  await context('.ws__tab--active .ws__tab-label', '关闭全部资源页签'); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('关闭全部页签可撤回并保留两个页签', await evaluate('document.querySelectorAll(".ws__tab-label").length===2'))
  await evaluate('document.querySelector(".ws__tab-label").closest(".resource-workspace-tabs__item").querySelector(".ws__tab-close").click()')
  check('关闭非活动页签保留当前草稿', await until('document.querySelectorAll(".ws__tab-label").length===1') && await value(editSelector) === deploymentDraft)
  await go('/apps'); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('普通路由跳转可取消', await evaluate('location.pathname==="/clusters/c-prod"') && await value(editSelector) === deploymentDraft)
  await evaluate('document.querySelector(".ws__cluster-switch .t-input").click()'); await delay(200); await click('dev-k3s'); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('切换集群取消后页签和草稿保留', await evaluate('location.pathname==="/clusters/c-prod"&&document.querySelectorAll(".ws__tab-label").length===1') && await value(editSelector) === deploymentDraft)
  await click('刷新', 'document.querySelector(".ws__crumb-actions")'); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('集群顶部刷新先保护活动草稿', await value(editSelector) === deploymentDraft)
  await context('.ws__tab--active .ws__tab-label', '关闭全部资源页签'); await until(`!!${dialog}`); await discard()
  check('确认关闭全部后回到资源列表', await until('!document.querySelector(".rpanel")&&document.querySelectorAll(".ws__tab-label").length===0'))
  await go('/projects/p-shop/apps/a-checkout/resources')
  await until('[...document.querySelectorAll(".res button")].some(el=>el.textContent.trim()==="Manifest")'); await click('Manifest'); await waitRead()
  check('应用运行资源使用相同 Manifest 工作区', await evaluate('!!document.querySelector(".res .resource-manifest")'))
  const appDraft = await begin('# application dirty\n')
  await evaluate('document.querySelector(".res__tab-close").click()'); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('应用资源关闭保护同样保留草稿', await value(editSelector) === appDraft && await evaluate('document.querySelectorAll(".res__tab-label").length===1'))
  await evaluate('document.querySelector(".res__env-select .t-input").click()')
  await until('[...document.querySelectorAll(".t-select-option")].filter(el=>el.checkVisibility({visibilityProperty:true})).length>1')
  const anotherEnv = await evaluate('[...document.querySelectorAll(".t-select-option")].filter(el=>el.checkVisibility({visibilityProperty:true})).find(el=>!el.classList.contains("t-is-selected"))?.textContent.trim()')
  assert.ok(anotherEnv, '需要第二个环境'); await click(anotherEnv); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('切换环境取消后保留当前草稿', await value(editSelector) === appDraft)
  await evaluate('document.querySelector(".res__envbar [title=刷新]").click()'); await until(`!!${dialog}`); await click('继续编辑', dialog)
  check('页面刷新数据前保护草稿', await value(editSelector) === appDraft)
  await click('取消', workspace); await discard(); await waitRead()
  const longText = (await value(readSelector)) + Array.from({ length: 180 }, (_, i) => `# long comment ${i} ` + 'x'.repeat(180)).join('\n') + '\n'
  await click('编辑实时 Manifest', workspace); await input(editSelector, longText); await click('预览并保存修改', workspace); await until('!!document.querySelector(".resource-manifest__review")')
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await until('document.querySelector(".resource-manifest__review .resource-yaml-diff")?.dataset.state==="ready"')
  await evaluate('document.querySelector(".resource-manifest__review").scrollIntoView({block:"center"})')
  await cm.scroll('.resource-manifest__review .cm-merge-b .cm-scroller', 900, 240)
  check('长清单在分栏内独立滚动且不撑宽页面', await evaluate('document.documentElement.scrollWidth<=innerWidth+1&&document.querySelectorAll(".resource-manifest__review .cm-scroller")[1].scrollTop>500&&document.querySelectorAll(".resource-manifest__review .cm-scroller")[1].scrollLeft>100'))
  // 左侧原文较短时滚动在其最大位置截断；右侧不能被反向强制跳回。
  check('短原文不把较长修改清单滚动拉回顶部', await evaluate('document.querySelectorAll(".resource-manifest__review .cm-scroller")[1].scrollTop>500'))
  check('1280px 两栏宽度一致且操作区不溢出', await evaluate('(()=>{const a=[...document.querySelectorAll(".resource-manifest__review .cm-mergeViewEditor")].map(el=>el.getBoundingClientRect());const b=document.querySelector(".resource-manifest__actions").getBoundingClientRect();return Math.abs(a[0].width-a[1].width)<2&&b.right<=innerWidth})()'))
  await screenshot('02-application-review-1280')
  await click('应用修改', workspace); await waitRead()
  check('应用入口保存长清单后正确读回', (await value(readSelector)).includes('# long comment 179'))
  await begin('# synchronized\n'); await click('预览并保存修改', workspace); await until('!!document.querySelector(".resource-manifest__review")')
  await until('document.querySelector(".resource-manifest__review .resource-yaml-diff")?.dataset.state==="ready"')
  await cm.scroll('.resource-manifest__review .cm-merge-a .cm-scroller', 700, 200)
  check('两栏长清单同步纵横滚动', await evaluate('(()=>{const [left,right]=document.querySelectorAll(".resource-manifest__review .cm-scroller");return left.scrollTop>500&&Math.abs(left.scrollTop-right.scrollTop)<2&&Math.abs(left.scrollLeft-right.scrollLeft)<2})()'))
  await click('取消', workspace); await discard(); await waitRead()
  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}});document.querySelector('[aria-label="复制 Manifest"]').click()`)
  check('复制失败明确提示', await until('document.body.textContent.includes("复制失败，请手动选择文本")'))
  await begin('# discard on environment switch\n')
  await evaluate('document.querySelector(".res__env-select .t-input").click()'); await delay(250); await click(anotherEnv); await until(`!!${dialog}`); await discard()
  check('确认切换环境后关闭原活动详情并更新 URL', await until('!document.querySelector(".rpanel")&&!new URLSearchParams(location.search).has("tab")&&!!new URLSearchParams(location.search).get("env")'))
  check('浏览器零运行时错误和控制台警告', browser.errors.length === 0 && browser.warnings.length === 0)
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ baseURL, checks, errors: browser.errors, warnings: browser.warnings }, null, 2))
  console.log(`PASS ${checks.length} resource Manifest browser checks; frontend Mock only`)
} catch (error) { await screenshot('failure'); throw error }
finally { await browser.close() }
