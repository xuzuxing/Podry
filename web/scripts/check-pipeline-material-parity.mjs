// 页面操作验证，多仓库、流水线覆盖及不可变历史；仅使用前端 Mock。
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'

const baseURL = process.argv[2] || 'http://127.0.0.1:5182'
const output = resolve(import.meta.dirname, '../screenshots-pipeline-material-parity')
const browser = await launchBrowser(baseURL, output)
const { evaluate, until, screenshot, call } = browser
const app = '/projects/p-shop/apps/a-checkout'
const checks = []
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function click(text, scope = 'document') {
  await until(`[...${scope}.querySelectorAll('button,a,.t-checkbox,.t-select-option')].some(item=>item.checkVisibility({visibilityProperty:true}) && item.textContent.trim()===${JSON.stringify(text)})`)
  assert.ok(await evaluate(`(() => { const item=[...${scope}.querySelectorAll('button,a,.t-checkbox,.t-select-option')].find(item=>item.getClientRects().length && item.textContent.trim()===${JSON.stringify(text)}); if(!item)return false;item.click();return true })()`), '找不到操作：' + text)
  await delay(220)
}
async function input(selector, value) {
  await evaluate(`(() => {const item=document.querySelector(${JSON.stringify(selector)});if(!item)throw Error('找不到输入框');const prototype=item instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(item,${JSON.stringify(value)});item.dispatchEvent(new Event('input',{bubbles:true}));item.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await delay(100)
}
async function choose(selector, label) {
  await evaluate(`(() => {const item=document.querySelector(${JSON.stringify(selector)});(item.querySelector('.t-input')??item).click()})()`)
  await delay(350)
  await until(`[...document.querySelectorAll('.t-select-option')].some(item=>item.getClientRects().length && item.textContent.trim()===${JSON.stringify(label)})`)
  await click(label)
  await delay(350)
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)})?.querySelector('input')?.value`), label)
}
async function go(path) {
  await evaluate(`void document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`)
  await delay(650)
}
async function editLastPipeline() {
  await evaluate(`(() => {const rows=document.querySelectorAll('.wf');rows[rows.length-1].querySelector('.tnode--clickable').click()})()`)
  await until('document.querySelectorAll(".pipeline-source").length===2 && !document.querySelector(".pe__footer button:last-child").disabled')
}
async function openMaterials() {
  await evaluate(`(() => {const rows=document.querySelectorAll('.wf');rows[rows.length-1].querySelector('.tnode__btn').click()})()`)
  await until('document.querySelectorAll(".build-repository").length===2 && !document.querySelector(".mt__state")')
  if (await evaluate('document.querySelector(".build-branch-form")?.checkVisibility({visibilityProperty:true})')) {
    const dialog = '[...document.querySelectorAll(".t-dialog")].find(item=>item.checkVisibility({visibilityProperty:true}))'
    if (await evaluate('document.querySelector(".build-branch-form").textContent.includes("^missing$")')) await click('取消', dialog)
    else {
      await input('.build-branch-form input', 'main')
      await click('读取提交', dialog)
      await until('!document.querySelector(".build-branch-form")?.checkVisibility({visibilityProperty:true}) && document.querySelectorAll(".cmt").length>0')
    }
  }
}
async function savePipeline() { await click('更新流水线'); await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})'); await delay(300) }
async function closeMaterials() { await evaluate('document.querySelector(".bd-material .t-drawer__close-btn").click()'); await delay(350) }

try {
  await browser.navigate(app + '/config/git')
  await until('document.querySelectorAll(".git-repository__summary").length===1')
  await click('添加 Git 仓库')
  await input('.git-form input[name="repositoryUrl"]','https://github.com/acme/web-assets.git')
  await click('设置克隆目录')
  await input('.git-form input[name="checkoutPath"]','./assets')
  await click('保存','document.querySelector(".git-form")')
  await until('document.querySelectorAll(".git-repository__summary").length===2')
  await go(app + '/config/workflow')
  await until('document.querySelectorAll(".wf").length===1')
  await click('新建工作流')
  await click('仅源码构建只构建并推送镜像，不创建部署流水线。')
  await click('创建工作流')
  await until('document.querySelectorAll(".wf").length===2')
  await editLastPipeline()
  check('每个 Git 仓库都有独立的代码源配置',await evaluate('document.querySelectorAll(".pipeline-source").length===2 && document.querySelector(".pipeline-sources").textContent.includes("web-assets")'))
  check('继承构建配置保持只读',await evaluate('document.querySelector("input[name=pipelineImageRepository]").disabled && [...document.querySelectorAll(".pipeline-override .build-mode")].every(item=>item.disabled)'))
  await choose('.pipeline-source:first-of-type .t-select','分支正则')
  await input('.pipeline-source:first-of-type input[placeholder="^feature/.*"]','[')
  await click('更新流水线')
  check('无效分支正则阻止保存',await until('document.querySelector(".pe")?.textContent.includes("分支正则表达式无效")'))
  await input('.pipeline-source:first-of-type input[placeholder="^feature/.*"]','^(main|release/1\\.x)$')
  await click('允许覆盖')
  check('启用覆盖后字段可编辑',await evaluate('!document.querySelector("input[name=pipelineImageRepository]").disabled'))
  await input('input[name="pipelineImageRepository"]','acme/preview')
  await choose('.pipeline-override .build-source-row .t-select','web-assets')
  await input('.pipeline-override input[name="dockerfile"]','../escape')
  await click('更新流水线')
  check('流水线覆盖复用相对路径校验',await until('document.querySelector(".pe")?.textContent.includes("请使用仓库内的相对路径")'))
  await input('.pipeline-override input[name="dockerfile"]','docker/Preview.Dockerfile')
  await evaluate('document.querySelector(".pipeline-override .build-advanced__toggle").click()')
  await click('添加参数')
  await input('.pipeline-override .build-argument input','VERSION')
  await input('.pipeline-override .build-argument > :nth-child(2) input','preview')
  await screenshot('01-pipeline-build-override')
  check('流水线更新按钮固定在可视区域',await evaluate('(() => {const rect=document.querySelector(".pe__footer").getBoundingClientRect();return rect.bottom<=innerHeight && rect.top>0})()'))
  await savePipeline()
  await editLastPipeline()
  check('分支正则保存回读',await evaluate('document.querySelector(".pipeline-source:first-of-type label:nth-child(2) input")?.value') === '^(main|release/1\\.x)$')
  check('构建覆盖与源码仓库保存回读',await evaluate('document.querySelector("input[name=pipelineImageRepository]").value==="acme/preview" && document.querySelector(".pipeline-override .build-source-row input").value==="web-assets"'))
  await evaluate('document.querySelector(".pipeline-override .build-advanced__toggle").click()')
  check('构建覆盖参数保存回读',await until('document.querySelector(".pipeline-override .build-argument input")?.value==="VERSION"'))
  await click('取消','document.querySelector(".pe__footer")')
  await evaluate('document.querySelector(".wf .tnode--clickable").click()')
  await until('document.querySelectorAll(".pipeline-source").length===2')
  check('其他 CI 保持独立继承配置',await evaluate('document.querySelector("input[name=pipelineImageRepository]").disabled && document.querySelector("input[name=pipelineImageRepository]").value!=="acme/preview"'))
  await click('取消','document.querySelector(".pe__footer")')

  await go(app + '/trigger')
  await until('document.querySelectorAll(".wf").length===2')
  check('构建画布按流水线显示仓库与多源数量',await evaluate('document.querySelectorAll(".wf")[1].textContent.includes("web-assets (+1)")'))
  await openMaterials()
  check('提交弹窗列出全部仓库及选择进度',await evaluate('document.querySelectorAll(".build-repository").length===2 && document.querySelector(".build-repositories__title").textContent.includes("0/2")'))
  check('未选齐所有仓库禁止构建',await evaluate('document.querySelector(".mt__foot button.t-button").disabled'))
  check('弹窗展示流水线有效构建覆盖',await evaluate('document.querySelector(".mt__build-config").textContent.includes("流水线构建覆盖") && document.querySelector(".mt__build-config").textContent.includes("acme/preview")'))
  await evaluate('document.querySelectorAll(".cmt")[1].click()')
  const firstSha = await evaluate('document.querySelector(".cmt--active .cmt__sha").textContent.trim()')
  await input('.mt__search input','优惠券')
  await evaluate('document.querySelectorAll(".build-repository__select")[1].click()')
  check('仓库切换使用独立提交与搜索状态',await until('document.querySelector(".mt__search input")?.value==="" && document.querySelector(".cmt__subject")?.textContent.includes("web-assets")'))
  check('固定分支只读',await evaluate('document.querySelector(".build-repository--active .t-select input").disabled'))
  await evaluate('document.querySelector(".cmt").click()')
  const secondSha = await evaluate('document.querySelector(".cmt--active .cmt__sha").textContent.trim()')
  await evaluate('document.querySelector(".build-repository--active .build-repository__updated button").click()')
  check('单仓库刷新保留有效提交及其他仓库选择',await until('!document.querySelector(".mt__state") && document.querySelector(".build-repositories__title").textContent.includes("2/2")'))
  await evaluate('document.querySelector(".build-repository__select").click()')
  check('返回仓库保留提交和搜索',await until('document.querySelector(".mt__search input")?.value==="优惠券" && document.querySelector(".cmt--active .cmt__sha")?.textContent.trim()==='+JSON.stringify(firstSha)))
  await input('.mt__search input','')
  await evaluate('document.querySelector(".mt__set-branch").click()')
  await input('.build-branch-form input', 'release/1.x')
  await click('读取提交', '[...document.querySelectorAll(".t-dialog")].find(item=>item.checkVisibility({visibilityProperty:true}))')
  check('变更正则分支清除当前选择并保留其他仓库',await until('!document.querySelector(".mt__state") && document.querySelector(".build-repositories__title").textContent.includes("1/2") && !document.querySelector(".cmt--active")'))
  check('切换分支读取独立提交列表',await evaluate('document.querySelector(".cmt__subject").textContent.includes("release/1.x")'))
  await evaluate('document.querySelector(".cmt").click()')
  const releaseSha = await evaluate('document.querySelector(".cmt--active .cmt__sha").textContent.trim()')
  check('全部选齐才允许开始构建',await until('!document.querySelector(".mt__foot button.t-button").disabled && document.querySelector(".mt__hint").textContent.includes("2/2")'))
  await screenshot('02-multi-repository-commits')
  await click('开始构建')
  await until('location.pathname.endsWith("/builds") && document.querySelectorAll(".bh-build").length===1')
  const pipeline = await evaluate('new URLSearchParams(location.search).get("pipeline")')
  const build = await evaluate('new URLSearchParams(location.search).get("build")')
  await click('源码')
  check('构建历史展示全部仓库的固定提交',await until('document.querySelectorAll(".build-source-card").length===2 && document.querySelector(".build-source-snapshot").textContent.includes('+JSON.stringify(releaseSha)+') && document.querySelector(".build-source-snapshot").textContent.includes('+JSON.stringify(secondSha)+')'))
  check('源码历史包含分支、作者与克隆目录',await evaluate('document.querySelector(".build-source-snapshot").textContent.includes("release/1.x") && document.querySelector(".build-source-snapshot").textContent.includes("./assets") && !document.querySelector(".build-source-snapshot").textContent.includes("作者未记录")'))
  await evaluate('document.querySelector(".build-config-snapshot summary").click()')
  check('构建配置历史记录覆盖及参数',await evaluate('document.querySelector(".build-config-snapshot pre").textContent.includes("acme/preview") && document.querySelector(".build-config-snapshot pre").textContent.includes("VERSION")'))
  await screenshot('03-build-source-snapshot')
  await click('取消','document.querySelector(".bh-actions")')
  await until('document.querySelector(".bh-timeline")?.textContent.includes("执行已中止")')

  await go(app + '/config/git')
  await evaluate('document.querySelectorAll(".git-repository__summary")[1].click()')
  await click('删除','document.querySelector(".git-form")')
  await click('删除','[...document.querySelectorAll(".t-dialog")].find(item=>item.getClientRects().length)')
  check('流水线覆盖使用中的仓库禁止删除',await until('document.body.textContent.includes("流水线构建覆盖")'))
  await click('取消','[...document.querySelectorAll(".t-dialog")].find(item=>item.getClientRects().length)')

  await go(app + '/config/workflow')
  await editLastPipeline()
  await input('.pipeline-source:first-of-type input[placeholder="^feature/.*"]','^missing$')
  await savePipeline()
  await go(app + '/trigger')
  await openMaterials()
  check('正则未设置具体分支显示修复空态',await until('document.querySelector(".mt__list").textContent.includes("尚未设置分支") && document.querySelectorAll(".cmt").length===0'))
  check('正则无匹配分支禁止构建',await evaluate('document.querySelector(".mt__foot button.t-button").disabled'))
  await screenshot('04-no-matching-branch')
  await closeMaterials()

  await go(app + '/config/workflow')
  await editLastPipeline()
  await input('.pipeline-source:first-of-type input[placeholder="^feature/.*"]','^(main|release/1\\.x)$')
  await click('删除覆盖')
  check('删除覆盖立即恢复只读继承值',await evaluate('document.querySelector("input[name=pipelineImageRepository]").disabled && document.querySelector("input[name=pipelineImageRepository]").value!=="acme/preview"'))
  await savePipeline()
  await editLastPipeline()
  check('删除覆盖保存后保持继承',await evaluate('document.querySelector("input[name=pipelineImageRepository]").disabled && document.querySelector(".pipeline-override__status").textContent.includes("继承")'))
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false})
  check('1280px 流水线编辑器无横向溢出且操作栏可见',await evaluate('document.documentElement.scrollWidth<=1280 && document.querySelector(".pe__footer").getBoundingClientRect().bottom<=800'))
  check('触发方式单选项垂直对齐',await evaluate('(() => {const items=[...document.querySelectorAll(".pe__radios .t-radio")];return items.length===2 && Math.abs(items[0].getBoundingClientRect().left-items[1].getBoundingClientRect().left)<1})()'))
  await screenshot('05-pipeline-editor-1280')
  await click('取消','document.querySelector(".pe__footer")')
  await go(app + '/builds?pipeline='+encodeURIComponent(pipeline)+'&build='+encodeURIComponent(build))
  await until('document.querySelectorAll(".bh-build").length===1')
  await click('源码')
  check('删除当前覆盖不改写历史构建配置',await until('document.querySelector(".build-config-snapshot pre")?.textContent.includes("acme/preview")'))
  await click('重试','document.querySelector(".bh-actions")')
  await until('document.querySelectorAll(".bh-build").length===2 && new URLSearchParams(location.search).get("build")!=='+JSON.stringify(build)+' && document.querySelector(".bh-actions button")?.disabled===false')
  await click('源码')
  check('重试保留所有原始仓库提交与构建配置',await until('document.querySelectorAll(".build-source-card").length===2 && document.querySelector(".build-source-snapshot").textContent.includes('+JSON.stringify(releaseSha)+') && document.querySelector(".build-source-snapshot").textContent.includes('+JSON.stringify(secondSha)+') && document.querySelector(".build-config-snapshot pre").textContent.includes("acme/preview")'))
  await screenshot('06-retry-snapshots-1280')
  check('浏览器无运行时错误',browser.errors.length===0)
  check('浏览器无控制台警告',browser.warnings.length===0)
} catch (err) {
  await screenshot('failure')
  console.error(await evaluate('({url:location.href,text:document.querySelector(".t-drawer__body")?.innerText?.slice(-2500),dialogs:[...document.querySelectorAll(".t-dialog")].filter(item=>item.getClientRects().length).map(item=>item.innerText)})'))
  throw err
} finally {
  writeFileSync(resolve(output,'results.json'),JSON.stringify({checks,errors:browser.errors,warnings:browser.warnings},null,2))
  await browser.close()
}
console.log(`Completed ${checks.length} pipeline material checks; screenshots: ${output}`)
