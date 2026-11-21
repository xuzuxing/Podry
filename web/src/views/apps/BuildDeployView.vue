<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SelectValue } from 'tdesign-vue-next'
import { useRoute, useRouter } from 'vue-router'

import {
  getConfig,
  getSetup,
  getWorkflow,
  listArtifacts,
  listBindings,
  listBuilds,
  listDeployments,
  listEnvironments,
  MockError,
} from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import type {
  AppConfig,
  ApplicationSetup,
  Artifact,
  Binding,
  Build,
  BuildStatus,
  Deployment,
  DeployStatus,
  Environment,
  Pipeline,
  Workflow,
} from '@/types'

import PipelineEditDrawer from './components/pipeline/PipelineEditDrawer.vue'
import PipelineGraph from './components/pipeline/PipelineGraph.vue'
import type { GraphRow } from './components/pipeline/PipelineGraph.vue'
import SelectImageDrawer from './components/pipeline/SelectImageDrawer.vue'
import SelectMaterialDrawer from './components/pipeline/SelectMaterialDrawer.vue'

type NodeTone = 'success' | 'danger' | 'info' | 'warning'

interface NodeStatus {
  tone: NodeTone
  label: string
}

interface SourceNode {
  kicker: string
  value: string
  branch: string
  icon: string
}

interface CiNode {
  id: string
  name: string
  status: NodeStatus
}

interface CdNode {
  id: string
  bindingId: string
  envName: string
  deployLabel: string
  status: NodeStatus
}

interface WorkflowGroup {
  key: string
  name: string
  source: SourceNode
  ci: CiNode | null
  cds: CdNode[]
}

const route = useRoute()
const router = useRouter()
const projectId = computed(() => String(route.params.projectId ?? ''))
const appId = computed(() => String(route.params.appId ?? ''))
const baseParams = computed(() => ({ projectId: projectId.value, appId: appId.value }))

const setup = ref<ApplicationSetup | null>(null)
const config = ref<AppConfig | null>(null)
const workflow = ref<Workflow | null>(null)
const bindings = ref<Binding[]>([])
const environments = ref<Environment[]>([])
const artifacts = ref<Artifact[]>([])
const builds = ref<Build[]>([])
const deployments = ref<Deployment[]>([])

const loading = ref(true)
const error = ref('')

const workflowFilter = ref('all')

/* 编辑流水线抽屉（与「设置 → 工作流」共用组件） */
const editVisible = ref(false)
const editPipeline = ref<Pipeline | null>(null)

function openPipelineEdit(id: string): void {
  const pipeline = workflow.value?.items.find((item) => item.id === id) ?? null
  if (!pipeline) return
  editPipeline.value = pipeline
  editVisible.value = true
}

function onPipelineSaved(next: Workflow): void {
  workflow.value = next
}

const materialVisible = ref(false)
const materialPipeline = ref('')
const imageVisible = ref(false)
const imageBindingId = ref('')

const canBuild = computed(() => setup.value?.canBuild === true)
const configVersion = computed(() => setup.value?.configVersion ?? 0)
const repositoryUrl = computed(() => config.value?.gitConfig?.repositoryUrl ?? '')

const buildViews: Record<BuildStatus, NodeStatus> = {
  queued: { tone: 'info', label: 'In progress' },
  running: { tone: 'info', label: 'In progress' },
  canceling: { tone: 'info', label: 'Canceling' },
  succeeded: { tone: 'success', label: 'Succeeded' },
  failed: { tone: 'danger', label: 'Failed' },
  canceled: { tone: 'danger', label: 'Aborted' },
  unknown: { tone: 'warning', label: 'Unknown' },
}

const deployViews: Record<DeployStatus, NodeStatus> = {
  queued: { tone: 'info', label: 'Queued' },
  submitting: { tone: 'info', label: 'Submitting' },
  observing: { tone: 'info', label: 'Progressing' },
  succeeded: { tone: 'success', label: 'Succeeded' },
  failed: { tone: 'danger', label: 'Failed' },
  unknown: { tone: 'warning', label: 'Unknown' },
}

const externalSource: SourceNode = {
  kicker: 'Webhook',
  value: 'External source',
  branch: '',
  icon: 'link',
}

function errorTextOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/** 仓库地址 → Devtron 的 `/repo` 形式；拿不到地址时返回空串 */
function repoPath(url: string): string {
  const trimmed = url.replace(/\.git$/, '').replace(/[/:]+$/, '')
  const name = trimmed.split(/[/:]/).filter(Boolean).pop() ?? ''
  return name ? `/${name}` : ''
}

/** 稳定 4 位后缀（对齐 Devtron 的 wf-1-h6l7 命名，不用随机值以免刷新跳变） */
function shortKey(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) hash = (hash * 31 + input.charCodeAt(i)) >>> 0
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let value = hash
  let result = ''
  for (let i = 0; i < 4; i += 1) {
    result += alphabet.charAt(value % alphabet.length)
    value = Math.floor(value / alphabet.length)
  }
  return result
}

const gitSource = computed<SourceNode>(() => {
  const git = config.value?.gitConfig
  const path = repoPath(git?.repositoryUrl ?? '')
  if (!git?.repositoryUrl || !path) return externalSource
  return { kicker: 'Git', value: path, branch: git.branch, icon: 'logo-github' }
})

const ciName = computed(() => {
  const slug = repoPath(repositoryUrl.value).replace(/^\//, '').split(/[-_]/)[0]
  return slug ? `ci-${slug}` : 'ci-pipeline'
})

const deployLabel = computed(() => `Deploy: ${config.value?.chartConfig?.workloadKind === 'Job' ? 'Job' : 'Rolling'}`)

const buildsSorted = computed(() =>
  builds.value.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
)
const deploymentsSorted = computed(() =>
  deployments.value.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
)

function upstreamOf(pipeline: Pipeline): string | null {
  return 'triggerMode' in pipeline.definition ? pipeline.definition.upstreamPipelineId : null
}

function ciNodeFor(pipeline: Pipeline): CiNode {
  const latest = buildsSorted.value.find((item) => item.appId === appId.value)
  return {
    id: pipeline.id,
    name: ciName.value,
    status: latest ? buildViews[latest.status] : { tone: 'warning', label: 'Not built' },
  }
}

function cdNodeFor(pipeline: Pipeline): CdNode {
  const binding = bindings.value.find((item) => item.id === pipeline.bindingId) ?? null
  const environment = binding ? environments.value.find((item) => item.id === binding.environmentId) : undefined
  const latest = binding ? deploymentsSorted.value.find((item) => item.bindingId === binding.id) : undefined
  return {
    id: pipeline.id,
    bindingId: binding?.id ?? '',
    envName: environment?.name ?? '未绑定环境',
    deployLabel: deployLabel.value,
    status: latest ? deployViews[latest.status] : { tone: 'warning', label: 'Not deployed' },
  }
}

const groups = computed<WorkflowGroup[]>(() => {
  const items = workflow.value?.items ?? []
  const cis = items.filter((item) => item.kind === 'ci')
  const cds = items.filter((item) => item.kind === 'cd')
  const ciIds = cis.map((item) => item.id)
  const result: WorkflowGroup[] = []

  cis.forEach((ci) => {
    result.push({
      key: ci.id,
      name: '',
      source: gitSource.value,
      ci: ciNodeFor(ci),
      cds: cds.filter((cd) => upstreamOf(cd) === ci.id).map(cdNodeFor),
    })
  })

  // 没有上游 CI 的 CD 单独成一条 workflow，来源显示为外部镜像
  cds
    .filter((cd) => {
      const upstream = upstreamOf(cd)
      return !upstream || !ciIds.includes(upstream)
    })
    .forEach((cd) => {
      result.push({
        key: cd.id,
        name: '',
        source: externalSource,
        ci: null,
        cds: [cdNodeFor(cd)],
      })
    })

  return result.map((group, index) => {
    const kindLabel = group.ci ? '源码构建部署' : '镜像部署'
    const suffix = group.ci ? group.ci.name : group.cds[0]?.envName ?? shortKey(group.key)
    return { ...group, name: `${index + 1}. ${kindLabel} · ${suffix}` }
  })
})

const graphRows = computed<GraphRow[]>(() =>
  visibleGroups.value.map((group, index) => {
    const cdNodes = group.cds.map((cd) => ({
      id: cd.id,
      kind: 'cd' as const,
      kicker: cd.deployLabel,
      title: cd.envName,
      icon: 'rocket',
      status: cd.status,
    }))
    const ciNodeData = group.ci
      ? {
          id: group.ci.id,
          kind: 'ci' as const,
          kicker: 'Build',
          title: group.ci.name,
          icon: 'tools',
          status: group.ci.status,
        }
      : null
    return {
      key: group.key,
      name: `wf-${index + 1}-${(ciNodeData?.id ?? cdNodes[0]?.id ?? group.key).split('-').pop()}`,
      source: group.ci
        ? { kicker: 'Git', value: group.source.value, branch: group.source.branch || undefined, icon: 'git' }
        : { kicker: 'Webhook', value: 'External source', icon: 'git' },
      ci: ciNodeData,
      cds: cdNodes,
    }
  }),
)
function onSelectMaterial(ciId: string): void {
  const group = visibleGroups.value.find((item) => item.ci?.id === ciId)
  if (group) openMaterial(group)
}

function onSelectImage(cdId: string): void {
  for (const group of visibleGroups.value) {
    const cd = group.cds.find((item) => item.id === cdId)
    if (cd) {
      openImage(cd)
      return
    }
  }
}

function onNodeDetails(id: string): void {
  const pipeline = workflow.value?.items.find((item) => item.id === id)
  void router.push({
    name: pipeline?.kind === 'ci' ? 'app-builds' : 'app-deployments',
    params: baseParams.value,
  })
}
const workflowOptions = computed(() => [
  { label: '全部工作流', value: 'all' },
  ...groups.value.map((group) => ({ label: group.name, value: group.name })),
])

const visibleGroups = computed(() =>
  workflowFilter.value === 'all'
    ? groups.value
    : groups.value.filter((group) => group.name === workflowFilter.value),
)

watch(groups, (list) => {
  if (workflowFilter.value !== 'all' && !list.some((group) => group.name === workflowFilter.value)) {
    workflowFilter.value = 'all'
  }
})

function onWorkflowFilter(value: SelectValue): void {
  workflowFilter.value = typeof value === 'string' && value ? value : 'all'
}

function openMaterial(group: WorkflowGroup): void {
  if (!group.ci) return
  materialPipeline.value = group.ci.name
  materialVisible.value = true
}

function openImage(node: CdNode): void {
  imageBindingId.value = node.bindingId
  imageVisible.value = true
}

async function loadSetup(): Promise<ApplicationSetup | null> {
  try {
    return await getSetup(appId.value)
  } catch (err) {
    // 新建应用还没有 setup 记录：按「未开始配置」处理，仍然展示工作流与空态
    if (err instanceof MockError && err.code === 'not_found') return null
    throw err
  }
}

async function load(): Promise<void> {
  if (!appId.value) return
  loading.value = true
  error.value = ''
  try {
    const [setupData, configData, workflowData, bindingList, environmentList, artifactList, buildPage, deployPage] =
      await Promise.all([
        loadSetup(),
        getConfig(appId.value),
        getWorkflow(appId.value),
        listBindings(appId.value),
        listEnvironments(),
        listArtifacts(appId.value),
        listBuilds(appId.value),
        listDeployments(appId.value),
      ])
    setup.value = setupData
    config.value = configData
    workflow.value = workflowData
    bindings.value = bindingList
    environments.value = environmentList
    artifacts.value = artifactList
    builds.value = buildPage.items
    deployments.value = deployPage.items
  } catch (err) {
    error.value = errorTextOf(err, '构建发布数据加载失败')
  } finally {
    loading.value = false
  }
}

watch(
  appId,
  () => {
    workflowFilter.value = 'all'
    materialVisible.value = false
    imageVisible.value = false
    void load()
  },
  { immediate: true },
)
</script>

<template>
  <div class="bd">
    <!-- 顶部只有一行：左侧 workflow 切换，右侧刷新与当前分支/配置版本 -->
    <div class="bd__bar">
      <div class="bd__bar-main">
        <span class="bd__bar-label">流水线</span>
        <t-select
          v-if="groups.length"
          class="bd__filter"
          size="small"
          :value="workflowFilter"
          :options="workflowOptions"
          @change="onWorkflowFilter"
        />
        <span v-else class="bd__bar-title">全部工作流</span>
      </div>
      <div class="bd__meta">
        <span v-if="gitSource.branch">当前分支 <b>{{ gitSource.branch }}</b></span>
        <span>配置版本 <b>v{{ configVersion }}</b></span>
        <t-button size="small" variant="text" :loading="loading" @click="load">
          <template #icon><t-icon name="refresh" /></template>
          刷新
        </t-button>
      </div>
    </div>

    <div v-if="loading" class="bd__skeleton">
      <div v-for="index in 2" :key="index" class="sk">
        <span class="sk__name" />
        <div class="sk__panel">
          <span class="sk__source" />
          <span class="sk__arrow" />
          <span class="sk__node" />
        </div>
      </div>
    </div>

    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <template v-else>
      <EmptyState
        v-if="!visibleGroups.length"
        title="还没有工作流"
        description="在配置里创建工作流后，构建与发布节点会出现在这里。"
      >
        <template #action>
          <router-link :to="{ name: 'config-workflow', params: baseParams }">去配置工作流</router-link>
        </template>
      </EmptyState>

      <PipelineGraph
        :rows="graphRows"
        show-status
        show-actions
        @material="onSelectMaterial"
        @image="onSelectImage"
        @edit="openPipelineEdit"
        @details="onNodeDetails"
      />
    </template>

    <PipelineEditDrawer
      v-model:visible="editVisible"
      :pipeline="editPipeline"
      :version="workflow?.version ?? 0"
      @saved="onPipelineSaved"
    />

    <SelectMaterialDrawer
      v-model:visible="materialVisible"
      :app-id="appId"
      :project-id="projectId"
      :pipeline-name="materialPipeline"
      :repository-url="repositoryUrl"
      :config-version="configVersion"
      :can-build="canBuild"
    />

    <SelectImageDrawer
      v-model:visible="imageVisible"
      :app-id="appId"
      :project-id="projectId"
      :binding-id="imageBindingId"
      :bindings="bindings"
      :environments="environments"
      :artifacts="artifacts"
      :deployments="deployments"
      :config-version="configVersion"
      @refresh="load"
    />
  </div>
</template>

<style scoped>
.bd {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.bd__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 28px;
}
.bd__bar-label {
  color: var(--tk-text-3);
  font-size: 12px;
}
.pl-node__foot {
  display: flex;
  align-items: center;
  gap: 4px;
}
.pl-node__more {
  padding: 0 4px;
  color: var(--tk-text-3);
  font-size: 14px;
  line-height: 1;
  background: none;
  border: 0;
  cursor: pointer;
}
.bd__bar-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.bd__filter {
  width: 200px;
}
.bd__bar-title {
  color: var(--tk-text-2);
  font-weight: 600;
}
.bd__meta {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-left: auto;
  color: var(--tk-text-3);
  font-size: 12px;
}
.bd__meta b {
  color: var(--tk-text-2);
  font-weight: 600;
}

/* ---- workflow 面板 ---- */
.wf {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wf__name {
  margin: 0;
  padding-left: 2px;
  color: var(--tk-text-2);
  font-size: 12px;
  font-weight: 600;
}
.tk-workflow {
  display: flex;
  align-items: flex-start;
  padding: 18px 16px;
  overflow-x: auto;
  background: #f7f9fc;
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.wf__flow {
  display: flex;
  align-items: flex-start;
  min-width: 0;
}
.pl-chain {
  display: flex;
  align-items: flex-start;
  gap: 0;
}
/* 一 CI 多 CD：竖排并用一条主干 + 分支连接到 CI */
.pl-cds {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-left: 16px;
}
.pl-cds::before {
  content: '';
  position: absolute;
  top: 57px;
  bottom: 57px;
  left: 0;
  width: 1px;
  background: var(--tk-border-strong);
}
.pl-cds--solo {
  padding-left: 0;
}
.pl-cds--solo::before {
  display: none;
}
.pl-cds > .pl-node {
  position: relative;
}
.pl-cds > .pl-node::before {
  content: '';
  position: absolute;
  top: 50%;
  left: -16px;
  width: 16px;
  height: 1px;
  background: var(--tk-border-strong);
}
.pl-cds--solo > .pl-node::before {
  display: none;
}

/* ---- 源码节点 ---- */
.pl-source {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 360px;
  min-height: 72px;
  padding: 10px 14px;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.pl-source__main {
  min-width: 0;
}
.pl-source__kicker {
  margin: 0;
  color: var(--tk-text-3);
  font-size: 11px;
  line-height: 16px;
}
.pl-source__value {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--tk-text);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pl-source__branch {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 4px 0 0;
  color: var(--tk-text-2);
  font-size: 12px;
}
.pl-source__info {
  color: var(--tk-text-3);
}
.pl-source__icon {
  flex: none;
  color: var(--tk-text-2);
}

/* ---- 节点之间的箭头 ---- */
.pl-arrow {
  position: relative;
  flex: none;
  width: 44px;
  height: 2px;
  margin: 35px 10px 0;
  background: var(--tk-border-strong);
}
.pl-arrow--trunk {
  margin-right: 0;
  margin-top: 55px;
}
.pl-arrow::after {
  content: '';
  position: absolute;
  top: 50%;
  right: -1px;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 7px solid var(--tk-border-strong);
  transform: translateY(-50%);
}

/* ---- CI / CD 节点 ---- */
.pl-node {
  display: flex;
  flex: none;
  overflow: hidden;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.pl-node__auto {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  color: var(--tk-text-3);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  background: #e9edf4;
  border-right: 1px solid var(--tk-border);
  writing-mode: vertical-rl;
  transform: rotate(180deg);
}
.pl-node__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 190px;
  height: 112px;
  padding: 8px 10px 10px;
}
.pl-node__kicker {
  margin: 0;
  color: var(--tk-text-3);
  font-size: 11px;
  line-height: 15px;
}
.pl-node__name {
  margin: 0;
  overflow: hidden;
  color: var(--tk-text);
  font-weight: 600;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pl-node__status {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 16px;
}
.pl-dot {
  flex: none;
  width: 6px;
  height: 6px;
  background: var(--tk-text-3);
  border-radius: 50%;
}
.pl-dot--success {
  background: var(--tk-success);
}
.pl-dot--danger {
  background: var(--tk-danger);
}
.pl-dot--info {
  background: var(--tk-primary);
}
.pl-dot--warning {
  background: var(--tk-warning);
}
.pl-state--success {
  color: #1f8f5f;
  font-weight: 600;
}
.pl-state--danger {
  color: var(--tk-danger);
  font-weight: 600;
}
.pl-state--info {
  color: var(--tk-primary);
  font-weight: 600;
}
.pl-state--warning {
  color: var(--tk-warning);
  font-weight: 600;
}
.pl-node__slash {
  color: var(--tk-text-3);
}
.pl-node__details {
  color: var(--tk-primary);
}
.pl-node__details:hover {
  text-decoration: underline;
}
.pl-node__action {
  margin-top: auto;
}

/* ---- loading 骨架 ---- */
.bd__skeleton {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.sk {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sk__name {
  width: 92px;
  height: 12px;
  background: #e9edf4;
  border-radius: 2px;
}
.sk__panel {
  display: flex;
  align-items: center;
  padding: 18px 16px;
  background: #f7f9fc;
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.sk__source {
  width: 360px;
  height: 72px;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.sk__arrow {
  width: 44px;
  height: 2px;
  margin: 0 12px;
  background: var(--tk-border);
}
.sk__node {
  width: 208px;
  height: 124px;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.sk__name,
.sk__source,
.sk__node {
  animation: sk-pulse 1.4s ease-in-out infinite;
}
@keyframes sk-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
</style>
