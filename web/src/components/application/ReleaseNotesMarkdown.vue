<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
const props = defineProps<{ source: string }>()
const html = computed(() => {
  const safe = DOMPurify.sanitize(marked.parse(props.source, { async: false, breaks: true, gfm: true }), { USE_PROFILES: { html: true }, FORBID_TAGS: ['img', 'style', 'form', 'input', 'button'] })
  const doc = new DOMParser().parseFromString(safe, 'text/html')
  for (const link of doc.querySelectorAll('a')) { link.target = '_blank'; link.rel = 'noopener noreferrer' }
  return doc.body.innerHTML
})
</script>
<template><article class="release-notes" v-html="html" /></template>
<style scoped>
.release-notes :deep(ol){list-style:decimal;padding-left:24px;margin:0 0 14px}.release-notes :deep(ul){list-style:disc;padding-left:24px;margin:0 0 14px}.release-notes :deep(li){display:list-item;margin:3px 0}
.release-notes{font-size:13px;line-height:22px;overflow-wrap:anywhere;color:var(--tk-text)}.release-notes :deep(h1){font-size:22px}.release-notes :deep(h2){font-size:18px}.release-notes :deep(h3){font-size:15px}.release-notes :deep(p){margin:0 0 14px}.release-notes :deep(pre){padding:12px;background:#f5f7fa;border:1px solid #dce1e7;border-radius:4px;overflow:auto;font:12px/20px var(--tk-mono)}.release-notes :deep(code){font-family:var(--tk-mono);background:#f1f3f6;padding:2px 4px;border-radius:2px}.release-notes :deep(pre code){padding:0;background:none}.release-notes :deep(a){color:#0066cc}.release-notes :deep(table){border-collapse:collapse;width:100%;margin:12px 0}.release-notes :deep(th),.release-notes :deep(td){border:1px solid #dce1e7;padding:8px;text-align:left}.release-notes :deep(blockquote){border-left:3px solid #b1c3d6;padding-left:12px;margin-left:0;color:#596168}
</style>
