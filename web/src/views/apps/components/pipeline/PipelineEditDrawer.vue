<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { saveWorkflow } from '@/api'
import type { CDDefinition, CIDefinition, Pipeline, Workflow } from '@/types'

const props = defineProps<{
  visible: boolean
  pipeline: Pipeline | null
  version: number
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: [workflow: Workflow]
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

const isCi = computed(() => props.pipeline?.kind === 'ci')

watch(
  () => [props.visible, props.pipeline?.id] as const,
  ([visible]) => {
    if (!visible || !props.pipeline) return
    stageTab.value = 'main'
    error.value = ''
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
  emit('update:visible', false)
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
  <t-drawer :visible="visible" size="520px" placement="right" :footer="false" @close="close">
    <template #header>
      <span>编辑流水线 · {{ pipeline?.id }}</span>
    </template>
    <div class="pipe-edit">
      <div class="pipe-edit__tabs">
        <button
          type="button"
          class="pipe-edit__tab"
          :class="{ 'pipe-edit__tab--active': stageTab === 'pre' }"
          @click="stageTab = 'pre'"
        >
          前置阶段
        </button>
        <button
          type="button"
          class="pipe-edit__tab"
          :class="{ 'pipe-edit__tab--active': stageTab === 'main' }"
          @click="stageTab = 'main'"
        >
          主阶段
        </button>
        <button
          type="button"
          class="pipe-edit__tab"
          :class="{ 'pipe-edit__tab--active': stageTab === 'post' }"
          @click="stageTab = 'post'"
        >
          后置阶段
        </button>
      </div>

      <t-alert v-if="error" theme="error" :message="error" />

      <template v-if="stageTab === 'main'">
        <template v-if="isCi">
          <div class="fld">
            <span class="fld__label">CI 分支</span>
            <t-input v-model="branch" placeholder="main" />
            <span class="u-dim">只从该分支触发构建，构建时固定一个提交 SHA。</span>
          </div>
          <div class="pipe-edit__row">
            <span>手动触发</span>
            <t-switch v-model="manual" />
          </div>
          <div class="pipe-edit__row">
            <span>Push 触发</span>
            <t-switch v-model="push" />
          </div>
          <p class="u-dim">Dockerfile / Context / 镜像仓库继承「构建配置」，此处不重复配置。</p>
        </template>
        <template v-else>
          <div class="fld">
            <span class="fld__label">触发方式</span>
            <t-radio-group v-model="triggerMode" size="small" theme="button">
              <t-radio value="manual">手动</t-radio>
              <t-radio value="on_ci_success">CI 成功后自动</t-radio>
            </t-radio-group>
            <span class="u-dim">生产环境建议手动；镜像 digest 由发布确认固定。</span>
          </div>
          <div class="fld">
            <span class="fld__label">部署超时（秒）</span>
            <t-input-number v-model="deployTimeout" :min="30" :max="3600" :step="30" theme="normal" />
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

      <div class="pipe-edit__footer">
        <t-button variant="outline" @click="close">取消</t-button>
        <t-button theme="primary" :loading="saving" :disabled="stageTab !== 'main'" @click="save">
          更新流水线
        </t-button>
      </div>
    </div>
  </t-drawer>
</template>

<style scoped>
.pipe-edit {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pipe-edit__tabs {
  display: flex;
  gap: 6px;
}
.pipe-edit__tab {
  padding: 3px 10px;
  font: inherit;
  font-size: 12px;
  color: var(--tk-text-2);
  background: transparent;
  border: 1px solid var(--tk-border);
  border-radius: 3px;
  cursor: pointer;
}
.pipe-edit__tab--active {
  color: var(--tk-primary);
  background: #eef4fd;
  border-color: #b9d0f5;
  font-weight: 600;
}
.pipe-edit__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--tk-border);
}
.pipe-edit__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
}
</style>
