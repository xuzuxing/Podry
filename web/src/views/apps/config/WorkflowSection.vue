<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { getApplication, getConfig, getWorkflow, listBindings, listEnvironments, saveWorkflow } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import PageHeader from '@/components/PageHeader.vue'
import PipelineGraph from '@/views/apps/components/pipeline/PipelineGraph.vue'
import type { GraphRow } from '@/views/apps/components/pipeline/PipelineGraph.vue'
import StatusTag from '@/components/StatusTag.vue'
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


interface PipelineRow {
  id: string
  kindLabel: string
  scope: string
  trigger: string
  enabled: boolean
}

type TemplateKey = 'build_deploy' | 'external_image'
type TriggerMode = 'manual' | 'on_ci_success'

const route = useRoute()
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

/* 管线编辑抽屉：前置 / 主阶段 / 后置 */
type StageTab = 'pre' | 'main' | 'post'
const editVisible = ref(false)
const editItem = ref<Pipeline | null>(null)
const stageTab = ref<StageTab>('main')
const editBranch = ref('')
const editManual = ref(true)
const editPush = ref(false)
const editTrigger = ref<'manual' | 'on_ci_success'>('manual')
const editDeployTimeout = ref(300)
const editError = ref('')
const editSaving = ref(false)

function openEdit(item: Pipeline): void {
  editItem.value = item
  stageTab.value = 'main'
  editError.value = ''
  if (item.kind === 'ci') {
    const definition = item.definition as CIDefinition
    editBranch.value = definition.branch
    editManual.value = definition.manual
    editPush.value = definition.push
  } else {
    const definition = item.definition as CDDefinition
    editTrigger.value = definition.triggerMode
    editDeployTimeout.value = definition.deployTimeoutSeconds
  }
  editVisible.value = true
}

async function saveEdit(): Promise<void> {
  const item = editItem.value
  const current = workflow.value
  if (!item || !current) return
  editError.value = ''
  if (item.kind === 'ci' && !editBranch.value.trim()) {
    editError.value = 'CI 分支不能为空'
    return
  }
  if (item.kind === 'ci' && !editManual.value && !editPush.value) {
    editError.value = 'CI 至少保留一种触发方式'
    return
  }
  editSaving.value = true
  try {
    const items: Pipeline[] = current.items.map((row) => {
      if (row.id !== item.id) return row
      if (row.kind === 'ci') {
        const definition: CIDefinition = {
          ...(row.definition as CIDefinition),
          branch: editBranch.value.trim(),
          manual: editManual.value,
          push: editPush.value,
        }
        return { ...row, definition }
      }
      const definition: CDDefinition = {
        ...(row.definition as CDDefinition),
        triggerMode: editTrigger.value,
        deployTimeoutSeconds: Math.round(editDeployTimeout.value),
      }
      return { ...row, definition }
    })
    const savedWorkflow = await saveWorkflow(appId.value, { version: current.version, items })
    workflow.value = savedWorkflow
    MessagePlugin.success(`已更新流水线 ${item.id}（配置版本 v${savedWorkflow.version}）`)
    editVisible.value = false
  } catch (err) {
    editError.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    editSaving.value = false
  }
}
const ciManual = ref(true)
const ciPush = ref(false)
const cdTriggers = ref<Record<string, TriggerMode>>({})
const triggerError = ref('')

const templateOptions = [
  { label: '源码构建部署（Build & Deploy from Source Code）', value: 'build_deploy' },
  { label: '镜像部署（Deploy from External Image）', value: 'external_image' },
]

const pipelineColumns = [
  { colKey: 'edit', title: '', width: 62 },

  { colKey: 'id', title: 'Pipeline ID', width: 200 },
  { colKey: 'kindLabel', title: 'Kind', width: 80 },
  { colKey: 'scope', title: '分支 / 环境', width: 180 },
  { colKey: 'trigger', title: '触发方式', width: 170 },
  { colKey: 'enabled', title: '状态', width: 100 },
]

const hasWorkflow = computed(() => (workflow.value?.items.length ?? 0) > 0)
const versionText = computed(() => (workflow.value ? `v${workflow.value.version}` : '—'))
const ciItem = computed<Pipeline | null>(() => workflow.value?.items.find((item) => item.kind === 'ci') ?? null)
const cdItems = computed<Pipeline[]>(() => (workflow.value?.items ?? []).filter((item) => item.kind === 'cd'))
const templateNeedsBranch = computed(() => templateKey.value !== 'external_image')
const templateNeedsEnv = computed(() => true)
const envOptions = computed(() =>
  environments.value.map((env) => ({ label: env.production ? `${env.name}（生产）` : env.name, value: env.id })),
)
const templateHint = computed(() => {
  if (templateKey.value === 'build_deploy') return '源码构建 + 每个选中环境一条 CD：CI 产出镜像后按需发布。'
  return '镜像部署：不创建 CI，直接使用镜像仓库中的已有镜像发布到所选环境。'
})
const triggerDirty = computed(() => {
  const items = workflow.value?.items ?? []
  return items.some((item) => {
    const definition = item.definition
    if (isCIDefinition(definition)) {
      return definition.manual !== ciManual.value || definition.push !== ciPush.value
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

function triggerText(item: Pipeline): string {
  const definition = item.definition
  if (isCIDefinition(definition)) {
    const parts: string[] = []
    if (definition.manual) parts.push('手动')
    if (definition.push) parts.push('Push')
    return parts.length > 0 ? parts.join(' + ') : '未配置触发'
  }
  return definition.triggerMode === 'on_ci_success' ? 'CI 成功后自动' : '手动触发'
}

function pipelineScope(item: Pipeline): string {
  const definition = item.definition
  if (isCIDefinition(definition)) return `分支 ${definition.branch}`
  return envNameOfBinding(item.bindingId)
}

const graphRows = computed<GraphRow[]>(() => {
  const git = config.value?.gitConfig ?? null
  const items = workflow.value?.items ?? []
  const ciItemRow = items.find((item) => item.kind === 'ci')
  const ciNodeData = ciItemRow
    ? {
        id: ciItemRow.id,
        kind: 'ci' as const,
        kicker: 'Build',
        title: ciItemRow.id,
        icon: 'tools',
      }
    : null
  const cdNodes = items
    .filter((item) => item.kind === 'cd')
    .map((cd) => ({
      id: cd.id,
      kind: 'cd' as const,
      kicker: 'Deploy: Rolling',
      title: envNameOfBinding(cd.bindingId),
      icon: 'rocket',
    }))
  if (!ciNodeData && !cdNodes.length) return []
  return [
    {
      key: 'main',
      name: `wf-1-${(ciNodeData?.id ?? cdNodes[0].id).split('-').pop()}`,
      source: {
        kicker: git ? 'Git' : 'External source',
        value: git ? git.repositoryUrl : '外部镜像交付（无源码仓库）',
        branch: git ? git.branch : undefined,
        icon: git ? 'git' : 'image',
      },
      ci: ciNodeData,
      cds: cdNodes,
    },
  ]
})

function onGraphEdit(id: string): void {
  const pipeline = workflow.value?.items.find((item) => item.id === id)
  if (pipeline) openEdit(pipeline)
}

async function onGraphRemove(id: string): Promise<void> {
  const current = workflow.value
  if (!current) return
  const items = current.items.filter((item) => item.id !== id)
  try {
    const saved = await saveWorkflow(appId.value, { version: current.version, items })
    workflow.value = saved
    MessagePlugin.success(`已删除流水线 ${id}（配置版本 v${saved.version}）`)
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '删除失败')
  }
}

function onGraphAdd(): void {
  templateKey.value = 'external_image'
  createError.value = ''
  createVisible.value = true
}

const pipelineRows = computed<PipelineRow[]>(() =>
  (workflow.value?.items ?? []).map((item) => ({
    id: item.id,
    kindLabel: item.kind === 'ci' ? 'CI' : 'CD',
    scope: pipelineScope(item),
    trigger: triggerText(item),
    enabled: item.enabled,
  })),
)

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
    const items: Pipeline[] = []
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
    if (templateEnvIds.value.length > 0) {
      templateEnvIds.value.forEach((envId, index) => {
        const binding = bindings.value.find((item) => item.environmentId === envId) ?? bindings.value[0]
        const definition: CDDefinition = {
          triggerMode: 'manual',
          upstreamPipelineId: ciId,
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
    createVisible.value = false
    const ciCount = items.filter((item) => item.kind === 'ci').length
    const cdCount = items.filter((item) => item.kind === 'cd').length
    MessagePlugin.success(
      `已创建工作流（v${savedWorkflow.version}）：CI ${ciCount} 条、CD ${cdCount} 条，releaseName ${templateReleaseName.value || application.value?.name || '—'}`,
    )
  } catch (err) {
    createError.value = err instanceof Error ? err.message : '创建工作流失败'
  } finally {
    saving.value = false
  }
}

function openTrigger(): void {
  const items = workflow.value?.items ?? []
  ciManual.value = true
  ciPush.value = false
  const next: Record<string, TriggerMode> = {}
  items.forEach((item) => {
    const definition = item.definition
    if (isCIDefinition(definition)) {
      ciManual.value = definition.manual
      ciPush.value = definition.push
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
  if (ciItem.value && !ciManual.value && !ciPush.value) {
    triggerError.value = 'CI 至少保留一种触发方式'
    return
  }
  triggerError.value = ''
  saving.value = true
  try {
    const items: Pipeline[] = current.items.map((item) => {
      const definition = item.definition
      if (isCIDefinition(definition)) {
        const nextCI: CIDefinition = { ...definition, manual: ciManual.value, push: ciPush.value }
        return { ...item, definition: nextCI }
      }
      const nextCD: CDDefinition = { ...definition, triggerMode: cdTriggers.value[item.id] ?? 'manual' }
      return { ...item, definition: nextCD }
    })
    const savedWorkflow = await saveWorkflow(appId.value, { version: current.version, items })
    workflow.value = savedWorkflow
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
    <PageHeader title="工作流" description="从源码到环境的流水线编排；关系图展示 CI 与各环境 CD 的依赖。">
      <template #actions>
        <t-button v-if="hasWorkflow" variant="outline" :disabled="loading || workflow === null" @click="openTrigger">
          <template #icon><t-icon name="refresh" /></template>
          更新触发方式
        </t-button>
        <t-button v-else theme="primary" :disabled="loading" @click="openCreate">
          <template #icon><t-icon name="add" /></template>
          从模板创建工作流
        </t-button>
      </template>
    </PageHeader>

    <div v-if="loading" class="sec__state">
      <t-loading size="small" text="加载中…" />
    </div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <div v-else-if="!hasWorkflow" class="tk-panel">
      <EmptyState
        icon="info-circle"
        title="尚未创建工作流"
        description="工作流把 CI 构建与各环境 CD 发布串成一条链路；先从模板创建，再按需调整触发方式。"
      >
        <template #action>
          <t-button theme="primary" @click="openCreate">
            <template #icon><t-icon name="add" /></template>
            从模板创建工作流
          </t-button>
        </template>
      </EmptyState>
    </div>

    <template v-else>
      <section class="tk-panel">
        <div class="tk-panel__head">
          <span>关系图</span>
          <span class="u-dim">工作流版本 {{ versionText }}</span>
        </div>
        <div class="tk-panel__body">
          <PipelineGraph :rows="graphRows" editable @edit="onGraphEdit" @remove-pipeline="onGraphRemove" @add-pipeline="onGraphAdd" />
        </div>
      </section>

      <section class="tk-panel">
        <div class="tk-panel__head">
          <span>流水线</span>
          <span class="u-dim">只读；触发方式通过「更新触发方式」调整</span>
        </div>
        <t-table :data="pipelineRows" :columns="pipelineColumns" row-key="id" size="small" :hover="false">
          <template #edit="{ row }">
            <t-button
              size="small"
              variant="text"
              @click="openEdit(workflow?.items.find((item) => item.id === row.id) ?? ciItem!)"
            >
              编辑
            </t-button>
          </template>
          <template #enabled="{ row }">
            <StatusTag
              kind="setup"
              :value="row.enabled ? 'complete' : 'not_required'"
              :text="row.enabled ? '启用' : '停用'"
            />
          </template>
        </t-table>
      </section>
    </template>

    <t-dialog v-model:visible="createVisible" header="从模板创建工作流" :footer="false" width="560px" @close="closeCreate">
      <div class="dlg">
        <t-alert v-if="createError" theme="error" :message="createError" />
        <t-alert
          v-if="bindings.length === 0"
          theme="warning"
          title="该应用尚无环境绑定"
          message="CD 流水线将不关联 binding，创建后需先在环境绑定中补齐。"
        />
        <div class="fld">
          <span class="fld__label">模板</span>
          <t-select v-model="templateKey" :options="templateOptions" />
          <span class="u-dim">{{ templateHint }}</span>
        </div>
        <div v-if="templateNeedsBranch" class="fld">
          <span class="fld__label">CI 分支</span>
          <t-input v-model="templateBranch" placeholder="main" />
          <span class="u-dim">CI 只从该分支触发，构建时固定为一个提交 SHA。</span>
        </div>
        <div v-if="templateNeedsEnv" class="fld">
          <span class="fld__label">环境</span>
          <t-select v-model="templateEnvIds" :options="envOptions" multiple placeholder="选择发布环境" />
          <span class="u-dim">每个选中环境生成一条 CD 流水线，绑定该环境已有 binding（无则用第一个绑定）。</span>
        </div>
        <div v-if="templateNeedsEnv" class="fld">
          <span class="fld__label">releaseName</span>
          <t-input v-model="templateReleaseName" placeholder="checkout-api" />
          <span class="u-dim">默认取应用名；静态演示阶段仅作展示，已绑定环境沿用 binding 中的 releaseName。</span>
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
        <section v-if="ciItem" class="dlg__group">
          <p class="dlg__title">CI 触发</p>
          <div class="dlg__row">
            <span>手动触发</span>
            <t-switch v-model="ciManual" />
          </div>
          <div class="dlg__row">
            <span>Push 触发</span>
            <t-switch v-model="ciPush" />
          </div>
          <p class="u-dim">CI 至少保留一种触发方式；Push 触发需在仓库侧配置 Webhook 凭据。</p>
        </section>
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

    <t-drawer v-model:visible="editVisible" size="520px" placement="right" :footer="false">
      <template #header>
        <span>编辑流水线 · {{ editItem?.id }}</span>
      </template>
      <div class="dlg">
        <div class="edit__tabs">
          <button
            type="button"
            class="edit__tab"
            :class="{ 'edit__tab--active': stageTab === 'pre' }"
            @click="stageTab = 'pre'"
          >
            前置阶段
          </button>
          <button
            type="button"
            class="edit__tab"
            :class="{ 'edit__tab--active': stageTab === 'main' }"
            @click="stageTab = 'main'"
          >
            主阶段
          </button>
          <button
            type="button"
            class="edit__tab"
            :class="{ 'edit__tab--active': stageTab === 'post' }"
            @click="stageTab = 'post'"
          >
            后置阶段
          </button>
        </div>

        <t-alert v-if="editError" theme="error" :message="editError" />

        <template v-if="stageTab === 'main'">
          <template v-if="editItem?.kind === 'ci'">
            <div class="fld">
              <span class="fld__label">CI 分支</span>
              <t-input v-model="editBranch" placeholder="main" />
              <span class="u-dim">只从该分支触发构建，构建时固定一个提交 SHA。</span>
            </div>
            <div class="dlg__row">
              <span>手动触发</span>
              <t-switch v-model="editManual" />
            </div>
            <div class="dlg__row">
              <span>Push 触发</span>
              <t-switch v-model="editPush" />
            </div>
            <p class="u-dim">Dockerfile / Context / 镜像仓库继承「构建配置」，此处不重复配置。</p>
          </template>
          <template v-else>
            <div class="fld">
              <span class="fld__label">触发方式</span>
              <t-radio-group v-model="editTrigger" size="small" theme="button">
                <t-radio value="manual">手动</t-radio>
                <t-radio value="on_ci_success">CI 成功后自动</t-radio>
              </t-radio-group>
              <span class="u-dim">生产环境建议手动；镜像 digest 由发布确认固定。</span>
            </div>
            <div class="fld">
              <span class="fld__label">部署超时（秒）</span>
              <t-input-number v-model="editDeployTimeout" :min="30" :max="3600" :step="30" theme="normal" />
            </div>
            <p class="u-dim">目标 Namespace / Cluster 来自环境绑定，只读。</p>
          </template>
        </template>

        <template v-else>
          <p class="u-dim">
            {{ stageTab === 'pre' ? '前置阶段（Pre-deployment）' : '后置阶段（Post-deployment）' }}
            首版仅支持内置校验步骤，自定义脚本任务不在本期范围。
          </p>
          <p class="u-dim">保存主阶段不会触发执行；发布仍由「构建发布」页发起。</p>
        </template>

        <div class="dlg__footer">
          <t-button variant="outline" @click="editVisible = false">取消</t-button>
          <t-button theme="primary" :loading="editSaving" :disabled="stageTab !== 'main'" @click="saveEdit">
            更新流水线
          </t-button>
        </div>
      </div>
    </t-drawer>
  </div>
</template>

<style scoped>
.sec {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
