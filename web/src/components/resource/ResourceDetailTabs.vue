<script setup lang="ts">
import { useTemplateRef } from 'vue'
import type { ResourceTabKey } from '@/stores/resourceTabs'
defineProps<{ tabs: Array<{ value: ResourceTabKey; label: string }>; active: ResourceTabKey }>()
const emit = defineEmits<{ select: [value: ResourceTabKey] }>()
const root = useTemplateRef<HTMLElement>('root')
function onKey(event: KeyboardEvent): void {
  if (event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const buttons = [...root.value!.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const current = buttons.indexOf(event.target as HTMLButtonElement)
  if (current < 0) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}
</script>
<template>
  <div ref="root" class="resource-detail-tabs" role="tablist" aria-label="资源详情" @keydown="onKey">
    <button v-for="item in tabs" :key="item.value" type="button" role="tab" class="rpanel__tab" :aria-selected="active === item.value" :class="{ 'rpanel__tab--active': active === item.value }" @click="emit('select', item.value)">{{ item.label }}</button>
  </div>
</template>
<style scoped>
.resource-detail-tabs{display:flex;align-items:center;flex:none;gap:20px;height:32px}.rpanel__tab{position:relative;height:32px;padding:0;color:#596168;font:inherit;font-size:12px;background:none;border:0;cursor:pointer}.rpanel__tab:hover,.rpanel__tab--active{color:#0066cc}.rpanel__tab--active{font-weight:600}.rpanel__tab--active:after{position:absolute;right:0;bottom:0;left:0;height:2px;background:#0066cc;content:''}
</style>
