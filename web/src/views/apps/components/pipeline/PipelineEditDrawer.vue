<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { getConfig, listRegistries, listStageResources, saveWorkflow } from '@/api'
import type { AppConfig, BuildConfig, CDDefinition, CIDefinition, CISource, DeploymentStageSettings, Pipeline, PipelineTask, Registry, StageResourceReferences, Workflow } from '@/types'
import PipelineSourceFields from '@/components/application/PipelineSourceFields.vue'
import PipelineBuildOverride from '@/components/application/PipelineBuildOverride.vue'
import BuildPlatformConfirmation from '@/components/application/BuildPlatformConfirmation.vue'
import { customPlatformsOf, normalizeBuildConfig } from '@/utils/buildOptions'
import { gitMaterialsOf } from '@/utils/gitMaterials'
import { ciSourcesOf, sourceError, validateBuildConfig } from '@/utils/pipelineBuild'
import { isWebhookSource, sourceContextError } from '@/utils/gitSources'
import { copyTasks, validatePipelineTasks } from '@/utils/pipelineTasks'
import { emptyStageResources, stageResourceErrors } from '@/utils/stageResources'
import { deploymentStageErrors, deploymentStageOf } from '@/utils/deploymentStage'
import type { StageResourceOption } from '@/utils/stageResources'
import { usePipelineDraft } from '@/composables/usePipelineDraft'
import PipelineStageEditor from './PipelineStageEditor.vue'

const props = defineProps<{
  visible: boolean
  pipeline: Pipeline | null
  version: number
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: [workflow: Workflow]
  remove: [id: string]
}>()

const route = useRoute()
const appId = computed(() => String(route.params.appId ?? ''))

type StageTab = 'pre' | 'main' | 'post'

const stageTab = ref<StageTab>('main')
const sources = ref<CISource[]>([])
const registries = ref<Registry[]>([])
const buildOverride = ref<BuildConfig | null>(null)
const savedBuildOverride = computed(() => props.pipeline?.kind === 'ci' ? (props.pipeline.definition as CIDefinition).buildOverride : null)
const buildBlocked = shallowRef(false)
const buildErrors = ref<Record<string, string>>({})
const platformConfirmation = shallowRef(false)
const customPlatforms = computed(() => buildOverride.value ? customPlatformsOf(buildOverride.value) : [])
const submitted = ref(false)
const configLoading = ref(false)
let generation = 0
const manual = ref(true)
const push = ref(false)
const triggerMode = ref<'manual' | 'on_ci_success'>('manual')
const deployTimeout = ref(300)
const error = ref('')
const saving = ref(false)
const config = ref<AppConfig | null>(null)
const confirmDelete = ref(false)
const preTasks = ref<PipelineTask[]>([])
const postTasks = ref<PipelineTask[]>([])
const preResources = ref<StageResourceReferences>(emptyStageResources())
const postResources = ref<StageResourceReferences>(emptyStageResources())
const resourceOptions = ref<StageResourceOption[]>([])
const resourceScope = shallowRef('')
const workerEnabled = shallowRef(false)
const preSettings = shallowRef<DeploymentStageSettings>({ trigger: 'auto', runInEnvironment: false })
const postSettings = shallowRef<DeploymentStageSettings>({ trigger: 'auto', runInEnvironment: false })
const taskErrors = computed(() => validatePipelineTasks(preTasks.value, postTasks.value))
watch([sources,buildOverride,preTasks,postTasks,preResources,postResources,preSettings,postSettings,triggerMode], () => { error.value = '' })
const { dirty, discardVisible, markClean, resolveDiscard, requestClose } = usePipelineDraft({
  visible: () => props.visible, saving, close,
  snapshot: () => JSON.stringify({sources:sources.value,buildOverride:buildOverride.value,manual:manual.value,push:push.value,triggerMode:triggerMode.value,deployTimeout:deployTimeout.value,preTasks:preTasks.value,postTasks:postTasks.value,preResources:preResources.value,postResources:postResources.value,preSettings:preSettings.value,postSettings:postSettings.value}),
})
function moveTask(id: string): void {
  const source = stageTab.value === 'pre' ? preTasks : postTasks
  const destination = stageTab.value === 'pre' ? postTasks : preTasks
  const task = source.value.find((item) => item.id === id)
  if (!task) return
  source.value = source.value.filter((item) => item.id !== id)
  destination.value = [...destination.value, task]
}

const isCi = computed(() => props.pipeline?.kind === 'ci')
const autoTriggerLabel = computed(() => sources.value.some(isWebhookSource) ? '自动触发（Webhook）' : '自动触发（Push）')
const title = computed(() => (isCi.value ? '编辑构建流水线' : '编辑部署流水线'))
const triggerChoice = computed<'auto' | 'manual'>({
  get: () => (manual.value ? 'manual' : 'auto'),
  set: (value) => {
    manual.value = value === 'manual'
    push.value = value === 'auto'
  },
})

async function loadConfig(): Promise<void> {
  const current = ++generation
  configLoading.value = true
  config.value = null
  try {
    const pipeline = props.pipeline
    const [cfg, registryList, stageResources] = await Promise.all([
      getConfig(appId.value), listRegistries(),
      pipeline?.kind === 'cd' ? listStageResources(appId.value, pipeline.bindingId ?? '') : Promise.resolve(null),
    ])
    if (current !== generation) return
    config.value = cfg
    registries.value = registryList
    resourceOptions.value = stageResources?.options ?? []
    resourceScope.value = stageResources?.scope ?? ''
    workerEnabled.value = stageResources?.workerEnabled ?? false
    sources.value = ciSourcesOf(cfg, props.pipeline?.definition as CIDefinition)
  } catch (err) {
    if (current === generation) error.value = err instanceof Error ? err.message : '配置加载失败'
  } finally { if (current === generation) { configLoading.value = false; markClean() } }
}

watch(
  () => [props.visible, props.pipeline?.id] as const,
  ([visible]) => {
    platformConfirmation.value = false
    if (!visible || !props.pipeline) { generation++; return }
    stageTab.value = 'main'
    error.value = ''
    submitted.value = false
    buildErrors.value = {}
    sources.value = []
    resourceOptions.value = []
    resourceScope.value = ''
    workerEnabled.value = false
    const definition = props.pipeline.definition as CDDefinition
    preSettings.value = deploymentStageOf(definition, 'pre')
    postSettings.value = deploymentStageOf(definition, 'post')
    preResources.value = JSON.parse(JSON.stringify(definition.preStageResources ?? emptyStageResources()))
    postResources.value = JSON.parse(JSON.stringify(definition.postStageResources ?? emptyStageResources()))
    preTasks.value = copyTasks(props.pipeline.definition.preTasks ?? [])
    postTasks.value = copyTasks(props.pipeline.definition.postTasks ?? [])
    void loadConfig()
    if (props.pipeline.kind === 'ci') {
      const definition = props.pipeline.definition as CIDefinition
      buildOverride.value = definition.buildOverride ? JSON.parse(JSON.stringify(definition.buildOverride)) : null
      manual.value = definition.manual
      push.value = definition.push
    } else {
      const definition = props.pipeline.definition as CDDefinition
      triggerMode.value = definition.triggerMode
      deployTimeout.value = definition.deployTimeoutSeconds
    }
    markClean()
  },
  { immediate: true },
)

function close(): void {
  confirmDelete.value = false
  platformConfirmation.value = false
  emit('update:visible', false)
}

function requestDelete(): void {
  confirmDelete.value = true
}

function confirmRemove(): void {
  const pipeline = props.pipeline
  if (!pipeline) return
  confirmDelete.value = false
  emit('remove', pipeline.id)
  close()
}

async function save(confirmed = false): Promise<void> {
  const pipeline = props.pipeline
  if (!pipeline || saving.value || configLoading.value || buildBlocked.value || !config.value) return
  error.value = ''
  submitted.value = true
  const invalidTask = [...preTasks.value,...postTasks.value].find(task=>taskErrors.value[task.id]?.length)
  if (invalidTask) {
    error.value = `${invalidTask.name || '任务'}：${taskErrors.value[invalidTask.id]!.join('；')}`
    stageTab.value = preTasks.value.includes(invalidTask) ? 'pre' : 'post'
    return
  }
  if (pipeline.kind === 'cd') {
    for (const [stage, settings] of [['pre',preSettings.value],['post',postSettings.value]] as const) {
      const message = deploymentStageErrors(settings, workerEnabled.value)[0]
      if (message) { error.value = `${stage === 'pre' ? '前置阶段' : '后置阶段'}：${message}`; stageTab.value = stage; return }
    }
    for (const [stage, refs] of [['pre',preResources.value],['post',postResources.value]] as const) {
      const message = stageResourceErrors(refs,resourceOptions.value)[0]
      if (message) { error.value = message; stageTab.value = stage; return }
    }
  }
  if (pipeline.kind === 'ci') {
    const contextError = sourceContextError(sources.value, gitMaterialsOf(config.value))
    if (contextError) { error.value = contextError; stageTab.value = 'main'; return }
    if (!sources.value.length || sources.value.some(source => sourceError(source))) {
      error.value = sources.value.map(sourceError).find(Boolean) || '请先配置 Git 源'
      return
    }
    buildErrors.value = buildOverride.value ? validateBuildConfig(buildOverride.value, gitMaterialsOf(config.value)) : {}
    if (Object.keys(buildErrors.value).length) { error.value = Object.values(buildErrors.value)[0]!; return }
    if (!manual.value && !push.value) {
      error.value = 'CI 至少保留一种触发方式'
      return
    }
  }
  if (pipeline.kind === 'ci' && customPlatforms.value.length && confirmed !== true) { platformConfirmation.value = true; return }
  platformConfirmation.value = false
  saving.value = true
  try {
    const current = await loadItems()
    const items = current.map((row) => {
      if (row.id !== pipeline.id) return row
      if (row.kind === 'ci') {
        const definition: CIDefinition = {
          ...(row.definition as CIDefinition),
          branch: sources.value[0]?.type === 'branch' ? sources.value[0].value.trim() : (row.definition as CIDefinition).branch,
          materials: sources.value.map(source => ({...source, value: source.value.trim()})),
          buildOverride: buildOverride.value ? normalizeBuildConfig(buildOverride.value) : null,
          manual: manual.value,
          push: push.value,
          preTasks: copyTasks(preTasks.value),
          postTasks: copyTasks(postTasks.value),
        }
        return { ...row, definition }
      }
      const definition: CDDefinition = {
        ...(row.definition as CDDefinition),
        triggerMode: triggerMode.value,
        deployTimeoutSeconds: Math.round(deployTimeout.value),
        preStageTrigger: preSettings.value.trigger,
        postStageTrigger: postSettings.value.trigger,
        runPreStageInEnv: preSettings.value.runInEnvironment,
        runPostStageInEnv: postSettings.value.runInEnvironment,
        preStageResources: JSON.parse(JSON.stringify(preResources.value)),
        postStageResources: JSON.parse(JSON.stringify(postResources.value)),
        preTasks: copyTasks(preTasks.value),
        postTasks: copyTasks(postTasks.value),
      }
      return { ...row, definition }
    })
    const saved = await saveWorkflow(appId.value, { version: props.version, items }, config.value.version)
    MessagePlugin.success(`已更新流水线 ${pipeline.id}（配置版本 v${saved.version}）`)
    markClean()
    emit('saved', saved)
    close()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

/** 组件内重新读取一次，避免父页面版本落后 */
async function loadItems(): Promise<Pipeline[]> {
  const { getWorkflow } = await import('@/api')
  const workflow = await getWorkflow(appId.value)
  return workflow.items
}
</script>

<template>
  <t-drawer :visible="visible" size="1024px" placement="right" :footer="false" :close-on-esc-keydown="!discardVisible && !confirmDelete" drawer-class-name="pipeline-edit" @close="requestClose">
    <template #header>
      <span>{{ title }}</span>
    </template>

    <div class="pe">
      <div class="pe__tabs">
        <button type="button" class="pe__tab" :class="{ 'pe__tab--active': stageTab === 'pre' }" @click="stageTab = 'pre'">
          前置阶段
        </button>
        <button type="button" class="pe__tab" :class="{ 'pe__tab--active': stageTab === 'main' }" @click="stageTab = 'main'">
          {{ isCi ? '构建阶段' : '部署阶段' }}
        </button>
        <button type="button" class="pe__tab" :class="{ 'pe__tab--active': stageTab === 'post' }" @click="stageTab = 'post'">
          后置阶段
        </button>
      </div>

      <t-alert v-if="error" theme="error" :message="error" />

      <div class="pe__body" :class="{ 'pe__body--stages': stageTab !== 'main' }">
        <aside v-if="stageTab === 'main'" class="pe__rail">
          <p class="pe__rail-title">{{ isCi ? '触发构建流水线' : '触发部署流水线' }}</p>
          <t-radio-group v-if="isCi" v-model="triggerChoice" class="pe__radios">
            <t-radio value="auto">{{ autoTriggerLabel }}</t-radio>
            <t-radio value="manual">手动触发</t-radio>
          </t-radio-group>
          <t-radio-group v-else v-model="triggerMode" class="pe__radios">
            <t-radio value="on_ci_success">{{ preTasks.length ? '前置阶段成功后自动' : 'CI 成功后自动' }}</t-radio>
            <t-radio value="manual">手动触发</t-radio>
          </t-radio-group>

          <div class="pe__help">
            <p><span class="pe__help-dot" />需要帮助？</p>
            <span class="pe__help-link">查看流水线文档</span>
          </div>
        </aside>

        <section class="pe__main" :class="{'pe__main--stages':stageTab!=='main'}">
          <t-loading v-if="configLoading" size="small" text="读取配置…" />
          <template v-else-if="stageTab === 'main'">
            <template v-if="isCi">
              <div class="pe__field">
                <label>流水线名称 <em>*</em></label>
                <t-input :value="pipeline?.id" readonly />
              </div>

              <t-loading v-if="configLoading" size="small" text="读取配置…" />
              <template v-else-if="config">
                <PipelineSourceFields v-model="sources" :materials="gitMaterialsOf(config)" :disabled="saving" :submitted="submitted" />
                <PipelineBuildOverride v-model="buildOverride" :saved-config="savedBuildOverride" :config="config" :registries="registries" :errors="buildErrors" :disabled="saving" @blocked="buildBlocked = $event" />
              </template>
            </template>

            <template v-else>
              <div class="pe__field">
                <label>流水线名称 <em>*</em></label>
                <t-input :value="pipeline?.id" readonly />
              </div>
              <div class="pe__grid">
                <div class="pe__field">
                  <label>部署超时（秒）</label>
                  <t-input-number v-model="deployTimeout" :min="30" :max="3600" :step="30" theme="normal" />
                </div>
                <div class="pe__field">
                  <label>目标环境</label>
                  <t-input :value="resourceScope || '读取环境绑定…'" readonly />
                </div>
              </div>
              <p class="pe__hint">镜像 digest 在发布确认时固定；目标 Namespace / Cluster 由环境绑定决定。</p>
            </template>
          </template>

          <template v-else>
            <PipelineStageEditor v-if="stageTab === 'pre'" v-model="preTasks" stage="pre" v-model:resources="preResources" v-model:settings="preSettings" :worker-enabled="workerEnabled" :resource-options="resourceOptions" :resource-scope="resourceScope" :is-ci="isCi" :preceding="[]" :errors="taskErrors" :submitted="submitted" @move="moveTask" />
            <PipelineStageEditor v-else v-model="postTasks" stage="post" v-model:resources="postResources" v-model:settings="postSettings" :worker-enabled="workerEnabled" :resource-options="resourceOptions" :resource-scope="resourceScope" :is-ci="isCi" :preceding="preTasks" :errors="taskErrors" :submitted="submitted" @move="moveTask" />
          </template>
        </section>
      </div>

      <div class="pe__footer">
        <t-button variant="text" theme="danger" @click="requestDelete">删除流水线</t-button>
        <span class="pe__footer-spacer" /><span v-if="dirty" class="pe__dirty">有未保存的修改</span>
        <t-button variant="outline" :disabled="saving" @click="requestClose">取消</t-button>
          <t-button theme="primary" :loading="saving" :disabled="configLoading || buildBlocked || !config" @click="save()">
          更新流水线
        </t-button>
      </div>

      <t-dialog
        v-model:visible="confirmDelete"
        header="删除流水线"
        theme="danger"
        width="440px"
        confirm-btn="删除流水线"
        @confirm="confirmRemove"
      >
        <p class="pe__delete-text">
          删除后不可恢复。流水线 <span class="u-mono">{{ pipeline?.id }}</span> 的触发方式与配置将被移除。
        </p>
        <p class="pe__delete-text">已产生的构建与发布历史不受影响。</p>
      </t-dialog>
      <t-dialog :visible="discardVisible" header="放弃未保存的流水线修改？" confirm-btn="放弃修改" cancel-btn="继续编辑" :close-on-overlay-click="false" @confirm="resolveDiscard(true)" @close="resolveDiscard(false)">
        <p>离开后，任务、变量和构建配置的草稿将被丢弃。</p>
      </t-dialog>
      <BuildPlatformConfirmation :visible="platformConfirmation" :platforms="customPlatforms" :loading="saving" @cancel="platformConfirmation = false" @confirm="save(true)" />
    </div>
  </t-drawer>
</template>

<style scoped>
:global(.pipeline-edit .t-drawer__body){padding:0;overflow:hidden}
.pe {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.pe__tabs {
  display: flex;
  gap: 24px;
  flex: none;
  margin: 0;
  padding: 8px 20px 0;
  border-bottom: 1px solid #e6e9ef;
}
.pe__tab {
  position: relative;
  padding: 8px 0 10px;
  color: #596168;
  font: inherit;
  font-size: 13px;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.pe__tab--active {
  color: #0066cc;
  font-weight: 500;
}
.pe__tab--active::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: #0066cc;
  content: '';
}
.pe__body {
  display: grid;
  flex: 1;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 24px;
  min-height: 0;
  overflow: auto;
  padding: 20px;
  align-items: start;
}
.pe__rail {
  padding-right: 20px;
  border-right: 1px solid #e6e9ef;
}
.pe__body--stages { grid-template-columns: minmax(0, 1fr); padding: 0; overflow: hidden; align-items: stretch; }
.pe__main.pe__main--stages { display:flex; min-height:0; padding-bottom:0; }
.pe > .t-alert { flex: none; }
.pe__dirty { font-size: 12px; color: #767d84; }
.pe__rail-title {
  margin: 0 0 12px;
  color: #767d84;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.pe__radios {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}
.pe__radios :deep(.t-radio) {
  margin: 0;
}
.pe__help {
  margin-top: 28px;
  color: #596168;
  font-size: 12px;
}
.pe__help p {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 6px;
}
.pe__help-dot {
  width: 9px;
  height: 9px;
  background: #ff8300;
  border-radius: 2px;
}
.pe__help-link {
  color: #0066cc;
  font-size: 12px;
  cursor: pointer;
}
.pe__main {
  min-width: 0;
  padding-bottom: 24px;
}
.pe__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
.pe__field label {
  color: #3b444c;
  font-size: 12px;
  line-height: 18px;
}
.pe__field label em {
  color: #f33e3e;
  font-style: normal;
}
.pe__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.pe__source {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  color: #3b444c;
  font-size: 13px;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.pe__source-icon {
  display: flex;
  color: #f33e3e;
}
.pe__card {
  padding: 16px;
  margin: 8px 0 16px;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.pe__card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.pe__card-title {
  margin: 0 0 4px;
  color: #000a14;
  font-size: 13px;
  font-weight: 600;
}
.pe__card-desc {
  margin: 0;
  color: #767d84;
  font-size: 11px;
  line-height: 16px;
}
.pe__readonly {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: #f7fafc;
  border-radius: 2px;
}
.pe__readonly span {
  color: #767d84;
  font-size: 11px;
}
.pe__readonly b {
  color: #3b444c;
  font-size: 12px;
  font-weight: 500;
  word-break: break-all;
}
.pe__hint {
  margin: 0;
  color: #767d84;
  font-size: 11px;
  line-height: 16px;
}
.pe__footer {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid #e6e9ef;
}
.pe__footer-spacer {
  flex: 1;
}
.pe__delete-text {
  margin: 0 0 6px;
  color: #3b444c;
  font-size: 12px;
  line-height: 18px;
}
</style>
