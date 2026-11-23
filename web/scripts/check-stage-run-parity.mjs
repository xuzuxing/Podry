// 阶段节点、镜像选择、独立历史、日志、取消/重试与快照；只验证本地 Mock。
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'
const output=resolve(import.meta.dirname,'../screenshots-stage-run-parity')
const browser=await launchBrowser(process.argv[2]||'http://127.0.0.1:5182',output)
const {evaluate,until,screenshot,call}=browser
const cm = codeMirrorDriver(browser)
const checks=[],app='/projects/p-shop/apps/a-checkout',pipeline='pl-checkout-cd-staging'
const node=stage=>`.stage-node[data-pipeline="${pipeline}"][data-stage="${stage}"]`
function check(name,value){assert.ok(value,name);checks.push(name);console.log('PASS '+name)}
async function click(text,scope='document'){
  const item=`[...${scope}.querySelectorAll('button,a,.t-radio,.t-select-option,.t-dropdown__item')].find(item=>item.checkVisibility({visibilityProperty:true}) && item.textContent.trim()===${JSON.stringify(text)})`
  await until(`Boolean(${item})`);await evaluate(`(${item}).click()`);await delay(220)
}
async function tap(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(160)}
async function input(selector,value){
  if (selector.includes('.cm-content')) return cm.write(selector, value)
  await evaluate(`(()=>{const item=document.querySelector(${JSON.stringify(selector)});if(!item)throw Error('missing input '+${JSON.stringify(selector)});const proto=item instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(item,${JSON.stringify(value)});item.dispatchEvent(new Event('input',{bubbles:true}));item.dispatchEvent(new Event('change',{bubbles:true}))})()`);await delay(120)}
async function go(path){await evaluate(`void document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`);await delay(450)}
async function picker(stage){await until(`Boolean(document.querySelector(${JSON.stringify(node(stage))}))`);await tap(node(stage)+' .stage-node__image');await until('document.querySelector(".stage-image-picker")?.checkVisibility({visibilityProperty:true}) && !document.querySelector(".stage-image-picker__footer button:last-child").disabled');await delay(180)}
async function choose(selector,label){await tap(selector+' .t-input');await delay(200);await click(label);await delay(300)}
const history=run=>`${app}/deployments?type=PRECD&env=e-staging&pipeline=${pipeline}&run=${run}`
const dialog='[...document.querySelectorAll(".t-dialog")].find(item=>item.checkVisibility({visibilityProperty:true}))'
async function cancel(){await click('取消运行');await click('确认取消',dialog);await until('document.querySelector(".stage-run-timeline")?.textContent.includes("已取消") && ![...document.querySelectorAll(".t-dialog")].some(item=>item.checkVisibility({visibilityProperty:true}))')}
try{
  await browser.navigate(app+'/config/workflow');await until('document.querySelector(".tnode--clickable")');await evaluate('[...document.querySelectorAll(".tnode__name")].find(item=>item.textContent.trim()==="预发布环境").closest(".tnode").click()');await until('document.querySelector(".pe")?.checkVisibility({visibilityProperty:true}) && !document.querySelector(".pe__footer button:last-child").disabled');await click('前置阶段');await click('添加任务','document.querySelector(".stage-task-list")');await tap('.stage-task-types button:first-child');await click('更新流水线');await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})');await go(app+'/trigger');await until('document.querySelector(".stage-node")')
  check('有任务的 CD 显示独立前后节点',await evaluate(`document.querySelectorAll('.stage-node[data-pipeline="${pipeline}"]').length===2`))
  check('无任务的 CD 不显示空阶段节点',await evaluate('!document.querySelector(".stage-node[data-pipeline=pl-checkout-cd-dev]")'))
  check('阶段节点初始未触发且不显示详情',await evaluate(`document.querySelector(${JSON.stringify(node('PRECD'))}).textContent.includes('未触发') && !document.querySelector(${JSON.stringify(node('PRECD')+' .stage-node__status button')})`))
  check('节点按前置、部署、后置从左向右排列',await evaluate(`(()=>{const pre=document.querySelector(${JSON.stringify(node('PRECD'))}).getBoundingClientRect(),post=document.querySelector(${JSON.stringify(node('POSTCD'))}).getBoundingClientRect(),cd=[...document.querySelectorAll('.tnode__name')].find(item=>item.textContent.trim()==='预发布环境').closest('.tnode').getBoundingClientRect();return pre.right<cd.left && cd.right<post.left && pre.top===cd.top && cd.top===post.top})()`))
  await screenshot('01-stage-workflow')
  await picker('PRECD')
  check('阶段镜像抽屉显示目标和快照版本',await evaluate('document.querySelector(".stage-image-picker").textContent.includes("shop-staging") && document.querySelector(".stage-image-picker__footer").textContent.includes("流水线 v")'))
  check('阶段镜像目录有可选项且不显示部署策略',await evaluate('document.querySelectorAll(".stage-image-card").length>0 && !document.querySelector(".rv__strategy")'))
  await input('[aria-label="搜索阶段镜像"] input','no-such-stage-image')
  check('阶段镜像支持搜索无匹配空态',await until('document.querySelector(".stage-image-picker").textContent.includes("没有匹配的镜像")'))
  await input('[aria-label="搜索阶段镜像"] input','');await click('展开详情','document.querySelector(".stage-image-card")')
  check('镜像详情展示固定 digest',await evaluate('document.querySelector(".stage-image-card dl").textContent.includes("sha256:")'))
  await screenshot('02-stage-select-image');await click('取消','document.querySelector(".stage-image-picker__footer")');await until('!document.querySelector(".stage-image-picker")?.checkVisibility({visibilityProperty:true})')
  check('取消镜像选择不触发阶段',await evaluate(`document.querySelector(${JSON.stringify(node('PRECD'))}).textContent.includes('未触发')`))
  await picker('PRECD');await click('运行阶段');await until('location.search.includes("type=PRECD") && Boolean(document.querySelector(".stage-task-logs__text"))')
  const first=await evaluate('new URLSearchParams(location.search).get("run")')
  check('触发跳转到当前阶段和运行记录',first && await evaluate(`new URLSearchParams(location.search).get('pipeline')==='${pipeline}' && new URLSearchParams(location.search).get('env')==='e-staging'`))
  check('阶段日志明确展示 Mock 和固定镜像',await until('document.querySelector(".stage-task-logs__text").textContent.includes("没有执行脚本") && document.querySelector(".stage-task-logs__text").textContent.includes("sha256:")'))
  check('历史侧栏选中当前运行',await evaluate(`document.querySelector('.stage-run-history__records button.active').dataset.runId===${JSON.stringify(first)}`))
  check('阶段历史保留多个任务',await evaluate('document.querySelectorAll(".stage-run-log-workspace aside button").length===2'))
  await tap('.stage-run-log-workspace aside button:nth-child(2)')
  check('选择任务读取自己的日志',await until('document.querySelector(".stage-task-logs__text").textContent.includes("Task: Task 2") && document.querySelector(".stage-task-logs__text").textContent.includes("等待示例任务")'))
  await tap('.stage-run-log-workspace aside button:first-child')
  check('返回前一个任务不混用日志',await until('document.querySelector(".stage-task-logs__text").textContent.includes("Task: Check application environment") && !document.querySelector(".stage-task-logs__text").textContent.includes("Task: Task 2")'))
  await click('取消运行');await click('取消',dialog)
  check('取消运行确认可以撤回',await evaluate('document.querySelector(".stage-run-timeline").textContent.includes("取消运行")'))
  await cancel();check('取消后显示终态和重试入口',await evaluate('document.querySelector(".stage-run-timeline").textContent.includes("已取消") && document.querySelector(".stage-run-timeline").textContent.includes("重试阶段")'))
  await click('下载日志');check('日志下载入口可用',await until('document.querySelector(".stage-task-logs").textContent.includes("已下载日志")'))
  await tap('.stage-task-logs .t-checkbox:first-of-type');check('日志可切换自动换行',await evaluate('document.querySelector(".stage-task-logs__text").classList.contains("is-wrapped")'))
  await click('Configuration','document.querySelector(".stage-run-tabs")')
  const original=await evaluate('document.querySelector(".stage-run-config").textContent')
  check('配置页展示触发时任务、环境和执行设置',original.includes('pre-deployment checks') && original.includes('shop-staging') && original.includes('runInEnvironment: false'))
  await click('Source','document.querySelector(".stage-run-tabs")')
  check('源码页使用历史构建及镜像快照',await evaluate('Boolean(document.querySelector(".build-source-snapshot")) && document.querySelector(".stage-run-image-snapshot").textContent.includes("sha256:")'))
  await click('Artifacts','document.querySelector(".stage-run-tabs")');check('产物页面明确没有生成真实文件',await evaluate('document.querySelector(".stage-run-detail").textContent.includes("本地 Mock 未生成任务产物")'))
  await click('重试阶段');await until(`new URLSearchParams(location.search).get('run')!==${JSON.stringify(first)} && Boolean(document.querySelector('.stage-task-logs__text'))`)
  const second=await evaluate('new URLSearchParams(location.search).get("run")')
  check('重试生成新记录与次数且保留原记录',await evaluate('document.querySelectorAll(".stage-run-history__records button").length===2 && document.querySelector(".stage-run-timeline").textContent.includes("第 2 次运行")'))
  await go(app+'/trigger');await picker('PRECD');await click('运行阶段')
  check('运行中阶段阻止重复触发',await until('document.querySelector(".stage-image-picker .t-alert")?.textContent.includes("已有运行中的记录")'))
  await click('取消','document.querySelector(".stage-image-picker__footer")');await go(history(second));await until('Boolean(document.querySelector(".stage-run-detail"))');await cancel()
  await go(app+'/config/workflow');await until('document.querySelector(".tnode--clickable")');await evaluate('[...document.querySelectorAll(".tnode__name")].find(item=>item.textContent.trim()==="预发布环境").closest(".tnode").click()');await until('document.querySelector(".pe")?.checkVisibility({visibilityProperty:true}) && !document.querySelector(".pe__footer button:last-child").disabled');await click('前置阶段');await input('.cm-content[aria-label="任务脚本"]','#!/bin/sh\necho "updated pipeline after stage run"\n');await click('更新流水线');await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})')
  check('配置图继续使用 CD 编辑节点而非运行节点',await evaluate('!document.querySelector(".stage-node")'))
  await go(history(first));await until('Boolean(document.querySelector(".stage-run-detail"))');await click('Configuration','document.querySelector(".stage-run-tabs")')
  check('更新当前配置不改写历史阶段快照',await evaluate('document.querySelector(".stage-run-config").textContent.includes("pre-deployment checks") && !document.querySelector(".stage-run-config").textContent.includes("updated pipeline after stage run")'))
  await click('重试阶段');await until(`new URLSearchParams(location.search).get('run')!==${JSON.stringify(first)}`);await click('Configuration','document.querySelector(".stage-run-tabs")')
  check('配置改变后重试仍沿用旧任务快照',await evaluate('document.querySelector(".stage-run-config").textContent.includes("pre-deployment checks") && !document.querySelector(".stage-run-config").textContent.includes("updated pipeline after stage run")'));await cancel()
  await choose('[aria-label="阶段历史环境"]','开发环境')
  check('切换环境清空旧运行选择并显示空态',await evaluate('!document.querySelector(".stage-run-detail") && !new URLSearchParams(location.search).has("run") && document.querySelector(".stage-run-history").textContent.includes("暂无阶段记录")'))
  await choose('[aria-label="阶段历史环境"]','预发布环境')
  check('返回环境恢复本环境记录',await until('document.querySelectorAll(".stage-run-history__records button").length===3'))
  await go(`${app}/deployments?type=POSTCD&env=e-staging&pipeline=${pipeline}&run=${first}`)
  check('前置记录不能串入后置阶段详情',await until('document.querySelector(".stage-run-history").textContent.includes("未找到此阶段运行记录") && !document.querySelector(".stage-run-detail")'))
  await go(`${app}/deployments?type=PRECD&env=e-staging&pipeline=not-a-pipeline&run=${first}`)
  check('失效流水线上下文不回退到其他流水线',await until('!document.querySelector(".stage-run-detail") && document.querySelector(".stage-run-history").textContent.includes("未找到此阶段运行记录")'))
  await go(history(first));await until('Boolean(document.querySelector(".stage-run-detail"))');await click('Post-deployment','document.querySelector(".deployment-activity__tabs")')
  check('阶段切换保留环境并移除旧运行 id',await evaluate('new URLSearchParams(location.search).get("type")==="POSTCD" && new URLSearchParams(location.search).get("env")==="e-staging" && !new URLSearchParams(location.search).has("run")'))
  await click('Deployment','document.querySelector(".deployment-activity__tabs")');await until('Boolean(document.querySelector(".dh"))')
  check('原部署历史仍可独立访问',await evaluate('Boolean(document.querySelector(".dh-env-select")) && !document.querySelector(".stage-run-history")'))
  await go(app+'/trigger');await picker('POSTCD');await click('运行阶段');await until('location.search.includes("type=POSTCD") && Boolean(document.querySelector(".stage-run-detail"))')
  check('后置阶段拥有独立任务历史',await evaluate('document.querySelectorAll(".stage-run-history__records button").length===1 && document.querySelector(".stage-run-log-workspace").textContent.includes("Verify release")'))
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await delay(220);await screenshot('03-stage-history-1280')
  check('1280px 历史页面没有根页面横向溢出',await evaluate('document.documentElement.scrollWidth<=innerWidth && document.querySelector(".stage-run-detail").scrollWidth<=document.querySelector(".stage-run-detail").clientWidth+1'))
  check('历史和日志各自内部滚动',await evaluate('getComputedStyle(document.querySelector(".stage-run-history__records")).overflowY==="auto" && getComputedStyle(document.querySelector(".stage-task-logs__text")).overflowY==="auto"'))
  await until('document.querySelector(".stage-run-timeline").textContent.includes("运行中")',6000)
  check('历史自动刷新运行状态',await evaluate('document.querySelector(".stage-run-log-workspace aside").textContent.includes("运行中")'))
  await until('document.querySelector(".stage-run-timeline").textContent.includes("成功")',35000)
  check('Mock 完成后自动更新终态并关闭取消入口',await evaluate('!document.querySelector(".stage-run-timeline").textContent.includes("取消运行") && !document.querySelector(".stage-run-timeline").textContent.includes("重试阶段")'))
  await screenshot('04-stage-success-1280');await go(app+'/trigger');await until('Boolean(document.querySelector(".stage-node"))')
  check('返回画布显示阶段各自最新状态',await evaluate(`document.querySelector(${JSON.stringify(node('PRECD'))}).textContent.includes('已取消') && document.querySelector(${JSON.stringify(node('POSTCD'))}).textContent.includes('成功')`))
  check('1280px 画布仅在内部横向滚动',await evaluate('document.documentElement.scrollWidth<=innerWidth && document.querySelector(".wf__well").scrollWidth>document.querySelector(".wf__well").clientWidth && getComputedStyle(document.querySelector(".wf__well")).overflowX==="auto"'))
  await evaluate(`document.querySelector(${JSON.stringify(node('POSTCD'))}).scrollIntoView({block:'nearest',inline:'nearest'})`);await screenshot('05-stage-workflow-1280')
  await tap(node('POSTCD')+' .stage-node__status button');await until('location.search.includes("type=POSTCD") && Boolean(document.querySelector(".stage-run-detail"))')
  check('节点详情链接定位正确阶段',await evaluate('document.querySelector(".stage-run-timeline").textContent.includes("Post-deployment") && document.querySelector(".stage-run-timeline").textContent.includes("成功")'))
  assert.deepEqual(browser.errors,[]);assert.deepEqual(browser.warnings,[])
  writeFileSync(resolve(output,'results.json'),JSON.stringify({checks,errors:browser.errors,warnings:browser.warnings},null,2));console.log(`Completed ${checks.length} stage run browser checks`)
}catch(error){await screenshot('failure');writeFileSync(resolve(output,'failure.json'),JSON.stringify({message:error.message,checks,errors:browser.errors,warnings:browser.warnings},null,2));throw error}
finally{await browser.close()}
