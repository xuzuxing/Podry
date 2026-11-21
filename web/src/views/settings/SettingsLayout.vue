<script setup lang="ts">
import { useRoute } from 'vue-router'

import { settingsNav } from '@/router/menu'

const route = useRoute()
const items = settingsNav
</script>

<template>
  <div class="settings">
    <aside class="settings__nav">
      <router-link
        v-for="item in items"
        :key="item.path"
        :to="item.path ?? '/'"
        class="settings__item"
        :class="{ 'settings__item--active': route.path === item.path }"
      >
        <t-icon :name="item.icon" size="14px" />
        <span>{{ item.title }}</span>
      </router-link>
    </aside>
    <section class="settings__content">
      <router-view />
    </section>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.settings__nav {
  width: 176px;
  flex: none;
  padding: 8px 6px;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.settings__item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 6px;
  color: var(--tk-text);
  border-radius: 2px;
}
.settings__item:hover {
  background: #f5f8fd;
  color: var(--tk-primary);
}
.settings__item--active {
  color: var(--tk-primary);
  font-weight: 600;
  background: var(--tk-primary-weak);
}
.settings__content {
  flex: 1;
  min-width: 0;
}
</style>
