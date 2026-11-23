<script setup lang="ts">
withDefaults(defineProps<{
  workload: boolean
  scalable: boolean
  secret: boolean
  allowDelete: boolean
  disabled?: boolean
  revealing?: boolean
}>(), { disabled: false, revealing: false })
const emit = defineEmits<{ action: [value: 'restart' | 'scale' | 'delete']; reveal: [] }>()
</script>

<template>
  <div class="rpanel__actions resource-detail-actions">
    <div v-if="workload || scalable || secret" class="resource-detail-actions__primary">
      <t-button v-if="workload" size="small" variant="text" :disabled="disabled" @click="emit('action', 'restart')">
        <template #icon><t-icon name="refresh" /></template>重启
      </t-button>
      <t-dropdown v-if="scalable || secret" trigger="click" placement="bottom-left" :disabled="disabled">
        <t-button size="small" variant="text" :disabled="disabled" aria-label="更多资源操作"><t-icon name="more" /></t-button>
        <t-dropdown-menu>
          <t-dropdown-item v-if="scalable" :disabled="disabled" @click="emit('action', 'scale')"><t-icon name="layers" />扩缩容</t-dropdown-item>
          <t-dropdown-item v-if="secret" :disabled="disabled || revealing" @click="emit('reveal')"><t-icon name="visible" />查看明文</t-dropdown-item>
        </t-dropdown-menu>
      </t-dropdown>
    </div>
    <t-button v-if="allowDelete" class="resource-detail-actions__delete" size="small" variant="text" theme="danger" :disabled="disabled" @click="emit('action', 'delete')">
      <template #icon><t-icon name="delete" /></template>删除
    </t-button>
  </div>
</template>

<style scoped>
.resource-detail-actions{display:flex;align-items:center;gap:12px;flex:1;min-width:max-content;height:32px}.resource-detail-actions__primary{display:flex;align-items:center;gap:2px;padding-left:12px;border-left:1px solid var(--tk-border)}.resource-detail-actions__delete{margin-left:auto}.resource-detail-actions :deep(.t-button){height:28px;padding:0 4px;font-size:12px}
</style>
