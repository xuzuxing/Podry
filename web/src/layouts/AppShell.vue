<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { listApplications, listClusters, listProjects } from '@/api'
import type { Application, Cluster, Project } from '@/types'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()

interface RailItem {
  title: string
  icon: string
  path: string
}

/** 对齐 Devtron 的左侧图标轨道：只放一级模块 */
const rail: RailItem[] = [
  { title: '项目', icon: 'folder', path: '/' },
  { title: '应用', icon: 'app', path: '/apps' },
  { title: '集群资源', icon: 'server', path: '/clusters' },
  { title: '操作记录', icon: 'history', path: '/audit' },
  { title: '平台设置', icon: 'setting', path: '/settings' },
]

const activePath = computed(() => {
  const path = route.path
  if (path.startsWith('/settings')) return '/settings'
  if (path.startsWith('/clusters')) return '/clusters'
  if (path.startsWith('/apps') || path.includes('/apps/')) return '/apps'
  if (path.startsWith('/audit')) return '/audit'
  return '/'
})

const moduleTitle = computed(() => rail.find((item) => item.path === activePath.value)?.title ?? 'Podry')

/* 全局搜索：应用 / 集群 / 项目 */
interface SearchResult {
  id: string
  group: '应用' | '集群' | '项目'
  label: string
  hint: string
  to: { name: string; params: Record<string, string> }
}

const keyword = ref('')
const searchOpen = ref(false)
const searching = ref(false)
const results = ref<SearchResult[]>([])
let searchTimer: number | undefined
let apps: Application[] = []
let clusters: Cluster[] = []
let projects: Project[] = []

async function loadSearchData(): Promise<void> {
  if (apps.length && clusters.length && projects.length) return
  const [appPage, clusterList, projectList] = await Promise.all([
    listApplications({ page: 1, pageSize: 500 }),
    listClusters(),
    listProjects(),
  ])
  apps = appPage.items
  clusters = clusterList
  projects = projectList
}

async function runSearch(): Promise<void> {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) {
    results.value = []
    return
  }
  searching.value = true
  try {
    await loadSearchData()
    const matched: SearchResult[] = []
    for (const app of apps.filter((item) => item.name.toLowerCase().includes(kw)).slice(0, 5)) {
      matched.push({
        id: 'app-' + app.id,
        group: '应用',
        label: app.name,
        hint: projectNameOf(app.projectId),
        to: { name: 'app-overview', params: { projectId: app.projectId, appId: app.id } },
      })
    }
    for (const cluster of clusters.filter((item) => item.name.toLowerCase().includes(kw)).slice(0, 3)) {
      matched.push({
        id: 'cluster-' + cluster.id,
        group: '集群',
        label: cluster.name,
        hint: cluster.serverVersion ?? '未检测',
        to: { name: 'cluster-workspace', params: { clusterId: cluster.id } },
      })
    }
    for (const project of projects.filter((item) => item.name.toLowerCase().includes(kw)).slice(0, 3)) {
      matched.push({
        id: 'project-' + project.id,
        group: '项目',
        label: project.name,
        hint: '项目',
        to: { name: 'project-detail', params: { projectId: project.id } },
      })
    }
    results.value = matched
  } finally {
    searching.value = false
  }
}

function projectNameOf(projectId: string): string {
  return projects.find((item) => item.id === projectId)?.name ?? projectId
}

function onSearchInput(): void {
  searchOpen.value = true
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void runSearch(), 180)
}

function openResult(result: SearchResult): void {
  keyword.value = ''
  results.value = []
  searchOpen.value = false
  void router.push(result.to)
}

function onDocumentKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  const typing = target && ['INPUT', 'TEXTAREA'].includes(target.tagName)
  if (event.key === '/' && !typing) {
    event.preventDefault()
    const input = document.querySelector<HTMLInputElement>('.topbar__search input')
    input?.focus()
  }
  if (event.key === 'Escape') searchOpen.value = false
}

onMounted(() => document.addEventListener('keydown', onDocumentKeydown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocumentKeydown)
  if (searchTimer) window.clearTimeout(searchTimer)
})

function logout(): void {
  session.logout()
  void router.push({ name: 'login' })
}
</script>

<template>
  <div class="shell">
    <aside class="rail">
      <div class="rail__logo" title="Podry">P</div>
      <nav class="rail__nav">
        <router-link
          v-for="item in rail"
          :key="item.path"
          :to="item.path"
          class="rail__item"
          :class="{ 'rail__item--active': activePath === item.path }"
          :title="item.title"
        >
          <t-icon :name="item.icon" size="18px" />
        </router-link>
      </nav>
      <div class="rail__bottom">
        <span class="rail__avatar" :title="session.user?.name ?? '未登录'">
          {{ session.user?.name?.slice(0, 1) ?? 'U' }}
        </span>
      </div>
    </aside>

    <div class="shell__main">
      <header class="topbar">
        <div class="topbar__left">
          <span class="topbar__module-icon"><t-icon name="app" size="15px" /></span>
          <span class="topbar__crumb">Podry</span>
          <span class="topbar__sep">/</span>
          <span class="topbar__title">{{ moduleTitle }}</span>
        </div>
        <div class="topbar__right">
          <div class="topbar__search">
            <t-input
              v-model="keyword"
              placeholder="搜索应用、集群、项目"
              size="small"
              clearable
              @focus="searchOpen = true"
              @input="onSearchInput"
              @enter="results.length && openResult(results[0])"
            >
              <template #prefix-icon><t-icon name="search" /></template>
              <template #suffix><span class="topbar__kbd">/</span></template>
            </t-input>

            <div v-if="searchOpen && keyword.trim()" class="topbar__results">
              <p v-if="searching" class="topbar__result-hint">搜索中…</p>
              <template v-else-if="results.length">
                <button
                  v-for="result in results"
                  :key="result.id"
                  type="button"
                  class="topbar__result"
                  @click="openResult(result)"
                >
                  <span class="topbar__result-group">{{ result.group }}</span>
                  <span class="topbar__result-label">{{ result.label }}</span>
                  <span class="topbar__result-hint">{{ result.hint }}</span>
                </button>
              </template>
              <p v-else class="topbar__result-hint">没有匹配结果</p>
            </div>
          </div>
          <t-button variant="text" shape="square" size="small" title="帮助">
            <t-icon name="info-circle" />
          </t-button>
          <t-dropdown
            :options="[{ content: '退出登录', value: 'logout' }]"
            trigger="click"
            @click="(data: { value: string }) => data.value === 'logout' && logout()"
          >
            <span class="topbar__user">
              <span class="topbar__avatar">{{ session.user?.name?.slice(0, 1) ?? 'U' }}</span>
              <span class="topbar__name">{{ session.user?.name ?? '未登录' }}</span>
              <t-icon name="chevron-down" />
            </span>
          </t-dropdown>
        </div>
      </header>

      <main class="shell__page">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100vh;
  min-width: 1200px;
  background: var(--tk-bg);
}

/* ---- 左侧图标轨道（对齐 Devtron app rail） ---- */
.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 64px;
  flex: none;
  padding: 8px 0 12px;
  background: linear-gradient(180deg, #0d2350 0%, #102a63 55%, #0a1a3d 100%);
}
.rail__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin-bottom: 10px;
  color: #0d2350;
  font-size: 15px;
  font-weight: 700;
  background: #ffffff;
  border-radius: 6px;
}
.rail__nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  align-items: center;
}
.rail__item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  color: rgba(255, 255, 255, 0.62);
  border-radius: 6px;
}
.rail__item:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
.rail__item--active {
  color: #fff;
  background: rgba(255, 255, 255, 0.18);
}
.rail__bottom {
  margin-top: auto;
}
.rail__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: #fff;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.22);
  border-radius: 50%;
}

/* ---- 右侧内容区 ---- */
.shell__main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  flex: none;
  padding: 0 16px;
  background: var(--tk-surface);
  border-bottom: 1px solid var(--tk-border);
}
.topbar__left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.topbar__module-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--tk-primary);
}
.topbar__crumb {
  color: var(--tk-text-2);
}
.topbar__sep {
  color: var(--tk-text-3);
}
.topbar__title {
  font-size: 15px;
  font-weight: 600;
}
.topbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.topbar__search {
  position: relative;
}
.topbar__kbd {
  padding: 0 5px;
  color: var(--tk-text-3);
  font-size: 11px;
  border: 1px solid var(--tk-border);
  border-radius: 3px;
}
.topbar__results {
  position: absolute;
  top: 34px;
  right: 0;
  left: 0;
  z-index: 40;
  padding: 4px;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
}
.topbar__result {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  font: inherit;
  color: var(--tk-text);
  text-align: left;
  background: none;
  border: 0;
  border-radius: 3px;
  cursor: pointer;
}
.topbar__result:hover {
  background: #f2f4f8;
}
.topbar__result-group {
  padding: 0 5px;
  color: var(--tk-text-3);
  font-size: 10px;
  background: #eef2f9;
  border-radius: 2px;
}
.topbar__result-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.topbar__result-hint {
  margin-left: auto;
  color: var(--tk-text-3);
  font-size: 11px;
}
.topbar__search {
  width: 240px;
}
.topbar__user {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  cursor: pointer;
  border-radius: 4px;
}
.topbar__user:hover {
  background: #f5f8fd;
}
.topbar__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: #fff;
  font-size: 11px;
  background: #d54941;
  border-radius: 50%;
}
.topbar__name {
  font-size: 13px;
}
.shell__page {
  flex: 1;
  min-height: 0;
  padding: 12px 16px 24px;
  overflow: auto;
}
</style>
