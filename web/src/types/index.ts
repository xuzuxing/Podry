/** 与 docs/api/openapi.json 对齐的前端 DTO 子集（首版静态实现只需读模型 + 少量写模型） */

export type Health = 'unknown' | 'progressing' | 'healthy' | 'completed' | 'degraded' | 'stopped'
export type BuildStatus = 'queued' | 'running' | 'canceling' | 'succeeded' | 'failed' | 'canceled' | 'unknown'
export type DeployStatus = 'queued' | 'submitting' | 'observing' | 'succeeded' | 'failed' | 'unknown'

/** 发布策略：滚动 / 灰度 / 蓝绿（P2） */
export type DeployStrategy = 'rolling' | 'canary' | 'bluegreen'

export interface CanaryProgress {
  steps: number[]
  currentStep: number
}
export type LogAvailability = 'runtime' | 'archived' | 'unavailable' | 'expired'
export type WorkloadKind = 'Deployment' | 'Job'
export type MemberRole = 'admin' | 'developer' | 'operator' | 'viewer'
export type ConnectionStatus = 'unknown' | 'connected' | 'unavailable'
export type SetupStatus = 'complete' | 'pending' | 'blocked' | 'not_required'
export type SetupKey = 'git' | 'build' | 'base' | 'workflow'

export interface User {
  id: string
  email: string
  name: string
  isSuperAdmin: boolean
}

export interface Team {
  id: string
  name: string
}

export interface Project {
  id: string
  teamId: string
  name: string
  /** 项目描述（可编辑） */
  description?: string
}

export interface Member {
  userId: string
  role: MemberRole
  name: string
  email: string
}

export interface ApplicationLabel { key: string; value: string; propagate: boolean }
export interface Application {
  id: string
  projectId: string
  name: string
  description: string
  sourceMode: 'git' | 'image'
  health: Health
  archivedAt: string | null
  updatedAt: string
  envCount: number
  lastDeployedAt: string | null
  /** 应用标签（可编辑） */
  tags?: string[]
  /** 创建与概览共用的结构化标签；propagate 仅记录意向，Mock 不写集群资源。 */
  labels?: ApplicationLabel[]
  /** 应用 Readme（Markdown 文本，可编辑） */
  readme?: string
  createdAt?: string
  createdBy?: string
  readmeUpdatedAt?: string
  readmeUpdatedBy?: string
}

export interface GitConfig {
  repositoryUrl: string
  branch: string
  credentialId: string | null
  accountMode: 'public' | 'credential'
}

/** 多 Git 源的前端 Mock 配置；gitConfig 保留首个仓库以兼容已有页面。 */
export interface GitMaterial extends GitConfig {
  id: string
  checkoutPath: string
  fetchSubmodules: boolean
  filterPatterns: string[]
}

/** 构建凭据引用；仅记录来源与键，不保存凭据明文。 */
export interface BuildSecretReference {
  type: 'BUILD_INFRA' | 'SOURCE_CODE'
  id: string
  secretName: string
  key: string
}

export interface BuildConfig {
  dockerfile: string
  context: string
  registryId: string
  imageRepository: string
  /** 逗号分隔的目标平台；空串表示跟随构建节点。 */
  platform: string
  timeoutSeconds: number
  /** 以下为配置页的 Mock 扩展，尚未映射为后端构建协议。 */
  buildMode?: 'dockerfile' | 'managed' | 'buildpack'
  gitMaterialId?: string
  contextGitMaterialId?: string
  useRootContext?: boolean
  dockerfileContent?: string
  dockerfileLanguage?: string
  dockerfileFramework?: string
  builderImage?: string
  projectPath?: string
  buildArguments?: Array<{ key: string; value: string }>
  buildpackArguments?: Array<{ key: string; value: string }>
  buildpackLanguage?: string
  buildpackVersion?: string
  buildSecrets?: BuildSecretReference[]
  buildSSH?: BuildSecretReference[]
}

export interface ChartConfig {
  workloadKind: WorkloadKind
  chartVersion: string
}

export interface JobValues {
  backoffLimit: number
  activeDeadlineSeconds: number
}

export interface DeployValues {
  [key: string]: unknown
  replicaCount?: number
  containerPort?: number
  host?: string
  env?: Record<string, string>
  job?: JobValues
}

export interface AppConfig {
  appId: string
  version: number
  gitConfig: GitConfig | null
  gitMaterials?: GitMaterial[]
  buildConfig: BuildConfig | null
  chartConfig: ChartConfig | null
  deployValues: DeployValues
  /** 前端 Mock 保留编辑器原文，避免保存后丢失 YAML 注释。 */
  deployValuesYaml?: string
}

/**
 * ConfigMap / Secret 配置条目（mock 扩展，对齐 Devtron Base Configurations）。
 * environmentId 为 null 表示 Base，非空表示该环境的覆盖；Secret 只保存 key，不保存明文值。
 */
export interface ConfigEntryOptions {
  source?: 'create' | 'external'
  mountAs?: 'env' | 'volume'
  mountPath?: string
  subPath?: boolean
  fileMode?: string
  mergeStrategy?: 'patch' | 'replace'
}

export interface ConfigMapEntry extends ConfigEntryOptions {
  id: string
  appId: string
  environmentId: string | null
  name: string
  data: Record<string, string>
  dataYaml?: string
  updatedAt: string
}

export interface SecretEntry extends ConfigEntryOptions {
  id: string
  appId: string
  environmentId: string | null
  name: string
  keys: string[]
  updatedAt: string
}

export interface SetupStep {
  key: SetupKey
  status: SetupStatus
  blockers: string[]
}

export interface ApplicationSetup {
  appId: string
  configVersion: number
  workflowVersion: number
  completed: number
  total: number
  steps: SetupStep[]
  canBuild: boolean
  deployableBindingIds: string[]
  nextSection: SetupKey | null
}

export interface Environment {
  id: string
  name: string
  production: boolean
  autoDeployAllowed: boolean
}

export interface Target {
  clusterId: string
  namespace: string
  releaseName: string
}

export interface Binding {
  id: string
  appId: string
  environmentId: string
  target: Target
  overrideValues: DeployValues
  /** 页面复刻阶段的本地覆盖元数据，不代表后端协议。 */
  overrideEnabled?: boolean
  overrideMergeStrategy?: 'patch' | 'replace'
  overrideValuesYaml?: string
  version: number
  autoDeploy: boolean
  currentDeploymentId: string | null
}

export interface CIDefinition {
  manual: boolean
  push: boolean
  branch: string
  webhookCredentialId: string | null
  /** 页面复刻的本地配置；每个仓库独立指定固定分支或正则。Webhook 事件仅供单仓库使用。 */
  materials?: CISource[]
  buildOverride?: BuildConfig | null
  preTasks?: PipelineTask[]
  postTasks?: PipelineTask[]
}

export interface CISource {
  gitMaterialId: string
  type: 'branch' | 'regex' | 'tag' | 'pull_request'
  value: string
  filters?: GitSourceFilter[]
  /** 分支正则约束与当前检出分支分别保存。 */
  selectedBranch?: string
}

export type GitSourceFilterKey = 'tag' | 'sourceBranch' | 'targetBranch' | 'action' | 'author'
export interface GitSourceFilter { key: GitSourceFilterKey; value: string }
export interface GitWebhookEvent {
  id: string
  type: 'tag' | 'pull_request'
  ref: string
  title: string
  receivedAt: string
  commit: GitCommit
  values: Partial<Record<GitSourceFilterKey, string>>
  payload: Record<string, unknown>
  pullRequest?: { number: number; url?: string }
}

export interface BuildMaterialSnapshot extends GitCommit {
  gitMaterialId: string
  repositoryUrl: string
  checkoutPath: string
  branch: string
  sourceType?: CISource['type']
  sourceValue?: string
  webhookEvent?: GitWebhookEvent
}

export interface BuildSelection {
  workflowVersion: number
  materials: Array<{ gitMaterialId: string; branch: string; commitSha: string; webhookEventId?: string }>
}

export interface CDDefinition {
  triggerMode: 'manual' | 'on_ci_success'
  upstreamPipelineId: string | null
  deployTimeoutSeconds: number
  preTasks?: PipelineTask[]
  postTasks?: PipelineTask[]
  preStageResources?: StageResourceReferences
  postStageResources?: StageResourceReferences
  preStageTrigger?: 'auto' | 'manual'
  postStageTrigger?: 'auto' | 'manual'
  runPreStageInEnv?: boolean
  runPostStageInEnv?: boolean
}

export interface DeploymentStageSettings {
  trigger: 'auto' | 'manual'
  runInEnvironment: boolean
}

export type DeploymentStageType = 'PRECD' | 'POSTCD'
export type StageRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
export interface StageRunSnapshot {
  tasks: PipelineTask[]
  settings: DeploymentStageSettings
  resources: StageResourceReferences
  target: Binding['target']
  configMaps: ConfigMapEntry[]
  secrets: SecretEntry[]
  artifact: Artifact
  build: Build | null
}
/** 独立的阶段运行记录，不创建 Deployment 或变更 Helm release。 */
export interface StageRun {
  id: string
  appId: string
  pipelineId: string
  bindingId: string
  environmentId: string
  stage: DeploymentStageType
  status: StageRunStatus
  configVersion: number
  workflowVersion: number
  snapshot: StageRunSnapshot
  createdAt: string
  finishedAt: string | null
  operator: string
  attemptNo: number
  retryOf: string | null
}

/** 部署阶段按类型和逻辑名称引用目标环境的有效配置，不保存 Secret 内容。 */
export interface StageResourceReferences {
  configMaps: string[]
  secrets: string[]
}
export interface TaskContainerConfig {
  command: string
  args: string[]
  mountCustomScript: boolean
  scriptMountPath: string
  ports: Array<{ hostPort: string; containerPort: string }>
  mountSource: boolean
  sourceMountPath: string
  mountHost: boolean
  hostPaths: Array<{ hostPath: string; containerPath: string }>
}

/** 前后置任务的前端 Mock 配置；脚本执行由后续后端接入实现。 */
export interface PipelineTask {
  id: string
  name: string
  execution: 'shell' | 'container'
  script: string
  image: string
  workingDirectory: string
  condition: 'always' | 'success' | 'failure'
  variables: TaskInputVariable[]
  artifactPaths: string
  outputDirectoryPaths?: string[]
  container?: TaskContainerConfig
  description?: string
  outputs?: TaskOutputVariable[]
  triggerRule?: TaskConditionGroup
  resultRule?: TaskConditionGroup
  triggerIfParentStageFail?: boolean
  plugin?: { id: string; version: string }
}

export type TaskVariableFormat = 'string' | 'number' | 'boolean' | 'date'
export interface TaskOutputVariable {
  key: string
  format?: TaskVariableFormat
  description?: string
}
export interface TaskInputVariable extends TaskOutputVariable {
  value: string
  source?: 'literal' | 'global' | 'task'
  refTaskId?: string
  refVariable?: string
}
export interface TaskConditionGroup {
  mode: 'trigger' | 'skip' | 'pass' | 'fail'
  conditions: Array<{ id: string; variable: string; operator: '==' | '!=' | '<' | '>' | '<=' | '>='; value: string }>
}

export interface Pipeline {
  id: string
  appId: string
  kind: 'ci' | 'cd'
  bindingId: string | null
  enabled: boolean
  version: number
  definition: CIDefinition | CDDefinition
}

export interface Workflow {
  version: number
  items: Pipeline[]
}

export interface GitBranch {
  name: string
  headSha: string
  isDefault: boolean
}

export interface GitCommit {
  sha: string
  subject: string
  authorName: string
  committedAt: string
  /** Explicit Mock Git metadata; absent paths must not be inferred from a subject. */
  changedPaths?: string[]
  excluded?: boolean
}

export interface Build {
  id: string
  appId: string
  /** 前端历史页按 CI 筛选使用；旧记录可没有流水线归属。 */
  pipelineId?: string | null
  sourceBranch?: string
  repositoryUrl?: string
  materials?: BuildMaterialSnapshot[]
  buildConfigSnapshot?: BuildConfig
  workflowVersion?: number
  status: BuildStatus
  commitSha: string
  commitSubject: string
  configVersion: number
  attemptNo: number
  artifactId: string | null
  createdAt: string
  finishedAt: string | null
  jobName: string
  errorCode: string | null
  logAvailability: LogAvailability
}

export interface Artifact {
  releaseTags?: string[]
  notes?: string
  id: string
  appId: string
  buildId: string | null
  source: 'build' | 'external'
  imageRepository: string
  digest: string
  imageRef: string
  createdAt: string
}

export interface DeploymentConfigSnapshot {
  source: 'fixture' | 'trigger'
  capturedAt: string
  baseValues: DeployValues
  values: DeployValues
  configMaps: ConfigMapEntry[]
  secrets: SecretEntry[]
  target: Binding['target']
  chartConfig: ChartConfig | null
  variableSnapshot?: import('./configVariables').ConfigVariableSnapshot
}

export interface Deployment {
  id: string
  requestId: string
  appId: string
  bindingId: string
  artifactId: string
  imageRef: string
  configVersion: number
  configSnapshot?: DeploymentConfigSnapshot
  status: DeployStatus
  kind: 'deploy' | 'promote' | 'rollback'
  helmRevision: number | null
  createdAt: string
  operator: string
  reason: string | null
  /** 发布策略，缺省视为 rolling */
  strategy?: DeployStrategy
  /** 灰度进度，仅 strategy=canary 时存在 */
  canary?: CanaryProgress | null
}

export interface Cluster {
  id: string
  name: string
  apiServer: string
  connectionStatus: ConnectionStatus
  serverVersion: string | null
  lastCheckedAt: string | null
  nodeCount: number
  environmentNames: string[]
  /** 是否生产集群（Devtron Resource Browser 的 Type 分组） */
  production?: boolean
  /** 本地演示的部署 worker 能力，与连接状态和生产标记独立。 */
  cdWorkerEnabled?: boolean
  /** 节点错误数 */
  nodeErrors?: number
  /** 可分配 CPU 容量 */
  cpuCapacity?: string
  /** 可分配内存容量 */
  memoryCapacity?: string
}

export interface ResourceType {
  group: string
  version: string
  resource: string
  kind: string
  namespaced: boolean
  verbs: string[]
  category: string
  shortNames?: string[]
  /** Mock Discovery 的附加表格字段，对应资源表响应中的动态 headers。 */
  printerColumns?: Array<{ name: string; type: string; jsonPath: string }>
}

export interface Namespace {
  name: string
  uid: string
  phase: string
}

export interface ResourceRef {
  group: string
  version: string
  resource: string
  namespace: string
  name: string
  uid: string
}

export interface K8sResource {
  ref: ResourceRef
  kind: string
  status: string
  summary: string
  manifest: string
  ownerRefs: string[]
  appId: string | null
}

export interface ResourceEvent {
  type: string
  reason: string
  message: string
  count: number
  firstSeenAt?: string
  lastSeenAt: string
}

export interface AuditEvent {
  id: string
  actorId: string | null
  actorName: string
  action: string
  target: string
  result: 'accepted' | 'succeeded' | 'failed' | 'denied' | 'unknown'
  createdAt: string
}

export interface Credential {
  id: string
  name: string
  kind: 'git' | 'registry' | 'kubeconfig'
  version: number
  updatedAt: string
}

export interface Registry {
  id: string
  name: string
  endpoint: string
  credentialId: string | null
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/** 集群概览（对齐 Devtron Resource Browser 的 Overview 页签） */
export interface ClusterMetric {
  usage: string
  capacity: string
  request: string
  limit: string
}

export interface ClusterOverview {
  clusterId: string
  description: string
  status: 'Healthy' | 'Unhealthy'
  addedOn: string
  addedBy: string
  kubernetesVersion: string
  cpu: ClusterMetric
  memory: ClusterMetric
  readme: string
}

/** 节点详情（对齐 Devtron NodeDetails：Summary / YAML / Node Conditions） */
export interface NodeTaint {
  key: string
  value: string
  effect: string
}

export interface NodeCondition {
  type: string
  status: string
  reason: string
  message: string
  haveIssue: boolean
}

export interface NodeResourceRow {
  name: string
  requestPercentage: string
  limitPercentage: string
  usagePercentage: string
  /** Metrics 返回的实际用量；缺失时列表显示 NA，不用百分比伪造。 */
  usage?: string
  allocatable: string
  capacity: string
}

export interface NodePodRow {
  namespace: string
  name: string
  cpuRequest: string
  cpuLimit: string
  memRequest: string
  memLimit: string
  age: string
}

export interface NodeDetail {
  name: string
  status: string
  roles: string
  k8sVersion: string
  unschedulable: boolean
  createdAt: string
  internalIp: string
  externalIp: string
  labels: string[]
  annotations: string[]
  taints: NodeTaint[]
  conditions: NodeCondition[]
  resources: NodeResourceRow[]
  pods: NodePodRow[]
  errors: Record<string, string>
  manifest: string
}
