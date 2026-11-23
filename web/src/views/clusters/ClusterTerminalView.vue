<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getCluster, listNamespace, listResources } from '@/api'
import type { Cluster, K8sResource } from '@/types'
import ErrorState from '@/components/ErrorState.vue'
import ClusterTerminalWorkspace from '@/components/resource/ClusterTerminalWorkspace.vue'
import { terminalSelection } from '@/utils/clusterTerminal'
import type { ClusterTerminalSelection } from '@/utils/clusterTerminal'
import { useRouter } from 'vue-router'

const route = useRoute(), router = useRouter()
const clusterId = computed(() => String(route.params.clusterId ?? ''))
const cluster = ref<Cluster | null>(null), nodes = ref<K8sResource[]>([]), namespaces = ref<string[]>([]), loading = ref(false), error = ref('')
const selection = computed(() => terminalSelection(route.query, nodes.value.map(node => node.ref.name), namespaces.value))
let generation = 0
async function load() {
  const request = ++generation, id = clusterId.value
  loading.value = true; error.value = ''; cluster.value = null; nodes.value = []; namespaces.value = []
  try {
    const [found, nodeRows, namespaceRows] = await Promise.all([getCluster(id), listResources(id, { group: '', resource: 'nodes' }), listNamespace(id)])
    if (request !== generation) return
    if (!nodeRows.length || !namespaceRows.length) throw new Error('该集群没有可用节点或命名空间')
    cluster.value = found; nodes.value = nodeRows; namespaces.value = namespaceRows.map(item => item.name)
  } catch (cause) { if (request === generation) error.value = cause instanceof Error ? cause.message : '集群终端加载失败' }
  finally { if (request === generation) loading.value = false }
}
function select(value: Partial<ClusterTerminalSelection>) { void router.replace({ query: { ...route.query, ...selection.value, ...value } }) }
watch(clusterId, () => void load(), { immediate: true })
watch(selection, value => {
  if (cluster.value && Object.entries(value).some(([key, entry]) => route.query[key] !== entry)) void router.replace({ query: { ...route.query, ...value } })
})
onScopeDispose(() => { ++generation })
</script>

<template>
  <div class="term tk-panel">
    <Teleport to="#shell-breadcrumbs" defer><div class="term__crumb"><router-link :to="{ name: 'clusters' }">资源浏览器</router-link><span>/</span><router-link :to="{ name: 'cluster-workspace', params: { clusterId } }">{{ cluster?.name ?? clusterId }}</router-link><span>/</span><strong>集群终端</strong></div></Teleport>
    <Teleport to="#shell-page-actions" defer><t-button size="small" variant="text" @click="router.push({ name: 'cluster-workspace', params: { clusterId } })">返回工作区</t-button></Teleport>
    <ErrorState v-if="error" :message="error" @retry="load" />
    <div v-else-if="loading" class="term__loading"><t-loading />正在加载集群终端…</div>
    <ClusterTerminalWorkspace v-else-if="cluster" :key="clusterId" :cluster="cluster" :nodes="nodes" :namespaces="namespaces" :selection="selection" @select="select" />
  </div>
</template>

<style scoped>
.term{display:flex;flex-direction:column;min-height:calc(100dvh - 64px);margin:-12px -16px -24px;border:0;min-width:0}.term__crumb{display:flex;align-items:center;gap:6px;height:48px;font-size:13px}.term__crumb>a{color:var(--tk-text-2)}.term__crumb>a:hover{color:var(--tk-primary)}.term__crumb>span{color:var(--tk-text-3)}.term__loading{display:flex;align-items:center;justify-content:center;gap:12px;padding:80px}
</style>
