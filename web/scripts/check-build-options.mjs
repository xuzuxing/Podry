// 离线构建选项与快照契约；不拉取 Builder、不读取凭据、不执行构建。
import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
let count = 0
const check = (name, result) => { assert.ok(result, name); count++; console.log('PASS ' + name) }
const rejects = async (name, promise, pattern) => { await assert.rejects(promise, pattern); count++; console.log('PASS ' + name) }
try {
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const { buildDraft } = await server.ssrLoadModule('/src/types/build.ts')
  const { platformsOf, customPlatformsOf, normalizeBuildConfig } = await server.ssrLoadModule('/src/utils/buildOptions.ts')
  const { validateBuildConfig, effectiveBuildConfig } = await server.ssrLoadModule('/src/utils/pipelineBuild.ts')
  const { updateBuildpack } = await server.ssrLoadModule('/src/utils/buildpackOptions.ts')
  const { gitMaterialsOf } = await server.ssrLoadModule('/src/utils/gitMaterials.ts')
  const appId = 'a-checkout'
  let config = await api.getConfig(appId)
  const materials = gitMaterialsOf(config)
  const reference = { type: 'BUILD_INFRA', id: 'npmrc', secretName: 'build-npm', key: '.npmrc' }
  const ssh = { type: 'SOURCE_CODE', id: 'default', secretName: 'build-git', key: 'ssh-privatekey' }
  const draft = { ...buildDraft(config.buildConfig, materials[0].id), platform: 'linux/arm64,linux/amd64,linux/arm/v7', buildSecrets: [reference], buildSSH: [ssh], buildArguments: [{ key: 'VERSION', value: 'preview' }] }
  const validate = change => validateBuildConfig({ ...draft, ...change }, materials)
  check('新配置默认跟随构建节点', buildDraft(null).platform === '')
  check('平台支持多选并去重保序', platformsOf(' linux/arm64,linux/amd64,linux/arm64 ').join(',') === 'linux/arm64,linux/amd64')
  check('三个预设均无需自定义确认', customPlatformsOf(draft).length === 0)
  check('识别自定义平台与去重', customPlatformsOf({ ...draft, platform: 'linux/riscv64,linux/amd64,linux/riscv64' }).join(',') === 'linux/riscv64')
  check('空平台与合法自定义平台可保存', !validate({ platform: '' }).platform && !validate({ platform: 'linux/riscv64' }).platform)
  check('平台空项与内部空白拒绝', !!validate({ platform: 'linux/amd64,' }).platform && !!validate({ platform: 'linux /arm64' }).platform)
  check('有效引用通过同一校验', Object.keys(validate({})).length === 0)
  check('Secret 必填项校验', !!validate({ buildSecrets: [{ ...reference, key: '' }] }).buildSecrets)
  check('SSH 必填项校验', !!validate({ buildSSH: [{ ...ssh, secretName: '' }] }).buildSSH)
  check('非法来源与 ID 拒绝', !!validate({ buildSecrets: [{ ...reference, type: 'unknown' }] }).buildSecrets && !!validate({ buildSSH: [{ ...ssh, id: 'a b' }] }).buildSSH)
  check('同组引用 ID 去空格后不能重复', !!validate({ buildSecrets: [reference, { ...reference, id: ' npmrc ' }] }).buildSecrets)
  check('Secrets 与 SSH 可各自使用同一 ID', !validate({ buildSSH: [{ ...ssh, id: reference.id }] }).buildSSH)
  const copied = buildDraft(draft)
  copied.buildSecrets[0].key = 'client-mutation'
  copied.buildSSH[0].id = 'client-mutation'
  copied.buildArguments[0].value = 'client-mutation'
  check('表单与保存配置的嵌套数组隔离', draft.buildSecrets[0].key === '.npmrc' && draft.buildSSH[0].id === 'default' && draft.buildArguments[0].value === 'preview')
  const version = config.version
  await rejects('应用保存执行相同引用校验', api.saveConfig(appId, { section: 'build', expectedVersion: version, buildConfig: { ...draft, buildSecrets: [{ ...reference, key: '' }] } }), /构建 Secrets/)
  check('无效保存不递增应用版本', (await api.getConfig(appId)).version === version)
  await rejects('应用保存拒绝不存在的镜像仓库', api.saveConfig(appId, { section: 'build', expectedVersion: version, buildConfig: { ...draft, registryId: 'missing' } }), /镜像仓库不存在/)
  const dirty = { ...draft, platform: ' linux/amd64,linux/amd64,linux/riscv64 ', buildSecrets: [{ ...reference, secretName: ' build-npm ', rawValue: 'never-persist' }], buildSSH: [{ ...ssh, privateKey: 'never-persist' }] }
  config = await api.saveConfig(appId, { section: 'build', expectedVersion: version, buildConfig: dirty })
  check('保存归一化平台和引用名称', config.buildConfig.platform === 'linux/amd64,linux/riscv64' && config.buildConfig.buildSecrets[0].secretName === 'build-npm')
  check('应用保存丢弃额外凭据字段', !JSON.stringify(config).includes('never-persist'))
  check('保存不修改调用者输入', dirty.buildSecrets[0].secretName === ' build-npm ' && dirty.buildSecrets[0].rawValue === 'never-persist')
  let workflow = await api.getWorkflow(appId)
  const original = workflow.items.find(item => item.kind === 'ci')
  const ci = { ...original, id: 'ci-build-options', definition: { ...original.definition, materials: [{ gitMaterialId: materials[0].id, type: 'branch', value: 'main' }], buildOverride: { ...draft, imageRepository: 'acme/options', buildSecrets: [{ ...reference, rawValue: 'never-persist' }] } } }
  await rejects('流水线覆盖执行引用校验', api.saveWorkflow(appId, { version: workflow.version, items: [{ ...ci, definition: { ...ci.definition, buildOverride: { ...draft, buildSSH: [{ ...ssh, id: '' }] } } }] }, config.version), /SSH 引用/)
  workflow = await api.saveWorkflow(appId, { version: workflow.version, items: [...workflow.items, ci] }, config.version)
  check('覆盖保存丢弃额外凭据字段', !JSON.stringify(workflow).includes('never-persist'))
  check('覆盖保存不修改调用者引用对象', ci.definition.buildOverride.buildSecrets[0].rawValue === 'never-persist')
  const commit = (await api.listCommits('main', appId, materials[0].id))[0]
  const trigger = () => api.triggerBuild(appId, commit.sha, config.version, ci.id, 'main', { workflowVersion: workflow.version, materials: [{ gitMaterialId: materials[0].id, branch: 'main', commitSha: commit.sha }] })
  const build = await trigger()
  check('构建快照包含当次多平台和两类引用', build.buildConfigSnapshot.platform === draft.platform && build.buildConfigSnapshot.buildSecrets[0].id === 'npmrc' && build.buildConfigSnapshot.buildSSH[0].id === 'default')
  await api.cancelBuild(build.id)
  config = await api.saveConfig(appId, { section: 'build', expectedVersion: config.version, buildConfig: { ...draft, buildSecrets: [], buildSSH: [], platform: '' } })
  check('应用变更不污染流水线覆盖', (await api.getWorkflow(appId)).items.find(item => item.id === ci.id).definition.buildOverride.buildSecrets.length === 1)
  const noOverride = { ...ci, definition: { ...ci.definition, buildOverride: null } }
  workflow = await api.saveWorkflow(appId, { version: workflow.version, items: workflow.items.map(item => item.id === ci.id ? noOverride : item) }, config.version)
  check('删除覆盖恢复最新应用选项', effectiveBuildConfig(config, noOverride.definition).buildSecrets.length === 0 && effectiveBuildConfig(config, noOverride.definition).platform === '')
  const retry = await api.retryBuild(build.id)
  check('重试沿用原有平台与凭据引用快照', JSON.stringify(retry.buildConfigSnapshot) === JSON.stringify(build.buildConfigSnapshot))
  retry.buildConfigSnapshot.buildSSH[0].key = 'client-mutation'
  check('历史读回不会暴露可变引用', (await api.getBuild(retry.id)).buildConfigSnapshot.buildSSH[0].key === 'ssh-privatekey')
  await api.cancelBuild(retry.id)
  const legacy = buildDraft({ ...draft, buildMode: 'buildpack', buildpackArguments: undefined })
  check('早期 Buildpacks 环境变量兼容回读', legacy.buildpackArguments[0].key === 'VERSION')
  let pack = { ...draft, buildMode: 'buildpack', buildpackArguments: [{ key: 'CUSTOM', value: 'keep' }], buildSecrets: [{ ...reference, key: '' }], buildSSH: [{ ...ssh, id: '' }], platform: 'invalid platform' }
  check('Buildpacks 不校验隐藏的 Docker 选项', Object.keys(validateBuildConfig(pack, materials)).length === 0 && customPlatformsOf(pack).length === 0)
  pack = updateBuildpack(pack, { buildpackVersion: '22.*' })
  check('语言版本生成对应环境变量并保留用户变量', pack.buildpackArguments.some(item => item.key === 'BP_NODE_VERSION' && item.value === '22.*') && pack.buildpackArguments[0].key === 'CUSTOM')
  pack = updateBuildpack(pack, { buildpackVersion: '20.*' })
  check('更新版本不会产生重复环境变量', pack.buildpackArguments.filter(item => item.key === 'BP_NODE_VERSION').length === 1 && pack.buildpackArguments[1].value === '20.*')
  pack = updateBuildpack(pack, { buildpackLanguage: 'Java' })
  check('切换语言清理旧版本参数并回到自动检测', pack.buildpackVersion === 'Autodetect' && pack.buildpackArguments.length === 1)
  pack = updateBuildpack(pack, { buildpackVersion: '21' })
  check('新语言使用对应版本参数', pack.buildpackArguments[1].key === 'BP_JVM_VERSION' && pack.buildpackArguments[1].value === '21')
  pack = updateBuildpack(pack, { builderImage: 'example/custom:mock' })
  check('自定义 Builder 清理受管理版本参数', pack.buildpackArguments.length === 1 && pack.buildpackArguments[0].key === 'CUSTOM')
  pack = updateBuildpack(pack, { builderImage: 'paketobuildpacks/builder-jammy-base:latest' })
  check('恢复预设 Builder 还原语言版本参数', pack.buildpackArguments[1].key === 'BP_JVM_VERSION')
  pack = updateBuildpack(pack, { buildpackVersion: 'Autodetect' })
  check('自动检测移除语言版本参数', pack.buildpackArguments.length === 1)
  check('Docker 参数与 Buildpacks 环境变量独立', pack.buildArguments[0].key === 'VERSION' && pack.buildpackArguments[0].key === 'CUSTOM')
  check('非法环境变量只校验当前构建方式', !!validateBuildConfig({ ...pack, buildpackArguments: [{ key: 'bad key', value: '' }] }, materials).buildArguments && !validate({ buildpackArguments: [{ key: 'bad key', value: '' }] }).buildArguments)
  config = await api.saveConfig(appId, { section: 'build', expectedVersion: config.version, buildConfig: pack })
  const packBuild = await trigger()
  check('Buildpacks 快照排除未使用的平台和凭据引用', packBuild.buildConfigSnapshot.platform === '' && packBuild.buildConfigSnapshot.buildSecrets.length === 0 && packBuild.buildConfigSnapshot.buildSSH.length === 0 && packBuild.buildConfigSnapshot.buildArguments.length === 0)
  check('Buildpacks 快照保留自己的环境变量', packBuild.buildConfigSnapshot.buildpackArguments[0].key === 'CUSTOM')
  await api.cancelBuild(packBuild.id)
  check('应用模式草稿仍保留独立 Docker 配置', (await api.getConfig(appId)).buildConfig.buildArguments[0].key === 'VERSION')
  check('配置归一化保留环境变量值原文', normalizeBuildConfig({ ...draft, buildpackArguments: [{ key: ' TEXT ', value: '  original  ' }] }).buildpackArguments[0].value === '  original  ')
  console.log(`Completed ${count} Mock build option checks`)
} finally { await server.close() }
