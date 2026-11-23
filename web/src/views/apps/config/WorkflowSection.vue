<script setup lang="ts">
import { ciGraphSource } from '@/utils/pipelineBuild'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { getApplication, getConfig, getWorkflow, listBindings, listEnvironments, saveWorkflow } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import TriggerGraph from '@/views/apps/components/pipeline/TriggerGraph.vue'
import type { TriggerRow } from '@/views/apps/components/pipeline/TriggerGraph.vue'
import PipelineBuildIcon from '@/views/apps/components/pipeline/icons/PipelineBuildIcon.vue'
import PipelineCdIcon from '@/views/apps/components/pipeline/icons/PipelineCdIcon.vue'
import PipelineEditDrawer from '@/views/apps/components/pipeline/PipelineEditDrawer.vue'
import { ciDisplayName, workflowDisplayName } from '@/views/apps/components/pipeline/naming'
import { notifySetupChanged } from '@/utils/appEvents'
import type {
  AppConfig,
  Application,
  Binding,
  CDDefinition,
  CIDefinition,
  Environment,
  Pipeline,
  Workflow,
} from '@/types'


type TemplateKey = 'build_deploy' | 'build_only' | 'external_image'
type TriggerMode = 'manual' | 'on_ci_success'

const route = useRoute()
const router = useRouter()
const appId = computed(() => String(route.params.appId ?? ''))

const workflow = ref<Workflow | null>(null)
const bindings = ref<Binding[]>([])
const environments = ref<Environment[]>([])
const config = ref<AppConfig | null>(null)
const application = ref<Application | null>(null)

const loading = ref(false)
const saving = ref(false)
const error = ref('')

const createVisible = ref(false)
const templateKey = ref<TemplateKey>('build_deploy')
const templateBranch = ref('main')
const templateEnvIds = ref<string[]>([])
const templateReleaseName = ref('')
const createError = ref('')

const triggerVisible = ref(false)

/* 管线编辑抽屉：由 PipelineEditDrawer 负责阶段与触发方式 */
const editVisible = ref(false)
const editItem = ref<Pipeline | null>(null)

function openEdit(item: Pipeline): void {
  editItem.value = item
  editVisible.value = true
}
watch([loading, () => route.query.pipeline], async ([busy, id]) => {
  if (busy || !workflow.value || !id) return
  const pipeline = workflow.value.items.find(item => item.id === id)
  const owner = appId.value
  // 先消化深链参数再打开，避免查询参数变化触发抽屉的路由关闭保护。
  await router.replace({ query: { ...route.query, pipeline: undefined } })
  if (owner !== appId.value || route.name !== 'config-workflow') return
  if (pipeline) openEdit(pipeline)
  else MessagePlugin.warning('该流水线已不存在，请在工作流中重新选择')
})

const ciTriggers = ref<Record<string, { manual: boolean; push: boolean }>>({})
const cdTriggers = ref<Record<string, TriggerMode>>({})
const triggerError = ref('')

const hasWorkflow = computed(() => (workflow.value?.items.length ?? 0) > 0)
const ciItems = computed<Pipeline[]>(() => (workflow.value?.items ?? []).filter((item) => item.kind === 'ci'))
const cdItems = computed<Pipeline[]>(() => (workflow.value?.items ?? []).filter((item) => item.kind === 'cd'))
const templateNeedsBranch = computed(() => templateKey.value !== 'external_image')
const templateNeedsEnv = computed(() => templateKey.value !== 'build_only')
const envOptions = computed(() =>
  environments.value.map((env) => ({ label: env.production ? `${env.name}（生产）` : env.name, value: env.id })),
)
const triggerDirty = computed(() => {
  const items = workflow.value?.items ?? []
  return items.some((item) => {
    const definition = item.definition
    if (isCIDefinition(definition)) {
      const trigger = ciTriggers.value[item.id]
      return definition.manual !== trigger?.manual || definition.push !== trigger?.push
    }
    return definition.triggerMode !== (cdTriggers.value[item.id] ?? 'manual')
  })
})

function envNameOfBinding(bindingId: string | null): string {
  const binding = bindings.value.find((item) => item.id === bindingId)
  if (!binding) return '未绑定环境'
  const env = environments.value.find((item) => item.id === binding.environmentId)
  return env ? env.name : binding.environmentId
}


function isCIDefinition(definition: CIDefinition | CDDefinition): definition is CIDefinition {
  return 'branch' in definition
}

/** 仓库地址 → Devtron 的 `/repo` 形式 */

function triggerOf(item: Pipeline): 'MANUAL' | 'AUTO' {
  if (isCIDefinition(item.definition)) return item.definition.manual ? 'MANUAL' : 'AUTO'
  return item.definition.triggerMode === 'on_ci_success' ? 'AUTO' : 'MANUAL'
}

const graphRows = computed<TriggerRow[]>(() => {
  const items = workflow.value?.items ?? []
  const cis = items.filter((item) => item.kind === 'ci')
  const cds = items.filter((item) => item.kind === 'cd')
  const cdNode = (cd: Pipeline) => ({
    id: cd.id, bindingId: cd.bindingId ?? '', environment: envNameOfBinding(cd.bindingId),
    strategy: 'rolling', trigger: triggerOf(cd),
  })
  const rows: TriggerRow[] = cis.map((ci) => ({
    key: ci.id, name: workflowDisplayName(appId.value, ci.id),
    source: ciGraphSource(config.value, ci.definition as CIDefinition),
    ci: { id: ci.id, name: ciDisplayName(appId.value, ci.id), trigger: triggerOf(ci) },
    cds: cds.filter((cd) => (cd.definition as CDDefinition).upstreamPipelineId === ci.id).map(cdNode),
  }))
  cds.filter((cd) => !cis.some((ci) => ci.id === (cd.definition as CDDefinition).upstreamPipelineId))
    .forEach((cd) => rows.push({
      key: cd.id, name: workflowDisplayName(appId.value, cd.id),
      source: { kind: 'webhook', repo: 'External source', branch: '' }, ci: null, cds: [cdNode(cd)],
    }))
  return rows
})

function onPipelineSaved(saved: Workflow): void {
  workflow.value = saved
  editVisible.value = false
  notifySetupChanged(appId.value)
}

async function onPipelineRemove(id: string): Promise<void> {
  await onGraphRemove(id)
  editVisible.value = false
}

function onGraphEdit(id: string): void {
  const pipeline = workflow.value?.items.find((item) => item.id === id)
  if (pipeline) openEdit(pipeline)
}

async function onGraphRemove(id: string): Promise<void> {
  const current = workflow.value
  if (!current) return
  const item = current.items.find((row) => row.id === id)
  if (!item) return
  const hasDependents = current.items.some(
    (row) => row.kind === 'cd' && (row.definition as CDDefinition).upstreamPipelineId === id,
  )
  if (item.kind === 'ci' && hasDependents) {
    MessagePlugin.warning('请先删除依赖该 CI 的部署流水线')
    return
  }
  const items = current.items.filter((row) => row.id !== id)
  try {
    const saved = await saveWorkflow(appId.value, { version: current.version, items })
    workflow.value = saved
    notifySetupChanged(appId.value)
    MessagePlugin.success(`已删除流水线 ${id}（配置版本 v${saved.version}）`)
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '删除失败')
  }
}

const addUpstreamId = ref<string | null>(null)

function onGraphAdd(upstreamId: string): void {
  addUpstreamId.value = workflow.value?.items.some((item) => item.id === upstreamId && item.kind === 'ci') ? upstreamId : null
  templateKey.value = 'external_image'
  createError.value = ''
  createVisible.value = true
}

const workflowSearch = ref('')
const visibleRows = computed<TriggerRow[]>(() => {
  const keyword = workflowSearch.value.trim().toLowerCase()
  if (!keyword) return graphRows.value
  return graphRows.value.filter((row) => row.name.toLowerCase().includes(keyword))
})

async function load(): Promise<void> {
  if (!appId.value) return
  loading.value = true
  error.value = ''
  try {
    const [flow, bindingList, envList, cfg, app] = await Promise.all([
      getWorkflow(appId.value),
      listBindings(appId.value),
      listEnvironments(),
      getConfig(appId.value),
      getApplication(appId.value),
    ])
    workflow.value = flow
    bindings.value = bindingList
    environments.value = envList
    config.value = cfg
    application.value = app
  } catch (err) {
    error.value = err instanceof Error ? err.message : '工作流加载失败'
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  addUpstreamId.value = null
  templateKey.value = 'build_deploy'
  templateBranch.value = config.value?.gitConfig?.branch ?? 'main'
  templateEnvIds.value = environments.value
    .filter((env) => bindings.value.some((binding) => binding.environmentId === env.id))
    .map((env) => env.id)
  templateReleaseName.value = bindings.value[0]?.target.releaseName ?? application.value?.name ?? ''
  createError.value = ''
  createVisible.value = true
}

async function createWorkflow(): Promise<void> {
  const current = workflow.value
  if (!current) return
  const branch = templateBranch.value.trim()
  if (templateNeedsBranch.value && !branch) {
    createError.value = '请填写 CI 分支'
    return
  }
  if (templateNeedsEnv.value && templateEnvIds.value.length === 0) {
    createError.value = '请至少选择一个环境'
    return
  }
  createError.value = ''
  saving.value = true
  try {
    const stamp = String(Date.now())
    const items: Pipeline[] = [...current.items]
    let ciId: string | null = null
    if (templateKey.value !== 'external_image') {
      ciId = `pl-ci-${stamp}`
      const definition: CIDefinition = { manual: true, push: false, branch, webhookCredentialId: null }
      items.push({
        id: ciId,
        appId: appId.value,
        kind: 'ci',
        bindingId: null,
        enabled: true,
        version: 1,
        definition,
      })
    }
    if (templateKey.value !== 'build_only' && templateEnvIds.value.length > 0) {
      templateEnvIds.value.forEach((envId, index) => {
        const binding = bindings.value.find((item) => item.environmentId === envId) ?? bindings.value[0]
        const definition: CDDefinition = {
          triggerMode: 'manual',
          upstreamPipelineId: ciId ?? addUpstreamId.value,
          deployTimeoutSeconds: 600,
        }
        items.push({
          id: `pl-cd-${stamp}-${index + 1}`,
          appId: appId.value,
          kind: 'cd',
          bindingId: binding ? binding.id : null,
          enabled: true,
          version: 1,
          definition,
        })
      })
    }
    const savedWorkflow = await saveWorkflow(appId.value, { version: current.version, items })
    workflow.value = savedWorkflow
    notifySetupChanged(appId.value)
    createVisible.value = false
    const ciCount = items.filter((item) => item.kind === 'ci').length
    const cdCount = items.filter((item) => item.kind === 'cd').length
    MessagePlugin.success(
      cdCount > 0
        ? `已创建工作流（v${savedWorkflow.version}）：CI ${ciCount} 条、CD ${cdCount} 条，releaseName ${templateReleaseName.value || application.value?.name || '—'}`
        : `已创建工作流（v${savedWorkflow.version}）：CI ${ciCount} 条，未创建部署流水线`,
    )
  } catch (err) {
    createError.value = err instanceof Error ? err.message : '创建工作流失败'
  } finally {
    saving.value = false
  }
}

function openTrigger(): void {
  const items = workflow.value?.items ?? []
  ciTriggers.value = {}
  const next: Record<string, TriggerMode> = {}
  items.forEach((item) => {
    const definition = item.definition
    if (isCIDefinition(definition)) {
      ciTriggers.value[item.id] = { manual: definition.manual, push: definition.push }
    } else {
      next[item.id] = definition.triggerMode
    }
  })
  cdTriggers.value = next
  triggerError.value = ''
  triggerVisible.value = true
}

function closeCreate(): void {
  createVisible.value = false
}

function closeTrigger(): void {
  triggerVisible.value = false
}

async function saveTrigger(): Promise<void> {
  const current = workflow.value
  if (!current) return
  if (ciItems.value.some((item) => !ciTriggers.value[item.id]?.manual && !ciTriggers.value[item.id]?.push)) {
    triggerError.value = 'CI 至少保留一种触发方式'
    return
  }
  triggerError.value = ''
  saving.value = true
  try {
    const items: Pipeline[] = current.items.map((item) => {
      const definition = item.definition
      if (isCIDefinition(definition)) {
        const nextCI: CIDefinition = { ...definition, ...ciTriggers.value[item.id] }
        return { ...item, definition: nextCI }
      }
      const nextCD: CDDefinition = { ...definition, triggerMode: cdTriggers.value[item.id] ?? 'manual' }
      return { ...item, definition: nextCD }
    })
    const savedWorkflow = await saveWorkflow(appId.value, { version: current.version, items })
    workflow.value = savedWorkflow
    notifySetupChanged(appId.value)
    triggerVisible.value = false
    MessagePlugin.success(`已保存（工作流版本 v${savedWorkflow.version}）`)
  } catch (err) {
    triggerError.value = err instanceof Error ? err.message : '保存工作流失败'
  } finally {
    saving.value = false
  }
}

watch(appId, load, { immediate: true })
</script>

<template>
  <div class="sec">
    <div class="wfhead">
      <div class="wfhead__title">
        <h1>工作流编辑器</h1>
        <t-tooltip content="点击节点编辑流水线；节点右侧的 + / 删除用于增删流水线。" placement="top">
          <t-icon name="info-circle" size="15px" class="wfhead__info" />
        </t-tooltip>
      </div>
      <div class="wfhead__actions">
        <t-input
          v-model="workflowSearch"
          class="wfhead__search"
          size="small"
          clearable
          placeholder="搜索工作流"
        >
          <template #prefix-icon><t-icon name="search" /></template>
        </t-input>
        <t-button v-if="hasWorkflow" size="small" variant="outline" :disabled="loading" @click="openTrigger">
          更新触发方式
        </t-button>
        <t-button size="small" theme="primary" :disabled="loading" @click="openCreate">
          <template #icon><t-icon name="add" /></template>
          新建工作流
        </t-button>      </div>
    </div>

    <div v-if="loading" class="sec__state">
      <t-loading size="small" text="加载中…" />
    </div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <div v-else-if="!hasWorkflow" class="wf-empty">
      <div class="wf-empty__flow" aria-hidden="true">
        <span class="wf-empty__node">
          <t-icon name="code" size="20px" />
        </span>
        <span class="wf-empty__line" />
        <span class="wf-empty__node">
          <PipelineBuildIcon class="wf-empty__icon" />
        </span>
        <span class="wf-empty__line" />
        <span class="wf-empty__node">
          <PipelineCdIcon class="wf-empty__icon" />
        </span>
      </div>
      <h2 class="wf-empty__title">工作流</h2>
      <p class="wf-empty__desc">工作流把构建与部署阶段串成一条链路，从代码提交一直走到环境发布。</p>
      <span class="wf-empty__link">了解如何创建工作流</span>
      <t-button theme="primary" class="wf-empty__cta" @click="openCreate">新建工作流</t-button>
    </div>

    <template v-else>
      <section v-if="visibleRows.length" class="wfcanvas">
        <TriggerGraph
          :rows="visibleRows"
          editable
          @edit="onGraphEdit"
          @remove="onGraphRemove"
          @add="onGraphAdd"
        />
      </section>
      <EmptyState
        v-else
        compact
        title="没有匹配的工作流"
        description="清空搜索条件后再试。"
      />
    </template>

    <t-dialog v-model:visible="createVisible" header="工作流模板" :footer="false" width="860px" @close="closeCreate">
      <div class="tpl">
        <p class="tpl__sub">选择模板创建工作流</p>

        <t-alert v-if="createError" theme="error" :message="createError" />
        <t-alert
          v-if="bindings.length === 0"
          theme="warning"
          title="该应用尚无环境绑定"
          message="CD 流水线将不关联 binding，创建后需先在环境绑定中补齐。"
        />

        <p class="tpl__group">构建容器镜像</p>
        <div class="tpl__grid">
          <button
            type="button"
            class="tpl-card"
            :class="{ 'tpl-card--active': templateKey === 'build_deploy' }"
            @click="templateKey = 'build_deploy'"
          >
            <span class="tpl-card__icons">
              <PipelineBuildIcon class="tpl-card__icon" />
              <PipelineCdIcon class="tpl-card__icon" />
            </span>
            <span class="tpl-card__title">源码构建并部署</span>
            <span class="tpl-card__desc">从 Git 仓库构建镜像，并部署到所选环境。</span>
          </button>
          <button
            type="button"
            class="tpl-card"
            :class="{ 'tpl-card--active': templateKey === 'build_only' }"
            @click="templateKey = 'build_only'"
          >
            <span class="tpl-card__icons">
              <PipelineBuildIcon class="tpl-card__icon" />
            </span>
            <span class="tpl-card__title">仅源码构建</span>
            <span class="tpl-card__desc">只构建并推送镜像，不创建部署流水线。</span>
          </button>
        </div>

        <p class="tpl__group">接收容器镜像</p>
        <div class="tpl__grid">
          <button
            type="button"
            class="tpl-card"
            :class="{ 'tpl-card--active': templateKey === 'external_image' }"
            @click="templateKey = 'external_image'"
          >
            <span class="tpl-card__icons">
              <PipelineCdIcon class="tpl-card__icon" />
            </span>
            <span class="tpl-card__title">部署外部镜像</span>
            <span class="tpl-card__desc">不创建 CI，直接使用镜像仓库中的已有镜像发布。</span>
          </button>
        </div>

        <div class="tpl__config">
          <div v-if="templateNeedsBranch" class="tpl__field">
            <span class="tpl__label">CI 分支</span>
            <t-input v-model="templateBranch" placeholder="main" />
            <span class="tpl__hint">CI 只从该分支触发，构建时固定为一个提交 SHA。</span>
          </div>
          <div v-if="templateNeedsEnv" class="tpl__field">
            <span class="tpl__label">环境</span>
            <t-select v-model="templateEnvIds" :options="envOptions" multiple placeholder="选择发布环境" />
            <span class="tpl__hint">每个选中环境生成一条 CD 流水线，绑定该环境已有 binding（无则用第一个绑定）。</span>
          </div>
          <div v-if="templateNeedsEnv" class="tpl__field">
            <span class="tpl__label">releaseName</span>
            <t-input v-model="templateReleaseName" placeholder="checkout-api" />
            <span class="tpl__hint">默认取应用名；已绑定环境沿用 binding 中的 releaseName。</span>
          </div>
        </div>

        <div class="dlg__footer">
          <t-button variant="outline" @click="closeCreate">取消</t-button>
          <t-button theme="primary" :loading="saving" @click="createWorkflow">创建工作流</t-button>
        </div>
      </div>
    </t-dialog>

    <t-dialog v-model:visible="triggerVisible" header="更新触发方式" :footer="false" width="520px" @close="closeTrigger">
      <div class="dlg">
        <t-alert v-if="triggerError" theme="error" :message="triggerError" />
        <template v-if="triggerVisible"><section v-for="ci in ciItems" :key="ci.id" class="dlg__group">
          <p class="dlg__title">{{ ciDisplayName(appId, ci.id) }} · CI 触发</p>
          <div class="dlg__row">
            <span>手动触发</span>
            <t-switch v-model="ciTriggers[ci.id]!.manual" />
          </div>
          <div class="dlg__row">
            <span>Push 触发</span>
            <t-switch v-model="ciTriggers[ci.id]!.push" />
          </div>
          <p class="u-dim">CI 至少保留一种触发方式；Push 触发需在仓库侧配置 Webhook 凭据。</p>
        </section>
        </template>
        <section v-if="cdItems.length > 0" class="dlg__group">
          <p class="dlg__title">CD 触发</p>
          <div v-for="item in cdItems" :key="item.id" class="dlg__row">
            <span>{{ envNameOfBinding(item.bindingId) }}</span>
            <t-radio-group v-model="cdTriggers[item.id]" size="small" theme="button">
              <t-radio value="manual">手动</t-radio>
              <t-radio value="on_ci_success">CI 成功后</t-radio>
            </t-radio-group>
          </div>
          <p class="u-dim">生产环境建议保持手动，避免 CI 成功后直接发布。</p>
        </section>
        <div class="dlg__footer">
          <span v-if="triggerDirty" class="hint-dirty">有未保存修改</span>
          <t-button variant="outline" @click="closeTrigger">取消</t-button>
          <t-button theme="primary" :loading="saving" @click="saveTrigger">保存（版本 +1）</t-button>
        </div>
      </div>
    </t-dialog>

    <PipelineEditDrawer
      v-model:visible="editVisible"
      :pipeline="editItem"
      :version="workflow?.version ?? 0"
      @saved="onPipelineSaved"
      @remove="onPipelineRemove"
    />
  </div>
</template>

<style scoped>
.sec {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 24px;
}
/* ---- Devtron Workflow Editor 头部 ---- */
.wfhead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 0 2px;
}
.wfhead__title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wfhead__title h1 {
  margin: 0;
  color: #000a14;
  font-size: 18px;
  font-weight: 600;
  line-height: 24px;
}
.wfhead__info {
  color: #767d84;
  cursor: help;
}
.wfhead__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.wfhead__search {
  width: 240px;
}
.wfcanvas {
  min-width: 0;
}
.wf-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 560px;
  padding: 48px 24px;
  text-align: center;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.wf-empty__flow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 28px;
}
.wf-empty__node {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
  box-shadow: 0 1px 2px rgb(0 0 0 / 4%);
}
.wf-empty__icon {
  width: 26px;
  height: 26px;
}
.wf-empty__line {
  width: 28px;
  height: 2px;
  background: #c4c9d0;
}
.wf-empty__title {
  margin: 0 0 8px;
  color: #000a14;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}
.wf-empty__desc {
  max-width: 440px;
  margin: 0 0 10px;
  color: #596168;
  font-size: 12px;
  line-height: 18px;
}
.wf-empty__link {
  margin-bottom: 20px;
  color: #0066cc;
  font-size: 12px;
  cursor: pointer;
}
.wf-empty__cta {
  min-width: 150px;
}
.tpl__sub {
  margin: 0 0 16px;
  color: #596168;
  font-size: 12px;
}
.tpl__group {
  margin: 18px 0 10px;
  color: #3b444c;
  font-size: 13px;
  font-weight: 600;
}
.tpl__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.tpl-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 14px;
  text-align: left;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
  cursor: pointer;
}
.tpl-card--active {
  background: #f7fbff;
  border-color: #0066cc;
  box-shadow: inset 0 0 0 1px #0066cc;
}
.tpl-card__icons {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 8px;
  background: #f2f4f7;
  border-radius: 2px;
}
.tpl-card__icon {
  width: 22px;
  height: 22px;
}
.tpl-card__title {
  color: #000a14;
  font-size: 13px;
  font-weight: 500;
}
.tpl-card__desc {
  color: #767d84;
  font-size: 11px;
  line-height: 16px;
}
.tpl__config {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #e6e9ef;
}
.tpl__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tpl__label {
  color: #3b444c;
  font-size: 12px;
}
.tpl__hint {
  color: #767d84;
  font-size: 11px;
  line-height: 16px;
}
.sec__state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
}
.flow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 12px;
  overflow-x: auto;
  background: #fbfcfe;
  border: 1px solid var(--tk-border);
  border-radius: 2px;
}
.flow__arrow {
  flex: none;
  color: var(--tk-text-3);
  font-size: 14px;
}
.flow__stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.flow-node {
  min-width: 190px;
  padding: 8px 10px;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border-strong);
  border-radius: 2px;
}
.flow-node--empty {
  border-style: dashed;
}
.flow-node__head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.flow-node__dot {
  flex: none;
  width: 6px;
  height: 6px;
  background: var(--tk-text-3);
  border-radius: 50%;
}
.flow-node__dot--on {
  background: var(--tk-success);
}
.flow-node__line {
  margin: 0;
  font-size: 11px;
  line-height: 16px;
  word-break: break-all;
}
.flow-node__code {
  margin: 4px 0 0;
  font-family: var(--tk-mono);
  font-size: 10px;
  line-height: 14px;
  color: var(--tk-text-3);
}
.dlg {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dlg__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: #fbfcfe;
  border: 1px solid var(--tk-border);
  border-radius: 2px;
}
.dlg__title {
  margin: 0;
  font-weight: 600;
  color: var(--tk-text-2);
}
.dlg__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.flow-node--clickable {
  cursor: pointer;
}
.flow-node--clickable:hover {
  border-color: #b9d0f5;
}
.edit__tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.edit__tab {
  padding: 3px 10px;
  font: inherit;
  font-size: 12px;
  color: var(--tk-text-2);
  background: transparent;
  border: 1px solid var(--tk-border);
  border-radius: 3px;
  cursor: pointer;
}
.edit__tab--active {
  color: var(--tk-primary);
  background: #eef4fd;
  border-color: #b9d0f5;
  font-weight: 600;
}
.dlg__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}
.hint-dirty {
  margin-right: auto;
  color: var(--tk-warning);
}
.fld {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.fld__label {
  color: var(--tk-text-2);
}
</style>
