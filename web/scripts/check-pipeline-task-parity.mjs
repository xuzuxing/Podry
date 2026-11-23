// 任务目录、变量条件及草稿保护的真实浏览器交互；仅使用前端 Mock。
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'
const output=resolve(import.meta.dirname,'../screenshots-pipeline-task-parity')
const browser=await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182',output)
const {evaluate,until,screenshot,call}=browser
const cm = codeMirrorDriver(browser)
const checks=[]
const app='/projects/p-shop/apps/a-checkout'
function check(name,value){assert.ok(value,name);checks.push(name);console.log('PASS '+name)}
async function click(text,scope='document'){
  const expression=`[...${scope}.querySelectorAll('button,a,.t-radio,.t-select-option,.t-dropdown__item')].find(item=>item.checkVisibility({visibilityProperty:true}) && item.textContent.trim()===${JSON.stringify(text)})`
  await until(`Boolean(${expression})`)
  await evaluate(`(${expression}).click()`);await delay(230)
}
async function input(selector,value){
  if (selector.includes('.cm-content')) return cm.write(selector, value)
  await evaluate(`(() => {const item=document.querySelector(${JSON.stringify(selector)});if(!item)throw Error('input missing: '+${JSON.stringify(selector)});const proto=item instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(item,${JSON.stringify(value)});item.dispatchEvent(new Event('input',{bubbles:true}));item.dispatchEvent(new Event('change',{bubbles:true}))})()`);await delay(120)
}
async function choose(selector,label){await evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector('.t-input').click()`);await delay(350);await click(label);await delay(250)}
async function go(path){await evaluate(`void document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`);await delay(400)}
async function edit(){await evaluate('document.querySelector(".tnode--clickable").click()');await until('document.querySelector(".pe")?.checkVisibility({visibilityProperty:true}) && !document.querySelector(".pe__footer button:last-child").disabled');await delay(200)}
async function addShell(){await click('添加任务','document.querySelector(".stage-task-list")');await click('Custom script · Shell在流水线执行环境中运行 Shell 脚本。');await delay(250)}
async function action(index,text){await evaluate(`document.querySelectorAll('.stage-task')[${index}].querySelector('button.t-button').click()`);await delay(350);await click(text);await delay(400)}
async function save(){await click('更新流水线');await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})');await delay(250)}
const aria=(name)=>`[aria-label=${JSON.stringify(name)}]`
try {
  await browser.navigate(app+'/config/workflow');await until('document.querySelector(".tnode--clickable")');await edit()
  await click('前置阶段');await evaluate('document.querySelector(".stage-task-list button.t-button").click()')
  check('目录显示自定义脚本与示例插件',await until('document.querySelectorAll(".task-catalog__plugin").length===2 && document.querySelectorAll(".stage-task-types button").length===2'))
  await input(aria('搜索任务')+' input','unknown')
  check('目录无匹配时显示空态',await until('document.querySelector(".task-catalog")?.textContent.includes("没有匹配的任务")'))
  await input(aria('搜索任务')+' input','HTTP')
  check('目录按名称搜索',await until('document.querySelectorAll(".task-catalog__plugin").length===1 && document.querySelector(".task-catalog__plugin").textContent.includes("HTTP request")'))
  await input(aria('搜索任务')+' input','');await choose(aria('任务分类'),'Build')
  check('目录按分类过滤',await evaluate('document.querySelectorAll(".task-catalog__plugin").length===1 && !document.querySelector(".stage-task-types")'))
  await screenshot('01-task-catalog')
  await evaluate('document.querySelector(".task-catalog__plugin").click()');await until('document.querySelector(".stage-task-detail")')
  check('插件按版本生成类型化参数',await evaluate('document.querySelectorAll(".task-variables--inputs .task-variable-row").length===2 && document.querySelectorAll(".task-variables--outputs .task-variable-row").length===1'))
  check('插件脚本与参数结构保持只读',await evaluate('!document.querySelector("textarea[aria-label]") && document.querySelector(".task-variables--inputs .task-variable-row input").readOnly'))
  await input(aria('输入变量 1 值')+' input','build');await choose(aria('插件版本'),'mock-v1')
  check('切换版本保留同名同类型参数',await evaluate('document.querySelectorAll(".task-variables--inputs .task-variable-row").length===1 && document.querySelector('+JSON.stringify(aria('输入变量 1 值')+' input')+').value==="build"'))
  await input('input[name=task-name]','Run npm')
  await save();await edit();await click('前置阶段')
  check('插件版本与参数保存回读',await evaluate('document.querySelector('+JSON.stringify(aria('插件版本')+' input')+').value==="mock-v1" && document.querySelector('+JSON.stringify(aria('输入变量 1 值')+' input')+').value==="build"'))
  await screenshot('02-plugin-parameters')
  await addShell();await input('input[name=task-name]','Consumer')
  await click('+ 添加输入变量');await input(aria('输入变量 1 名称')+' input','RESULT')
  await choose(aria('输入变量 1 类型'),'Number');await input(aria('输入变量 1 值')+' input','many');await click('更新流水线')
  check('无效数字阻止保存并显示错误',await until('document.querySelector(".pe")?.textContent.includes("变量值必须是 Number")'))
  await choose(aria('输入变量 1 来源'),'前序任务输出');await choose(aria('输入变量 1 引用'),'Run npm / EXIT_CODE')
  check('前序输出按类型可引用',await evaluate('!document.querySelector(".task-variable-error")'))
  await click('+ 添加输入变量');await input(aria('输入变量 2 名称')+' input','APP');await choose(aria('输入变量 2 来源'),'全局变量');await choose(aria('输入变量 2 全局变量'),'APP_NAME')
  check('全局变量选择可用',await evaluate('document.querySelector('+JSON.stringify(aria('输入变量 2 全局变量')+' input')+').value==="APP_NAME"'))
  await click('Trigger / Skip Condition');await click('Set skip conditions');await choose(aria('trigger 条件 1 变量'),'RESULT');await choose(aria('trigger 条件 1 运算符'),'>');await input(aria('trigger 条件 1 值')+' input','0')
  await click('+ 添加输出变量');await input(aria('输出变量 1 名称')+' input','PASSED');await choose(aria('输出变量 1 类型'),'Boolean');await input(aria('输出变量 1 说明')+' input','测试通过')
  await click('Pass / Failure Condition');await click('Set fail conditions');await choose(aria('result 条件 1 变量'),'PASSED');await input(aria('result 条件 1 值')+' input','false')
  await input('.cm-content[aria-label="任务脚本"]','#!/bin/sh\nexport PASSED=true\n')
  check('任务修改显示草稿状态',await evaluate('Boolean(document.querySelector(".pe__dirty"))'))
  await screenshot('03-variables-and-conditions')
  await action(1,'上移')
  check('排序导致前序引用失效时立即提示',await until('document.querySelector(".task-variable-error")?.textContent.includes("前序任务输出不可用")'))
  await click('更新流水线');check('失效引用不能保存',await until('document.querySelector(".pe>.t-alert")?.textContent.includes("前序任务输出不可用")'))
  await action(0,'下移');check('恢复任务顺序恢复引用',await until('!document.querySelector(".task-variable-error")'))
  await action(1,'移到后置阶段');await click('后置阶段')
  check('跨阶段移动保留输入输出及条件',await evaluate('document.querySelector("input[name=task-name]").value==="Consumer" && document.querySelectorAll(".task-condition-row").length===2 && !document.querySelector(".task-variable-error")'))
  await evaluate('document.querySelector(".stage-task-detail>.t-checkbox").click()')
  await save();await edit();await click('后置阶段')
  check('变量引用与条件保存回读',await evaluate('document.querySelectorAll(".task-condition-row").length===2 && document.querySelector('+JSON.stringify(aria('输入变量 1 引用')+' input')+').value==="Run npm / EXIT_CODE" && document.querySelector('+JSON.stringify(aria('输出变量 1 名称')+' input')+').value==="PASSED"'))
  check('构建失败仍触发选项保存回读',await evaluate('document.querySelector(".stage-task-detail>.t-checkbox").classList.contains("t-is-checked")'))
  await click('Container','document.querySelector(".stage-fields")');await until('document.body.textContent.includes("切换并清除")');await click('取消','document.querySelector(".stage-task-detail .t-dialog")')
  check('取消执行方式切换保留输出',await evaluate('document.querySelectorAll(".task-variables--outputs .task-variable-row").length===1'))
  await click('Container','document.querySelector(".stage-fields")');await click('切换并清除')
  check('切换 Container 清除不支持的输出配置',await until('Boolean(document.querySelector("input[name=task-image]")) && !document.querySelector(".task-variables--outputs") && !document.querySelector(".task-conditions--result")'))
  await click('取消','document.querySelector(".pe__footer")');await until('document.body.textContent.includes("放弃未保存的流水线修改？")');await click('继续编辑')
  check('取消关闭继续保留草稿',await evaluate('Boolean(document.querySelector("input[name=task-image]")) && document.querySelector(".pe").checkVisibility({visibilityProperty:true})'))
  await click('取消','document.querySelector(".pe__footer")');await click('放弃修改');await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})');await edit();await click('后置阶段')
  check('放弃修改恢复保存版本',await evaluate('!document.querySelector("input[name=task-image]") && document.querySelectorAll(".task-variables--outputs .task-variable-row").length===1'))
  await input('input[name=task-description]','draft description')
  await go(app+'/config/git');await until('document.body.textContent.includes("放弃未保存的流水线修改？")');await click('继续编辑')
  check('路由离开可取消并保留草稿',await evaluate('location.pathname.endsWith("/workflow") && document.querySelector("input[name=task-description]").value==="draft description"'))
  check('刷新事件被未保存草稿拦截',await evaluate('(() => {const event=new Event("beforeunload",{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})()'))
  await go(app+'/config/git');await click('放弃修改');await until('location.pathname.endsWith("/git")')
  check('确认后完成路由离开',await evaluate('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})'))
  await go(app+'/config/workflow');await until('document.querySelector(".tnode--clickable")');await edit();await click('后置阶段')
  check('再次打开不混入已丢弃的草稿',await evaluate('document.querySelector("input[name=task-description]").value===""'))
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await delay(250)
  await screenshot('04-task-editor-1280')
  check('1280px 任务字段没有根页面横向溢出',await evaluate('document.documentElement.scrollWidth<=innerWidth && document.querySelector(".pe__body").scrollWidth<=document.querySelector(".pe__body").clientWidth+1'))
  check('长任务表单保存栏固定可见',await evaluate('(() => {const r=document.querySelector(".pe__footer").getBoundingClientRect();return r.bottom<=innerHeight && r.top>0})()'))
  check('单选与复选框文字保持同行',await evaluate('(() => {const labels=[document.querySelector(".stage-task-detail>.t-checkbox"),...document.querySelectorAll(".stage-fields .t-radio")];return labels.every(label=>{const icon=label.querySelector(".t-checkbox__input,.t-radio__input")?.getBoundingClientRect(),text=label.querySelector(".t-checkbox__label,.t-radio__label")?.getBoundingClientRect();return icon && text && Math.abs(icon.top+icon.height/2-text.top-text.height/2)<8 && text.left>=icon.right})})()'))
  check('滚动详情不会移动任务侧栏',await evaluate('(() => {const list=document.querySelector(".stage-task-list"),detail=document.querySelector(".stage-task-detail"),top=list.getBoundingClientRect().top;detail.scrollTop=detail.scrollHeight;return list.getBoundingClientRect().top===top && list.getBoundingClientRect().bottom<=document.querySelector(".pe__footer").getBoundingClientRect().top+1})()'))
  await click('前置阶段');await action(0,'删除任务');await click('更新流水线');await click('后置阶段')
  check('删除生产任务后后置引用失效且保存被阻止',await until('document.querySelector(".task-variable-error")?.textContent.includes("前序任务输出不可用")'))
  await click('取消','document.querySelector(".pe__footer")');await click('放弃修改');await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})')
  await edit();await click('取消','document.querySelector(".pe__footer")')
  check('未修改时关闭不弹草稿确认',await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})'))
  assert.deepEqual(browser.errors,[]);assert.deepEqual(browser.warnings,[])
  writeFileSync(resolve(output,'results.json'),JSON.stringify({checks,errors:browser.errors,warnings:browser.warnings},null,2))
  console.log(`Completed ${checks.length} browser task checks`)
} catch(error){await screenshot('failure');console.error('Browser errors:',browser.errors,'warnings:',browser.warnings);throw error} finally {await browser.close()}
