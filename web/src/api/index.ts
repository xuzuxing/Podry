import { buildHistoryLogFixture } from '@/mock/historyLogFixtures'
import type {
  AppConfig,
  Application,
  ApplicationLabel,
  ApplicationSetup,
  Artifact,
  AuditEvent,
  Binding,
  DeployStrategy,
  Build,
  BuildSelection,
  CIDefinition,
  CDDefinition,
  DeploymentStageType,
  StageRun,
  Cluster,
  Credential,
  ConfigMapEntry,
  ConfigEntryOptions,
  SecretEntry,
  DeployValues,
  Deployment,
  Environment,
  GitBranch,
  GitCommit,
  GitWebhookEvent,
  K8sResource,
  ClusterOverview,
  NodeDetail,
  Member,
  Namespace,
  Project,
  Registry,
  SetupKey,
  SetupStep,
  ResourceEvent,
  ResourceType,
  ResourceRef,
  NodeTaint,
  Team,
  User,
  Workflow,
} from '@/types'
import type { ConfigComparisonCatalog } from '@/types/configComparison'
import { comparisonChartDefaults } from '@/mock/comparisonCharts'
import { mockScopedVariables } from '@/mock/scopedVariables'
import { captureConfigVariables } from '@/utils/configVariables'
import { resolveComparisonSide } from '@/utils/configComparison'
import * as db from '@/mock/data'
import { gitMaterialsOf } from '@/utils/gitMaterials'
import { effectiveValues } from '@/utils/deploymentValues'
import { effectiveEntries, entryOptions, parseEntryData } from '@/utils/configEntries'
import { captureDeploymentConfig } from '@/utils/deploymentSnapshot'
import { ciSourcesOf, effectiveBuildConfig, sourceError, sourceMatches, validateBuildConfig } from '@/utils/pipelineBuild'
import { normalizeBuildConfig } from '@/utils/buildOptions'
import { validatePipelineTasks } from '@/utils/pipelineTasks'
import { taskCatalog } from '@/mock/taskCatalog'
import { emptyStageResources, stageResourceOptions, stageResourceErrors } from '@/utils/stageResources'
import { deploymentStageErrors, deploymentStageOf } from '@/utils/deploymentStage'
import { advanceStageRun, stageIsActive, stageTaskLog } from '@/utils/stageRuns'
import { stringify } from 'yaml'
import { nodeManifestError, syncNodeDetailManifest } from '@/utils/nodeDetails'
import { applicationNameError, applicationDescriptionError, applicationTagErrors, applicationLabels } from '@/utils/applicationCreation'
import { legacyApplicationTags } from '@/utils/applicationOverview'
import { artifactImageRepository, artifactMetadataError, artifactMetadataInput } from '@/utils/artifactDetails'
import { isWebhookSource, sourceContextError, webhookMatches } from '@/utils/gitSources'
import { mockWebhookEvents } from '@/mock/gitWebhookEvents'
import { gitCommitExcluded } from '@/utils/gitCommitFilters'
import { dockerfileTemplates } from '@/mock/dockerfileTemplates'
import type { DockerfileTemplate, DockerfileTemplateContent } from '@/types/dockerfile'
import { resourceIdentity, resourceYamlDocuments, retainManagedFields } from '@/utils/resourceManifest'
import { desiredResourceSnapshot } from '@/mock/resourceDesiredManifests'
import type { DesiredResourceManifest } from '@/types/resourceManifest'
import { podContainers, type PodLogOptions } from '@/utils/podLogs'
import { isPodShell, podTerminalError, type PodShell } from '@/utils/podTerminal'

/**
 * 静态实现阶段的 mock API：保持与 docs/api/openapi.json 同形的入参/出参，
 * 页面只依赖这一层；接真实后端时把实现换成 request.get/post 即可。
 */
const delay = (ms = 160) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** 本地模板目录及内容；不请求 Devtron 的中央目录，不读取或写入 Git。 */
export async function listDockerfileTemplates(): Promise<DockerfileTemplate[]> {
  await delay(100)
  return dockerfileTemplates.map(({ id, language, framework }) => ({ id, language, framework }))
}

export async function getDockerfileTemplate(id: string): Promise<DockerfileTemplateContent> {
  await delay(180)
  const template = dockerfileTemplates.find(item => item.id === id)
  if (!template) throw new MockError('not_found', '模板已不在当前目录中，请重新选择或重试', 404)
  return clone(template)
}
/** 新创建对象保留集群归属；固定演示数据按现有命名空间划分。 */
const resourceClusters = new Map<string, string>()
function belongsToCluster(item: K8sResource, clusterId: string): boolean {
  const owner = resourceClusters.get(item.ref.uid)
  if (owner) return owner === clusterId
  if (item.kind === 'Node') return clusterId === 'c-prod' ? item.ref.name.startsWith('prod-') : clusterId === 'c-dev' && item.ref.name.startsWith('dev-')
  if (item.ref.namespace === '_cluster') return true
  return (db.namespaces[clusterId] ?? []).some((namespace) => namespace.name === item.ref.namespace)
}
const page = <T>(items: T[], p = 1, size = 20) => {
  const start = (p - 1) * size
  return { items: clone(items.slice(start, start + size)), total: items.length, page: p, pageSize: size }
}

export class MockError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

// ---------------- 账号 ----------------
export async function login(email: string): Promise<{ token: string; user: User }> {
  await delay(220)
  if (!email.trim()) throw new MockError('validation_error', '请输入邮箱', 422)
  const user = { ...db.currentUser, email }
  return { token: `mock-${Date.now()}`, user }
}

export async function getMe(): Promise<User> {
  await delay(80)
  return clone(db.currentUser)
}

// ---------------- 归属 ----------------
export async function listTeams(): Promise<Team[]> {
  await delay(80)
  return clone(db.teams)
}

export async function listProjects(teamId?: string): Promise<Project[]> {
  await delay(100)
  const items = teamId ? db.projects.filter((p) => p.teamId === teamId) : db.projects
  return clone(items)
}

export async function getProject(projectId: string): Promise<Project> {
  await delay(80)
  const project = db.projectById(projectId)
  if (!project) throw new MockError('not_found', '项目不存在', 404)
  return clone(project)
}

export async function listMembers(): Promise<Member[]> {
  await delay(100)
  return clone(db.members)
}

export async function listEnvironments(): Promise<Environment[]> {
  await delay(80)
  return clone(db.environments)
}

// ---------------- 应用 ----------------
export interface AppQuery {
  projectId?: string
  keyword?: string
  health?: string
  page?: number
  pageSize?: number
}

export async function listApplications(query: AppQuery = {}) {
  await delay(140)
  let items = db.applications.filter((app) => !app.archivedAt)
  if (query.projectId) items = items.filter((a) => a.projectId === query.projectId)
  if (query.health) items = items.filter((a) => a.health === query.health)
  if (query.keyword) {
    const kw = query.keyword.toLowerCase()
    items = items.filter((a) => a.name.includes(kw) || a.description.toLowerCase().includes(kw))
  }
  return page(items, query.page ?? 1, query.pageSize ?? 20)
}

export async function getApplication(appId: string): Promise<Application> {
  await delay(100)
  const app = db.appById(appId)
  if (!app) throw new MockError('not_found', '应用不存在', 404)
  return clone(app)
}

function setupStep(key: SetupKey, done: boolean): SetupStep {
  return { key, status: done ? 'complete' : 'pending', blockers: [] }
}

/** 按当前配置与工作流重算 setup，镜像应用只有 base/workflow 两步。 */
function syncSetup(appId: string): ApplicationSetup | null {
  const app = db.applications.find((item) => item.id === appId)
  if (!app) return null
  const config = db.appConfigs[appId]
  const workflow = db.workflows[appId]
  const image = app.sourceMode === 'image'
  const steps: SetupStep[] = image
    ? [setupStep('base', Boolean(config?.chartConfig)), setupStep('workflow', Boolean(workflow?.items.length))]
    : [
        setupStep('git', Boolean(config?.gitConfig)),
        setupStep('build', Boolean(config?.buildConfig)),
        setupStep('base', Boolean(config?.chartConfig)),
        setupStep('workflow', Boolean(workflow?.items.length)),
      ]
  const previous = db.setups[appId]
  const completed = steps.filter((step) => step.status === 'complete').length
  const next = steps.find((step) => step.status !== 'complete')?.key ?? null
  const setup: ApplicationSetup = {
    appId,
    configVersion: config?.version ?? 0,
    workflowVersion: workflow?.version ?? 0,
    completed,
    total: steps.length,
    steps,
    canBuild: !image && Boolean(config?.gitConfig && config?.buildConfig),
    deployableBindingIds: previous?.deployableBindingIds ?? [],
    nextSection: next,
  }
  db.setups[appId] = setup
  return setup
}

export async function createApplication(input: {
  projectId: string
  name: string
  description?: string
  sourceMode: 'git' | 'image'
  cloneFromAppId?: string
  labels?: ApplicationLabel[]
}) {
  await delay(260)
  if (!db.projects.some(item => item.id === input.projectId)) throw new MockError('validation_error', '请选择有效项目', 422)
  const fieldError = applicationNameError(input.name) || applicationDescriptionError(input.description ?? '')
  if (fieldError) throw new MockError('validation_error', fieldError, 422)
  if (input.sourceMode !== 'git' && input.sourceMode !== 'image') throw new MockError('validation_error', '请选择有效应用类型', 422)
  const labels = applicationLabels(input.labels ?? [])
  if (applicationTagErrors(labels).some(error => error.key || error.value)) throw new MockError('validation_error', '标签缺失或格式无效', 422)
  if (labels.some(label => typeof label.propagate !== 'boolean')) throw new MockError('validation_error', '标签传播设置无效', 422)
  if (db.applications.some((a) => a.projectId === input.projectId && a.name === input.name)) {
    throw new MockError('conflict', '同项目下已存在同名应用', 409)
  }
  const source = input.cloneFromAppId
    ? db.applications.find((item) => item.id === input.cloneFromAppId && !item.archivedAt)
    : undefined
  if (input.cloneFromAppId && !source) throw new MockError('not_found', '源应用不存在', 404)
  if (source && source.sourceMode !== input.sourceMode) {
    throw new MockError('validation_error', 'sourceMode 必须与源应用一致', 422)
  }
  const app: Application = {
    id: `a-${Date.now()}`,
    projectId: input.projectId,
    name: input.name,
    description: input.description ?? '',
    sourceMode: input.sourceMode,
    health: 'unknown',
    archivedAt: null,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    createdBy: db.currentUser.name,
    envCount: 0,
    lastDeployedAt: null,
    labels: clone(labels),
    tags: labels.map(label => `${label.key}:${label.value}`),
  }
  db.applications.unshift(app)
  const sourceConfig = source ? db.appConfigs[source.id] : null
  if (sourceConfig && sourceConfig.version > 0) {
    const copied = clone(sourceConfig)
    db.appConfigs[app.id] = {
      ...copied,
      appId: app.id,
      version: 1,
      buildConfig: copied.buildConfig
        ? { ...copied.buildConfig, imageRepository: `podry/${app.id}` }
        : null,
    }
  } else {
    db.appConfigs[app.id] = {
      appId: app.id,
      version: 0,
      gitConfig: null,
      buildConfig: null,
      chartConfig: null,
      deployValues: {},
    }
  }
  syncSetup(app.id)
  return clone(app)
}

export async function archiveApplication(appId: string): Promise<void> {
  await delay(160)
  const app = db.appById(appId)
  if (!app) throw new MockError('not_found', '应用不存在', 404)
  app.archivedAt = new Date().toISOString()
}

// ---------------- 配置与门控 ----------------
export async function getConfig(appId: string): Promise<AppConfig> {
  await delay(120)
  const config = db.appConfigs[appId]
  if (!config) throw new MockError('not_found', '配置不存在', 404)
  return clone(config)
}

export interface ConfigSectionInput {
  section: 'git' | 'build' | 'base'
  expectedVersion: number
  gitConfig?: AppConfig['gitConfig']
  gitMaterials?: AppConfig['gitMaterials']
  buildConfig?: AppConfig['buildConfig']
  chartConfig?: AppConfig['chartConfig']
  deployValues?: DeployValues
  deployValuesYaml?: string
}

export async function saveConfig(appId: string, input: ConfigSectionInput): Promise<AppConfig> {
  await delay(240)
  const config = db.appConfigs[appId]
  if (!config) throw new MockError('not_found', '配置不存在', 404)
  if (input.expectedVersion !== config.version) {
    throw new MockError('revision_conflict', '配置已被他人更新，请重新读取', 409)
  }
  if (input.section === 'git') {
    if (input.gitMaterials) {
      const materials = clone(input.gitMaterials)
      if (!materials.length) throw new MockError('last_repository', '应用至少需要保留一个 Git 仓库', 422)
      if (materials.length > 1 && db.workflows[appId]?.items.some(item => item.kind === 'ci' && (item.definition as CIDefinition).materials?.some(isWebhookSource))) throw new MockError('repository_in_use', '请先将 Webhook 流水线改为分支代码源，再添加 Git 仓库', 409)
      const sourceMaterialId = config.buildConfig ? config.buildConfig.gitMaterialId || gitMaterialsOf(config)[0]?.id : undefined
      if (sourceMaterialId && !materials.some((item) => item.id === sourceMaterialId)) {
        throw new MockError('repository_in_use', '该仓库正用于构建，请先在构建配置中切换仓库', 409)
      }
      if (config.buildConfig?.buildMode !== 'buildpack' && !config.buildConfig?.useRootContext && config.buildConfig?.contextGitMaterialId && !materials.some((item) => item.id === config.buildConfig?.contextGitMaterialId)) {
        throw new MockError('repository_in_use', '该仓库正用于构建上下文，请先在构建配置中切换仓库', 409)
      }
      for (const pipeline of db.workflows[appId]?.items ?? []) {
        if (pipeline.kind !== 'ci') continue
        const override = (pipeline.definition as CIDefinition).buildOverride
        if (!override) continue
        const used = [override.gitMaterialId, ...(override.buildMode !== 'buildpack' && !override.useRootContext ? [override.contextGitMaterialId] : [])]
        if (used.some(id => id && !materials.some(item => item.id === id))) throw new MockError('repository_in_use', '该仓库正用于流水线构建覆盖，请先修改流水线配置', 409)
      }
      config.gitMaterials = materials
      const first = materials[0]!
      config.gitConfig = { repositoryUrl: first.repositoryUrl, branch: first.branch, accountMode: first.accountMode, credentialId: first.credentialId }
      const workflow = db.workflows[appId]
      let sourcesChanged = false
      for (const pipeline of workflow?.items ?? []) {
        if (pipeline.kind !== 'ci') continue
        const definition = pipeline.definition as CIDefinition
        if (!definition.materials) continue
        const next = ciSourcesOf(config, definition)
        if (JSON.stringify(next) !== JSON.stringify(definition.materials)) {
          definition.materials = next
          pipeline.version++
          sourcesChanged = true
        }
      }
      if (workflow && sourcesChanged) workflow.version++
    } else if (input.gitConfig) {
      config.gitConfig = clone(input.gitConfig)
      if (config.gitMaterials?.[0]) Object.assign(config.gitMaterials[0], clone(input.gitConfig))
    }
  }
  if (input.section === 'build' && input.buildConfig) {
    const materials = gitMaterialsOf(config)
    const message = Object.values(validateBuildConfig(input.buildConfig, materials))[0]
    if (message) throw new MockError('validation_error', message, 422)
    if (!db.registries.some(item => item.id === input.buildConfig?.registryId)) throw new MockError('validation_error', '镜像仓库不存在', 422)
    config.buildConfig = normalizeBuildConfig(input.buildConfig, materials[0]?.id)
  }
  if (input.section === 'base') {
    if (input.chartConfig) {
      if (config.chartConfig && config.chartConfig.workloadKind !== input.chartConfig.workloadKind) {
        throw new MockError('chart_type_locked', '工作负载类型首次保存后不可修改', 409)
      }
      config.chartConfig = clone(input.chartConfig)
    }
    if (input.deployValues) {
      config.deployValues = clone(input.deployValues)
      config.deployValuesYaml = input.deployValuesYaml
    }
  }
  config.version += 1
  syncSetup(appId)
  return clone(config)
}

// ---------------- ConfigMap / Secret（mock 扩展） ----------------
export async function listConfigMaps(appId: string, environmentId: string | null): Promise<ConfigMapEntry[]> {
  await delay(100)
  return clone(
    db.configMaps.filter((item) => item.appId === appId && item.environmentId === (environmentId || null)),
  )
}

export interface ConfigMapInput extends ConfigEntryOptions {
  id?: string
  appId: string
  environmentId: string | null
  name: string
  data: Record<string, string>
  dataYaml?: string
}

function validateConfigEntry(input: ConfigEntryOptions & { name: string }, keys: string[]): void {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(input.name)) throw new MockError('validation_error', '名称需为 1–63 位小写字母、数字或连字符', 422)
  if ((!keys.length && input.source !== 'external' && input.mergeStrategy !== 'patch') || keys.some((key) => !/^[a-zA-Z0-9._-]+$/.test(key)) || new Set(keys).size !== keys.length) throw new MockError('validation_error', '请检查 key 名称或重复项', 422)
  if (input.mountAs === 'volume' && (!input.mountPath?.startsWith('/') || input.mountPath.includes('..'))) throw new MockError('validation_error', '请填写有效的绝对挂载路径', 422)
  if (input.fileMode && !/^0?[0-7]{3}$/.test(input.fileMode)) throw new MockError('validation_error', '请填写八进制文件权限', 422)
}

export async function saveConfigMap(input: ConfigMapInput): Promise<ConfigMapEntry> {
  await delay(220)
  validateConfigEntry(input, Object.keys(input.data))
  const parsedData = parseEntryData(input.dataYaml ?? stringify(input.data))
  if (parsedData.error || JSON.stringify(Object.entries(parsedData.data).sort()) !== JSON.stringify(Object.entries(input.data).sort())) throw new MockError('validation_error', parsedData.error || 'YAML 与配置数据不一致', 422)
  const existing = input.id ? db.configMaps.find((item) => item.id === input.id && item.appId === input.appId && item.environmentId === input.environmentId) : undefined
  if (input.id && !existing) throw new MockError('not_found', '配置不存在', 404)
  const duplicated = db.configMaps.some(
    (item) =>
      item.appId === input.appId &&
      item.environmentId === input.environmentId &&
      item.name === input.name &&
      item.id !== input.id,
  )
  if (duplicated) throw new MockError('conflict', '同一范围内已存在同名 ConfigMap', 409)
  if (existing) {
    if (existing.name !== input.name) throw new MockError('conflict', '已有配置名称不可修改', 409)
    Object.assign(existing, entryOptions(input))
    existing.name = input.name
    existing.data = { ...input.data }
    existing.dataYaml = input.dataYaml
    existing.updatedAt = new Date().toISOString()
    return clone(existing)
  }
  const created: ConfigMapEntry = {
    id: `cm-${Date.now()}`,
    appId: input.appId,
    environmentId: input.environmentId,
    name: input.name,
    ...entryOptions(input),
    data: { ...input.data },
    dataYaml: input.dataYaml,
    updatedAt: new Date().toISOString(),
  }
  db.configMaps.push(created)
  return clone(created)
}

export async function deleteConfigMap(id: string): Promise<void> {
  await delay(160)
  const index = db.configMaps.findIndex((item) => item.id === id)
  if (index >= 0) db.configMaps.splice(index, 1)
}

export async function listSecrets(appId: string, environmentId: string | null): Promise<SecretEntry[]> {
  await delay(100)
  return clone(db.configSecrets.filter((item) => item.appId === appId && item.environmentId === (environmentId || null)))
}

export interface SecretInput extends ConfigEntryOptions {
  id?: string
  appId: string
  environmentId: string | null
  name: string
  keys: string[]
}

export async function saveSecret(input: SecretInput): Promise<SecretEntry> {
  await delay(220)
  validateConfigEntry(input, input.keys)
  const existing = input.id ? db.configSecrets.find((item) => item.id === input.id && item.appId === input.appId && item.environmentId === input.environmentId) : undefined
  if (input.id && !existing) throw new MockError('not_found', '配置不存在', 404)
  const duplicated = db.configSecrets.some(
    (item) =>
      item.appId === input.appId &&
      item.environmentId === input.environmentId &&
      item.name === input.name &&
      item.id !== input.id,
  )
  if (duplicated) throw new MockError('conflict', '同一范围内已存在同名 Secret', 409)
  if (existing) {
    if (existing.name !== input.name) throw new MockError('conflict', '已有配置名称不可修改', 409)
    Object.assign(existing, entryOptions(input))
    existing.name = input.name
    existing.keys = [...input.keys]
    existing.updatedAt = new Date().toISOString()
    return clone(existing)
  }
  const created: SecretEntry = {
    id: `sc-${Date.now()}`,
    appId: input.appId,
    environmentId: input.environmentId,
    name: input.name,
    ...entryOptions(input),
    keys: [...input.keys],
    updatedAt: new Date().toISOString(),
  }
  db.configSecrets.push(created)
  return clone(created)
}

export async function deleteSecret(id: string): Promise<void> {
  await delay(160)
  const index = db.configSecrets.findIndex((item) => item.id === id)
  if (index >= 0) db.configSecrets.splice(index, 1)
}

export async function getSetup(appId: string): Promise<ApplicationSetup> {
  await delay(80)
  const setup = db.setups[appId]
  if (!setup) throw new MockError('not_found', 'setup 不存在', 404)
  return clone(setup)
}

export async function listBindings(appId: string): Promise<Binding[]> {
  await delay(100)
  return clone(db.bindingsOf(appId))
}

/** 仅返回目标环境可引用的名称和类型；不返回 Secret 值或配置内容。 */
function stageResourcesFor(appId: string, bindingId: string) {
  const binding = db.bindingById(bindingId)
  if (!binding || binding.appId !== appId) throw new MockError('not_found', '部署阶段的环境绑定不存在', 404)
  const env = db.environments.find(item => item.id === binding.environmentId)
  const options = stageResourceOptions(
    db.configMaps.filter(item => item.appId === appId && item.environmentId === null),
    db.configMaps.filter(item => item.appId === appId && item.environmentId === binding.environmentId),
    db.configSecrets.filter(item => item.appId === appId && item.environmentId === null),
    db.configSecrets.filter(item => item.appId === appId && item.environmentId === binding.environmentId),
  )
  const workerEnabled = db.clusters.find(item => item.id === binding.target.clusterId)?.cdWorkerEnabled === true
  return { options, scope: `${env?.name ?? binding.environmentId} · ${binding.target.namespace}`, workerEnabled }
}
export async function listStageResources(appId: string, bindingId: string) {
  await delay(120)
  return clone(stageResourcesFor(appId, bindingId))
}

/** 演示 Helm release 输出；真实接入时应返回 Helm Notes，而非应用 description。 */
export async function getReleaseNotes(appId: string, bindingId: string): Promise<string> {
  await delay(180)
  const binding = db.bindingById(bindingId)
  if (!binding || binding.appId !== appId) throw new MockError('not_found', '环境绑定不存在', 404)
  const released = db.deployments.some((item) => item.bindingId === bindingId && item.helmRevision !== null)
  if (!released) return ''
  return ['## ' + binding.target.releaseName, '', '**NAMESPACE:** `' + binding.target.namespace + '`', '', '### NOTES:', 'This is a local Mock Helm release.', '', '1. Use the **Services** and **Pods** tabs to inspect the example resources.', '2. Check the workload with:', '', '```sh', 'kubectl get pods -n ' + binding.target.namespace, '```', '', '> These notes are local demonstration data, not live Helm output.'].join('\n')
}

export async function getWorkflow(appId: string): Promise<Workflow> {
  await delay(120)
  return clone(db.workflows[appId] ?? { version: 0, items: [] })
}

export async function saveWorkflow(appId: string, workflow: Workflow, expectedConfigVersion?: number): Promise<Workflow> {
  await delay(240)
  const config = db.appConfigs[appId]
  if (workflow.version !== (db.workflows[appId]?.version ?? 0) || expectedConfigVersion !== undefined && expectedConfigVersion !== config?.version) throw new MockError('revision_conflict', '应用或流水线配置已更新，请关闭后重新读取', 409)
  for (const pipeline of workflow.items) {
    if (pipeline.kind === 'cd') {
      const definition = pipeline.definition as CDDefinition
      const { workerEnabled } = stageResourcesFor(appId, pipeline.bindingId ?? '')
      for (const stage of ['pre', 'post'] as const) {
        const message = deploymentStageErrors(deploymentStageOf(definition, stage), workerEnabled)[0]
        if (message) throw new MockError('validation_error', `${stage === 'pre' ? '前置阶段' : '后置阶段'}：${message}`, 422)
      }
      if (definition.preStageResources || definition.postStageResources) {
        const { options } = stageResourcesFor(appId, pipeline.bindingId ?? '')
        for (const [label, refs] of [['前置阶段', definition.preStageResources], ['后置阶段', definition.postStageResources]] as const) {
          const message = stageResourceErrors(refs ?? emptyStageResources(), options)[0]
          if (message) throw new MockError('validation_error', `${label}：${message}`, 422)
        }
      }
    }
    const taskErrors = validatePipelineTasks(pipeline.definition.preTasks ?? [],pipeline.definition.postTasks ?? [])
    const taskError = Object.values(taskErrors).flat()[0]
    if (taskError) throw new MockError('validation_error', taskError, 422)
    for (const task of [...pipeline.definition.preTasks ?? [],...pipeline.definition.postTasks ?? []]) {
      if (!task.plugin) continue
      const plugin = taskCatalog.find(item=>item.id===task.plugin!.id)
      const version = plugin?.versions.find(item=>item.version===task.plugin!.version)
      if (!version) throw new MockError('validation_error', '插件或版本不存在', 422)
      if (version.inputs.length !== task.variables.length || version.inputs.some(input=>!task.variables.some(item=>item.key===input.key && item.format===input.format)) || JSON.stringify(task.outputs) !== JSON.stringify(version.outputs) || task.script !== version.script || task.execution !== 'shell') throw new MockError('validation_error', '插件参数结构与版本不一致', 422)
    }
    if (pipeline.kind !== 'ci' || !config) continue
    const definition = pipeline.definition as CIDefinition
    if (definition.materials) {
      const materials = gitMaterialsOf(config)
      if (definition.materials.length !== materials.length || materials.some(material => definition.materials!.filter(item => item.gitMaterialId === material.id).length !== 1)) throw new MockError('validation_error', '请为每个仓库配置唯一代码源', 422)
      const message = definition.materials.map(sourceError).find(Boolean)
      if (message) throw new MockError('validation_error', message, 422)
      const contextError = sourceContextError(definition.materials, materials)
      if (contextError) throw new MockError('validation_error', contextError, 422)
    }
    if (definition.buildOverride) {
      const message = Object.values(validateBuildConfig(definition.buildOverride, gitMaterialsOf(config)))[0]
      if (message) throw new MockError('validation_error', message, 422)
      if (!db.registries.some(item => item.id === definition.buildOverride?.registryId)) throw new MockError('validation_error', '镜像仓库不存在', 422)
    }
  }
  const savedWorkflow = clone({ ...workflow, version: workflow.version + 1 })
  for (const pipeline of savedWorkflow.items) {
    if (pipeline.kind !== 'ci') continue
    const definition = pipeline.definition as CIDefinition
    if (definition.buildOverride) definition.buildOverride = normalizeBuildConfig(definition.buildOverride, gitMaterialsOf(config)[0]?.id)
  }
  db.workflows[appId] = savedWorkflow
  syncSetup(appId)
  return clone(db.workflows[appId])
}

// ---------------- Git 选择 ----------------
export async function listBranches(appId: string, gitMaterialId?: string): Promise<GitBranch[]> {
  await delay(180)
  if (!db.appConfigs[appId]?.gitConfig) throw new MockError('git_not_configured', '尚未配置 Git 源', 422)
  if (gitMaterialId && !gitMaterialsOf(db.appConfigs[appId]!).some(item => item.id === gitMaterialId)) throw new MockError('not_found', 'Git 仓库已不存在', 404)
  return gitMaterialId ? db.branches.map(branch => ({...branch,headSha:scopedCommits(branch.name,appId,gitMaterialId)[0]?.sha ?? branch.headSha})) : clone(db.branches)
}

/** 按仓库和分支生成稳定、独立的 Mock 提交；无范围参数时兼容旧记录查询。 */
function scopedCommits(ref: string, appId?: string, gitMaterialId?: string): GitCommit[] {
  if (!appId || !gitMaterialId) return clone(db.commits)
  const materials = gitMaterialsOf(db.appConfigs[appId] ?? null)
  const material = materials.find(item => item.id === gitMaterialId)
  if (!material) throw new MockError('not_found', 'Git 仓库已不存在', 404)
  if (!db.branches.some(item => item.name === ref)) return []
  if (material.id === materials[0]?.id && ref === 'main') return clone(db.commits).map(commit => ({ ...commit, excluded: gitCommitExcluded(commit, material.filterPatterns) }))
  return clone(db.commits).map((commit, index) => {
    let hash = 2166136261
    for (const char of `${material.repositoryUrl}:${ref}:${commit.sha}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
    const prefix = (hash >>> 0).toString(16).padStart(8, '0')
    return { ...commit, sha: prefix + commit.sha.slice(8), subject: `${material.repositoryUrl.split('/').pop()?.replace(/\.git$/, '')}: ${ref} · ${commit.subject}`, authorName: index % 2 ? '陈开发' : commit.authorName, excluded: gitCommitExcluded(commit, material.filterPatterns) }
  })
}

export async function listCommits(ref: string, appId?: string, gitMaterialId?: string): Promise<GitCommit[]> {
  await delay(200)
  if (ref === 'unknown') throw new MockError('git_unavailable', 'Git 服务暂不可达，请稍后重试', 503)
  return scopedCommits(ref, appId, gitMaterialId)
}

function webhookContext(appId: string, pipelineId: string, gitMaterialId: string) {
  const config = db.appConfigs[appId]
  const pipeline = db.workflows[appId]?.items.find(item => item.id === pipelineId && item.kind === 'ci')
  if (!config || !pipeline) throw new MockError('not_found', '构建流水线已不存在', 404)
  const materials = gitMaterialsOf(config)
  const material = materials.find(item => item.id === gitMaterialId)
  const sources = ciSourcesOf(config, pipeline.definition as CIDefinition)
  const source = sources.find(item => item.gitMaterialId === gitMaterialId)
  if (!material || !source || !isWebhookSource(source)) throw new MockError('validation_error', '该仓库没有配置 Webhook 代码源', 422)
  const message = sourceContextError(sources, materials) || sourceError(source)
  if (message) throw new MockError('validation_error', message, 422)
  return { material, source }
}

/** 包括通过与未通过过滤的本地示例，供触发列表和 Received webhooks 共用。 */
export async function listWebhookEvents(appId: string, pipelineId: string, gitMaterialId: string): Promise<GitWebhookEvent[]> {
  await delay(180)
  const { material, source } = webhookContext(appId, pipelineId, gitMaterialId)
  return clone(mockWebhookEvents(appId, material, scopedCommits('main', appId, material.id)).filter(event => event.type === source.type))
}

export async function setPipelineBranches(appId: string, pipelineId: string, branches: Array<{ gitMaterialId: string; branch: string }>, expectedWorkflowVersion: number, expectedConfigVersion: number): Promise<Workflow> {
  await delay(200)
  const workflow = db.workflows[appId]
  const config = db.appConfigs[appId]
  const pipeline = workflow?.items.find(item => item.id === pipelineId && item.kind === 'ci')
  if (!workflow || !config || !pipeline) throw new MockError('not_found', '构建流水线已不存在', 404)
  if (workflow.version !== expectedWorkflowVersion || config.version !== expectedConfigVersion) throw new MockError('revision_conflict', '配置或流水线已更新，请重新打开提交选择', 409)
  const sources = ciSourcesOf(config, pipeline.definition as CIDefinition)
  const regexSources = sources.filter(source => source.type === 'regex')
  if (branches.length !== regexSources.length || regexSources.some(source => branches.filter(item => item.gitMaterialId === source.gitMaterialId).length !== 1)) throw new MockError('validation_error', '请为每个正则代码源设置唯一分支', 422)
  const next = sources.map(source => {
    if (source.type !== 'regex') return source
    const branch = branches.find(item => item.gitMaterialId === source.gitMaterialId)!.branch.trim()
    if (!branch || !sourceMatches(source, branch)) throw new MockError('branch_mismatch', '分支名称不匹配配置的正则表达式', 422)
    return { ...source, selectedBranch: branch }
  })
  ;(pipeline.definition as CIDefinition).materials = next
  pipeline.version++
  workflow.version++
  return clone(workflow)
}

// ---------------- 构建 ----------------
export async function listBuilds(appId: string, pipelineId?: string) {
  await delay(140)
  const items = db.buildsOf(appId).filter((item) => !pipelineId || (pipelineId === '__unassigned__' ? !item.pipelineId : item.pipelineId === pipelineId))
  return page(items.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), 1, 50)
}

export async function getBuild(buildId: string): Promise<Build> {
  await delay(100)
  const build = db.builds.find((b) => b.id === buildId)
  if (!build) throw new MockError('not_found', '构建不存在', 404)
  return clone(build)
}

export async function triggerBuild(appId: string, commitSha: string, expectedConfigVersion: number, pipelineId?: string, sourceBranch?: string, selection?: BuildSelection): Promise<Build> {
  await delay(300)
  const config = db.appConfigs[appId]
  if (!config) throw new MockError('not_found', '配置不存在', 404)
  if (expectedConfigVersion !== config.version) {
    throw new MockError('revision_conflict', '配置已更新，请重新选择提交', 409)
  }
  const cis = db.workflows[appId]?.items.filter((item) => item.kind === 'ci') ?? []
  const pipeline = cis.find((item) => item.id === pipelineId) ?? (!pipelineId && cis.length === 1 ? cis[0] : undefined)
  if (!pipeline) throw new MockError('pipeline_required', '请选择当前应用的构建流水线', 422)
  if (!pipeline.enabled) throw new MockError('pipeline_disabled', '该构建流水线已停用', 422)
  if (db.builds.some((b) => b.appId === appId && b.pipelineId === pipeline.id && ['queued', 'running', 'canceling'].includes(b.status))) {
    throw new MockError('build_active', '已有进行中的构建', 409)
  }
  const definition = pipeline.definition as CIDefinition
  const workflowVersion = db.workflows[appId]!.version
  if (selection && selection.workflowVersion !== workflowVersion) throw new MockError('revision_conflict', '流水线已更新，请重新打开提交选择', 409)
  const materials = gitMaterialsOf(config)
  const sources = ciSourcesOf(config, definition)
  if (!materials.length || !config.buildConfig) throw new MockError('validation_error', '请先完成代码源和构建配置', 422)
  const sourceMessage = sourceContextError(sources, materials) || sources.map(sourceError).find(Boolean)
  if (sourceMessage) throw new MockError('validation_error', sourceMessage, 422)
  const buildConfig = effectiveBuildConfig(config, definition)
  const buildError = Object.values(validateBuildConfig(buildConfig, materials))[0]
  if (buildError) throw new MockError('validation_error', buildError, 422)
  const picks = selection?.materials ?? (materials.length === 1 ? [{ gitMaterialId: materials[0]!.id, branch: sourceBranch ?? definition.branch, commitSha }] : [])
  if (picks.length !== materials.length || materials.some(material => picks.filter(item => item.gitMaterialId === material.id).length !== 1)) throw new MockError('material_required', '请为每个 Git 仓库选择一个提交', 422)
  const snapshots = materials.map((material, index) => {
    const pick = picks.find(item => item.gitMaterialId === material.id)!
    const source = sources[index]!
    if (isWebhookSource(source)) {
      const event = mockWebhookEvents(appId, material, scopedCommits('main', appId, material.id)).find(item => item.id === pick.webhookEventId)
      if (!event || !webhookMatches(source, event)) throw new MockError('event_invalid', '所选 Webhook 事件不存在或未通过当前过滤条件，请刷新后重新选择', 422)
      if (event.ref !== pick.branch || event.commit.sha !== pick.commitSha) throw new MockError('commit_invalid', '提交与 Webhook 事件不一致，请重新选择', 422)
      if (event.commit.excluded) throw new MockError('commit_excluded', '该提交仅修改已排除路径中的文件，无法用于构建', 422)
      return { ...event.commit, gitMaterialId: material.id, repositoryUrl: material.repositoryUrl, checkoutPath: material.checkoutPath, branch: event.ref, sourceType: source.type, sourceValue: source.value, webhookEvent: clone(event) }
    }
    if (pick.webhookEventId || !sourceMatches(source, pick.branch)) throw new MockError('branch_mismatch', '所选分支不匹配流水线代码源配置', 422)
    const selected = scopedCommits(pick.branch, appId, material.id).find(item => item.sha === pick.commitSha)
    if (!selected) throw new MockError('commit_invalid', '所选提交不属于该仓库和分支，请刷新后重新选择', 422)
    if (selected.excluded) throw new MockError('commit_excluded', '该提交仅修改已排除路径中的文件，无法用于构建', 422)
    return { ...selected, gitMaterialId: material.id, repositoryUrl: material.repositoryUrl, checkoutPath: material.checkoutPath, branch: pick.branch, sourceType: source.type, sourceValue: source.value }
  })
  const primary = snapshots.find(item => item.gitMaterialId === buildConfig.gitMaterialId) ?? snapshots[0]!
  const build: Build = {
    id: `bd-${Math.floor(Math.random() * 9000 + 1000)}`,
    appId,
    pipelineId: pipeline.id,
    sourceBranch: primary.branch,
    repositoryUrl: primary.repositoryUrl,
    materials: clone(snapshots),
    buildConfigSnapshot: clone(buildConfig),
    workflowVersion,
    status: 'running',
    commitSha: primary.sha,
    commitSubject: primary.subject,
    configVersion: config.version,
    attemptNo: 1,
    artifactId: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    jobName: `build-${db.appById(appId)?.name ?? 'app'}-manual-a1`,
    errorCode: null,
    logAvailability: 'runtime',
  }
  db.builds.unshift(build)
  return clone(build)
}

export async function cancelBuild(buildId: string): Promise<Build> {
  await delay(200)
  const build = db.builds.find((b) => b.id === buildId)
  if (!build) throw new MockError('not_found', '构建不存在', 404)
  if (build.status !== 'running' && build.status !== 'queued') {
    throw new MockError('conflict', '当前状态不可取消', 409)
  }
  build.status = 'canceled'
  build.finishedAt = new Date().toISOString()
  return clone(build)
}

export async function retryBuild(buildId: string): Promise<Build> {
  await delay(220)
  const source = db.builds.find((b) => b.id === buildId)
  if (!source) throw new MockError('not_found', '构建不存在', 404)
  if (!source.pipelineId) throw new MockError('pipeline_required', '该记录没有流水线归属，请从构建发布页发起构建', 422)
  if (!db.workflows[source.appId]?.items.some((item) => item.kind === 'ci' && item.id === source.pipelineId && item.enabled)) {
    throw new MockError('pipeline_disabled', '原构建流水线已删除或停用，请从构建发布页选择流水线', 422)
  }
  if (db.builds.some((item) => item.appId === source.appId && item.pipelineId === source.pipelineId && ['running', 'queued', 'canceling'].includes(item.status))) {
    throw new MockError('build_active', '该流水线已有进行中的构建', 409)
  }
  const build: Build = {
    ...clone(source),
    id: `bd-${Math.floor(Math.random() * 9000 + 1000)}`,
    status: 'running',
    artifactId: null,
    attemptNo: source.attemptNo + 1,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    errorCode: null,
    logAvailability: 'runtime',
  }
  db.builds.unshift(build)
  return clone(build)
}

export async function getBuildLogs(buildId: string): Promise<string[]> {
  await delay(160)
  const build = db.builds.find((b) => b.id === buildId)
  if (!build) throw new MockError('not_found', '构建不存在', 404)
  if (build.logAvailability === 'unavailable' || build.logAvailability === 'expired') {
    throw new MockError('log_unavailable', '日志不可用，构建结果仍以产物为准', 404)
  }
  const format = (lines: string[]): string[] => buildHistoryLogFixture(build, lines)
  const head = [
    '[Mock] 本地构建日志示例：没有执行构建命令、启动 Job 或推送镜像。',
    `[podry] attempt #${build.attemptNo} for build ${build.id}`,
    `[podry] commit ${build.commitSha.slice(0, 8)} config v${build.configVersion}`,
    ...(build.materials?.map(item => `[source] ${item.repositoryUrl} -> ${item.checkoutPath} @ ${item.branch} (${item.sha.slice(0, 8)})`) ?? ['[source] historical source metadata not recorded']),
    '[source] checkout detached HEAD at fixed SHA (Mock log)',
    `[buildkit] #1 [internal] build mode ${build.buildConfigSnapshot?.buildMode ?? 'historical fixture'}; Dockerfile ${build.buildConfigSnapshot?.dockerfile ?? 'not recorded'}`,
    '[buildkit] #2 [internal] load metadata for docker.io/library/node:22-alpine',
    '[buildkit] #4 [1/4] COPY package*.json ./',
    '[buildkit] #5 [2/4] RUN npm ci --omit=dev',
    '[buildkit] #6 [3/4] COPY . .',
    '[buildkit] #7 [4/4] RUN npm run build',
    '[buildkit] #8 exporting to image',
  ]
  if (build.status === 'succeeded') {
    const artifact = db.artifacts.find(item => item.id === build.artifactId && item.appId === build.appId && item.buildId === build.id)
    return format([
      ...head,
      ...(artifact ? [`[buildkit] #8 image ${artifact.imageRef}`, `[podry] artifact digest ${artifact.digest}`] : ['[podry] historical artifact metadata not recorded']),
      '\x1b[32m[podry] build succeeded\x1b[0m',
    ])
  }
  if (build.status === 'failed') {
    return format([...head, '\x1b[31m[buildkit] ERROR failed to solve: process "/bin/sh -c npm run build" did not complete successfully: exit code: 1\x1b[0m', '[podry] build failed: buildkit_failed'])
  }
  if (build.status === 'canceled') {
    return format([...head, `[podry] cancel requested, terminating Job ${build.jobName || 'not recorded'}`, '[podry] build canceled'])
  }
  if (build.status === 'unknown') return format([...head, '[podry] execution status unknown; waiting for reconciliation'])
  if (build.status === 'queued') return format([head[0]!, head[1]!, '[podry] queued; waiting for a worker'])
  if (build.status === 'canceling') return format([...head, '[podry] cancel requested; waiting for worker confirmation'])
  return format([...head, '[buildkit] #8 DONE 3.2s', '[podry] waiting for image export...'])
}

// ---------------- 产物与发布 ----------------
export async function listArtifacts(appId: string): Promise<Artifact[]> {
  await delay(120)
  return clone(db.artifactsOf(appId))
}

// ---------------- 部署前后置阶段（仅本地 Mock；不创建 Deployment） ----------------
function stagePipeline(appId: string, pipelineId: string) {
  const pipeline = db.workflows[appId]?.items.find(item => item.id === pipelineId && item.kind === 'cd')
  if (!pipeline || !pipeline.enabled) throw new MockError('not_found', '部署流水线不存在或已禁用', 404)
  const binding = db.bindingById(pipeline.bindingId ?? '')
  if (!binding || binding.appId !== appId) throw new MockError('not_found', '阶段环境绑定不存在', 404)
  return { pipeline, binding, definition: pipeline.definition as CDDefinition }
}
function assertStage(stage: DeploymentStageType): void {
  if (stage !== 'PRECD' && stage !== 'POSTCD') throw new MockError('validation_error', '请选择前置或后置阶段', 422)
}
function stageRecord(appId: string, id: string): StageRun {
  const run = db.stageRuns.find(item => item.id === id && item.appId === appId)
  if (!run) throw new MockError('not_found', '阶段运行记录不存在', 404)
  advanceStageRun(run)
  return run
}
function assertStageIdle(appId: string, pipelineId: string, stage: DeploymentStageType): void {
  db.stageRuns.forEach(run => advanceStageRun(run))
  if (db.stageRuns.some(run => run.appId === appId && run.pipelineId === pipelineId && run.stage === stage && stageIsActive(run.status))) throw new MockError('stage_running', '此阶段已有运行中的记录，请等待或取消后重试', 409)
}
function stageImages(appId: string, pipelineId: string): Artifact[] {
  const { definition } = stagePipeline(appId, pipelineId)
  return db.artifactsOf(appId).filter(artifact => artifact.source === 'external' || !definition.upstreamPipelineId || db.builds.some(build => build.id === artifact.buildId && build.appId === appId && build.pipelineId === definition.upstreamPipelineId))
}
export async function listStageImages(appId: string, pipelineId: string): Promise<Artifact[]> {
  await delay(100)
  return clone(stageImages(appId, pipelineId))
}
export async function listStageRuns(appId: string, pipelineId?: string, stage?: DeploymentStageType): Promise<StageRun[]> {
  await delay(100)
  if (stage !== undefined) assertStage(stage)
  db.stageRuns.forEach(run => advanceStageRun(run))
  return clone(db.stageRuns.filter(run => run.appId === appId && (!pipelineId || run.pipelineId === pipelineId) && (!stage || run.stage === stage)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)))
}
export async function triggerStageRun(appId: string, input: { pipelineId: string; stage: DeploymentStageType; artifactId: string; configVersion: number; workflowVersion: number }): Promise<StageRun> {
  await delay(160)
  assertStage(input.stage)
  const { pipeline, binding, definition } = stagePipeline(appId, input.pipelineId)
  const config = db.appConfigs[appId]
  if (!config || config.version !== input.configVersion || db.workflows[appId]?.version !== input.workflowVersion) throw new MockError('revision_conflict', '配置或流水线已更新，请关闭后重新选择镜像', 409)
  const tasks = input.stage === 'PRECD' ? definition.preTasks : definition.postTasks
  if (!tasks?.length) throw new MockError('validation_error', '此阶段没有可执行任务，请先配置任务', 422)
  const validation = Object.values(validatePipelineTasks(definition.preTasks ?? [], definition.postTasks ?? [])).flat()[0]
  if (validation) throw new MockError('validation_error', validation, 422)
  const settings = deploymentStageOf(definition, input.stage === 'PRECD' ? 'pre' : 'post')
  const refs = (input.stage === 'PRECD' ? definition.preStageResources : definition.postStageResources) ?? emptyStageResources()
  const context = stageResourcesFor(appId, binding.id)
  const message = deploymentStageErrors(settings, context.workerEnabled)[0] ?? stageResourceErrors(refs,context.options)[0]
  if (message) throw new MockError('validation_error', message, 422)
  const artifact = stageImages(appId, pipeline.id).find(item => item.id === input.artifactId)
  if (!artifact) throw new MockError('validation_error', '镜像不属于此应用或上游 CI', 422)
  assertStageIdle(appId, pipeline.id, input.stage)
  const selected = <T extends ConfigMapEntry | SecretEntry>(entries: T[], names: string[]): T[] => effectiveEntries(entries.filter(item=>item.appId===appId && item.environmentId===null),entries.filter(item=>item.appId===appId && item.environmentId===binding.environmentId)).filter(item=>names.includes(item.name))
  const run: StageRun = {
    id: `stage-${crypto.randomUUID()}`, appId, pipelineId: pipeline.id, bindingId: binding.id, environmentId: binding.environmentId,
    stage: input.stage, status: 'queued', configVersion: config.version, workflowVersion: input.workflowVersion,
    snapshot: clone({ tasks, settings, resources: refs, target: binding.target, artifact, build: db.builds.find(build=>build.id===artifact.buildId && build.appId===appId) ?? null, configMaps: selected(db.configMaps,refs.configMaps), secrets: selected(db.configSecrets,refs.secrets) }),
    createdAt: new Date().toISOString(), finishedAt: null, operator: db.currentUser.name, attemptNo: 1, retryOf: null,
  }
  db.stageRuns.unshift(run)
  return clone(run)
}
export async function cancelStageRun(appId: string, id: string): Promise<StageRun> {
  await delay(120)
  const run = stageRecord(appId,id)
  if (!stageIsActive(run.status)) throw new MockError('state_conflict', '此阶段已结束，不能取消', 409)
  run.status = 'canceled'; run.finishedAt = new Date().toISOString()
  return clone(run)
}
export async function retryStageRun(appId: string, id: string): Promise<StageRun> {
  await delay(160)
  const source = stageRecord(appId,id)
  if (!['failed','canceled'].includes(source.status)) throw new MockError('state_conflict', '仅失败或已取消的阶段可以重试', 409)
  const { binding } = stagePipeline(appId,source.pipelineId)
  if (binding.id !== source.bindingId || (['clusterId','namespace','releaseName'] as const).some(key=>binding.target[key]!==source.snapshot.target[key])) throw new MockError('revision_conflict', '目标环境已变更，请重新选择镜像触发', 409)
  const workerEnabled = db.clusters.find(item=>item.id===binding.target.clusterId)?.cdWorkerEnabled === true
  const message = deploymentStageErrors(source.snapshot.settings,workerEnabled)[0]
  if (message) throw new MockError('validation_error',message,422)
  assertStageIdle(appId,source.pipelineId,source.stage)
  const run = clone({ ...source, id: `stage-${crypto.randomUUID()}`, createdAt: new Date().toISOString(), finishedAt: null, status: 'queued' as const, attemptNo: source.attemptNo+1, retryOf: source.id })
  db.stageRuns.unshift(run)
  return clone(run)
}
export async function getStageRunLogs(appId: string, id: string, taskId: string): Promise<string> {
  await delay(80)
  const run = stageRecord(appId,id)
  if (!run.snapshot.tasks.some(task=>task.id===taskId)) throw new MockError('not_found', '任务不属于此阶段运行', 404)
  return stageTaskLog(run,taskId)
}

export async function updateArtifactMetadata(artifactId: string, input: { releaseTags: string[]; notes: string }): Promise<Artifact> {
  const metadata = artifactMetadataInput(input.releaseTags, input.notes)
  const validation = artifactMetadataError(metadata.releaseTags, metadata.notes)
  if (validation) throw new MockError('validation_error', validation, 422)
  await delay(180)
  const artifact = db.artifacts.find((item) => item.id === artifactId)
  if (!artifact) throw new MockError('not_found', '镜像产物不存在', 404)
  artifact.releaseTags = metadata.releaseTags
  artifact.notes = metadata.notes
  return clone(artifact)
}

export interface PreviewInput {
  bindingId: string
  artifactId: string
  expectedConfigVersion: number
}

export interface DeploymentPreview {
  previewId: string
  expiresAt: string
  imageRef: string
  target: Binding['target']
  configVersion: number
  diff: { before: string; after: string }
  warnings: string[]
}

export async function previewDeployment(appId: string, input: PreviewInput): Promise<DeploymentPreview> {
  await delay(280)
  const binding = db.bindingById(input.bindingId)
  const artifact = db.artifacts.find((a) => a.id === input.artifactId)
  const config = db.appConfigs[appId]
  if (!binding) throw new MockError('not_found', '环境绑定不存在', 404)
  if (!artifact) throw new MockError('not_found', '镜像产物不存在', 404)
  if (!config) throw new MockError('not_found', '配置不存在', 404)
  if (input.expectedConfigVersion !== config.version) {
    throw new MockError('revision_conflict', '配置已更新，请重新预览', 409)
  }
  const values = effectiveValues(config.deployValues, binding)
  return {
    previewId: `pv-${Date.now()}`,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    imageRef: artifact.imageRef,
    target: clone(binding.target),
    configVersion: config.version,
    diff: {
      before: `replicas: ${values.replicaCount ?? 1}\nimage: ${artifact.imageRepository}:previous`,
      after: `replicas: ${values.replicaCount ?? 1}\nimage: ${artifact.imageRef}`,
    },
    warnings: binding.environmentId === 'e-prod' ? ['生产环境仅允许手动发布', '发布后需观察 60s 就绪状态'] : [],
  }
}

export async function listDeployments(appId: string) {
  await delay(140)
  return page(clone(db.deploymentsOf(appId)), 1, 50)
}

/** 配置对比专用的完整 Mock 目录，不使用发布列表的 50 条分页截断。 */
export async function getConfigComparisonCatalog(appId: string): Promise<ConfigComparisonCatalog> {
  await delay(160)
  const config = db.appConfigs[appId]
  if (!config) throw new MockError('not_found', '应用配置不存在', 404)
  const bindings = db.bindings.filter(item => item.appId === appId)
  const catalog: ConfigComparisonCatalog = { config, bindings, applicationName: db.appById(appId)?.name ?? '', chartDefaults: comparisonChartDefaults(config.chartConfig),
    environments: db.environments.filter(item => bindings.some(binding => binding.environmentId === item.id)),
    configMaps: db.configMaps.filter(item => item.appId === appId),
    secrets: db.configSecrets.filter(item => item.appId === appId),
    deployments: db.deployments.filter(item => item.appId === appId),
  }
  catalog.variableSnapshots = {}
  for (const environment of ['base', ...new Set(bindings.map(item => item.environmentId))]) {
    const document = resolveComparisonSide(catalog, { environment, version: 'saved' }).document
    const snapshot = document && captureConfigVariables(document, mockScopedVariables(appId, environment))
    if (snapshot) catalog.variableSnapshots[environment] = snapshot
  }
  return clone(catalog)
}

export async function getDeployment(deploymentId: string): Promise<Deployment> {
  await delay(90)
  const deployment = db.deployments.find((d) => d.id === deploymentId)
  if (!deployment) throw new MockError('not_found', '部署记录不存在', 404)
  return clone(deployment)
}

export const CANARY_DEFAULT_STEPS = [20, 50, 100]

export async function confirmDeployment(input: {
  previewId: string
  bindingId: string
  artifactId: string
  imageRef: string
  configVersion: number
  strategy?: DeployStrategy
  canarySteps?: number[]
}): Promise<Deployment> {
  await delay(320)
  const appId = db.bindingById(input.bindingId)?.appId
  if (!appId) throw new MockError('not_found', '环境绑定不存在', 404)
  const strategy: DeployStrategy = input.strategy ?? 'rolling'
  const snapshotBinding = db.bindingById(input.bindingId)!
  const snapshotConfig = db.appConfigs[appId]
  if (!snapshotConfig || snapshotConfig.version !== input.configVersion) throw new MockError('conflict', '配置已变更，请重新预览发布', 409)
  const steps = (input.canarySteps ?? CANARY_DEFAULT_STEPS).filter((step) => step > 0 && step <= 100)
  if (strategy === 'canary' && !steps.length) {
    throw new MockError('validation_error', '灰度至少需要一个放量比例', 422)
  }
  const deployment: Deployment = {
    id: `d-${Date.now()}`,
    requestId: `req-${Date.now()}`,
    appId,
    bindingId: input.bindingId,
    artifactId: input.artifactId,
    imageRef: input.imageRef,
    configVersion: input.configVersion,
    configSnapshot: captureDeploymentConfig(snapshotConfig, snapshotBinding, db.configMaps, db.configSecrets, mockScopedVariables(appId, snapshotBinding.environmentId)),
    status: 'observing',
    kind: 'deploy',
    helmRevision: null,
    createdAt: new Date().toISOString(),
    operator: '张运维',
    reason: null,
    strategy,
    canary: strategy === 'canary' ? { steps, currentStep: 0 } : null,
  }
  db.deployments.unshift(deployment)
  const binding = db.bindingById(input.bindingId)
  if (binding) binding.currentDeploymentId = deployment.id
  return clone(deployment)
}

/** 灰度推进到下一档（P2）：最后一档执行完成后置为成功 */
export async function advanceCanary(deploymentId: string): Promise<Deployment> {
  await delay(260)
  const deployment = db.deployments.find((item) => item.id === deploymentId)
  if (!deployment) throw new MockError('not_found', '部署记录不存在', 404)
  if (deployment.strategy !== 'canary' || !deployment.canary) {
    throw new MockError('conflict', '该发布不是灰度策略', 409)
  }
  if (deployment.status !== 'observing') {
    throw new MockError('conflict', '只有进行中的灰度发布可以推进', 409)
  }
  if (deployment.canary.currentStep >= deployment.canary.steps.length - 1) {
    throw new MockError('conflict', '已经是最后一档，无需推进', 409)
  }
  deployment.canary.currentStep += 1
  if (deployment.canary.currentStep === deployment.canary.steps.length - 1) {
    deployment.status = 'succeeded'
    deployment.helmRevision = (deployment.helmRevision ?? 0) + 1
    deployment.reason = '灰度完成，已全量'
  }
  return clone(deployment)
}

export async function promoteDeployment(deploymentId: string, targetBindingId: string): Promise<Deployment> {
  await delay(300)
  const source = db.deployments.find((d) => d.id === deploymentId)
  const binding = db.bindingById(targetBindingId)
  if (!source || !binding) throw new MockError('not_found', '记录不存在', 404)
  if (source.appId !== binding.appId) throw new MockError('conflict', '只能晋级到同一应用的环境', 409)
  const targetConfig = db.appConfigs[binding.appId]
  if (!targetConfig) throw new MockError('not_found', '应用配置不存在', 404)
  const deployment: Deployment = {
    ...clone(source),
    id: `d-${Date.now()}`,
    requestId: `req-${Date.now()}`,
    bindingId: targetBindingId,
    configVersion: targetConfig.version,
    configSnapshot: captureDeploymentConfig(targetConfig, binding, db.configMaps, db.configSecrets, mockScopedVariables(binding.appId, binding.environmentId)),
    kind: 'promote',
    status: 'observing',
    helmRevision: null,
    createdAt: new Date().toISOString(),
    reason: null,
  }
  db.deployments.unshift(deployment)
  binding.currentDeploymentId = deployment.id
  return clone(deployment)
}

export async function rollbackDeployment(deploymentId: string, reason: string): Promise<Deployment> {
  await delay(300)
  const source = db.deployments.find((d) => d.id === deploymentId)
  if (!source) throw new MockError('not_found', '部署记录不存在', 404)
  const deployment: Deployment = {
    ...clone(source),
    id: `d-${Date.now()}`,
    requestId: `req-${Date.now()}`,
    kind: 'rollback',
    status: 'observing',
    helmRevision: null,
    createdAt: new Date().toISOString(),
    reason,
  }
  db.deployments.unshift(deployment)
  const binding = db.bindingById(source.bindingId)
  if (binding) binding.currentDeploymentId = deployment.id
  return clone(deployment)
}

// ---------------- 集群与资源 ----------------
export async function listClusters(): Promise<Cluster[]> {
  await delay(120)
  return clone(db.clusters)
}

export async function getCluster(clusterId: string): Promise<Cluster> {
  await delay(80)
  const cluster = db.clusterById(clusterId)
  if (!cluster) throw new MockError('not_found', '集群不存在', 404)
  return clone(cluster)
}

export async function discoverResources(clusterId: string): Promise<ResourceType[]> {
  await delay(160)
  if (!db.clusterById(clusterId)) throw new MockError('not_found', '集群不存在', 404)
  return clone(db.resourceTypes)
}

export async function listNamespace(clusterId: string): Promise<Namespace[]> {
  await delay(100)
  return clone(db.namespaces[clusterId] ?? [])
}

export interface ResourceQuery {
  group: string
  resource: string
  namespace?: string
  keyword?: string
}

export async function listResources(clusterId: string, query: ResourceQuery): Promise<K8sResource[]> {
  await delay(150)
  const all = db.resources.filter((r) => r.ref.resource === query.resource && r.ref.group === query.group)
  const scoped = all.filter((r) => belongsToCluster(r, clusterId))
  return clone(
    scoped.filter((r) => {
      if (query.namespace && query.namespace !== 'all' && r.ref.namespace !== query.namespace) return false
      if (query.keyword && !r.ref.name.toLowerCase().includes(query.keyword.toLowerCase())) return false
      return true
    }),
  )
}

export async function getResource(clusterId: string, group: string, resource: string, namespace: string, name: string): Promise<K8sResource> {
  await delay(120)
  if (!db.clusterById(clusterId)) throw new MockError('not_found', '集群不存在', 404)
  const found = db.resources.find(
    (r) => belongsToCluster(r, clusterId) && r.ref.resource === resource && r.ref.namespace === namespace && r.ref.name === name && r.ref.group === group,
  )
  if (!found && resource === 'namespaces') {
    const item = (db.namespaces[clusterId] ?? []).find((entry) => entry.name === name)
    if (item) return { ref: { group: '', version: 'v1', resource, namespace: '_cluster', name, uid: item.uid }, kind: 'Namespace', status: item.phase, summary: '', ownerRefs: [], appId: null, manifest: `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${name}\nstatus:\n  phase: ${item.phase}\n` }
  }
  if (!found) throw new MockError('not_found', '资源不存在', 404)
  return clone(found)
}

export async function listEvents(uid: string): Promise<ResourceEvent[]> {
  await delay(120)
  return clone(db.events[uid] ?? [])
}

/** Frontend-only desired state; never synthesize intent from an edited live manifest. */
export async function getDesiredResourceManifest(clusterId: string, ref: ResourceRef): Promise<DesiredResourceManifest | null> {
  const resource = await getResource(clusterId, ref.group, ref.resource, ref.namespace, ref.name)
  if (resource.ref.uid !== ref.uid) throw new MockError('revision_conflict', '资源已被重建，请刷新详情后重新比较', 409)
  if (!resource.appId || resource.ownerRefs.length) return null
  return desiredResourceSnapshot(resource.ref.uid)
}

export async function getPodLogs(
  uid: string,
  options?: PodLogOptions,
): Promise<string[]> {
  await delay(options?.container || options?.sinceSeconds ? 260 : 180)
  const resource = db.resources.find(item => item.ref.uid === uid && item.kind === 'Pod')
  if (!resource) throw new MockError('not_found', 'Pod 不存在', 404)
  const container = options?.container ?? podContainers(resource.manifest)[0]?.name
  if (!container || !podContainers(resource.manifest).some(item => item.name === container)) throw new MockError('not_found', '所选容器不存在', 404)
  const key = `${uid}/${container}`
  const lines = options?.previous ? db.previousPodLogs[key] : db.containerPodLogs[key] ?? (container === 'app' ? db.podLogs[uid] : undefined)
  if (options?.previous && !lines) throw new MockError('previous_logs_unavailable', `容器 ${container} 没有上一次终止实例的日志`, 404)
  if (!lines) throw new MockError('not_found', '该资源没有容器日志', 404)
  let result = clone(lines)
  if (options?.sinceSeconds !== undefined || options?.sinceTime) {
    const cutoff = options.sinceTime ? Date.parse(options.sinceTime) : Date.now() - options!.sinceSeconds! * 1000
    if (!Number.isFinite(cutoff)) throw new MockError('invalid_input', '日志开始时间无效', 400)
    result = result.filter((line) => {
      const at = Date.parse(line.slice(0, 24))
      return Number.isNaN(at) ? true : at >= cutoff
    })
    // 原演示数据都在过去较久，窗口过滤后为空时保留尾部 3 行，避免“空日志”误判；现在返回真实空结果供页面展示。
  }
  if (options?.tailLines) result = result.slice(-options.tailLines)
  // 上一容器日志：原 mock 复用当前日志并显式标注来源；现在读取独立的终止实例 fixture。
  return result
}

export async function listApplicationResources(appId: string, bindingId: string): Promise<K8sResource[]> {
  await delay(140)
  const binding = db.bindingById(bindingId)
  if (!binding) throw new MockError('not_found', '环境绑定不存在', 404)
  // 应用运行资源按绑定目标 Namespace 收敛，避免把其它环境的对象混入当前上下文
  const items = db.resourcesOfApp(appId).filter((r) => r.ref.namespace === binding.target.namespace)
  return clone(items)
}

export interface ClusterEventRow {
  id: string
  namespace: string
  kind: string
  name: string
  type: string
  reason: string
  message: string
  count: number
  lastSeenAt: string | null
}

/** 集群级事件列表：把各资源的事件聚合成一张表（对应 Devtron Resource Browser 的 Events） */
export async function listClusterEvents(clusterId: string): Promise<ClusterEventRow[]> {
  await delay(150)
  if (!db.clusterById(clusterId)) throw new MockError('not_found', '集群不存在', 404)
  const rows: ClusterEventRow[] = []
  for (const [uid, list] of Object.entries(db.events)) {
    const owner = db.resources.find((item) => item.ref.uid === uid)
    if (!owner || !belongsToCluster(owner, clusterId)) continue
    for (const [index, event] of list.entries()) {
      rows.push({
        id: `${uid}-${index}`,
        namespace: owner.ref.namespace === '_cluster' ? '—' : owner.ref.namespace,
        kind: owner.kind,
        name: owner.ref.name,
        type: event.type,
        reason: event.reason,
        message: event.message,
        count: event.count,
        lastSeenAt: event.lastSeenAt,
      })
    }
  }
  return clone(rows)
}

export async function getClusterOverview(clusterId: string): Promise<ClusterOverview> {
  await delay(120)
  if (!db.clusterById(clusterId)) throw new MockError('not_found', '集群不存在', 404)
  const overview = db.clusterOverviews[clusterId]
  if (!overview) throw new MockError('not_found', '集群概览不存在', 404)
  return clone(overview)
}

export async function getNodeDetail(clusterId: string, name: string): Promise<NodeDetail> {
  await delay(160)
  if (!db.clusterById(clusterId)) throw new MockError('not_found', '集群不存在', 404)
  const detail = db.nodeDetails[name]
  const matchesCluster = clusterId === 'c-prod' ? name.startsWith('prod-') : clusterId === 'c-dev' && name.startsWith('dev-')
  if (!detail || !matchesCluster) throw new MockError('not_found', '节点不存在', 404)
  return clone(detail)
}

export interface ResourceActionInput {
  ref: ResourceRef
  action: 'delete' | 'restart' | 'scale' | 'cordon' | 'uncordon' | 'drain' | 'taints'
  replicas?: number
  force?: boolean
  ignoreDaemonSets?: boolean
  deleteEmptyDirData?: boolean
  taints?: NodeTaint[]
}

/** 资源操作的本地 Mock：提交后更新同一数据源，供两个 Manager 读回。 */
export async function performResourceAction(clusterId: string, input: ResourceActionInput): Promise<void> {
  await delay(180)
  const { ref, action } = input
  const target = await getResource(clusterId, ref.group, ref.resource, ref.namespace, ref.name)
  if (target.ref.uid !== ref.uid) throw new MockError('revision_conflict', '对象已被重建，请刷新后重试', 409)
  const index = db.resources.findIndex((item) => item.ref.uid === ref.uid && belongsToCluster(item, clusterId))
  const row = db.resources[index]
  const node = target.kind === 'Node' ? db.nodeDetails[ref.name] : undefined
  if (action === 'delete') {
    if (index >= 0) db.resources.splice(index, 1)
    if (node) delete db.nodeDetails[ref.name]
    if (target.kind === 'Namespace') db.namespaces[clusterId] = (db.namespaces[clusterId] ?? []).filter((item) => item.uid !== ref.uid)
  } else if (action === 'scale') {
    if (!row || !['Deployment', 'StatefulSet', 'ReplicaSet'].includes(row.kind)) throw new MockError('validation_error', '该资源不支持副本扩缩容', 422)
    if (!Number.isInteger(input.replicas) || input.replicas! < 0 || input.replicas! > 10000) throw new MockError('validation_error', '副本数需为 0–10000 的整数', 422)
    const field = `  replicas: ${input.replicas}`
    row.manifest = /^  replicas:\s*\d+/m.test(row.manifest) ? row.manifest.replace(/^  replicas:\s*\d+/m, field) : row.manifest.replace(/^spec:\s*$/m, `spec:\n${field}`)
    row.summary = `${input.replicas}/${input.replicas} ready（Mock）`
    row.status = input.replicas === 0 ? 'Stopped' : 'Available'
  } else if (action === 'restart') {
    if (!row || !['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet'].includes(row.kind)) throw new MockError('validation_error', '该资源不支持滚动重启', 422)
    // Mock 只记录重启事件；真实实现应更新 Pod template annotation，由控制器滚动重建。
    const events = db.events[ref.uid] ?? (db.events[ref.uid] = [])
    events.unshift({ type: 'Normal', reason: 'Restarted', message: '本地 Mock：已提交工作负载重启', count: 1, lastSeenAt: new Date().toISOString() })
  } else {
    if (!node || !row) throw new MockError('validation_error', '此操作只支持 Node', 422)
    if (action === 'taints') {
      if (input.taints?.some((taint) => !taint.key.trim() || !['NoSchedule', 'PreferNoSchedule', 'NoExecute'].includes(taint.effect))) throw new MockError('validation_error', '请填写有效的 Taint key 和 effect', 422)
      node.taints = clone(input.taints ?? [])
    } else {
      node.unschedulable = action !== 'uncordon'
      if (action === 'drain') {
        const daemonPods = node.pods.filter((pod) => db.resources.find((resource) => resource.ref.name === pod.name && resource.kind === 'Pod')?.ownerRefs.some((owner) => owner.toLowerCase().includes('daemonset')))
        node.pods = input.ignoreDaemonSets ? daemonPods : []
      }
      row.status = node.unschedulable ? `${node.status},SchedulingDisabled` : node.status
    }
    // 节点 YAML 与概要共用写入结果，避免重新打开后回到旧状态。
    const specPattern = /^spec:[ \t]*\n(?:[ \t]+[^\n]*(?:\n|$)|\n)*/m
    const originalSpec = specPattern.exec(node.manifest)?.[0]
    let spec = (originalSpec ?? 'spec:\n')
      .replace(/^  unschedulable:[^\n]*(?:\n|$)/m, '')
      .replace(/^  taints:[^\n]*(?:\n(?: {4,}[^\n]*|  -[^\n]*))*(?:\n|$)/m, '')
    if (!spec.endsWith('\n')) spec += '\n'
    spec += `  unschedulable: ${node.unschedulable}\n  taints:${node.taints.length ? '\n' + node.taints.map((taint) => `    - key: ${JSON.stringify(taint.key)}\n      value: ${JSON.stringify(taint.value)}\n      effect: ${taint.effect}`).join('\n') : ' []'}\n`
    node.manifest = originalSpec ? node.manifest.replace(specPattern, () => spec) : `${node.manifest.trimEnd()}\n${spec}`
    row.manifest = node.manifest
  }
  db.auditEvents.unshift({ id: `au-${crypto.randomUUID()}`, actorId: db.currentUser.id, actorName: db.currentUser.name, action: `resource.${action}`, target: `${target.kind}/${ref.namespace}/${ref.name}@${clusterId}`, result: 'succeeded', createdAt: new Date().toISOString() })
}

// ---------------- 资源写入（P1：Dry run / Apply / 操作结果） ----------------
export interface DryRunDocumentResult {
  index: number
  ref: string
  status: 'valid' | 'invalid'
  message: string
}

export interface DryRunResult {
  documents: DryRunDocumentResult[]
  valid: boolean
}

export interface ApplyItemResult {
  ref: string
  result: 'succeeded' | 'failed' | 'skipped'
  message: string
}

export interface ApplyResult {
  operationId: string
  status: 'succeeded' | 'failed' | 'partial'
  items: ApplyItemResult[]
}

interface ParsedDoc {
  kind: string
  name: string
  namespace: string
  group: string
  resource: string
  version: string
  validationError: string
}

const KIND_TO_RESOURCE: Record<string, { group: string; resource: string }> = {
  ConfigMap: { group: '', resource: 'configmaps' },
  Secret: { group: '', resource: 'secrets' },
  Service: { group: '', resource: 'services' },
  Deployment: { group: 'apps', resource: 'deployments' },
  Job: { group: 'batch', resource: 'jobs' },
  Ingress: { group: 'networking.k8s.io', resource: 'ingresses' },
  Namespace: { group: '', resource: 'namespaces' },
}

/** 极简 YAML 扫描曾只取 kind / metadata.name / metadata.namespace；现按 YAML 文档解析，仍不做 Kubernetes schema 验证。 */
function parseDocuments(manifest: string): Array<ParsedDoc & { body: string }> {
  const documents = resourceYamlDocuments(manifest)
  return documents.map((document) => {
    const body = documents.length === 1 ? manifest : document.toString()
    let identity = { kind: '', name: '', apiVersion: 'v1', namespace: '' }
    let validationError = ''
    try { identity = resourceIdentity(document); if (identity.kind === 'Node') validationError = nodeManifestError(document.toJS({ maxAliasCount: 100 })) } catch (error) { validationError = error instanceof Error ? error.message : 'Manifest 无效' }
    const { kind, name, apiVersion } = identity
    const [group, version] = apiVersion.includes('/') ? apiVersion.split('/') : ['', apiVersion]
    const type = db.resourceTypes.find((item) => item.kind === kind && item.group === group)
    const namespace = type?.namespaced === false ? '_cluster' : identity.namespace || 'default'
    const mapping = type ?? KIND_TO_RESOURCE[kind] ?? { group, resource: kind.toLowerCase() }
    return { kind, name, namespace, group: mapping.group, resource: mapping.resource, version: version ?? 'v1', body, validationError }
  })
}

export async function dryRunResource(
  clusterId: string,
  input: { namespace?: string; manifest: string },
): Promise<DryRunResult> {
  await delay(240)
  if (!db.clusterById(clusterId)) throw new MockError('not_found', '集群不存在', 404)
  if (!input.manifest.trim()) throw new MockError('validation_error', 'Manifest 不能为空', 422)
  const docs = parseDocuments(input.manifest)
  if (!docs.length) throw new MockError('validation_error', 'Manifest 至少需要一个资源文档', 422)
  const documents: DryRunDocumentResult[] = docs.map((doc, index) => {
    if (doc.validationError) {
      return { index, ref: `${doc.kind || '?'}/${doc.name || '?'}`, status: 'invalid', message: doc.validationError }
    }
    const exists = db.resources.some(
      (item) => belongsToCluster(item, clusterId) && item.ref.group === doc.group && item.ref.resource === doc.resource && item.ref.name === doc.name && item.ref.namespace === doc.namespace,
    )
    return {
      index,
      ref: `${doc.kind}/${doc.name}`,
      status: 'valid',
      message: exists ? '本地字段检查通过，将更新现有对象' : '将创建新对象',
    }
  })
  return { documents, valid: documents.every((item) => item.status === 'valid') }
}

export async function applyResource(
  clusterId: string,
  input: { manifest: string; expectedUid?: string; expectedManifest?: string },
): Promise<ApplyResult> {
  await delay(360)
  if (!db.clusterById(clusterId)) throw new MockError('not_found', '集群不存在', 404)
  const docs = parseDocuments(input.manifest)
  const items: ApplyItemResult[] = []
  for (const doc of docs) {
    const ref = `${doc.kind}/${doc.name}`
    if (doc.validationError) {
      items.push({ ref, result: 'failed', message: doc.validationError })
      continue
    }
    let existing = db.resources.find(
      (item) => belongsToCluster(item, clusterId) && item.ref.group === doc.group && item.ref.resource === doc.resource && item.ref.name === doc.name && item.ref.namespace === doc.namespace,
    )
    // Namespace 列表 fixture 与通用资源共用同一个 UID，首次编辑时接入通用资源存储。
    if (!existing && doc.kind === 'Namespace' && (db.namespaces[clusterId] ?? []).some((item) => item.name === doc.name)) {
      existing = await getResource(clusterId, doc.group, doc.resource, doc.namespace, doc.name)
      resourceClusters.set(existing.ref.uid, clusterId)
      db.resources.push(existing)
    }
    if (existing) {
      if (input.expectedUid && existing.ref.uid !== input.expectedUid) {
        items.push({ ref, result: 'failed', message: '对象已被重建（UID 不一致），请重新读取后再提交' })
        continue
      }
      if (input.expectedManifest !== undefined && input.expectedManifest !== existing.manifest) throw new MockError('revision_conflict', '资源已被更新，当前草稿已保留；请重新读取后再提交', 409)
      existing.manifest = retainManagedFields(existing.manifest, doc.body)
      if (existing.kind === 'Node' && db.nodeDetails[doc.name]) syncNodeDetailManifest(db.nodeDetails[doc.name]!, existing.manifest)
      items.push({ ref, result: 'succeeded', message: '已更新' })
    } else {
      if (input.expectedUid) {
        items.push({ ref, result: 'failed', message: '原对象已不存在，请重新读取后再提交' })
        continue
      }
      const uid = `uid-${doc.resource}-${crypto.randomUUID()}`
      resourceClusters.set(uid, clusterId)
      db.resources.push({
        ref: {
          group: doc.group,
          version: doc.version,
          resource: doc.resource,
          namespace: doc.namespace,
          name: doc.name,
          uid,
        },
        kind: doc.kind,
        status: doc.kind === 'ConfigMap' ? 'Active' : 'Created',
        summary: '由 Manifest Apply 创建',
        manifest: doc.body,
        ownerRefs: [],
        appId: null,
      })
      if (doc.kind === 'Namespace') {
        const list = db.namespaces[clusterId] ?? (db.namespaces[clusterId] = [])
        list.push({ name: doc.name, uid, phase: 'Active' })
      }
      items.push({ ref, result: 'succeeded', message: '已创建' })
    }
  }
  const status = items.every((item) => item.result === 'succeeded')
    ? 'succeeded'
    : items.some((item) => item.result === 'succeeded')
      ? 'partial'
      : 'failed'
  return { operationId: `op-${Date.now()}`, status, items }
}

/** 发布未知结果核对：模拟读回 Helm release 状态后落定 */
export async function reconcileDeployment(deploymentId: string): Promise<Deployment> {
  await delay(320)
  const deployment = db.deployments.find((item) => item.id === deploymentId)
  if (!deployment) throw new MockError('not_found', '部署记录不存在', 404)
  if (deployment.status !== 'unknown') throw new MockError('conflict', '只有未知结果需要核对', 409)
  deployment.status = 'succeeded'
  deployment.helmRevision = (deployment.helmRevision ?? 0) + 1
  deployment.reason = '核对后确认 release 已就绪'
  return clone(deployment)
}

/** 导入已有镜像并固定 digest */
export async function importArtifact(appId: string, input: { imageRef: string; digest: string }): Promise<Artifact> {
  await delay(280)
  const app = db.appById(appId)
  if (!app) throw new MockError('not_found', '应用不存在', 404)
  if (!/^sha256:[a-f0-9]{64}$/.test(input.digest)) {
    throw new MockError('validation_error', 'digest 必须是 sha256: 加 64 位小写十六进制', 422)
  }
  const repository = artifactImageRepository(input.imageRef)
  const artifact: Artifact = {
    id: `ar-${Date.now()}`,
    appId,
    buildId: null,
    source: 'external',
    imageRepository: repository,
    digest: input.digest,
    imageRef: input.imageRef,
    createdAt: new Date().toISOString(),
  }
  db.artifacts.unshift(artifact)
  return clone(artifact)
}

/** 环境覆盖保存（P1）：乐观锁 + 覆盖版本自增 */
export async function updateAppBinding(
  appId: string,
  bindingId: string,
  input: {
    expectedVersion: number
    overrideValues: DeployValues
    autoDeploy?: boolean
    overrideEnabled?: boolean
    overrideMergeStrategy?: 'patch' | 'replace'
    overrideValuesYaml?: string
  },
): Promise<Binding> {
  await delay(240)
  const binding = db.bindingById(bindingId)
  if (!binding || binding.appId !== appId) throw new MockError('not_found', '环境绑定不存在', 404)
  if (binding.version !== input.expectedVersion) {
    throw new MockError('revision_conflict', '环境绑定已被更新，请重新读取后再保存', 409)
  }
  binding.overrideValues = clone(input.overrideValues)
  if (input.overrideEnabled !== undefined) binding.overrideEnabled = input.overrideEnabled
  if (input.overrideMergeStrategy) binding.overrideMergeStrategy = input.overrideMergeStrategy
  binding.overrideValuesYaml = input.overrideValuesYaml
  if (typeof input.autoDeploy === 'boolean') binding.autoDeploy = input.autoDeploy
  binding.version += 1
  return clone(binding)
}

export async function createCluster(input: {
  name: string
  apiServer: string
  credentialId: string | null
}): Promise<Cluster> {
  await delay(300)
  if (!input.name.trim()) throw new MockError('validation_error', '集群名称不能为空', 422)
  if (!/^https:\/\//.test(input.apiServer)) throw new MockError('validation_error', 'API Server 必须是 HTTPS 地址', 422)
  if (db.clusters.some((item) => item.name === input.name)) {
    throw new MockError('conflict', '同名集群已存在', 409)
  }
  const cluster: Cluster = {
    id: `c-${Date.now()}`,
    name: input.name,
    apiServer: input.apiServer,
    connectionStatus: 'unknown',
    serverVersion: null,
    lastCheckedAt: null,
    nodeCount: 0,
    environmentNames: [],
  }
  db.clusters.push(cluster)
  return clone(cluster)
}

export async function createCredential(input: {
  name: string
  kind: Credential['kind']
}): Promise<Credential> {
  await delay(260)
  if (!input.name.trim()) throw new MockError('validation_error', '凭据名称不能为空', 422)
  if (db.credentials.some((item) => item.name === input.name)) {
    throw new MockError('conflict', '同名凭据已存在', 409)
  }
  const credential: Credential = {
    id: `cr-${Date.now()}`,
    name: input.name,
    kind: input.kind,
    version: 1,
    updatedAt: new Date().toISOString(),
  }
  db.credentials.push(credential)
  return clone(credential)
}

export async function rotateCredential(credentialId: string): Promise<Credential> {
  await delay(260)
  const credential = db.credentials.find((item) => item.id === credentialId)
  if (!credential) throw new MockError('not_found', '凭据不存在', 404)
  credential.version += 1
  credential.updatedAt = new Date().toISOString()
  return clone(credential)
}

export async function updateRegistry(
  registryId: string,
  input: { name: string; endpoint: string; credentialId: string | null },
): Promise<Registry> {
  await delay(240)
  const registry = db.registries.find((item) => item.id === registryId)
  if (!registry) throw new MockError('not_found', '镜像仓库不存在', 404)
  if (!registryNameAvailable(input.name, registryId)) throw new MockError('conflict', '同名镜像仓库已存在', 409)
  registry.name = input.name
  registry.endpoint = input.endpoint
  registry.credentialId = input.credentialId
  return clone(registry)
}

function registryNameAvailable(name: string, ignoreId?: string): boolean {
  return !db.registries.some((item) => item.name === name && item.id !== ignoreId)
}

export async function createRegistry(input: {
  name: string
  endpoint: string
  credentialId: string | null
}): Promise<Registry> {
  await delay(260)
  if (!input.name.trim()) throw new MockError('validation_error', '镜像仓库名称不能为空', 422)
  if (!/^https:\/\//.test(input.endpoint)) throw new MockError('validation_error', 'Endpoint 必须是 HTTPS 地址', 422)
  if (db.registries.some((item) => item.name === input.name)) {
    throw new MockError('conflict', '同名镜像仓库已存在', 409)
  }
  const registry: Registry = {
    id: `r-${Date.now()}`,
    name: input.name,
    endpoint: input.endpoint,
    credentialId: input.credentialId,
  }
  db.registries.push(registry)
  return clone(registry)
}

// ---------------- P2：Secret 明文 / 终端会话 / 指标 ----------------
export interface SecretRevealResult {
  name: string
  namespace: string
  keys: Array<{ key: string; value: string }>
  auditId: string
}

const secretValues: Record<string, Array<{ key: string; value: string }>> = {
  'checkout-api-secret': [
    { key: 'db-password', value: 'Pg!7xQ2mZk91' },
    { key: 'jwt-secret', value: 'c2VjcmV0LWRlbW8tc2lnbmluZy1rZXk=' },
  ],
  'payment-secret': [
    { key: 'provider-token', value: 'sk_live_demo_9f2c41' },
    { key: 'webhook-secret', value: 'whsec_demo_7a1b' },
  ],
}

/** 明文读取：独立授权 + 审计（P2 / SC-01） */
export async function revealSecret(clusterId: string, namespace: string, name: string): Promise<SecretRevealResult> {
  await delay(320)
  if (!db.clusterById(clusterId)) throw new MockError('not_found', '集群不存在', 404)
  const secret = db.resources.find(
    (item) => item.ref.resource === 'secrets' && item.ref.name === name && item.ref.namespace === namespace,
  )
  if (!secret) throw new MockError('not_found', 'Secret 不存在', 404)
  const keys = secretValues[name] ?? [{ key: 'value', value: 'ZGVtby1zZWNyZXQtdmFsdWU=' }]
  const auditId = `au-${Date.now()}`
  db.auditEvents.unshift({
    id: auditId,
    actorId: 'u-1',
    actorName: '张运维',
    action: 'secret.reveal',
    target: `Secret/${name}@${namespace}`,
    result: 'succeeded',
    createdAt: new Date().toISOString(),
  })
  return { name, namespace, keys: clone(keys), auditId }
}

export interface ExecSession {
  sessionId: string
  clusterId: string
  namespace: string
  pod: string | null
  container: string
  shell: PodShell
  createdAt: string
  expiresAt: string
}

const execSessions = new Map<string, ExecSession>()
let execSequence = 0

/** 终端会话（P2 / EX-02）：一次 ticket 换一次会话，30 分钟过期 */
export async function createExecSession(
  clusterId: string,
  input: { namespace: string; pod?: string; container?: string; shell?: PodShell; resourceUid?: string },
): Promise<ExecSession> {
  await delay(220)
  if (!db.clusterById(clusterId)) throw new MockError('not_found', '集群不存在', 404)
  if (input.shell !== undefined && !isPodShell(input.shell)) throw new MockError('validation_error', '不支持的 Shell', 422)
  let container = input.container
  if (input.pod) {
    const pod = db.resources.find(
      (item) => item.ref.resource === 'pods' && item.ref.name === input.pod && item.ref.namespace === input.namespace && belongsToCluster(item, clusterId),
    )
    if (!pod) throw new MockError('not_found', 'Pod 不存在', 404)
    if (input.resourceUid && input.resourceUid !== pod.ref.uid) throw new MockError('conflict', 'Pod 已重新创建，请刷新后重试', 409)
    container = input.container ?? podContainers(pod.manifest)[0]?.name ?? ''
    const reason = podTerminalError(pod, container)
    if (reason) throw new MockError('exec_unavailable', reason, 409)
  }
  const now = Date.now()
  const session: ExecSession = {
    sessionId: `sess-${now.toString(36)}-${++execSequence}`,
    clusterId,
    namespace: input.namespace,
    pod: input.pod ?? null,
    container: container ?? 'app',
    shell: input.shell ?? 'sh',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
  }
  execSessions.set(session.sessionId, session)
  return clone(session)
}

export async function closeExecSession(sessionId: string): Promise<void> {
  await delay(120)
  if (!execSessions.has(sessionId)) throw new MockError('not_found', '会话不存在或已过期', 404)
  execSessions.delete(sessionId)
}

export interface MetricPoint {
  at: string
  cpu: number
  memory: number
  replicas: number
}

/** 发布指标趋势（P2）：稳定的伪随机序列，同一部署多次读取结果一致 */
export async function getDeploymentMetrics(deploymentId: string): Promise<MetricPoint[]> {
  await delay(200)
  const deployment = db.deployments.find((item) => item.id === deploymentId)
  if (!deployment) throw new MockError('not_found', '部署记录不存在', 404)
  const seed = Number.parseInt(deploymentId.replace(/\D/g, '') || '7', 10)
  const baseReplicas = deployment.status === 'failed' ? 0 : deployment.status === 'unknown' ? 1 : 2
  const points: MetricPoint[] = []
  const base = new Date(deployment.createdAt).getTime()
  for (let index = 0; index < 24; index += 1) {
    const wave = Math.sin((index + (seed % 5)) / 3) * 6
    const drift = (index / 24) * 8
    points.push({
      at: new Date(base + index * 15 * 60 * 1000).toISOString(),
      cpu: Math.max(2, Math.round((18 + wave + drift + ((seed + index * 7) % 9)) * 10) / 10),
      memory: Math.max(64, Math.round(180 + wave * 8 + drift * 6 + ((seed + index * 5) % 40))),
      replicas: baseReplicas + (index > 16 ? 1 : 0),
    })
  }
  return points
}

/** 应用元信息编辑：描述 / 所属项目 / 标签 / Readme */
export async function updateApplication(
  appId: string,
  patch: { description?: string; projectId?: string; tags?: string[]; labels?: ApplicationLabel[]; legacyTags?: string[]; readme?: string; archived?: boolean },
): Promise<Application> {
  await delay(220)
  const app = db.appById(appId)
  if (!app) throw new MockError('not_found', '应用不存在', 404)
  if (patch.projectId !== undefined && !db.projects.some((item) => item.id === patch.projectId)) {
    throw new MockError('not_found', '目标项目不存在', 404)
  }
  if (patch.projectId && db.applications.some(item => item.id !== app.id && !item.archivedAt && item.projectId === patch.projectId && item.name === app.name)) {
    throw new MockError('conflict', '目标项目下已存在同名应用', 409)
  }
  const descriptionError = patch.description === undefined ? '' : applicationDescriptionError(patch.description)
  if (descriptionError) throw new MockError('validation_error', descriptionError, 422)
  if (patch.tags && (patch.labels !== undefined || patch.legacyTags !== undefined)) throw new MockError('validation_error', '不能同时使用旧版和结构化标签格式', 422)
  const labels = patch.labels === undefined ? undefined : applicationLabels(patch.labels)
  if (labels && applicationTagErrors(labels).some(error => error.key || error.value)) throw new MockError('validation_error', '标签缺失或格式无效', 422)
  if (labels?.some(label => typeof label.propagate !== 'boolean')) throw new MockError('validation_error', '标签传播设置无效', 422)
  const legacyTags = patch.legacyTags ?? legacyApplicationTags(app)
  if (!Array.isArray(legacyTags) || legacyTags.some(tag => typeof tag !== 'string' || !tag.trim())) throw new MockError('validation_error', '旧版标签格式无效', 422)
  // Finish validation before mutating any field: a failed project move must not
  // accidentally save the description or clear labels.
  if (typeof patch.description === 'string') app.description = patch.description.trim()
  if (patch.projectId) app.projectId = patch.projectId
  // Compatibility for older callers editing plain tags; the overview now uses
  // structured labels and explicitly retains or removes legacy display tags.
  if (Array.isArray(patch.tags)) { app.tags = [...patch.tags]; app.labels = undefined }
  if (labels !== undefined || patch.legacyTags !== undefined) {
    app.labels = clone(labels ?? app.labels ?? [])
    app.tags = [...new Set([...legacyTags,...app.labels.map(label => `${label.key}:${label.value}`)])]
  }
  if (typeof patch.readme === 'string') {
    app.readme = patch.readme
    app.readmeUpdatedAt = new Date().toISOString()
    app.readmeUpdatedBy = db.currentUser.name
  }
  if (typeof patch.archived === 'boolean') {
    app.archivedAt = patch.archived ? new Date().toISOString() : null
  }
  app.updatedAt = new Date().toISOString()
  return clone(app)
}

export async function createProject(input: { name: string; teamId: string; description?: string }): Promise<Project> {
  await delay(260)
  if (!input.name.trim()) throw new MockError('validation_error', '项目名称不能为空', 422)
  if (db.projects.some((item) => item.name === input.name.trim())) {
    throw new MockError('conflict', '同名项目已存在', 409)
  }
  const project: Project = {
    id: `p-${Date.now()}`,
    teamId: input.teamId,
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
  }
  db.projects.push(project)
  return clone(project)
}

export async function createEnvironment(input: {
  name: string
  production: boolean
  autoDeployAllowed: boolean
}): Promise<Environment> {
  await delay(240)
  if (!input.name.trim()) throw new MockError('validation_error', '环境名称不能为空', 422)
  if (db.environments.some((item) => item.name === input.name.trim())) {
    throw new MockError('conflict', '同名环境已存在', 409)
  }
  const environment: Environment = {
    id: `env-${Date.now()}`,
    name: input.name.trim(),
    production: input.production,
    autoDeployAllowed: input.autoDeployAllowed,
  }
  db.environments.push(environment)
  return clone(environment)
}

export async function updateEnvironment(
  id: string,
  input: { name: string; production: boolean; autoDeployAllowed: boolean },
): Promise<Environment> {
  await delay(220)
  const environment = db.environments.find((item) => item.id === id)
  if (!environment) throw new MockError('not_found', '环境不存在', 404)
  const name = input.name.trim()
  if (!name) throw new MockError('validation_error', '环境名称不能为空', 422)
  if (db.environments.some((item) => item.id !== id && item.name === name)) {
    throw new MockError('conflict', '同名环境已存在', 409)
  }
  environment.name = name
  environment.production = input.production
  environment.autoDeployAllowed = input.production ? false : input.autoDeployAllowed
  return clone(environment)
}

/** 连接测试：探测成功后就地更新状态、版本与检测时间 */
export async function testClusterConnection(clusterId: string): Promise<Cluster> {
  await delay(600)
  const cluster = db.clusterById(clusterId)
  if (!cluster) throw new MockError('not_found', '集群不存在', 404)
  cluster.connectionStatus = 'connected'
  cluster.serverVersion = cluster.serverVersion ?? 'v1.29.4'
  cluster.lastCheckedAt = new Date().toISOString()
  cluster.nodeCount = cluster.nodeCount || 3
  return clone(cluster)
}

export interface AppMonitoring {
  cpu: number[]
  memory: number[]
  status2xx: number
  status3xx: number
  status5xx: number
  throughput: number[]
  latency: number[]
}

/** 应用监控（App Details 的 MONITORING 区）：确定性 mock 序列 */
export async function getAppMonitoring(appId: string, bindingId: string): Promise<AppMonitoring> {
  await delay(220)
  if (!db.appById(appId)) throw new MockError('not_found', '应用不存在', 404)
  const seedBase = `${appId}:${bindingId}`.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  const series = (base: number, amp: number): number[] =>
    Array.from({ length: 24 }, (_, index) => {
      const wave = Math.sin((index + (seedBase % 7)) / 3) * amp
      const drift = (index / 24) * amp * 0.5
      return Math.max(1, Math.round((base + wave + drift + ((seedBase + index * 5) % 7)) * 10) / 10)
    })
  return {
    cpu: series(18, 6),
    memory: series(220, 40),
    status2xx: 1800 + (seedBase % 400),
    status3xx: 120 + (seedBase % 60),
    status5xx: (seedBase % 9) + 1,
    throughput: series(42, 8),
    latency: series(86, 18),
  }
}

// ---------------- 应用 / 资源动作（对齐 Devtron 交互） ----------------
export interface WorkloadActionResult {
  operationId: string
  workloads: string[]
}

const workloadOperationStore: WorkloadActionResult[] = []

/** 重启工作负载（对应 Devtron Restart workloads） */
export async function restartWorkloads(appId: string, bindingId: string, workloads: string[]): Promise<WorkloadActionResult> {
  await delay(320)
  if (!db.appById(appId)) throw new MockError('not_found', '应用不存在', 404)
  if (!db.bindingById(bindingId)) throw new MockError('not_found', '环境绑定不存在', 404)
  if (!workloads.length) throw new MockError('validation_error', '至少选择一个工作负载', 422)
  const result = { operationId: `op-${Date.now()}`, workloads }
  workloadOperationStore.push(result)
  return clone(result)
}

/** Hibernate / Unhibernate（缩放工作负载） */
export async function setWorkloadsHibernation(
  appId: string,
  bindingId: string,
  workloads: string[],
  hibernate: boolean,
): Promise<WorkloadActionResult & { hibernate: boolean }> {
  await delay(360)
  if (!db.appById(appId)) throw new MockError('not_found', '应用不存在', 404)
  if (!db.bindingById(bindingId)) throw new MockError('not_found', '环境绑定不存在', 404)
  if (!workloads.length) throw new MockError('validation_error', '至少选择一个工作负载', 422)
  return { operationId: `op-${Date.now()}`, workloads, hibernate }
}

/** 删除环境 release（Devtron 的 Delete release，可选 force） */
export async function deleteRelease(
  appId: string,
  bindingId: string,
  force: boolean,
): Promise<{ operationId: string; force: boolean }> {
  await delay(400)
  if (!db.appById(appId)) throw new MockError('not_found', '应用不存在', 404)
  const binding = db.bindingById(bindingId)
  if (!binding) throw new MockError('not_found', '环境绑定不存在', 404)
  binding.currentDeploymentId = null
  return { operationId: `op-${Date.now()}`, force }
}

export interface VulnerabilityResult {
  imageRef: string
  critical: number
  high: number
  medium: number
  low: number
  items: Array<{ id: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'; pkg: string; fixed: string }>
}

/** 镜像漏洞扫描（对应 Devtron 的 Check vulnerabilities） */
export async function scanVulnerabilities(appId: string, imageRef: string): Promise<VulnerabilityResult> {
  await delay(520)
  if (!db.appById(appId)) throw new MockError('not_found', '应用不存在', 404)
  const seed = imageRef.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  const count = (base: number) => (seed + base) % 4
  return {
    imageRef,
    critical: count(1),
    high: count(2) + 1,
    medium: count(3) + 2,
    low: count(4),
    items: [
      { id: 'CVE-2026-21734', severity: 'HIGH', pkg: 'openssl 3.0.13', fixed: '3.0.14' },
      { id: 'CVE-2026-18802', severity: 'MEDIUM', pkg: 'zlib 1.3.0', fixed: '1.3.1' },
      { id: 'CVE-2025-99017', severity: 'LOW', pkg: 'curl 8.5.0', fixed: '8.6.0' },
    ],
  }
}

export async function listAuditEvents(): Promise<AuditEvent[]> {
  await delay(140)
  return clone(db.auditEvents)
}

export async function listCredentials(): Promise<Credential[]> {
  await delay(100)
  return clone(db.credentials)
}

export async function listRegistries(): Promise<Registry[]> {
  await delay(100)
  return clone(db.registries)
}
