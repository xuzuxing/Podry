import { parseDocument } from 'yaml'
import { configDocument } from '@/utils/configDocument'
import { captureConfigVariables } from '@/utils/configVariables'
import { customResources, customResourceTypes, resourceShortNames } from './resourceDiscovery'
import type {
  AppConfig,
  Application,
  ApplicationSetup,
  Artifact,
  AuditEvent,
  Binding,
  Build,
  Cluster,
  Credential,
  Deployment,
  StageRun,
  Environment,
  GitBranch,
  GitCommit,
  K8sResource,
  Member,
  ConfigMapEntry,
  SecretEntry,
  ClusterOverview,
  Namespace,
  NodeDetail,
  Project,
  Registry,
  ResourceEvent,
  ResourceType,
  Team,
  User,
  Workflow,
} from '@/types'

/** 以加载时刻为基准，保证「3 分钟前 / 1 天前」相对时间自然可读 */
const BASE = Date.now()
const ago = (minutes: number): string => new Date(BASE - minutes * 60_000).toISOString()

export const currentUser: User = {
  id: 'u-1',
  email: 'admin@acme.dev',
  name: '张运维',
  isSuperAdmin: true,
}

export const teams: Team[] = [
  { id: 't-1', name: 'Acme 研发' },
  { id: 't-2', name: 'Lab 实验组' },
]

export const projects: Project[] = [
  { id: 'p-shop', teamId: 't-1', name: '电商交易' },
  { id: 'p-data', teamId: 't-1', name: '数据平台' },
  { id: 'p-core', teamId: 't-2', name: '基础组件' },
]

export const members: Member[] = [
  { userId: 'u-1', role: 'admin', name: '张运维', email: 'admin@acme.dev' },
  { userId: 'u-2', role: 'developer', name: '李开发', email: 'li.dev@acme.dev' },
  { userId: 'u-3', role: 'operator', name: '王发布', email: 'wang.ops@acme.dev' },
  { userId: 'u-4', role: 'viewer', name: '赵观察', email: 'zhao.qa@acme.dev' },
]

export const environments: Environment[] = [
  { id: 'e-dev', name: '开发环境', production: false, autoDeployAllowed: true },
  { id: 'e-staging', name: '预发布环境', production: false, autoDeployAllowed: false },
  { id: 'e-prod', name: '生产环境', production: true, autoDeployAllowed: false },
]

export const clusters: Cluster[] = [
  {
    id: 'c-prod',
    cdWorkerEnabled: false,
    name: 'prod-k8s',
    apiServer: 'https://10.20.0.10:6443',
    connectionStatus: 'connected',
    serverVersion: 'v1.29.4',
    lastCheckedAt: ago(6),
    nodeCount: 6,
    environmentNames: ['生产环境'],
    production: true,
    nodeErrors: 0,
    cpuCapacity: '12',
    memoryCapacity: '21.82Gi',
  },
  {
    id: 'c-dev',
    cdWorkerEnabled: true,
    name: 'dev-k3s',
    apiServer: 'https://10.20.0.21:6443',
    connectionStatus: 'connected',
    serverVersion: 'v1.27.5',
    lastCheckedAt: ago(2),
    nodeCount: 3,
    environmentNames: ['开发环境', '预发布环境'],
    production: false,
    nodeErrors: 0,
    cpuCapacity: '6',
    memoryCapacity: '8Gi',
  },
]

export const applications: Application[] = [
  {
    id: 'a-checkout',
    projectId: 'p-shop',
    name: 'checkout-api',
    description: '结算主链路 API，Git 源码构建',
  tags: ['order', 'critical'],
  readme: '## checkout-api\n\n结算主链路 API，负责购物车结算、优惠计算与订单提交。\n\n- 上游：storefront\n- 下游：payment-worker、库存服务\n- 依赖配置：checkout-api-config、checkout-api-secret',
    sourceMode: 'git',
    health: 'healthy',
    archivedAt: null,
    updatedAt: ago(12),
    envCount: 3,
    createdAt: '2026-10-12T01:20:00.000Z',
    createdBy: 'admin',
    lastDeployedAt: ago(42),
  },
  {
    id: 'a-payment',
    projectId: 'p-shop',
    name: 'payment-worker',
    description: '支付异步任务消费者',
    sourceMode: 'git',
    health: 'degraded',
    archivedAt: null,
    updatedAt: ago(35),
    envCount: 2,
    createdAt: '2026-10-18T03:05:00.000Z',
    createdBy: 'admin',
    lastDeployedAt: ago(96),
  },
  {
    id: 'a-storefront',
    projectId: 'p-shop',
    name: 'storefront',
    description: '店铺前台，使用已有镜像交付',
    sourceMode: 'image',
    health: 'healthy',
    archivedAt: null,
    updatedAt: ago(180),
    envCount: 1,
    createdAt: '2026-10-21T07:40:00.000Z',
    createdBy: '张运维',
    lastDeployedAt: ago(240),
  },
  {
    id: 'a-search',
    projectId: 'p-data',
    name: 'search-index',
    description: '商品搜索索引构建',
    sourceMode: 'git',
    health: 'progressing',
    archivedAt: null,
    updatedAt: ago(58),
    envCount: 1,
    createdAt: '2026-11-02T09:15:00.000Z',
    createdBy: '王发布',
    lastDeployedAt: null,
  },
  {
    id: 'a-notify',
    projectId: 'p-data',
    name: 'notify-service',
    description: '新建应用，尚未完成配置',
    sourceMode: 'git',
    health: 'unknown',
    archivedAt: null,
    updatedAt: ago(300),
    envCount: 0,
    createdAt: '2026-11-05T02:30:00.000Z',
    createdBy: '张运维',
    lastDeployedAt: null,
  },
  {
    id: 'a-metrics',
    projectId: 'p-core',
    name: 'metrics-agent',
    description: '集群指标采集，一次性 Job 交付',
    sourceMode: 'git',
    health: 'stopped',
    archivedAt: null,
    updatedAt: ago(720),
    envCount: 1,
    createdAt: '2026-11-08T11:10:00.000Z',
    createdBy: '王发布',
    lastDeployedAt: ago(900),
  },
]

export const bindings: Binding[] = [
  {
    id: 'b-checkout-dev',
    appId: 'a-checkout',
    environmentId: 'e-dev',
    target: { clusterId: 'c-dev', namespace: 'shop-dev', releaseName: 'checkout-api' },
    overrideValues: { replicaCount: 1 },
    version: 2,
    autoDeploy: true,
    currentDeploymentId: 'd-checkout-dev-2',
  },
  {
    id: 'b-checkout-staging',
    appId: 'a-checkout',
    environmentId: 'e-staging',
    target: { clusterId: 'c-dev', namespace: 'shop-staging', releaseName: 'checkout-api' },
    overrideValues: { replicaCount: 2, host: 'checkout.staging.acme.dev' },
    version: 3,
    autoDeploy: false,
    currentDeploymentId: 'd-checkout-staging-1',
  },
  {
    id: 'b-checkout-prod',
    appId: 'a-checkout',
    environmentId: 'e-prod',
    target: { clusterId: 'c-prod', namespace: 'shop-prod', releaseName: 'checkout-api' },
    overrideValues: { replicaCount: 4, host: 'checkout.acme.dev' },
    version: 5,
    autoDeploy: false,
    currentDeploymentId: 'd-checkout-prod-1',
  },
  {
    id: 'b-payment-dev',
    appId: 'a-payment',
    environmentId: 'e-dev',
    target: { clusterId: 'c-dev', namespace: 'shop-dev', releaseName: 'payment-worker' },
    overrideValues: {},
    version: 1,
    autoDeploy: false,
    currentDeploymentId: 'd-payment-dev-1',
  },
  {
    id: 'b-payment-prod',
    appId: 'a-payment',
    environmentId: 'e-prod',
    target: { clusterId: 'c-prod', namespace: 'shop-prod', releaseName: 'payment-worker' },
    overrideValues: { replicaCount: 2 },
    version: 2,
    autoDeploy: false,
    currentDeploymentId: 'd-payment-prod-1',
  },
  {
    id: 'b-storefront-prod',
    appId: 'a-storefront',
    environmentId: 'e-prod',
    target: { clusterId: 'c-prod', namespace: 'shop-prod', releaseName: 'storefront' },
    overrideValues: { replicaCount: 3 },
    version: 1,
    autoDeploy: false,
    currentDeploymentId: 'd-storefront-prod-1',
  },
  {
    id: 'b-search-dev',
    appId: 'a-search',
    environmentId: 'e-dev',
    target: { clusterId: 'c-dev', namespace: 'search-dev', releaseName: 'search-index' },
    overrideValues: {},
    version: 1,
    autoDeploy: false,
    currentDeploymentId: null,
  },
  {
    id: 'b-metrics-staging',
    appId: 'a-metrics',
    environmentId: 'e-staging',
    target: { clusterId: 'c-dev', namespace: 'metrics', releaseName: 'metrics-agent' },
    overrideValues: { job: { backoffLimit: 1, activeDeadlineSeconds: 1800 } },
    version: 2,
    autoDeploy: false,
    currentDeploymentId: 'd-metrics-staging-1',
  },
]

const checkoutValues = { replicaCount: 2, containerPort: 8080, host: 'checkout.acme.dev' }

export const appConfigs: Record<string, AppConfig> = {
  'a-checkout': {
    appId: 'a-checkout',
    version: 7,
    gitConfig: {
      repositoryUrl: 'https://github.com/acme/checkout-api.git',
      branch: 'main',
      credentialId: 'cr-git',
      accountMode: 'credential',
    },
    buildConfig: {
      dockerfile: 'docker/Dockerfile',
      context: 'docker',
      registryId: 'r-harbor',
      imageRepository: 'acme/checkout-api',
      platform: 'linux/amd64',
      timeoutSeconds: 1800,
    },
    chartConfig: { workloadKind: 'Deployment', chartVersion: '1.4.0' },
    deployValues: checkoutValues,
  },
  'a-payment': {
    appId: 'a-payment',
    version: 4,
    gitConfig: {
      repositoryUrl: 'https://github.com/acme/payment-worker.git',
      branch: 'release/1.x',
      credentialId: null,
      accountMode: 'public',
    },
    buildConfig: {
      dockerfile: 'Dockerfile',
      context: '.',
      registryId: 'r-harbor',
      imageRepository: 'acme/payment-worker',
      platform: 'linux/arm64',
      timeoutSeconds: 1800,
    },
    chartConfig: { workloadKind: 'Deployment', chartVersion: '1.4.0' },
    deployValues: { replicaCount: 2, containerPort: 9090, env: { REGION: '@{{payment-region}}' } },
  },
  'a-storefront': {
    appId: 'a-storefront',
    version: 2,
    gitConfig: null,
    buildConfig: null,
    chartConfig: { workloadKind: 'Deployment', chartVersion: '1.4.0' },
    deployValues: { replicaCount: 3, containerPort: 3000, host: 'shop.acme.dev' },
  },
  'a-search': {
    appId: 'a-search',
    version: 5,
    gitConfig: {
      repositoryUrl: 'https://gitlab.acme.dev/data/search-index.git',
      branch: 'main',
      credentialId: 'cr-git',
      accountMode: 'credential',
    },
    buildConfig: {
      dockerfile: 'Dockerfile',
      context: '.',
      registryId: 'r-harbor',
      imageRepository: 'acme/search-index',
      platform: 'linux/amd64',
      timeoutSeconds: 3600,
    },
    chartConfig: { workloadKind: 'Deployment', chartVersion: '1.4.0' },
    deployValues: { replicaCount: 1, containerPort: 9200 },
  },
  'a-metrics': {
    appId: 'a-metrics',
    version: 3,
    gitConfig: {
      repositoryUrl: 'https://github.com/acme/metrics-agent.git',
      branch: 'main',
      credentialId: null,
      accountMode: 'public',
    },
    buildConfig: {
      dockerfile: 'Dockerfile',
      context: '.',
      registryId: 'r-harbor',
      imageRepository: 'acme/metrics-agent',
      platform: 'linux/amd64',
      timeoutSeconds: 900,
    },
    chartConfig: { workloadKind: 'Job', chartVersion: '1.2.0' },
    deployValues: { job: { backoffLimit: 1, activeDeadlineSeconds: 1800 } },
  },
  'a-notify': {
    appId: 'a-notify',
    version: 0,
    gitConfig: null,
    buildConfig: null,
    chartConfig: null,
    deployValues: {},
  },
}

const step = (key: 'git' | 'build' | 'base' | 'workflow', status: 'complete' | 'pending' | 'blocked' | 'not_required', blockers: string[] = []) =>
  ({ key, status, blockers })

export const setups: Record<string, ApplicationSetup> = {
  'a-checkout': {
    appId: 'a-checkout',
    configVersion: 7,
    workflowVersion: 4,
    completed: 4,
    total: 4,
    steps: [step('git', 'complete'), step('build', 'complete'), step('base', 'complete'), step('workflow', 'complete')],
    canBuild: true,
    deployableBindingIds: ['b-checkout-dev', 'b-checkout-staging', 'b-checkout-prod'],
    nextSection: null,
  },
  'a-payment': {
    appId: 'a-payment',
    configVersion: 4,
    workflowVersion: 2,
    completed: 4,
    total: 4,
    steps: [step('git', 'complete'), step('build', 'complete'), step('base', 'complete'), step('workflow', 'complete')],
    canBuild: true,
    deployableBindingIds: ['b-payment-dev', 'b-payment-prod'],
    nextSection: null,
  },
  'a-storefront': {
    appId: 'a-storefront',
    configVersion: 2,
    workflowVersion: 1,
    completed: 2,
    total: 2,
    steps: [step('git', 'not_required'), step('build', 'not_required'), step('base', 'complete'), step('workflow', 'complete')],
    canBuild: false,
    deployableBindingIds: ['b-storefront-prod'],
    nextSection: null,
  },
  'a-search': {
    appId: 'a-search',
    configVersion: 5,
    workflowVersion: 0,
    completed: 3,
    total: 4,
    steps: [
      step('git', 'complete'),
      step('build', 'complete'),
      step('base', 'complete'),
      step('workflow', 'pending', ['尚未创建工作流']),
    ],
    canBuild: true,
    deployableBindingIds: [],
    nextSection: 'workflow',
  },
  'a-metrics': {
    appId: 'a-metrics',
    configVersion: 3,
    workflowVersion: 1,
    completed: 4,
    total: 4,
    steps: [step('git', 'complete'), step('build', 'complete'), step('base', 'complete'), step('workflow', 'complete')],
    canBuild: true,
    deployableBindingIds: ['b-metrics-staging'],
    nextSection: null,
  },
  'a-notify': {
    appId: 'a-notify',
    configVersion: 0,
    workflowVersion: 0,
    completed: 0,
    total: 4,
    steps: [
      step('git', 'pending'),
      step('build', 'blocked', ['需要先保存 Git 源']),
      step('base', 'blocked', ['需要先保存构建配置']),
      step('workflow', 'blocked', ['需要先完成基础配置']),
    ],
    canBuild: false,
    deployableBindingIds: [],
    nextSection: 'git',
  },
}

export const workflows: Record<string, Workflow> = {
  'a-checkout': {
    version: 4,
    items: [
      {
        id: 'pl-checkout-ci',
        appId: 'a-checkout',
        kind: 'ci',
        bindingId: null,
        enabled: true,
        version: 2,
        definition: { manual: true, push: true, branch: 'main', webhookCredentialId: null },
      },
      {
        id: 'pl-checkout-cd-dev',
        appId: 'a-checkout',
        kind: 'cd',
        bindingId: 'b-checkout-dev',
        enabled: true,
        version: 1,
        definition: { triggerMode: 'on_ci_success', upstreamPipelineId: 'pl-checkout-ci', deployTimeoutSeconds: 600 },
      },
      {
        id: 'pl-checkout-cd-staging',
        appId: 'a-checkout',
        kind: 'cd',
        bindingId: 'b-checkout-staging',
        enabled: true,
        version: 1,
        definition: {
          triggerMode: 'manual', upstreamPipelineId: 'pl-checkout-ci', deployTimeoutSeconds: 900,
          // 独立阶段的本地演示配置；这些脚本不会实际执行。
          preTasks: [{ id: 'staging-pre-check', name: 'Check application environment', execution: 'shell', image: '', script: '#!/bin/sh\necho "pre-deployment checks"\n', workingDirectory: './', condition: 'success', variables: [], outputs: [], artifactPaths: '' }],
          postTasks: [{ id: 'staging-post-check', name: 'Verify release', execution: 'shell', image: '', script: '#!/bin/sh\necho "post-deployment checks"\n', workingDirectory: './', condition: 'success', variables: [], outputs: [], artifactPaths: '' }],
        },
      },
      {
        id: 'pl-checkout-cd-prod',
        appId: 'a-checkout',
        kind: 'cd',
        bindingId: 'b-checkout-prod',
        enabled: true,
        version: 3,
        definition: { triggerMode: 'manual', upstreamPipelineId: 'pl-checkout-ci', deployTimeoutSeconds: 1200 },
      },
    ],
  },
  'a-payment': {
    version: 2,
    items: [
      {
        id: 'pl-payment-ci',
        appId: 'a-payment',
        kind: 'ci',
        bindingId: null,
        enabled: true,
        version: 1,
        definition: { manual: true, push: false, branch: 'release/1.x', webhookCredentialId: null },
      },
      {
        id: 'pl-payment-cd-dev',
        appId: 'a-payment',
        kind: 'cd',
        bindingId: 'b-payment-dev',
        enabled: true,
        version: 1,
        definition: { triggerMode: 'manual', upstreamPipelineId: 'pl-payment-ci', deployTimeoutSeconds: 600 },
      },
      {
        id: 'pl-payment-cd-prod',
        appId: 'a-payment',
        kind: 'cd',
        bindingId: 'b-payment-prod',
        enabled: true,
        version: 2,
        definition: { triggerMode: 'manual', upstreamPipelineId: 'pl-payment-ci', deployTimeoutSeconds: 1200 },
      },
    ],
  },
  'a-search': { version: 0, items: [] },
  'a-storefront': {
    version: 1,
    items: [
      {
        id: 'pl-storefront-cd-prod',
        appId: 'a-storefront',
        kind: 'cd',
        bindingId: 'b-storefront-prod',
        enabled: true,
        version: 1,
        definition: { triggerMode: 'manual', upstreamPipelineId: null, deployTimeoutSeconds: 600 },
      },
    ],
  },
  'a-metrics': { version: 1, items: [] },
  'a-notify': { version: 0, items: [] },
}

export const branches: GitBranch[] = [
  { name: 'main', headSha: 'f3c9a1b7d4e6c2a8f5b1d7e3c9a6b2d8f4e1c7a3', isDefault: true },
  { name: 'release/1.x', headSha: 'b71e4d9c2a5f8b3d6e9c1a4f7b2d5e8c3a6f9b1d', isDefault: false },
  { name: 'feature/order-split', headSha: 'a15c8e3b9d2f5a7c1e4b8d3f6a9c2e5b8d1f4a7c', isDefault: false },
]

export const commits: GitCommit[] = [
  { sha: 'f3c9a1b7d4e6c2a8f5b1d7e3c9a6b2d8f4e1c7a3', subject: 'fix: 结算金额四舍五入到分', authorName: '李开发', committedAt: ago(64), changedPaths: ['src/checkout/amount.ts', 'tests/amount.test.ts'] },
  { sha: '9d2b5e8a1c4f7b3d6e9a2c5f8b1d4e7a3c6f9b2d', subject: 'feat: 支持优惠券叠加', authorName: '李开发', committedAt: ago(210), changedPaths: ['src/coupon/stack.ts', 'docs/coupons.md'] },
  { sha: 'b71e4d9c2a5f8b3d6e9c1a4f7b2d5e8c3a6f9b1d', subject: 'chore: 升级基础镜像到 1.22', authorName: '王发布', committedAt: ago(420), changedPaths: ['Dockerfile'] },
  { sha: 'a15c8e3b9d2f5a7c1e4b8d3f6a9c2e5b8d1f4a7c', subject: 'refactor: 拆分订单聚合', authorName: '李开发', committedAt: ago(900), changedPaths: ['src/order/aggregate.ts'] },
  { sha: '6c3f9a2d5b8e1c4f7a3d6b9e2c5f8a1d4b7e3c6f', subject: 'test: 补结算压测脚本', authorName: '赵观察', committedAt: ago(1320), changedPaths: ['tests/load/checkout.js'] },
  { sha: 'e8b1d4c7a2f5b8e3c6a9d2f5b1e4c7a3d6f9b2e5', subject: 'docs: 更新发布说明', authorName: '张运维', committedAt: ago(1800), changedPaths: ['docs/releases/1.4.md', 'README.md'] },
]

const logRuntime = 'runtime' as const
const logArchived = 'archived' as const

export const builds: Build[] = [
  {
    id: 'bd-1012',
    appId: 'a-checkout',
    pipelineId: 'pl-checkout-ci',
    status: 'running',
    commitSha: 'f3c9a1b7d4e6c2a8f5b1d7e3c9a6b2d8f4e1c7a3',
    commitSubject: 'fix: 结算金额四舍五入到分',
    configVersion: 7,
    attemptNo: 1,
    artifactId: null,
    createdAt: ago(3),
    finishedAt: null,
    jobName: 'build-checkout-api-1012-a1',
    errorCode: null,
    logAvailability: logRuntime,
  },
  {
    id: 'bd-1011',
    appId: 'a-checkout',
    pipelineId: 'pl-checkout-ci',
    status: 'succeeded',
    commitSha: '9d2b5e8a1c4f7b3d6e9a2c5f8b1d4e7a3c6f9b2d',
    commitSubject: 'feat: 支持优惠券叠加',
    configVersion: 7,
    attemptNo: 1,
    artifactId: 'ar-1011',
    createdAt: ago(190),
    finishedAt: ago(184),
    jobName: 'build-checkout-api-1011-a1',
    errorCode: null,
    logAvailability: logArchived,
  },
  {
    id: 'bd-1010',
    appId: 'a-checkout',
    pipelineId: 'pl-checkout-ci',
    status: 'failed',
    commitSha: '6c3f9a2d5b8e1c4f7a3d6b9e2c5f8a1d4b7e3c6f',
    commitSubject: 'test: 补结算压测脚本',
    configVersion: 6,
    attemptNo: 2,
    artifactId: null,
    createdAt: ago(1300),
    finishedAt: ago(1296),
    jobName: 'build-checkout-api-1010-a2',
    errorCode: 'buildkit_failed',
    logAvailability: logArchived,
  },
  {
    id: 'bd-1009',
    appId: 'a-checkout',
    pipelineId: 'pl-checkout-ci',
    status: 'canceled',
    commitSha: 'e8b1d4c7a2f5b8e3c6a9d2f5b1e4c7a3d6f9b2e5',
    commitSubject: 'docs: 更新发布说明',
    configVersion: 6,
    attemptNo: 1,
    artifactId: null,
    createdAt: ago(2400),
    finishedAt: ago(2394),
    jobName: 'build-checkout-api-1009-a1',
    errorCode: null,
    logAvailability: logArchived,
  },
  {
    id: 'bd-1008',
    appId: 'a-checkout',
    pipelineId: 'pl-checkout-ci',
    status: 'succeeded',
    commitSha: 'b71e4d9c2a5f8b3d6e9c1a4f7b2d5e8c3a6f9b1d',
    commitSubject: 'chore: 升级基础镜像到 1.22',
    configVersion: 6,
    attemptNo: 1,
    artifactId: 'ar-1008',
    createdAt: ago(3000),
    finishedAt: ago(2992),
    jobName: 'build-checkout-api-1008-a1',
    errorCode: null,
    logAvailability: 'expired',
  },
  {
    id: 'bd-900',
    appId: 'a-payment',
    pipelineId: 'pl-payment-ci',
    status: 'unknown',
    commitSha: 'a15c8e3b9d2f5a7c1e4b8d3f6a9c2e5b8d1f4a7c',
    commitSubject: 'refactor: 拆分订单聚合',
    configVersion: 4,
    attemptNo: 1,
    artifactId: null,
    createdAt: ago(58),
    finishedAt: null,
    jobName: 'build-payment-worker-900-a1',
    errorCode: null,
    logAvailability: 'unavailable',
  },
  {
    id: 'bd-899',
    appId: 'a-payment',
    pipelineId: 'pl-payment-ci',
    status: 'succeeded',
    commitSha: 'b71e4d9c2a5f8b3d6e9c1a4f7b2d5e8c3a6f9b1d',
    commitSubject: 'chore: 升级基础镜像到 1.22',
    configVersion: 3,
    attemptNo: 1,
    artifactId: 'ar-899',
    createdAt: ago(480),
    finishedAt: ago(472),
    jobName: 'build-payment-worker-899-a1',
    errorCode: null,
    logAvailability: logArchived,
  },
  {
    id: 'bd-700',
    appId: 'a-search',
    status: 'succeeded',
    commitSha: 'f3c9a1b7d4e6c2a8f5b1d7e3c9a6b2d8f4e1c7a3',
    commitSubject: 'fix: 索引重建并发控制',
    configVersion: 5,
    attemptNo: 1,
    artifactId: 'ar-700',
    createdAt: ago(140),
    finishedAt: ago(130),
    jobName: 'build-search-index-700-a1',
    errorCode: null,
    logAvailability: logArchived,
  },
]

export const artifacts: Artifact[] = [
  {
    id: 'ar-1011',
    appId: 'a-checkout',
    buildId: 'bd-1011',
    source: 'build',
    imageRepository: 'harbor.acme.dev/acme/checkout-api',
    digest: 'sha256:8f14e45fceea167a5a36dedd4bea2543c4b3f4b1d0f9a7e2c6b8d5a1f3e7c9b2',
    imageRef: 'harbor.acme.dev/acme/checkout-api:v1.42.0',
    createdAt: ago(184),
  },
  {
    id: 'ar-1008',
    appId: 'a-checkout',
    buildId: 'bd-1008',
    source: 'build',
    imageRepository: 'harbor.acme.dev/acme/checkout-api',
    digest: 'sha256:c9f0f895fb98ab9159f51fd0297e236d80fe5e4b5e7c1d2a3b4c5d6e7f8091a2',
    imageRef: 'harbor.acme.dev/acme/checkout-api:v1.41.3',
    createdAt: ago(2992),
  },
  {
    id: 'ar-899',
    appId: 'a-payment',
    buildId: 'bd-899',
    source: 'build',
    imageRepository: 'harbor.acme.dev/acme/payment-worker',
    digest: 'sha256:45c48cce2e2d7fbdea1afc51c7c6ad26f1e2d3c4b5a69788796a5b4c3d2e1f00',
    imageRef: 'harbor.acme.dev/acme/payment-worker:v0.9.7',
    createdAt: ago(472),
  },
  {
    id: 'ar-700',
    appId: 'a-search',
    buildId: 'bd-700',
    source: 'build',
    imageRepository: 'harbor.acme.dev/acme/search-index',
    digest: 'sha256:d3d9446802a44259755d38e6d163e8208f1c2b3a4d5e6f708192a3b4c5d6e7f8',
    imageRef: 'harbor.acme.dev/acme/search-index:v2.3.1',
    createdAt: ago(130),
  },
  {
    id: 'ar-storefront',
    appId: 'a-storefront',
    buildId: null,
    source: 'external',
    imageRepository: 'docker.io/acme/storefront',
    digest: 'sha256:6512d3ba4c5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8',
    imageRef: 'docker.io/acme/storefront:2.8.0',
    createdAt: ago(240),
  },
]

export const deployments: Deployment[] = [
  {
    id: 'd-checkout-dev-2',
    requestId: 'req-2002',
    appId: 'a-checkout',
    bindingId: 'b-checkout-dev',
    artifactId: 'ar-1011',
    imageRef: 'harbor.acme.dev/acme/checkout-api:v1.42.0',
    configVersion: 7,
    status: 'succeeded',
    kind: 'deploy',
    helmRevision: 12,
    createdAt: ago(180),
    operator: '张运维',
    reason: null,
  },
  {
    id: 'd-checkout-dev-1',
    requestId: 'req-2001',
    appId: 'a-checkout',
    bindingId: 'b-checkout-dev',
    artifactId: 'ar-1008',
    imageRef: 'harbor.acme.dev/acme/checkout-api:v1.41.3',
    configVersion: 6,
    status: 'succeeded',
    kind: 'rollback',
    helmRevision: 11,
    createdAt: ago(2600),
    operator: '王发布',
    reason: 'v1.41.3 回滚',
  },
  {
    id: 'd-checkout-staging-1',
    requestId: 'req-2003',
    appId: 'a-checkout',
    bindingId: 'b-checkout-staging',
    artifactId: 'ar-1011',
    imageRef: 'harbor.acme.dev/acme/checkout-api:v1.42.0',
    configVersion: 7,
    status: 'succeeded',
    kind: 'promote',
    helmRevision: 5,
    createdAt: ago(126),
    operator: '王发布',
    reason: null,
  },
  {
    id: 'd-checkout-prod-1',
    requestId: 'req-2004',
    appId: 'a-checkout',
    bindingId: 'b-checkout-prod',
    artifactId: 'ar-1011',
    imageRef: 'harbor.acme.dev/acme/checkout-api:v1.42.0',
    configVersion: 7,
    status: 'observing',
    kind: 'deploy',
    helmRevision: 21,
    createdAt: ago(42),
    operator: '张运维',
    reason: null,
  },
  {
    id: 'd-payment-dev-1',
    requestId: 'req-1901',
    appId: 'a-payment',
    bindingId: 'b-payment-dev',
    artifactId: 'ar-899',
    imageRef: 'harbor.acme.dev/acme/payment-worker:v0.9.7',
    configVersion: 3,
    status: 'failed',
    kind: 'deploy',
    helmRevision: 8,
    createdAt: ago(96),
    operator: '王发布',
    reason: 'Pod 启动后持续 CrashLoopBackOff',
  },
  {
    id: 'd-payment-prod-1',
    requestId: 'req-1900',
    appId: 'a-payment',
    bindingId: 'b-payment-prod',
    artifactId: 'ar-899',
    imageRef: 'harbor.acme.dev/acme/payment-worker:v0.9.7',
    configVersion: 2,
    status: 'unknown',
    kind: 'deploy',
    helmRevision: null,
    createdAt: ago(300),
    operator: '张运维',
    reason: 'Helm 调用超时，需核对实际 release 状态',
  },
  {
    id: 'd-metrics-staging-1',
    requestId: 'req-1500',
    appId: 'a-metrics',
    bindingId: 'b-metrics-staging',
    artifactId: 'ar-700',
    imageRef: 'harbor.acme.dev/acme/search-index:v2.3.1',
    configVersion: 3,
    status: 'succeeded',
    kind: 'deploy',
    helmRevision: 2,
    createdAt: ago(900),
    operator: '王发布',
    reason: null,
  },
]

export const resourceTypes: ResourceType[] = [
  { group: '', version: 'v1', resource: 'events', kind: 'Event', namespaced: true, verbs: ['get', 'list'], category: 'Cluster' },
  { group: '', version: 'v1', resource: 'serviceaccounts', kind: 'ServiceAccount', namespaced: true, verbs: ['get','list','patch','delete'], category: 'RBAC' },
  { group: 'rbac.authorization.k8s.io', version: 'v1', resource: 'rolebindings', kind: 'RoleBinding', namespaced: true, verbs: ['get','list','patch','delete'], category: 'RBAC' },
  { group: 'rbac.authorization.k8s.io', version: 'v1', resource: 'clusterroles', kind: 'ClusterRole', namespaced: false, verbs: ['get','list','patch','delete'], category: 'RBAC' },
  { group: 'rbac.authorization.k8s.io', version: 'v1', resource: 'clusterrolebindings', kind: 'ClusterRoleBinding', namespaced: false, verbs: ['get','list','patch','delete'], category: 'RBAC' },
  { group: '', version: 'v1', resource: 'persistentvolumes', kind: 'PersistentVolume', namespaced: false, verbs: ['get','list','patch','delete'], category: 'Config & Storage' },
  { group: 'storage.k8s.io', version: 'v1', resource: 'storageclasses', kind: 'StorageClass', namespaced: false, verbs: ['get','list','patch','delete'], category: 'Config & Storage' },
  { group: 'networking.k8s.io', version: 'v1', resource: 'networkpolicies', kind: 'NetworkPolicy', namespaced: true, verbs: ['get','list','patch','delete'], category: 'Networking' },
  { group: 'autoscaling', version: 'v2', resource: 'horizontalpodautoscalers', kind: 'HorizontalPodAutoscaler', namespaced: true, verbs: ['get','list','patch','delete'], category: 'Administration' },
  { group: '', version: 'v1', resource: 'resourcequotas', kind: 'ResourceQuota', namespaced: true, verbs: ['get','list','patch','delete'], category: 'Administration' },
  { group: '', version: 'v1', resource: 'limitranges', kind: 'LimitRange', namespaced: true, verbs: ['get','list','patch','delete'], category: 'Administration' },
  { group: 'policy', version: 'v1', resource: 'poddisruptionbudgets', kind: 'PodDisruptionBudget', namespaced: true, verbs: ['get','list','patch','delete'], category: 'Administration' },
  { group: 'apiextensions.k8s.io', version: 'v1', resource: 'customresourcedefinitions', kind: 'CustomResourceDefinition', namespaced: false, verbs: ['get','list','patch','delete'], category: 'Administration' },
  { group: '', version: 'v1', resource: 'pods', kind: 'Pod', namespaced: true, verbs: ['get', 'list', 'watch', 'delete'], category: 'Workloads' },
  { group: 'apps', version: 'v1', resource: 'deployments', kind: 'Deployment', namespaced: true, verbs: ['get', 'list', 'watch', 'patch', 'delete'], category: 'Workloads' },
  { group: 'apps', version: 'v1', resource: 'statefulsets', kind: 'StatefulSet', namespaced: true, verbs: ['get', 'list'], category: 'Workloads' },
  { group: 'batch', version: 'v1', resource: 'jobs', kind: 'Job', namespaced: true, verbs: ['get', 'list', 'delete'], category: 'Workloads' },
  { group: 'apps', version: 'v1', resource: 'replicasets', kind: 'ReplicaSet', namespaced: true, verbs: ['get', 'list'], category: 'Workloads' },
  { group: '', version: 'v1', resource: 'endpoints', kind: 'Endpoints', namespaced: true, verbs: ['get', 'list'], category: 'Networking' },
  { group: 'discovery.k8s.io', version: 'v1', resource: 'endpointslices', kind: 'EndpointSlice', namespaced: true, verbs: ['get', 'list'], category: 'Networking' },
  { group: 'apps', version: 'v1', resource: 'daemonsets', kind: 'DaemonSet', namespaced: true, verbs: ['get', 'list'], category: 'Workloads' },
  { group: 'batch', version: 'v1', resource: 'cronjobs', kind: 'CronJob', namespaced: true, verbs: ['get', 'list'], category: 'Workloads' },
  { group: '', version: 'v1', resource: 'services', kind: 'Service', namespaced: true, verbs: ['get', 'list'], category: 'Networking' },
  { group: 'networking.k8s.io', version: 'v1', resource: 'ingresses', kind: 'Ingress', namespaced: true, verbs: ['get', 'list'], category: 'Networking' },
  { group: '', version: 'v1', resource: 'configmaps', kind: 'ConfigMap', namespaced: true, verbs: ['get', 'list', 'patch', 'delete'], category: 'Config & Storage' },
  { group: '', version: 'v1', resource: 'secrets', kind: 'Secret', namespaced: true, verbs: ['get', 'list'], category: 'Config & Storage' },
  { group: '', version: 'v1', resource: 'persistentvolumeclaims', kind: 'PersistentVolumeClaim', namespaced: true, verbs: ['get', 'list'], category: 'Config & Storage' },
  { group: '', version: 'v1', resource: 'namespaces', kind: 'Namespace', namespaced: false, verbs: ['get', 'list'], category: 'Cluster' },
  { group: '', version: 'v1', resource: 'nodes', kind: 'Node', namespaced: false, verbs: ['get', 'list'], category: 'Cluster' },
  { group: 'rbac.authorization.k8s.io', version: 'v1', resource: 'roles', kind: 'Role', namespaced: true, verbs: ['get', 'list'], category: 'RBAC' },
  ...customResourceTypes,
]
for (const type of resourceTypes) type.shortNames ??= resourceShortNames[type.resource]

export const namespaces: Record<string, Namespace[]> = {
  'c-dev': [
    { name: 'shop-dev', uid: 'ns-1', phase: 'Active' },
    { name: 'shop-staging', uid: 'ns-2', phase: 'Active' },
    { name: 'search-dev', uid: 'ns-3', phase: 'Active' },
    { name: 'metrics', uid: 'ns-4', phase: 'Active' },
    { name: 'kube-system', uid: 'ns-5', phase: 'Active' },
  ],
  'c-prod': [
    { name: 'shop-prod', uid: 'ns-6', phase: 'Active' },
    { name: 'platform', uid: 'ns-7', phase: 'Active' },
    { name: 'kube-system', uid: 'ns-8', phase: 'Active' },
  ],
}

const deploymentManifest = (name: string, image: string, replicas: number, namespace = 'shop-prod') => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: ${namespace}
  labels:
    app.kubernetes.io/name: ${name}
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}
    spec:
      containers:
        - name: app
          image: ${image}
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 5
`

export const resources: K8sResource[] = [
  {
    ref: { group: 'apps', version: 'v1', resource: 'deployments', namespace: 'shop-prod', name: 'checkout-api', uid: 'uid-dep-1' },
    kind: 'Deployment',
    status: 'Available',
    summary: '4/4 就绪',
    manifest: deploymentManifest('checkout-api', 'harbor.acme.dev/acme/checkout-api:v1.42.0', 4),
    ownerRefs: [],
    appId: 'a-checkout',
  },
  {
    ref: { group: 'apps', version: 'v1', resource: 'deployments', namespace: 'shop-prod', name: 'payment-worker', uid: 'uid-dep-2' },
    kind: 'Deployment',
    status: 'CrashLoopBackOff',
    summary: '0/2 就绪，重启 14 次',
    manifest: deploymentManifest('payment-worker', 'harbor.acme.dev/acme/payment-worker:v0.9.7', 2),
    ownerRefs: [],
    appId: 'a-payment',
  },
  {
    ref: { group: 'apps', version: 'v1', resource: 'deployments', namespace: 'shop-prod', name: 'storefront', uid: 'uid-dep-3' },
    kind: 'Deployment',
    status: 'Available',
    summary: '3/3 就绪',
    manifest: deploymentManifest('storefront', 'docker.io/acme/storefront:2.8.0', 3),
    ownerRefs: [],
    appId: 'a-storefront',
  },
  {
    ref: { group: 'apps', version: 'v1', resource: 'deployments', namespace: 'shop-dev', name: 'checkout-api', uid: 'uid-dep-4' },
    kind: 'Deployment',
    status: 'Available',
    summary: '1/1 就绪',
    manifest: deploymentManifest('checkout-api', 'harbor.acme.dev/acme/checkout-api:v1.42.0', 1, 'shop-dev'),
    ownerRefs: [],
    appId: 'a-checkout',
  },
  {
    ref: { group: 'apps', version: 'v1', resource: 'deployments', namespace: 'shop-dev', name: 'payment-worker', uid: 'uid-dep-5' },
    kind: 'Deployment',
    status: 'Progressing',
    summary: '1/2 就绪',
    manifest: deploymentManifest('payment-worker', 'harbor.acme.dev/acme/payment-worker:v0.9.7', 2, 'shop-dev'),
    ownerRefs: [],
    appId: 'a-payment',
  },
  {
    ref: { group: '', version: 'v1', resource: 'pods', namespace: 'shop-prod', name: 'checkout-api-7d9f8b6c5-x2k4m', uid: 'uid-pod-1' },
    kind: 'Pod',
    status: 'Running',
    summary: 'Ready 2/2，重启 0 次',
    manifest: `apiVersion: v1
kind: Pod
metadata:
  name: checkout-api-7d9f8b6c5-x2k4m
  namespace: shop-prod
  labels:
    app: checkout-api
spec:
  containers:
    - name: app
      image: harbor.acme.dev/acme/checkout-api:v1.42.0
      ports:
        - containerPort: 8080
`,
    ownerRefs: ['ReplicaSet/checkout-api-7d9f8b6c5'],
    appId: 'a-checkout',
  },
  {
    ref: { group: '', version: 'v1', resource: 'pods', namespace: 'shop-prod', name: 'payment-worker-6b5c4d3e2-q8w7r', uid: 'uid-pod-2' },
    kind: 'Pod',
    status: 'CrashLoopBackOff',
    summary: 'Ready 0/1，重启 14 次',
    manifest: `apiVersion: v1
kind: Pod
metadata:
  name: payment-worker-6b5c4d3e2-q8w7r
  namespace: shop-prod
spec:
  containers:
    - name: app
      image: harbor.acme.dev/acme/payment-worker:v0.9.7
      ports:
        - containerPort: 9090
`,
    ownerRefs: ['ReplicaSet/payment-worker-6b5c4d3e2'],
    appId: 'a-payment',
  },
  {
    ref: { group: '', version: 'v1', resource: 'pods', namespace: 'shop-dev', name: 'checkout-api-5b8d7c9f4-t1n9p', uid: 'uid-pod-3' },
    kind: 'Pod',
    status: 'Running',
    summary: 'Ready 2/2，重启 0 次',
    manifest: `apiVersion: v1
kind: Pod
metadata:
  name: checkout-api-5b8d7c9f4-t1n9p
  namespace: shop-dev
spec:
  containers:
    - name: app
      image: harbor.acme.dev/acme/checkout-api:v1.42.0
      env:
        - name: LOG_LEVEL
          value: info
    - name: envoy
      image: envoyproxy/envoy:v1.31.0
  initContainers:
    - name: migrate
      image: harbor.acme.dev/acme/migrate:v1
  ephemeralContainers:
    - name: debugger
      image: busybox:1.37
status:
  phase: Running
  containerStatuses:
    - name: app
      state: {running: {startedAt: '2026-11-20T09:40:00Z'}}
    - name: envoy
      state: {running: {startedAt: '2026-11-20T09:40:00Z'}}
  initContainerStatuses:
    - name: migrate
      state: {terminated: {exitCode: 0, reason: Completed}}
  ephemeralContainerStatuses:
    - name: debugger
      state: {running: {startedAt: '2026-11-20T09:43:00Z'}}
`,
    ownerRefs: ['ReplicaSet/checkout-api-5b8d7c9f4'],
    appId: 'a-checkout',
  },
  {
    ref: { group: '', version: 'v1', resource: 'pods', namespace: 'shop-dev', name: 'checkout-api-5b8d7c9f4-v8m2q', uid: 'uid-pod-checkout-replica' },
    kind: 'Pod',
    status: 'Running',
    summary: 'Ready 2/2，重启 1 次',
    manifest: `apiVersion: v1
kind: Pod
metadata:
  name: checkout-api-5b8d7c9f4-v8m2q
  namespace: shop-dev
spec:
  containers:
    - name: app
      image: harbor.acme.dev/acme/checkout-api:v1.42.0
    - name: envoy
      image: envoyproxy/envoy:v1.31.0
status:
  phase: Running
  containerStatuses:
    - name: app
      restartCount: 1
      state: {running: {startedAt: '2026-11-20T09:41:00Z'}}
    - name: envoy
      restartCount: 0
      state: {running: {startedAt: '2026-11-20T09:41:00Z'}}
`,
    ownerRefs: ['ReplicaSet/checkout-api-5b8d7c9f4'],
    appId: 'a-checkout',
  },
  {
    ref: { group: 'apps', version: 'v1', resource: 'replicasets', namespace: 'shop-prod', name: 'checkout-api-7d9f8b6c5', uid: 'uid-rs-prod-1' },
    kind: 'ReplicaSet',
    status: 'Healthy',
    summary: '1/1 Ready',
    manifest: `apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: checkout-api-7d9f8b6c5
  namespace: shop-prod
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: checkout-api
`,
    ownerRefs: ['Deployment/checkout-api'],
    appId: 'a-checkout',
  },
  {
    ref: { group: 'apps', version: 'v1', resource: 'replicasets', namespace: 'shop-prod', name: 'payment-worker-6b5c4d3e2', uid: 'uid-rs-prod-2' },
    kind: 'ReplicaSet',
    status: 'Degraded',
    summary: '0/1 Ready',
    manifest: `apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: payment-worker-6b5c4d3e2
  namespace: shop-prod
spec:
  replicas: 1
`,
    ownerRefs: ['Deployment/payment-worker'],
    appId: 'a-payment',
  },
  {
    ref: { group: '', version: 'v1', resource: 'services', namespace: 'shop-dev', name: 'checkout-api', uid: 'uid-svc-dev' },
    kind: 'Service',
    status: 'Healthy',
    summary: 'ClusterIP 10.43.12.8:8080，2 个端点',
    manifest: `apiVersion: v1
kind: Service
metadata:
  name: checkout-api
  namespace: shop-dev
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: checkout-api
  ports:
    - port: 8080
      targetPort: 8080
`,
    ownerRefs: [],
    appId: 'a-checkout',
  },
  {
    ref: { group: 'apps', version: 'v1', resource: 'replicasets', namespace: 'shop-dev', name: 'checkout-api-5b8d7c9f4', uid: 'uid-rs-dev' },
    kind: 'ReplicaSet',
    status: 'Healthy',
    summary: '1/1 Ready',
    manifest: `apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: checkout-api-5b8d7c9f4
  namespace: shop-dev
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: checkout-api
`,
    ownerRefs: ['Deployment/checkout-api'],
    appId: 'a-checkout',
  },
  {
    ref: { group: 'networking.k8s.io', version: 'v1', resource: 'ingresses', namespace: 'shop-dev', name: 'checkout-api', uid: 'uid-ing-dev' },
    kind: 'Ingress',
    status: 'Healthy',
    summary: 'dev.acme.dev/checkout',
    manifest: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: checkout-api
  namespace: shop-dev
spec:
  rules:
    - host: dev.acme.dev
      http:
        paths:
          - path: /checkout
            pathType: Prefix
            backend:
              service:
                name: checkout-api
                port:
                  number: 8080
`,
    ownerRefs: [],
    appId: 'a-checkout',
  },
  {
    ref: { group: '', version: 'v1', resource: 'endpoints', namespace: 'shop-dev', name: 'checkout-api', uid: 'uid-ep-dev' },
    kind: 'Endpoints',
    status: 'Healthy',
    summary: '2 个地址',
    manifest: `apiVersion: v1
kind: Endpoints
metadata:
  name: checkout-api
  namespace: shop-dev
subsets:
  - addresses:
      - ip: 10.42.1.31
      - ip: 10.42.1.32
    ports:
      - port: 8080
`,
    ownerRefs: ['Service/checkout-api'],
    appId: 'a-checkout',
  },
  {
    ref: { group: 'discovery.k8s.io', version: 'v1', resource: 'endpointslices', namespace: 'shop-dev', name: 'checkout-api-24879', uid: 'uid-eps-dev' },
    kind: 'EndpointSlice',
    status: 'Healthy',
    summary: '2 个端点',
    manifest: `apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: checkout-api-24879
  namespace: shop-dev
addressType: IPv4
endpoints:
  - addresses:
      - 10.42.1.31
  - addresses:
      - 10.42.1.32
`,
    ownerRefs: ['Service/checkout-api'],
    appId: 'a-checkout',
  },
  {
    ref: { group: 'batch', version: 'v1', resource: 'jobs', namespace: 'metrics', name: 'metrics-agent-run-001', uid: 'uid-job-1' },
    kind: 'Job',
    status: 'Complete',
    summary: '1/1 成功',
    manifest: `apiVersion: batch/v1
kind: Job
metadata:
  name: metrics-agent-run-001
  namespace: metrics
spec:
  completions: 1
  parallelism: 1
  backoffLimit: 1
  activeDeadlineSeconds: 1800
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: agent
          image: harbor.acme.dev/acme/metrics-agent:v0.4.2
`,
    ownerRefs: [],
    appId: 'a-metrics',
  },
  {
    ref: { group: '', version: 'v1', resource: 'services', namespace: 'shop-prod', name: 'checkout-api', uid: 'uid-svc-1' },
    kind: 'Service',
    status: 'Active',
    summary: 'ClusterIP 10.43.21.9:8080',
    manifest: `apiVersion: v1
kind: Service
metadata:
  name: checkout-api
  namespace: shop-prod
spec:
  type: ClusterIP
  selector:
    app: checkout-api
  ports:
    - port: 8080
      targetPort: 8080
`,
    ownerRefs: [],
    appId: 'a-checkout',
  },
  {
    ref: { group: 'networking.k8s.io', version: 'v1', resource: 'ingresses', namespace: 'shop-prod', name: 'checkout-api', uid: 'uid-ing-1' },
    kind: 'Ingress',
    status: 'Active',
    summary: 'checkout.acme.dev → checkout-api:8080',
    manifest: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: checkout-api
  namespace: shop-prod
spec:
  rules:
    - host: checkout.acme.dev
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: checkout-api
                port:
                  number: 8080
`,
    ownerRefs: [],
    appId: 'a-checkout',
  },
  {
    ref: { group: '', version: 'v1', resource: 'configmaps', namespace: 'shop-prod', name: 'checkout-api-config', uid: 'uid-cm-1' },
    kind: 'ConfigMap',
    status: 'Active',
    summary: '4 个键',
    manifest: `apiVersion: v1
kind: ConfigMap
metadata:
  name: checkout-api-config
  namespace: shop-prod
data:
  LOG_LEVEL: info
  PAYMENT_TIMEOUT: "3000"
  FEATURE_COUPON: "true"
  MAX_RETRY: "3"
`,
    ownerRefs: [],
    appId: 'a-checkout',
  },
  {
    ref: { group: '', version: 'v1', resource: 'secrets', namespace: 'shop-prod', name: 'checkout-api-secret', uid: 'uid-sec-1' },
    kind: 'Secret',
    status: 'Active',
    summary: '2 个键（仅元信息）',
    manifest: `apiVersion: v1
kind: Secret
metadata:
  name: checkout-api-secret
  namespace: shop-prod
type: Opaque
data:
  db-password: <redacted>
  jwt-secret: <redacted>
`,
    ownerRefs: [],
    appId: 'a-checkout',
  },
  {
    ref: { group: '', version: 'v1', resource: 'configmaps', namespace: 'shop-dev', name: 'checkout-api-config', uid: 'uid-cm-dev' },
    kind: 'ConfigMap',
    status: 'Active',
    summary: '3 个键',
    manifest: `apiVersion: v1
kind: ConfigMap
metadata:
  name: checkout-api-config
  namespace: shop-dev
data:
  LOG_LEVEL: info
  MAX_RETRY: "3"
  FEATURE_COUPON: "true"
`,
    ownerRefs: [],
    appId: 'a-checkout',
  },
  {
    ref: { group: '', version: 'v1', resource: 'secrets', namespace: 'shop-dev', name: 'checkout-api-secret', uid: 'uid-sec-dev' },
    kind: 'Secret',
    status: 'Active',
    summary: '2 个键（仅元信息）',
    manifest: `apiVersion: v1
kind: Secret
metadata:
  name: checkout-api-secret
  namespace: shop-dev
type: Opaque
data:
  db-password: <redacted>
  jwt-secret: <redacted>
`,
    ownerRefs: [],
    appId: 'a-checkout',
  },
  {
    ref: { group: '', version: 'v1', resource: 'nodes', namespace: '_cluster', name: 'prod-node-01', uid: 'uid-node-1' },
    kind: 'Node',
    status: 'Ready',
    summary: '4C / 16Gi，kubelet v1.29.4',
    manifest: `apiVersion: v1
kind: Node
metadata:
  name: prod-node-01
status:
  conditions:
    - type: Ready
      status: "True"
  nodeInfo:
    kubeletVersion: v1.29.4
    osImage: Ubuntu 22.04.4 LTS
`,
    ownerRefs: [],
    appId: null,
  },
  {
    ref: { group: '', version: 'v1', resource: 'nodes', namespace: '_cluster', name: 'prod-node-02', uid: 'uid-node-2' },
    kind: 'Node',
    status: 'Ready',
    summary: '8C / 32Gi，kubelet v1.29.4',
    manifest: `apiVersion: v1
kind: Node
metadata:
  name: prod-node-02
status:
  conditions:
    - type: Ready
      status: "True"
`,
    ownerRefs: [],
    appId: null,
  },
  {
    ref: { group: '', version: 'v1', resource: 'nodes', namespace: '_cluster', name: 'dev-node-01', uid: 'uid-node-3' },
    kind: 'Node',
    status: 'Ready',
    summary: '3C / 12Gi，kubelet v1.27.5',
    manifest: `apiVersion: v1
kind: Node
metadata:
  name: dev-node-01
status:
  conditions:
    - type: Ready
      status: "True"
  nodeInfo:
    kubeletVersion: v1.27.5
    osImage: Ubuntu 22.04.4 LTS
`,
    ownerRefs: [],
    appId: null,
  },
]

resources.push(...customResources)

const nodeManifest = (name: string, version: string, ip: string) => `apiVersion: v1
kind: Node
metadata:
  name: ${name}
  labels:
    kubernetes.io/hostname: ${name}
    node-role.kubernetes.io/worker: ""
  annotations:
    node.alpha.kubernetes.io/ttl: "0"
spec:
  podCIDR: 10.42.0.0/24
status:
  addresses:
    - type: InternalIP
      address: ${ip}
    - type: Hostname
      address: ${name}
  nodeInfo:
    kubeletVersion: ${version}
    osImage: Ubuntu 22.04.4 LTS
    containerRuntimeVersion: containerd://1.7.11
  capacity:
    cpu: "4"
    memory: 16Gi
  allocatable:
    cpu: "4"
    memory: 16Gi
`

export const clusterOverviews: Record<string, ClusterOverview> = {
  'c-prod': {
    clusterId: 'c-prod',
    description: '生产集群，承载交易与前台服务',
    status: 'Healthy',
    addedOn: ago(46 * 24 * 60),
    addedBy: 'system',
    kubernetesVersion: 'v1.29.4',
    cpu: { usage: '6%', capacity: '12', request: '15%', limit: '19%' },
    memory: { usage: '49%', capacity: '21.82Gi', request: '5%', limit: '8%' },
    readme:
      '生产集群，6 个节点，承载 checkout-api、payment-worker、storefront 等应用。发布走平台内置 Chart，发布前需确认 digest 与配置版本。',
  },  'c-dev': {
    clusterId: 'c-dev',
    description: '开发与预发布共用集群',
    status: 'Healthy',
    addedOn: ago(30 * 24 * 60),
    addedBy: 'system',
    kubernetesVersion: 'v1.27.5',
    cpu: { usage: '22%', capacity: '6', request: '35%', limit: '48%' },
    memory: { usage: '41%', capacity: '12Gi', request: '28%', limit: '36%' },
    readme: '开发与预发布环境共用的 k3s 集群，允许自动发布到开发环境，预发布与生产仅手动。',
  },
}

export const nodeDetails: Record<string, NodeDetail> = {
  'prod-node-01': {
    name: 'prod-node-01',
    status: 'Ready',
    roles: 'worker',
    k8sVersion: 'v1.29.4',
    unschedulable: false,
    createdAt: ago(20 * 24 * 60),
    internalIp: '10.20.0.11',
    externalIp: '—',
    labels: [
      'kubernetes.io/hostname=prod-node-01',
      'eks.amazonaws.com/nodegroup=mainnode',
      'node-role.kubernetes.io/worker=',
      'topology.kubernetes.io/zone=az-a',
      'topology.kubernetes.io/region=cn-east',
    ],
    annotations: ['node.alpha.kubernetes.io/ttl=0', 'volumes.kubernetes.io/controller-managed-attach-detach=true'],
    taints: [],
    conditions: [
      { type: 'MemoryPressure', status: 'False', reason: 'KubeletHasSufficientMemory', message: 'kubelet has sufficient memory available', haveIssue: false },
      { type: 'DiskPressure', status: 'False', reason: 'KubeletHasNoDiskPressure', message: 'kubelet has no disk pressure', haveIssue: false },
      { type: 'PIDPressure', status: 'False', reason: 'KubeletHasSufficientPID', message: 'kubelet has sufficient PID available', haveIssue: false },
      { type: 'Ready', status: 'True', reason: 'KubeletReady', message: 'kubelet is posting ready status', haveIssue: false },
    ],
    resources: [
      { name: 'cpu', requestPercentage: '35%', limitPercentage: '60%', usagePercentage: '22%', usage: '880m', allocatable: '4', capacity: '4' },
      { name: 'memory', requestPercentage: '40%', limitPercentage: '70%', usagePercentage: '55%', usage: '8.8Gi', allocatable: '16Gi', capacity: '16Gi' },
      { name: 'ephemeral-storage', requestPercentage: '12%', limitPercentage: '20%', usagePercentage: '18%', allocatable: '100Gi', capacity: '120Gi' },
    ],
    pods: [
      { namespace: 'shop-prod', name: 'checkout-api-7d9f8b6c5-x2k4m', cpuRequest: '4%', cpuLimit: '8%', memRequest: '6%', memLimit: '10%', age: '42m' },
      { namespace: 'shop-prod', name: 'storefront-6c8d7f9b4-p7q2r', cpuRequest: '3%', cpuLimit: '6%', memRequest: '5%', memLimit: '8%', age: '4h' },
      { namespace: 'shop-prod', name: 'payment-worker-6b5c4d3e2-q8w7r', cpuRequest: '2%', cpuLimit: '4%', memRequest: '3%', memLimit: '6%', age: '1h' },
    ],
    errors: {},
    manifest: nodeManifest('prod-node-01', 'v1.29.4', '10.20.0.11'),
  },
  'prod-node-02': {
    name: 'prod-node-02',
    status: 'Ready',
    roles: 'worker',
    k8sVersion: 'v1.29.4',
    unschedulable: true,
    createdAt: ago(20 * 24 * 60),
    internalIp: '10.20.0.12',
    externalIp: '—',
    labels: ['kubernetes.io/hostname=prod-node-02', 'eks.amazonaws.com/nodegroup=mainnode-2', 'node-role.kubernetes.io/worker=', 'topology.kubernetes.io/zone=az-b'],
    annotations: ['node.alpha.kubernetes.io/ttl=0'],
    taints: [{ key: 'node.kubernetes.io/unschedulable', value: '', effect: 'NoSchedule' }],
    conditions: [
      { type: 'MemoryPressure', status: 'False', reason: 'KubeletHasSufficientMemory', message: 'kubelet has sufficient memory available', haveIssue: false },
      { type: 'DiskPressure', status: 'True', reason: 'KubeletHasDiskPressure', message: 'kubelet has disk pressure: imagefs usage 92%', haveIssue: true },
      { type: 'PIDPressure', status: 'False', reason: 'KubeletHasSufficientPID', message: 'kubelet has sufficient PID available', haveIssue: false },
      { type: 'Ready', status: 'True', reason: 'KubeletReady', message: 'kubelet is posting ready status', haveIssue: false },
    ],
    resources: [
      { name: 'cpu', requestPercentage: '68%', limitPercentage: '110%', usagePercentage: '74%', usage: '5920m', allocatable: '8', capacity: '8' },
      { name: 'memory', requestPercentage: '71%', limitPercentage: '92%', usagePercentage: '83%', usage: '26.56Gi', allocatable: '32Gi', capacity: '32Gi' },
      { name: 'ephemeral-storage', requestPercentage: '64%', limitPercentage: '88%', usagePercentage: '92%', allocatable: '180Gi', capacity: '200Gi' },
    ],
    pods: [
      { namespace: 'metrics', name: 'metrics-agent-run-001-j8k2l', cpuRequest: '6%', cpuLimit: '10%', memRequest: '8%', memLimit: '12%', age: '15h' },
    ],
    errors: {},
    manifest: nodeManifest('prod-node-02', 'v1.29.4', '10.20.0.12'),
  },
  'dev-node-01': {
    name: 'dev-node-01',
    status: 'Ready',
    roles: 'control-plane',
    k8sVersion: 'v1.27.5',
    unschedulable: false,
    createdAt: ago(9 * 24 * 60),
    internalIp: '10.20.0.21',
    externalIp: '—',
    labels: ['kubernetes.io/hostname=dev-node-01', 'eks.amazonaws.com/nodegroup=devnode', 'node-role.kubernetes.io/control-plane='],
    annotations: ['node.alpha.kubernetes.io/ttl=0'],
    taints: [{ key: 'node-role.kubernetes.io/control-plane', value: '', effect: 'NoSchedule' }],
    conditions: [
      { type: 'MemoryPressure', status: 'False', reason: 'KubeletHasSufficientMemory', message: 'kubelet has sufficient memory available', haveIssue: false },
      { type: 'DiskPressure', status: 'False', reason: 'KubeletHasNoDiskPressure', message: 'kubelet has no disk pressure', haveIssue: false },
      { type: 'Ready', status: 'True', reason: 'KubeletReady', message: 'kubelet is posting ready status', haveIssue: false },
    ],
    resources: [
      { name: 'cpu', requestPercentage: '18%', limitPercentage: '30%', usagePercentage: '12%', usage: '360m', allocatable: '3', capacity: '3' },
      { name: 'memory', requestPercentage: '22%', limitPercentage: '40%', usagePercentage: '35%', usage: '4.2Gi', allocatable: '12Gi', capacity: '12Gi' },
    ],
    pods: [
      { namespace: 'shop-dev', name: 'checkout-api-5b8d7c9f4-t1n9p', cpuRequest: '3%', cpuLimit: '6%', memRequest: '4%', memLimit: '8%', age: '12m' },
      { namespace: 'shop-dev', name: 'payment-worker-7c9d8b6f5-m3v8n', cpuRequest: '2%', cpuLimit: '5%', memRequest: '3%', memLimit: '6%', age: '3h' },
    ],
    errors: {},
    manifest: nodeManifest('dev-node-01', 'v1.27.5', '10.20.0.21'),
  },
}

// 节点概要和通用资源浏览器使用同一份初始 Manifest，后续写入也由 Mock API 同步。
for (const detail of Object.values(nodeDetails)) {
  const document = parseDocument(detail.manifest)
  const pairs = (values: string[]) => Object.fromEntries(values.map(value => { const equal = value.indexOf('='); return [equal === -1 ? value : value.slice(0, equal), equal === -1 ? '' : value.slice(equal + 1)] }))
  document.setIn(['metadata', 'labels'], pairs(detail.labels))
  document.setIn(['metadata', 'annotations'], pairs(detail.annotations))
  document.setIn(['spec', 'unschedulable'], detail.unschedulable)
  document.setIn(['spec', 'taints'], detail.taints)
  for (const resource of detail.resources.filter(row => row.name === 'cpu' || row.name === 'memory')) {
    document.setIn(['status', 'capacity', resource.name], resource.capacity)
    document.setIn(['status', 'allocatable', resource.name], resource.allocatable)
  }
  document.setIn(['status', 'conditions'], detail.conditions.map(({ haveIssue: _issue, ...condition }) => condition))
  detail.manifest = document.toString()
  const resource = resources.find(row => row.kind === 'Node' && row.ref.name === detail.name)
  if (resource) resource.manifest = detail.manifest
}

export const events: Record<string, ResourceEvent[]> = {
  'uid-pod-2': [
    {
      type: 'Warning',
      reason: 'BackOff',
      message: 'Back-off restarting failed container app in pod payment-worker-6b5c4d3e2-q8w7r',
      count: 14,
      firstSeenAt: ago(96),
      lastSeenAt: ago(8),
    },
    {
      type: 'Warning',
      reason: 'Unhealthy',
      message: 'Readiness probe failed: dial tcp 10.42.3.17:9090: connect: connection refused',
      count: 9,
      firstSeenAt: ago(92),
      lastSeenAt: ago(12),
    },
    {
      type: 'Normal',
      reason: 'Pulled',
      message: 'Container image "harbor.acme.dev/acme/payment-worker:v0.9.7" already present on machine',
      count: 1,
      lastSeenAt: ago(96),
    },
  ],
  'uid-dep-2': [
    {
      type: 'Warning',
      reason: 'ProgressDeadlineExceeded',
      message: 'ReplicaSet "payment-worker-6b5c4d3e2" has timed out progressing',
      count: 3,
      lastSeenAt: ago(6),
    },
  ],
  'uid-dep-1': [
    {
      type: 'Normal',
      reason: 'ScalingReplicaSet',
      message: 'Scaled up replica set checkout-api-7d9f8b6c5 to 4',
      count: 1,
      lastSeenAt: ago(42),
    },
  ],
}

export const podLogs: Record<string, string[]> = {
  'uid-pod-1': [
    '2026-11-20T09:58:02.114Z INFO  server  starting checkout-api v1.42.0 (commit f3c9a1b7)',
    '2026-11-20T09:58:02.201Z INFO  config  loaded 4 keys from configmap checkout-api-config',
    '2026-11-20T09:58:02.377Z INFO  http    listening on :8080',
    '2026-11-20T09:58:03.002Z INFO  readyz  /healthz 200',
    '2026-11-20T09:58:31.441Z INFO  http    GET /api/cart 200 12ms',
    '2026-11-20T09:58:31.912Z INFO  http    POST /api/checkout/preview 200 34ms',
    '2026-11-20T09:59:02.133Z WARN  payment client timeout after 3000ms, retry 1/3',
    '2026-11-20T09:59:05.289Z INFO  http    POST /api/checkout/commit 201 87ms',
    '2026-11-20T09:59:40.004Z INFO  http    GET /api/cart 200 9ms',
    '2026-11-20T10:00:00.001Z INFO  metrics flush ok (128 series)',
  ],
  'uid-pod-2': [
    '2026-11-20T09:44:11.001Z INFO  worker  booting payment-worker v0.9.7',
    '2026-11-20T09:44:11.245Z INFO  kafka   connecting brokers=[kafka-0:9092 kafka-1:9092]',
    '2026-11-20T09:44:16.332Z ERROR kafka   dial tcp 10.42.9.4:9092: i/o timeout',
    '2026-11-20T09:44:16.334Z ERROR boot    failed to init consumer: context deadline exceeded',
    '2026-11-20T09:44:16.335Z INFO  worker  shutting down with exit code 1',
  ],
  'uid-pod-3': [
    '2026-11-20T09:41:02.014Z INFO  server  starting checkout-api v1.42.0 (dev matrix)',
    '2026-11-20T09:41:02.108Z INFO  config  loaded 3 keys from configmap checkout-api-config',
    '2026-11-20T09:41:02.233Z INFO  http    listening on :8080',
    '2026-11-20T09:41:02.901Z INFO  readyz  /healthz 200',
    '2026-11-20T09:41:19.442Z INFO  http    GET /api/cart 200 8ms',
    '2026-11-20T09:41:44.117Z WARN  payment client slow: 1204ms (threshold 1000ms)',
    '2026-11-20T09:42:00.008Z INFO  metrics flush ok (96 series)',
  ],
}

/** Independent container histories; no fallback to another container's log content. */
export const containerPodLogs: Record<string, string[]> = {
  'uid-pod-checkout-replica/app': [
    '2026-11-20T09:41:03.000Z INFO  replica server starting checkout-api v1.42.0 (Mock)',
    '2026-11-20T09:41:04.000Z INFO  replica listening on :8080',
    '2026-11-20T09:41:45.000Z WARN  replica payment client slow',
    '2026-11-20T09:42:01.000Z INFO  replica metrics flush ok',
  ],
  'uid-pod-checkout-replica/envoy': [
    '2026-11-20T09:41:03.000Z INFO  replica envoy proxy ready',
    '2026-11-20T09:41:46.000Z ERROR replica envoy upstream timeout status=503',
    '2026-11-20T09:42:01.000Z INFO  replica envoy status=200 recovered',
  ],
  'uid-pod-3/envoy': Array.from({ length: 160 }, (_, index) => `${new Date(Date.UTC(2026, 10, 20, 9, 40, index)).toISOString()} INFO  envoy request=${index + 1} upstream=checkout-api:8080 status=${index % 11 === 0 ? '503' : '200'} duration=12ms path=/api/checkout/preview user-agent=Mozilla/5.0 forwarded-for=10.42.1.20 trace_id=mock-proxy-${index + 1}`),
  'uid-pod-3/migrate': [
    '2026-11-20T09:40:00.000Z INFO  migration starting',
    '2026-11-20T09:40:01.000Z INFO  migration version=42 complete',
  ],
  'uid-pod-3/debugger': [
    '2026-11-20T09:43:00.000Z INFO  debugger attached (Mock)',
    '2026-11-20T09:43:01.000Z \x1b[32mSUCCESS\x1b[0m diagnostic complete (Mock)',
    '2026-11-20T09:43:02.000Z \x1b[31mERROR\x1b[0m demonstration only (Mock)',
    'progress 10%\r\x1b[2Kprogress 100% (Mock)',
    '<script>window.logMarkupExecuted = true</script> (literal Mock log)',
  ],
}
export const previousPodLogs: Record<string, string[]> = {
  'uid-pod-checkout-replica/app': [
    '2026-11-20T09:40:30.000Z INFO  replica previous instance started',
    '2026-11-20T09:40:59.000Z ERROR replica previous instance exited code=1',
  ],
  'uid-pod-2/app': [
    '2026-11-20T09:42:00.000Z INFO  worker previous instance started',
    '2026-11-20T09:42:05.000Z ERROR kafka connection timed out',
    '2026-11-20T09:42:05.010Z INFO  previous instance exited code=1',
  ],
}

const auditTarget = (kind: string, name: string) => `${kind}/${name}`

export const auditEvents: AuditEvent[] = [
  { id: 'au-1', actorId: 'u-1', actorName: '张运维', action: 'deploy.trigger', target: auditTarget('Deployment', 'checkout-api@shop-prod'), result: 'accepted', createdAt: ago(42) },
  { id: 'au-2', actorId: 'u-1', actorName: '张运维', action: 'deployment.preview', target: auditTarget('Application', 'checkout-api'), result: 'succeeded', createdAt: ago(45) },
  { id: 'au-3', actorId: 'u-2', actorName: '李开发', action: 'build.trigger', target: auditTarget('Application', 'checkout-api'), result: 'accepted', createdAt: ago(190) },
  { id: 'au-4', actorId: 'u-2', actorName: '李开发', action: 'config.save', target: auditTarget('Application', 'checkout-api') + '#base', result: 'succeeded', createdAt: ago(210) },
  { id: 'au-5', actorId: 'u-3', actorName: '王发布', action: 'deploy.trigger', target: auditTarget('Deployment', 'payment-worker@shop-dev'), result: 'failed', createdAt: ago(96) },
  { id: 'au-6', actorId: 'u-1', actorName: '张运维', action: 'config.save', target: auditTarget('Application', 'payment-worker') + '#build', result: 'succeeded', createdAt: ago(320) },
  { id: 'au-7', actorId: 'u-4', actorName: '赵观察', action: 'resource.delete', target: auditTarget('Pod', 'checkout-api-5b8d7c9f4-k3q2z'), result: 'denied', createdAt: ago(410) },
  { id: 'au-8', actorId: 'u-1', actorName: '张运维', action: 'cluster.connect', target: auditTarget('Cluster', 'prod-k8s'), result: 'succeeded', createdAt: ago(600) },
  { id: 'au-9', actorId: 'u-1', actorName: '张运维', action: 'secret.reveal', target: auditTarget('Secret', 'checkout-api-secret@shop-prod'), result: 'denied', createdAt: ago(700) },
  { id: 'au-10', actorId: 'u-2', actorName: '李开发', action: 'workflow.save', target: auditTarget('Application', 'search-index'), result: 'succeeded', createdAt: ago(820) },
  { id: 'au-11', actorId: 'u-3', actorName: '王发布', action: 'build.cancel', target: auditTarget('Build', 'bd-1009'), result: 'succeeded', createdAt: ago(2394) },
  { id: 'au-12', actorId: 'u-1', actorName: '张运维', action: 'app.create', target: auditTarget('Application', 'notify-service'), result: 'succeeded', createdAt: ago(300) },
  { id: 'au-13', actorId: 'u-1', actorName: '张运维', action: 'auth.login', target: auditTarget('User', 'admin@acme.dev'), result: 'succeeded', createdAt: ago(360) },
  { id: 'au-14', actorId: 'u-2', actorName: '李开发', action: 'deploy.trigger', target: auditTarget('Deployment', 'checkout-api@shop-staging'), result: 'unknown', createdAt: ago(126) },
]

export const credentials: Credential[] = [
  { id: 'cr-git', name: 'acme-git-token', kind: 'git', version: 3, updatedAt: ago(1440) },
  { id: 'cr-registry', name: 'harbor-push', kind: 'registry', version: 2, updatedAt: ago(2880) },
  { id: 'cr-prod', name: 'prod-kubeconfig', kind: 'kubeconfig', version: 5, updatedAt: ago(600) },
]

export const registries: Registry[] = [
  { id: 'r-harbor', name: 'harbor.acme.dev', endpoint: 'https://harbor.acme.dev', credentialId: 'cr-registry' },
  { id: 'r-dockerhub', name: 'docker.io', endpoint: 'https://docker.io', credentialId: null },
]

// ---- 配置管理：ConfigMap / Secret（mock 扩展，对齐 Devtron Base Configurations） ----
// environmentId 为 null 表示 Base；Secret 只保存 key，不保存明文值。
export const configMaps: ConfigMapEntry[] = [
  {
    id: 'cm-checkout-base',
    appId: 'a-checkout',
    environmentId: null,
    name: 'checkout-api-config',
    data: { LOG_LEVEL: 'info', CURRENCY: 'CNY', CACHE_TTL_SECONDS: '60' },
    updatedAt: ago(320),
  },
  {
    id: 'cm-checkout-dev',
    mergeStrategy: 'patch',
    appId: 'a-checkout',
    environmentId: 'e-dev',
    name: 'checkout-api-config',
    data: { LOG_LEVEL: 'debug' },
    updatedAt: ago(95),
  },
  {
    id: 'cm-checkout-prod',
    mergeStrategy: 'patch',
    appId: 'a-checkout',
    environmentId: 'e-prod',
    name: 'checkout-api-config',
    data: { LOG_LEVEL: 'warn', CURRENCY: 'CNY' },
    updatedAt: ago(42),
  },
  {
    id: 'cm-payment-base',
    appId: 'a-payment',
    environmentId: null,
    name: 'payment-worker-config',
    data: { QUEUE_NAME: '@{{payment-queue}}', RETRY_LIMIT: '3' },
    updatedAt: ago(600),
  },
]

export const configSecrets: SecretEntry[] = [
  {
    id: 'sc-checkout-base',
    appId: 'a-checkout',
    environmentId: null,
    name: 'checkout-api-secret',
    keys: ['DB_PASSWORD', 'API_TOKEN'],
    updatedAt: ago(500),
  },
  {
    id: 'sc-checkout-dev',
    appId: 'a-checkout',
    environmentId: 'e-dev',
    name: 'checkout-db',
    keys: ['DB_PASSWORD'],
    updatedAt: ago(120),
  },
  {
    id: 'sc-checkout-prod',
    appId: 'a-checkout',
    environmentId: 'e-prod',
    name: 'checkout-api-secret',
    keys: ['DB_PASSWORD', 'API_TOKEN', 'SIGNING_KEY'],
    updatedAt: ago(42),
  },
  {
    id: 'sc-payment-base',
    appId: 'a-payment',
    environmentId: null,
    name: 'payment-worker-secret',
    keys: ['DB_PASSWORD', 'GATEWAY_KEY'],
    updatedAt: ago(610),
  },
]

// 固定的本地历史示例；不从当前配置反推过去发布时的配置。
for (const id of ['d-checkout-dev-1', 'd-checkout-dev-2']) {
  const deployment = deployments.find((item) => item.id === id)!
  const previous = id === 'd-checkout-dev-1'
  deployment.configSnapshot = {
    source: 'fixture', capturedAt: deployment.createdAt,
    baseValues: { replicaCount: previous ? 1 : 2, containerPort: 8080, host: 'checkout.acme.dev' },
    values: { replicaCount: 1, containerPort: 8080, host: 'checkout.acme.dev' },
    configMaps: [{ id: `snapshot-${id}-cm`, appId: 'a-checkout', environmentId: 'e-dev', name: 'checkout-api-config', data: { LOG_LEVEL: previous ? 'info' : 'debug', CURRENCY: 'CNY', CACHE_TTL_SECONDS: previous ? '30' : '60' }, mountAs: 'env', updatedAt: deployment.createdAt }],
    secrets: [{ id: `snapshot-${id}-secret`, appId: 'a-checkout', environmentId: null, name: 'checkout-api-secret', keys: ['DB_PASSWORD', 'API_TOKEN'], updatedAt: deployment.createdAt }],
    target: { clusterId: 'c-dev', namespace: 'shop-dev', releaseName: 'checkout-api-dev' },
    chartConfig: { workloadKind: 'Deployment', chartVersion: '1.4.0' },
  }
}

// 独立的历史变量示例；旧 payment 发布仍保留缺少快照的状态。
const scopedPaymentDeployment: Deployment = {
  id: 'd-payment-dev-scoped', requestId: 'req-payment-scoped', appId: 'a-payment', bindingId: 'b-payment-dev',
  artifactId: 'ar-899', imageRef: 'harbor.acme.dev/acme/payment-worker:v0.9.7', configVersion: 3,
  status: 'succeeded', kind: 'deploy', helmRevision: 7, createdAt: ago(160), operator: '张运维', reason: null,
  configSnapshot: {
    source: 'fixture', capturedAt: ago(160),
    baseValues: { replicaCount: 2, containerPort: 9090, env: { REGION: '@{{payment-region}}' } },
    values: { replicaCount: 2, containerPort: 9090, env: { REGION: '@{{payment-region}}' } },
    configMaps: [{ id: 'snapshot-payment-scoped-cm', appId: 'a-payment', environmentId: null, name: 'payment-worker-config', data: { QUEUE_NAME: '@{{payment-queue}}', RETRY_LIMIT: '3' }, updatedAt: ago(160) }],
    secrets: [{ id: 'snapshot-payment-scoped-secret', appId: 'a-payment', environmentId: null, name: 'payment-worker-secret', keys: ['DB_PASSWORD', 'GATEWAY_KEY'], updatedAt: ago(160) }],
    target: { clusterId: 'c-dev', namespace: 'shop-dev', releaseName: 'payment-worker' }, chartConfig: { workloadKind: 'Deployment', chartVersion: '1.4.0' },
  },
}
const scopedPaymentSnapshot = scopedPaymentDeployment.configSnapshot!
scopedPaymentSnapshot.variableSnapshot = captureConfigVariables(configDocument(scopedPaymentSnapshot.values, scopedPaymentSnapshot.configMaps, scopedPaymentSnapshot.secrets), { 'payment-region': 'cn-beijing', 'payment-queue': 'payments-legacy' })
deployments.push(scopedPaymentDeployment)

// ---- 查询辅助（页面直接引用，避免重复过滤逻辑） ----
export const appById = (id: string): Application | undefined => applications.find((a) => a.id === id)
export const stageRuns: StageRun[] = []
export const projectById = (id: string): Project | undefined => projects.find((p) => p.id === id)
export const envById = (id: string): Environment | undefined => environments.find((e) => e.id === id)
export const clusterById = (id: string): Cluster | undefined => clusters.find((c) => c.id === id)
export const bindingById = (id: string): Binding | undefined => bindings.find((b) => b.id === id)
export const bindingByEnv = (appId: string, envId: string): Binding | undefined =>
  bindings.find((b) => b.appId === appId && b.environmentId === envId)
export const bindingsOf = (appId: string): Binding[] => bindings.filter((b) => b.appId === appId)
export const buildsOf = (appId: string): Build[] => builds.filter((b) => b.appId === appId)
export const artifactsOf = (appId: string): Artifact[] => artifacts.filter((a) => a.appId === appId)
export const deploymentsOf = (appId: string): Deployment[] =>
  deployments.filter((d) => d.appId === appId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
export const resourcesOf = (clusterId: string, resource: string) =>
  resources.filter((r) => r.ref.resource === resource && (clusterId === 'c-prod' ? r.ref.namespace === 'shop-prod' : r.ref.namespace !== 'shop-prod'))
export const resourcesOfApp = (appId: string) => resources.filter((r) => r.appId === appId)
export const envLabel = (envId: string): string => envById(envId)?.name ?? envId
export const appLabel = (appId: string): string => appById(appId)?.name ?? appId
