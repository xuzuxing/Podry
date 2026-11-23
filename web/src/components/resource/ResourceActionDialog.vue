<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { getNodeDetail, performResourceAction } from '@/api'
import type { K8sResource, NodeTaint } from '@/types'
import type { ResourceAction } from './listTypes'
const props = defineProps<{ visible: boolean; clusterId: string; targets: K8sResource[]; action: ResourceAction }>()
const emit = defineEmits<{ 'update:visible': [value: boolean]; completed: [deletedUids: string[]] }>()
const confirmation = ref('')
const replicas = ref(1)
const force = ref(false)
const ignoreDaemonSets = ref(true)
const deleteEmptyDirData = ref(false)
const taints = ref<NodeTaint[]>([])
const loading = ref(false)
const error = ref('')
const completedUids = new Set<string>()
const titles: Record<ResourceAction, string> = { delete: '删除资源', restart: '重启工作负载', scale: '扩缩容', cordon: 'Cordon 节点', uncordon: 'Uncordon 节点', drain: 'Drain 节点', taints: 'Edit taints' }
const title = computed(() => titles[props.action])
const keyword = computed(() => props.targets.length === 1 ? props.targets[0]?.ref.name ?? '' : 'delete')
const valid = computed(() => props.targets.length > 0 && (props.action !== 'delete' || confirmation.value === keyword.value) && (props.action !== 'scale' || Number.isInteger(replicas.value) && replicas.value >= 0))
watch(() => props.visible, async (visible) => {
  if (!visible) return
  confirmation.value = ''; error.value = ''; force.value = false
  ignoreDaemonSets.value = true; deleteEmptyDirData.value = false
  replicas.value = Number(/^\s*replicas:\s*(\d+)/m.exec(props.targets[0]?.manifest ?? '')?.[1] ?? 1)
  taints.value = []
  completedUids.clear()
  if (props.action === 'taints' && props.targets[0]) {
    loading.value = true
    try { taints.value = (await getNodeDetail(props.clusterId, props.targets[0].ref.name)).taints }
    catch (err) { error.value = err instanceof Error ? err.message : 'Taints 加载失败' }
    finally { loading.value = false }
  }
})
async function submit(): Promise<void> {
  if (!valid.value || loading.value) return
  loading.value = true; error.value = ''
  const deleted: string[] = []
  const failed: K8sResource[] = []
  try {
    for (const target of props.targets) {
      if (completedUids.has(target.ref.uid)) continue
      try {
        await performResourceAction(props.clusterId, { ref: target.ref, action: props.action, replicas: replicas.value, force: force.value, ignoreDaemonSets: ignoreDaemonSets.value, deleteEmptyDirData: deleteEmptyDirData.value, taints: taints.value })
        if (props.action === 'delete') deleted.push(target.ref.uid)
        completedUids.add(target.ref.uid)
      } catch (err) {
        failed.push(target)
        error.value += `${target.ref.name}: ${err instanceof Error ? err.message : '操作失败'}\n`
      }
    }
    emit('completed', deleted)
    if (!failed.length) { emit('update:visible', false); void MessagePlugin.success(`${title.value}已完成（本地 Mock）`) }
  } finally { loading.value = false }
}
</script>
<template>
  <t-dialog :visible="visible" :header="title" width="560px" :footer="false" :close-on-overlay-click="!loading" :close-btn="!loading" :close-on-esc-keydown="!loading" @close="emit('update:visible', false)">
    <div class="resource-action">
      <t-alert v-if="error" theme="error" :message="error" />
      <p v-if="action === 'delete'">此操作不可恢复。由控制器管理的 Pod 可能被重新创建。</p>
      <p v-else-if="action === 'restart'">将更新工作负载 Pod 模板，按其更新策略重新创建 Pod。</p>
      <p v-else-if="action === 'cordon'">禁止新 Pod 调度到此节点，现有 Pod 继续运行。</p>
      <p v-else-if="action === 'uncordon'">恢复调度，允许新 Pod 调度到此节点。</p>
      <p v-else-if="action === 'drain'">先禁止调度，再驱逐节点上的 Pod。请确认其他节点有足够容量。</p>
      <div class="resource-action__targets"><div v-for="target in targets" :key="target.ref.uid"><strong>{{ target.kind }}</strong><code>{{ target.ref.namespace === '_cluster' ? '' : `${target.ref.namespace}/` }}{{ target.ref.name }}</code></div></div>
      <template v-if="action === 'delete'"><t-checkbox v-model="force">Force delete（立即删除，不等待优雅终止）</t-checkbox><label class="resource-action__field"><span>输入 <strong>{{ keyword }}</strong> 以确认删除</span><t-input v-model="confirmation" autofocus aria-label="删除确认名称" @enter="submit" /></label></template>
      <template v-else-if="action === 'scale'"><t-alert theme="info" message="存在 HPA 时，自动扩缩容可能覆盖这里设置的副本数。" /><label class="resource-action__field"><span>副本数</span><t-input-number v-model="replicas" :min="0" :max="10000" theme="normal" aria-label="副本数" /></label></template>
      <template v-else-if="action === 'drain'"><t-checkbox v-model="ignoreDaemonSets">忽略 DaemonSet 管理的 Pod</t-checkbox><t-checkbox v-model="deleteEmptyDirData">允许删除使用 emptyDir 数据的 Pod</t-checkbox><t-checkbox v-model="force">强制驱逐没有控制器的 Pod</t-checkbox></template>
      <template v-else-if="action === 'taints'"><p class="u-muted">提交后以此列表替换节点 Taints。</p><div v-for="(taint, index) in taints" :key="index" class="taint-row"><t-input v-model="taint.key" placeholder="Key" /><t-input v-model="taint.value" placeholder="Value" /><t-select v-model="taint.effect" :options="['NoSchedule','PreferNoSchedule','NoExecute'].map((value) => ({label:value,value}))" /><t-button variant="text" shape="square" @click="taints.splice(index, 1)"><t-icon name="delete" /></t-button></div><t-button variant="outline" @click="taints.push({ key: '', value: '', effect: 'NoSchedule' })">添加 Taint</t-button></template>
      <footer><t-button variant="outline" :disabled="loading" @click="emit('update:visible', false)">取消</t-button><t-button :theme="action === 'delete' ? 'danger' : 'primary'" :loading="loading" :disabled="!valid" @click="submit">{{ action === 'delete' ? '确认删除' : '确认' }}</t-button></footer>
    </div>
  </t-dialog>
</template>
<style scoped>
.resource-action{display:flex;flex-direction:column;gap:16px}.resource-action p{margin:0;line-height:22px}.resource-action__field{display:flex;flex-direction:column;gap:8px}.resource-action__targets{max-height:200px;overflow:auto;background:#f5f7fa;padding:12px;border:1px solid var(--tk-border);border-radius:4px}.resource-action__targets div{display:flex;gap:12px;padding:4px 0}.resource-action code{overflow-wrap:anywhere}.resource-action footer{display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--tk-border);padding-top:16px}.taint-row{display:flex;gap:8px}.taint-row>*{min-width:0;flex:1}
</style>
