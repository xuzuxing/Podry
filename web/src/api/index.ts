import type {
  AppConfig,
  Application,
  ApplicationSetup,
  Artifact,
  AuditEvent,
  Binding,
  DeployStrategy,
  Build,
  Cluster,
  Credential,
  ConfigMapEntry,
  SecretEntry,
  DeployValues,
  Deployment,
  Environment,
  GitBranch,
  GitCommit,
  K8sResource,
  ClusterOverview,
  NodeDetail,
  Member,
  Namespace,
  Project,
  Registry,
  ResourceEvent,
  ResourceType,
  Team,
  User,
  Workflow,
} from '@/types'
import * as db from '@/mock/data'

/**
 * 静态实现阶段的 mock API：保持与 docs/api/openapi.json 同形的入参/出参，
 * 页面只依赖这一层；接真实后端时把实现换成 request.get/post 即可。
 */
const delay = (ms = 160) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
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
  let items = db.applications.slice()
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

export async function createApplication(input: { projectId: string; name: string; description?: string; sourceMode: 'git' | 'image' }) {
  await delay(260)
  if (!/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(input.name)) {
    throw new MockError('validation_error', '名称需为 3–53 位小写字母、数字或连字符', 422)
  }
  if (db.applications.some((a) => a.projectId === input.projectId && a.name === input.name)) {
    throw new MockError('conflict', '同项目下已存在同名应用', 409)
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
    envCount: 0,
    lastDeployedAt: null,
  }
  db.applications.unshift(app)
  db.appConfigs[app.id] = {
    appId: app.id,
    version: 0,
    gitConfig: null,
    buildConfig: null,
    chartConfig: null,
    deployValues: {},
  }
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
  buildConfig?: AppConfig['buildConfig']
  chartConfig?: AppConfig['chartConfig']
  deployValues?: DeployValues
}

export async function saveConfig(appId: string, input: ConfigSectionInput): Promise<AppConfig> {
  await delay(240)
  const config = db.appConfigs[appId]
  if (!config) throw new MockError('not_found', '配置不存在', 404)
  if (input.expectedVersion !== config.version) {
    throw new MockError('revision_conflict', '配置已被他人更新，请重新读取', 409)
  }
  if (input.section === 'git' && input.gitConfig) config.gitConfig = clone(input.gitConfig)
  if (input.section === 'build' && input.buildConfig) config.buildConfig = clone(input.buildConfig)
  if (input.section === 'base') {
    if (input.chartConfig) {
      if (config.chartConfig && config.chartConfig.workloadKind !== input.chartConfig.workloadKind) {
        throw new MockError('chart_type_locked', '工作负载类型首次保存后不可修改', 409)
      }
      config.chartConfig = clone(input.chartConfig)
    }
    if (input.deployValues) config.deployValues = clone(input.deployValues)
  }
  config.version += 1
  const setup = db.setups[appId]
  if (setup) setup.configVersion = config.version
  return clone(config)
}

// ---------------- ConfigMap / Secret（mock 扩展） ----------------
export async function listConfigMaps(appId: string, environmentId: string | null): Promise<ConfigMapEntry[]> {
  await delay(100)
  return clone(
    db.configMaps.filter((item) => item.appId === appId && item.environmentId === (environmentId || null)),
  )
}

export interface ConfigMapInput {
  id?: string
  appId: string
  environmentId: string | null
  name: string
  data: Record<string, string>
}

export async function saveConfigMap(input: ConfigMapInput): Promise<ConfigMapEntry> {
  await delay(220)
  if (!/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(input.name)) {
    throw new MockError('validation_error', '名称需为 3–63 位小写字母、数字或连字符', 422)
  }
  if (!Object.keys(input.data).length) throw new MockError('validation_error', '至少需要一个 key', 422)
  const duplicated = db.configMaps.some(
    (item) =>
      item.appId === input.appId &&
      item.environmentId === input.environmentId &&
      item.name === input.name &&
      item.id !== input.id,
  )
  if (duplicated) throw new MockError('conflict', '同一范围内已存在同名 ConfigMap', 409)
  const existing = input.id ? db.configMaps.find((item) => item.id === input.id) : undefined
  if (existing) {
    existing.name = input.name
    existing.data = { ...input.data }
    existing.updatedAt = new Date().toISOString()
    return clone(existing)
  }
  const created: ConfigMapEntry = {
    id: `cm-${Date.now()}`,
    appId: input.appId,
    environmentId: input.environmentId,
    name: input.name,
    data: { ...input.data },
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

export interface SecretInput {
  id?: string
  appId: string
  environmentId: string | null
  name: string
  keys: string[]
}

export async function saveSecret(input: SecretInput): Promise<SecretEntry> {
  await delay(220)
  if (!/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(input.name)) {
    throw new MockError('validation_error', '名称需为 3–63 位小写字母、数字或连字符', 422)
  }
  if (!input.keys.length) throw new MockError('validation_error', '至少需要一个 key', 422)
  const duplicated = db.configSecrets.some(
    (item) =>
      item.appId === input.appId &&
      item.environmentId === input.environmentId &&
      item.name === input.name &&
      item.id !== input.id,
  )
  if (duplicated) throw new MockError('conflict', '同一范围内已存在同名 Secret', 409)
  const existing = input.id ? db.configSecrets.find((item) => item.id === input.id) : undefined
  if (existing) {
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

export async function getWorkflow(appId: string): Promise<Workflow> {
  await delay(120)
  return clone(db.workflows[appId] ?? { version: 0, items: [] })
}

export async function saveWorkflow(appId: string, workflow: Workflow): Promise<Workflow> {
  await delay(240)
  db.workflows[appId] = clone({ ...workflow, version: workflow.version + 1 })
  const setup = db.setups[appId]
  if (setup) {
    setup.workflowVersion = db.workflows[appId].version
    if (workflow.items.length > 0) {
      setup.steps = setup.steps.map((s) => (s.key === 'workflow' ? { ...s, status: 'complete', blockers: [] } : s))
      setup.completed = setup.steps.filter((s) => s.status === 'complete').length
      setup.nextSection = null
    }
  }
  return clone(db.workflows[appId])
}

// ---------------- Git 选择 ----------------
export async function listBranches(appId: string): Promise<GitBranch[]> {
  await delay(180)
  if (!db.appConfigs[appId]?.gitConfig) throw new MockError('git_not_configured', '尚未配置 Git 源', 422)
  return clone(db.branches)
}

export async function listCommits(ref: string): Promise<GitCommit[]> {
  await delay(200)
  if (ref === 'unknown') throw new MockError('git_unavailable', 'Git 服务暂不可达，请稍后重试', 503)
  return clone(db.commits)
}

// ---------------- 构建 ----------------
export async function listBuilds(appId: string) {
  await delay(140)
  return page(clone(db.buildsOf(appId)), 1, 50)
}

export async function getBuild(buildId: string): Promise<Build> {
  await delay(100)
  const build = db.builds.find((b) => b.id === buildId)
  if (!build) throw new MockError('not_found', '构建不存在', 404)
  return clone(build)
}

export async function triggerBuild(appId: string, commitSha: string, expectedConfigVersion: number): Promise<Build> {
  await delay(300)
  const config = db.appConfigs[appId]
  if (!config) throw new MockError('not_found', '配置不存在', 404)
  if (expectedConfigVersion !== config.version) {
    throw new MockError('revision_conflict', '配置已更新，请重新选择提交', 409)
  }
  if (db.builds.some((b) => b.appId === appId && (b.status === 'queued' || b.status === 'running'))) {
    throw new MockError('build_active', '已有进行中的构建', 409)
  }
  const commit = db.commits.find((c) => c.sha === commitSha)
  const build: Build = {
    id: `bd-${Math.floor(Math.random() * 9000 + 1000)}`,
    appId,
    status: 'running',
    commitSha,
    commitSubject: commit?.subject ?? '',
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
  const build: Build = {
    ...clone(source),
    id: `bd-${Math.floor(Math.random() * 9000 + 1000)}`,
    status: 'running',
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
  const head = [
    `[podry] attempt #${build.attemptNo} for build ${build.id}`,
    `[podry] commit ${build.commitSha.slice(0, 8)} config v${build.configVersion}`,
    '[source] init container: cloning https://github.com/acme/checkout-api.git',
    '[source] checkout detached HEAD at fixed SHA',
    '[buildkit] #1 [internal] load build definition from docker/Dockerfile',
    '[buildkit] #2 [internal] load metadata for docker.io/library/node:22-alpine',
    '[buildkit] #4 [1/4] COPY package*.json ./',
    '[buildkit] #5 [2/4] RUN npm ci --omit=dev',
    '[buildkit] #6 [3/4] COPY . .',
    '[buildkit] #7 [4/4] RUN npm run build',
    '[buildkit] #8 exporting to image',
  ]
  if (build.status === 'succeeded') {
    return [
      ...head,
      '[buildkit] #8 pushing manifest for harbor.acme.dev/acme/checkout-api:v1.42.0',
      `[podry] artifact digest ${build.artifactId ?? 'sha256:8f14e45f'}`,
      '[podry] build succeeded',
    ]
  }
  if (build.status === 'failed') {
    return [...head, '[buildkit] ERROR failed to solve: process "/bin/sh -c npm run build" did not complete successfully: exit code: 1', '[podry] build failed: buildkit_failed']
  }
  if (build.status === 'canceled') {
    return [...head, '[podry] cancel requested, terminating Job build-checkout-api', '[podry] build canceled']
  }
  return [...head, '[buildkit] #8 DONE 3.2s', '[podry] waiting for image export...']
}

// ---------------- 产物与发布 ----------------
export async function listArtifacts(appId: string): Promise<Artifact[]> {
  await delay(120)
  return clone(db.artifactsOf(appId))
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
  return {
    previewId: `pv-${Date.now()}`,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    imageRef: artifact.imageRef,
    target: clone(binding.target),
    configVersion: config.version,
    diff: {
      before: `replicas: ${binding.overrideValues.replicaCount ?? config.deployValues.replicaCount ?? 1}\nimage: ${artifact.imageRepository}:previous`,
      after: `replicas: ${binding.overrideValues.replicaCount ?? config.deployValues.replicaCount ?? 1}\nimage: ${artifact.imageRef}`,
    },
    warnings: binding.environmentId === 'e-prod' ? ['生产环境仅允许手动发布', '发布后需观察 60s 就绪状态'] : [],
  }
}

export async function listDeployments(appId: string) {
  await delay(140)
  return page(clone(db.deploymentsOf(appId)), 1, 50)
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
  const deployment: Deployment = {
    ...clone(source),
    id: `d-${Date.now()}`,
    requestId: `req-${Date.now()}`,
    bindingId: targetBindingId,
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
  const all = db.resources.filter((r) => r.ref.resource === query.resource)
  const scoped = all.filter((r) => {
    if (clusterId === 'c-prod') return r.ref.namespace === 'shop-prod' || r.ref.namespace === '_cluster'
    return r.ref.namespace !== 'shop-prod'
  })
  return clone(
    scoped.filter((r) => {
      if (query.namespace && query.namespace !== 'all' && r.ref.namespace !== query.namespace) return false
      if (query.keyword && !r.ref.name.includes(query.keyword)) return false
      return true
    }),
  )
}

export async function getResource(clusterId: string, group: string, resource: string, namespace: string, name: string): Promise<K8sResource> {
  await delay(120)
  if (!db.clusterById(clusterId)) throw new MockError('not_found', '集群不存在', 404)
  const found = db.resources.find(
    (r) => r.ref.resource === resource && r.ref.namespace === namespace && r.ref.name === name && r.ref.group === group,
  )
  if (!found) throw new MockError('not_found', '资源不存在', 404)
  return clone(found)
}

export async function listEvents(uid: string): Promise<ResourceEvent[]> {
  await delay(120)
  return clone(db.events[uid] ?? [])
}

export async function getPodLogs(
  uid: string,
  options?: { container?: string; sinceSeconds?: number; tailLines?: number; previous?: boolean },
): Promise<string[]> {
  await delay(options?.container || options?.sinceSeconds ? 260 : 180)
  const lines = db.podLogs[uid]
  if (!lines) throw new MockError('not_found', '该资源没有容器日志', 404)
  let result = clone(lines)
  if (options?.sinceSeconds) {
    const cutoff = Date.now() - options.sinceSeconds * 1000
    const filtered = result.filter((line) => {
      const at = Date.parse(line.slice(0, 24))
      return Number.isNaN(at) ? true : at >= cutoff
    })
    // 演示数据都在过去较久，窗口过滤后为空时保留尾部 3 行，避免“空日志”误判
    result = filtered.length ? filtered : result.slice(-3)
  }
  if (options?.tailLines) result = result.slice(-options.tailLines)
  if (options?.container && options.container !== 'app') {
    result = result.map((line) => `[${options.container}] ${line}`)
  }
  if (options?.previous) {
    // 上一容器日志：mock 复用当前日志并显式标注来源
    result = result.map((line) => `[previous] ${line}`)
  }
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
    if (!owner) continue
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
  if (!detail) throw new MockError('not_found', '节点不存在', 404)
  return clone(detail)
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

/** 极简 YAML 扫描：只取 kind / metadata.name / metadata.namespace，够演示多文档 Dry run */
function parseDocuments(manifest: string): Array<ParsedDoc & { body: string }> {
  const chunks = manifest
    .split(/^---\s*$/m)
    .map((item) => item.trim())
    .filter(Boolean)
  return chunks.map((body) => {
    const kind = /^kind:\s*(\S+)/m.exec(body)?.[1] ?? ''
    const name = /^\s{2}name:\s*(\S+)/m.exec(body)?.[1] ?? ''
    const namespace = /^\s{2}namespace:\s*(\S+)/m.exec(body)?.[1] ?? 'default'
    const mapping = KIND_TO_RESOURCE[kind] ?? { group: '', resource: kind.toLowerCase() }
    return { kind, name, namespace, group: mapping.group, resource: mapping.resource, body }
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
  const documents: DryRunDocumentResult[] = docs.map((doc, index) => {
    if (!doc.kind || !doc.name) {
      return { index, ref: `${doc.kind || '?'}/${doc.name || '?'}`, status: 'invalid', message: '缺少 kind 或 metadata.name' }
    }
    const exists = db.resources.some(
      (item) => item.ref.resource === doc.resource && item.ref.name === doc.name && item.ref.namespace === doc.namespace,
    )
    return {
      index,
      ref: `${doc.kind}/${doc.name}`,
      status: 'valid',
      message: exists ? '将更新现有对象（server-side apply 预演通过）' : '将创建新对象',
    }
  })
  return { documents, valid: documents.every((item) => item.status === 'valid') }
}

export async function applyResource(
  clusterId: string,
  input: { manifest: string; expectedUid?: string },
): Promise<ApplyResult> {
  await delay(360)
  if (!db.clusterById(clusterId)) throw new MockError('not_found', '集群不存在', 404)
  const docs = parseDocuments(input.manifest)
  const items: ApplyItemResult[] = []
  for (const doc of docs) {
    const ref = `${doc.kind}/${doc.name}`
    if (!doc.kind || !doc.name) {
      items.push({ ref, result: 'failed', message: '缺少 kind 或 metadata.name' })
      continue
    }
    const existing = db.resources.find(
      (item) => item.ref.resource === doc.resource && item.ref.name === doc.name && item.ref.namespace === doc.namespace,
    )
    if (existing) {
      if (input.expectedUid && existing.ref.uid !== input.expectedUid) {
        items.push({ ref, result: 'failed', message: '对象已被重建（UID 不一致），请重新读取后再提交' })
        continue
      }
      existing.manifest = doc.body
      items.push({ ref, result: 'succeeded', message: '已更新' })
    } else {
      db.resources.push({
        ref: {
          group: doc.group,
          version: 'v1',
          resource: doc.resource,
          namespace: doc.namespace,
          name: doc.name,
          uid: `uid-${doc.resource}-${Date.now()}`,
        },
        kind: doc.kind,
        status: doc.kind === 'ConfigMap' ? 'Active' : 'Created',
        summary: '由 Manifest Apply 创建',
        manifest: doc.body,
        ownerRefs: [],
        appId: null,
      })
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
  const [repository] = input.imageRef.split(':')
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
  input: { expectedVersion: number; overrideValues: DeployValues; autoDeploy?: boolean },
): Promise<Binding> {
  await delay(240)
  const binding = db.bindingById(bindingId)
  if (!binding || binding.appId !== appId) throw new MockError('not_found', '环境绑定不存在', 404)
  if (binding.version !== input.expectedVersion) {
    throw new MockError('revision_conflict', '环境绑定已被更新，请重新读取后再保存', 409)
  }
  binding.overrideValues = clone(input.overrideValues)
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
  createdAt: string
  expiresAt: string
}

const execSessions = new Map<string, ExecSession>()

/** 终端会话（P2 / EX-02）：一次 ticket 换一次会话，30 分钟过期 */
export async function createExecSession(
  clusterId: string,
  input: { namespace: string; pod?: string; container?: string },
): Promise<ExecSession> {
  await delay(220)
  if (!db.clusterById(clusterId)) throw new MockError('not_found', '集群不存在', 404)
  if (input.pod) {
    const pod = db.resources.find(
      (item) => item.ref.resource === 'pods' && item.ref.name === input.pod && item.ref.namespace === input.namespace,
    )
    if (!pod) throw new MockError('not_found', 'Pod 不存在', 404)
  }
  const now = Date.now()
  const session: ExecSession = {
    sessionId: `sess-${now.toString(36)}`,
    clusterId,
    namespace: input.namespace,
    pod: input.pod ?? null,
    container: input.container ?? 'app',
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
  patch: { description?: string; projectId?: string; tags?: string[]; readme?: string; archived?: boolean },
): Promise<Application> {
  await delay(220)
  const app = db.appById(appId)
  if (!app) throw new MockError('not_found', '应用不存在', 404)
  if (patch.projectId && !db.projects.some((item) => item.id === patch.projectId)) {
    throw new MockError('not_found', '目标项目不存在', 404)
  }
  if (typeof patch.description === 'string') app.description = patch.description
  if (patch.projectId) app.projectId = patch.projectId
  if (Array.isArray(patch.tags)) app.tags = patch.tags
  if (typeof patch.readme === 'string') app.readme = patch.readme
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
