<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PipelineTask } from '@/types'
import { applyTaskPlugin, createTask, taskCatalog } from '@/mock/taskCatalog'

const props = defineProps<{ count: number }>()
const emit = defineEmits<{ cancel: []; select: [task: PipelineTask] }>()
const search = ref('')
const category = ref('all')
const plugins = computed(() => taskCatalog.filter(item =>
  (category.value === 'all' || item.tag === category.value) && `${item.name} ${item.description}`.toLowerCase().includes(search.value.toLowerCase()),
))
const showCustom = computed(() => category.value === 'all' && (!search.value || /custom script shell container/i.test(search.value)))
function select(execution: PipelineTask['execution'], pluginId?: string): void {
  let task = createTask(execution, props.count)
  const plugin = taskCatalog.find(item => item.id === pluginId)
  if (plugin) task = applyTaskPlugin({ ...task, name: plugin.name }, plugin, plugin.versions[0]!)
  emit('select', task)
}
</script>
<template>
  <section class="task-catalog-panel">
    <header class="task-catalog-panel__header"><strong>添加任务</strong><t-button variant="text" size="small" @click="emit('cancel')">返回任务</t-button></header>
    <div class="task-catalog">
      <h3>What do you want this task to do?</h3>
      <div class="task-catalog__filters">
        <t-input v-model="search" clearable placeholder="搜索任务" aria-label="搜索任务"><template #prefix-icon><t-icon name="search" /></template></t-input>
        <t-select v-model="category" aria-label="任务分类" :options="[{label:'所有任务',value:'all'},{label:'Build',value:'Build'},{label:'Utilities',value:'Utilities'}]" />
      </div>
      <div v-if="showCustom" class="stage-task-types">
        <button @click="select('shell')"><t-icon name="code" size="24px" /><strong>Custom script · Shell</strong><span>在流水线执行环境中运行 Shell 脚本。</span></button>
        <button @click="select('container')"><t-icon name="server" size="24px" /><strong>Custom script · Container</strong><span>在指定容器镜像中运行脚本。</span></button>
      </div>
      <p class="task-catalog__caption">Plugins <span>本地示例目录</span></p>
      <button v-for="plugin in plugins" :key="plugin.id" class="task-catalog__plugin" @click="select('shell', plugin.id)">
        <t-icon name="extension" size="24px" /><div><strong>{{ plugin.name }}</strong><p>{{ plugin.description }}</p></div><t-tag size="small">{{ plugin.tag }}</t-tag><t-icon name="chevron-right" />
      </button>
      <t-empty v-if="!showCustom && !plugins.length" description="没有匹配的任务，请调整搜索或分类" />
    </div>
  </section>
</template>
<style scoped>
.task-catalog-panel{flex:1;min-width:0;overflow:auto;padding:20px}.task-catalog-panel__header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.task-catalog{display:flex;flex-direction:column;gap:16px}.task-catalog h3{font-size:14px;margin:0}.task-catalog__filters{display:grid;grid-template-columns:1fr 160px;gap:12px}.stage-task-types{display:flex;gap:16px}.stage-task-types button{display:flex;flex:1;flex-direction:column;align-items:flex-start;gap:12px;padding:16px;text-align:left;font:inherit;background:#fff;border:1px solid var(--tk-border);border-radius:4px;cursor:pointer}.stage-task-types span{font-size:12px;color:var(--tk-text-2)}.stage-task-types button:hover,.task-catalog__plugin:hover{border-color:var(--tk-primary);background:var(--tk-primary-weak)}.task-catalog__caption{display:flex;justify-content:space-between;margin:0;font-weight:600}.task-catalog__caption span{font-size:12px;font-weight:400;color:var(--tk-text-2)}.task-catalog__plugin{display:flex;align-items:center;gap:16px;border:1px solid var(--tk-border);border-radius:4px;background:white;padding:16px;font:inherit;text-align:left;cursor:pointer}.task-catalog__plugin>div:not(.t-tag){flex:1}.task-catalog__plugin p{margin:6px 0 0;color:var(--tk-text-2);font-size:12px}
</style>
