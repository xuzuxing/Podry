<script setup lang="ts">
import { computed } from 'vue'
import { Button as TButton } from 'tdesign-vue-next'
import { ChevronDownIcon, ChevronRightIcon, ArrowUpIcon, ArrowDownIcon, CloseIcon, CheckDoubleIcon, SwapIcon } from 'tdesign-icons-vue-next'
import type { CodeSearchAction, CodeSearchSnapshot, CodeSearchValues } from '@/utils/codeEditorSearch'

const props = defineProps<{ snapshot: CodeSearchSnapshot; expanded: boolean }>()
const emit = defineEmits<{ query: [patch: Partial<CodeSearchValues>]; action: [action: CodeSearchAction]; toggle: [] }>()
const toggles = [
  { key: 'caseSensitive', label: '区分大小写', symbol: 'Aa' },
  { key: 'wholeWord', label: '全词匹配', symbol: 'ab' },
  { key: 'regexp', label: '使用正则表达式', symbol: '.*' },
] as const
const status = computed(() => !props.snapshot.valid && props.snapshot.query.search ? '正则表达式无效' : props.snapshot.count ? `${props.snapshot.current || '?'} / ${props.snapshot.count}` : '无结果')
function input(key: 'search' | 'replace', event: Event) { emit('query', { [key]: (event.target as HTMLInputElement).value }) }
</script>

<template>
  <div class="code-search" role="search" aria-label="编辑器查找与替换">
    <TButton v-if="!snapshot.readonly" class="code-search__expand" variant="text" size="small" aria-label="展开或收起替换" title="展开或收起替换" :aria-expanded="expanded" @click="emit('toggle')">
      <ChevronDownIcon v-if="expanded" /><ChevronRightIcon v-else />
    </TButton>
    <div class="code-search__rows">
      <div class="code-search__row">
        <div class="code-search__field">
          <input name="search" main-field="true" aria-label="查找" placeholder="查找" autocomplete="off" spellcheck="false" :value="snapshot.query.search" :aria-invalid="!!snapshot.query.search && !snapshot.valid" @input="input('search', $event)" />
          <TButton v-for="toggle in toggles" :key="toggle.key" class="code-search__toggle" :class="{ 'is-checked': snapshot.query[toggle.key] }" variant="text" size="small" :aria-label="toggle.label" :title="toggle.label" :aria-pressed="snapshot.query[toggle.key]" @click="emit('query', { [toggle.key]: !snapshot.query[toggle.key] })">{{ toggle.symbol }}</TButton>
        </div>
        <span class="code-search__count" :class="{ 'is-empty': snapshot.query.search && !snapshot.count }" role="status" aria-live="polite" :title="status">{{ status }}</span>
        <div class="code-search__actions">
          <TButton variant="text" size="small" name="prev" aria-label="上一项" title="上一项（Shift+Enter）" :disabled="!snapshot.count" @click="emit('action', 'previous')"><ArrowUpIcon /><span class="code-search__sr">上一项</span></TButton>
          <TButton variant="text" size="small" name="next" aria-label="下一项" title="下一项（Enter）" :disabled="!snapshot.count" @click="emit('action', 'next')"><ArrowDownIcon /><span class="code-search__sr">下一项</span></TButton>
          <TButton variant="text" size="small" name="select" aria-label="选择全部匹配" title="选择全部匹配" :disabled="!snapshot.count || snapshot.count > 1000" @click="emit('action', 'select')"><CheckDoubleIcon /><span class="code-search__sr">全部</span></TButton>
        </div>
        <TButton class="code-search__close" variant="text" size="small" name="close" aria-label="关闭查找" title="关闭查找（Esc）" @click="emit('action', 'close')"><CloseIcon /></TButton>
      </div>
      <div v-if="expanded && !snapshot.readonly" class="code-search__row">
        <div class="code-search__field"><input name="replace" aria-label="替换为" placeholder="替换为…" autocomplete="off" spellcheck="false" :value="snapshot.query.replace" @input="input('replace', $event)" /></div>
        <div class="code-search__actions">
          <TButton variant="text" size="small" name="replace" aria-label="替换" title="替换（Enter）" :disabled="!snapshot.count" @click="emit('action', 'replace')"><SwapIcon /><span class="code-search__sr">替换</span></TButton>
          <TButton variant="text" size="small" name="replaceAll" aria-label="全部替换" title="全部替换（Ctrl/⌘+Alt+Enter）" :disabled="!snapshot.count" @click="emit('action', 'replaceAll')"><CheckDoubleIcon /><span class="code-search__sr">全部替换</span></TButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.code-search{display:flex;align-items:flex-start;gap:6px;padding:5px;border:1px solid var(--code-search-border,#b7c1cb);border-radius:4px;background:var(--code-search-bg,#f7fafc);color:var(--code-search-color,#3b444c);font-family:var(--td-font-family);font-size:12px;max-width:100%;box-sizing:border-box}.code-search__rows{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}.code-search__row{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}.code-search__field{display:flex;align-items:center;gap:2px;width:226px;min-width:90px;max-width:100%;height:28px;box-sizing:border-box;padding:2px 4px;border:1px solid var(--code-search-border,#b7c1cb);border-radius:2px;background:var(--code-search-input,#fff)}.code-search__field:focus-within{border-color:#448cff;box-shadow:0 0 0 1px #448cff}.code-search__field input{width:0;min-width:0;flex:1;border:0;outline:0;padding:0;background:transparent;color:inherit;font:inherit;line-height:20px}.code-search__field input::placeholder{color:var(--code-search-muted,#89949e)}.code-search__count{width:68px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}.code-search__count.is-empty{color:var(--code-search-error,#d54941)}.code-search__actions{display:flex;gap:4px}.code-search :deep(.t-button){width:24px;min-width:24px;height:24px;padding:0;color:inherit;flex:none;border:1px solid transparent;background:transparent}.code-search :deep(.t-button:hover:not(:disabled)){background:#448cff22}.code-search :deep(.t-button:disabled){opacity:.4}.code-search :deep(.t-button:focus-visible){outline:2px solid #448cff;outline-offset:1px}.code-search :deep(.t-icon){font-size:14px}.code-search :deep(.code-search__toggle){width:20px;min-width:20px;height:20px;font:12px var(--tk-mono)}.code-search :deep(.is-checked){border-color:#448cff;background:#448cff22;color:var(--code-search-selected,#0066cc)}.code-search__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.code-search__close{margin-left:auto}
</style>
