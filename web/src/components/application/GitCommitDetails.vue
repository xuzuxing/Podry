<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { GitCommit } from '@/types'
import { fmtTime } from '@/utils/format'
import { gitCommitUrl } from '@/utils/gitSourceDetails'

const props = defineProps<{ commit: Partial<GitCommit>; repositoryUrl?: string }>()
const copying = shallowRef(false)
const copyFailed = shallowRef(false)
const link = computed(() => gitCommitUrl(props.repositoryUrl, props.commit.sha))
const displaySha = computed(() => props.commit.sha?.slice(0, 7) ?? '')
watch(() => props.commit.sha, () => { copyFailed.value = false })
async function copySha() {
  if (!props.commit.sha || copying.value) return
  const sha = props.commit.sha
  copying.value = true
  copyFailed.value = false
  try { await navigator.clipboard.writeText(sha); MessagePlugin.success('已复制完整提交 SHA') }
  catch { copyFailed.value = true; MessagePlugin.error('复制失败，请手动选择下方完整提交 SHA') }
  finally { copying.value = false }
}
</script>

<template>
  <div class="git-commit-details cmt__body">
    <div v-if="commit.sha" class="git-commit-details__header">
      <a v-if="link" :href="link" target="_blank" rel="noopener noreferrer" class="git-commit-details__sha cmt__sha build-source-card__sha" :title="commit.sha" aria-label="在 Git 中查看提交" @click.stop @keydown.stop><t-icon name="code" size="14px" />{{ displaySha }}</a>
      <span v-else class="git-commit-details__sha cmt__sha build-source-card__sha" :title="commit.sha">{{ displaySha }}</span>
      <t-button class="git-commit-details__copy" size="small" variant="text" aria-label="复制完整提交 SHA" :loading="copying" @click.stop="copySha" @keydown.stop><t-icon name="copy" size="14px" /></t-button>
    </div>
    <p v-if="copyFailed" class="git-commit-details__fallback" @click.stop @keydown.stop>请手动复制：<code>{{ commit.sha }}</code></p>
    <p class="git-commit-details__subject cmt__subject">{{ commit.subject || '提交信息未记录' }}</p>
    <span class="git-commit-details__meta cmt__meta"><t-icon name="user" size="16px" />{{ commit.authorName || '作者未记录' }}</span>
    <span class="git-commit-details__meta cmt__meta"><t-icon name="calendar" size="16px" />{{ commit.committedAt ? fmtTime(commit.committedAt) : '提交时间未记录' }}</span>
  </div>
</template>

<style scoped>
.git-commit-details{display:flex;flex:1;flex-direction:column;gap:8px;min-width:0;font-size:13px;line-height:20px}.git-commit-details__header{display:flex;align-items:center;gap:6px;min-height:24px}.git-commit-details__sha{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:0 6px;color:#0066cc;font:12px/22px monospace;background:#e8f0fe;border-radius:2px;text-decoration:none;overflow-wrap:anywhere}.git-commit-details__sha:hover{text-decoration:underline}.git-commit-details__subject{margin:0;font-size:13px;font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere}.git-commit-details__meta{display:flex;align-items:center;gap:8px;color:#596168;font-size:12px}.git-commit-details__meta>.t-icon{flex:none}.git-commit-details__copy{opacity:0;transition:opacity .1s}.git-commit-details:hover .git-commit-details__copy,.git-commit-details:focus-within .git-commit-details__copy{opacity:1}@media(hover:none){.git-commit-details__copy{opacity:1}}
.git-commit-details__fallback{margin:0;color:#a65b00;font-size:12px;overflow-wrap:anywhere;user-select:text}.git-commit-details__fallback code{font-family:monospace}
</style>
