// 部署模板的前端 Mock 验收；通过 UI 编辑和 SPA 导航保留本次浏览器会话。
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { parse } from 'yaml'
import { launchBrowser, delay } from './lib/browser.mjs'
import { codeMirrorDriver } from './lib/codemirror.mjs'

const baseURL = process.argv[2] || 'http://127.0.0.1:5181'
const output = resolve(import.meta.dirname, '../screenshots-deployment-template-parity')
const browser = await launchBrowser(baseURL, output)
const cm = codeMirrorDriver(browser)
const { evaluate, until, screenshot, call } = browser
const checks = []
const checkout = '/projects/p-shop/apps/a-checkout/config'
const payment = '/projects/p-shop/apps/a-payment/config'
const deployment = '/base/deployment-template'
const override = '/overrides/e-dev/deployment-template'
const editor = '.values-editor .cm-content'
const visible = '.getClientRects().length'
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function click(text, scope = 'document') {
  assert.ok(await evaluate(`(() => { const button = [...${scope}.querySelectorAll('button,a,.t-checkbox')].find((item) => item${visible} && item.textContent.trim() === ${JSON.stringify(text)}); if (!button) return false; button.click(); return true })()`), '找不到操作：' + text)
  await delay(180)
}
async function input(selector, value) {
  if (selector.includes('.cm-content')) return cm.write(selector, value)

  await evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}); if (!item) throw Error('找不到输入框：' + ${JSON.stringify(selector)}); const prototype = item instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(item, ${JSON.stringify(value)}); item.dispatchEvent(new Event('input', { bubbles: true })); item.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await delay(100)
}
async function go(path) {
  // 导航可能等待未保存确认，不能 await router.push 的返回 Promise。
  await evaluate(`void document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`)
  await delay(650)
}
async function choose(selector, text) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector('.t-input').click()`)
  await until(`Array.from(document.querySelectorAll('.t-select-option')).some((item) => item${visible} && item.textContent.trim() === ${JSON.stringify(text)})`)
  await evaluate(`Array.from(document.querySelectorAll('.t-select-option')).find((item) => item${visible} && item.textContent.trim() === ${JSON.stringify(text)}).click()`)
  await delay(150)
}
async function save() {
  await click('保存修改', 'document.querySelector(".dt__footer")')
  await until('document.querySelector(".dt__footer")?.textContent.includes("· 已保存")')
}
async function readValues() { return parse(await cm.read(editor)) }
async function discard() { await click('取消修改'); await click('放弃修改'); await delay(150) }

const baseYaml = '# 保留基础配置注释\nreplicaCount: 2\ncontainerPort: 8080\nhost: "checkout.acme.dev"\nenv:\n  KEEP: "inherited"\n  OVERRIDE: "base"\nresources:\n  requests:\n    cpu: "100m"\n    memory: "128Mi"\nextraPorts:\n  - 8081\n  - 8082\nmessage: |\n  hello: world\n  second line\n'
const patchYaml = '# 仅覆盖差异\nreplicaCount: 5\nenv:\n  OVERRIDE: "development"\nresources:\n  requests:\n    cpu: "250m"\nextraPorts:\n  - 9090\n'
try {
  await browser.navigate(checkout + deployment)
  await until('!!document.querySelector(".dt__footer")')
  check('基础配置使用单一保存修改按钮', await evaluate('document.querySelector(".dt__footer").textContent.includes("保存修改") && !document.querySelector(".dt").textContent.includes("保存并下一步")'))
  check('已保存的 Chart 类型锁定', await evaluate('document.querySelector(".dt__chart-kind input").disabled'))
  await input(editor, baseYaml)
  await save()
  await go(checkout + '/git')
  await go(checkout + deployment)
  check('基础 YAML 原文和注释保存回读', (await cm.read(editor)) === baseYaml)
  await screenshot('01-base-yaml')
  await click('GUI')
  await input('.deployment-form [aria-label="新变量名称"] input', 'GUI_KEY')
  await input('.deployment-form [aria-label="新变量值"] input', 'gui-value')
  await click('添加', 'document.querySelector(".deployment-form")')
  await click('YAML')
  let values = await readValues()
  check('GUI 修改保留嵌套字段、数组和块字符串', values.resources.requests.memory === '128Mi' && values.extraPorts.length === 2 && values.message === 'hello: world\nsecond line\n' && values.env.GUI_KEY === 'gui-value')
  check('GUI 修改保留原 YAML 注释', (await cm.read(editor)).includes('# 保留基础配置注释'))
  await save()

  await input(editor, 'replicaCount: 2\nreplicaCount: 3\n')
  check('重复 YAML key 禁止保存', await until('!!document.querySelector(".dt__validation") && [...document.querySelectorAll(".dt__footer button")].find((item) => item.textContent.includes("保存修改"))?.disabled'))
  await click('试运行')
  check('无效 YAML 的试运行显示解析错误', await until('!!document.querySelector(".dt__error") && !document.querySelector(".values-editor .cm-content")'))
  await click('返回配置')
  check('试运行往返保留无效草稿', (await cm.read(editor)).includes('replicaCount: 3'))
  await discard()
  await input(editor, 'replicaCount: 2\nenv:\n  BOOLEAN: true\n')
  check('环境变量类型校验', await until('document.querySelector(".dt__validation")?.textContent.includes("数字和布尔值请加引号")'))
  await discard()

  await go(checkout + override + '?headerTab=inherited')
  check('继承页只读且显示基础值', await until('(document.querySelector(".values-editor .cm-content")?.getAttribute("aria-readonly")==="true")') && (await cm.read(editor)).includes('replicaCount: 2'))
  check('继承页不混入环境覆盖', (await readValues()).replicaCount === 2)
  await screenshot('02-inherited-values')
  await click('覆盖')
  check('覆盖页仅编辑原始覆盖字段', (await cm.read(editor)).trim() === 'replicaCount: 1')
  await input(editor, patchYaml)
  await click('继承')
  await click('覆盖')
  check('继承与覆盖切换保留未保存草稿', (await cm.read(editor)) === patchYaml && await evaluate(`document.querySelector('.dt__footer').textContent.includes('未保存')`))
  await click('查看合并值')
  values = await readValues()
  check('Patch 深层继承未改字段', values.resources.requests.cpu === '250m' && values.resources.requests.memory === '128Mi' && values.env.KEEP === 'inherited' && values.env.OVERRIDE === 'development')
  check('Patch 数组整体替换', values.extraPorts.length === 1 && values.extraPorts[0] === 9090)
  check('合并预览只读', await evaluate('(document.querySelector(".values-editor .cm-content").getAttribute("aria-readonly")==="true")'))
  await screenshot('03-patch-merged-values')
  await choose('.dt__strategy', 'Replace · 替换完整配置')
  values = await readValues()
  check('Replace 不继承未填写字段', !values.host && !values.env.KEEP && !values.resources.requests.memory)
  await choose('.dt__strategy', 'Patch · 覆盖指定字段')
  await click('查看合并值')
  check('切换合并策略不改写原始草稿', (await cm.read(editor)) === patchYaml)
  await save()
  await go(checkout + '/git')
  await go(checkout + override)
  check('覆盖 YAML 原文保存回读', (await cm.read(editor)) === patchYaml)
  await click('试运行')
  values = await readValues()
  check('试运行使用合并后的当前副本数和环境变量', values.spec.replicas === 5 && values.spec.template.spec.containers[0].env.some((row) => row.name === 'KEEP' && row.value === 'inherited'))
  await click('返回配置')
  await screenshot('04-environment-override')

  await input(editor, 'replicaCount: 9\n')
  await go(checkout + '/git')
  check('离开未保存页面弹出确认', await until('[...document.querySelectorAll(".t-dialog")].some((item) => item.getClientRects().length && item.textContent.includes("配置有未保存修改"))'))
  await click('继续编辑')
  check('取消离开保留当前草稿和路由', await evaluate('location.pathname.endsWith("deployment-template")') && (await cm.read(editor)).includes('replicaCount: 9'))
  await go(checkout + '/git')
  await click('放弃修改并离开')
  await until('!!document.querySelector(".git-repository__summary")')
  await go(checkout + override)
  check('确认离开后重新打开恢复已保存覆盖', (await cm.read(editor)) === patchYaml)

  await choose('.dt__strategy', 'Replace · 替换完整配置')
  await save()
  await go(checkout + '/git')
  await go(checkout + override)
  check('Replace 策略保存后重新打开恢复选择', await until('document.querySelector(".dt__strategy input")?.value.includes("Replace")'))
  await click('查看合并值')
  check('保存后的 Replace 不继承基础配置', !(await readValues()).host)
  await click('查看合并值')
  await choose('.dt__strategy', 'Patch · 覆盖指定字段')
  await save()

  await go(checkout + deployment)
  await input(editor, baseYaml.replace('128Mi', '256Mi').replace('"inherited"', '"base-updated"'))
  await save()
  await go(checkout + override + '?headerTab=inherited')
  check('更新基础配置后继承页读取最新值', (await readValues()).resources.requests.memory === '256Mi')
  await click('覆盖')
  check('更新基础配置不把继承字段写入覆盖', (await cm.read(editor)) === patchYaml)
  await click('查看合并值')
  values = await readValues()
  check('Patch 随基础值更新且保留显式覆盖', values.resources.requests.memory === '256Mi' && values.env.KEEP === 'base-updated' && values.env.OVERRIDE === 'development')
  await click('查看合并值')

  await click('对比环境...')
  await until('document.querySelectorAll(".cmp__table tbody tr").length > 3')
  // 独立对比页默认选取历史版本；此断言明确选择基础配置的当前已保存值。
  await choose('[aria-label="对比目标环境"]', '基础配置（Base）')
  const row = await evaluate('[...document.querySelectorAll(".cmp__table tbody tr")].find((row) => row.textContent.includes("resources.requests.memory"))?.innerText')
  check('环境对比使用深层合并后的 Values', row?.includes('256Mi') && row.split('256Mi').length === 3)
  await click('关闭', 'document.querySelector(".cmp")')

  await click('删除覆盖')
  check('删除覆盖先确认', await until('[...document.querySelectorAll(".t-dialog")].some((item) => item.getClientRects().length && item.textContent.includes("恢复继承基础配置"))'))
  await click('取消', 'Array.from(document.querySelectorAll(".t-dialog")).find((item) => item.getClientRects().length && item.textContent.includes("删除环境覆盖"))')
  check('取消删除保留覆盖', await evaluate('document.querySelector(".dt__delete")?.textContent === "删除覆盖"'))
  await click('删除覆盖')
  await click('删除覆盖', 'Array.from(document.querySelectorAll(".t-dialog")).find((item) => item.getClientRects().length && item.textContent.includes("删除环境覆盖"))')
  check('删除覆盖恢复只读继承且保留环境绑定', await until('(document.querySelector(".values-editor .cm-content")?.getAttribute("aria-readonly")==="true") && document.querySelector(".dt__tab--active")?.textContent === "继承" && document.querySelector(".cfg__ctx-name")?.textContent === "开发环境"'))
  await click('不覆盖')
  check('无覆盖页显示创建和查看继承入口', await until('document.querySelector(".dt__empty")?.textContent.includes("创建覆盖") && document.querySelector(".dt__empty").textContent.includes("查看继承值")'))
  await screenshot('05-no-override')
  await click('创建覆盖', 'document.querySelector(".dt__empty")')
  check('新建覆盖默认 Patch 空对象', (await cm.read(editor)).trim() === '{}')
  await save()
  await go(checkout + '/git')
  await go(checkout + override)
  check('空对象覆盖保存后仍有独立覆盖状态', await until('!!document.querySelector(".dt__delete")') && (await cm.read(editor)).trim() === '{}')

  await go(payment + override)
  check('无覆盖环境默认打开只读继承', await until('(document.querySelector(".values-editor .cm-content")?.getAttribute("aria-readonly")==="true") && document.querySelector(".dt__tab--active")?.textContent === "继承"'))
  await click('创建覆盖', 'document.querySelector(".dt__metrics-note")')
  await input(editor, 'replicaCount: 8\n')
  await discard()
  check('取消新建覆盖恢复无覆盖空态', await until('!!document.querySelector(".dt__empty")'))
  await go(payment + '/overrides/not-bound/deployment-template')
  check('未绑定环境显示错误且不允许编辑', await until('document.querySelector(".cfg__content")?.textContent.includes("该环境尚未绑定") && !document.querySelector(".values-editor .cm-content")'))

  await go(checkout + deployment)
  const longYaml = baseYaml + Array.from({ length: 100 }, (_, i) => `extra_${i}: ${i}`).join('\n') + '\n'
  await input(editor, longYaml)
  await cm.scroll('.values-editor .cm-scroller', 500, 0)
  check('YAML 编辑器行号跟随滚动', await until('(()=>{const area=document.querySelector(".values-editor .cm-scroller");return area.scrollTop===500&&!!area.querySelector(".cm-lineNumbers .cm-gutterElement")&&document.querySelector(".dt__footer").getBoundingClientRect().bottom<=innerHeight+2})()'))
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await delay(300)
  check('1280px 部署模板无根页面横向溢出', await evaluate('document.documentElement.scrollWidth <= innerWidth'))
  check('1280px 长 YAML 编辑时保存栏仍可见', await evaluate('document.querySelector(".dt__footer").getBoundingClientRect().bottom <= innerHeight + 2'))
  await screenshot('06-base-1280-scroll')
  await discard()
  check('浏览器无运行时错误', browser.errors.length === 0)
  check('浏览器无控制台警告', browser.warnings.length === 0)
} catch (error) {
  await screenshot('failure-state')
  console.error(await evaluate('({ path: location.href, content: document.querySelector(".dt")?.innerText, dialogs: [...document.querySelectorAll(".t-dialog")].filter((item) => item.getClientRects().length).map((item) => item.innerText) })'))
  throw error
} finally {
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, errors: browser.errors, warnings: browser.warnings }, null, 2))
  await browser.close()
}
console.log(`Completed ${checks.length} deployment template checks`)
