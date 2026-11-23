// Frontend Mock create/clone flow and drawer layout; no real applications are provisioned.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
const baseURL=process.argv[2]||'http://127.0.0.1:5182'
const output=resolve(import.meta.dirname,'../screenshots-application-creation-parity')
const browser=await launchBrowser(baseURL,output)
const {evaluate,until,screenshot,call}=browser
const checks=[]
const drawer='document.querySelector(".ca-drawer.t-drawer--open")'
const dialog='[...document.querySelectorAll(".t-dialog")].find(el=>el.checkVisibility({visibilityProperty:true}))'
const nameInput='[aria-label="新应用名称"] input'
const descInput='[aria-label="新应用描述"] textarea'
const tagKey=index=>`[aria-label="标签键 ${index}"] input`
const tagValue=index=>`[aria-label="标签值 ${index}"] input`
function check(name,value){assert.ok(value,name);checks.push(name);console.log('PASS '+name)}
async function click(text,scope='document'){
  assert.ok(await evaluate(`(()=>{const item=[...${scope}.querySelectorAll('button,a,.t-dropdown__item,.t-radio-button,.t-checkbox')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)});if(!item)return false;item.click();return true})()`),'找不到操作 '+text)
  await delay(160)
}
async function input(selector,value){
  await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('找不到输入框 '+${JSON.stringify(selector)});el.focus();const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await delay(90)
}
async function chooseProject(text){
  await evaluate('document.querySelector("[aria-label=新应用项目] .t-input").click()');await delay(180)
  await until(`[...document.querySelectorAll('.t-select-option')].some(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)})`)
  await evaluate(`[...document.querySelectorAll('.t-select-option')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)}).click()`);await delay(120)
}
async function go(path){await evaluate(`void document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`);await delay(650)}
async function open(mode='scratch'){
  await click('Create');await click(mode==='clone'?'Clone app / 克隆应用':'Custom app / 自定义应用')
  await until(`${drawer} && ![...${drawer}.querySelectorAll('.t-loading')].some(el=>el.checkVisibility({visibilityProperty:true}))`)
  await delay(160)
}
async function close(){await evaluate(`${drawer}.querySelector('.t-drawer__close-btn').click()`);await delay(200)}
async function selectSource(name){await evaluate(`document.querySelector(${JSON.stringify(`[aria-label="克隆 ${name}"]`)}).click()`);await until('!!document.querySelector(".ca__breadcrumb")')}
async function submit(){await click('创建应用',drawer)}
try{
  await browser.navigate('/apps');await until('document.querySelectorAll(".app-name").length===6')
  await open()
  check('创建采用 1024px 抽屉和 250px 方法侧栏',await evaluate('Math.abs(document.querySelector(".ca").getBoundingClientRect().width-1024)<=2&&Math.abs(document.querySelector(".ca__rail").getBoundingClientRect().width-250)<=1'))
  check('表单初始项目为空且不沿用旧名称',await evaluate(`!document.querySelector(${JSON.stringify(nameInput)}).value&&!document.querySelector('[aria-label="新应用项目"] input').value`))
  await submit()
  check('空提交逐字段显示项目和名称错误',await evaluate('document.querySelector(".ca-identity").textContent.includes("有效项目")&&document.querySelector(".ca-identity").textContent.includes("填写应用名称")'))
  await chooseProject('电商交易');await input(nameInput,'ab');await submit()
  check('不足三位名称有明确提示',await evaluate('document.querySelector(".ca-identity").textContent.includes("3–30")'))
  await input(nameInput,'a'.repeat(31));await submit()
  check('超过上游 30 位上限不能创建',await evaluate('!!document.querySelector(".ca__error[role=alert]")&&location.pathname==="/apps"'))
  await input(nameInput,'Invalid_Name');await submit()
  check('非法应用名字符就地校验',await evaluate('document.querySelector(".ca-identity").textContent.includes("小写字母开头")'))
  await input(nameInput,'checkout-api');await input(descInput,'x'.repeat(351));await submit()
  check('描述 350 位限制与字数展示',await evaluate('document.querySelector(".ca-identity").textContent.includes("描述不能超过 350")&&document.querySelector(".ca-identity").textContent.includes("351 / 350")'))
  await input(descInput,'round13 description')
  check('标签初始折叠',await evaluate('!document.querySelector(".application-tags").checkVisibility({visibilityProperty:true})'))
  await click('为应用添加标签')
  await input(tagValue(1),'platform');await click('为应用添加标签');await submit()
  check('无效标签提交自动展开并显示缺键错误',await evaluate('document.querySelector(".application-tags").checkVisibility({visibilityProperty:true})&&document.querySelector(".application-tags").textContent.includes("填写标签键")'))
  await input(tagKey(1),'team');await click('添加标签');await input(tagKey(2),'team');await input(tagValue(2),'another')
  await submit()
  check('重复标签键逐行校验',await evaluate('[...document.querySelectorAll(".application-tags [role=alert]")].filter(el=>el.textContent.includes("重复")).length===2'))
  await evaluate(`document.querySelector('[aria-label="删除标签 2"]').click()`)
  await evaluate('document.querySelector(".application-tags .t-checkbox input").click()')
  check('标签传播选项可操作且明确 Mock 边界',await evaluate('document.querySelector(".application-tags .t-checkbox input").checked&&document.querySelector(".application-tags").textContent.includes("尚未写入 Kubernetes")'))
  await submit();await until('document.querySelector(".ca__error[role=alert]")?.textContent.includes("同名")')
  check('同名冲突保留名称描述及标签草稿',await evaluate(`document.querySelector(${JSON.stringify(nameInput)}).value==='checkout-api'&&document.querySelector(${JSON.stringify(tagValue(1))}).value==='platform'`))
  await input(nameInput,'r13-source-app')
  await evaluate(`${drawer}.querySelector('.t-drawer__footer button').click();${drawer}.querySelector('.t-drawer__footer button').click()`)
  check('提交中阻止切换创建方式',await evaluate('document.querySelector(".ca__mode").disabled'))
  await until('location.pathname.endsWith("/config/git")')
  check('源码应用创建后进入 Git 配置',await until('document.querySelector(".app-head__name")?.textContent.includes("r13-source-app")'))
  const createdPath=await evaluate('location.pathname.slice(0,-11)')
  await go(createdPath+'/overview')
  check('创建标签和描述可在概览回读',await until('document.querySelector(".ov__tags")?.textContent.includes("team:platform")&&document.body.innerText.includes("round13 description")'))
  await go('/apps');await until('document.querySelectorAll(".app-name").length===7')
  check('重复提交只创建一个应用',await evaluate('[...document.querySelectorAll(".app-name")].filter(el=>el.textContent.includes("r13-source-app")).length===1'))
  await open('clone')
  await screenshot('01-clone-application-list')
  check('克隆先显示应用卡片而非源应用下拉框',await evaluate('document.querySelectorAll(".clone-card").length===7&&!document.querySelector(".ca-identity")'))
  await input('[aria-label="搜索克隆源应用"] input','CHECKOUT')
  check('克隆源搜索忽略大小写',await evaluate('document.querySelectorAll(".clone-card").length===1&&document.querySelector(".clone-card").textContent.includes("checkout-api")'))
  await input('[aria-label="搜索克隆源应用"] input','no-matching-application')
  check('克隆源搜索无匹配空态',await evaluate('document.querySelector(".clone-list__state").textContent.includes("没有匹配")'))
  await click('清空搜索')
  check('清空搜索恢复全部卡片',await evaluate('document.querySelectorAll(".clone-card").length===7'))
  await evaluate(`document.querySelector('[aria-label="克隆 checkout-api"]').focus()`)
  check('克隆卡片可通过键盘获得焦点',await evaluate('document.activeElement?.getAttribute("aria-label")==="克隆 checkout-api"'))
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'})
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  check('克隆卡片支持键盘 Enter 选择',await until('!!document.querySelector(".ca__breadcrumb")'))
  check('选择源应用进入带返回入口的信息页',await evaluate('document.querySelector(".ca__breadcrumb").textContent.includes("checkout-api")&&!!document.querySelector("[aria-label=返回克隆应用列表]")'))
  check('新应用名称不自动复用源应用名称',await evaluate(`document.querySelector(${JSON.stringify(nameInput)}).value===''`))
  await chooseProject('数据平台');await input(nameInput,'r13-cloned-app')
  await evaluate('document.querySelector("[aria-label=返回克隆应用列表]").click()');await delay(120)
  check('返回源应用列表保留卡片与创建页',await evaluate('!!document.querySelector(".clone-list")&&!document.querySelector(".ca-identity")'))
  await selectSource('checkout-api')
  check('重新选源保留新应用表单',await evaluate(`document.querySelector(${JSON.stringify(nameInput)}).value==='r13-cloned-app'`))
  await close()
  check('关闭有草稿时出现放弃确认',await until(`${dialog}?.textContent.includes('放弃未保存的应用信息')`))
  await click('继续编辑',dialog)
  check('继续编辑保留克隆来源与名称',await evaluate(`document.querySelector(${JSON.stringify(nameInput)}).value==='r13-cloned-app'&&document.querySelector('.ca__breadcrumb').textContent.includes('checkout-api')`))
  check('刷新事件受草稿保护',await evaluate('(()=>{const e=new Event("beforeunload",{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented})()'))
  await go('/clusters')
  check('路由离开触发草稿确认',await until(`${dialog}?.textContent.includes('放弃未保存的应用信息')`))
  await click('继续编辑',dialog)
  check('取消离开保持应用列表路由',await evaluate('location.pathname==="/apps"'))
  await submit();await until('location.pathname.endsWith("/config/git")')
  check('跨项目克隆导航到新项目配置',await until('location.pathname.includes("/projects/p-data/")&&document.querySelector(".app-head__name")?.textContent.includes("r13-cloned-app")'))
  check('克隆带入源仓库配置',await until('document.body.innerText.includes("checkout-api.git")'))
  await go('/apps');await open()
  check('重新打开清空名称描述标签及错误',await evaluate(`!document.querySelector(${JSON.stringify(nameInput)}).value&&!document.querySelector(${JSON.stringify(descInput)}).value&&!document.querySelector('.ca__error[role=alert]')&&!document.querySelector('.application-tags').checkVisibility({visibilityProperty:true})`))
  await input(nameInput,'discard-me');await close();await click('放弃修改',dialog)
  check('确认放弃关闭抽屉',await until(`!${drawer}`))
  await open('clone');await selectSource('storefront');await chooseProject('电商交易');await input(nameInput,'r13-image-clone')
  check('镜像克隆类型跟随源应用',await evaluate('document.querySelector(".ca__source-mode").textContent.includes("容器镜像（跟随源应用）")'))
  await submit();await until('location.pathname.endsWith("/config/base/deployment-template")')
  check('镜像克隆从部署模板开始配置',await until('document.querySelector(".app-head__name")?.textContent.includes("r13-image-clone")'))
  await go('/apps');await open()
  await click('查看创建说明')
  check('创建说明入口可打开',await until(`${dialog}?.textContent.includes('应用创建说明')`))
  await evaluate(`${dialog}.querySelector('.t-dialog__close').click()`);await delay(100)
  await chooseProject('电商交易');await input(nameInput,'r13-image-scratch');await click('容器镜像')
  check('镜像应用说明只有部署模板和工作流',await evaluate('document.querySelector(".ca__source-mode").textContent.includes("创建后配置部署模板与工作流")'))
  await submit();await until('location.pathname.endsWith("/config/base/deployment-template")')
  check('从零创建镜像应用导航正确',await until('document.querySelector(".app-head__name")?.textContent.includes("r13-image-scratch")'))
  await go('/apps')
  // A new image app opens an unsaved default deployment template; discard that
  // separate template draft explicitly before returning to the application list.
  if(await evaluate('location.pathname!=="/apps"'))await click('放弃修改并离开',dialog)
  await until('location.pathname==="/apps"&&!!document.querySelector(".app-row-actions")')
  await evaluate(`document.querySelector('[aria-label="checkout-api 更多操作"]').click()`);await click('克隆应用')
  check('行菜单克隆预选正确源应用',await until('document.querySelector(".ca__breadcrumb")?.textContent.includes("checkout-api")'))
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false})
  await click('为应用添加标签');for(let i=0;i<8;i++)await click('添加标签')
  check('1280px 表单内部滚动且保存栏固定',await evaluate('(()=>{const el=document.querySelector(".ca__form-scroll"),footer=document.querySelector(".ca__footer");el.scrollTop=el.scrollHeight;const r=footer.getBoundingClientRect();return el.scrollHeight>el.clientHeight&&el.scrollTop>0&&r.bottom<=innerHeight&&r.top>0})()'))
  check('1280px 抽屉没有横向溢出',await evaluate('document.documentElement.scrollWidth<=innerWidth&&document.querySelector(".ca__main").scrollWidth<=document.querySelector(".ca__main").clientWidth'))
  await screenshot('03-create-form-1280')
  await evaluate('document.querySelector("[aria-label=返回克隆应用列表]").click()');await delay(120)
  check('克隆卡片区独立滚动',await evaluate('(()=>{const el=document.querySelector(".clone-list__cards");el.scrollTop=el.scrollHeight;return el.scrollHeight>el.clientHeight&&el.scrollTop>0&&document.querySelector(".ca__rail").scrollTop===0})()'))
  await screenshot('04-clone-list-1280')
  await close();await click('放弃修改',dialog);await until(`!${drawer}`)
  await go('/projects/p-data');await until('document.body.innerText.includes("数据平台")')
  await click('新建应用');await until(`!!${drawer} && document.querySelector('[aria-label="新应用项目"] input')?.value==='数据平台'`)
  check('项目详情创建预选当前项目',await evaluate(`document.querySelector('[aria-label="新应用项目"] input').value==='数据平台'&&!document.querySelector(${JSON.stringify(nameInput)}).value`))
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  check('无草稿时 Escape 关闭抽屉',await until(`!${drawer}`))
  check('无运行时错误',browser.errors.length===0)
  check('无控制台警告',browser.warnings.length===0)
}catch(err){await screenshot('failure');console.error(await evaluate('({url:location.href,text:document.body.innerText.slice(-4000)})'));throw err}
finally{writeFileSync(resolve(output,'results.json'),JSON.stringify({checks,errors:browser.errors,warnings:browser.warnings},null,2));await browser.close()}
console.log(`Completed ${checks.length} application creation browser checks; screenshots: ${output}`)
