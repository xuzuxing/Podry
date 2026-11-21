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
    size="720px"
    placement="right"
    :header="`Build Pipeline '${pipelineName}'`"
    :close-btn="true"
    drawer-class-name="bd-material"
    @close="close"
  >
    <div class="mt">
      <aside class="mt__side">
        <p class="mt__side-label">Git Repository</p>
        <t-select
          class="mt__branch-select"
          size="small"
          :value="branchName"
          :options="branchOptions"
          :disabled="branchesLoading || gitNotConfigured"
          placeholder="选择分支"
          @change="onBranchChange"
        />
        <p class="mt__repo" :title="repositoryUrl">{{ repositoryUrl || '—' }}</p>
        <p v-if="latestCommitAt" class="mt__repo-meta u-dim">
          <t-icon name="time" size="12px" />
          最近提交 {{ fmtRelative(latestCommitAt) }}
        </p>
      </aside>

      <section class="mt__main">
        <div class="mt__head">
          <span class="mt__branch-tag">
            <t-icon name="git-branch" size="13px" />
            {{ branchName || '分支' }}
          </span>
          <t-input
            v-if="commits.length"
            v-model="search"
            class="mt__search"
            size="small"
            clearable
            placeholder="Search by commit hash"
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
              <p class="mt__date">{{ group.date }}</p>
              <ul class="mt__commits">
                <li v-for="commit in group.items" :key="commit.sha">
                  <button
                    type="button"
                    class="cmt"
                    :class="{ 'cmt--active': commit.sha === selectedSha }"
                    @click="selectedSha = commit.sha"
                  >
                    <span class="cmt__main">
                      <span class="cmt__sha u-mono">{{ shortSha(commit.sha) }}</span>
                      <span class="cmt__subject">{{ commit.subject }}</span>
                      <span class="cmt__meta">
                        <t-icon name="user" size="12px" />
                        {{ commit.authorName }}
                        <t-icon name="time" size="12px" class="cmt__meta-gap" />
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
        <span class="mt__hint" :class="{ 'mt__hint--error': footerError }">{{ footerText }}</span>
        <span v-if="startErrorCode" class="mt__hint-code u-mono">{{ startErrorCode }}</span>
        <span class="mt__push" />
        <t-button theme="primary" :disabled="!canStart" :loading="starting" @click="startBuild">
          <template #icon><t-icon name="play-circle" /></template>
          Start Build
        </t-button>
      </div>
    </template>
  </t-drawer>
</template>

<style scoped>
:global(.bd-material .t-drawer__body) {
  padding: 0;
  overflow: hidden;
}

.mt {
  display: flex;
  height: 100%;
  min-height: 0;
}

/* ---- 左列：仓库与分支 ---- */
.mt__side {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 6px;
  width: 216px;
  padding: 14px 12px;
  overflow: auto;
  background: var(--tk-surface);
  border-right: 1px solid var(--tk-border);
}
.mt__side-label {
  margin: 0;
  color: var(--tk-text-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.mt__branch-select {
  width: 100%;
}
.mt__repo {
  margin: 4px 0 0;
  color: var(--tk-text-2);
  font-family: var(--tk-mono);
  font-size: 11px;
  line-height: 16px;
  word-break: break-all;
}
.mt__repo-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  font-size: 11px;
}

/* ---- 右列：提交列表 ---- */
.mt__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  background: #f7f9fc;
}
.mt__head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--tk-surface);
  border-bottom: 1px solid var(--tk-border);
}
.mt__branch-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--tk-text);
  font-weight: 600;
}
.mt__search {
  width: 260px;
  margin-left: auto;
}
.mt__list {
  flex: 1;
  min-height: 0;
  padding: 12px 16px 20px;
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
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.mt__notice-title {
  margin: 0;
  font-weight: 600;
}
.mt__notice p {
  margin: 0;
}
.mt__group + .mt__group {
  margin-top: 4px;
}
.mt__date {
  margin: 10px 0 6px;
  padding-left: 2px;
  color: var(--tk-text-3);
  font-size: 11px;
}
.mt__group:first-child .mt__date {
  margin-top: 0;
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
  padding: 10px 12px;
  font: inherit;
  color: var(--tk-text);
  text-align: left;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
  cursor: pointer;
}
.cmt:hover {
  border-color: var(--tk-border-strong);
}
.cmt--active {
  background: #f5f9ff;
  border-color: var(--tk-primary);
}
.cmt__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.cmt__sha {
  align-self: flex-start;
  padding: 1px 6px;
  color: var(--tk-text-2);
  background: #f2f4f8;
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.cmt__subject {
  font-weight: 600;
  line-height: 19px;
  word-break: break-word;
}
.cmt__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  color: var(--tk-text-3);
  font-size: 11px;
}
.cmt__meta-gap {
  margin-left: 8px;
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
  border: 1px solid var(--tk-border-strong);
  border-radius: 50%;
}
.cmt--active .cmt__pick {
  background: var(--tk-primary);
  border-color: var(--tk-primary);
}

/* ---- 底部 ---- */
.mt__foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mt__hint {
  color: var(--tk-text-3);
  font-size: 12px;
}
.mt__hint--error {
  color: var(--tk-danger);
}
.mt__hint-code {
  color: var(--tk-text-3);
}
.mt__push {
  flex: 1;
}
</style>
