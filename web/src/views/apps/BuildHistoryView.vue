<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { useRoute } from 'vue-router'

import {
  cancelBuild,
  getBuild,
  getBuildLogs,
  getConfig,
  getWorkflow,
  listArtifacts,
  listBuilds,
  listCommits,
  MockError,
  retryBuild,
} from '@/api'
import ErrorState from '@/components/ErrorState.vue'
import { useSessionStore } from '@/stores/session'
import type { AppConfig, Artifact, Build, BuildStatus, GitCommit } from '@/types'
import { fmtTime, logAvailabilityMap } from '@/utils/format'

import BuildStatusIcon from './components/buildHistory/BuildStatusIcon.vue'
import { ciDisplayName } from './components/pipeline/naming'

type TabKey = 'logs' | 'source' | 'artifacts'

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'logs', label: '日志' },
  { key: 'source', label: '源码' },
  { key: 'artifacts', label: '产物' },
]

const route = useRoute()
const session = useSessionStore()
const appId = computed(() => String(route.params.appId ?? ''))

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

const activeTab = ref<TabKey>('logs')
const acting = ref(false)

const config = ref<AppConfig | null>(null)
const commits = ref<GitCommit[]>([])
const ciPipelineId = ref('')

const operatorName = computed(() => session.user?.name || '张运维')
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

const pipelineName = computed(() => ciDisplayName(appId.value, ciPipelineId.value || appId.value))
const pipelineOptions = computed(() => [{ label: pipelineName.value, value: pipelineName.value }])

const commitInfo = computed<GitCommit | null>(() => {
  const sha = detail.value?.commitSha
  if (!sha) return null
  return commits.value.find((item) => item.sha === sha) ?? null
})
const commitChip = computed(() => detail.value?.commitSha.slice(0, 7) ?? '')
const commitAuthor = computed(() => commitInfo.value?.authorName ?? operatorName.value)
const commitTime = computed(() => commitInfo.value?.committedAt ?? detail.value?.createdAt ?? '')

const repoName = computed(() => {
  const url = config.value?.gitConfig?.repositoryUrl ?? ''
  return url.replace(/\.git$/, '').replace(/[/:]+$/, '').split(/[/:]/).filter(Boolean).pop() ?? '—'
})
const branchName = computed(() => config.value?.gitConfig?.branch ?? '—')

const imageTag = computed(() => {
  const imageRef = artifact.value?.imageRef ?? ''
  const tagAt = imageRef.lastIndexOf(':')
  return tagAt > imageRef.lastIndexOf('/') ? imageRef.slice(tagAt + 1) : ''
})

const runTitle = computed(() => {
  switch (detail.value?.status) {
    case 'succeeded':
      return '执行成功'
    case 'failed':
      return '执行失败'
    case 'canceled':
      return '执行已中止'
    case 'canceling':
      return '正在取消'
    case 'unknown':
      return '执行结果待核对'
    default:
      return '正在执行'
  }
})
const runIconStatus = computed<BuildStatus>(() => {
  const status = detail.value?.status
  if (!status) return 'unknown'
  if (status === 'queued' || status === 'canceling') return 'running'
  return status
})
const runTime = computed(() => {
  const build = detail.value
  if (!build) return ''
  if (build.status === 'succeeded' || build.status === 'failed' || build.status === 'canceled') {
    return build.finishedAt ? fmtBuildTime(build.finishedAt) : ''
  }
  return ''
})
const workerLabel = computed(() => {
  switch (detail.value?.status) {
    case 'succeeded':
      return '成功'
    case 'failed':
      return '失败'
    case 'canceled':
      return '已取消'
    case 'canceling':
      return '取消中'
    case 'unknown':
      return '待核对'
    default:
      return '执行中'
  }
})
const workerDetail = computed(() => {
  const build = detail.value
  if (!build) return ''
  if (build.status === 'failed') {
    return build.errorCode ? `workflow terminated: ${build.errorCode}` : 'workflow terminated'
  }
  if (build.status === 'unknown') return '等待构建控制器回报结果'
  return ''
})
const showImageTag = computed(() => detail.value?.status === 'succeeded' && Boolean(imageTag.value))
const artifactEmptyNote = computed(() => {
  const build = detail.value
  if (!build) return ''
  if (build.artifactId) return `产物 ${build.artifactId} 不在当前镜像列表中，请到发布历史核对。`
  return '本次构建没有产出镜像产物，构建成功后会自动显示在这里。'
})

/** 本地化时间：2026-11-21 14:41 */
function fmtBuildTime(iso: string | null | undefined): string {
  return fmtTime(iso)
}

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

let metaToken = 0

async function loadMeta(): Promise<void> {
  const token = ++metaToken
  try {
    const [configItem, workflow] = await Promise.all([getConfig(appId.value), getWorkflow(appId.value)])
    if (token !== metaToken) return
    config.value = configItem
    ciPipelineId.value = workflow.items.find((item) => item.kind === 'ci')?.id ?? ''
    if (!configItem.gitConfig) {
      commits.value = []
      return
    }
    try {
      const list = await listCommits(configItem.gitConfig.branch)
      if (token === metaToken) commits.value = list
    } catch {
      if (token === metaToken) commits.value = []
    }
  } catch {
    if (token !== metaToken) return
    config.value = null
    commits.value = []
  }
}

async function loadLogs(id: string): Promise<void> {
  logsLoading.value = true
  logsError.value = ''
  logsUnavailable.value = false
  logs.value = []
  try {
    const result = await getBuildLogs(id)
    if (selectedId.value !== id) return
    logs.value = result
  } catch (err) {
    if (selectedId.value !== id) return
    if (err instanceof MockError && err.code === 'log_unavailable') {
      logsUnavailable.value = true
    } else {
      logsError.value = errorTextOf(err, '日志加载失败')
    }
  } finally {
    if (selectedId.value === id) logsLoading.value = false
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
    // 成功的构建优先展示产物，进行中/失败构建优先展示日志
    activeTab.value = build.artifactId ? 'artifacts' : 'logs'
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

function retryLogs(): void {
  const current = detail.value
  if (current) void loadLogs(current.id)
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

function onAddLabel(): void {
  MessagePlugin.info('静态演示：标签与备注尚未接入')
}

async function loadAll(): Promise<void> {
  await Promise.all([loadList(), loadArtifacts(), loadMeta()])
}

watch(
  appId,
  () => {
    selectedId.value = ''
    detail.value = null
    activeTab.value = 'logs'
    config.value = null
    commits.value = []
    ciPipelineId.value = ''
    void loadAll()
  },
  { immediate: true },
)
</script>

<template>
  <div class="bh">
    <aside class="bh-side">
      <div class="bh-side__head">
        <p class="bh-side__label">选择流水线</p>
        <t-select class="bh-pipeline" :model-value="pipelineName" :options="pipelineOptions" />
      </div>

      <div class="bh-side__list">
        <div v-if="listLoading && !builds.length" class="bh-side__state">
          <t-loading size="small" />
        </div>
        <ErrorState v-else-if="listError" :message="listError" @retry="refresh" />
        <ul v-else-if="builds.length" class="bh-builds">
          <li v-for="item in builds" :key="item.id">
            <button
              type="button"
              class="bh-build"
              :class="{ 'bh-build--active': item.id === selectedId }"
              @click="selectBuild(item.id)"
            >
              <BuildStatusIcon :status="item.status" :size="14" class="bh-build__icon" />
              <span class="bh-build__body">
                <span class="bh-build__time">{{ fmtBuildTime(item.createdAt) }}</span>
                <span class="bh-build__user">{{ operatorName }}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </aside>

    <section class="bh-detail">
      <div v-if="listLoading && !builds.length" class="bh-state">
        <t-loading size="small" />
        <span>加载构建列表…</span>
      </div>
      <div v-else-if="listError && !builds.length" class="bh-state bh-state--empty">
        <p class="bh-empty__title">构建列表加载失败</p>
        <p class="bh-empty__desc">请在左侧重试，或稍后重新打开本页。</p>
      </div>
      <div v-else-if="!builds.length" class="bh-state bh-state--empty">
        <p class="bh-empty__title">还没有构建记录</p>
        <p class="bh-empty__desc">在「构建发布」页选择提交后触发第一次构建，构建结果会显示在这里。</p>
      </div>
      <div v-else-if="!selectedId" class="bh-state">
        <p class="bh-empty__title">选择左侧构建查看详情</p>
        <p class="bh-empty__desc">详情包含执行时间线、构建日志与产物信息。</p>
      </div>
      <div v-else-if="detailLoading && !detail" class="bh-state">
        <t-loading size="small" />
        <span>加载构建详情…</span>
      </div>
      <ErrorState v-else-if="detailError" :message="detailError" @retry="selectBuild(selectedId)" />

      <template v-else-if="detail">
        <div class="bh-timeline">
          <div class="bh-actions">
            <t-button size="small" variant="outline" :disabled="!canCancel" :loading="acting" @click="onCancel">
              <template #icon><t-icon name="stop-circle" /></template>
              取消
            </t-button>
            <t-button size="small" variant="outline" :loading="acting" @click="onRetry">
              <template #icon><t-icon name="rollback" /></template>
              重试
            </t-button>
          </div>

          <div class="bh-tl">
            <div class="bh-tl__row">
              <div class="bh-tl__gutter">
                <BuildStatusIcon status="succeeded" :size="14" />
                <span class="bh-tl__line" />
              </div>
              <div class="bh-tl__body">
                <p class="bh-tl__line-row">
                  <span class="bh-tl__title">触发</span>
                  <span class="bh-tl__time">{{ fmtBuildTime(detail.createdAt) }}</span>
                  <span class="bh-tl__dot">•</span>
                  <span class="bh-tl__user">{{ operatorName }}</span>
                  <span v-if="commitChip" class="bh-chip bh-chip--commit">
                    <svg class="bh-chip__icon" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <circle cx="8" cy="8" r="2.2" stroke="#0066cc" stroke-width="1.3" />
                      <path d="M1.6 8h4.1m4.6 0h4.1" stroke="#0066cc" stroke-width="1.3" stroke-linecap="round" />
                    </svg>
                    {{ commitChip }}
                  </span>
                  <button
                    v-if="activeTab !== 'source'"
                    type="button"
                    class="bh-link"
                    @click="activeTab = 'source'"
                  >
                    提交详情
                  </button>                </p>
              </div>
            </div>

            <div class="bh-tl__row">
              <div class="bh-tl__gutter">
                <BuildStatusIcon status="succeeded" :size="14" />
                <span class="bh-tl__line" />
              </div>
              <div class="bh-tl__body">
                <p class="bh-tl__line-row">
                  <span class="bh-tl__title">开始执行</span>
                  <span class="bh-tl__time">{{ fmtBuildTime(detail.createdAt) }}</span>
                </p>
              </div>
            </div>

            <div class="bh-tl__row">
              <div class="bh-tl__gutter">
                <BuildStatusIcon :status="runIconStatus" :size="14" />
                <span class="bh-tl__line" />
              </div>
              <div class="bh-tl__body">
                <p class="bh-tl__line-row">
                  <span class="bh-tl__title">{{ runTitle }}</span>
                  <span v-if="runTime" class="bh-tl__time">{{ runTime }}</span>
                  <template v-if="showImageTag">
                    <span class="bh-tl__dot">•</span>
                    <span class="bh-chip bh-chip--image">
                      <svg class="bh-chip__icon" width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          fill="#1d99e6"
                          d="M1 7h2v2H1zM3.4 7h2v2h-2zM5.8 7h2v2h-2zM3.4 4.6h2v2h-2zM5.8 4.6h2v2h-2zM8.2 7h2v2h-2z"
                        />
                        <path
                          fill="#1d99e6"
                          d="M15 7.6c-.5-.4-1.2-.4-1.7-.2-.1-.6-.4-1.1-.9-1.5l-.2-.1-.2.3c-.3.5-.4 1.1-.2 1.7.1.3.3.6.5.7-.3.1-.7.2-1.1.2H1l-.1.4c-.1.8.1 1.6.6 2.3.5.7 1.4 1.1 2.5 1.1 2.4 0 4.2-1.1 5.1-3.1.5 0 1.1 0 1.5-.5l.1-.2-.2-.3c-.3-.2-.9-.2-1.3 0Z"
                        />
                      </svg>
                      {{ imageTag }}
                    </span>
                  </template>
                </p>
              </div>
            </div>

            <div class="bh-tl__row">
              <div class="bh-tl__gutter">
                <svg class="bh-tl__list" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M2.5 4h11M2.5 8h11M2.5 12h11"
                    stroke="#3b444c"
                    stroke-width="1.4"
                    stroke-linecap="round"
                  />
                </svg>
              </div>
              <div class="bh-tl__body">
                <p class="bh-tl__line-row">
                  <span class="bh-tl__worker">执行器: {{ workerLabel }}</span>
                </p>
                <p v-if="workerDetail" class="bh-tl__error">{{ workerDetail }}</p>
              </div>
            </div>
          </div>
        </div>

        <nav class="bh-tabs" role="tablist">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            role="tab"
            class="bh-tab"
            :class="{ 'bh-tab--active': activeTab === tab.key }"
            :aria-selected="activeTab === tab.key"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
          <button
            v-if="activeTab === 'logs'"
            type="button"
            class="bh-tabs__download"
            title="下载日志"
            @click="downloadLogs"
          >
            <t-icon name="download" size="13px" />
            下载
          </button>
        </nav>

        <div class="bh-content" :class="{ 'bh-content--logs': activeTab === 'logs' }">
          <template v-if="activeTab === 'logs'">
            <div v-if="logsLoading" class="bh-content__state">
              <t-loading size="small" />
              <span>读取日志…</span>
            </div>
            <div v-else-if="logsUnavailable" class="bh-unavailable">
              <span class="bh-unavailable__info">i</span>
              <p class="bh-unavailable__title">日志不可用</p>
              <p class="bh-unavailable__note">{{ logNote }}</p>
            </div>
            <ErrorState v-else-if="logsError" :message="logsError" @retry="retryLogs" />
            <div v-else-if="!logs.length" class="bh-content__state">暂无日志</div>
            <pre v-else class="bh-log">{{ logsText }}</pre>
          </template>

          <template v-else-if="activeTab === 'source'">
            <article class="bh-source">
              <header class="bh-source__repo">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M8 1.8v12.4M8 4.4 5.2 6.2M8 8.6l-2.8 1.7"
                    stroke="#596168"
                    stroke-width="1.2"
                    stroke-linecap="round"
                  />
                  <circle cx="8" cy="2.4" r="1.4" stroke="#596168" stroke-width="1.2" />
                  <circle cx="5" cy="7" r="1.5" stroke="#596168" stroke-width="1.2" />
                  <circle cx="5.2" cy="11" r="1.5" stroke="#596168" stroke-width="1.2" />
                </svg>
                <span class="bh-source__name" :title="config?.gitConfig?.repositoryUrl">{{ repoName }}</span>
                <span class="bh-source__sep">/</span>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M4.25 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0v3.25m0-3.25h5.5a2 2 0 0 0 2-2V6.25m0 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"
                    stroke="#596168"
                    stroke-width="1.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span class="bh-source__branch">{{ branchName }}</span>
              </header>
              <div class="bh-source__commit">
                <span v-if="commitChip" class="bh-chip bh-chip--commit">
                  <svg class="bh-chip__icon" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <circle cx="8" cy="8" r="2.2" stroke="#0066cc" stroke-width="1.3" />
                    <path d="M1.6 8h4.1m4.6 0h4.1" stroke="#0066cc" stroke-width="1.3" stroke-linecap="round" />
                  </svg>
                  {{ commitChip }}
                </span>
                <p class="bh-source__subject">{{ detail.commitSubject || '—' }}</p>
                <p class="bh-source__meta">
                  <t-icon name="user" size="13px" />
                  {{ commitAuthor }}
                </p>
                <p class="bh-source__meta">
                  <t-icon name="calendar" size="13px" />
                  {{ fmtBuildTime(commitTime) }}
                </p>
                <p v-if="!config?.gitConfig" class="bh-source__missing">尚未配置 Git 源，无法展示仓库信息。</p>
              </div>
            </article>
          </template>

          <template v-else>
            <article v-if="artifact" class="bh-artifact">
              <div class="bh-artifact__main">
                <span class="bh-artifact__icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M12 2.8 20 7v10l-8 4.2L4 17V7l8-4.2Z"
                      stroke="#0066cc"
                      stroke-width="1.4"
                      stroke-linejoin="round"
                    />
                    <path
                      d="m4 7 8 4.2L20 7M12 11.2V21"
                      stroke="#0066cc"
                      stroke-width="1.4"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>
                <div class="bh-artifact__text">
                  <p class="bh-artifact__tag">{{ imageTag || artifact.id }}</p>
                  <p class="bh-artifact__ref">{{ artifact.imageRef }}</p>
                </div>
              </div>
              <button type="button" class="bh-artifact__label" @click="onAddLabel">
                <span class="bh-artifact__plus">+</span>
                添加标签/备注
              </button>
            </article>
            <div v-else class="bh-content__empty">
              <p class="bh-empty__title">暂无产物</p>
              <p class="bh-empty__desc">{{ artifactEmptyNote }}</p>
            </div>
          </template>
        </div>

        <div class="bh-pill">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6.4" fill="#664bee" />
            <path d="M8 7.1v3.2M8 5.1v.9" stroke="#fff" stroke-width="1.3" stroke-linecap="round" />
          </svg>
          <span class="bh-pill__lead">需要保存构建文件？</span>
          <span class="bh-pill__link">
            配置对象存储
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M9.5 2.5h4v4M13.5 2.5 7.8 8.2M12.2 9.4v3.1a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1h3.1"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
/* 整页白底、无外层卡片：抵消 AppWorkspace/AppShell 的内边距，铺满视口剩余高度 */
.bh {
  display: flex;
  height: calc(100vh - 130px);
  min-height: 560px;
  margin: -12px -16px -48px;
  color: #000a14;
  font-size: 13px;
  background: #fff;
}

/* ---- 左列：Select Pipeline + 构建列表 ---- */
.bh-side {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 296px;
  min-height: 0;
  background: #fff;
  border-right: 1px solid #e6e9ef;
}

.bh-side__head {
  flex: none;
  padding: 12px 16px 16px;
  border-bottom: 1px solid #e6e9ef;
}

.bh-side__label {
  margin: 0 0 8px;
  color: #596168;
  font-size: 12px;
  line-height: 18px;
}

.bh-pipeline {
  width: 100%;
}

.bh-pipeline :deep(.t-input) {
  height: 36px;
  padding: 0 12px;
  color: #000a14;
  border-color: #d0d4d9;
  border-radius: 4px;
}

.bh-pipeline :deep(.t-input:hover) {
  border-color: #a6adb5;
}

.bh-pipeline :deep(.t-input__inner) {
  color: #000a14;
  font-size: 13px;
}

.bh-side__list {
  flex: 1;
  min-height: 0;
  padding: 8px 0;
  overflow: auto;
}

.bh-side__state {
  display: flex;
  justify-content: center;
  padding: 24px 12px;
}

.bh-builds {
  display: flex;
  flex-direction: column;
}

.bh-build {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  min-height: 56px;
  padding: 8px 16px;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  background: none;
  border: 0;
}

.bh-build:hover {
  background: #f7fafc;
}

.bh-build--active {
  background: #f0f7ff;
}

.bh-build__icon {
  margin-top: 2px;
}

.bh-build__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.bh-build__time {
  color: #000a14;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}

.bh-build__user {
  color: #596168;
  font-size: 12px;
  line-height: 18px;
}

/* ---- 右列：时间线 + 页签 + 内容 ---- */
.bh-detail {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #fff;
}

.bh-state {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  color: #596168;
  font-size: 13px;
}

.bh-state--empty {
  background: #fff;
}

.bh-empty__title {
  margin: 0;
  color: #000a14;
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
  text-align: center;
}

.bh-empty__desc {
  max-width: 440px;
  margin: 0;
  color: #596168;
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}

/* 时间线 */
.bh-timeline {
  position: relative;
  flex: none;
  padding: 16px 20px;
}

.bh-actions {
  position: absolute;
  top: 14px;
  right: 20px;
  z-index: 2;
  display: flex;
  gap: 8px;
  align-items: center;
}

.bh-tl {
  display: flex;
  flex-direction: column;
}

.bh-tl__row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  min-height: 40px;
}

.bh-tl__gutter {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  width: 14px;
  padding-top: 3px;
  align-self: stretch;
}

.bh-tl__line {
  flex: 1;
  width: 1px;
  min-height: 6px;
  margin-top: 4px;
  background: repeating-linear-gradient(to bottom, #c3c9d1 0 2px, transparent 2px 5px);
}

.bh-tl__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding-bottom: 8px;
}

.bh-tl__line-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  min-height: 20px;
  margin: 0;
}

.bh-tl__title {
  color: #000a14;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}

.bh-tl__time {
  color: #596168;
  font-size: 12px;
  line-height: 20px;
}

.bh-tl__dot {
  color: #9aa4b2;
  font-size: 12px;
  line-height: 20px;
}

.bh-tl__user {
  color: #3b444c;
  font-size: 12px;
  line-height: 20px;
}

.bh-tl__worker {
  color: #000a14;
  font-size: 13px;
  line-height: 20px;
}

.bh-tl__error {
  margin: 0;
  color: #596168;
  font-size: 12px;
  line-height: 18px;
}

.bh-tl__list {
  display: block;
  flex: none;
}

.bh-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  font-family: var(--tk-mono);
  font-size: 12px;
  line-height: 22px;
  border-radius: 4px;
  white-space: nowrap;
}

.bh-chip--commit {
  color: #0066cc;
  background: #e5f2ff;
}

.bh-chip--image {
  color: #3b444c;
  background: #f2f4f7;
}

.bh-chip__icon {
  display: block;
  flex: none;
}

.bh-link {
  padding: 0;
  color: #0066cc;
  font: inherit;
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
  background: none;
  border: 0;
}

.bh-link:hover {
  text-decoration: underline;
}

/* 页签 */
.bh-tabs {
  display: flex;
  flex: none;
  align-items: stretch;
  height: 48px;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid #d0d4d9;
}

.bh-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 48px;
  padding: 0 12px;
  color: #596168;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  background: none;
  border: 0;
}

.bh-tab:hover {
  color: #0066cc;
}

.bh-tab--active {
  color: #0066cc;
  font-weight: 600;
}

.bh-tab--active::after {
  position: absolute;
  right: 12px;
  bottom: -1px;
  left: 12px;
  height: 2px;
  content: '';
  background: #0066cc;
}

.bh-tabs__download {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  height: 26px;
  padding: 0 8px;
  margin-left: auto;
  align-self: center;
  color: #596168;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  background: none;
  border: 0;
  border-radius: 4px;
}

.bh-tabs__download:hover {
  color: #0066cc;
  background: #f2f4f7;
}

/* 内容区 */
.bh-content {
  flex: 1;
  min-height: 0;
  padding: 16px 20px;
  overflow: auto;
  background: #f2f4f7;
}

.bh-content--logs {
  display: flex;
  overflow: hidden;
}

.bh-content__state {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 240px;
  color: #596168;
  font-size: 13px;
}

.bh-content__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 280px;
  padding: 24px;
}

.bh-log {
  flex: 1;
  min-height: 0;
  padding: 12px 16px;
  margin: 0;
  overflow: auto;
  color: #cfd8e3;
  font-family: var(--tk-mono);
  font-size: 11px;
  line-height: 18px;
  white-space: pre-wrap;
  word-break: break-word;
  background: #1e2430;
  border-radius: 4px;
}

.bh-unavailable {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px;
  text-align: center;
  background: #1e2430;
  border-radius: 4px;
}

.bh-unavailable__info {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: #fff;
  font-family: Georgia, serif;
  font-size: 12px;
  font-weight: 700;
  background: #2f80ed;
  border-radius: 50%;
}

.bh-unavailable__title {
  margin: 0;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}

.bh-unavailable__note {
  max-width: 520px;
  margin: 0;
  color: #9aa4b2;
  font-size: 12px;
  line-height: 18px;
}

/* 产物 */
.bh-artifact {
  max-width: 800px;
  padding: 16px;
  background: #fff;
  border: 1px solid #d0d4d9;
  border-radius: 4px;
}

.bh-artifact__main {
  display: flex;
  gap: 12px;
}

.bh-artifact__icon {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  color: #0066cc;
  background: #e8f2fe;
  border-radius: 4px;
}

.bh-artifact__text {
  min-width: 0;
  padding-top: 1px;
}

.bh-artifact__tag {
  margin: 0;
  color: #000a14;
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  word-break: break-all;
}

.bh-artifact__ref {
  margin: 2px 0 0;
  color: #596168;
  font-family: var(--tk-mono);
  font-size: 12px;
  line-height: 18px;
  word-break: break-all;
}

.bh-artifact__label {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  margin-top: 16px;
  color: #3b444c;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  background: #fff;
  border: 1px dashed #9aa4b2;
  border-radius: 4px;
}

.bh-artifact__label:hover {
  color: #0066cc;
  border-color: #0066cc;
}

.bh-artifact__plus {
  color: #596168;
  font-size: 14px;
  line-height: 1;
}

/* 源码 */
.bh-source {
  max-width: 800px;
  overflow: hidden;
  background: #fff;
  border: 1px solid #d0d4d9;
  border-radius: 4px;
}

.bh-source__repo {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid #e6e9ef;
}

.bh-source__name {
  overflow: hidden;
  color: #000a14;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bh-source__sep {
  color: #9aa4b2;
}

.bh-source__branch {
  color: #3b444c;
  font-size: 13px;
}

.bh-source__commit {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 16px;
}

.bh-source__subject {
  margin: 0;
  color: #000a14;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}

.bh-source__meta {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 0;
  color: #596168;
  font-size: 12px;
  line-height: 18px;
}

.bh-source__missing {
  margin: 4px 0 0;
  color: #596168;
  font-size: 12px;
}

/* 底部浮动提示 */
.bh-pill {
  position: absolute;
  bottom: 36px;
  left: 50%;
  z-index: 5;
  display: inline-flex;
  gap: 8px;
  align-items: center;
  height: 32px;
  padding: 0 14px;
  color: #664bee;
  font-size: 13px;
  white-space: nowrap;
  background: #f3f0ff;
  border: 1px solid #b6abf3;
  border-radius: 4px;
  box-shadow: 0 1px 2px rgba(16, 42, 99, 0.06);
  transform: translateX(-50%);
}

.bh-pill__lead {
  color: #3b444c;
}

.bh-pill__link {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  color: #0066cc;
  font-weight: 600;
}
</style>
