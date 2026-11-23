// Production-page interaction checks using frontend Mock data.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { parse } from 'yaml'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'
const baseURL = process.argv[2] || 'http://127.0.0.1:5182'
const output = resolve(import.meta.dirname, '../screenshots-config-data-parity')
const browser = await launchBrowser(baseURL, output)
const cm = codeMirrorDriver(browser)
const { evaluate, until, screenshot, call } = browser
const checks = []
const app = '/projects/p-shop/apps/a-checkout'
const editor = '.ce .values-editor .cm-content'
const dialog = '[...document.querySelectorAll(".t-dialog")].find(item=>item.checkVisibility({visibilityProperty:true}))'
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function click(text, scope = 'document') {
  assert.ok(await evaluate(`(()=>{const el=[...${scope}.querySelectorAll('button,a,.t-radio-button,.t-radio')].find(item=>item.checkVisibility({visibilityProperty:true})&&item.textContent.trim()===${JSON.stringify(text)});if(!el)return false;el.click();return true})()`), '找不到操作 ' + text)
  await delay(160)
}
async function input(selector, value) {
  if (selector.includes('.cm-content')) return cm.write(selector, value)

  await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('找不到输入框 '+${JSON.stringify(selector)});el.focus();Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await delay(100)
}
async function go(path) { await evaluate(`void document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`); await delay(650) }
async function save() { await click('保存修改', 'document.querySelector(".ce__footer")'); await until('document.querySelector(".ce__footer")?.textContent.includes("· 已保存")') }
async function mode(value) { await click(value, 'document.querySelector(".config-data-editor")') }
async function yamlValue() { return cm.read(editor) }
async function keys() { return evaluate('[...document.querySelectorAll(".key-cell input")].map(el=>el.value)') }
async function rowId(key) { return evaluate(`[...document.querySelectorAll('.entry-form__pair[data-row-id]')].find(el=>el.querySelector('input').value===${JSON.stringify(key)})?.dataset.rowId`) }
const keyInput = id => `.entry-form__pair[data-row-id="${id}"] input`
const valueInput = id => `.entry-form__pair[data-row-id="${id}"] textarea`
const disabledSave = '[...document.querySelectorAll(".ce__footer button")].find(el=>el.textContent.includes("保存修改")).disabled'
try {
  await browser.navigate(app + '/config/base/configmaps')
  await until('!!document.querySelector(".key-cell input")')
  check('GUI 键名可编辑', await evaluate('!document.querySelector(".key-cell input").readOnly'))
  const initialKeys = await keys()
  await evaluate('document.querySelector(".key-sort").click()')
  check('键排序改变显示顺序', (await keys()).join() !== initialKeys.join())
  check('排序不产生未保存修改', await evaluate('document.querySelector(".ce__footer").textContent.includes("· 已保存")'))
  await mode('YAML')
  const original = await yamlValue()
  await mode('GUI'); await mode('YAML')
  check('模式切换保留原文且不产生修改', (await yamlValue()) === original && await evaluate('document.querySelector(".ce__footer").textContent.includes("· 已保存")'))
  await input(editor, '# round12 comment\nZ: z # inline comment\nA: |\n  first\n  second\n"10": ten\n"2": two\n')
  await save(); await mode('GUI')
  const zid = await rowId('Z')
  await input(keyInput(zid), 'A')
  check('重复键保留两个输入行', (await keys()).filter(key => key === 'A').length === 2)
  check('重复键逐行显示错误', await evaluate('[...document.querySelectorAll(".key-cell [role=alert]")].filter(el=>el.textContent.includes("重复")).length===2'))
  check('重复键禁止保存', await evaluate(disabledSave))
  await mode('YAML')
  check('重复键阻止模式切换并提示', await evaluate('!!document.querySelector(".key-cell")&&!document.querySelector(".ce .values-editor .cm-content")&&document.querySelector(".data-error").textContent.includes("修正")'))
  await go(app + '/config/git')
  check('无效键草稿同样受离开保护', await until(`${dialog}?.textContent.includes('放弃未保存修改')`))
  await click('继续编辑', dialog)
  check('继续编辑保留重复键和值', (await keys()).filter(key => key === 'A').length === 2 && await evaluate(`document.querySelector(${JSON.stringify(valueInput(zid))}).value==='z'`))
  await input(keyInput(zid), 'B')
  check('修复键名保留同一 DOM 输入框焦点', await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(keyInput(zid))})`))
  check('修复重复键恢复保存', !(await evaluate(disabledSave)))
  await input(keyInput(zid), 'bad key')
  check('非法字符原样留在输入框并校验', await evaluate(`document.querySelector(${JSON.stringify(keyInput(zid))}).value==='bad key'`) && await evaluate(disabledSave))
  await input(keyInput(zid), 'B')
  await click('添加键')
  const blankId = await rowId('')
  check('新增空行置顶并禁用保存', (await keys())[0] === '' && await evaluate(disabledSave))
  await mode('YAML')
  check('空键同样阻止模式切换', await evaluate('!document.querySelector(".ce .values-editor .cm-content")'))
  await input(keyInput(blankId), 'NEW_KEY'); await input(valueInput(blankId), 'new value')
  const aid = await rowId('A')
  await input(valueInput(aid), 'first\nsecond\nthird\n')
  await save(); await go(app + '/config/git'); await go(app + '/config/base/configmaps'); await mode('YAML')
  let yaml = await yamlValue(), data = parse(yaml)
  check('GUI 改名保存后读回正确值', data.B === 'z' && !('Z' in data))
  check('GUI 新增键保存后读回', data.NEW_KEY === 'new value')
  check('GUI 编辑保留多行值和块格式', data.A === 'first\nsecond\nthird\n' && yaml.includes('A: |'))
  check('GUI 编辑保留文件和行内注释', yaml.includes('# round12 comment') && yaml.includes('# inline comment'))
  // Observe the exact clipboard payload and error UI without changing the OS clipboard.
  await evaluate('window.__clipboard=[];Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async value=>window.__clipboard.push(value)}})')
  await click('复制', 'document.querySelector(".yaml-toolbar")')
  check('YAML 复制包含完整原文', (await evaluate('window.__clipboard.at(-1)')) === await yamlValue())
  check('复制成功有状态反馈', await evaluate('document.querySelector(".clipboard-status").textContent.includes("已复制 YAML")'))
  await evaluate('navigator.clipboard.writeText=async()=>{throw Error("denied")}')
  await click('复制', 'document.querySelector(".yaml-toolbar")')
  check('剪贴板失败有可见反馈', await evaluate('document.querySelector(".clipboard-status").textContent.includes("复制失败")'))
  await input(editor, 'A: true\n'); await mode('GUI')
  check('YAML 非字符串值阻止切回 GUI', await evaluate('!!document.querySelector(".ce .values-editor .cm-content")&&!!document.querySelector(".data-error")'))
  await input(editor, 'A: [\n'); await mode('GUI')
  check('YAML 语法错误保留编辑器修正', (await yamlValue()).includes('A: [') && await evaluate(disabledSave))
  await click('取消修改'); await click('放弃修改', dialog)
  await mode('GUI')
  check('取消恢复保存数据并清除错误', (await keys()).includes('NEW_KEY') && !await evaluate('!!document.querySelector(".data-error")'))
  await evaluate(`document.querySelector('button[aria-label="删除键 NEW_KEY"]').click()`)
  check('GUI 删除移除指定键并产生草稿', !(await keys()).includes('NEW_KEY') && await evaluate('document.querySelector(".ce__footer").textContent.includes("有未保存修改")'))
  await click('取消修改'); await click('放弃修改', dialog)
  check('取消删除恢复原键和值', (await keys()).includes('NEW_KEY'))
  await click('数据卷', 'document.querySelector(".entry-form")')
  check('数据卷表头显示文件名与文件内容', await evaluate('document.querySelector(".entry-form__pair--head").textContent.includes("File Name")&&document.querySelector(".entry-form__pair--head").textContent.includes("File Content")'))
  await click('取消修改'); await click('放弃修改', dialog)
  await mode('YAML'); await input(editor, 'BASE: &base one\nCOPY: *base\n'); await mode('GUI')
  await evaluate(`document.querySelector('button[aria-label="删除键 BASE"]').click()`)
  check('GUI 删除仍被引用的锚点有明确提示且保留数据', (await keys()).length === 2 && await evaluate('document.querySelector(".entry-form__pairs").textContent.includes("别名引用")'))
  await click('取消修改'); await click('放弃修改', dialog)
  await screenshot('01-editable-configmap')
  await go(app + '/config/overrides/e-dev/configmaps?headerTab=inherited')
  check('继承 GUI 全部只读且没有添加', await until('!!document.querySelector(".key-cell input")&&[...document.querySelectorAll(".key-cell input")].every(el=>el.readOnly)&&!document.querySelector(".entry-form__add")'))
  await click('覆盖', 'document.querySelector(".ce__tabs")')
  check('Patch 来源挂载仍锁定但数据键可编辑', await until('!!document.querySelector(".key-cell input")&&!document.querySelector(".key-cell input").readOnly&&document.querySelector("[aria-label=配置来源] input").disabled'))
  const overrideId = await rowId('LOG_LEVEL')
  await input(keyInput(overrideId), 'ENV_KEY'); await save()
  await click('查看合并值')
  check('合并 GUI 保留基础键和新覆盖键并只读', (await keys()).includes('NEW_KEY') && (await keys()).includes('ENV_KEY') && await evaluate('[...document.querySelectorAll(".key-cell input")].every(el=>el.readOnly)'))
  await go(app + '/config/base/secrets')
  await until('!!document.querySelector(".config-data-editor")')
  check('Secret 默认遮蔽且键只读', await evaluate('document.querySelector(".key-cell input").readOnly&&[...document.querySelectorAll(".entry-form__pair textarea")].every(el=>el.value==="••••••"&&el.readOnly)'))
  check('Secret 遮蔽时不显示添加按钮', await evaluate('!document.querySelector(".entry-form__add")'))
  await click('显示/编辑值')
  check('显示只解锁草稿编辑而不伪造旧值', await evaluate('!document.querySelector(".key-cell input").readOnly&&document.querySelector(".entry-form__pair textarea").value==="••••••"'))
  await mode('YAML'); await input(editor, '# do-not-copy-comment\nTOKEN: draft-private-value\n')
  await click('隐藏值')
  check('Secret 隐藏 YAML 遮蔽值且只读', !(await yamlValue()).includes('draft-private-value') && !(await yamlValue()).includes('do-not-copy-comment') && await evaluate('(document.querySelector(".ce .values-editor .cm-content").getAttribute("aria-readonly")==="true")'))
  await evaluate('window.__clipboard=[];navigator.clipboard.writeText=async value=>window.__clipboard.push(value)')
  await click('复制', 'document.querySelector(".yaml-toolbar")')
  check('隐藏 Secret 复制也不包含明文和注释', await evaluate('!window.__clipboard.at(-1).includes("draft-private-value")&&!window.__clipboard.at(-1).includes("do-not-copy-comment")&&window.__clipboard.at(-1).includes("TOKEN")'))
  await click('显示/编辑值')
  check('显隐不修改草稿原文', (await yamlValue()).includes('draft-private-value') && (await yamlValue()).includes('# do-not-copy-comment'))
  await click('试运行', 'document.querySelector(".ce__tabs")')
  check('Secret 草稿试运行也遮蔽临时值', !(await yamlValue()).includes('draft-private-value') && (await yamlValue()).includes('TOKEN'))
  await click('返回配置')
  check('返回配置重新锁定 Secret 显示状态', await evaluate('(document.querySelector(".ce .values-editor .cm-content").getAttribute("aria-readonly")==="true")'))
  await click('显示/编辑值')
  check('切换预览保留临时 Secret 草稿供继续编辑', (await yamlValue()).includes('draft-private-value'))
  await mode('GUI'); const tokenId = await rowId('TOKEN')
  check('临时 Secret GUI 值与 YAML 一致', await evaluate(`document.querySelector(${JSON.stringify(valueInput(tokenId))}).value==='draft-private-value'`))
  await click('隐藏值')
  check('隐藏 GUI 同时锁定修改和删除', await evaluate('document.querySelector(".entry-form__pair textarea").value==="••••••"&&!document.querySelector(".entry-form__pair button[aria-label^=删除键]")'))
  await click('显示/编辑值'); await save()
  check('保存 Secret 后自动重新遮蔽', await evaluate('document.querySelector(".entry-form__pair textarea").value==="••••••"&&document.querySelector(".key-cell input").readOnly'))
  await click('显示/编辑值'); await mode('YAML')
  check('Secret 保存只回读键不回读临时值', (await yamlValue()).includes('TOKEN') && !(await yamlValue()).includes('draft-private-value'))
  await input(editor, 'TOKEN: [hidden-private-error\n'); await click('隐藏值')
  check('隐藏无效 Secret 不泄漏解析错误中的值', await evaluate('!document.body.innerText.includes("hidden-private-error")') && !(await yamlValue()).includes('hidden-private-error'))
  await click('取消修改'); await click('放弃修改', dialog)
  check('取消 Secret 恢复遮蔽只读', await evaluate('(document.querySelector(".ce .values-editor .cm-content").getAttribute("aria-readonly")==="true")'))
  await screenshot('02-secret-hidden-yaml')
  await go(app + '/config/base/configmaps'); await mode('GUI')
  await call('Emulation.setDeviceMetricsOverride', {width:1280,height:800,deviceScaleFactor:1,mobile:false})
  check('1280px 表格没有根页面横向溢出', await evaluate('document.documentElement.scrollWidth<=innerWidth'))
  check('1280px 保存栏仍可见', await evaluate('(()=>{const r=document.querySelector(".ce__footer").getBoundingClientRect();return r.bottom<=innerHeight+1&&r.top>0})()'))
  await screenshot('03-configmap-1280')
  check('无运行时错误', browser.errors.length === 0)
  check('无控制台警告', browser.warnings.length === 0)
} catch (err) {
  await screenshot('failure')
  console.error(await evaluate('({url:location.href,text:document.body.innerText.slice(-3500)})'))
  throw err
} finally {
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({checks,errors:browser.errors,warnings:browser.warnings}, null, 2))
  await browser.close()
}
console.log(`Completed ${checks.length} config data browser checks; screenshots: ${output}`)
