<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

const emit = defineEmits<{ search: [] }>()
const route = useRoute()
const opened = ref('')
const keyword = ref('')
const settingsExpanded = ref(false)
const groups = [
  { id: 'application', title: '应用管理', icon: 'app', path: '/apps', items: [
    { title: '概览', subtitle: 'Overview', icon: 'chart-bar', path: '/apps/overview' },
    { title: '应用', subtitle: 'Applications', icon: 'app', path: '/apps' },
    { title: '项目', subtitle: 'Projects', icon: 'folder', path: '/projects' },
  ] },
  { id: 'infrastructure', title: '基础设施管理', icon: 'server', path: '/clusters', items: [
    { title: '概览', subtitle: 'Overview', icon: 'chart-bar', path: '/clusters/overview' },
    { title: '资源浏览器', subtitle: 'Resource Browser K8s 资源管理', icon: 'layers', path: '/clusters' },
  ] },
]
const selectedGroup = computed(() => route.path.startsWith('/clusters') || route.path.startsWith('/infrastructure-management') ? 'infrastructure' : 'application')
const current = computed(() => groups.find((group) => group.id === opened.value))
const items = computed(() => current.value?.items.filter((item) =>
  `${item.title} ${item.subtitle}`.toLowerCase().includes(keyword.value.trim().toLowerCase()),
) ?? [])

function close(): void { opened.value = ''; keyword.value = '' }
function open(id: string): void {
  if (opened.value !== id) keyword.value = ''
  opened.value = id
}
function onKey(event: KeyboardEvent): void { if (event.key === 'Escape') close() }
watch(() => route.fullPath, close)
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="manager-navigation" @mouseleave="!keyword && close()">
    <nav class="manager-rail" aria-label="主导航">
      <router-link to="/apps" class="manager-logo" title="Podry" @focus="close"><img src="/favicon.svg" alt="Podry" /></router-link>
      <button class="manager-rail__item" title="搜索 (Ctrl+K)" aria-label="全局搜索" @mouseenter="close" @click="emit('search')"><t-icon name="search" size="20px" /></button>
      <router-link v-for="group in groups" :key="group.id" :to="group.path" class="manager-rail__item"
        :class="{ 'is-selected': (opened || selectedGroup) === group.id }" :aria-label="group.title"
        :aria-expanded="opened === group.id" @mouseenter="open(group.id)" @focus="open(group.id)" @click="open(group.id)">
        <t-icon :name="group.icon" size="20px" />
      </router-link>
      <div class="manager-rail__bottom">
        <t-popup trigger="click" placement="right-bottom">
          <button class="manager-rail__item" title="全局配置" aria-label="全局配置" @mouseenter="close"><t-icon name="setting" size="20px" /></button>
          <template #content>
            <nav class="utility-menu" aria-label="全局配置">
              <strong>全局配置</strong>
              <router-link to="/settings/members">用户与权限</router-link>
              <router-link to="/settings/clusters">集群与环境</router-link>
              <router-link to="/settings/registries">镜像仓库 / OCI 仓库</router-link>
              <router-link to="/settings/credentials">Git 账号 / 凭据</router-link>
              <router-link to="/projects">项目</router-link>
              <router-link to="/audit">审计日志</router-link>
            </nav>
          </template>
        </t-popup>
      </div>
    </nav>
    <div v-if="current" class="manager-backdrop" @mouseenter="!keyword && close()" @click="close" />
    <aside v-if="current" class="manager-menu" :aria-label="current.title">
      <div class="manager-menu__brand">Podry</div>
      <div class="manager-menu__body">
        <h2>{{ current.title }}</h2>
        <t-input v-model="keyword" placeholder="搜索菜单" clearable size="small" aria-label="搜索导航菜单"><template #prefix-icon><t-icon name="search" /></template></t-input>
        <nav>
          <router-link v-for="item in items" :key="item.path" :to="item.path" class="manager-menu__item" :class="{ 'is-selected': route.path === item.path || (!route.meta.managementOverview && ((item.path === '/apps' && route.path.includes('/apps/')) || (item.path === '/clusters' && route.path.startsWith('/clusters/')))) }" @click="close">
            <t-icon :name="item.icon" /><span>{{ item.title }}</span>
          </router-link>
          <template v-if="current.id === 'application' && (!keyword || '配置 git 账号 configurations git accounts'.includes(keyword.toLowerCase()))">
            <button class="manager-menu__item manager-menu__item--group" :aria-expanded="settingsExpanded || !!keyword" @click="settingsExpanded = !settingsExpanded"><t-icon :name="settingsExpanded || keyword ? 'chevron-down' : 'chevron-right'" /><span>配置</span></button>
            <router-link v-if="settingsExpanded || keyword" to="/settings/credentials" class="manager-menu__item manager-menu__item--child" @click="close">Git 账号</router-link>
          </template>
          <p v-if="!items.length && !'配置 git 账号 configurations git accounts'.includes(keyword.toLowerCase())" class="manager-menu__empty">没有匹配的菜单</p>
        </nav>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.manager-navigation{position:relative;width:64px;flex:none;z-index:100}
.manager-rail{position:relative;display:flex;flex-direction:column;align-items:center;height:100%;padding:0 8px 12px;z-index:102}
.manager-logo{height:56px;display:flex;align-items:center;justify-content:center;width:48px}.manager-logo img{width:28px;height:28px}
.manager-rail__item{display:flex;align-items:center;justify-content:center;flex:none;width:36px;height:36px;margin:8px 0;color:#fff;background:transparent;border:0;border-radius:8px;cursor:pointer}
.manager-rail__item:hover,.manager-rail__item:focus-visible,.manager-rail__item.is-selected{background:#ffffff40;outline:0}
.manager-rail__bottom{margin-top:auto}.manager-backdrop{position:fixed;inset:0 0 0 288px;z-index:100}
.manager-menu{position:fixed;left:64px;top:0;bottom:0;width:224px;color:#fff;background:#000;border-radius:0 8px 8px 0;z-index:101;box-shadow:8px 0 24px #00122c20}
.manager-menu__brand{height:56px;display:flex;align-items:center;padding:0 16px;font-size:22px;font-weight:700}
.manager-menu__body{padding:16px;display:flex;flex-direction:column;gap:16px}.manager-menu h2{font-size:16px;line-height:24px;color:#fff}
.manager-menu__item{display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:6px 8px;color:#fff;font:inherit;text-align:left;border:0;border-radius:4px;background:transparent;cursor:pointer}
.manager-menu__item:hover{background:#ffffff1a}.manager-menu__item.is-selected{background:#ffffff26}.manager-menu__item--child{padding-left:32px}.manager-menu__empty{color:#ffffffb3;font-size:12px}
.utility-menu{display:flex;flex-direction:column;gap:4px;padding:8px;width:240px}.utility-menu strong{padding:8px}.utility-menu a{padding:8px;color:var(--tk-text)}.utility-menu a:hover{background:var(--tk-primary-weak)}
</style>
