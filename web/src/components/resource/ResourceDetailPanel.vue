<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'

import {
  getResource,
  revealSecret,
} from '@/api'
import type { SecretRevealResult } from '@/api'
import ResourceActionDialog from './ResourceActionDialog.vue'
import ResourceManifestWorkspace from './ResourceManifestWorkspace.vue'
import ResourceDetailTabs from './ResourceDetailTabs.vue'
import ResourceDetailActions from './ResourceDetailActions.vue'
import PodLogsWorkspace from './PodLogsWorkspace.vue'
import PodTerminalWorkspace from './PodTerminalWorkspace.vue'
import ResourceEventsWorkspace from './ResourceEventsWorkspace.vue'
import ErrorState from '@/components/ErrorState.vue'
import type { K8sResource } from '@/types'
import type { ResourceTabKey } from '@/stores/resourceTabs'

const props = defineProps<{
  clusterId: string
  group: string
  resource: string
  namespace: string
  name: string
  initialContainer?: string
  terminalContext?: Record<string, string>
  tab: ResourceTabKey
  manager?: 'infrastructure' | 'application'
}>()

const emit = defineEmits<{ 'update:tab': [tab: ResourceTabKey]; 'update:container': [name: string]; deleted: []; changed: []; synced: [] }>()

const detail = ref<K8sResource | null>(null)
/* P2：日志流控制（容器 / 时间窗口 / 自动滚动） */
const eventCount = ref<number | null>(null)
const refreshKey = ref(0)
const loading = ref(false)
const error = ref('')
const actionVisible = ref(false)
const action = ref<'restart' | 'scale' | 'delete'>('restart')

/* Manifest 编辑 / Dry run / Diff / Apply（P1）：共用工作区管理草稿与分栏预览。 */
const manifestWorkspace = useTemplateRef<InstanceType<typeof ResourceManifestWorkspace>>('manifestWorkspace')
function requestLeave(): boolean | Promise<boolean> { return manifestWorkspace.value?.requestLeave() ?? true }
function onManifestApplied(updated: K8sResource): void {
  detail.value = updated
  emit('changed')
}
defineExpose({ requestLeave, reload: load })

/* P2：Secret 明文读取（独立授权 + 审计） */
const revealVisible = ref(false)
const revealLoading = ref(false)
const revealResult = ref<SecretRevealResult | null>(null)
const revealError = ref('')
const revealedKeys = ref<string[]>([])

const isPod = computed(() => !props.group && props.resource === 'pods')
const isSecret = computed(() => !props.group && props.resource === 'secrets')
const kindLabel = computed(() => detail.value?.kind ?? props.resource)
/** 只有工作负载类才提供重启 / 扩缩容 */
const isWorkload = computed(() =>
  props.group === 'apps' && ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet'].includes(kindLabel.value),
)

const canScale = computed(() => props.group === 'apps' && ['Deployment', 'StatefulSet', 'ReplicaSet'].includes(kindLabel.value))

const tabs = computed(() => {
  const list: Array<{ value: ResourceTabKey; label: string }> = [
    { value: 'manifest', label: 'Manifest' },
    { value: 'events', label: eventCount.value === null ? '事件' : `事件（${eventCount.value}）` },
  ]
  if (isPod.value) {
    list.push({ value: 'logs', label: '日志' })
    list.push({ value: 'terminal', label: '终端' })
  }
  return list
})

/** 对齐 Devtron 的 Hide Managed Fields：工作区只隐藏 metadata.managedFields 完整子树。 */
let detailRequest = 0
async function load(): Promise<void> {
  const request = ++detailRequest
  loading.value = true
  error.value = ''
  try {
    const found = await getResource(props.clusterId, props.group, props.resource, props.namespace, props.name)
    if (request !== detailRequest) return
    detail.value = found
    eventCount.value = null
    refreshKey.value++
    emit('synced')
  } catch (err) {
    if (request !== detailRequest) return
    detail.value = null
    eventCount.value = null
    error.value = err instanceof Error ? err.message : '资源详情加载失败'
  } finally {
    if (request === detailRequest) loading.value = false
  }
}

async function openReveal(): Promise<void> {
  revealLoading.value = true
  revealError.value = ''
  try {
    revealResult.value = await revealSecret(props.clusterId, props.namespace, props.name)
    revealedKeys.value = []
    revealVisible.value = true
  } catch (err) {
    revealError.value = err instanceof Error ? err.message : 'Secret 明文读取失败'
    MessagePlugin.error(revealError.value)
  } finally {
    revealLoading.value = false
  }
}

function toggleReveal(key: string): void {
  revealedKeys.value = revealedKeys.value.includes(key)
    ? revealedKeys.value.filter((item) => item !== key)
    : [...revealedKeys.value, key]
}

function maskValue(value: string): string {
  return '•'.repeat(Math.min(12, Math.max(6, value.length)))
}

async function switchTab(value: ResourceTabKey): Promise<void> {
  if (value === props.tab || !(await requestLeave())) return
  emit('update:tab', value)
}

async function openAction(next: 'restart' | 'scale' | 'delete'): Promise<void> {
  if (!(await requestLeave())) return
  action.value = next
  actionVisible.value = true
}

async function onActionCompleted(deleted: string[]): Promise<void> {
  if (detail.value && deleted.includes(detail.value.ref.uid)) emit('deleted')
  else await load()
  emit('changed')
}

watch(
  () => [props.clusterId, props.group, props.resource, props.namespace, props.name],
  () => void load(),
  { immediate: true },
)


onBeforeUnmount(() => {
  ++detailRequest
})
</script>

<template>
  <div class="rpanel" :aria-label="`${kindLabel} / ${name}`">
    <!-- 资源条：标识 + 全局操作 -->
    <div class="rpanel__identity">
      <div class="rpanel__ident">
        <span class="rpanel__kind">{{ kindLabel }}</span>
        <span class="rpanel__sep">/</span>
        <span class="rpanel__name">{{ name }}</span>
        <span class="rpanel__meta u-mono">{{ namespace }}</span>
        <span v-if="detail?.ref.uid" class="rpanel__meta u-mono">uid {{ detail.ref.uid }}</span>
      </div>
    </div>

    <t-alert
      v-if="isSecret"
      theme="warning"
      message="Secret 默认只返回键名；通过「更多资源操作 → 查看明文」读取会记录一条 secret.reveal 审计。"
      class="rpanel__alert"
    />

    <ErrorState v-if="error" :message="error" @retry="load" />

    <t-loading v-else :loading="loading">
      <ResourceManifestWorkspace v-if="detail" v-show="tab === 'manifest'" ref="manifestWorkspace" :resource="detail" :cluster-id="clusterId" :allow-compare="manager === 'application' && Boolean(detail.appId) && !detail.ownerRefs.length" @applied="onManifestApplied">
        <template #tabs><ResourceDetailTabs :tabs="tabs" :active="tab" @select="switchTab" /></template>
        <template #actions="{ busy }"><ResourceDetailActions :workload="isWorkload" :scalable="canScale" :secret="isSecret" :allow-delete="manager !== 'application'" :disabled="loading || busy" :revealing="revealLoading" @action="openAction" @reveal="openReveal" /></template>
      </ResourceManifestWorkspace>
      <div v-if="detail && tab !== 'manifest'" class="rpanel__tabsbar">
        <ResourceDetailTabs :tabs="tabs" :active="tab" @select="switchTab" />
        <ResourceDetailActions :workload="isWorkload" :scalable="canScale" :secret="isSecret" :allow-delete="manager !== 'application'" :disabled="loading" :revealing="revealLoading" @action="openAction" @reveal="openReveal" />
      </div>

      <ResourceEventsWorkspace v-if="detail" v-show="tab === 'events'" :uid="detail.ref.uid" :active="tab === 'events' && !loading" :refresh-key="refreshKey" @loaded="eventCount = $event" />
      <PodLogsWorkspace v-if="detail && isPod" v-show="tab === 'logs'" :resource="detail" :active="tab === 'logs' && !loading" :initial-container="initialContainer" :refresh-key="refreshKey" @container="emit('update:container', $event)" />

      <PodTerminalWorkspace v-if="detail && isPod" v-show="tab === 'terminal'" :resource="detail" :cluster-id="clusterId" :active="tab === 'terminal' && !loading" :initial-container="initialContainer" :context="terminalContext" @container="emit('update:container', $event)" />
    </t-loading>

    <t-dialog
      v-model:visible="revealVisible"
      header="Secret 明文"
      width="560px"
      :footer="false"
    >
      <t-alert
        theme="warning"
        message="明文读取已记录审计（secret.reveal）。请勿复制到工单或聊天工具。"
        class="rpanel__alert"
      />
      <p v-if="revealResult" class="rpanel__reveal-meta">
        {{ revealResult.name }} · {{ revealResult.namespace }} · 审计 {{ revealResult.auditId }}
      </p>
      <t-table
        row-key="key"
        size="small"
        :data="revealResult?.keys ?? []"
        :columns="[
          { colKey: 'key', title: '键', width: 170 },
          { colKey: 'value', title: '值' },
          { colKey: 'ops', title: '', width: 80 },
        ]"
      >
        <template #key="{ row }"><span class="u-mono">{{ row.key }}</span></template>
        <template #value="{ row }">
          <span class="u-mono">{{ revealedKeys.includes(row.key) ? row.value : maskValue(row.value) }}</span>
        </template>
        <template #ops="{ row }">
          <t-button size="small" variant="text" @click="toggleReveal(row.key)">
            {{ revealedKeys.includes(row.key) ? '隐藏' : '显示' }}
          </t-button>
        </template>
      </t-table>
      <div class="rpanel__reveal-foot">
        <t-button size="small" variant="text" @click="revealVisible = false">关闭</t-button>
      </div>
    </t-dialog>

    <ResourceActionDialog v-model:visible="actionVisible" :cluster-id="clusterId" :targets="detail ? [detail] : []" :action="action" @completed="onActionCompleted" />
  </div>
</template>

<style scoped>
.rpanel {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.rpanel__identity {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.rpanel__ident {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.rpanel__kind {
  color: var(--tk-text-2);
}
.rpanel__sep {
  color: var(--tk-text-3);
}
.rpanel__name {
  font-weight: 600;
}
.rpanel__meta {
  margin-left: 6px;
  color: var(--tk-text-3);
}
.rpanel__alert {
  margin: 8px 12px 0;
}
.rpanel__tabsbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 32px;
  box-sizing: border-box;
  padding: 0 20px;
  overflow-x: auto;
  border-bottom: 1px solid var(--tk-border);
}
.rpanel__tab {
  position: relative;
  height: 40px;
  padding: 0;
  font: inherit;
  color: var(--tk-text-2);
  background: none;
  border: 0;
  cursor: pointer;
}
.rpanel__tab:hover {
  color: var(--tk-primary);
}
.rpanel__tab--active {
  color: var(--tk-primary);
  font-weight: 600;
}
.rpanel__tab--active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: var(--tk-primary);
}
.rpanel__tabs-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  color: var(--tk-text-2);
}
.rpanel__check {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
}
.rpanel__log-select {
  width: 140px;
}
.rpanel__body {
  padding: 12px;
}
.rpanel__code {
  margin: 0;
  max-height: 560px;
}
.rpanel__logs {
  max-height: 480px;
}
.rpanel__term {
  min-height: 260px;
  max-height: 420px;
}
.rpanel__log-line {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
.rpanel__term-input {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.rpanel__hint {
  margin: 6px 2px 0;
  color: var(--tk-text-3);
  font-size: 11px;
}
.rpanel__dialog-res {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 10px;
  color: #3b444c;
  font-size: 12px;
  background: #f7fafc;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.rpanel__dialog-kind {
  padding: 1px 6px;
  color: #0066cc;
  font-size: 11px;
  background: #eef5ff;
  border-radius: 2px;
}
.rpanel__dialog-alert {
  margin-bottom: 12px;
}
.rpanel__dialog-text {
  margin: 0 0 8px;
  color: var(--tk-text-2);
}
.rpanel__session {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--tk-text-2);
  font-size: 12px;
}
.rpanel__session-actions {
  display: inline-flex;
  gap: 4px;
}
.u-danger {
  color: var(--tk-danger);
}
.rpanel__reveal-meta {
  margin: 10px 0 8px;
  color: var(--tk-text-2);
}
.rpanel__reveal-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}
</style>
