<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { SelectValue } from 'tdesign-vue-next'
import { useRouter } from 'vue-router'

import { listBranches, listCommits, MockError, triggerBuild } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import type { Build, GitBranch, GitCommit } from '@/types'
import { fmtRelative, fmtTime, shortSha } from '@/utils/format'

const props = defineProps<{
  visible: boolean
  appId: string
  projectId: string
  pipelineName: string
  repositoryUrl: string
  configVersion: number
  canBuild: boolean
}>()

const emit = defineEmits<{ 'update:visible': [value: boolean] }>()

interface CommitGroup {
  date: string
  items: GitCommit[]
}

const router = useRouter()

const branches = ref<GitBranch[]>([])
const branchName = ref('')
const branchesLoading = ref(false)
const branchesError = ref('')
const branchesErrorCode = ref('')

const commits = ref<GitCommit[]>([])
const commitsLoading = ref(false)
const commitsError = ref('')
const commitsErrorCode = ref('')

const selectedSha = ref('')
const search = ref('')
const starting = ref(false)
const startError = ref('')
const startErrorCode = ref('')

const gitNotConfigured = computed(() => branchesErrorCode.value === 'git_not_configured')
const gitUnavailable = computed(
  () => branchesErrorCode.value === 'git_unavailable' || commitsErrorCode.value === 'git_unavailable',
)
const branchOptions = computed(() => branches.value.map((item) => ({ label: item.name, value: item.name })))

/** 仓库名，Devtron 左侧仓库卡展示 `/checkout-api` 形式 */
const repoLabel = computed(() => {
  const trimmed = props.repositoryUrl.replace(/\.git$/, '').replace(/[/:]+$/, '')
  const name = trimmed.split(/[/:]/).filter(Boolean).pop() ?? ''
  return name ? `/${name}` : '—'
})

/** 提交分组标题：2026年11月21日 */
function dateLabel(value: string): string {
  const parts = value.split('-')
  if (parts.length !== 3) return value
  return `${parts[0]}年${Number(parts[1])}月${Number(parts[2])}日`
}

const filteredCommits = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return commits.value
  return commits.value.filter(
    (item) => item.sha.toLowerCase().includes(keyword) || item.subject.toLowerCase().includes(keyword),
  )
})

const commitGroups = computed<CommitGroup[]>(() => {
  const result: CommitGroup[] = []
  filteredCommits.value.forEach((commit) => {
    // 按本地时区归组，避免与卡片上显示的时间错开一天
    const date = fmtTime(commit.committedAt).slice(0, 10)
    const last = result[result.length - 1]
    if (last && last.date === date) last.items.push(commit)
    else result.push({ date, items: [commit] })
  })
  return result
})

const latestCommitAt = computed(() => commits.value[0]?.committedAt ?? '')

const disabledReason = computed(() => {
  if (!props.canBuild) return '配置未完成，暂时不能构建'
  if (gitNotConfigured.value) return '尚未配置 Git 源，无法读取提交'
  if (branchesLoading.value || commitsLoading.value) return '正在读取提交…'
  if (gitUnavailable.value) return 'Git 服务暂不可达，请稍后重试'
  if (branchesError.value) return branchesError.value
  if (commitsError.value) return commitsError.value
  if (!commits.value.length) return '该分支没有可构建的提交'
  if (!selectedSha.value) return '请选择一个提交后再开始构建'
  return ''
})

const canStart = computed(() => !disabledReason.value && !starting.value)

const footerText = computed(() => {
  if (startError.value) return startError.value
  if (disabledReason.value) return disabledReason.value
  return `已选择 ${shortSha(selectedSha.value)} · 配置版本 v${props.configVersion}`
})

const footerError = computed(
  () => Boolean(startError.value) || gitUnavailable.value || Boolean(branchesError.value || commitsError.value),
)

function errorCodeOf(err: unknown): string {
  return err instanceof MockError ? err.code : ''
}

function errorTextOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

async function loadCommits(): Promise<void> {
  if (!branchName.value) return
  commitsLoading.value = true
  commitsError.value = ''
  commitsErrorCode.value = ''
  commits.value = []
  selectedSha.value = ''
  try {
    commits.value = await listCommits(branchName.value)
  } catch (err) {
    commitsErrorCode.value = errorCodeOf(err)
    commitsError.value = errorTextOf(err, '提交列表加载失败')
  } finally {
    commitsLoading.value = false
  }
}

async function loadBranches(): Promise<void> {
  branchesLoading.value = true
  branchesError.value = ''
  branchesErrorCode.value = ''
  branches.value = []
  branchName.value = ''
  commits.value = []
  selectedSha.value = ''
  try {
    const list = await listBranches(props.appId)
    branches.value = list
    const preferred = list.find((item) => item.isDefault) ?? list[0]
    if (!preferred) return
    branchName.value = preferred.name
    await loadCommits()
  } catch (err) {
    branchesErrorCode.value = errorCodeOf(err)
    branchesError.value = errorTextOf(err, '分支加载失败')
  } finally {
    branchesLoading.value = false
  }
}

function onBranchChange(value: SelectValue): void {
  const next = typeof value === 'string' ? value : ''
  if (!next || next === branchName.value) return
  branchName.value = next
  search.value = ''
  void loadCommits()
}

function close(): void {
  emit('update:visible', false)
}

async function startBuild(): Promise<void> {
  if (!canStart.value) return
  starting.value = true
  startError.value = ''
  startErrorCode.value = ''
  try {
    const build: Build = await triggerBuild(props.appId, selectedSha.value, props.configVersion)
    MessagePlugin.success(`已触发构建 ${build.id}，可在构建历史查看进度`)
    close()
    await router.push({ name: 'app-builds', params: { projectId: props.projectId, appId: props.appId } })
  } catch (err) {
    startErrorCode.value = errorCodeOf(err)
    startError.value =
      startErrorCode.value === 'build_active' ? '已有进行中的构建' : errorTextOf(err, '触发构建失败')
  } finally {
    starting.value = false
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    search.value = ''
    starting.value = false
    startError.value = ''
    startErrorCode.value = ''
    void loadBranches()
  },
  { immediate: true },
)
</script>

<template>
  <t-drawer
    :visible="visible"
    size="1024px"
    placement="right"
    :header="`构建流水线 '${pipelineName}'`"
    :close-btn="true"
    drawer-class-name="bd-material"
    @close="close"
  >
    <div class="mt">
      <aside class="mt__side">
        <p class="mt__side-title">Git 仓库</p>
        <div class="mt__repo">
          <div class="mt__repo-head">
            <svg class="mt__repo-icon" width="20" height="20" viewBox="0 0 48 48">
              <path
                fill="#F4511E"
                d="M42.2,22.1L25.9,5.8C25.4,5.3,24.7,5,24,5c0,0,0,0,0,0c-0.7,0-1.4,0.3-1.9,0.8l-3.5,3.5l4.1,4.1c0.4-0.2,0.8-0.3,1.3-0.3c1.7,0,3,1.3,3,3c0,0.5-0.1,0.9-0.3,1.3l4,4c0.4-0.2,0.8-0.3,1.3-0.3c1.7,0,3,1.3,3,3s-1.3,3-3,3c-1.7,0-3-1.3-3-3c0-0.5,0.1-0.9,0.3-1.3l-4-4c-0.1,0-0.2,0.1-0.3,0.1v10.4c1.2,0.4,2,1.5,2,2.8c0,1.7-1.3,3-3,3s-3-1.3-3-3c0-1.3,0.8-2.4,2-2.8V18.8c-1.2-0.4-2-1.5-2-2.8c0-0.5,0.1-0.9,0.3-1.3l-4.1-4.1L5.8,22.1C5.3,22.6,5,23.3,5,24c0,0.7,0.3,1.4,0.8,1.9l16.3,16.3c0,0,0,0,0,0c0.5,0.5,1.2,0.8,1.9,0.8s1.4-0.3,1.9-0.8l16.3-16.3c0.5-0.5,0.8-1.2,0.8-1.9C43,23.3,42.7,22.6,42.2,22.1z"
              />
            </svg>
            <span class="mt__repo-name" :title="repositoryUrl">{{ repoLabel }}</span>
          </div>
          <div class="mt__repo-branch">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path
                d="M4.25 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0v3.25m0-3.25h5.5a2 2 0 0 0 2-2V6.25m0 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"
                stroke="#596168"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <t-select
              class="mt__branch"
              size="small"
              variant="borderless"
              :value="branchName"
              :options="branchOptions"
              :disabled="branchesLoading || gitNotConfigured"
              placeholder="选择分支"
              @change="onBranchChange"
            />
            <svg class="mt__info" width="12" height="12" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="5.6" stroke="#b1b7bc" stroke-width="1.2" />
              <path d="M8 7.4v3.2M8 5.1v.9" stroke="#b1b7bc" stroke-width="1.2" stroke-linecap="round" />
            </svg>
          </div>
          <div v-if="latestCommitAt" class="mt__repo-updated">
            <span>更新于 {{ fmtRelative(latestCommitAt) }}</span>
            <button type="button" class="mt__refresh" title="刷新分支与提交" @click="loadBranches">
              <t-icon name="refresh" size="14px" />
            </button>
          </div>
        </div>
      </aside>

      <section class="mt__main">
        <div class="mt__head">
          <span class="mt__branch-tag">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M4.25 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0v3.25m0-3.25h5.5a2 2 0 0 0 2-2V6.25m0 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"
                stroke="#3b444c"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {{ branchName || '分支' }}
          </span>
          <t-input
            v-if="commits.length"
            v-model="search"
            class="mt__search"
            size="small"
            clearable
            placeholder="按提交哈希搜索"
          >
            <template #prefix-icon><t-icon name="search" /></template>
          </t-input>
        </div>

        <div class="mt__list">
          <div v-if="branchesLoading" class="mt__state">
            <t-loading size="small" />
            <span class="u-muted">读取分支…</span>
          </div>

          <div v-else-if="gitNotConfigured" class="mt__notice">
            <p class="mt__notice-title">尚未配置 Git 源</p>
            <p class="u-muted">该应用还不能拉取代码，配置 Git 源后即可选择分支与提交。</p>
            <router-link :to="{ name: 'config-git', params: { projectId, appId } }">去配置 Git 源</router-link>
          </div>

          <ErrorState
            v-else-if="branchesError"
            :message="branchesError"
            :code="branchesErrorCode"
            @retry="loadBranches"
          />

          <div v-else-if="commitsLoading" class="mt__state">
            <t-loading size="small" />
            <span class="u-muted">读取提交…</span>
          </div>

          <ErrorState
            v-else-if="gitUnavailable"
            message="Git 服务暂不可达，稍后重试"
            code="git_unavailable"
            @retry="loadCommits"
          />

          <ErrorState
            v-else-if="commitsError"
            :message="commitsError"
            :code="commitsErrorCode"
            @retry="loadCommits"
          />

          <EmptyState
            v-else-if="!filteredCommits.length"
            :title="commits.length ? '没有匹配的提交' : '该分支暂无提交'"
            compact
          />

          <template v-else>
            <div v-for="group in commitGroups" :key="group.date" class="mt__group">
              <p class="mt__date">{{ dateLabel(group.date) }}</p>
              <ul class="mt__commits">
                <li v-for="commit in group.items" :key="commit.sha">
                  <button
                    type="button"
                    class="cmt"
                    :class="{ 'cmt--active': commit.sha === selectedSha }"
                    @click="selectedSha = commit.sha"
                  >
                    <span class="cmt__body">
                      <span class="cmt__sha">{{ shortSha(commit.sha) }}</span>
                      <span class="cmt__subject">{{ commit.subject }}</span>
                      <span class="cmt__meta">
                        <t-icon name="user" size="12px" />
                        {{ commit.authorName }}
                      </span>
                      <span class="cmt__meta">
                        <t-icon name="calendar" size="12px" />
                        {{ fmtTime(commit.committedAt) }}
                      </span>
                    </span>
                    <span class="cmt__pick">
                      <t-icon v-if="commit.sha === selectedSha" name="check" size="12px" />
                    </span>
                  </button>
                </li>
              </ul>
            </div>
          </template>
        </div>
      </section>
    </div>

    <template #footer>
      <div class="mt__foot">
        <div class="mt__foot-text">
          <span class="mt__cache">未配置对象存储，缓存不可用</span>
          <span class="mt__hint" :class="{ 'mt__hint--error': footerError }">
            {{ footerError ? footerText : '想缩短构建时间？配置对象存储' }}
          </span>
        </div>
        <t-button theme="primary" :disabled="!canStart" :loading="starting" @click="startBuild">
          <template #icon><t-icon name="play" /></template>
          开始构建
        </t-button>
      </div>
    </template>
  </t-drawer>
</template>

<style scoped>
/* Devtron 弹窗：右侧 1024 宽、全高、白底，49px 标题栏 / 74px 底部操作栏 */
:global(.bd-material) {
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.14);
}
:global(.bd-material .t-drawer__header) {
  min-height: 49px;
  padding: 12px 20px;
  color: #000a14;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  border-bottom: 1px solid #e6e9ef;
}
:global(.bd-material .t-drawer__body) {
  padding: 0;
  overflow: hidden;
}
:global(.bd-material .t-drawer__footer) {
  padding: 16px 20px;
  border-top: 1px solid #e6e9ef;
}

.mt {
  display: grid;
  grid-template-columns: 234px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
}

/* ---- 左列：仓库 ---- */
.mt__side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid #e6e9ef;
}
.mt__side-title {
  flex: none;
  margin: 0;
  padding: 12px 20px;
  color: #000a14;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  border-bottom: 1px solid #e6e9ef;
}
.mt__repo {
  margin: 16px;
  padding: 12px;
  background: #f7fafc;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.mt__repo-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mt__repo-icon {
  flex: none;
}
.mt__repo-name {
  overflow: hidden;
  color: #000a14;
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mt__repo-branch {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  color: #3b444c;
  font-size: 12px;
}
.mt__branch {
  width: 118px;
}
:global(.bd-material .mt__branch .t-input) {
  padding: 0;
  background: transparent;
  border-color: transparent;
}
:global(.bd-material .mt__branch .t-input__inner) {
  color: #3b444c;
  font-size: 12px;
}
.mt__info {
  flex: none;
}
.mt__repo-updated {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 10px;
  color: #767d84;
  font-size: 11px;
}
.mt__refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: #596168;
  background: none;
  border: 0;
  border-radius: 2px;
  cursor: pointer;
}
.mt__refresh:hover {
  background: #edf1f5;
}

/* ---- 右列：提交列表 ---- */
.mt__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #f2f4f7;
}
.mt__head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: #f2f4f7;
}
.mt__branch-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #000a14;
  font-size: 13px;
  font-weight: 600;
}
.mt__search {
  width: 260px;
  margin-left: auto;
}
.mt__list {
  flex: 1;
  min-height: 0;
  padding: 8px 20px 20px;
  overflow: auto;
}
.mt__state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 12px;
}
.mt__notice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 16px;
  background: #fff;
  border: 1px solid #d0d4d9;
  border-radius: 4px;
}
.mt__notice-title {
  margin: 0;
  font-weight: 600;
}
.mt__notice p {
  margin: 0;
}
.mt__date {
  margin: 12px 0 8px;
  color: #3b444c;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}
.mt__group:first-child .mt__date {
  margin-top: 8px;
}
.mt__commits {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cmt {
  display: flex;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  font: inherit;
  color: #000a14;
  text-align: left;
  background: #fff;
  border: 1px solid #d0d4d9;
  border-radius: 4px;
  cursor: pointer;
}
.cmt:hover {
  border-color: #b1b7bc;
}
.cmt--active {
  background: #f7fbff;
  border-color: #0066cc;
}
.cmt__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.cmt__sha {
  align-self: flex-start;
  padding: 0 6px;
  color: #0066cc;
  font-size: 11px;
  line-height: 18px;
  background: #e8f0fe;
  border-radius: 2px;
}
.cmt__subject {
  color: #000a14;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  word-break: break-word;
}
.cmt__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #596168;
  font-size: 12px;
  line-height: 18px;
}
.cmt__pick {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  color: #fff;
  border: 1px solid #b1b7bc;
  border-radius: 50%;
}
.cmt--active .cmt__pick {
  background: #0066cc;
  border-color: #0066cc;
}

/* ---- 底部 ---- */
.mt__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.mt__foot-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.mt__cache {
  color: #000a14;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}
.mt__hint {
  overflow: hidden;
  color: #596168;
  font-size: 12px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mt__hint--error {
  color: #f33e3e;
}
</style>
