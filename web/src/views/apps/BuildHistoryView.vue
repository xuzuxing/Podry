<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { useRoute } from 'vue-router'

import { cancelBuild, getBuild, getBuildLogs, listArtifacts, listBuilds, MockError, retryBuild } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import StatusTag from '@/components/StatusTag.vue'
import type { Artifact, Build } from '@/types'
import { fmtDuration, fmtRelative, fmtTime, logAvailabilityMap, shortDigest, shortSha } from '@/utils/format'

const route = useRoute()
const appId = computed(() => String(route.params.appId ?? ''))
const baseParams = computed(() => ({ projectId: String(route.params.projectId ?? ''), appId: appId.value }))

const builds = ref<Build[]>([])
const listLoading = ref(true)
const listError = ref('')
const artifacts = ref<Artifact[]>([])

const selectedId = ref('')
const detail = ref<Build | null>(null)
const detailLoading = ref(false)
const detailError = ref('')

const logs = ref<string[]>([])
const logsLoading = ref(false)
const logsError = ref('')
const logsUnavailable = ref(false)

const acting = ref(false)

const canCancel = computed(() => detail.value?.status === 'running' || detail.value?.status === 'queued')
const logsText = computed(() => logs.value.join('\n'))
const logNote = computed(() => {
  const current = detail.value
  if (!current) return '日志不可用，构建结果以产物为准。'
  const entry = logAvailabilityMap[current.logAvailability]
  return `${entry.label}：无法读取本次构建日志，构建结果仍以产物镜像 digest 为准。`
})
const artifact = computed<Artifact | null>(() => {
  const artifactId = detail.value?.artifactId
  if (!artifactId) return null
  return artifacts.value.find((item) => item.id === artifactId) ?? null
})

function errorTextOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

async function loadList(): Promise<void> {
  listLoading.value = true
  listError.value = ''
  try {
    const result = await listBuilds(appId.value)
    builds.value = result.items
    if (selectedId.value && !builds.value.some((item) => item.id === selectedId.value)) {
      selectedId.value = ''
      detail.value = null
    }
    // 首次进入自动选中最新一条，避免右侧空白
    if (!selectedId.value && builds.value.length) {
      await selectBuild(builds.value[0].id)
    }
  } catch (err) {
    listError.value = errorTextOf(err, '构建列表加载失败')
  } finally {
    listLoading.value = false
  }
}

async function loadArtifacts(): Promise<void> {
  try {
    artifacts.value = await listArtifacts(appId.value)
  } catch {
    artifacts.value = []
  }
}

async function loadLogs(id: string): Promise<void> {
  logsLoading.value = true
  logsError.value = ''
  logsUnavailable.value = false
  logs.value = []
  try {
    logs.value = await getBuildLogs(id)
  } catch (err) {
    if (err instanceof MockError && err.code === 'log_unavailable') {
      logsUnavailable.value = true
    } else {
      logsError.value = errorTextOf(err, '日志加载失败')
    }
  } finally {
    logsLoading.value = false
  }
}

let detailToken = 0

async function selectBuild(id: string): Promise<void> {
  const token = ++detailToken
  selectedId.value = id
  detailLoading.value = true
  detailError.value = ''
  detail.value = null
  logs.value = []
  logsError.value = ''
  logsUnavailable.value = false
  try {
    const build = await getBuild(id)
    if (token !== detailToken) return
    detail.value = build
    await loadLogs(id)
  } catch (err) {
    if (token !== detailToken) return
    detailError.value = errorTextOf(err, '构建详情加载失败')
  } finally {
    if (token === detailToken) detailLoading.value = false
  }
}

async function refresh(): Promise<void> {
  await loadList()
  if (selectedId.value) await selectBuild(selectedId.value)
}

async function onCancel(): Promise<void> {
  const current = detail.value
  if (!current || !canCancel.value || acting.value) return
  acting.value = true
  try {
    await cancelBuild(current.id)
    MessagePlugin.success('已请求取消构建')
    await refresh()
  } catch (err) {
    MessagePlugin.error(errorTextOf(err, '取消失败'))
  } finally {
    acting.value = false
  }
}

async function onRetry(): Promise<void> {
  const current = detail.value
  if (!current || acting.value) return
  acting.value = true
  try {
    const created = await retryBuild(current.id)
    MessagePlugin.success(`已创建重试构建 #${created.id}`)
    await loadList()
    await selectBuild(created.id)
  } catch (err) {
    MessagePlugin.error(errorTextOf(err, '重试失败'))
  } finally {
    acting.value = false
  }
}

function downloadLogs(): void {
  MessagePlugin.info('静态演示：日志下载未接入对象存储')
}

async function loadAll(): Promise<void> {
  await Promise.all([loadList(), loadArtifacts()])
}

watch(
  appId,
  () => {
    selectedId.value = ''
    detail.value = null
    void loadAll()
  },
  { immediate: true },
)
</script>

<template>
  <div class="history">
    <section class="tk-panel history__list">
      <div class="tk-panel__head">
        <span>
          构建记录
          <span class="u-dim">（{{ builds.length }}）</span>
        </span>
        <t-button size="small" variant="text" :loading="listLoading" @click="refresh">
          <template #icon><t-icon name="refresh" /></template>
          刷新
        </t-button>
      </div>
      <div class="history__scroll">
        <div v-if="listLoading && !builds.length" class="history__state">
          <t-loading size="small" />
          <span class="u-muted">加载构建列表…</span>
        </div>
        <ErrorState v-else-if="listError" :message="listError" @retry="refresh" />
        <EmptyState
          v-else-if="!builds.length"
          title="还没有构建记录"
          description="在构建发布页选择提交后触发第一次构建。"
          compact
        />
        <ul v-else class="build-list">
          <li v-for="item in builds" :key="item.id">
            <button
              type="button"
              class="build-item"
              :class="{ 'build-item--active': item.id === selectedId }"
              @click="selectBuild(item.id)"
            >
              <span class="build-item__top">
                <StatusTag kind="build" :value="item.status" />
                <span class="u-mono u-dim">#{{ item.id }}</span>
                <span class="build-item__sha u-mono u-dim">{{ shortSha(item.commitSha) }}</span>
              </span>
              <span class="build-item__subject u-ellipsis">{{ item.commitSubject || '—' }}</span>
              <span class="build-item__meta u-dim">
                {{ fmtRelative(item.createdAt) }} · 配置 v{{ item.configVersion }} · 第 {{ item.attemptNo }} 次
              </span>
            </button>
          </li>
        </ul>
      </div>
    </section>

    <section class="tk-panel history__detail">
      <div v-if="!selectedId" class="history__state history__state--tall">
        <EmptyState title="选择左侧构建查看详情" description="详情包含执行时间线、构建日志与产物信息。" />
      </div>
      <div v-else-if="detailLoading && !detail" class="history__state history__state--tall">
        <t-loading size="small" />
        <span class="u-muted">加载构建详情…</span>
      </div>
      <ErrorState v-else-if="detailError" :message="detailError" @retry="selectBuild(selectedId)" />
      <template v-else-if="detail">
        <div class="build-head">
          <div class="build-head__main">
            <div class="u-flex u-gap-8">
              <h2 class="build-head__id">#{{ detail.id }}</h2>
              <StatusTag kind="build" :value="detail.status" />
              <span class="u-mono u-dim">{{ shortSha(detail.commitSha) }}</span>
              <span class="build-head__subject u-dim u-ellipsis">{{ detail.commitSubject || '—' }}</span>
            </div>
            <p class="build-head__meta u-dim">
              配置版本 v{{ detail.configVersion }} · 第 {{ detail.attemptNo }} 次尝试 · Job
              <span class="u-mono">{{ detail.jobName }}</span>
            </p>
          </div>
          <div class="build-head__actions">
            <t-button size="small" variant="outline" :disabled="!canCancel" :loading="acting" @click="onCancel">
              <template #icon><t-icon name="stop-circle" /></template>
              取消
            </t-button>
            <t-button size="small" variant="outline" :loading="acting" @click="onRetry">
              <template #icon><t-icon name="rollback" /></template>
              重试
            </t-button>
          </div>
        </div>

        <div class="timeline">
          <div class="timeline__cell">
            <p class="timeline__label">触发</p>
            <p class="timeline__value">{{ fmtTime(detail.createdAt) }}</p>
            <p class="timeline__note u-dim">{{ fmtRelative(detail.createdAt) }}</p>
          </div>
          <div class="timeline__cell">
            <p class="timeline__label">执行</p>
            <p class="timeline__value">{{ fmtDuration(detail.createdAt, detail.finishedAt) }}</p>
            <p class="timeline__note u-dim">
              {{ detail.finishedAt ? `结束于 ${fmtTime(detail.finishedAt)}` : '尚未结束' }}
            </p>
          </div>
          <div class="timeline__cell">
            <p class="timeline__label">结果</p>
            <div class="timeline__value">
              <StatusTag kind="build" :value="detail.status" />
            </div>
            <p class="timeline__note u-dim">
              {{ detail.errorCode ? detail.errorCode : '—' }}
            </p>
          </div>
        </div>

        <div class="build-block">
          <div class="build-block__head">
            <div class="u-flex u-gap-8">
              <span class="build-block__title">构建日志</span>
              <StatusTag kind="log" :value="detail.logAvailability" />
            </div>
            <t-button size="small" variant="outline" @click="downloadLogs">
              <template #icon><t-icon name="download" /></template>
              下载
            </t-button>
          </div>
          <div v-if="logsLoading" class="history__state">
            <t-loading size="small" />
            <span class="u-muted">读取日志…</span>
          </div>
          <t-alert v-else-if="logsUnavailable" theme="info" :message="logNote" />
          <ErrorState v-else-if="logsError" :message="logsError" @retry="loadLogs(detail.id)" />
          <EmptyState v-else-if="!logs.length" title="暂无日志" compact />
          <pre v-else class="tk-code build-log">{{ logsText }}</pre>
        </div>

        <div v-if="detail.artifactId" class="build-block">
          <div class="build-block__head">
            <span class="build-block__title">产物</span>
            <router-link :to="{ name: 'app-deployments', params: baseParams }">查看发布历史</router-link>
          </div>
          <div v-if="artifact" class="artifact-info">
            <p class="artifact-info__ref u-mono">{{ artifact.imageRef }}</p>
            <p class="u-dim">
              {{ shortDigest(artifact.digest) }} · 产出时间 {{ fmtTime(artifact.createdAt) }}
            </p>
          </div>
          <p v-else class="u-muted">
            产物 <span class="u-mono">{{ detail.artifactId }}</span> 不在当前镜像列表中，请到发布历史核对。
          </p>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.history {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 12px;
  align-items: start;
}
.history__list {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.history__scroll {
  max-height: 640px;
  overflow: auto;
}
.history__state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 28px 12px;
}
.history__state--tall {
  min-height: 260px;
}
.history__detail {
  min-width: 0;
  min-height: 320px;
}
.build-list {
  display: flex;
  flex-direction: column;
}
.build-list > li + li {
  border-top: 1px solid var(--tk-border);
}
.build-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 8px 10px;
  font: inherit;
  color: var(--tk-text);
  text-align: left;
  background: none;
  border: 0;
  border-left: 2px solid transparent;
  cursor: pointer;
}
.build-item:hover {
  background: var(--tk-bg);
}
.build-item--active {
  background: var(--tk-primary-weak);
  border-left-color: var(--tk-primary);
}
.build-item__top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.build-item__sha {
  margin-left: auto;
}
.build-item__subject {
  max-width: 100%;
  color: var(--tk-text-2);
}
.build-item__meta {
  font-size: 11px;
}
.build-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid var(--tk-border);
}
.build-head__main {
  min-width: 0;
}
.build-head__id {
  font-size: 15px;
  line-height: 20px;
}
.build-head__subject {
  max-width: 260px;
}
.build-head__meta {
  margin: 4px 0 0;
}
.build-head__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.timeline {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--tk-border);
}
.timeline__cell {
  padding: 8px 10px;
  background: var(--tk-bg);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.timeline__label {
  margin: 0;
  color: var(--tk-text-2);
}
.timeline__value {
  margin: 2px 0;
  font-weight: 600;
}
.timeline__note {
  margin: 0;
  font-size: 11px;
}
.build-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}
.build-block + .build-block {
  border-top: 1px solid var(--tk-border);
}
.build-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.build-block__title {
  font-weight: 600;
}
.build-log {
  max-height: 420px;
}
.artifact-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.artifact-info__ref {
  margin: 0;
  word-break: break-all;
}
</style>
