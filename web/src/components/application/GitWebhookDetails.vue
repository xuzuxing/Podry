<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { GitWebhookEvent } from '@/types'
import { fmtTime } from '@/utils/format'
import { gitPullRequestUrl, gitRefUrl } from '@/utils/gitSourceDetails'

const props = defineProps<{ event: GitWebhookEvent; repositoryUrl?: string }>()
const copying = shallowRef(false)
const requestLink = computed(() => gitPullRequestUrl(props.repositoryUrl, props.event.pullRequest?.number, props.event.pullRequest?.url))
const tagLink = computed(() => gitRefUrl(props.repositoryUrl, props.event.ref, 'tag'))
const branches = computed(() => [
  { label: '目标', value: props.event.values.targetBranch, link: gitRefUrl(props.repositoryUrl, props.event.values.targetBranch) },
  { label: '来源', value: props.event.values.sourceBranch, link: gitRefUrl(props.repositoryUrl, props.event.values.sourceBranch) },
])
async function copyUrl() {
  const value = requestLink.value
  if (!value || copying.value) return
  copying.value = true
  try { await navigator.clipboard.writeText(value); MessagePlugin.success('已复制 Pull Request 链接') }
  catch { MessagePlugin.error('复制失败，请手动复制链接') }
  finally { copying.value = false }
}
</script>

<template>
  <div class="git-webhook-details">
    <div class="git-webhook-details__header">
      <template v-if="event.type === 'pull_request'">
        <a v-if="requestLink" :href="requestLink" class="git-webhook-details__chip" target="_blank" rel="noopener noreferrer" aria-label="在 Git 中查看 Pull Request" @click.stop @keydown.stop><t-icon name="fork" size="14px" />PR #{{ event.pullRequest?.number }}</a>
        <span v-else class="git-webhook-details__chip"><t-icon name="fork" size="14px" />Pull Request</span>
        <t-button v-if="requestLink" class="git-webhook-details__copy" size="small" variant="text" aria-label="复制 Pull Request 链接" :loading="copying" @click.stop="copyUrl" @keydown.stop><t-icon name="copy" size="14px" /></t-button>
      </template>
      <template v-else><a v-if="tagLink" :href="tagLink" class="git-webhook-details__chip" target="_blank" rel="noopener noreferrer" aria-label="在 Git 中查看 Tag" @click.stop @keydown.stop><t-icon name="discount" size="14px" />{{ event.ref }}</a><span v-else class="git-webhook-details__chip">{{ event.ref }}</span></template>
    </div>
    <strong v-if="event.type === 'pull_request'" class="git-webhook-details__title">{{ event.title }}</strong>
    <div v-if="event.type === 'pull_request'" class="git-webhook-details__branches"><t-icon name="fork" size="16px" /><span>合入</span><template v-for="(branch, index) in branches" :key="branch.label"><span v-if="index">来自</span><a v-if="branch.link" :href="branch.link" target="_blank" rel="noopener noreferrer" class="git-webhook-details__branch" :aria-label="`${branch.label}分支 ${branch.value}`" @click.stop @keydown.stop>{{ branch.value }}</a><span v-else class="git-webhook-details__branch">{{ branch.value || '分支未记录' }}</span></template></div>
    <span v-if="event.type === 'pull_request'" class="git-webhook-details__meta">{{ event.values.sourceBranch }} → {{ event.values.targetBranch }} · {{ event.values.action }}</span>
    <span class="git-webhook-details__meta"><t-icon name="user" size="16px" />{{ event.values.author || event.commit.authorName || '作者未记录' }}</span>
    <span class="git-webhook-details__meta"><t-icon name="calendar" size="16px" />{{ fmtTime(event.receivedAt) }}</span>
    <p class="git-webhook-details__message">{{ event.commit.subject || '提交信息未记录' }}</p>
  </div>
</template>

<style scoped>
.git-webhook-details{display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-width:0;font-size:13px;line-height:20px;overflow-wrap:anywhere}.git-webhook-details__header,.git-webhook-details__branches{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}.git-webhook-details__chip{display:inline-flex;align-items:center;gap:4px;padding:0 6px;background:#e8f0fe;color:#0066cc;font:13px/24px monospace;border-radius:2px;text-decoration:none}.git-webhook-details__title{font-size:13px;font-weight:600;white-space:pre-wrap}.git-webhook-details__branch{padding:0 6px;background:#edf1f5;border-radius:2px;color:#0066cc;font:12px/22px monospace;text-decoration:none}.git-webhook-details a:hover{text-decoration:underline}.git-webhook-details__meta{display:flex;align-items:center;gap:8px;font-size:12px;color:#596168}.git-webhook-details__message{margin:0;font-size:13px;white-space:pre-wrap}.git-webhook-details__copy{opacity:0}.git-webhook-details:hover .git-webhook-details__copy,.git-webhook-details:focus-within .git-webhook-details__copy{opacity:1}@media(hover:none){.git-webhook-details__copy{opacity:1}}
</style>
