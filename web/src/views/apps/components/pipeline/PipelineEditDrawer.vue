<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { getConfig, saveWorkflow } from '@/api'
import type { AppConfig, CDDefinition, CIDefinition, Pipeline, Workflow } from '@/types'

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
const branch = ref('')
const manual = ref(true)
const push = ref(false)
const triggerMode = ref<'manual' | 'on_ci_success'>('manual')
const deployTimeout = ref(300)
const error = ref('')
const saving = ref(false)
const config = ref<AppConfig | null>(null)
const confirmDelete = ref(false)

const isCi = computed(() => props.pipeline?.kind === 'ci')
const title = computed(() => (isCi.value ? '编辑构建流水线' : '编辑部署流水线'))
const repoName = computed(() => {
  const url = config.value?.gitConfig?.repositoryUrl ?? ''
  const cleaned = url.replace(/\.git$/, '').replace(/\/+$/, '')
  return cleaned.split('/').filter(Boolean).pop() ?? '—'
})
const triggerChoice = computed<'auto' | 'manual'>({
  get: () => (manual.value ? 'manual' : 'auto'),
  set: (value) => {
    manual.value = value === 'manual'
    push.value = value === 'auto'
  },
})

async function loadConfig(): Promise<void> {
  if (!appId.value) return
  try {
    config.value = await getConfig(appId.value)
  } catch {
    config.value = null
  }
}

watch(
  () => [props.visible, props.pipeline?.id] as const,
  ([visible]) => {
    if (!visible || !props.pipeline) return
    stageTab.value = 'main'
    error.value = ''
    void loadConfig()
    if (props.pipeline.kind === 'ci') {
      const definition = props.pipeline.definition as CIDefinition
      branch.value = definition.branch
      manual.value = definition.manual
      push.value = definition.push
    } else {
      const definition = props.pipeline.definition as CDDefinition
      triggerMode.value = definition.triggerMode
      deployTimeout.value = definition.deployTimeoutSeconds
    }
  },
  { immediate: true },
)

function close(): void {
  confirmDelete.value = false
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

async function save(): Promise<void> {
  const pipeline = props.pipeline
  if (!pipeline) return
  error.value = ''
  if (pipeline.kind === 'ci') {
    if (!branch.value.trim()) {
      error.value = 'CI 分支不能为空'
      return
    }
    if (!manual.value && !push.value) {
      error.value = 'CI 至少保留一种触发方式'
      return
    }
  }
  saving.value = true
  try {
    const current = await loadItems()
    const items = current.map((row) => {
      if (row.id !== pipeline.id) return row
      if (row.kind === 'ci') {
        const definition: CIDefinition = {
          ...(row.definition as CIDefinition),
          branch: branch.value.trim(),
          manual: manual.value,
          push: push.value,
        }
        return { ...row, definition }
      }
      const definition: CDDefinition = {
        ...(row.definition as CDDefinition),
        triggerMode: triggerMode.value,
        deployTimeoutSeconds: Math.round(deployTimeout.value),
      }
      return { ...row, definition }
    })
    const saved = await saveWorkflow(appId.value, { version: props.version, items })
    MessagePlugin.success(`已更新流水线 ${pipeline.id}（配置版本 v${saved.version}）`)
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
  <t-drawer :visible="visible" size="1024px" placement="right" :footer="false" @close="close">
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

      <div class="pe__body">
        <aside class="pe__rail">
          <p class="pe__rail-title">{{ isCi ? '触发构建流水线' : '触发部署流水线' }}</p>
          <t-radio-group v-if="isCi" v-model="triggerChoice" class="pe__radios">
            <t-radio value="auto">自动触发（Push）</t-radio>
            <t-radio value="manual">手动触发</t-radio>
          </t-radio-group>
          <t-radio-group v-else v-model="triggerMode" class="pe__radios">
            <t-radio value="on_ci_success">CI 成功后自动</t-radio>
            <t-radio value="manual">手动触发</t-radio>
          </t-radio-group>

          <div class="pe__help">
            <p><span class="pe__help-dot" />需要帮助？</p>
            <span class="pe__help-link">查看流水线文档</span>
          </div>
        </aside>

        <section class="pe__main">
          <template v-if="stageTab === 'main'">
            <template v-if="isCi">
              <div class="pe__field">
                <label>流水线名称 <em>*</em></label>
                <t-input :value="pipeline?.id" readonly />
              </div>

              <div class="pe__field">
                <label>选择代码源</label>
                <div class="pe__source">
                  <span class="pe__source-icon"><t-icon name="code" size="15px" /></span>
                  <span>{{ repoName }}</span>
                </div>
              </div>

              <div class="pe__grid">
                <div class="pe__field">
                  <label>源类型 <em>*</em></label>
                  <t-select
                    :value="'branch'"
                    :options="[{ label: '分支固定', value: 'branch' }]"
                    disabled
                  />
                </div>
                <div class="pe__field">
                  <label>分支名称 <em>*</em></label>
                  <t-input v-model="branch" placeholder="main" />
                </div>
              </div>

              <section class="pe__card">
                <div class="pe__card-head">
                  <div>
                    <p class="pe__card-title">覆盖选项</p>
                    <p class="pe__card-desc">镜像仓库与 Dockerfile 继承应用构建配置，本流水线不单独覆盖。</p>
                  </div>
                  <t-button size="small" variant="outline" disabled>允许覆盖</t-button>
                </div>
                <div class="pe__grid">
                  <div class="pe__readonly">
                    <span>镜像 Repository</span>
                    <b>{{ config?.buildConfig?.imageRepository || '—' }}</b>
                  </div>
                  <div class="pe__readonly">
                    <span>Dockerfile 路径</span>
                    <b>{{ config?.buildConfig?.dockerfile || '—' }}</b>
                  </div>
                  <div class="pe__readonly">
                    <span>Context 路径</span>
                    <b>{{ config?.buildConfig?.context || '—' }}</b>
                  </div>
                  <div class="pe__readonly">
                    <span>目标平台</span>
                    <b>{{ config?.buildConfig?.platform || '未设置（使用构建配置）' }}</b>
                  </div>
                </div>
              </section>
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
                  <t-input value="来自环境绑定（只读）" readonly />
                </div>
              </div>
              <p class="pe__hint">镜像 digest 在发布确认时固定；目标 Namespace / Cluster 由环境绑定决定。</p>
            </template>
          </template>

          <template v-else>
            <section class="pe__card">
              <p class="pe__card-title">{{ stageTab === 'pre' ? '前置阶段' : '后置阶段' }}</p>
              <p class="pe__card-desc">
                {{ stageTab === 'pre' ? '前置阶段（Pre-deployment）' : '后置阶段（Post-deployment）' }}
                首版仅支持内置校验步骤，自定义脚本任务不在本期范围。
              </p>
              <p class="pe__card-desc">保存主阶段不会触发执行；发布仍由「构建发布」页发起。</p>
            </section>
          </template>
        </section>
      </div>

      <div class="pe__footer">
        <t-button variant="text" theme="danger" @click="requestDelete">删除流水线</t-button>
        <span class="pe__footer-spacer" />
        <t-button variant="outline" @click="close">取消</t-button>
        <t-button theme="primary" :loading="saving" :disabled="stageTab !== 'main'" @click="save">
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
    </div>
  </t-drawer>
</template>

<style scoped>
.pe {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
.pe__tabs {
  display: flex;
  gap: 24px;
  margin: -4px 0 16px;
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
}
.pe__rail {
  padding-right: 20px;
  border-right: 1px solid #e6e9ef;
}
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
  gap: 12px;
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
  padding-top: 16px;
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
