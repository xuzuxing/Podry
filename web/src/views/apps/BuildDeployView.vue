<script setup lang="ts">
/**
 * 构建发布（Build & Deploy）页：按真实 Devtron 的 trigger 页面复刻。
 * 页面由若干工作流块组成，每块是一条 workflow 名称 + 一块浅色画布；画布中从左到右依次为
 * 来源、CI、CD，CD 可一 CI 多环境纵向排列。没有额外的筛选栏或页面级元信息。
 */
import { computed, ref, watch } from 'vue'
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

import SelectImageDrawer from './components/pipeline/SelectImageDrawer.vue'
import SelectMaterialDrawer from './components/pipeline/SelectMaterialDrawer.vue'
import TriggerGraph from './components/pipeline/TriggerGraph.vue'
import type { TriggerCdNode, TriggerCiNode, TriggerRow, TriggerStatus } from './components/pipeline/TriggerGraph.vue'
import { ciDisplayName, workflowDisplayName } from './components/pipeline/naming'

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

const materialVisible = ref(false)
const materialPipeline = ref('')
const imageVisible = ref(false)
const imageBindingId = ref('')

const canBuild = computed(() => setup.value?.canBuild === true)
const configVersion = computed(() => setup.value?.configVersion ?? 0)
const repositoryUrl = computed(() => config.value?.gitConfig?.repositoryUrl ?? '')

const buildsSorted = computed(() =>
  builds.value.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
)
const deploymentsSorted = computed(() =>
  deployments.value.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
)

function errorTextOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/** 仓库地址 → Devtron 的 `/repo` 形式；拿不到地址时返回空串 */
function repoName(url: string): string {
  const trimmed = url.replace(/\.git$/, '').replace(/[/:]+$/, '')
  return trimmed.split(/[/:]/).filter(Boolean).pop() ?? ''
}

/** Devtron 风格显示名：wf-<appNumber>-<suffix> / ci-<appNumber>-<suffix> */
const workflowName = computed(() => {
  const seed = workflow.value?.items[0]?.id ?? appId.value
  return workflowDisplayName(appId.value, seed)
})

function ciNameOf(pipeline: Pipeline): string {
  return ciDisplayName(appId.value, pipeline.id)
}

const ciStatusMap: Record<BuildStatus, TriggerStatus> = {
  queued: { label: '排队中', tone: 'warning', details: true },
  running: { label: '构建中', tone: 'warning', details: true },
  canceling: { label: '取消中', tone: 'warning', details: true },
  succeeded: { label: '成功', tone: 'success', details: true },
  failed: { label: '失败', tone: 'danger', details: true },
  canceled: { label: '已取消', tone: 'danger', details: true },
  unknown: { label: '待核对', tone: 'neutral', details: true },
}

const cdStatusMap: Record<DeployStatus, TriggerStatus> = {
  queued: { label: '排队中', tone: 'warning', details: true },
  submitting: { label: '提交中', tone: 'warning', details: true },
  observing: { label: '部署中', tone: 'warning', details: true },
  succeeded: { label: '成功', tone: 'success', details: true },
  failed: { label: '失败', tone: 'danger', details: true },
  unknown: { label: '待核对', tone: 'neutral', details: true },
}

const notTriggered: TriggerStatus = { label: '未触发', tone: 'neutral' }
const notDeployed: TriggerStatus = { label: '未部署', tone: 'neutral' }

function upstreamOf(pipeline: Pipeline): string | null {
  return 'triggerMode' in pipeline.definition ? pipeline.definition.upstreamPipelineId : null
}

function ciTriggerOf(pipeline: Pipeline): 'MANUAL' | 'AUTO' {
  const definition = pipeline.definition
  if ('manual' in definition) return definition.manual ? 'MANUAL' : 'AUTO'
  return 'MANUAL'
}

function cdTriggerOf(pipeline: Pipeline): 'MANUAL' | 'AUTO' {
  const definition = pipeline.definition
  return 'triggerMode' in definition && definition.triggerMode === 'on_ci_success' ? 'AUTO' : 'MANUAL'
}

function ciNodeFor(pipeline: Pipeline): TriggerCiNode {
  const latest = buildsSorted.value.find((item) => item.appId === appId.value)
  return {
    id: pipeline.id,
    name: ciNameOf(pipeline),
    trigger: ciTriggerOf(pipeline),
    status: latest ? ciStatusMap[latest.status] : notTriggered,
  }
}

function cdNodeFor(pipeline: Pipeline): TriggerCdNode {
  const binding = bindings.value.find((item) => item.id === pipeline.bindingId) ?? null
  const environment = binding ? environments.value.find((item) => item.id === binding.environmentId) : undefined
  const latest = binding ? deploymentsSorted.value.find((item) => item.bindingId === binding.id) : undefined
  return {
    id: pipeline.id,
    bindingId: binding?.id ?? '',
    environment: environment?.name ?? '未绑定环境',
    strategy: latest?.strategy ?? 'rolling',
    trigger: cdTriggerOf(pipeline),
    status: latest ? cdStatusMap[latest.status] : notDeployed,
  }
}

const source = computed(() => {
  const git = config.value?.gitConfig
  const repo = repoName(git?.repositoryUrl ?? '')
  if (!git?.repositoryUrl || !repo) {
    return { kind: 'webhook' as const, repo: '外部来源', branch: '' }
  }
  return { kind: 'git' as const, repo, branch: git.branch }
})

const rows = computed<TriggerRow[]>(() => {
  const items = workflow.value?.items ?? []
  const cis = items.filter((item) => item.kind === 'ci')
  const cds = items.filter((item) => item.kind === 'cd')
  const ciIds = cis.map((item) => item.id)
  const result: TriggerRow[] = []

  cis.forEach((ci) => {
    result.push({
      key: ci.id,
      name: workflowName.value,
      source: source.value,
      ci: ciNodeFor(ci),
      cds: cds.filter((cd) => upstreamOf(cd) === ci.id).map(cdNodeFor),
    })
  })

  // 没有上游 CI 的 CD 单独成一条工作流，来源显示为外部镜像
  cds
    .filter((cd) => {
      const upstream = upstreamOf(cd)
      return !upstream || !ciIds.includes(upstream)
    })
    .forEach((cd) => {
      result.push({
        key: cd.id,
        name: workflowDisplayName(appId.value, cd.id),
        source: source.value.kind === 'git' ? source.value : { kind: 'webhook', repo: '外部来源', branch: '' },
        ci: null,
        cds: [cdNodeFor(cd)],
      })
    })

  return result
})

function onSelectMaterial(ciId: string): void {
  const ci = workflow.value?.items.find((item) => item.id === ciId)
  if (!ci) return
  materialPipeline.value = ciNameOf(ci)
  materialVisible.value = true
}

function onSelectImage(cdId: string): void {
  const cd = workflow.value?.items.find((item) => item.id === cdId)
  if (!cd) return
  const binding = bindings.value.find((item) => item.id === cd.bindingId)
  if (!binding) return
  imageBindingId.value = binding.id
  imageVisible.value = true
}

function onRollback(cdId: string): void {
  onSelectImage(cdId)
}

function onDetails(kind: 'ci' | 'cd', id: string): void {
  void id
  void router.push({
    name: kind === 'ci' ? 'app-builds' : 'app-deployments',
    params: baseParams.value,
  })
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
    materialVisible.value = false
    imageVisible.value = false
    void load()
  },
  { immediate: true },
)
</script>

<template>
  <div class="bd">
    <div v-if="loading" class="bd__skeleton">
      <div v-for="index in 2" :key="index" class="sk">
        <span class="sk__name" />
        <div class="sk__panel" />
      </div>
    </div>

    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <template v-else>
      <EmptyState
        v-if="!rows.length"
        title="还没有工作流"
        description="在配置里创建工作流后，构建与发布节点会出现在这里。"
      >
        <template #action>
          <router-link :to="{ name: 'config-workflow', params: baseParams }">去配置工作流</router-link>
        </template>
      </EmptyState>

      <TriggerGraph
        v-else
        :rows="rows"
        @material="onSelectMaterial"
        @image="onSelectImage"
        @rollback="onRollback"
        @details="onDetails"
      />
    </template>

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
  min-height: 100%;
  padding: 16px 20px 24px;
  background: #fff;
}

/* ---- loading 骨架 ---- */
.bd__skeleton {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.sk {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sk__name {
  width: 64px;
  height: 12px;
  background: #e9edf4;
  border-radius: 2px;
}
.sk__panel {
  height: 174px;
  background: #f7fafc;
  border: 1px solid #edf1f5;
  border-radius: 4px;
}
.sk__name,
.sk__panel {
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
