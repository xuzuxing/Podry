<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import ManagerNavigation from '@/components/navigation/ManagerNavigation.vue'
import GlobalSearch from '@/components/navigation/GlobalSearch.vue'
import ShellActions from '@/components/navigation/ShellActions.vue'

const route = useRoute()
const searchOpen = ref(false)
const managementOverview = computed(() => route.meta.managementOverview === true)
/** 对齐 Devtron 的左侧图标轨道：只放一级模块；展开菜单由 ManagerNavigation 管理。 */
const customHeader = computed(() => !managementOverview.value && (route.path.includes('/apps/') || /^\/clusters\/.+/.test(route.path)))
const moduleTitle = computed(() => managementOverview.value ? (route.path.startsWith('/clusters') ? '基础设施管理' : '应用管理') : route.path.startsWith('/clusters') ? 'Resource Browser' : route.path.startsWith('/settings') ? 'Global Configuration' : route.path.startsWith('/audit') ? 'Audit logs' : route.path.startsWith('/projects') ? 'Projects' : 'Applications')
/* 全局搜索：应用 / 集群 / 项目，刷新索引和键盘选择由 GlobalSearch 管理。 */
function onDocumentKeydown(event: KeyboardEvent): void {
  const target = event.target instanceof Element ? event.target : null
  const typing = target?.closest('input, textarea, [contenteditable="true"], [role="textbox"]')
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault(); searchOpen.value = !searchOpen.value
  } else if (event.key === '/' && !typing && !searchOpen.value) {
    const input = document.querySelector<HTMLInputElement>('.shell__page .list-search input, .shell__page .tk-toolbar__search input, .shell__page .ws__search input')
    event.preventDefault()
    if (input) input.focus()
    else searchOpen.value = true
  }
  if (event.key === 'Escape') searchOpen.value = false
}
onMounted(() => document.addEventListener('keydown', onDocumentKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onDocumentKeydown))
</script>

<template>
  <div class="shell">
    <ManagerNavigation @search="searchOpen = true" />
    <!-- 右侧内容区：页头只渲染一次，工作区将自己的面包屑/操作放到对应插槽。 -->
    <div class="shell__main">
      <header class="topbar">
        <div id="shell-breadcrumbs" class="topbar__left">
          <template v-if="!customHeader"><t-icon :name="route.path.startsWith('/clusters') || route.path.startsWith('/infrastructure-management') ? 'server' : 'app'" size="18px" /><span class="topbar__sep">/</span><span v-if="managementOverview" class="topbar__module">{{ moduleTitle }}</span><h1 v-else>{{ moduleTitle }}</h1><template v-if="managementOverview"><span class="topbar__sep">/</span><h1>概览</h1></template></template>
        </div>
        <div class="topbar__right"><div id="shell-page-actions" /><ShellActions /></div>
      </header>
      <main class="shell__page" :class="{ 'shell__page--application': !managementOverview && route.path.includes('/apps/'), 'shell__page--overview': managementOverview }"><router-view /></main>
    </div>
    <GlobalSearch v-model:visible="searchOpen" />
  </div>
</template>

<style scoped>
.shell{display:flex;height:100dvh;min-width:768px;background:#17191e}
.shell__main{display:flex;flex-direction:column;flex:1;min-width:0;margin:8px 8px 8px 0;background:#fff;border-radius:8px;overflow:hidden}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;height:48px;flex:none;padding:0 20px;border-bottom:1px solid var(--tk-border);background:#fff}
.topbar__left{display:flex;align-items:center;gap:8px;min-width:0}.topbar__left>.t-icon{color:var(--tk-primary)}.topbar h1{font-size:16px;line-height:24px;font-weight:600;white-space:nowrap}.topbar__sep{color:var(--tk-text-3)}
.topbar__right{display:flex;align-items:center;gap:16px;flex:none}#shell-page-actions{display:flex;align-items:center;gap:8px}
.shell__page{flex:1;min-height:0;padding:12px 16px 24px;overflow:auto;background:#fff}
.shell__page--application{padding:0}
.shell__page--overview{padding:0;background:#f2f4f8}.topbar__module{font-size:13px;color:var(--tk-text-2)}
@media(max-width:1024px){.topbar{padding:0 12px}.topbar__right{gap:8px}}
</style>
