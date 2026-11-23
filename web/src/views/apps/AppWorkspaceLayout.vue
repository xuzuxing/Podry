<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { getApplication, getProject, listApplications } from '@/api'
import StatusTag from '@/components/StatusTag.vue'
import { appTabs } from '@/router/menu'
import type { Application, Project } from '@/types'
import { onApplicationChanged } from '@/utils/appEvents'

const route = useRoute()
const router = useRouter()
const appId = computed(() => String(route.params.appId ?? ''))
const projectId = computed(() => String(route.params.projectId ?? ''))

const app = ref<Application | null>(null)
const project = ref<Project | null>(null)
const projectApps = ref<Application[]>([])
let loadRequest = 0

async function load(): Promise<void> {
  if (!appId.value) return
  const token = ++loadRequest
  try {
  const [appItem, projectItem, appPage] = await Promise.all([
    getApplication(appId.value),
    getProject(projectId.value),
    listApplications({ projectId: projectId.value, pageSize: 100 }),
  ])
  if (token !== loadRequest) return
  app.value = appItem
  project.value = projectItem
  projectApps.value = appPage.items
  } catch {
    // Route content owns the error/retry UI; never retain another app's header.
    if (token === loadRequest) { app.value = null; project.value = null; projectApps.value = [] }
  }
}
watch([appId,projectId], load, { immediate: true })
const unsubscribe = onApplicationChanged(id => { if (id === appId.value) void load() })
onBeforeUnmount(() => { ++loadRequest; unsubscribe() })

function switchTo(id: string): void {
  if (!id || id === appId.value) return
  void router.push({ name: 'app-overview', params: { projectId: projectId.value, appId: id } })
}

const activeTab = computed(() => {
  const name = String(route.name ?? '')
  if (name.startsWith('config')) return '配置'
  return appTabs.find((tab) => tab.name === name)?.title ?? '概览'
})

/** 构建发布 / 配置页在 Devtron 中是整页白底，不带外层内边距；配置表单自己设置灰色底板。 */
const flush = computed(() => route.name === 'app-trigger' || String(route.name ?? '').startsWith('config'))
/** 概览页使用 Devtron 的浅蓝渐变背景 */
const tint = computed(() => route.name === 'app-overview')
</script>

<template>
  <div class="app-workspace" :class="{ 'app-workspace--flush': flush, 'app-workspace--tint': tint }">
    <!-- 对齐 Devtron：面包屑 + 应用切换器 + 环境计数，页签紧贴其下 -->
    <div class="app-head">
      <Teleport to="#shell-breadcrumbs" defer><div class="app-head__row">
        <span class="app-head__mark"><t-icon name="app" size="14px" /></span>
        <router-link class="app-head__crumb" to="/apps">应用</router-link>
        <span class="app-head__sep">/</span>
        <t-dropdown
          trigger="click"
          placement="bottom-left"
          :popup-props="{ overlayClassName: 'app-switch-popup' }"
        >
          <button type="button" class="app-head__name app-head__name--switch">
            {{ app?.name ?? '加载中…' }}
            <t-icon name="chevron-down" size="12px" />
          </button>
          <template #dropdown>
            <t-dropdown-menu>
              <t-dropdown-item v-for="item in projectApps" :key="item.id" @click="switchTo(item.id)">
                {{ item.name }}
              </t-dropdown-item>
            </t-dropdown-menu>
          </template>
        </t-dropdown>

        <span class="app-head__envs">
          <t-icon name="menu-fold" size="13px" />
          {{ app?.envCount ?? 0 }}/{{ app?.envCount ?? 0 }} 个环境
        </span>
        <StatusTag v-if="app" kind="health" :value="app.health" :dot="false" />
      </div></Teleport>

      <nav class="app-head__tabs">
        <router-link
          v-for="tab in appTabs"
          :key="tab.name"
          class="app-tab"
          :class="{ 'app-tab--active': activeTab === tab.title }"
          :to="{ name: tab.name, params: { projectId, appId } }"
        >
          <t-icon v-if="tab.icon" :name="tab.icon" size="13px" />
          {{ tab.title }}
        </router-link>
      </nav>
    </div>

    <div class="app-workspace__body" :class="{ 'app-workspace__body--flush': flush }">
      <router-view />
    </div>
  </div>
</template>

<style scoped>
.app-workspace {
  margin: 0;
  background: var(--tk-bg);
}
.app-head {
  background: var(--tk-surface);
  border-bottom: 1px solid var(--tk-border);
}
.app-head__row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0;
  min-width: 0;
}
.app-head__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--tk-primary);
}
.app-head__crumb {
  color: var(--tk-text-2);
}
.app-head__crumb:hover {
  color: var(--tk-primary);
}
.app-head__sep {
  color: var(--tk-text-3);
}
.app-head__name {
  font-size: 14px;
  font-weight: 600;
}
.app-head__name--switch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  color: #000a14;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  background: none;
  border: 0;
  cursor: pointer;
}
.app-head__name--switch:hover {
  color: #0066cc;
}
:global(.app-switch-popup) {
  min-width: 220px;
}
:global(.app-switch-popup .t-dropdown__item) {
  max-width: none;
}
:global(.app-switch-popup .t-dropdown__item-text) {
  max-width: none;
  overflow: visible;
  text-overflow: clip;
}
.app-head__envs {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  margin-left: 10px;
  padding: 0 8px;
  color: var(--tk-text-2);
  background: #f4f6fa;
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.app-head__tabs {
  display: flex;
  align-items: center;
  gap: 20px;
  height: 37px;
  padding: 0 16px;
}
.app-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 37px;
  color: var(--tk-text-2);
}
.app-tab:hover {
  color: var(--tk-primary);
}
.app-tab--active {
  color: var(--tk-primary);
  font-weight: 600;
}
.app-tab--active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: var(--tk-primary);
}
.app-workspace__body {
  padding: 12px 16px 24px;
}
/* 构建发布：整页白底、由页面自己控制内边距，并铺满视口剩余高度 */
.app-workspace--flush {
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - 64px);
  background: #fff;
}
.app-workspace__body--flush {
  flex: 1;
  padding: 0;
}
/* 概览：Devtron 的极浅蓝渐变底 */
.app-workspace--tint {
  background: radial-gradient(120% 90% at 8% 0%, #f7fbff 0%, #eef5fd 55%, #e9f1fb 100%);
}
</style>
