<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { settingsNav } from '@/router/menu'
import type { MenuItem } from '@/router/menu'

const route = useRoute()
const items = settingsNav

const groups = computed(() => {
  const map = new Map<string, MenuItem[]>()
  items.forEach((item) => {
    const key = item.group ?? '其他'
    const list = map.get(key) ?? []
    list.push(item)
    map.set(key, list)
  })
  return [...map.entries()].map(([title, list]) => ({ title, items: list }))
})
</script>

<template>
  <div class="settings">
    <aside class="settings__nav">
      <div class="settings__head">
        <p class="settings__title">全局设置</p>
        <p class="settings__sub">平台级配置、集群与凭据</p>
      </div>

      <div v-for="group in groups" :key="group.title" class="settings__group">
        <p class="settings__group-title">{{ group.title }}</p>
        <router-link
          v-for="item in group.items"
          :key="item.path"
          :to="item.path ?? '/'"
          class="settings__item"
          :class="{ 'settings__item--active': route.path === item.path }"
        >
          <t-icon :name="item.icon" size="15px" />
          <span>{{ item.title }}</span>
        </router-link>
      </div>
    </aside>

    <section class="settings__content">
      <router-view />
    </section>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  align-items: stretch;
  min-height: calc(100vh - 84px);
  margin: -12px -16px 0;
  background: #fff;
  border-top: 1px solid #e6e9ef;
}
.settings__nav {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 252px;
  padding: 20px 12px;
  border-right: 1px solid #e6e9ef;
}
.settings__head {
  padding: 0 10px 4px;
}
.settings__title {
  margin: 0 0 4px;
  color: #000a14;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}
.settings__sub {
  margin: 0;
  color: #767d84;
  font-size: 11px;
  line-height: 16px;
}
.settings__group {
  margin-top: 18px;
}
.settings__group-title {
  margin: 0 0 6px;
  padding: 0 10px;
  color: #767d84;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.settings__item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  margin-bottom: 2px;
  padding: 0 10px;
  color: #3b444c;
  font-size: 13px;
  border-radius: 4px;
}
.settings__item:hover {
  color: #0066cc;
  background: #f5f8fd;
}
.settings__item--active {
  color: #0066cc;
  font-weight: 500;
  background: #e8f1ff;
}
.settings__content {
  flex: 1;
  min-width: 0;
  padding: 20px 24px;
}
.settings__content :deep(.page-header__title) {
  font-size: 18px;
  line-height: 26px;
}
.settings__content :deep(.page-header__desc) {
  font-size: 12px;
  line-height: 18px;
}
.settings__content :deep(.t-table) {
  overflow: hidden;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.settings__content :deep(.t-table th) {
  height: 38px;
  color: #767d84;
  font-size: 11px;
  font-weight: 500;
  background: #f7fafc;
}
</style>
