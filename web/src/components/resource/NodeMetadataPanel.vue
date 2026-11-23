<script setup lang="ts">
import { computed, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { NodeDetail } from '@/types'
const props = defineProps<{ detail: NodeDetail }>()
const emit = defineEmits<{ editTaints: [] }>()
const tab = ref(0), expanded = ref([false, false, false])
const rows = computed(() => tab.value === 2 ? props.detail.taints : (tab.value === 0 ? props.detail.labels : props.detail.annotations).map(text => {
  const equal = text.indexOf('=')
  return { key: equal === -1 ? text : text.slice(0, equal), value: equal === -1 ? '' : text.slice(equal + 1), effect: '' }
}))
const visible = computed(() => expanded.value[tab.value] ? rows.value : rows.value.slice(0, 10))
async function copy(text: string) { try { await navigator.clipboard.writeText(text); void MessagePlugin.success('已复制') } catch { void MessagePlugin.error('复制失败，请手动选择文本') } }
</script>
<template>
  <section class="node-metadata">
    <header><div role="tablist" aria-label="节点元数据"><button v-for="(label, index) in [`标签 (${detail.labels.length})`, `注解 (${detail.annotations.length})`, `Taints (${detail.taints.length})`]" :key="index" type="button" role="tab" :aria-selected="tab === index" :class="{ active: tab === index }" @click="tab = index">{{ label }}</button></div><t-button v-if="tab === 2" size="small" variant="text" @click="emit('editTaints')"><t-icon name="edit" />编辑</t-button></header>
    <div class="node-metadata__body">
      <p v-if="!rows.length" class="node-metadata__empty">{{ ['No labels', 'No annotations', 'No taints'][tab] }}</p>
      <div v-if="tab === 2 && rows.length" class="node-metadata__row node-metadata__heading"><span>Key | Value</span><span>Effect</span></div>
      <div v-for="row in visible" :key="`${row.key}-${row.effect}`" class="node-metadata__row" :class="{ 'node-metadata__row--taint': tab === 2 }">
        <div class="node-metadata__pair"><span class="node-metadata__key">{{ row.key }}</span><span v-if="row.value" class="node-metadata__value">{{ row.value }}</span><button type="button" :aria-label="`复制 ${row.key}`" @click="copy(`${row.key}=${row.value}`)"><t-icon name="file-copy" /></button></div>
        <div v-if="tab === 2" class="node-metadata__effect">{{ row.effect }}<button type="button" :aria-label="`复制 ${row.effect}`" @click="copy(row.effect)"><t-icon name="file-copy" /></button></div>
      </div>
      <button v-if="rows.length > 10" type="button" class="node-metadata__more" @click="expanded[tab] = !expanded[tab]">{{ expanded[tab] ? '收起' : `显示全部 (${rows.length})` }}<t-icon :name="expanded[tab] ? 'chevron-up' : 'chevron-down'" /></button>
    </div>
  </section>
</template>
<style scoped>
.node-metadata{border:1px solid var(--tk-border);border-radius:4px;background:#fff;overflow:hidden}.node-metadata>header{display:flex;justify-content:space-between;align-items:center;min-height:38px;padding:0 16px;border-bottom:1px solid var(--tk-border)}.node-metadata>header>div{display:flex;gap:20px}.node-metadata>header button[role=tab]{height:38px;padding:0;border:0;border-bottom:2px solid transparent;background:none;color:var(--tk-text-2);font:inherit;font-size:13px;cursor:pointer}.node-metadata>header button.active{color:var(--tk-primary);border-bottom-color:var(--tk-primary);font-weight:600}.node-metadata__body{padding:16px 20px}.node-metadata__row{display:flex;align-items:start;gap:8px;margin-bottom:8px;font-size:12px}.node-metadata__row--taint,.node-metadata__heading{display:grid;grid-template-columns:minmax(0,1fr) 150px;gap:16px}.node-metadata__pair{display:flex;align-items:center;min-width:0;max-width:100%;flex-wrap:wrap}.node-metadata__key,.node-metadata__value{padding:2px 6px;overflow-wrap:anywhere;min-width:0;border:1px solid #d0d4d9}.node-metadata__key{background:#f2f4f7;border-radius:4px 0 0 4px}.node-metadata__value{border-left:0;border-radius:0 4px 4px 0}.node-metadata__pair>button,.node-metadata__effect>button{opacity:0;margin-left:8px;padding:0;border:0;background:none;color:var(--tk-text-2);cursor:pointer}.node-metadata__pair:hover>button,.node-metadata__effect:hover>button,.node-metadata__pair>button:focus-visible,.node-metadata__effect>button:focus-visible{opacity:1}.node-metadata__effect{padding-top:3px;overflow-wrap:anywhere}.node-metadata__heading{font-weight:600;color:var(--tk-text-2)}.node-metadata__empty{margin:0;color:var(--tk-text-3);font-size:13px}.node-metadata__more{display:flex;align-items:center;gap:4px;border:0;padding:0;background:none;color:var(--tk-primary);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
</style>
