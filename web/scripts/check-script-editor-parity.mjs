// Native Dockerfile/Shell interactions on production Mock pages; no editor internals.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'

const output = resolve(import.meta.dirname, '../screenshots-script-editor-parity')
const browser = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5182', output)
const { evaluate, until, call, screenshot } = browser
const cm = codeMirrorDriver(browser), checks = []
const app = '/projects/p-shop/apps/a-checkout'
const docker = '.dockerfile-editor .cm-content', script = '.task-script-editor .cm-content'
const dialog = '[...document.querySelectorAll(".t-dialog")].find(el=>el.checkVisibility({visibilityProperty:true}))'
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function tap(selector) { await until(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(200) }
async function click(text, scope = 'document') {
  const expression = `[...${scope}.querySelectorAll('button,a,.t-radio,.t-select-option')].find(el=>el.checkVisibility({visibilityProperty:true})&&el.textContent.trim()===${JSON.stringify(text)})`
  await until(`!!(${expression})`); await evaluate(`(${expression}).click()`); await delay(200)
}
async function input(selector, text) {
  await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`); await delay(120)
}
async function ready(scope) { await until(`!!document.querySelector(${JSON.stringify(scope + '[data-state=ready][aria-busy=false] .cm-content')})`); await delay(100) }
async function go(path) { await evaluate(`void document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`); await delay(650) }
async function choose(selector, label) { await tap(selector + ' .t-input'); await click(label); await ready('.dockerfile-editor') }
async function edit(env) {
  if (env) await evaluate(`[...document.querySelectorAll('.tnode__name')].find(el=>el.textContent.trim()===${JSON.stringify(env)}).closest('.tnode').click()`)
  else await tap('.tnode--clickable')
  await until('document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})&&!document.querySelector(".pe__footer button:last-child").disabled')
}
async function savePipeline() { await click('更新流水线', 'document.querySelector(".pe__footer")'); await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})') }
async function addShell(name) {
  await click('添加任务', 'document.querySelector(".stage-task-list")'); await tap('.stage-task-types button:first-child')
  await input('input[name=task-name]', name); await ready('.task-script-editor .script-code-editor')
}
async function selectTask(name) {
  await evaluate(`[...document.querySelectorAll('.stage-task__name')].find(el=>el.textContent.includes(${JSON.stringify(name)})).click()`)
  await ready('.task-script-editor .script-code-editor')
}
async function search(scope, marker) {
  await cm.focus(scope + ' .cm-content'); await cm.key('f', 'KeyF', 70, 2)
  await until(`document.activeElement?.matches(${JSON.stringify(scope + ' .cm-search input[name=search]')})`)
  await input(scope + ' .cm-search input[name=search]', marker); await cm.key('Enter', 'Enter', 13)
}
async function readonlyType(selector) {
  await cm.focus(selector)
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88, text: 'x' })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88 })
  await cm.key('Backspace', 'Backspace', 8); await cm.key('z', 'KeyZ', 90, 2)
}
async function capture(scope, name) {
  await cm.focus(scope + ' .cm-content'); await cm.key('Home', 'Home', 36, 2)
  await cm.scroll(scope + ' .cm-scroller', 0, 0)
  await evaluate(`document.querySelector(${JSON.stringify(scope)}).scrollIntoView({block:'center'});document.activeElement?.blur()`)
  await until('[...document.querySelectorAll(".t-message")].every(el=>!el.checkVisibility({visibilityProperty:true}))', 8000)
  await screenshot(name)
}
try {
  await browser.navigate(app + '/config/build'); await tap('.build-mode:nth-child(2)'); await ready('.dockerfile-editor')
  check('Dockerfile uses a native light editor without a textarea', await evaluate('!document.querySelector(".dockerfile-editor textarea")&&getComputedStyle(document.querySelector(".dockerfile-editor .cm-editor")).backgroundColor==="rgb(255, 255, 255)"'))
  const initial = await cm.read(docker)
  await cm.key('End', 'End', 35, 2); await cm.key('Tab', 'Tab', 9)
  check('Dockerfile Tab inserts two spaces', await cm.read(docker) === initial + '  ')
  await cm.key('z', 'KeyZ', 90, 2); check('Dockerfile undo restores the exact template', await cm.read(docker) === initial)
  await cm.key('y', 'KeyY', 89, 2); check('Dockerfile redo restores the edit', await cm.read(docker) === initial + '  ')
  await cm.key('z', 'KeyZ', 90, 2); await cm.key('Tab', 'Tab', 9, 8)
  check('Shift Tab leaves the editor', await evaluate(`document.activeElement!==document.querySelector(${JSON.stringify(docker)})`))
  const longDocker = '# exact docker comment  \nFROM alpine:3.21\n' + Array.from({ length: 1000 }, (_, i) => `RUN echo "docker_${i}_${'x'.repeat(180)}"`).join('\n') + '\n# docker_tail_marker\n'
  await cm.write(docker, longDocker)
  check('Full Dockerfile copy preserves offscreen content and whitespace', await cm.read(docker) === longDocker)
  check('Dockerfile viewport virtualizes a thousand lines', await evaluate('document.querySelectorAll(".dockerfile-editor .cm-line").length<300'))
  await search('.dockerfile-editor', 'docker_tail_marker')
  check('Find reaches the offscreen Dockerfile tail', await until('document.querySelector(".dockerfile-editor .cm-scroller").scrollTop>15000&&!!document.querySelector(".dockerfile-editor .cm-searchMatch-selected")'))
  await tap('.dockerfile-editor .cm-search [aria-label="展开或收起替换"]')
  await input('.dockerfile-editor .cm-search input[name=replace]', 'docker_replaced_marker'); await tap('.dockerfile-editor .cm-search button[name=replace]')
  check('Native replace updates the parent draft exactly', await cm.read(docker) === longDocker.replace('docker_tail_marker', 'docker_replaced_marker'))
  await cm.key('z', 'KeyZ', 90, 2); check('Undo restores a native search replacement', await cm.read(docker) === longDocker)
  await cm.key('Escape', 'Escape', 27); await cm.scroll('.dockerfile-editor .cm-scroller', 12000, 180)
  check('Dockerfile scrolls horizontally inside its viewport', await evaluate('document.querySelector(".dockerfile-editor .cm-scroller").scrollLeft>100'))
  await click('重置修改'); await ready('.dockerfile-editor'); await cm.focus(docker); await cm.key('z', 'KeyZ', 90, 2)
  check('Reset cannot undo into the discarded long Dockerfile', await cm.read(docker) === initial)
  await cm.write(docker, '# discarded template edit\n'); await choose('.managed-dockerfile__language .t-select', 'Go')
  const goTemplate = await cm.read(docker); await cm.key('z', 'KeyZ', 90, 2)
  check('Template switch isolates undo history', await cm.read(docker) === goTemplate && goTemplate.includes('FROM golang:'))
  const savedDocker = '# saved native Dockerfile  \nFROM alpine:3.21\n\nRUN echo native_save\n'
  await cm.write(docker, savedDocker); await click('保存配置'); await until('document.querySelector(".build-page__meta").textContent.trim()===""')
  await go(app + '/config/git'); await go(app + '/config/build'); await ready('.dockerfile-editor')
  check('Saved Dockerfile retains comments, blank lines and trailing newline', await cm.read(docker) === savedDocker)
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await capture('.dockerfile-editor', '01-dockerfile-native-1280')
  check('Dockerfile toolbar and body fit 1280px', await evaluate('document.documentElement.scrollWidth<=innerWidth&&document.querySelector(".managed-dockerfile__container").scrollWidth<=document.querySelector(".managed-dockerfile__container").clientWidth+1'))
  await go(app + '/config/workflow'); await click('新建工作流'); await click('仅源码构建只构建并推送镜像，不创建部署流水线。'); await click('创建工作流')
  await until('document.querySelectorAll(".wf").length===2'); await evaluate('document.querySelectorAll(".wf")[1].querySelector(".tnode--clickable").click()'); await ready('.dockerfile-editor')
  check('Inherited Dockerfile is native and readonly', await evaluate('document.querySelector(".dockerfile-editor .cm-content").getAttribute("aria-readonly")==="true"') && await cm.read(docker) === savedDocker)
  await readonlyType(docker); check('Readonly typing, delete and undo cannot modify inheritance', await cm.read(docker) === savedDocker)
  await tap('[aria-label="查找 Dockerfile"]'); await input('.dockerfile-editor .cm-search input[name=search]', 'native_save'); await cm.key('Enter', 'Enter', 13)
  check('Readonly inheritance remains searchable', await until('!!document.querySelector(".dockerfile-editor .cm-searchMatch-selected")'))
  check('Readonly search hides replacement controls', await evaluate('!document.querySelector(".dockerfile-editor .cm-search input[name=replace]")'))
  await cm.key('Escape', 'Escape', 27)
  check('Escape closes readonly search and keeps the pipeline drawer open', await evaluate('!document.querySelector(".dockerfile-editor .cm-search")&&document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})'))
  await click('允许覆盖'); await ready('.dockerfile-editor'); await cm.write(docker, '# override native edit\nFROM scratch\n')
  await click('删除覆盖'); await ready('.dockerfile-editor'); await readonlyType(docker)
  check('Deleting an override discards editable history', await cm.read(docker) === savedDocker)
  await click('允许覆盖'); await ready('.dockerfile-editor'); await cm.focus(docker); await cm.key('z', 'KeyZ', 90, 2)
  check('Reenabling override cannot restore discarded override text', await cm.read(docker) === savedDocker)
  await click('删除覆盖'); await savePipeline(); await edit(); await click('前置阶段'); await addShell('Native shell one')
  check('CI shell uses the native Shell language and 300px viewport', await evaluate('document.querySelector(".task-script-editor [data-language=shell]")?.getBoundingClientRect().height===300&&!document.querySelector(".task-execution textarea")'))
  const shellText = '#!/bin/sh\n# exact shell comment  \nexport NATIVE_VAR="before"\n\n' + Array.from({ length: 1000 }, (_, i) => `echo "shell_${i}_${'s'.repeat(180)}"`).join('\n') + '\necho shell_tail_marker\n'
  await cm.write(script, shellText); check('Shell copy preserves full script and shebang', await cm.read(script) === shellText)
  check('Shell syntax colors comments and variables', await evaluate('!!document.querySelector(".task-script-editor .cm-line span")'))
  await cm.key('End', 'End', 35, 2); await cm.key('Tab', 'Tab', 9)
  check('Shell indentation uses two spaces', await cm.read(script) === shellText + '  ')
  await cm.key('z', 'KeyZ', 90, 2); check('Shell undo retains exact whitespace', await cm.read(script) === shellText)
  await cm.key('y', 'KeyY', 89, 2); check('Shell redo restores inserted text', await cm.read(script) === shellText + '  ')
  await cm.key('z', 'KeyZ', 90, 2); await tap('[aria-label="查找任务脚本"]')
  check('Shell toolbar focuses native search', await until('document.activeElement?.matches(".task-script-editor .cm-search input[name=search]")'))
  await input('.task-script-editor .cm-search input[name=search]', 'shell_tail_marker'); await cm.key('Enter', 'Enter', 13)
  check('Shell search reaches the offscreen tail', await until('document.querySelector(".task-script-editor .cm-scroller").scrollTop>15000&&!!document.querySelector(".task-script-editor .cm-searchMatch-selected")'))
  await tap('.task-script-editor .cm-search [aria-label="展开或收起替换"]')
  await input('.task-script-editor .cm-search input[name=replace]', 'shell_saved_marker'); await tap('.task-script-editor .cm-search button[name=replace]')
  const savedShell = shellText.replace('shell_tail_marker', 'shell_saved_marker')
  check('Shell replacement emits the complete script to the form', await cm.read(script) === savedShell)
  await cm.key('Escape', 'Escape', 27)
  check('Escape closes Shell search without a discard dialog', await evaluate('!document.querySelector(".task-script-editor .cm-search")&&![...document.querySelectorAll(".t-dialog")].some(el=>el.checkVisibility({visibilityProperty:true}))'))
  await cm.scroll('.task-script-editor .cm-scroller', 12000, 180)
  check('Shell viewport virtualizes long scripts and scrolls both ways', await evaluate('document.querySelectorAll(".task-script-editor .cm-line").length<300&&document.querySelector(".task-script-editor .cm-scroller").scrollLeft>100'))
  await capture('.task-script-editor', '02-ci-shell-native-1280')
  check('Long script fits the task panel with a fixed footer', await evaluate('document.querySelector(".stage-task-detail").scrollWidth<=document.querySelector(".stage-task-detail").clientWidth+1&&document.querySelector(".pe__footer").getBoundingClientRect().bottom<=innerHeight'))
  await addShell('Native shell two'); const second = await cm.read(script)
  await cm.key('z', 'KeyZ', 90, 2); check('New task cannot undo into another task', await cm.read(script) === second && !second.includes('shell_saved_marker'))
  await cm.write(script, '   \n'); await click('更新流水线', 'document.querySelector(".pe__footer")')
  check('Blank native script is rejected and marked invalid', await until('document.querySelector(".task-script-editor .cm-content")?.getAttribute("aria-invalid")==="true"&&document.querySelector(".stage-task-detail>.t-alert")?.textContent.includes("脚本")'))
  await cm.focus(script); await cm.key('z', 'KeyZ', 90, 2)
  check('Validation preserves undo and clears after restoring script', await cm.read(script) === second && await evaluate('document.querySelector(".task-script-editor .cm-content").getAttribute("aria-invalid")==="false"'))
  await cm.write(script, '#!/bin/sh\necho second_task\n'); await selectTask('Native shell one')
  check('Switching tasks retains the first draft', await cm.read(script) === savedShell)
  await cm.key('z', 'KeyZ', 90, 2); check('Returning task starts an isolated undo history', await cm.read(script) === savedShell)
  await savePipeline(); await edit(); await click('前置阶段'); await selectTask('Native shell one')
  check('CI saves and reloads the complete long Shell script', await cm.read(script) === savedShell)
  await selectTask('Native shell two'); check('Second task saves its own script', await cm.read(script) === '#!/bin/sh\necho second_task\n')
  await click('Container', 'document.querySelector(".stage-fields")'); await input('input[name=task-image]', 'alpine:3.21'); await tap('[aria-label="Mount custom code"]'); await ready('.task-script-editor .script-code-editor')
  check('Container custom script uses the same native editor', await cm.read(script) === '#!/bin/sh\necho second_task\n')
  await cm.write(script, '#!/bin/sh\necho mounted_native\n'); await input('input[name=task-script-path]', '/tasks/native.sh')
  await tap('[aria-label="Mount custom code"]'); check('Disabling custom script removes its editor', await evaluate('!document.querySelector(".task-script-editor")'))
  await tap('[aria-label="Mount custom code"]'); await ready('.task-script-editor .script-code-editor'); await cm.focus(script); await cm.key('z', 'KeyZ', 90, 2)
  check('Reenabling mounted script retains content with isolated history', await cm.read(script) === '#!/bin/sh\necho mounted_native\n')
  await savePipeline(); await edit(); await click('前置阶段'); await selectTask('Native shell two')
  check('Container script and mount path save together', await cm.read(script) === '#!/bin/sh\necho mounted_native\n' && await evaluate('document.querySelector("input[name=task-script-path]").value==="/tasks/native.sh"'))
  await cm.write(script, '# unsaved native task\n'); await click('取消', 'document.querySelector(".pe__footer")'); await click('继续编辑', dialog)
  check('Native edits participate in pipeline draft protection', await cm.read(script) === '# unsaved native task\n')
  await click('取消', 'document.querySelector(".pe__footer")'); await click('放弃修改', dialog); await until('!document.querySelector(".pe")?.checkVisibility({visibilityProperty:true})')
  await edit(); await click('前置阶段'); await selectTask('Native shell two'); await cm.focus(script); await cm.key('z', 'KeyZ', 90, 2)
  check('Discarded native edits do not reappear after reopening', await cm.read(script) === '#!/bin/sh\necho mounted_native\n')
  await click('取消', 'document.querySelector(".pe__footer")'); await edit('预发布环境'); await click('前置阶段'); await addShell('Native CD pre')
  await cm.write(script, '#!/bin/sh\necho cd_pre_native\n'); await click('后置阶段'); await addShell('Native CD post'); await cm.write(script, '#!/bin/sh\necho cd_post_native\n')
  await savePipeline(); await edit('预发布环境'); await click('前置阶段'); await selectTask('Native CD pre')
  check('CD predeployment saves its native Shell script', await cm.read(script) === '#!/bin/sh\necho cd_pre_native\n')
  await click('后置阶段'); await selectTask('Native CD post'); await cm.key('z', 'KeyZ', 90, 2)
  check('CD postdeployment has independent script and history', await cm.read(script) === '#!/bin/sh\necho cd_post_native\n')
  await capture('.task-script-editor', '03-cd-shell-native-1280')
  check('No browser runtime errors', browser.errors.length === 0)
  check('No browser console warnings', browser.warnings.length === 0)
} catch (error) {
  await screenshot('failure'); console.error(await evaluate('({url:location.href,text:document.body.innerText.slice(-1800)})')); throw error
} finally {
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, errors: browser.errors, warnings: browser.warnings }, null, 2)); await browser.close()
}
console.log(`Completed ${checks.length} native script editor browser checks`)
