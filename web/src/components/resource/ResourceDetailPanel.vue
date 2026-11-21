<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'

import {
  MockError,
  applyResource,
  closeExecSession,
  createExecSession,
  dryRunResource,
  getPodLogs,
  getResource,
  listEvents,
  revealSecret,
} from '@/api'
import type { DryRunResult, ExecSession, SecretRevealResult } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import type { K8sResource, ResourceEvent } from '@/types'
import type { ResourceTabKey } from '@/stores/resourceTabs'
import { fmtRelative } from '@/utils/format'

const props = defineProps<{
  clusterId: string
  group: string
  resource: string
  namespace: string
  name: string
  tab: ResourceTabKey
}>()

const emit = defineEmits<{ 'update:tab': [tab: ResourceTabKey] }>()

const detail = ref<K8sResource | null>(null)
const events = ref<ResourceEvent[]>([])
const logs = ref<string[]>([])

/* P2：日志流控制（容器 / 时间窗口 / 自动滚动） */
const logContainer = ref('app')
const logSince = ref(0)
const autoScroll = ref(true)
const logPrevious = ref(false)
const logTail = ref(500)
const logPaused = ref(false)

const logTailOptions = [
  { label: '100 行', value: 100 },
  { label: '500 行', value: 500 },
  { label: '1000 行', value: 1000 },
]
const logsLoading = ref(false)
const logRef = ref<HTMLElement | null>(null)

const containerOptions = computed(() => {
  const manifest = detail.value?.manifest ?? ''
  const names = [...manifest.matchAll(/^\s*- name:\s*(\S+)/gm)].map((match) => match[1])
  return [...new Set(names)].map((name) => ({ label: name, value: name }))
})

const sinceOptions = [
  { label: '全部时间', value: 0 },
  { label: '最近 5 分钟', value: 300 },
  { label: '最近 15 分钟', value: 900 },
  { label: '最近 1 小时', value: 3600 },
]
const logsUnavailable = ref(false)
const loading = ref(false)
const error = ref('')
const hideManaged = ref(true)
const actionVisible = ref(false)
const action = ref<'restart' | 'scale' | 'delete'>('restart')
const confirmName = ref('')
const replicas = ref('1')

/* Manifest 编辑 / Dry run / Diff / Apply（P1） */
const editing = ref(false)
const draft = ref('')
const reviewVisible = ref(false)
const dryRunResult = ref<DryRunResult | null>(null)
const dryRunLoading = ref(false)
const applying = ref(false)
const applyError = ref('')

/* 终端（仅 Pod）：本地回显，不建立真实 exec 会话 */
const termLines = ref<string[]>([])

/* P2：Secret 明文读取（独立授权 + 审计） */
const revealVisible = ref(false)
const revealLoading = ref(false)
const revealResult = ref<SecretRevealResult | null>(null)
const revealError = ref('')
const revealedKeys = ref<string[]>([])

/* P2：终端会话（ticket → session） */
const session = ref<ExecSession | null>(null)
const sessionError = ref('')
const termInput = ref('')
const termRef = ref<HTMLElement | null>(null)

const isPod = computed(() => props.resource === 'pods')
const isSecret = computed(() => props.resource === 'secrets')
const kindLabel = computed(() => detail.value?.kind ?? props.resource)
/** 只有工作负载类才提供重启 / 扩缩容 */
const isWorkload = computed(() =>
  ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob'].includes(kindLabel.value),
)

const tabs = computed(() => {
  const list: Array<{ value: ResourceTabKey; label: string }> = [
    { value: 'manifest', label: 'Manifest' },
    { value: 'events', label: `事件（${events.value.length}）` },
  ]
  if (isPod.value) {
    list.push({ value: 'logs', label: '日志' })
    list.push({ value: 'terminal', label: '终端' })
  }
  return list
})

const eventColumns = [
  { colKey: 'type', title: '类型', width: 90 },
  { colKey: 'reason', title: '原因', width: 170 },
  { colKey: 'message', title: '消息', width: 380 },
  { colKey: 'count', title: '次数', width: 70 },
  { colKey: 'lastSeenAt', title: '最近发生', width: 110 },
]

const eventRows = computed(() =>
  events.value.map((event, index) => ({
    id: `${event.reason}-${index}`,
    type: event.type,
    reason: event.reason,
    message: event.message,
    count: event.count,
    lastSeenAt: event.lastSeenAt,
  })),
)

/** 对齐 Devtron 的 Hide Managed Fields：默认折叠托管字段与服务端生成字段 */
const visibleManifest = computed(() => {
  const raw = detail.value?.manifest ?? ''
  if (!hideManaged.value) return raw
  return raw
    .split('\n')
    .filter((line) => !/^\s{2}(managedFields|resourceVersion|uid|generation|creationTimestamp):/.test(line))
    .join('\n')
})

const actionTitle = computed(() => {
  if (action.value === 'delete') return '删除资源'
  if (action.value === 'scale') return '扩缩容'
  return '重启资源'
})

let liveTimer: number | undefined

/** mock 日志流：暂停时不再追加，便于对照排查 */
function startLive(): void {
  stopLive()
  liveTimer = window.setInterval(() => {
    if (logPaused.value || props.tab !== 'logs' || !isPod.value) return
    const stamp = new Date().toISOString()
    logs.value = [...logs.value, '[' + stamp + '] INFO  healthz /healthz 200'].slice(-2000)
  }, 5000)
}

function stopLive(): void {
  if (liveTimer) {
    window.clearInterval(liveTimer)
    liveTimer = undefined
  }
}

async function reloadLogs(): Promise<void> {
  if (!isPod.value || !detail.value) return
  logsLoading.value = true
  logsUnavailable.value = false
  try {
    logs.value = await getPodLogs(detail.value.ref.uid, {
      container: logContainer.value,
      sinceSeconds: logSince.value || undefined,
      tailLines: logTail.value,
      previous: logPrevious.value,
    })
    if (autoScroll.value) {
      await nextTick()
      if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight
    }
  } catch (err) {
    logs.value = []
    if (err instanceof MockError && err.code === 'not_found') {
      logsUnavailable.value = true
    } else {
      MessagePlugin.error(err instanceof Error ? err.message : '日志读取失败')
    }
  } finally {
    logsLoading.value = false
  }
}

async function load(): Promise<void> {
  if (session.value) void stopSession()
  loading.value = true
  error.value = ''
  logsUnavailable.value = false
  termLines.value = []
  editing.value = false
  draft.value = ''
  reviewVisible.value = false
  try {
    const found = await getResource(props.clusterId, props.group, props.resource, props.namespace, props.name)
    detail.value = found
    events.value = await listEvents(found.ref.uid)
    if (isPod.value) {
      const containers = [...(found.manifest ?? '').matchAll(/^\s*- name:\s*(\S+)/gm)].map((match) => match[1])
      logContainer.value = containers[0] ?? 'app'
      await reloadLogs()
      termLines.value = [`已连接到 ${props.name}（静态演示，不建立真实 exec 会话）`, '']
    } else {
      logs.value = []
    }
  } catch (err) {
    detail.value = null
    events.value = []
    logs.value = []
    error.value = err instanceof Error ? err.message : '资源详情加载失败'
  } finally {
    loading.value = false
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

async function startSession(): Promise<void> {
  if (!isPod.value || session.value) return
  sessionError.value = ''
  try {
    session.value = await createExecSession(props.clusterId, { namespace: props.namespace, pod: props.name })
    termLines.value = [
      `已连接 ${session.value.pod} / ${session.value.container}（会话 ${session.value.sessionId}，30 分钟过期）`,
      '输入 help 查看支持的命令；静态演示不执行真实命令。',
      '',
    ]
  } catch (err) {
    sessionError.value = err instanceof Error ? err.message : '终端会话创建失败'
  }
}

async function stopSession(): Promise<void> {
  const current = session.value
  session.value = null
  if (!current) return
  try {
    await closeExecSession(current.sessionId)
  } catch {
    /* 会话可能已过期，忽略 */
  }
}

function switchTab(value: ResourceTabKey): void {
  emit('update:tab', value)
  if (value === 'terminal') void startSession()
}

function pushTerminal(line: string): void {
  termLines.value.push(line)
  void nextTick(() => {
    if (termRef.value) termRef.value.scrollTop = termRef.value.scrollHeight
  })
}

function submitCommand(): void {
  const command = termInput.value.trim()
  if (!command) return
  pushTerminal(`$ ${command}`)
  termInput.value = ''
  const [head] = command.split(/\s+/)
  if (head === 'clear') {
    termLines.value = []
    return
  }
  if (head === 'help') {
    pushTerminal('支持命令：help、ls、pwd、whoami、clear（静态演示，不执行真实命令）')
    return
  }
  if (head === 'ls') {
    pushTerminal('bin   dev   etc   proc   sys   tmp   usr   var   app')
    return
  }
  if (head === 'pwd') {
    pushTerminal('/app')
    return
  }
  if (head === 'whoami') {
    pushTerminal('root')
    return
  }
  pushTerminal(`sh: ${head}: command not found`)
}

function startEdit(): void {
  if (!detail.value) return
  draft.value = detail.value.manifest
  editing.value = true
  applyError.value = ''
}

function cancelEdit(): void {
  editing.value = false
  draft.value = ''
  applyError.value = ''
  reviewVisible.value = false
}

async function openReview(): Promise<void> {
  if (!draft.value.trim()) {
    MessagePlugin.warning('Manifest 不能为空')
    return
  }
  dryRunLoading.value = true
  applyError.value = ''
  try {
    dryRunResult.value = await dryRunResource(props.clusterId, { namespace: props.namespace, manifest: draft.value })
    reviewVisible.value = true
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : 'Dry run 失败')
  } finally {
    dryRunLoading.value = false
  }
}

async function applyChanges(): Promise<void> {
  applying.value = true
  applyError.value = ''
  try {
    const result = await applyResource(props.clusterId, {
      manifest: draft.value,
      expectedUid: detail.value?.ref.uid,
    })
    if (result.status === 'succeeded') {
      reviewVisible.value = false
      editing.value = false
      MessagePlugin.success('Manifest 已应用（静态演示，写入本地 mock）')
      await load()
    } else {
      const failed = result.items.find((item) => item.result !== 'succeeded')
      applyError.value = failed?.message ?? '应用失败'
    }
  } catch (err) {
    applyError.value = err instanceof Error ? err.message : '应用失败'
  } finally {
    applying.value = false
  }
}

/** 行级 Diff：LCS 求最长公共子序列，够展示 before/after 变化 */
const diffLines = computed(() => {
  const before = (detail.value?.manifest ?? '').split('\n')
  const after = draft.value.split('\n')
  const n = before.length
  const m = after.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: Array<{ type: 'same' | 'add' | 'del'; text: string }> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ type: 'same', text: before[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: before[i] })
      i += 1
    } else {
      out.push({ type: 'add', text: after[j] })
      j += 1
    }
  }
  while (i < n) {
    out.push({ type: 'del', text: before[i] })
    i += 1
  }
  while (j < m) {
    out.push({ type: 'add', text: after[j] })
    j += 1
  }
  return out
})

function openAction(next: 'restart' | 'scale' | 'delete'): void {
  action.value = next
  confirmName.value = ''
  replicas.value = '1'
  actionVisible.value = true
}

function confirmAction(): void {
  if (action.value === 'delete' && confirmName.value.trim() !== props.name) {
    MessagePlugin.warning('请输入完整资源名称后再确认删除')
    return
  }
  if (action.value === 'scale' && !/^\d+$/.test(replicas.value.trim())) {
    MessagePlugin.warning('请输入有效的副本数')
    return
  }
  MessagePlugin.info(`静态演示：将调用 POST /clusters/${props.clusterId}/resource-actions`)
  actionVisible.value = false
}

async function copyManifest(): Promise<void> {
  if (!detail.value) return
  if (!navigator.clipboard) {
    MessagePlugin.warning('当前环境不支持自动复制，请手动选择文本')
    return
  }
  try {
    await navigator.clipboard.writeText(visibleManifest.value)
    MessagePlugin.success('Manifest 已复制')
  } catch {
    MessagePlugin.error('复制失败，请手动选择文本')
  }
}

function downloadLogs(): void {
  MessagePlugin.info('静态演示：将下载当前容器日志（GET /clusters/{id}/pod-logs?download=1）')
}

watch(
  () => [props.clusterId, props.group, props.resource, props.namespace, props.name],
  () => void load(),
  { immediate: true },
)

watch(
  () => props.tab,
  (value) => {
    if (value === 'terminal') void startSession()
  },
)

onMounted(startLive)

onBeforeUnmount(() => {
  stopLive()
  void stopSession()
})
</script>

<template>
  <div class="rpanel">
    <!-- 资源条：标识 + 全局操作 -->
    <div class="rpanel__bar">
      <div class="rpanel__ident">
        <span class="rpanel__kind">{{ kindLabel }}</span>
        <span class="rpanel__sep">/</span>
        <span class="rpanel__name">{{ name }}</span>
        <span class="rpanel__meta u-mono">{{ namespace }}</span>
        <span v-if="detail?.ref.uid" class="rpanel__meta u-mono">uid {{ detail.ref.uid }}</span>
      </div>
      <div class="rpanel__actions">
        <t-button v-if="isSecret" size="small" theme="warning" variant="outline" :loading="revealLoading" @click="openReveal">
          <template #icon><t-icon name="visible" /></template>
          查看明文
        </t-button>
        <t-button size="small" variant="text" :disabled="!detail" @click="copyManifest">
          <template #icon><t-icon name="copy" /></template>
          复制
        </t-button>
        <t-button v-if="isWorkload" size="small" variant="text" @click="openAction('restart')">
          <template #icon><t-icon name="refresh" /></template>
          重启
        </t-button>
        <t-button v-if="isWorkload" size="small" variant="text" @click="openAction('scale')">
          <template #icon><t-icon name="layers" /></template>
          扩缩容
        </t-button>
        <t-button size="small" variant="text" theme="danger" @click="openAction('delete')">
          <template #icon><t-icon name="delete" /></template>
          删除
        </t-button>
      </div>
    </div>

    <t-alert
      v-if="isSecret"
      theme="warning"
      message="Secret 默认只返回键名；点击「查看明文」会记录一条 secret.reveal 审计。"
      class="rpanel__alert"
    />

    <ErrorState v-if="error" :message="error" @retry="load" />

    <t-loading v-else :loading="loading">
      <div class="rpanel__tabsbar">
        <button
          v-for="item in tabs"
          :key="item.value"
          type="button"
          class="rpanel__tab"
          :class="{ 'rpanel__tab--active': tab === item.value }"
          @click="switchTab(item.value)"
        >
          {{ item.label }}
        </button>

        <span class="rpanel__tabs-tools">
          <template v-if="tab === 'manifest'">
            <label v-if="!editing" class="rpanel__check">
              <t-checkbox :checked="hideManaged" @change="(value: boolean) => (hideManaged = value)" />
              隐藏托管字段
            </label>
            <t-button v-if="!editing" size="small" variant="text" @click="startEdit">
              <template #icon><t-icon name="edit" /></template>
              编辑实时 Manifest
            </t-button>
            <template v-else>
              <t-button size="small" variant="text" @click="cancelEdit">取消</t-button>
              <t-button size="small" theme="primary" variant="outline" :loading="dryRunLoading" @click="openReview">
                <template #icon><t-icon name="check-circle" /></template>
                Dry run 并预览
              </t-button>
            </template>
          </template>
          <template v-if="tab === 'logs'">
            <t-select
              v-if="containerOptions.length > 1"
              v-model="logContainer"
              class="rpanel__log-select"
              size="small"
              :options="containerOptions"
              @change="reloadLogs"
            />
            <t-select
              v-model="logSince"
              class="rpanel__log-select"
              size="small"
              :options="sinceOptions"
              @change="reloadLogs"
            />
            <t-select v-model="logTail" class="rpanel__log-select" size="small" :options="logTailOptions" @change="reloadLogs" />
            <label class="rpanel__check">
              <t-checkbox v-model="logPrevious" @change="reloadLogs" />
              上一容器
            </label>
            <label class="rpanel__check">
              <t-checkbox v-model="autoScroll" />
              自动滚动
            </label>
            <t-button size="small" variant="text" @click="logPaused = !logPaused">
              {{ logPaused ? '继续' : '暂停' }}
            </t-button>
            <t-button size="small" variant="text" :loading="logsLoading" @click="reloadLogs">
              <template #icon><t-icon name="refresh" /></template>
              重新加载
            </t-button>
            <t-button size="small" variant="text" @click="downloadLogs">
              <template #icon><t-icon name="download" /></template>
              下载日志
            </t-button>
          </template>
        </span>
      </div>

      <div v-if="tab === 'manifest'" class="rpanel__body">
        <template v-if="editing">
          <div class="rpanel__code-head">
            <span class="u-mono u-muted">manifest.yaml（编辑中）</span>
            <span class="u-dim">保存前会先 Dry run，再确认应用</span>
          </div>
          <t-textarea v-model="draft" class="rpanel__editor" :autosize="{ minRows: 16, maxRows: 30 }" />
        </template>
        <pre v-else-if="detail" class="tk-code rpanel__code">{{ visibleManifest }}</pre>
        <EmptyState v-else title="没有可展示的 Manifest" compact icon="code" />
      </div>

      <div v-else-if="tab === 'events'" class="rpanel__body">
        <t-table row-key="id" :data="eventRows" :columns="eventColumns" size="small" hover>
          <template #type="{ row }">
            <t-tag :theme="row.type === 'Warning' ? 'danger' : 'success'" variant="light" size="small">{{ row.type }}</t-tag>
          </template>
          <template #reason="{ row }"><span class="u-mono">{{ row.reason }}</span></template>
          <template #message="{ row }"><span class="u-muted">{{ row.message }}</span></template>
          <template #count="{ row }">{{ row.count }}</template>
          <template #lastSeenAt="{ row }">{{ fmtRelative(row.lastSeenAt) }}</template>
          <template #empty>
            <EmptyState title="没有事件" description="该资源最近没有产生 Kubernetes 事件。" icon="history" compact />
          </template>
        </t-table>
      </div>

      <div v-else-if="tab === 'logs'" class="rpanel__body">
        <t-loading :loading="logsLoading">
          <div v-if="logs.length" ref="logRef" class="tk-code rpanel__code rpanel__logs">
            <p v-for="(line, index) in logs" :key="index" class="rpanel__log-line">{{ line }}</p>
          </div>
          <EmptyState
            v-else-if="logsUnavailable"
            title="该 Pod 没有容器日志"
            description="容器可能尚未启动，或日志已被轮转清理。"
            icon="file"
            compact
          />
          <EmptyState v-else title="暂无日志" description="当前时间窗口内没有日志，可放宽窗口后重试。" icon="file" compact />
        </t-loading>
        <p class="rpanel__hint">日志流为 mock：容器切换会加前缀、时间窗口按时间戳过滤；真实实现需 NDJSON 流 + 断线重连。</p>
      </div>

      <div v-else-if="tab === 'terminal'" class="rpanel__body">
        <div class="rpanel__session">
          <span v-if="session" class="u-mono">
            会话 {{ session.sessionId }} · {{ session.pod }} / {{ session.container }} · 过期 {{ fmtRelative(session.expiresAt) }}
          </span>
          <span v-else-if="sessionError" class="u-danger">{{ sessionError }}</span>
          <span v-else class="u-dim">正在建立终端会话…</span>
          <span class="rpanel__session-actions">
            <t-button v-if="session" size="small" variant="text" @click="stopSession">关闭会话</t-button>
            <t-button v-else size="small" variant="text" @click="startSession">重连</t-button>
          </span>
        </div>
        <div ref="termRef" class="tk-code rpanel__code rpanel__term">
          <p v-for="(line, index) in termLines" :key="index" class="rpanel__log-line">{{ line }}</p>
        </div>
        <div class="rpanel__term-input">
          <span class="u-mono">$</span>
          <t-input v-model="termInput" size="small" placeholder="输入命令（help 查看支持的命令）" @enter="submitCommand" />
        </div>
        <p class="rpanel__hint">会话由 mock 创建（EX-02），关闭时调用 EX-03；真实实现为一次性 ticket + WebSocket 通道。</p>
      </div>
    </t-loading>

    <t-dialog
      v-model:visible="reviewVisible"
      header="Review Manifest 变更"
      width="900px"
      :confirm-btn="applying ? '应用中…' : '应用'"
      :close-on-overlay-click="false"
      @confirm="applyChanges"
    >
      <t-alert v-if="applyError" theme="error" :message="applyError" class="rpanel__alert" />

      <div v-if="dryRunResult" class="rpanel__review">
        <p class="rpanel__review-title">Dry run 结果</p>
        <t-table
          row-key="index"
          size="small"
          :data="dryRunResult.documents"
          :columns="[
            { colKey: 'index', title: '#', width: 50 },
            { colKey: 'ref', title: '对象', width: 260 },
            { colKey: 'status', title: '结果', width: 100 },
            { colKey: 'message', title: '说明' },
          ]"
        >
          <template #ref="{ row }"><span class="u-mono">{{ row.ref }}</span></template>
          <template #status="{ row }">
            <t-tag :theme="row.status === 'valid' ? 'success' : 'danger'" variant="light" size="small">
              {{ row.status === 'valid' ? '通过' : '不通过' }}
            </t-tag>
          </template>
        </t-table>
      </div>

      <div class="rpanel__review">
        <p class="rpanel__review-title">Diff（当前 → 提交）</p>
        <div class="rpanel__diff">
          <p
            v-for="(line, index) in diffLines"
            :key="index"
            class="rpanel__diff-line"
            :class="`rpanel__diff-line--${line.type}`"
          >
            <span class="rpanel__diff-sign">{{ line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ' }}</span>
            {{ line.text }}
          </p>
        </div>
      </div>

      <p class="rpanel__hint">应用为静态演示：会写入本地 mock，不会真正调用 Kubernetes API。</p>
    </t-dialog>

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

    <t-dialog
      v-model:visible="actionVisible"
      :header="actionTitle"
      :theme="action === 'delete' ? 'danger' : 'default'"
      width="440px"
      :confirm-btn="action === 'delete' ? '确认删除' : '确认'"
      @confirm="confirmAction"
    >
      <template v-if="action === 'delete'">
        <p class="rpanel__dialog-text">
          删除后不可恢复。请输入资源名称 <span class="u-mono">{{ name }}</span> 以确认。
        </p>
        <t-input v-model="confirmName" placeholder="输入资源名称" />
      </template>
      <template v-else-if="action === 'scale'">
        <p class="rpanel__dialog-text">设置新的副本数（静态演示，不会真正扩缩容）。</p>
        <t-input v-model="replicas" placeholder="例如 3" />
      </template>
      <p v-else class="rpanel__dialog-text">将滚动重启 {{ name }} 关联的 Pod，静态演示不会真正下发。</p>
    </t-dialog>
  </div>
</template>

<style scoped>
.rpanel {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.rpanel__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 44px;
  padding: 0 12px;
  border-bottom: 1px solid var(--tk-border);
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
.rpanel__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.rpanel__alert {
  margin: 8px 12px 0;
}
.rpanel__tabsbar {
  display: flex;
  align-items: center;
  gap: 18px;
  height: 40px;
  padding: 0 12px;
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
.rpanel__dialog-text {
  margin: 0 0 8px;
  color: var(--tk-text-2);
}
.rpanel__code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.rpanel__editor {
  font-family: var(--tk-mono);
}
.rpanel__review + .rpanel__review {
  margin-top: 14px;
}
.rpanel__review-title {
  margin: 0 0 6px;
  color: var(--tk-text-2);
  font-weight: 600;
}
.rpanel__diff {
  max-height: 300px;
  padding: 8px 10px;
  overflow: auto;
  font-family: var(--tk-mono);
  font-size: 11px;
  line-height: 17px;
  background: #f7f9fc;
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.rpanel__diff-line {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
.rpanel__diff-sign {
  display: inline-block;
  width: 12px;
  color: var(--tk-text-3);
}
.rpanel__diff-line--add {
  color: #1f8f5f;
  background: #e8f8f0;
}
.rpanel__diff-line--del {
  color: #c33028;
  background: #fdeceb;
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
