<script setup lang="ts">
import { computed, shallowRef, toRef, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { useRouter } from 'vue-router'
import { MockError, triggerBuild } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import BuildRepositoryList from '@/components/application/BuildRepositoryList.vue'
import BuildBranchDialog from '@/components/application/BuildBranchDialog.vue'
import BuildWebhookEvents from '@/components/application/BuildWebhookEvents.vue'
import ReceivedWebhooks from '@/components/application/ReceivedWebhooks.vue'
import BuildCommitCard from '@/components/application/BuildCommitCard.vue'
import { useBuildMaterials } from '@/composables/useBuildMaterials'
import type { GitCommit, Workflow } from '@/types'
import { fmtTime } from '@/utils/format'
import { isWebhookSource, webhookMatches } from '@/utils/gitSources'

const props = defineProps<{
  visible: boolean; appId: string; projectId: string; pipelineName: string; pipelineId: string
  canBuild: boolean
}>()
const emit = defineEmits<{ 'update:visible': [value: boolean]; workflowUpdated: [workflow: Workflow] }>()
const router = useRouter()
const { states, activeId, active, config, workflow, definition, effectiveConfig, selectedCount, loading, error, errorCode, load, refresh, selectEvent, saveBranches, branchSaving, branchError } =
  useBuildMaterials(toRef(props, 'visible'), toRef(props, 'appId'), toRef(props, 'pipelineId'))
const starting = shallowRef(false)
const startError = shallowRef('')
const branchDialog = shallowRef(false)
const received = shallowRef(false)
const webhook = computed(() => Boolean(active.value && isWebhookSource(active.value.source)))
const branchesLoading = loading
const branchesError = error
const branchesErrorCode = errorCode
const branchName = computed(() => active.value?.branch ?? '')
const commits = computed(() => active.value?.commits ?? [])
const commitsLoading = computed(() => active.value?.loading ?? false)
const commitsError = computed(() => active.value?.error ?? '')
const commitsErrorCode = computed(() => active.value?.errorCode ?? '')
const selectedSha = computed(() => active.value?.selectedSha ?? '')
function selectCommit(sha: string) {
  if (active.value && !starting.value && !branchSaving.value && !commitsLoading.value && active.value.commits.some(item => item.sha === sha && !item.excluded)) active.value.selectedSha = sha
}
const showExcluded = computed(() => active.value?.showExcluded ?? false)
const excludedCount = computed(() => commits.value.filter(item => item.excluded).length)
function toggleExcluded() { if (active.value) active.value.showExcluded = !active.value.showExcluded }
const search = computed({get: () => active.value?.search ?? '', set: value => { if (active.value) active.value.search = value }})
const gitNotConfigured = computed(() => errorCode.value === 'git_not_configured')
const gitUnavailable = computed(() => errorCode.value === 'git_unavailable' || commitsErrorCode.value === 'git_unavailable')

/** 提交分组标题：2026年11月21日 */
function dateLabel(value: string): string {
  const parts = value.split('-')
  return parts.length === 3 ? `${parts[0]}年${Number(parts[1])}月${Number(parts[2])}日` : value
}
const filteredCommits = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return commits.value.filter(item => keyword
    ? item.sha.toLowerCase().includes(keyword) || item.subject.toLowerCase().includes(keyword)
    : showExcluded.value || !item.excluded)
})
const commitGroups = computed(() => {
  const groups: Array<{date: string; items: GitCommit[]}> = []
  filteredCommits.value.forEach(commit => {
    // 按本地时区归组，避免与卡片上显示的时间错开一天
    const date = fmtTime(commit.committedAt).slice(0, 10)
    const last = groups[groups.length - 1]
    if (last?.date === date) last.items.push(commit)
    else groups.push({date, items: [commit]})
  })
  return groups
})
const disabledReason = computed(() => {
  if (!props.canBuild) return '配置未完成，暂时不能构建'
  if (loading.value || states.value.some(item => item.loading)) return '正在读取提交…'
  if (error.value) return error.value
  if (branchSaving.value) return '正在设置分支…'
  const failed = states.value.find(item => item.error || (isWebhookSource(item.source) ? !item.events.some(event => !event.commit.excluded && webhookMatches(item.source, event)) : !item.branch || !item.commits.some(commit => !commit.excluded)))
  if (failed) return failed.error || (isWebhookSource(failed.source) ? failed.events.some(event => webhookMatches(failed.source, event)) ? '匹配的 Webhook 提交均已被路径规则排除' : '没有符合过滤条件的 Webhook 事件' : !failed.branch && failed.source.type === 'regex' ? '请先设置匹配正则的构建分支' : '仓库没有匹配分支或可构建提交')
  if (!states.value.length) return '尚未配置 Git 源'
  if (selectedCount.value !== states.value.length) return `已选择 ${selectedCount.value}/${states.value.length} 个仓库，请为每个仓库选择提交`
  return ''
})
const canStart = computed(() => !disabledReason.value && !starting.value)
const footerText = computed(() => startError.value || disabledReason.value || `已选择 ${selectedCount.value}/${states.value.length} 个仓库 · 配置版本 v${config.value?.version}`)
const footerError = computed(() => Boolean(startError.value || error.value || states.value.some(item => item.error)))
const overrideLabel = computed(() => definition.value?.buildOverride ? '流水线构建覆盖' : '应用构建配置')
function loadBranches() { void load() }
function loadCommits() { if (active.value) void refresh(active.value, false) }
function close() { if (!starting.value && !branchSaving.value) emit('update:visible', false) }
async function setBranches(branches: Array<{ gitMaterialId: string; branch: string }>) {
  if (await saveBranches(branches)) {
    branchDialog.value = false
    if (workflow.value) emit('workflowUpdated', workflow.value)
  }
}
function editFilters() {
  emit('update:visible', false)
  void router.push({ name: 'config-workflow', params: { projectId: props.projectId, appId: props.appId }, query: { pipeline: props.pipelineId } })
}
async function startBuild() {
  if (!canStart.value || !config.value || !workflow.value) return
  starting.value = true
  startError.value = ''
  try {
    const primary = states.value.find(item => item.material.id === effectiveConfig.value?.gitMaterialId) ?? states.value[0]!
    const build = await triggerBuild(props.appId, primary.selectedSha, config.value.version, props.pipelineId, primary.branch, {
      workflowVersion: workflow.value.version,
      materials: states.value.map(item => ({gitMaterialId: item.material.id, branch: item.branch, commitSha: item.selectedSha, ...(item.selectedEventId ? {webhookEventId: item.selectedEventId} : {})})),
    })
    MessagePlugin.success(`已触发构建 ${build.id}，可在构建历史查看进度`)
    emit('update:visible', false)
    await router.push({name:'app-builds',params:{projectId:props.projectId,appId:props.appId},query:{pipeline:props.pipelineId,build:build.id}})
  } catch (err) {
    startError.value = err instanceof MockError && err.code === 'build_active' ? '已有进行中的构建' : err instanceof Error ? err.message : '触发构建失败'
  } finally { starting.value = false }
}
watch(() => props.visible, () => { startError.value = ''; branchDialog.value = false; received.value = false })
watch(loading, busy => { if (!busy && props.visible && states.value.some(state => state.source.type === 'regex' && !state.branch)) branchDialog.value = true })
</script>

<template>
  <t-drawer
    :visible="visible"
    size="1024px"
    placement="right"
    :header="`构建流水线 '${pipelineName}'`"
    :close-btn="true"
    drawer-class-name="bd-material"
    :footer="received ? false : undefined"
    @close="close"
  >
    <ReceivedWebhooks v-if="received && active" :source="active.source" :events="active.events" :repository-url="active.material.repositoryUrl" :loading="active.loading" :error="active.error" @back="received = false" @edit="editFilters" @refresh="loadCommits" />
    <div v-else class="mt">
      <BuildRepositoryList :states="states" :active-id="activeId" :disabled="starting || branchSaving" @select="activeId = $event" @refresh="refresh" />

      <section class="mt__main">
        <div v-if="!webhook" class="mt__head">
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
          <t-button v-if="active?.source.type === 'regex'" variant="text" size="small" class="mt__set-branch" :disabled="starting || commitsLoading" aria-label="设置构建分支" @click="branchDialog = true"><t-icon name="edit" /></t-button>
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
          <t-dropdown v-if="commits.length" :options="[{ content: showExcluded ? '隐藏已排除提交' : '显示已排除提交', value: 'excluded' }]" trigger="click" @click="toggleExcluded"><t-button variant="text" size="small" :disabled="starting || branchSaving || commitsLoading" :aria-label="showExcluded ? '隐藏已排除提交' : '显示已排除提交'" :class="{ 'mt__filter--applied': !showExcluded }"><t-icon name="filter" size="16px" /></t-button></t-dropdown>
        </div>

        <div v-if="effectiveConfig" class="mt__build-config"><span>{{ overrideLabel }}</span><strong>{{ effectiveConfig.imageRepository }}</strong><span>{{ effectiveConfig.buildMode === 'buildpack' ? 'Buildpacks' : effectiveConfig.platform || '跟随构建节点平台' }}</span><span v-if="effectiveConfig.buildMode !== 'buildpack' && (effectiveConfig.buildSecrets.length || effectiveConfig.buildSSH.length)">{{ effectiveConfig.buildSecrets.length }} 个 Secret · {{ effectiveConfig.buildSSH.length }} 个 SSH 引用</span></div>
        <BuildWebhookEvents v-if="webhook && active && !loading && !active.loading && !active.error" :source="active.source" :events="active.events" :repository-url="active.material.repositoryUrl" :selected-id="active.selectedEventId" :disabled="starting || branchSaving" @select="selectEvent" @received="received = true" />
        <div v-else class="mt__list">
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
            :title="!branchName ? '尚未设置分支，请输入匹配正则的分支名称' : search.trim() ? '没有匹配的提交' : excludedCount ? '提交均已被路径规则排除' : '该分支暂无提交'"
            compact
          />

          <template v-else>
            <div v-for="group in commitGroups" :key="group.date" class="mt__group">
              <p class="mt__date">{{ dateLabel(group.date) }}</p>
              <ul class="mt__commits">
                <li v-for="commit in group.items" :key="commit.sha">
                  <BuildCommitCard :commit="commit" :repository-url="active?.material.repositoryUrl ?? ''" :selected="commit.sha === selectedSha" :disabled="starting || branchSaving || commitsLoading" @select="selectCommit" />
                </li>
              </ul>
            </div>
          </template>
        </div>
      </section>
    </div>

    <BuildBranchDialog :visible="visible && branchDialog" :states="states" :pipeline-name="pipelineName" :saving="branchSaving" :error="branchError" @close="branchDialog = false" @submit="setBranches" />
    <template v-if="!received" #footer>
      <div class="mt__foot">
        <div class="mt__foot-text">
          <span class="mt__cache">未配置对象存储，缓存不可用</span>
          <span class="mt__hint" :class="{ 'mt__hint--error': footerError }">
            {{ footerText }}
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

 .mt__build-config{display:flex;flex-wrap:wrap;gap:8px;padding:8px 16px;color:#596168;font-size:11px;border-bottom:1px solid #e6e9ef}.mt__build-config strong{font-weight:500;color:#3b444c;overflow-wrap:anywhere}
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
.mt__filter--applied{color:#0066cc}

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
