// 托管 Dockerfile 页面流程检查；前端 Mock，剪贴板在浏览器内拦截。
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'
const baseURL = process.argv[2] || 'http://127.0.0.1:5182'
const output = resolve(import.meta.dirname, '../screenshots-dockerfile-template-parity')
const browser = await launchBrowser(baseURL, output)
const { evaluate, until, screenshot, call } = browser
const checks = []
const check = (name, result) => { assert.ok(result, name); checks.push(name); console.log('PASS ' + name) }
const app = '/projects/p-shop/apps/a-checkout'
const cm = codeMirrorDriver(browser)
const editor = '.dockerfile-editor .cm-content'
const dialog = '[...document.querySelectorAll(".t-dialog")].find(item=>item.checkVisibility({visibilityProperty:true}))'
async function readEditor() {
  await until('!!document.querySelector(".dockerfile-editor[data-state=ready][aria-busy=false] .cm-content")')
  return cm.read(editor)
}
async function click(text, scope = 'document') {
  const expression = `[...${scope}.querySelectorAll('button,a,.t-select-option')].find(item=>item.checkVisibility({visibilityProperty:true})&&item.textContent.trim()===${JSON.stringify(text)})`
  await until(`!!(${expression})`); await evaluate(`${expression}.click()`); await delay(200)
}
async function input(selector, value) {
  if (selector === editor) return cm.write(selector, value)
  await evaluate(`(() => {const item=document.querySelector(${JSON.stringify(selector)});const prototype=item.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(item,${JSON.stringify(value)});item.dispatchEvent(new Event('input',{bubbles:true}));item.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await delay(100)
}
async function choose(selector, value) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector('.t-input').click()`)
  await delay(150); await click(value); await until(`(document.querySelector(${JSON.stringify(editor)})?.getAttribute('aria-readonly')==='true')===false`)
}
async function go(path) { await evaluate(`void document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`); await delay(700) }
async function capture(name, selector = '.managed-dockerfile') {
  if (selector) await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`)
  await until('[...document.querySelectorAll(".t-message")].every(item=>!item.checkVisibility({visibilityProperty:true}))', 8000)
  await screenshot(name)
}
async function saveApp() { await click('保存配置'); await until('document.querySelector(".build-page__meta").textContent.trim()===""') }
async function openPipeline(id) { await go(app+'/config/workflow?pipeline='+encodeURIComponent(id)); await until('!!document.querySelector(".pipeline-override")') }
async function savePipeline() { await click('更新流水线', 'document.querySelector(".pe__footer")'); await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})') }
try {
  await browser.navigate(app+'/config/build')
  await input('input[name="dockerfile"]', 'docker/Original.Dockerfile')
  await evaluate('document.querySelectorAll(".build-mode")[1].click()')
  await until(`!!document.querySelector(${JSON.stringify(editor)}) && ${JSON.stringify(await readEditor())}.includes('FROM node:') && !(document.querySelector(${JSON.stringify(editor)}).getAttribute('aria-readonly')==='true')`)
  check('托管模板工具栏合并仓库、语言、框架', await evaluate('document.querySelectorAll(".managed-dockerfile__toolbar .t-select").length===3 && !document.querySelector(".build-template")'))
  check('编辑器固定 300px 且带原生行号和语法着色', await evaluate('Math.round(document.querySelector(".dockerfile-editor").getBoundingClientRect().height)===300 && !!document.querySelector(".dockerfile-editor .cm-lineNumbers") && !!document.querySelector(".dockerfile-editor .cm-line span")'))
  check('初始内容无重置动作且标明根目录位置', await evaluate('!document.querySelector(".managed-dockerfile__actions").textContent.includes("重置修改") && document.querySelector(".managed-dockerfile__location code").textContent.endsWith("/Dockerfile")'))
  const nodeContent = await evaluate(`${JSON.stringify(await readEditor())}`)
  await input(editor, nodeContent+'# user edit\n')
  check('编辑内容后显示重置修改', await until('document.querySelector(".managed-dockerfile__actions").textContent.includes("重置修改")'))
  await click('重置修改')
  check('重置恢复模板原文与末尾换行', await evaluate(`${JSON.stringify(await readEditor())}===${JSON.stringify(nodeContent)}`))
  await choose('.managed-dockerfile__framework .t-select', 'Express')
  check('框架切换直接载入模板', await until(`${JSON.stringify(await readEditor())}.includes('# Express application')`))
  await input(editor, '# express unsaved\n')
  await choose('.managed-dockerfile__language .t-select', 'Python')
  check('语言切换联动第一个框架及内容', await evaluate(`document.querySelector('.managed-dockerfile__framework input').value==='Python' && ${JSON.stringify(await readEditor())}.includes('FROM python:')`))
  await choose('.managed-dockerfile__framework .t-select', 'FastAPI')
  check('Python 框架切换显示 FastAPI 正文', await until(`${JSON.stringify(await readEditor())}.includes('uvicorn')`))
  await choose('.managed-dockerfile__language .t-select', 'Node.js')
  await choose('.managed-dockerfile__framework .t-select', 'Express')
  check('切回缓存框架恢复模板基线', await evaluate(`${JSON.stringify(await readEditor())}.includes('# Express application') && !${JSON.stringify(await readEditor())}.includes('unsaved')`))
  await capture('01-template-toolbar-express')
  await evaluate(`Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.__copiedDockerfile=value}},configurable:true});document.querySelector('button[aria-label="复制 Dockerfile"]').click()`)
  check('复制完整 Dockerfile 原文', await until(`window.__copiedDockerfile===${JSON.stringify(await readEditor())}`))
  await evaluate(`navigator.clipboard.writeText=async()=>{throw Error('mock clipboard rejected')};document.querySelector('button[aria-label="复制 Dockerfile"]').click()`)
  check('复制失败有明确提示并保留内容', await until('document.body.textContent.includes("复制失败，请在编辑器中选择内容后复制")') && (await readEditor()).includes('# Express'))
  await evaluate(`(() => {const item=document.querySelector(${JSON.stringify(editor)});item.focus();})()`)
  await cm.key('Home', 'Home', 36, 2)
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  check('原生 Tab 为正文插入缩进且保留焦点', await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(editor)}) && ${JSON.stringify(await readEditor())}.startsWith('  # Express')`))
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 })
  check('Shift Tab 可离开代码编辑器', await evaluate(`document.activeElement!==document.querySelector(${JSON.stringify(editor)})`))
  const long = Array.from({length:90}, (_, i) => '# '+String(i+1)+' '+ 'dockerfile '.repeat(18)).join('\n')+'\n'
  await input(editor, long)
  await cm.scroll('.dockerfile-editor .cm-scroller', 700, 400)
  check('长文与行号在原生编辑区同步滚动', await until('document.querySelector(".dockerfile-editor .cm-scroller").scrollTop>=700 && document.querySelector(".dockerfile-editor .cm-scroller").scrollLeft>0'))
  await capture('02-editor-lines-scroll')
  await click('重置修改')
  await evaluate('document.querySelectorAll(".build-mode")[0].click()')
  check('切回已有 Dockerfile 保留原路径', await evaluate('document.querySelector("input[name=dockerfile]").value==="docker/Original.Dockerfile"'))
  await evaluate('document.querySelectorAll(".build-mode")[1].click()')
  await until(`(document.querySelector(${JSON.stringify(editor)})?.getAttribute('aria-readonly')==='true')===false`)
  check('重返托管模式保留语言框架与正文', await evaluate(`document.querySelector('.managed-dockerfile__framework input').value==='Express' && ${JSON.stringify(await readEditor())}.includes('# Express')`))
  const appContent = '# application custom\nFROM node:22-alpine\n\n# 保留注释和空白  \n'
  await input(editor, appContent); await saveApp()
  await go(app+'/config/git'); await go(app+'/config/build')
  check('应用保存回读保留模板身份与完整正文', await until(`${JSON.stringify(await readEditor())}===${JSON.stringify(appContent)} && document.querySelector('.managed-dockerfile__language input').value==='Node.js' && document.querySelector('.managed-dockerfile__framework input').value==='Express'`))
  check('回读保存内容作为重置基线', await evaluate('!document.querySelector(".managed-dockerfile__actions").textContent.includes("重置修改")'))
  await input(editor, '# after saved\n'); await click('重置修改')
  check('保存后再编辑重置回已保存自定义内容', await evaluate(`${JSON.stringify(await readEditor())}===${JSON.stringify(appContent)}`))
  await call('Emulation.setDeviceMetricsOverride', {width:1280,height:900,deviceScaleFactor:1,mobile:false})
  check('1280px 工具栏与固定编辑器无根页面横向溢出', await evaluate('document.documentElement.scrollWidth<=1280 && document.querySelector(".managed-dockerfile__toolbar").scrollWidth<=document.querySelector(".managed-dockerfile__toolbar").clientWidth+1 && document.querySelector(".build-page__foot").getBoundingClientRect().bottom<=900'))
  await capture('03-saved-custom-1280')
  await go(app+'/config/workflow')
  await click('新建工作流'); await click('仅源码构建只构建并推送镜像，不创建部署流水线。'); await click('创建工作流')
  await until('document.querySelectorAll(".wf").length===2')
  await evaluate('document.querySelectorAll(".wf")[1].querySelector(".tnode--clickable").click()')
  await until(`!!document.querySelector(${JSON.stringify(editor)})`)
  const pipelineId = await evaluate('document.querySelector(".pe__field input").value')
  check('继承模板显示只读值且隐藏复制和模板选择', await evaluate(`(document.querySelector(${JSON.stringify(editor)}).getAttribute('aria-readonly')==='true') && ${JSON.stringify(await readEditor())}===${JSON.stringify(appContent)} && document.querySelectorAll('.managed-dockerfile__toolbar .t-select').length===0 && !document.querySelector('button[aria-label="复制 Dockerfile"]') && document.querySelector('.managed-dockerfile__toolbar').textContent.includes('Express')`))
  await capture('04-inherited-template-1280')
  await click('允许覆盖')
  await until(`(document.querySelector(${JSON.stringify(editor)})?.getAttribute('aria-readonly')==='true')===false`)
  check('允许覆盖启用共用编辑器与工具栏', await evaluate('document.querySelectorAll(".managed-dockerfile__toolbar .t-select").length===3 && !!document.querySelector("button[aria-label=\\"复制 Dockerfile\\"]")'))
  await choose('.managed-dockerfile__language .t-select', 'Go')
  await input(editor, '# cancelled pipeline edit\n')
  await click('取消', 'document.querySelector(".pe__footer")')
  check('取消编辑显示草稿保护', await until(`${dialog}?.textContent.includes('放弃未保存的流水线修改')`))
  await click('继续编辑', dialog)
  check('继续编辑保留模板修改', await evaluate(`${JSON.stringify(await readEditor())}===${JSON.stringify('# cancelled pipeline edit\n')}`))
  await click('取消', 'document.querySelector(".pe__footer")'); await click('放弃修改', dialog)
  await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})')
  await openPipeline(pipelineId)
  check('放弃后重开保持应用继承', await evaluate(`(document.querySelector(${JSON.stringify(editor)}).getAttribute('aria-readonly')==='true') && ${JSON.stringify(await readEditor())}===${JSON.stringify(appContent)}`))
  await click('允许覆盖'); await choose('.managed-dockerfile__language .t-select', 'Go')
  const overrideContent = '# pipeline override\nFROM golang:1.24-alpine\n# only pipeline\n'
  await input(editor, overrideContent); await savePipeline(); await openPipeline(pipelineId)
  check('流水线覆盖保存回读身份与正文', await until(`${JSON.stringify(await readEditor())}===${JSON.stringify(overrideContent)} && document.querySelector('.managed-dockerfile__language input').value==='Go'`))
  await input(editor, '# after pipeline saved\n'); await click('重置修改')
  check('覆盖重置基线为已保存流水线内容', await evaluate(`${JSON.stringify(await readEditor())}===${JSON.stringify(overrideContent)}`))
  await capture('05-pipeline-template-override-1280')
  await click('删除覆盖')
  check('删除覆盖立即恢复应用模板与只读内容', await until(`(document.querySelector(${JSON.stringify(editor)})?.getAttribute('aria-readonly')==='true') && ${JSON.stringify(await readEditor())}===${JSON.stringify(appContent)} && document.querySelector('.managed-dockerfile__toolbar').textContent.includes('Express')`))
  await click('允许覆盖')
  check('再次允许覆盖从当前应用内容建立草稿', await until(`!(document.querySelector(${JSON.stringify(editor)}).getAttribute('aria-readonly')==='true') && ${JSON.stringify(await readEditor())}===${JSON.stringify(appContent)} && document.querySelector('.managed-dockerfile__language input').value==='Node.js'`))
  await click('删除覆盖'); await savePipeline(); await openPipeline(pipelineId)
  check('删除覆盖保存后继续继承应用模板', await evaluate(`(document.querySelector(${JSON.stringify(editor)}).getAttribute('aria-readonly')==='true') && ${JSON.stringify(await readEditor())}===${JSON.stringify(appContent)}`))
  check('1280px 流水线编辑区域及页脚完整可达', await evaluate('document.documentElement.scrollWidth<=1280 && document.querySelector(".pe__body").scrollWidth<=document.querySelector(".pe__body").clientWidth+1 && document.querySelector(".pe__footer").getBoundingClientRect().bottom<=900'))
  await click('取消','document.querySelector(".pe__footer")'); await go(app+'/config/build')
  check('流水线编辑未污染应用自定义模板', await until(`${JSON.stringify(await readEditor())}===${JSON.stringify(appContent)} && document.querySelector('.managed-dockerfile__framework input').value==='Express'`))
  await input(editor, '   \n')
  await click('保存配置')
  check('空白 Dockerfile 无法保存并就地提示', await until('document.querySelector(".managed-dockerfile__error")?.textContent.includes("请填写 Dockerfile 内容")'))
  await click('重置修改')
  check('浏览器无运行时错误', browser.errors.length===0)
  check('浏览器无控制台警告', browser.warnings.length===0)
} catch (error) {
  await screenshot('failure')
  console.error(await evaluate('({url:location.href,text:document.body.innerText.slice(-2400)})'))
  throw error
} finally {
  writeFileSync(resolve(output,'results.json'), JSON.stringify({checks,errors:browser.errors,warnings:browser.warnings}, null, 2))
  await browser.close()
}
console.log(`Completed ${checks.length} managed Dockerfile browser checks; screenshots: ${output}`)
