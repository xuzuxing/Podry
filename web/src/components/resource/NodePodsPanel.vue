<script setup lang="ts">
import { computed, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { NodePodRow } from '@/types'
import { sortedNodePods } from '@/utils/clusterTerminal'
const props = defineProps<{ pods: NodePodRow[] }>()
const emit = defineEmits<{ open: [namespace: string, name: string] }>()
const key = ref<keyof NodePodRow>('name'), descending = ref(false)
const columns: { key: keyof NodePodRow; label: string }[] = [{ key: 'namespace', label: '命名空间' }, { key: 'name', label: 'Pod' }, { key: 'cpuRequest', label: 'CPU 请求' }, { key: 'cpuLimit', label: 'CPU 限制' }, { key: 'memRequest', label: '内存请求' }, { key: 'memLimit', label: '内存限制' }, { key: 'age', label: '存活时间' }]
const rows = computed(() => sortedNodePods(props.pods, key.value, descending.value))
function sort(next: keyof NodePodRow) { descending.value = next === key.value ? !descending.value : false; key.value = next }
async function copy(name: string) { try { await navigator.clipboard.writeText(name); void MessagePlugin.success('Pod 名称已复制') } catch { void MessagePlugin.error('复制失败，请手动选择文本') } }
</script>
<template>
  <section class="node-pods"><h3>Pod（本节点）</h3><div class="node-pods__scroll" tabindex="0"><table><thead><tr><th v-for="column in columns" :key="column.key" :aria-sort="key === column.key ? descending ? 'descending' : 'ascending' : 'none'"><button type="button" @click="sort(column.key)">{{ column.label }}<t-icon :name="key === column.key ? descending ? 'chevron-down' : 'chevron-up' : 'unfold-more'" /></button></th></tr></thead><tbody><tr v-for="pod in rows" :key="`${pod.namespace}/${pod.name}`"><td>{{ pod.namespace }}</td><td><div class="node-pods__name"><button type="button" class="node-pods__link" :title="pod.name" @click="emit('open', pod.namespace, pod.name)">{{ pod.name }}</button><button type="button" class="node-pods__copy" :aria-label="`复制 Pod ${pod.name}`" @click="copy(pod.name)"><t-icon name="file-copy" /></button></div></td><td>{{ pod.cpuRequest }}</td><td>{{ pod.cpuLimit }}</td><td>{{ pod.memRequest }}</td><td>{{ pod.memLimit }}</td><td>{{ pod.age }}</td></tr><tr v-if="!rows.length"><td colspan="7" class="node-pods__empty">该节点没有运行中的 Pod</td></tr></tbody></table></div></section>
</template>
<style scoped>
.node-pods{border:1px solid var(--tk-border);border-radius:4px;background:#fff;overflow:hidden}.node-pods>h3{margin:0;padding:12px 20px;font-size:14px;font-weight:600}.node-pods__scroll{overflow:auto;outline:none}.node-pods table{width:100%;min-width:950px;border-collapse:collapse;text-align:left;font-size:12px}.node-pods th,.node-pods td{padding:8px 12px;border-top:1px solid #edf0f4;white-space:nowrap}.node-pods th>button{display:flex;align-items:center;gap:4px;border:0;padding:0;background:none;color:var(--tk-text-2);font:inherit;font-weight:600;cursor:pointer}.node-pods__name{display:flex;align-items:center;gap:8px}.node-pods__link{display:block;max-width:260px;overflow:hidden;text-overflow:ellipsis;padding:0;border:0;background:none;color:var(--tk-primary);font:inherit;cursor:pointer}.node-pods__link:hover{text-decoration:underline}.node-pods__copy{opacity:0;border:0;padding:0;background:none;color:var(--tk-text-2);cursor:pointer}.node-pods__name:hover .node-pods__copy,.node-pods__copy:focus-visible{opacity:1}.node-pods__empty{text-align:center;color:var(--tk-text-3);height:100px}
</style>
