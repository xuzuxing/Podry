<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { getApplication, getProject } from '@/api'
import StatusTag from '@/components/StatusTag.vue'
import { appTabs } from '@/router/menu'
import type { Application, Project } from '@/types'

const route = useRoute()
const appId = computed(() => String(route.params.appId ?? ''))
const projectId = computed(() => String(route.params.projectId ?? ''))

const app = ref<Application | null>(null)
const project = ref<Project | null>(null)

async function load(): Promise<void> {
  if (!appId.value) return
  ;[app.value, project.value] = await Promise.all([getApplication(appId.value), getProject(projectId.value)])
}
watch(appId, load, { immediate: true })

const activeTab = computed(() => {
  const name = String(route.name ?? '')
  if (name.startsWith('config')) return '配置'
  return appTabs.find((tab) => tab.name === name)?.title ?? '概览'
})

/** 构建发布 / 配置页在 Devtron 中是整页白底，不带外层内边距 */
const flush = computed(() => route.name === 'app-trigger' || String(route.name ?? '').startsWith('config'))
/** 概览页使用 Devtron 的浅蓝渐变背景 */
const tint = computed(() => route.name === 'app-overview')
</script>

<template>
  <div class="app-workspace" :class="{ 'app-workspace--flush': flush, 'app-workspace--tint': tint }">
    <!-- 对齐 Devtron：面包屑 + 应用切换器 + 环境计数，页签紧贴其下 -->
    <div class="app-head">
      <div class="app-head__row">
        <span class="app-head__mark"><t-icon name="app" size="14px" /></span>
        <router-link class="app-head__crumb" to="/apps">应用</router-link>
        <span class="app-head__sep">/</span>
        <router-link class="app-head__crumb" :to="`/projects/${projectId}`">{{ project?.name ?? '—' }}</router-link>
        <span class="app-head__sep">/</span>
        <span class="app-head__name">{{ app?.name ?? '加载中…' }}</span>
        <t-icon name="chevron-down" class="app-head__caret" />

        <span class="app-head__envs">
          <t-icon name="menu-fold" size="13px" />
          {{ app?.envCount ?? 0 }}/{{ app?.envCount ?? 0 }} 个环境
        </span>
        <StatusTag v-if="app" kind="health" :value="app.health" :dot="false" />
        <span class="u-right u-dim">{{ app?.sourceMode === 'image' ? '已有镜像' : 'Git 源码' }}</span>
      </div>

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
  margin: -12px -16px 0;
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
  padding: 0 16px;
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
.app-head__caret {
  color: var(--tk-text-3);
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
  min-height: calc(100vh - 48px);
  margin-bottom: -24px;
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
