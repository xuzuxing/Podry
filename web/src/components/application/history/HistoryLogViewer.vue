<script setup lang="ts">
import { nextTick, onBeforeUnmount, shallowRef, useTemplateRef, watch } from 'vue'
import { useHistoryLogViewer } from '@/composables/useHistoryLogViewer'
import HistoryLogViewport from './HistoryLogViewport.vue'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  text: string
  contextKey: string
  title: string
  status?: string
  executionStatus?: string
  loading?: boolean
  error?: string
  unavailable?: string
  fileName: string
  logClass?: string
  showDownload?: boolean
}>(), { status: '', executionStatus: '', loading: false, error: '', unavailable: '', logClass: '', showDownload: true })
const emit = defineEmits<{ refresh: [] }>()
const viewport = useTemplateRef<InstanceType<typeof HistoryLogViewport>>('viewport')
const panel = useTemplateRef<HTMLElement>('panel')
const expandButton = useTemplateRef<HTMLElement>('expandButton')
const { query, wrap, follow, closed, allOpen, current, result, toggleStage, toggleAll, moveMatch, onScroll, setFollow, scrollTop } = useHistoryLogViewer(() => props.text, () => props.contextKey, viewport, () => props.title, () => props.executionStatus)
const expanded = shallowRef(false), downloaded = shallowRef(false)

function download(): void {
  if (!props.text || props.unavailable || props.error) return
  const url = URL.createObjectURL(new Blob([props.text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = props.fileName; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  downloaded.value = true
}
function onSearchEnter(_value: string, context: { e: KeyboardEvent }): void { moveMatch(context.e.shiftKey ? -1 : 1) }
async function toggleExpanded(): Promise<void> {
  const position = viewport.value?.capture()
  expanded.value = !expanded.value
  await nextTick()
  if (position) viewport.value?.restore(position)
  if (expanded.value) panel.value?.focus()
  else expandButton.value?.focus()
}
function onKeydown(event: KeyboardEvent): void {
  const editing = event.target instanceof Element && Boolean(event.target.closest('input,textarea,[contenteditable="true"]'))
  if (!editing && !event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'e' && props.text && !props.error && !props.unavailable) { event.preventDefault(); toggleAll() }
  if (!expanded.value) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void toggleExpanded() }
  if (event.key === 'Tab' && panel.value) {
    const controls = [...panel.value.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex="0"]')].filter(item => item.checkVisibility())
    const first = controls[0], last = controls.at(-1)
    if (!first || !last) return
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.value)) { event.preventDefault(); first.focus() }
  }
}
watch(() => props.contextKey, () => { expanded.value = false; downloaded.value = false })
onBeforeUnmount(() => { expanded.value = false })
</script>

<template>
  <Teleport to="body" :disabled="!expanded">
    <section v-bind="$attrs" ref="panel" class="history-log-viewer" :class="{ 'is-expanded': expanded }" :role="expanded ? 'dialog' : undefined" :aria-modal="expanded ? true : undefined" :aria-label="`${title}日志查看器`" tabindex="-1" @keydown="onKeydown">
      <header class="history-log-toolbar">
        <strong>{{ title }}<span v-if="status" class="history-log-worker"> · {{ status }}</span></strong>
        <t-checkbox v-model="wrap">自动换行</t-checkbox>
        <t-checkbox :checked="follow" @change="setFollow(Boolean($event))">跟随日志</t-checkbox>
        <t-button size="small" variant="text" :loading="loading" aria-label="刷新日志" @click="emit('refresh')">刷新</t-button>
        <t-button v-if="showDownload || expanded" size="small" variant="text" :disabled="!text || Boolean(error) || Boolean(unavailable)" @click="download">{{ downloaded ? '已下载日志' : '下载日志' }}</t-button>
        <button ref="expandButton" type="button" class="history-log-expand" :aria-label="expanded ? '还原日志区' : '展开日志区'" :title="expanded ? '还原日志区 (Esc)' : '展开日志区'" @click="toggleExpanded"><t-icon :name="expanded ? 'fullscreen-exit' : 'fullscreen'" size="16px" /></button>
      </header>
      <div class="history-log-search">
        <t-input v-model="query" aria-label="搜索日志" placeholder="搜索日志" clearable :disabled="!text || Boolean(unavailable)" @enter="onSearchEnter"><template #prefix-icon><t-icon name="search" /></template></t-input>
        <span class="history-log-count" role="status" aria-live="polite">{{ query ? `${result.count ? current + 1 : 0}/${result.count} 个匹配` : '输入关键词搜索' }}</span>
        <button type="button" aria-label="上一个匹配" title="上一个匹配 (Shift+Enter)" :disabled="!result.count || !query" @click="moveMatch(-1)"><t-icon name="chevron-up" /></button>
        <button type="button" aria-label="下一个匹配" title="下一个匹配 (Enter)" :disabled="!result.count || !query" @click="moveMatch(1)"><t-icon name="chevron-down" /></button>
        <button type="button" class="history-log-toggle-all" :aria-label="allOpen ? '折叠全部阶段' : '展开全部阶段'" :title="`${allOpen ? '折叠' : '展开'}全部阶段 (E)`" :disabled="!text || Boolean(error) || Boolean(unavailable)" @click="toggleAll"><t-icon :name="allOpen ? 'unfold-less' : 'unfold-more'" /></button>
      </div>
      <div v-if="unavailable" class="history-log-state"><strong>日志不可用</strong><p>{{ unavailable }}</p><t-button variant="outline" size="small" @click="emit('refresh')">重新读取日志</t-button></div>
      <div v-else-if="error" class="history-log-state" role="alert"><strong>日志读取失败</strong><p>{{ error }}</p><t-button variant="outline" size="small" @click="emit('refresh')">重试读取日志</t-button></div>
      <template v-else>
        <div class="history-log-body">
          <HistoryLogViewport v-if="text" ref="viewport" :stages="result.stages" :closed="closed" :wrap="wrap" :current="current" :follow="follow" :label="`${title}日志`" :log-class="logClass" @toggle="toggleStage" @scroll="onScroll" />
          <p v-else class="history-log-empty" role="status">{{ loading ? '读取日志…' : '暂无日志' }}</p>
          <div v-if="text" class="history-log-scroller"><button type="button" aria-label="滚动到日志顶部" title="滚动到顶部" @click="scrollTop"><t-icon name="chevron-up" /></button><button type="button" aria-label="滚动到日志底部" title="滚动到底部" @click="setFollow(true)"><t-icon name="chevron-down" /></button></div>
        </div>
      </template>
      <footer class="history-log-footer"><span>本地 Mock 日志</span><span>{{ follow ? '跟随新增日志' : '已暂停跟随' }}<template v-if="loading"> · 正在刷新</template></span></footer>
    </section>
  </Teleport>
</template>

<style scoped>
.history-log-viewer{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;height:100%;overflow:hidden;background:#171a21;color:#cfd8e3;outline:none}
.history-log-viewer.is-expanded{position:fixed;inset:0;z-index:2000;height:100dvh;width:100vw}
.history-log-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:12px;flex:none;padding:8px 12px;background:#fff;color:#000a14;border-bottom:1px solid #e6e9ef;font-size:12px}
.history-log-toolbar>strong{margin-right:auto;font-size:12px;overflow-wrap:anywhere;min-width:0}
.history-log-worker{font-weight:400;color:#697586}
.history-log-toolbar :deep(.t-checkbox__label){font-size:12px}
.history-log-expand{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:4px;background:transparent;color:#596168;cursor:pointer}
.history-log-expand:hover{background:#e8f0fe;color:#0066cc}
.history-log-search{display:flex;align-items:center;gap:6px;padding:6px 12px;border-bottom:1px solid #343b48;flex:none;min-width:0}
.history-log-search :deep(.t-input__wrap){flex:1;min-width:80px}
.history-log-search :deep(.t-input){height:30px;background:transparent;border-color:transparent;color:#cfd8e3}
.history-log-search :deep(.t-input__inner){color:#d8e1ed}
.history-log-search :deep(.t-input__inner::placeholder){color:#9aa4b2}
.history-log-search :deep(.t-input__prefix .t-icon),.history-log-search :deep(.t-input__suffix .t-icon){color:#9aa4b2}
.history-log-search :deep(.t-input--focused){border-color:#459eff}
.history-log-search>button,.history-log-scroller button{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid #424a58;border-radius:3px;color:#d8e1ed;background:#252c38;cursor:pointer}
.history-log-search>button:disabled{opacity:.4;cursor:default}
.history-log-count{flex:none;font-size:12px;color:#b5bfcc;min-width:72px;text-align:right}
.history-log-body{position:relative;display:flex;flex:1;min-height:0;overflow:hidden}
.history-log-scroller{position:absolute;right:14px;bottom:16px;display:flex;flex-direction:column;gap:4px}
.history-log-footer{display:flex;justify-content:space-between;gap:12px;flex:none;padding:5px 16px;border-top:1px solid #343b48;font-size:11px;color:#9aa4b2}
.history-log-empty{padding:16px;color:#9aa4b2;font-size:12px}
.history-log-state{display:flex;flex:1;min-height:120px;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;font-size:13px}
.history-log-state p{max-width:540px;color:#9aa4b2;line-height:20px}
@media(max-width:1280px){.history-log-toolbar{gap:8px}.history-log-toolbar>strong{flex-basis:100%}.history-log-toolbar .history-log-expand{margin-left:auto}}
</style>
