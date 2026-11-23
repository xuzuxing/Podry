// ConfigMap / Secret、对比、发布快照与 Markdown Notes 的前端浏览器验收。
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { parse } from 'yaml'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'
const baseURL=process.argv[2]||'http://127.0.0.1:5182'
const output=resolve(import.meta.dirname,'../screenshots-config-entry-parity')
const browser=await launchBrowser(baseURL,output)
const cm = codeMirrorDriver(browser)
const {evaluate,until,screenshot,call}=browser
const checks=[]
const app='/projects/p-shop/apps/a-checkout'
const editor='.ce .values-editor .cm-content'
function check(name,value){assert.ok(value,name);checks.push(name);console.log('PASS '+name)}
async function click(text,scope='document'){
  await until(`[...${scope}.querySelectorAll('button,a,.t-radio-button,.t-radio,.t-checkbox')].some(item=>item.checkVisibility({visibilityProperty:true})&&item.textContent.trim()===${JSON.stringify(text)})`)
  assert.ok(await evaluate(`(()=>{const button=[...${scope}.querySelectorAll('button,a,.t-radio-button,.t-radio,.t-checkbox')].find((item)=>item.getClientRects().length&&item.textContent.trim()===${JSON.stringify(text)});if(!button)return false;button.click();return true})()`),'找不到操作：'+text)
  await delay(180)
}
async function input(selector,value){
  if (selector.includes('.cm-content')) return cm.write(selector, value)
await evaluate(`(()=>{const item=document.querySelector(${JSON.stringify(selector)});if(!item)throw Error('找不到输入框');const proto=item instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(item,${JSON.stringify(value)});item.dispatchEvent(new Event('input',{bubbles:true}));item.dispatchEvent(new Event('change',{bubbles:true}));})()`);await delay(120)}
async function go(path){await evaluate(`void document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`);await delay(650)}
async function choose(selector,text){await evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector('.t-input').click()`);await delay(350);await until(`Array.from(document.querySelectorAll('.t-select-option')).some((item)=>item.getClientRects().length&&item.textContent.trim()===${JSON.stringify(text)})`);await evaluate(`Array.from(document.querySelectorAll('.t-select-option')).find((item)=>item.getClientRects().length&&item.textContent.trim()===${JSON.stringify(text)}).click()`);await delay(350);await until(`document.querySelector(${JSON.stringify(selector)}).querySelector('input').value===${JSON.stringify(text)}`)}
async function save(){await click('保存修改','document.querySelector(".ce__footer")');await until('document.querySelector(".ce__footer")?.textContent.includes("· 已保存")')}
async function yaml(){await click('YAML','document.querySelector(".entry-form")');await until('!!document.querySelector(".ce .values-editor .cm-content")')}
const dialog='[...document.querySelectorAll(".t-dialog")].find((item)=>item.getClientRects().length)'
try{
  await browser.navigate(app+'/config/overrides/e-dev/configmaps')
  await until('!!document.querySelector(".entry-form")')
  check('环境配置同时显示基础条目与覆盖状态',await evaluate('document.querySelector(".entry-list").textContent.includes("checkout-api-config")&&document.querySelector(".entry-list").textContent.includes("已覆盖")'))
  await click('继承','document.querySelector(".ce__tabs")');await yaml()
  check('继承配置只读且保留基础键',await evaluate(`document.querySelector(${JSON.stringify(editor)}).getAttribute("aria-readonly")==="true"`) && (await cm.read(editor)).includes('CACHE_TTL_SECONDS'))
  await screenshot('01-inherited-configmap')
  await click('覆盖','document.querySelector(".ce__tabs")')
  check('覆盖页只显示覆盖字段',Object.keys(parse(await cm.read(editor))).length===1)
  await input(editor,'# override comment\nLOG_LEVEL: trace\nNEW_KEY: "new"\n')
  await click('查看合并值')
  let data=parse(await cm.read(editor))
  check('Patch 预览合并基础键与覆盖',data.LOG_LEVEL==='trace'&&data.CURRENCY==='CNY'&&data.NEW_KEY==='new')
  check('合并预览只读',await evaluate(`(document.querySelector(${JSON.stringify(editor)}).getAttribute("aria-readonly")==="true")`))
  await choose('.ce__strategy-select','Replace · 替换完整配置')
  check('Replace 不保留未声明的基础键',!('CURRENCY' in parse(await cm.read(editor))))
  await choose('.ce__strategy-select','Patch · 覆盖指定字段');await click('编辑覆盖值');await save()
  await go(app+'/config/git');await go(app+'/config/overrides/e-dev/configmaps');await yaml()
  check('覆盖 YAML 注释保存回读',(await cm.read(editor)).startsWith('# override comment'))
  await input(editor,'DUP: one\nDUP: two\n')
  check('重复 YAML key 禁用保存',await until('[...document.querySelectorAll(".ce__footer button")].find((item)=>item.textContent.includes("保存修改")).disabled'))
  await click('取消修改');await click('放弃修改',dialog)
  await input(editor,'LOG_LEVEL: unsaved\n')
  await go(app+'/config/git')
  check('未保存离开需要确认',await until('document.body.innerText.includes("放弃未保存修改？")'))
  await click('继续编辑',dialog)
  check('继续编辑保留草稿',await evaluate(`location.pathname.endsWith('/configmaps')`) && (await cm.read(editor)).includes('unsaved'))
  await go(app+'/config/git');await click('放弃修改',dialog);await until('location.pathname.endsWith("/git")')
  await go(app+'/config/overrides/e-dev/configmaps')
  await click('删除覆盖');await click('删除覆盖',dialog)
  check('删除覆盖恢复继承与无覆盖空态',await until('document.querySelector(".ce__empty")?.textContent.includes("尚未配置覆盖")&&document.querySelector(".entry-list").textContent.includes("继承")'))
  await click('创建覆盖');await yaml();await input(editor,'{}\n');await save()
  check('空 Patch 保留显式覆盖',await until('document.querySelector(".entry-list").textContent.includes("已覆盖")&&!document.querySelector(".ce__empty")'))
  await go(app+'/config/base/configmaps')
  await click('数据卷','document.querySelector(".entry-form")')
  await input('[aria-label="挂载路径"] input','relative/path')
  check('数据卷挂载路径校验',await until('document.querySelector(".ce__footer").textContent.includes("绝对挂载路径")'))
  await input('[aria-label="挂载路径"] input','/etc/checkout')
  await input('[aria-label="文件权限"] input','0999')
  check('文件权限八进制校验',await until('document.querySelector(".ce__footer").textContent.includes("八进制")'))
  await input('[aria-label="文件权限"] input','0640');await save()
  await screenshot('02-volume-configmap')
  await evaluate('document.querySelector(".entry-list__heading button").click()');await delay(150)
  await input('[aria-label="配置名称"] input','existing-config')
  await choose('[aria-label="配置来源"]','使用已有 Kubernetes ConfigMap')
  await save()
  check('已有 ConfigMap 引用不需要创建数据键',await until('document.querySelector(".entry-list").textContent.includes("existing-config")'))
  await click('试运行','document.querySelector(".ce__tabs")')
  check('已有资源试运行明确为引用',(await cm.read(editor)).includes('不创建新的清单'))
  await go(app+'/config/overrides/e-dev/secrets')
  await until('location.pathname.endsWith("/config/overrides/e-dev/secrets")&&document.querySelector(".entry-list")?.textContent.includes("checkout-api-secret")')
  check('环境 Secret 显示继承及环境独有条目',await evaluate('document.querySelectorAll(".entry-list__item").length===2&&document.querySelector(".entry-list").textContent.includes("环境独有")'))
  check('只有继承的条目默认打开继承页',await until('new URLSearchParams(location.search).get("headerTab")==="inherited"'))
  await click('不覆盖','document.querySelector(".ce__tabs")')
  await click('创建覆盖');await click('显示/编辑值');await yaml();await input(editor,'TOKEN: super-secret-test\n');await save()
  check('Secret 保存后遮蔽明文',!(await cm.read(editor)).includes('super-secret-test') && (await cm.read(editor)).includes('TOKEN'))
  await click('试运行','document.querySelector(".ce__tabs")')
  check('Secret 预览不输出明文',!(await cm.read(editor)).includes('super-secret-test'))
  await screenshot('03-secret-preview')
  await click('对比环境...')
  await until('!!document.querySelector(".cmp__table")')
  check('配置对比进入独立工作区',await evaluate('location.pathname.includes("/config/compare/")&&!!document.querySelector(".comparison-workspace")&&!document.querySelector(".cfg__nav")'))
  await click('ConfigMaps','document.querySelector(".cmp__tabs")')
  await choose('[aria-label="对比基准环境"]','基础配置（Base）')
  await choose('[aria-label="对比目标环境"]','生产环境')
  check('ConfigMap 对比显示继承与覆盖后的键',await until('document.querySelector(".cmp__table").textContent.includes("data.LOG_LEVEL")'))
  await click('YAML','document.querySelector(".cmp")')
  check('YAML 并排差异展示',await until('document.querySelectorAll(".cmp .cm-content[aria-readonly=true]").length===2&&!!document.querySelector(".cmp .cm-merge-b .cm-changedLine")'))
  await screenshot('04-configmap-compare')
  await click('Secrets','document.querySelector(".cmp__tabs")')
  check('Secret 对比明确遮蔽值边界',await evaluate('document.querySelector(".cmp__desc").textContent.includes("不代表明文相同")'))
  await click('关闭','document.querySelector(".cmp")')
  await go(app+'/deployments?env=e-dev');await click('配置','document.querySelector(".dh-tabs")')
  check('历史配置读取独立快照',await until('document.querySelector(".deployment-snapshot").textContent.includes("本地示例快照")'))
  await click('ConfigMaps','document.querySelector(".deployment-snapshot")')
  check('历史 ConfigMap 未被当前挂载修改污染',await until('document.querySelector(".deployment-snapshot__table").textContent.includes("debug")&&!document.querySelector(".deployment-snapshot__table").textContent.includes("/etc/checkout")'))
  await click('对比当前配置','document.querySelector(".deployment-snapshot")')
  check('历史快照可对比当前配置',await until('document.querySelector(".deployment-snapshot .configuration-diff").textContent.includes("/etc/checkout")'))
  await screenshot('05-deployment-snapshot-diff')
  await go('/projects/p-shop/apps/a-payment/deployments?env=e-dev');await click('配置','document.querySelector(".dh-tabs")')
  check('缺失历史快照不回填当前值',await until('!!document.querySelector(".deployment-snapshot__missing")&&!document.querySelector(".deployment-snapshot__table")'))
  await go(app+'/resources');await click('Notes')
  check('Notes Markdown 渲染标题列表代码块',await until('!!document.querySelector(".release-notes h2")&&!!document.querySelector(".release-notes ol")&&!!document.querySelector(".release-notes pre code")'))
  await screenshot('06-release-notes-markdown')
  // 从 Vue 的 VNode 树定位实际渲染器，在生产构建上注入不可信 Notes；不增加产品测试入口。
  await evaluate(`(()=>{const queue=[document.querySelector('#app').__vue_app__._container._vnode];const seen=new Set();while(queue.length){const node=queue.pop();if(!node||typeof node!=='object'||seen.has(node))continue;seen.add(node);if(node.component?.type.__name==='ReleaseNotesMarkdown'){node.component.props.source=${JSON.stringify('## Security\n\n<script>window.__notesUnsafe=true</script>\n\n<img src=x onerror="window.__notesUnsafe=true">\n\n[bad](javascript:alert(1))\n\n[docs](https://example.com)')};return}if(node.component)queue.push(node.component.subTree);if(Array.isArray(node.children))queue.push(...node.children);if(node.suspense)queue.push(node.suspense.activeBranch)}throw Error('未找到 Notes 渲染器')})()`)
  await delay(150)
  check('Notes 过滤脚本事件和危险链接',await evaluate('!window.__notesUnsafe&&!document.querySelector(".release-notes script,.release-notes img,.release-notes a[href^=javascript]")'))
  check('Notes 外链隔离新窗口',await evaluate('document.querySelector(".release-notes a[href^=https]").rel==="noopener noreferrer"'))
  await go(app+'/config/base/configmaps')
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false})
  check('1280px 配置页无根页面横向溢出',await evaluate('document.documentElement.scrollWidth<=1280'))
  check('配置保存栏可见',await evaluate('document.querySelector(".ce__footer").getBoundingClientRect().bottom<=window.innerHeight'))
  await screenshot('07-configmap-1280')
  await go(app+'/config/overrides/e-missing/configmaps')
  check('未绑定环境禁止编辑配置',await until('document.querySelector(".error-state")?.textContent.includes("尚未绑定")||(!document.querySelector(".entry-form")&&document.body.innerText.includes("尚未绑定此环境"))'))
  check('无运行时错误',browser.errors.length===0)
  check('无控制台警告',browser.warnings.length===0)
}catch(err){await screenshot('failure-round43');console.error(await evaluate('({url:location.href,text:document.body.innerText.slice(-5000),errors:[]})'));throw err}
finally{writeFileSync(resolve(output,'results.json'),JSON.stringify({checks,errors:browser.errors,warnings:browser.warnings},null,2));await browser.close()}
console.log(`Completed ${checks.length} config-entry/history/Notes checks; screenshots: ${output}`)
