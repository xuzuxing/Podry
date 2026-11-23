<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { listEvents } from '@/api'
import type { ResourceEvent } from '@/types'
import { fmtRelative } from '@/utils/format'
const props = defineProps<{ uid: string; active: boolean; refreshKey: number }>()
const emit = defineEmits<{ loaded: [count: number] }>()
const events = shallowRef<ResourceEvent[]>([]), loading = shallowRef(false), error = shallowRef('')
const sorted = computed(() => [...events.value].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt)))
let generation = 0
async function reload(): Promise<void> {
  const request = ++generation
  if (!props.active) { loading.value = false; return }
  loading.value = true; error.value = ''; events.value = []
  try { const found = await listEvents(props.uid); if (request !== generation) return; events.value = found; emit('loaded', found.length) }
  catch (err) { if (request === generation) error.value = err instanceof Error ? err.message : '事件读取失败' }
  finally { if (request === generation) loading.value = false }
}
watch(() => [props.uid, props.active, props.refreshKey], () => void reload(), { immediate: true })
onBeforeUnmount(() => generation++)
</script>

<template>
  <section class="resource-events" aria-label="资源事件工作区">
    <div class="resource-events__tools"><span>Kubernetes 事件 · 最近发生优先</span><t-button variant="text" size="small" :loading="loading" @click="reload"><template #icon><t-icon name="refresh" /></template>刷新事件</t-button></div>
    <div v-if="loading" class="resource-events__state"><t-loading size="small" />正在读取事件…</div>
    <div v-else-if="error" class="resource-events__state" role="alert">{{ error }}<t-button size="small" @click="reload">重试</t-button></div>
    <div v-else-if="!events.length" class="resource-events__state">该资源最近没有产生 Kubernetes 事件。</div>
    <div v-else class="resource-events__scroll" tabindex="0">
      <table><thead><tr><th aria-label="类型"></th><th>原因</th><th>消息</th><th>次数</th><th>年龄</th><th>最近发生</th></tr></thead><tbody>
        <tr v-for="(event, index) in sorted" :key="index"><td><t-icon :name="event.type === 'Normal' ? 'info-circle-filled' : 'error-triangle'" :class="event.type === 'Normal' ? 'is-normal' : 'is-warning'" :title="event.type" :aria-label="event.type" /></td><td>{{ event.reason }}</td><td>{{ event.message }}</td><td>{{ event.count }}</td><td :title="event.firstSeenAt">{{ event.firstSeenAt ? fmtRelative(event.firstSeenAt) : '—' }}</td><td :title="event.lastSeenAt">{{ fmtRelative(event.lastSeenAt) }}</td></tr>
      </tbody></table>
    </div>
  </section>
</template>

<style scoped>
.resource-events { background: #181920; color: #fff; min-width: 0; min-height: 360px; }
.resource-events__tools { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 16px; border-bottom: 1px solid #293444; font-size: 12px; }
.resource-events__tools :deep(.t-button) { color: #8bbcf2; }
.resource-events__scroll { max-height: 60vh; overflow: auto; }
table { border-collapse: collapse; width: 100%; min-width: 760px; font-size: 14px; line-height: 1.5; table-layout: fixed; }
th, td { padding: 12px 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { position: sticky; top: 0; background: #181920; font-size: 12px; color: #afbac8; }
th:first-child { width: 52px; } th:nth-child(2) { width: 200px; } th:nth-child(4), th:nth-child(5), th:nth-child(6) { width: 80px; }
td:first-child { text-align: center; font-size: 19px; } tbody tr:nth-child(odd) { background: #202129; }
.is-normal { color: #5b9df2; } .is-warning { color: #ecad57; }
.resource-events__state { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 300px; font-size: 13px; }
</style>
