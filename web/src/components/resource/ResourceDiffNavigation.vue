<script setup lang="ts">
import type { ManifestDiffPosition } from '@/utils/resourceYamlMerge'
defineProps<ManifestDiffPosition>()
const emit = defineEmits<{ navigate: [direction: number] }>()
</script>

<template>
  <div class="resource-diff-navigation">
    <span role="status">{{ !total ? '没有配置差异' : current ? `${current} / ${total}` : `${total} 处差异` }}</span>
    <t-button size="small" variant="text" aria-label="上一处差异" title="上一处差异（Shift+F7）" :disabled="!total" @click="emit('navigate', -1)"><t-icon name="chevron-up" /></t-button>
    <t-button size="small" variant="text" aria-label="下一处差异" title="下一处差异（F7）" :disabled="!total" @click="emit('navigate', 1)"><t-icon name="chevron-down" /></t-button>
  </div>
</template>

<style scoped>
.resource-diff-navigation{display:flex;align-items:center;gap:4px;margin-left:auto;font-size:11px;color:#bbb;white-space:nowrap}.resource-diff-navigation :deep(.t-button){width:24px;height:24px;padding:0;color:#bbb}.resource-diff-navigation :deep(.t-button:hover){color:#fff;background:#444}.resource-diff-navigation :deep(.t-is-disabled){opacity:.35}
</style>
