<script setup lang="ts">
import type { TaskContainerConfig } from '@/types'
const props = defineProps<{ config: TaskContainerConfig; kind: 'ports' | 'paths' }>()
const emit = defineEmits<{ update: [patch: Partial<TaskContainerConfig>] }>()
function add(): void {
  emit('update', props.kind === 'ports'
    ? { ports: [{ hostPort: '', containerPort: '' }, ...props.config.ports] }
    : { hostPaths: [{ hostPath: '', containerPath: '' }, ...props.config.hostPaths] })
}
function update(index: number, side: 'left' | 'right', value: string): void {
  if (props.kind === 'ports') emit('update', { ports: props.config.ports.map((row,i) => i === index ? { ...row, [side === 'left' ? 'hostPort' : 'containerPort']: value } : row) })
  else emit('update', { hostPaths: props.config.hostPaths.map((row,i) => i === index ? { ...row, [side === 'left' ? 'hostPath' : 'containerPath']: value } : row) })
}
function remove(index: number): void {
  emit('update', props.kind === 'ports' ? { ports: props.config.ports.filter((_,i) => i !== index) } : { hostPaths: props.config.hostPaths.filter((_,i) => i !== index) })
}
</script>
<template>
  <div class="task-mappings" :data-kind="kind">
    <t-button variant="text" theme="primary" size="small" @click="add"><template #icon><t-icon name="add" /></template>{{ kind === 'ports' ? 'Add port' : 'Add mapping' }}</t-button>
    <div v-for="(row,index) in kind === 'ports' ? config.ports : config.hostPaths" :key="index" class="task-mapping-row">
      <t-input :value="'hostPort' in row ? row.hostPort : row.hostPath" :aria-label="`${kind === 'ports' ? 'Host port' : 'Host path'} ${index + 1}`" :placeholder="kind === 'ports' ? 'Host port' : '/host/directory'" @change="update(index,'left',String($event))" />
      <span>:</span>
      <t-input :value="'containerPort' in row ? row.containerPort : row.containerPath" :aria-label="`${kind === 'ports' ? 'Container port' : 'Container path'} ${index + 1}`" :placeholder="kind === 'ports' ? 'Container port' : '/container/directory'" @change="update(index,'right',String($event))" />
      <t-button variant="text" size="small" shape="square" :aria-label="`删除${kind === 'ports' ? '端口' : '目录'}映射 ${index + 1}`" @click="remove(index)"><t-icon name="close" /></t-button>
    </div>
  </div>
</template>
<style scoped>
.task-mappings{display:flex;flex-direction:column;gap:8px;min-width:0}.task-mappings>.t-button{align-self:flex-start;margin-left:-8px}.task-mapping-row{display:grid;grid-template-columns:minmax(0,1fr) 8px minmax(0,1fr) 24px;gap:6px;align-items:center}.task-mapping-row :deep(.t-input__wrap){min-width:0}
</style>
