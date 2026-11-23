<script setup lang="ts">
/**
 * 构建发布（Build & Deploy）页：按真实 Devtron 的 trigger 页面复刻。
 * 页面由若干工作流块组成，每块是一条 workflow 名称 + 一块浅色画布；画布中从左到右依次为
 * 来源、CI、CD，CD 可一 CI 多环境纵向排列。没有额外的筛选栏或页面级元信息。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
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
  listStageRuns,
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
  CIDefinition,
  CDDefinition,
  DeploymentStageType,
  StageRun,
  Deployment,
  DeployStatus,
  Environment,
  Pipeline,
  Workflow,
} from '@/types'
import { fmtRelative } from '@/utils/format'

import SelectImageDrawer from './components/pipeline/SelectImageDrawer.vue'
import StageImagePicker from '@/components/application/StageImagePicker.vue'
import { deploymentStageOf } from '@/utils/deploymentStage'
import { stageStatusLabel } from '@/utils/stageRuns'
import SelectMaterialDrawer from './components/pipeline/SelectMaterialDrawer.vue'
import { ciGraphSource } from '@/utils/pipelineBuild'
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
let loadGeneration=0

const materialVisible = ref(false)
const materialPipelineId = ref('')
const materialPipeline = ref('')
const imageVisible = ref(false)
const imageBindingId = ref('')
const stageRuns = ref<StageRun[]>([])
const stageImageVisible = ref(false)
const stagePipelineId = ref('')
const selectedStage = ref<DeploymentStageType>('PRECD')

const canBuild = computed(() => setup.value?.canBuild === true)
const configVersion = computed(() => setup.value?.configVersion ?? 0)

const buildsSorted = computed(() =>
  builds.value.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
)
const deploymentsSorted = computed(() =>
  deployments.value.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
)

const latestBuild = computed(() => buildsSorted.value[0] ?? null)
const latestDeployment = computed(() => deploymentsSorted.value[0] ?? null)
const latestBuildStatus = computed(() => (latestBuild.value ? ciStatusMap[latestBuild.value.status] : null))
const latestDeployStatus = computed(() =>
  latestDeployment.value ? cdStatusMap[latestDeployment.value.status] : null,
)

function toneTheme(tone?: TriggerStatus['tone']): 'success' | 'danger' | 'warning' | 'default' | 'primary' {
  if (tone === 'success') return 'success'
  if (tone === 'danger') return 'danger'
  if (tone === 'warning') return 'warning'
  if (tone === 'info') return 'primary'
  return 'default'
}

function environmentName(environmentId: string): string {
  return environments.value.find((env) => env.id === environmentId)?.name ?? environmentId
}

function deploymentEnvironmentName(bindingId: string): string {
  const binding = bindings.value.find((item) => item.id === bindingId)
  return binding ? environmentName(binding.environmentId) : bindingId
}

function errorTextOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/** 仓库地址 → Devtron 的 `/repo` 形式；拿不到地址时返回空串 */

/** Devtron 风格显示名：wf-<appNumber>-<suffix> / ci-<appNumber>-<suffix> */

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
  const latest = buildsSorted.value.find((item) => item.pipelineId === pipeline.id)
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
  const definition = pipeline.definition as CDDefinition
  function stageNode(stage: DeploymentStageType) {
    const tasks = stage === 'PRECD' ? definition.preTasks : definition.postTasks
    if (!tasks?.length) return undefined
    const run = stageRuns.value.find(item=>item.pipelineId===pipeline.id && item.stage===stage)
    const status: TriggerStatus = run ? {label:stageStatusLabel[run.status],tone:run.status==='succeeded'?'success':run.status==='failed'||run.status==='canceled'?'danger':'warning',details:true} : notTriggered
    return {stage,trigger:deploymentStageOf(definition,stage==='PRECD'?'pre':'post').trigger==='auto'?'AUTO' as const:'MANUAL' as const,status}
  }
  return {
    id: pipeline.id,
    bindingId: binding?.id ?? '',
    environment: environment?.name ?? '未绑定环境',
    strategy: latest?.strategy ?? 'rolling',
    trigger: cdTriggerOf(pipeline),
    status: latest ? cdStatusMap[latest.status] : notDeployed,
    preStage: stageNode('PRECD'),
    postStage: stageNode('POSTCD'),
  }
}

const rows = computed<TriggerRow[]>(() => {
  const items = workflow.value?.items ?? []
  const cis = items.filter((item) => item.kind === 'ci')
  const cds = items.filter((item) => item.kind === 'cd')
  const ciIds = cis.map((item) => item.id)
  const result: TriggerRow[] = []

  cis.forEach((ci) => {
    result.push({
      key: ci.id,
      name: workflowDisplayName(appId.value, ci.id),
      source: ciGraphSource(config.value, ci.definition as CIDefinition),
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
        source: { kind: 'webhook', repo: '外部来源', branch: '' },
        ci: null,
        cds: [cdNodeFor(cd)],
      })
    })

  return result
})

function onSelectMaterial(ciId: string): void {
  const ci = workflow.value?.items.find((item) => item.id === ciId)
  if (!ci) return
  materialPipelineId.value = ci.id
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

function onStageImage(pipelineId: string, stage: DeploymentStageType): void {
  stagePipelineId.value=pipelineId; selectedStage.value=stage; stageImageVisible.value=true
}
function onStageDetails(pipelineId: string, stage: DeploymentStageType, runId?: string): void {
  const pipeline=workflow.value?.items.find(item=>item.id===pipelineId)
  const binding=bindings.value.find(item=>item.id===pipeline?.bindingId)
  const run=stageRuns.value.find(item=>item.pipelineId===pipelineId && item.stage===stage)
  void router.push({name:'app-deployments',params:baseParams.value,query:{type:stage,pipeline:pipelineId,env:binding?.environmentId,run:runId ?? run?.id}})
}

function onDetails(kind: 'ci' | 'cd', id: string): void {
  void router.push({
    name: kind === 'ci' ? 'app-builds' : 'app-deployments',
    params: baseParams.value,
    query: kind === 'ci' ? { pipeline: id } : {env:bindings.value.find(item=>item.id===workflow.value?.items.find(p=>p.id===id)?.bindingId)?.environmentId,type:'CD'},
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
  const current=++loadGeneration
  loading.value = true
  error.value = ''
  try {
    const [setupData, configData, workflowData, bindingList, environmentList, artifactList, buildPage, deployPage, stageList] =
      await Promise.all([
        loadSetup(),
        getConfig(appId.value),
        getWorkflow(appId.value),
        listBindings(appId.value),
        listEnvironments(),
        listArtifacts(appId.value),
        listBuilds(appId.value),
        listDeployments(appId.value),
        listStageRuns(appId.value),
      ])
    if(current!==loadGeneration)return
    setup.value = setupData
    config.value = configData
    workflow.value = workflowData
    bindings.value = bindingList
    environments.value = environmentList
    artifacts.value = artifactList
    builds.value = buildPage.items
    deployments.value = deployPage.items
    stageRuns.value = stageList
  } catch (err) {
    if(current===loadGeneration)error.value = errorTextOf(err, '构建发布数据加载失败')
  } finally {
    if(current===loadGeneration)loading.value = false
  }
}

watch(
  appId,
  () => {
    materialVisible.value = false
    imageVisible.value = false
    stageImageVisible.value = false
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(()=>loadGeneration++)
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

    <div v-else>
      <EmptyState
        v-if="!rows.length"
        title="还没有工作流"
        description="在配置里创建工作流后，构建与发布节点会出现在这里。"
      >
        <template #action>
          <router-link :to="{ name: 'config-workflow', params: baseParams }">去配置工作流</router-link>
        </template>
      </EmptyState>

      <div v-else>
        <div class="trigger-meta">
          <div class="trigger-meta__item">
            <span class="trigger-meta__label">最近构建</span>
            <template v-if="latestBuild && latestBuildStatus">
              <t-tag size="small" variant="light" :theme="toneTheme(latestBuildStatus.tone)">
                {{ latestBuildStatus.label }}
              </t-tag>
              <span class="trigger-meta__sub">
                {{ latestBuild.commitSha.slice(0, 7) }} · {{ fmtRelative(latestBuild.createdAt) }}
              </span>
            </template>
            <span v-else class="trigger-meta__sub">暂无构建</span>
          </div>
          <div class="trigger-meta__item">
            <span class="trigger-meta__label">最近发布</span>
            <template v-if="latestDeployment && latestDeployStatus">
              <t-tag size="small" variant="light" :theme="toneTheme(latestDeployStatus.tone)">
                {{ latestDeployStatus.label }}
              </t-tag>
              <span class="trigger-meta__sub">
                {{ deploymentEnvironmentName(latestDeployment.bindingId) }} ·
                {{ fmtRelative(latestDeployment.createdAt) }}
              </span>
            </template>
            <span v-else class="trigger-meta__sub">暂无发布</span>
          </div>
          <div class="trigger-meta__item">
            <span class="trigger-meta__label">配置版本</span>
            <span class="trigger-meta__value u-mono">v{{ configVersion }}</span>
          </div>
          <t-button size="small" variant="text" aria-label="刷新运行状态" @click="load">刷新状态</t-button>
        </div>

        <TriggerGraph
          :rows="rows"
          @material="onSelectMaterial"
          @image="onSelectImage"
          @rollback="onRollback"
          @details="onDetails"
          @stage-image="onStageImage"
          @stage-details="onStageDetails"
        />
      </div>
    </div>

    <SelectMaterialDrawer
      @workflow-updated="workflow = $event"
      v-model:visible="materialVisible"
      :app-id="appId"
      :project-id="projectId"
      :pipeline-name="materialPipeline"
      :pipeline-id="materialPipelineId"
      :can-build="canBuild"
    />

    <StageImagePicker v-model:visible="stageImageVisible" :app-id="appId" :pipeline-id="stagePipelineId" :stage="selectedStage" @triggered="run=>onStageDetails(run.pipelineId,run.stage,run.id)" />
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
.trigger-meta {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.trigger-meta__item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.trigger-meta__label {
  color: #767d84;
  font-size: 11px;
  white-space: nowrap;
}
.trigger-meta__value {
  color: #000a14;
  font-size: 12px;
  font-weight: 600;
}
.trigger-meta__sub {
  overflow: hidden;
  color: #3b444c;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
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
