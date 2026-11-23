// 离线目录、模板异步状态和构建快照检查；不请求上游服务、不写入 Git、不执行构建。
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { effectScope, shallowRef, nextTick } from 'vue'
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
let count = 0
const check = (name, result) => { assert.ok(result, name); count++; console.log('PASS ' + name) }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const tick = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)) }
const scopes = []
try {
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const { useDockerfileTemplates } = await server.ssrLoadModule('/src/composables/useDockerfileTemplates.ts')
  const { buildDraft } = await server.ssrLoadModule('/src/types/build.ts')
  const { effectiveBuildConfig } = await server.ssrLoadModule('/src/utils/pipelineBuild.ts')
  const { normalizeBuildConfig } = await server.ssrLoadModule('/src/utils/buildOptions.ts')
  const { gitMaterialsOf } = await server.ssrLoadModule('/src/utils/gitMaterials.ts')
  const catalog = await api.listDockerfileTemplates()
  const node = catalog.find(item => item.id === 'node-basic')
  const go = catalog.find(item => item.id === 'go-basic')
  const python = catalog.find(item => item.id === 'python-basic')
  const express = catalog.find(item => item.id === 'node-express')
  check('离线样例含语言与框架，元数据不夹带正文', catalog.length === 8 && catalog.some(item => item.framework === 'FastAPI') && !('content' in catalog[0]))
  catalog[0].language = 'client mutation'
  check('模板目录返回独立副本', (await api.listDockerfileTemplates())[0].language === 'Node.js')
  const template = await api.getDockerfileTemplate(node.id)
  check('模板完整保留末尾换行', template.content.endsWith('\n') && template.content.includes('FROM node:'))
  template.content = 'client mutation'
  check('模板正文返回独立副本', (await api.getDockerfileTemplate(node.id)).content !== 'client mutation')
  await assert.rejects(api.getDockerfileTemplate('missing'), /模板/)
  count++; console.log('PASS 未知模板拒绝读取')
  const metadata = await api.listDockerfileTemplates()
  function harness(config, loader, readonly = false) {
    const scope = effectScope(); scopes.push(scope)
    const draft = shallowRef(buildDraft(config))
    const saved = shallowRef(config)
    const locked = shallowRef(readonly)
    let updates = 0
    const state = scope.run(() => useDockerfileTemplates({ draft: () => draft.value, saved: () => saved.value, readonly: () => locked.value, update: value => { updates++; draft.value = value } }, loader))
    return { state, draft, saved, locked, scope, updates: () => updates }
  }
  const saved = { ...buildDraft(null), buildMode: 'managed', dockerfileLanguage: node.language, dockerfileFramework: node.framework, dockerfileContent: '# saved custom\nFROM scratch\n' }
  const calls = []
  const pending = new Map()
  const loader = { list: async () => metadata, get: id => { calls.push(id); const request = deferred(); pending.set(id, request); return request.promise } }
  const h = harness(saved, loader)
  await tick()
  check('已保存模板作为初始正文与重置基线', h.draft.value.dockerfileContent === saved.dockerfileContent && !h.state.modified.value && calls.length === 0)
  h.draft.value = { ...h.draft.value, dockerfileContent: '# edited\n' }
  check('编辑仅改变草稿，已保存配置不变', h.state.modified.value && h.saved.value.dockerfileContent === saved.dockerfileContent)
  h.state.reset()
  check('重置恢复已保存原文', h.draft.value.dockerfileContent === saved.dockerfileContent && !h.state.modified.value)
  const goRequest = h.state.selectLanguage(go.language)
  check('选择语言立即显示首框架并阻止保存', h.state.selection.value.framework === go.framework && h.state.blocked.value)
  h.draft.value = { ...h.draft.value, context: 'src', gitMaterialId: 'second', buildArguments: [{ key: 'KEEP', value: 'concurrent' }] }
  const pythonRequest = h.state.selectLanguage(python.language)
  pending.get(python.id).resolve({ ...python, content: 'FROM python:mock\n' }); await pythonRequest; await tick()
  pending.get(go.id).resolve({ ...go, content: 'FROM go:late\n' }); await goRequest; await tick()
  check('快速切换只接受最后一次模板响应', h.draft.value.dockerfileLanguage === 'Python' && h.draft.value.dockerfileContent === 'FROM python:mock\n' && !h.state.blocked.value)
  check('模板响应保留等待期间仓库与上下文、参数更改', h.draft.value.gitMaterialId === 'second' && h.draft.value.context === 'src' && h.draft.value.buildArguments[0].value === 'concurrent')
  h.draft.value = { ...h.draft.value, dockerfileContent: '# unsaved python\n' }
  await h.state.select(node.language, node.framework); await tick()
  await h.state.select(python.language, python.framework); await tick()
  check('切回缓存模板恢复基线而非未保存修改', h.draft.value.dockerfileContent === 'FROM python:mock\n' && calls.filter(id => id === python.id).length === 1)
  const failing = h.state.select(express.language, express.framework)
  pending.get(express.id).reject(new Error('Mock template unavailable')); await failing
  check('读取失败保留当前内容并阻止保存', h.state.contentError.value && h.state.blocked.value && h.draft.value.dockerfileContent === 'FROM python:mock\n')
  h.state.restore(); await tick()
  check('返回当前内容恢复匹配的语言框架并解除阻塞', h.state.selection.value.language === python.language && !h.state.blocked.value && !h.state.contentError.value)
  const retry = h.state.select(express.language, express.framework)
  pending.get(express.id).resolve({ ...express, content: 'FROM express:mock\n' }); await retry; await tick()
  check('失败后的重试可加载模板', h.draft.value.dockerfileContent === 'FROM express:mock\n' && !h.state.contentError.value)
  const revoked = h.state.select(go.language, go.framework)
  h.locked.value = true; await tick()
  pending.get(go.id).resolve({ ...go, content: 'FROM go:revoked\n' }); await revoked
  check('转为只读会取消在途模板更新', h.draft.value.dockerfileContent === 'FROM express:mock\n' && !h.state.blocked.value)
  const before = h.updates(); await h.state.selectLanguage('Go'); h.state.reset()
  check('继承状态不能切换或重置', h.updates() === before)
  h.locked.value = false; await tick()
  const abandoned = h.state.select(go.language, go.framework)
  h.scope.stop(); pending.get(go.id).resolve({ ...go, content: 'FROM go:unmounted\n' }); await abandoned
  check('组件销毁后在途响应不会写回父表单', h.draft.value.dockerfileContent === 'FROM express:mock\n')
  const reload = harness(saved, { list: async () => metadata, get: api.getDockerfileTemplate }); await tick()
  reload.draft.value = { ...reload.draft.value, dockerfileContent: '# new saved\n' }
  reload.saved.value = { ...reload.draft.value }; await tick()
  reload.draft.value = { ...reload.draft.value, dockerfileContent: '# later edit' }; reload.state.reset()
  check('保存成功后更新重置基线', reload.draft.value.dockerfileContent === '# new saved\n')
  const legacy = harness({ ...saved, dockerfileLanguage: '', dockerfileFramework: '' }, { list: async () => metadata, get: () => { throw Error('must not fetch') } }); await tick()
  check('旧版自定义正文不被默认模板覆盖', legacy.draft.value.dockerfileContent === saved.dockerfileContent && legacy.state.selection.value.language === '')
  const unknown = harness({ ...saved, dockerfileLanguage: 'Archived', dockerfileFramework: 'Old' }, { list: async () => metadata, get: api.getDockerfileTemplate }); await tick()
  check('已下架模板仍展示保存的选项和正文', unknown.state.unavailable.value && unknown.state.languages.value.some(item => item.value === 'Archived') && !unknown.state.blocked.value)
  const empty = harness(null, { list: async () => [], get: api.getDockerfileTemplate }); await tick()
  check('空目录不产生错误或自动覆写', empty.draft.value.dockerfileContent === '' && !empty.state.blocked.value && !empty.state.contentError.value)
  const listFailed = harness(saved, { list: async () => { throw Error('catalog unavailable') }, get: api.getDockerfileTemplate }); await tick()
  check('目录失败保留现有内容且允许保存', listFailed.state.catalogError.value && !listFailed.state.blocked.value && listFailed.draft.value.dockerfileContent === saved.dockerfileContent)
  const first = harness(null, { list: async () => metadata, get: api.getDockerfileTemplate }); await new Promise(resolve => setTimeout(resolve, 250)); await tick()
  check('空白新配置自动选择首语言框架', first.draft.value.dockerfileLanguage === 'Node.js' && first.draft.value.dockerfileFramework === 'Node.js' && first.draft.value.dockerfileContent.includes('FROM node:'))
  const noTemplate = first.state.select('Missing', 'Missing'); await noTemplate
  check('失效目录选择明确报错并结束加载', first.state.contentError.value && !first.state.contentLoading.value && first.state.blocked.value)
  first.state.restore()
  let config = await api.getConfig('a-checkout')
  const text = '# comments and spacing\nFROM scratch\n\n# 尾部原文  \n'
  const materialId = gitMaterialsOf(config)[0].id
  const managed = { ...buildDraft(config.buildConfig), ...saved, registryId: config.buildConfig.registryId, imageRepository: config.buildConfig.imageRepository, gitMaterialId: materialId, contextGitMaterialId: materialId, dockerfile: 'docker/Own.Dockerfile', dockerfileContent: text }
  config = await api.saveConfig('a-checkout', { section: 'build', expectedVersion: config.version, buildConfig: managed })
  check('保存与归一化保留注释空行和末尾空白', config.buildConfig.dockerfileContent === text && normalizeBuildConfig(managed).dockerfileContent === text)
  check('自有 Dockerfile 路径仍保留在模式草稿', config.buildConfig.dockerfile === 'docker/Own.Dockerfile')
  let workflow = await api.getWorkflow('a-checkout')
  const original = workflow.items.find(item => item.kind === 'ci')
  const ci = { ...original, id: 'ci-managed-dockerfile', definition: { ...original.definition, materials: [{ gitMaterialId: materialId, type: 'branch', value: 'main' }] } }
  check('托管模式有效构建路径固定为根目录 Dockerfile', effectiveBuildConfig(config, { ...ci.definition, buildOverride: null }).dockerfile === 'Dockerfile')
  const override = { ...managed, dockerfileLanguage: 'Python', dockerfileFramework: 'FastAPI', dockerfileContent: '# pipeline only\nFROM python:mock\n' }
  workflow = await api.saveWorkflow('a-checkout', { version: workflow.version, items: [...workflow.items, { ...ci, definition: { ...ci.definition, buildOverride: override } }] }, config.version)
  const commit = (await api.listCommits('main', 'a-checkout', managed.gitMaterialId))[0]
  const build = await api.triggerBuild('a-checkout', commit.sha, config.version, ci.id, 'main', { workflowVersion: workflow.version, materials: [{ gitMaterialId: managed.gitMaterialId, branch: 'main', commitSha: commit.sha }] })
  check('触发冻结覆盖模板身份正文与根路径', build.buildConfigSnapshot.dockerfileLanguage === 'Python' && build.buildConfigSnapshot.dockerfileFramework === 'FastAPI' && build.buildConfigSnapshot.dockerfileContent === override.dockerfileContent && build.buildConfigSnapshot.dockerfile === 'Dockerfile')
  await api.cancelBuild(build.id)
  workflow = await api.saveWorkflow('a-checkout', { version: workflow.version, items: workflow.items.map(item => item.id === ci.id ? { ...item, definition: { ...item.definition, buildOverride: null } } : item) }, config.version)
  check('删除覆盖恢复应用内容，历史快照保留覆盖正文', effectiveBuildConfig(config, workflow.items.find(item => item.id === ci.id).definition).dockerfileContent === text && (await api.getBuild(build.id)).buildConfigSnapshot.dockerfileContent === override.dockerfileContent)
  const retryBuild = await api.retryBuild(build.id)
  check('重试沿用原始模板快照', JSON.stringify(retryBuild.buildConfigSnapshot) === JSON.stringify(build.buildConfigSnapshot))
  await api.cancelBuild(retryBuild.id)
  console.log(`Completed ${count} managed Dockerfile checks`)
} finally { scopes.forEach(scope => scope.stop()); await server.close() }
