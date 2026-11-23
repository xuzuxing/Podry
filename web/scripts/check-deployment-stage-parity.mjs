// CD 阶段触发/执行环境与草稿保护；仅使用本地 Mock。
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
const output = resolve(import.meta.dirname, '../screenshots-deployment-stage-parity')
const browser = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182', output)
const { evaluate, until, screenshot, call } = browser
const checks = []
const app = '/projects/p-shop/apps/a-checkout'
const stageScope = 'document.querySelector(".deployment-stage-trigger")'
const toggle = '.deployment-stage-execution__toggle'
function check(name,value) { assert.ok(value,name); checks.push(name); console.log('PASS '+name) }
async function click(text,scope='document') {
  const target = `[...${scope}.querySelectorAll('button,a,.t-radio,.t-dropdown__item')].find(item=>item.checkVisibility({visibilityProperty:true}) && item.textContent.trim()===${JSON.stringify(text)})`
  await until(`Boolean(${target})`); await evaluate(`(${target}).click()`); await delay(220)
}
async function tap(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(180) }
async function go(path) { await evaluate(`void document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`); await delay(400) }
async function edit(name='开发环境') {
  if (name === 'CI') await tap('.tnode--clickable')
  else await evaluate(`[...document.querySelectorAll('.tnode__name')].find(item=>item.textContent.trim()===${JSON.stringify(name)}).closest('.tnode').click()`)
  await until('document.querySelector(".pe")?.checkVisibility({visibilityProperty:true}) && !document.querySelector(".pe__footer button:last-child").disabled'); await delay(200)
}
async function save() { await click('更新流水线'); await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})'); await delay(200) }
async function close() { await click('取消','document.querySelector(".pe__footer")'); await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})') }
const selected = () => evaluate('document.querySelector(".deployment-stage-trigger input:checked")?.value')
const runningInEnv = () => evaluate(`document.querySelector('${toggle} input').checked`)
try {
  await browser.navigate(app+'/config/workflow'); await until('document.querySelector(".tnode--clickable")')
  await edit('CI'); await click('前置阶段')
  check('CI 前置阶段不显示 CD 触发和执行环境',await evaluate('!document.querySelector(".deployment-stage-settings")'))
  await click('后置阶段'); check('CI 后置阶段不显示 CD 触发和执行环境',await evaluate('!document.querySelector(".deployment-stage-settings")'))
  await close(); await edit(); await click('前置阶段')
  check('旧前置阶段默认自动触发',await selected()==='auto')
  check('旧执行环境开关默认关闭',!await runningInEnv())
  check('开发环境 worker 允许选择',await evaluate(`!document.querySelector('${toggle} input').disabled`))
  check('侧栏按触发、资源、执行环境排序',await evaluate('(() => {const p=document.querySelector(".deployment-stage-settings");return [...p.children].map(item=>item.className).join("|") === "deployment-stage-trigger|stage-resources|deployment-stage-execution"})()'))
  await click('Manually',stageScope); await tap(toggle)
  check('前置触发与执行环境显示草稿标记',await selected()==='manual' && await runningInEnv() && await evaluate('Boolean(document.querySelector(".pe__dirty"))'))
  await click('后置阶段')
  check('修改前置不改变后置默认值',await selected()==='auto' && !await runningInEnv())
  await click('部署阶段'); await click('手动触发','document.querySelector(".pe__rail")'); await save()
  await edit(); await click('前置阶段')
  check('前置触发和执行环境保存回读',await selected()==='manual' && await runningInEnv())
  check('保存后草稿标记清除',await evaluate('!document.querySelector(".pe__dirty")'))
  await click('后置阶段'); check('后置默认设置独立回读',await selected()==='auto' && !await runningInEnv())
  await click('Manually',stageScope); await tap(toggle); await save(); await edit(); await click('后置阶段')
  check('后置设置可独立保存回读',await selected()==='manual' && await runningInEnv())
  await click('部署阶段'); check('部署主阶段触发不被覆盖',await evaluate('document.querySelector(".pe__rail input:checked").value==="manual"'))
  await click('前置阶段'); await click('Automatically',stageScope); await tap(toggle)
  await click('取消','document.querySelector(".pe__footer")'); await click('继续编辑')
  check('关闭确认继续编辑保留阶段草稿',await selected()==='auto' && !await runningInEnv())
  check('刷新事件受阶段草稿保护',await evaluate('(() => {const event=new Event("beforeunload",{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})()'))
  await click('取消','document.querySelector(".pe__footer")'); await click('放弃修改'); await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})'); await edit(); await click('前置阶段')
  check('放弃修改恢复已保存设置',await selected()==='manual' && await runningInEnv())
  await click('Automatically',stageScope); await go(app+'/trigger'); await click('继续编辑')
  check('路由跳转继续编辑留在当前页并保留草稿',await evaluate(`location.pathname.endsWith('/config/workflow')`) && await selected()==='auto')
  await go(app+'/trigger'); await click('放弃修改'); await until('location.pathname.endsWith("/trigger") && Boolean(document.querySelector(".trigger-meta"))')
  check('路由放弃修改可离开配置页',await evaluate('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})'))
  await go(app+'/config/workflow'); await until('document.querySelector(".tnode--clickable")'); await edit(); await click('前置阶段')
  check('SPA 离开重进保持已存设置',await selected()==='manual' && await runningInEnv())
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false}); await delay(200)
  await screenshot('01-stage-settings-1280')
  check('1280px 页面与侧栏无横向溢出',await evaluate('document.documentElement.scrollWidth<=innerWidth && document.querySelector(".stage-task-list").scrollWidth<=document.querySelector(".stage-task-list").clientWidth+1'))
  check('单选图标与文字同行',await evaluate('(() => {return [...document.querySelectorAll(".deployment-stage-trigger .t-radio")].every(label=>{const i=label.querySelector(".t-radio__input").getBoundingClientRect(),t=label.querySelector(".t-radio__label").getBoundingClientRect();return Math.abs(i.top+i.height/2-t.top-t.height/2)<8})})()'))
  check('执行开关位于说明右侧',await evaluate(`(() => {const p=document.querySelector('${toggle}'),i=p.querySelector('.t-checkbox__input').getBoundingClientRect(),t=p.querySelector('.t-checkbox__label').getBoundingClientRect();return i.left>=t.right && i.right<=p.getBoundingClientRect().right+1})()`))
  check('侧栏长内容滚动后操作栏固定可见',await evaluate('(() => {document.querySelector(".stage-task-list").scrollTop=9999;const r=document.querySelector(".pe__footer").getBoundingClientRect();return r.bottom<=innerHeight && r.top>0})()'))
  await close(); await edit('生产环境'); await click('前置阶段')
  check('生产环境不继承开发阶段设置',await selected()==='auto' && !await runningInEnv())
  check('未配置 worker 时禁用复选框并说明原因',await evaluate(`document.querySelector('${toggle} input').disabled && document.querySelector('.deployment-stage-execution').textContent.includes('未配置部署 worker')`))
  await tap(toggle); check('禁用状态点击不改变执行环境',!await runningInEnv())
  await evaluate(`document.querySelector('${toggle}').dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}))`); await delay(450)
  check('不可用执行环境提供 Devtron 原文提示',await evaluate('document.body.textContent.includes("This Environment is not configured to run on devtron worker.")'))
  await click('Manually',stageScope); await save(); await edit('生产环境'); await click('前置阶段')
  check('worker 不可用仍可保存手动触发',await selected()==='manual' && !await runningInEnv())
  await click('后置阶段'); check('worker 不可用状态覆盖后置阶段',await evaluate(`document.querySelector('${toggle} input').disabled`) && await selected()==='auto')
  await screenshot('02-worker-unavailable-1280'); await close()
  // 模拟服务端返回曾启用、现在 worker 不可用的旧配置；不增加生产调试入口。
  await evaluate(`(() => {function find(v){if(v?.component?.type?.__name==='PipelineEditDrawer')return v.component;return (v?.component && find(v.component.subTree)) || (Array.isArray(v?.children) && v.children.map(find).find(Boolean))}const c=find(document.querySelector('#app')._vnode);if(!c)throw Error('PipelineEditDrawer missing');c.props.pipeline.definition.runPreStageInEnv=true})()`)
  await edit('生产环境'); await click('前置阶段')
  check('不可用的旧选择保留并显示修复入口',await runningInEnv() && await evaluate('document.querySelector(".deployment-stage-execution").textContent.includes("已保存的执行环境当前不可用")'))
  await click('更新流水线'); check('不可用旧选择阻止保存并定位阶段',await until('document.querySelector(".pe>.t-alert")?.textContent.includes("前置阶段")'))
  await screenshot('03-unavailable-saved-selection')
  await click('关闭在应用环境执行'); check('明确关闭修复选择并标记草稿',!await runningInEnv() && await evaluate('Boolean(document.querySelector(".pe__dirty"))'))
  await save(); await edit('生产环境'); await click('前置阶段')
  check('修复后设置可保存回读',!await runningInEnv() && await selected()==='manual' && await evaluate('!document.querySelector(".deployment-stage-execution__error")'))
  await close(); await edit('预发布环境'); await click('前置阶段')
  check('同集群不同绑定保持独立设置',await selected()==='auto' && !await runningInEnv() && await evaluate(`!document.querySelector('${toggle} input').disabled`))
  await close()
  await edit(); await click('前置阶段'); await click('添加任务','document.querySelector(".stage-task-list")'); await tap('.stage-task-types button:first-child'); await click('部署阶段')
  check('存在前置任务时主阶段自动触发说明指向前置阶段',await evaluate('document.querySelector(".pe__rail").textContent.includes("前置阶段成功后自动")'))
  await save(); await edit(); await click('前置阶段')
  check('任务与阶段设置可一并保存回读',await selected()==='manual' && await runningInEnv() && await evaluate('document.querySelectorAll(".stage-task").length===1'))
  await tap('.stage-task button.t-button'); await delay(250); await click('删除任务'); await click('部署阶段')
  check('移除前置任务后自动触发说明回到 CI',await evaluate('document.querySelector(".pe__rail").textContent.includes("CI 成功后自动")'))
  await click('取消','document.querySelector(".pe__footer")'); await click('放弃修改'); await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})')
  assert.deepEqual(browser.errors,[]); assert.deepEqual(browser.warnings,[])
  writeFileSync(resolve(output,'results.json'),JSON.stringify({checks,errors:browser.errors,warnings:browser.warnings},null,2))
  console.log(`Completed ${checks.length} browser deployment stage checks`)
} catch(error) {
  await screenshot('failure'); writeFileSync(resolve(output,'failure.json'),JSON.stringify({message:error.message,checks,errors:browser.errors,warnings:browser.warnings},null,2)); throw error
} finally { await browser.close() }
