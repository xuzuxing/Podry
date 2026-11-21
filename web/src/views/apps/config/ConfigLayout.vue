<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { getSetup } from '@/api'
import { configSections } from '@/router/menu'
import type { ApplicationSetup } from '@/types'

const route = useRoute()
const appId = computed(() => String(route.params.appId ?? ''))
const setup = ref<ApplicationSetup | null>(null)

watch(
  appId,
  async () => {
    setup.value = await getSetup(appId.value)
  },
  { immediate: true },
)

const statusOf = (key: string) => setup.value?.steps.find((step) => step.key === key)?.status ?? 'pending'

function locked(key: string): boolean {
  if (!setup.value) return false
  if (key === 'git') return false
  if (key === 'build') return statusOf('git') !== 'complete'
  if (key === 'base') return statusOf('build') === 'pending' || statusOf('build') === 'blocked'
  if (key === 'workflow') return statusOf('base') !== 'complete'
  return setup.value.deployableBindingIds.length === 0
}

function iconOf(key: string): string {
  if (key === 'overrides') return setup.value?.deployableBindingIds.length ? 'check-circle' : 'lock-on'
  if (locked(key)) return 'lock-on'
  return statusOf(key) === 'complete' ? 'check-circle' : 'time'
}

const progressText = computed(() => (setup.value ? `${setup.value.completed}/${setup.value.total}` : '—'))
const activeName = computed(() => String(route.name ?? 'config-git'))
</script>

<template>
  <div class="config">
    <aside class="config__nav">
      <div class="config__progress">
        <div class="u-between">
          <span class="u-muted">配置完成度</span>
          <strong>{{ progressText }}</strong>
        </div>
        <t-progress
          theme="line"
          :percentage="setup ? Math.round((setup.completed / setup.total) * 100) : 0"
          :label="false"
          size="4px"
        />
      </div>
      <router-link
        v-for="section in configSections"
        :key="section.name"
        class="config__item"
        :class="{ 'config__item--active': activeName === section.name, 'config__item--locked': locked(section.key) }"
        :to="{ name: section.name, params: { projectId: route.params.projectId, appId } }"
      >
        <t-icon :name="iconOf(section.key)" size="13px" />
        <span>{{ section.title }}</span>
      </router-link>
      <p class="config__hint">配置按节保存，保存后生成新的配置版本。</p>
    </aside>
    <section class="config__content">
      <router-view />
    </section>
  </div>
</template>

<style scoped>
.config {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.config__nav {
  width: 188px;
  flex: none;
  padding: 10px 8px;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.config__progress {
  padding: 0 4px 10px;
  border-bottom: 1px solid var(--tk-border);
  margin-bottom: 8px;
}
.config__item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 6px;
  color: var(--tk-text);
  border-radius: 2px;
}
.config__item:hover {
  background: #f5f8fd;
  color: var(--tk-primary);
}
.config__item--active {
  color: var(--tk-primary);
  font-weight: 600;
  background: var(--tk-primary-weak);
}
.config__item--locked {
  color: var(--tk-text-3);
}
.config__hint {
  margin: 10px 4px 0;
  color: var(--tk-text-3);
  font-size: 11px;
  line-height: 16px;
}
.config__content {
  flex: 1;
  min-width: 0;
}
</style>
