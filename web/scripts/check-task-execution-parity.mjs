// 容器高级表单、阶段资源引用的浏览器检查。仅使用本地 Mock。
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'
const output = resolve(import.meta.dirname, '../screenshots-task-execution-parity')
const browser = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182', output)
const { evaluate, until, screenshot, call } = browser
const cm = codeMirrorDriver(browser)
const checks = []
const app = '/projects/p-shop/apps/a-checkout'
const aria = name => `[aria-label=${JSON.stringify(name)}]`
function check(name,value) { assert.ok(value,name); checks.push(name); console.log('PASS '+name) }
async function click(text,scope='document') {
  const selector = `[...${scope}.querySelectorAll('button,a,.t-radio,.t-select-option,.t-dropdown__item')].find(item=>item.checkVisibility({visibilityProperty:true}) && item.textContent.trim()===${JSON.stringify(text)})`
  await until(`Boolean(${selector})`); await evaluate(`(${selector}).click()`); await delay(250)
}
async function tap(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(180) }
async function input(selector,value) {
  if (selector.includes('.cm-content')) return cm.write(selector, value)
  await evaluate(`(() => {const item=document.querySelector(${JSON.stringify(selector)});if(!item)throw Error('input missing: '+${JSON.stringify(selector)});const proto=item instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(item,${JSON.stringify(value)});item.dispatchEvent(new Event('input',{bubbles:true}));item.dispatchEvent(new Event('change',{bubbles:true}))})()`); await delay(120)
}
async function go(path) { await evaluate(`void document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`); await delay(650) }
async function edit(env) {
  if (env) await evaluate(`[...document.querySelectorAll('.tnode__name')].find(item=>item.textContent.trim()===${JSON.stringify(env)}).closest('.tnode').click()`)
  else await tap('.tnode--clickable')
  await until('document.querySelector(".pe")?.checkVisibility({visibilityProperty:true}) && !document.querySelector(".pe__footer button:last-child").disabled'); await delay(200)
}
async function save() { await click('更新流水线'); await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})'); await delay(250) }
async function closeClean() { await click('取消','document.querySelector(".pe__footer")'); await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})') }
async function choose(selector,label) { await tap(selector+' .t-input'); await delay(200); await click(label); await delay(350) }
const value = selector => selector.includes('.cm-content') ? cm.read(selector) : evaluate(`document.querySelector(${JSON.stringify(selector)}).value`)
const selectedResources = () => evaluate('[...document.querySelectorAll(".stage-resource-selected>span")].map(item=>item.textContent.trim())')
try {
  await browser.navigate(app+'/config/workflow'); await until('document.querySelector(".tnode--clickable")'); await edit(); await click('前置阶段')
  check('CI 前后置阶段不展示部署配置引用',await evaluate('!document.querySelector(".stage-resources")'))
  await click('添加任务','document.querySelector(".stage-task-list")'); await tap('.stage-task-types button:nth-child(2)')
  check('新容器任务默认使用镜像入口且不挂载脚本',await until('Boolean(document.querySelector("input[name=task-command]")) && !document.querySelector(".cm-content[aria-label=任务脚本]")'))
  await input('input[name=task-name]','Container validation'); await click('更新流水线')
  check('未填写容器镜像阻止保存',await until('document.querySelector(".pe>.t-alert")?.textContent.includes("Container image")'))
  await tap(aria('选择容器镜像示例')); await click('alpine:3.20'); await input('input[name=task-command]','/bin/sh'); await input('input[name=task-args]','-c,echo hello')
  check('镜像示例选择与 sh 提示可用',await evaluate('document.querySelector("input[name=task-image]").value==="alpine:3.20" && document.querySelector(".execution-notice").textContent.includes("/bin/sh")'))
  await save(); await edit(); await click('前置阶段')
  check('无脚本容器命令和参数保存回读',await value('input[name=task-args]')==='-c,echo hello' && await value('input[name=task-command]')==='/bin/sh')
  await tap(aria('Mount custom code')); await input('.cm-content[aria-label="任务脚本"]','#!/bin/sh\necho complete\n'); await input('input[name=task-script-path]','relative.sh'); await click('更新流水线')
  check('脚本挂载路径必须为文件绝对路径，且不误标脚本内容',await until('document.querySelector(".pe>.t-alert")?.textContent.includes("绝对文件路径") && document.querySelector(".task-script-editor .cm-content")?.getAttribute("aria-invalid")==="false"'))
  await input('input[name=task-script-path]','/tasks/run.sh'); await input('input[name=task-args]','/tasks/run.sh,--report')
  await click('Add port'); await input(aria('Host port 1')+' input','70000'); await input(aria('Container port 1')+' input','8080'); await click('更新流水线')
  check('超范围端口显示校验错误',await until('document.querySelector(".pe>.t-alert")?.textContent.includes("1–65535")'))
  await input(aria('Host port 1')+' input','18080'); await click('Add port'); await tap(aria('删除端口映射 1'))
  check('端口映射支持新增删除且保留其他行',await value(aria('Host port 1')+' input')==='18080')
  await click('True',`document.querySelector(${JSON.stringify(aria('Mount code to container'))})`)
  check('启用源码挂载提供默认 sourcecode 目录',await value('input[name=task-source-path]')==='/sourcecode')
  await input('input[name=task-source-path]','/workspace')
  await click('True',`document.querySelector(${JSON.stringify(aria('Mount directory from host'))})`); await click('更新流水线')
  check('启用主机挂载后要求至少一条映射',await until('document.querySelector(".pe>.t-alert")?.textContent.includes("至少添加一条")'))
  await click('Add mapping'); await input(aria('Host path 1')+' input','/tmp/reports'); await input(aria('Container path 1')+' input','/reports')
  await click('Add path'); await input(aria('产物路径 1')+' input','/devtroncd/reports'); await click('更新流水线')
  check('保留目录不能用作产物路径',await until('document.querySelector(".pe>.t-alert")?.textContent.includes("保留目录")'))
  await input(aria('产物路径 1')+' input','/reports'); await click('Add path'); await input(aria('产物路径 1')+' input','/artifacts')
  await screenshot('01-container-execution')
  await save(); await edit(); await click('前置阶段')
  check('挂载脚本与脚本路径保存回读',await value('input[name=task-script-path]')==='/tasks/run.sh' && (await value('.cm-content[aria-label="任务脚本"]')).includes('echo complete'))
  check('端口映射保存回读',await value(aria('Host port 1')+' input')==='18080' && await value(aria('Container port 1')+' input')==='8080')
  check('源码和主机挂载保存回读',await value('input[name=task-source-path]')==='/workspace' && await value(aria('Host path 1')+' input')==='/tmp/reports')
  check('多个产物路径独立保存回读',await value(aria('产物路径 1')+' input')==='/artifacts' && await value(aria('产物路径 2')+' input')==='/reports')
  await tap(aria('Mount custom code')); check('关闭脚本挂载隐藏脚本字段',await evaluate('!document.querySelector("input[name=task-script-path]") && !document.querySelector(".cm-content[aria-label=任务脚本]")'))
  await tap(aria('Mount custom code')); check('重新开启脚本挂载保留草稿',await value('input[name=task-script-path]')==='/tasks/run.sh')
  await input(aria('Host path 1')+' input','/unsaved'); await input(aria('产物路径 1')+' input','/unsaved')
  await click('取消','document.querySelector(".pe__footer")'); await click('继续编辑')
  check('继续编辑保留嵌套挂载草稿',await value(aria('Host path 1')+' input')==='/unsaved')
  await click('取消','document.querySelector(".pe__footer")'); await click('放弃修改'); await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})'); await edit(); await click('前置阶段')
  check('放弃修改不污染保存的映射与产物路径',await value(aria('Host path 1')+' input')==='/tmp/reports' && await value(aria('产物路径 1')+' input')==='/artifacts')
  await click('False',`document.querySelector(${JSON.stringify(aria('Mount directory from host'))})`); await save(); await edit(); await click('前置阶段')
  check('关闭主机挂载开关保存回读',await evaluate('!document.querySelector(".task-mappings[data-kind=paths]")'))
  await click('True',`document.querySelector(${JSON.stringify(aria('Mount directory from host'))})`)
  check('重新启用主机挂载保留已有映射',await value(aria('Host path 1')+' input')==='/tmp/reports')
  await tap('.stage-task button.t-button'); await delay(200); await click('移到后置阶段'); await delay(350); await click('后置阶段')
  check('跨阶段移动保留容器高级配置',await value('input[name=task-script-path]')==='/tasks/run.sh' && await value(aria('Host port 1')+' input')==='18080')
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false}); await delay(250)
  await screenshot('02-container-1280')
  check('1280px 容器表单没有横向溢出',await evaluate('document.documentElement.scrollWidth<=innerWidth && document.querySelector(".stage-task-detail").scrollWidth<=document.querySelector(".stage-task-detail").clientWidth+1'))
  check('容器开关图标与文字同行',await evaluate('(() => {const labels=[...document.querySelectorAll(".task-execution .t-radio,.task-execution .t-checkbox")];return labels.every(label=>{const i=label.querySelector(".t-checkbox__input,.t-radio__input")?.getBoundingClientRect(),t=label.querySelector(".t-checkbox__label,.t-radio__label")?.getBoundingClientRect();return i && t && Math.abs(i.top+i.height/2-t.top-t.height/2)<8})})()'))
  check('长表单滚动后保存栏固定可见',await evaluate('(() => {document.querySelector(".stage-task-detail").scrollTop=9999;const r=document.querySelector(".pe__footer").getBoundingClientRect();return r.bottom<=innerHeight && r.top>0})()'))
  await screenshot('03-container-mappings-1280'); await save()
  await go(app+'/config/overrides/e-dev/configmaps'); await until('document.querySelector(".entry-list__heading button")'); await tap('.entry-list__heading button')
  await input(aria('配置名称')+' input','stage-dev-only'); await choose(aria('配置来源'),'使用已有 Kubernetes ConfigMap'); await click('保存修改','document.querySelector(".ce__footer")'); await until('document.querySelector(".ce__footer")?.textContent.includes("· 已保存")')
  await go(app+'/config/workflow'); await edit('开发环境')
  check('部署流水线显示实际环境绑定',await evaluate('document.querySelector(".pe__main").textContent.includes("目标环境") && [...document.querySelectorAll(".pe input")].some(item=>item.value.includes("shop-dev"))'))
  await click('前置阶段'); await tap(aria('添加阶段配置引用'))
  check('部署阶段配置引用来自目标环境',await until('document.querySelector(".stage-resources").textContent.includes("shop-dev") && document.querySelector(".stage-resources").textContent.includes("stage-dev-only")'))
  check('基础与环境同名配置去重',await evaluate(`document.querySelectorAll(${JSON.stringify(aria('ConfigMap checkout-api-config'))}).length===1`))
  await input(aria('搜索阶段配置')+' input','no-such-config')
  check('配置引用搜索支持无匹配空态',await until('document.querySelector(".stage-resources").textContent.includes("没有匹配的配置")'))
  await input(aria('搜索阶段配置')+' input',''); await tap(aria('ConfigMap checkout-api-config')); await tap(aria('Secret checkout-api-secret')); await tap(aria('ConfigMap stage-dev-only'))
  check('配置选择按名称类型展示选中项',(await selectedResources()).length===3)
  check('选择后多选菜单保持打开',await evaluate('Boolean(document.querySelector(".stage-resource-options"))'))
  await evaluate(`document.querySelector(${JSON.stringify(aria('搜索阶段配置')+' input')}).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
  check('Escape 关闭配置选择并保留已选项',await until('!document.querySelector(".stage-resource-options") && document.querySelectorAll(".stage-resource-selected").length===3'))
  await tap(aria('添加阶段配置引用')); await evaluate('document.querySelector(".stage-task-empty").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))')
  check('点击外部关闭配置选择',await until('!document.querySelector(".stage-resource-options")'))
  check('Secret 引用不显示键或明文',await evaluate('!document.querySelector(".stage-resources").textContent.includes("DB_PASSWORD") && !document.querySelector(".stage-resources").textContent.includes("API_TOKEN")'))
  await click('后置阶段'); check('前后置引用相互独立', (await selectedResources()).length===0)
  await tap(aria('添加阶段配置引用')); await tap(aria('Secret checkout-api-secret')); await save(); await edit('开发环境'); await click('前置阶段')
  check('前置阶段多类型引用保存回读',(await selectedResources()).length===3)
  await click('后置阶段'); check('后置阶段独立引用保存回读',JSON.stringify(await selectedResources())===JSON.stringify(['checkout-api-secret']))
  await tap(aria('移除 Secret checkout-api-secret')); await click('取消','document.querySelector(".pe__footer")'); await click('放弃修改'); await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})'); await edit('开发环境'); await click('后置阶段')
  check('取消引用草稿恢复已保存列表',(await selectedResources())[0]==='checkout-api-secret')
  await closeClean(); await edit('生产环境'); await click('前置阶段'); await tap(aria('添加阶段配置引用'))
  check('切换环境不泄漏开发环境专属选项',await evaluate('!document.querySelector(".stage-resources").textContent.includes("stage-dev-only") && document.querySelector(".stage-resources").textContent.includes("shop-prod")'))
  await closeClean(); await go(app+'/config/overrides/e-dev/configmaps'); await until('document.querySelector(".entry-list")');
  await evaluate('[...document.querySelectorAll(".entry-list__item")].find(item=>item.textContent.includes("stage-dev-only")).click()'); await delay(300); await click('删除','document.querySelector(".ce__tabs")'); await click('删除','[...document.querySelectorAll(".t-dialog")].find(item=>item.checkVisibility({visibilityProperty:true}))'); await until('!document.querySelector(".entry-list").textContent.includes("stage-dev-only")')
  await go(app+'/config/workflow'); await edit('开发环境'); await click('前置阶段')
  check('已删除配置仍保留失效引用提示',await until('document.querySelector(".stage-resource-selected.is-missing")?.textContent.includes("stage-dev-only")'))
  await click('更新流水线'); check('失效配置引用阻止保存',await until('document.querySelector(".pe>.t-alert")?.textContent.includes("已不可用")'))
  await screenshot('04-missing-stage-resource')
  await tap(aria('移除 ConfigMap stage-dev-only')); await save(); await edit('开发环境'); await click('前置阶段')
  check('移除失效引用后可以保存且保留其他引用',(await selectedResources()).length===2 && !await evaluate('Boolean(document.querySelector(".stage-resource-selected.is-missing"))'))
  await tap(aria('添加阶段配置引用')); await screenshot('05-stage-resources-1280')
  check('窄屏配置引用和操作栏均可见',await evaluate('document.documentElement.scrollWidth<=innerWidth && document.querySelector(".stage-resources").scrollWidth<=document.querySelector(".stage-resources").clientWidth+1 && document.querySelector(".pe__footer").getBoundingClientRect().bottom<=innerHeight'))
  await closeClean()
  assert.deepEqual(browser.errors,[]); assert.deepEqual(browser.warnings,[])
  writeFileSync(resolve(output,'results.json'),JSON.stringify({checks,errors:browser.errors,warnings:browser.warnings},null,2))
  console.log(`Completed ${checks.length} browser execution and stage resource checks`)
} catch(error) {
  await screenshot('failure'); writeFileSync(resolve(output,'failure.json'),JSON.stringify({message:error.message,checks,errors:browser.errors,warnings:browser.warnings},null,2)); throw error
} finally { await browser.close() }
