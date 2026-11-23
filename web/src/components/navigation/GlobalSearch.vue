<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { listApplications, listClusters, listProjects } from '@/api'
import type { Application, Cluster, Project } from '@/types'
const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [value: boolean] }>()
const router = useRouter()
const keyword = ref('')
const loading = ref(false)
const error = ref('')
const index = ref(0)
const apps = ref<Application[]>([])
const clusters = ref<Cluster[]>([])
const projects = ref<Project[]>([])
const results = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return [
    ...apps.value.map((app) => ({ id: app.id, label: app.name, group: '应用', icon: 'app', path: `/projects/${app.projectId}/apps/${app.id}/overview` })),
    ...clusters.value.map((cluster) => ({ id: cluster.id, label: cluster.name, group: '集群', icon: 'server', path: `/clusters/${cluster.id}` })),
    ...projects.value.map((project) => ({ id: project.id, label: project.name, group: '项目', icon: 'folder', path: `/projects/${project.id}` })),
  ].filter((item) => !query || `${item.label} ${item.group}`.toLowerCase().includes(query)).slice(0, 15)
})
async function load(): Promise<void> {
  keyword.value = ''; index.value = 0; loading.value = true; error.value = ''
  try {
    const [applications, clusterList, projectList] = await Promise.all([listApplications({ pageSize: 500 }), listClusters(), listProjects()])
    apps.value = applications.items; clusters.value = clusterList; projects.value = projectList
  } catch (err) { error.value = err instanceof Error ? err.message : '搜索加载失败' }
  finally { loading.value = false }
}
function select(position: number): void {
  const item = results.value[position]
  if (!item) return
  emit('update:visible', false); void router.push(item.path)
}
function onKey(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const count = results.value.length
    index.value = count ? (index.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count : 0
  } else if (event.key === 'Enter') { event.preventDefault(); select(index.value) }
}
watch(() => props.visible, (visible) => { if (visible) void load() })
watch(keyword, () => { index.value = 0 })
</script>
<template>
  <t-dialog :visible="visible" :footer="false" :header="false" width="640px" top="15vh" :close-btn="false" @close="emit('update:visible', false)">
    <div class="command-search" @keydown="onKey">
      <t-input v-model="keyword" autofocus placeholder="搜索应用、集群、项目…" aria-label="搜索应用、集群、项目" size="large" clearable><template #prefix-icon><t-icon name="search" /></template><template #suffix><kbd>Esc</kbd></template></t-input>
      <t-loading :loading="loading">
        <p v-if="error" role="alert">{{ error }} <t-button variant="text" @click="load">重试</t-button></p>
        <div v-else class="command-search__results" role="listbox" aria-label="搜索结果">
          <button v-for="(item, position) in results" :key="item.id" role="option" :aria-selected="index === position" :class="{ selected: index === position }" @mousemove="index = position" @click="select(position)"><t-icon :name="item.icon" /><span>{{ item.label }}</span><small>{{ item.group }}</small><t-icon v-if="position === index" name="enter" /></button>
          <p v-if="!loading && !results.length">没有匹配结果</p>
        </div>
      </t-loading>
      <footer>↑ ↓ 选择 <span>Enter 打开</span><span>Ctrl / ⌘ K 搜索</span></footer>
    </div>
  </t-dialog>
</template>
<style scoped>
.command-search{margin:-8px}.command-search kbd{font-size:11px;color:var(--tk-text-3)}.command-search__results{max-height:420px;overflow:auto;padding:8px 0}.command-search__results button{display:flex;align-items:center;gap:12px;width:100%;padding:12px;font:inherit;text-align:left;border:0;background:none;border-radius:4px;cursor:pointer}.command-search__results button.selected{background:var(--tk-primary-weak);color:var(--tk-primary)}.command-search small{margin-left:auto;color:var(--tk-text-2)}.command-search footer{display:flex;gap:20px;border-top:1px solid var(--tk-border);padding:12px 4px 0;color:var(--tk-text-3);font-size:11px}
</style>
