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
  /** 应用 Readme（Markdown 文本，可编辑） */
  readme?: string
}

export interface GitConfig {
  repositoryUrl: string
  branch: string
  credentialId: string | null
  accountMode: 'public' | 'credential'
}

export interface BuildConfig {
  dockerfile: string
  context: string
  registryId: string
  imageRepository: string
  platform: 'linux/amd64' | 'linux/arm64'
  timeoutSeconds: number
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
  buildConfig: BuildConfig | null
  chartConfig: ChartConfig | null
  deployValues: DeployValues
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
  version: number
  autoDeploy: boolean
  currentDeploymentId: string | null
}

export interface CIDefinition {
  manual: boolean
  push: boolean
  branch: string
  webhookCredentialId: string | null
}

export interface CDDefinition {
  triggerMode: 'manual' | 'on_ci_success'
  upstreamPipelineId: string | null
  deployTimeoutSeconds: number
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
}

export interface Build {
  id: string
  appId: string
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
  id: string
  appId: string
  buildId: string | null
  source: 'build' | 'external'
  imageRepository: string
  digest: string
  imageRef: string
  createdAt: string
}

export interface Deployment {
  id: string
  requestId: string
  appId: string
  bindingId: string
  artifactId: string
  imageRef: string
  configVersion: number
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
}

export interface ResourceType {
  group: string
  version: string
  resource: string
  kind: string
  namespaced: boolean
  verbs: string[]
  category: string
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
