<script setup lang="ts">
import { ref } from 'vue'
import type { Application } from '@/types'
import { useApplicationList } from '@/composables/useApplicationList'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import ApplicationFilters from './ApplicationFilters.vue'
import ApplicationTable from './ApplicationTable.vue'
import DeleteApplicationDialog from './DeleteApplicationDialog.vue'
import CreateApplicationDrawer from '@/views/apps/components/onboarding/CreateApplicationDrawer.vue'
const { rows, clusters, environments, bindings, loading, error, keyword, filters, filterGroups, filtered, refreshedLabel, load, resetFilters, exportCsv } = useApplicationList()
const createOpen = ref(false)
const createMode = ref<'scratch' | 'clone'>('scratch')
const cloneSource = ref('')
const deleteTarget = ref<Application | null>(null)
function create(mode: 'scratch' | 'clone', application?: Application): void { createMode.value = mode; cloneSource.value = application?.id ?? ''; createOpen.value = true }
</script>
<template>
  <section class="application-list">
    <Teleport to="#shell-page-actions" defer><t-dropdown trigger="click" :options="[{ content:'Custom app / 自定义应用',value:'scratch' },{ content:'Clone app / 克隆应用',value:'clone' }]" @click="create($event.value === 'clone' ? 'clone' : 'scratch')"><t-button theme="primary" size="small">Create<t-icon name="chevron-down" size="12px" /></t-button></t-dropdown></Teleport>
    <div class="application-list__toolbar"><t-input v-model="keyword" class="list-search" placeholder="Search by app name" aria-label="搜索应用名称" size="small" clearable><template #prefix-icon><t-icon name="search" /></template><template #suffix><kbd>/</kbd></template></t-input><ApplicationFilters v-model="filters" :groups="filterGroups" /><span class="u-right" /><t-button size="small" variant="text" :loading="loading" @click="load"><template #icon><t-icon name="refresh" /></template>{{ refreshedLabel }}</t-button><t-button size="small" variant="outline" @click="exportCsv"><template #icon><t-icon name="download" /></template>Export CSV</t-button></div>
    <ErrorState v-if="error" :message="error" @retry="load" />
    <t-loading v-else :loading="loading"><ApplicationTable :rows="filtered" :clusters="clusters" :environments="environments" :bindings="bindings" @clone="create('clone', $event)" @delete="deleteTarget = $event"><template #empty><EmptyState v-if="!loading && !rows.length" icon="app" title="还没有应用" description="创建应用后即可配置 Git、构建与发布流程。"><template #action><t-button theme="primary" @click="create('scratch')">创建应用</t-button></template></EmptyState><EmptyState v-else-if="!loading" title="没有匹配的应用" description="调整筛选条件或搜索关键字。"><template #action><t-button variant="outline" @click="resetFilters">清空筛选</t-button></template></EmptyState></template></ApplicationTable></t-loading>
    <p class="application-list__count">共 {{ filtered.length }} 个应用</p>
    <CreateApplicationDrawer v-model:visible="createOpen" :initial-mode="createMode" :source-application-id="cloneSource" @created="load" />
    <DeleteApplicationDialog :application="deleteTarget" @close="deleteTarget = null" @deleted="load" />
  </section>
</template>
<style scoped>
.application-list{margin:-12px -16px -24px;min-height:calc(100dvh - 64px);background:#fff}.application-list__toolbar{display:flex;align-items:center;gap:8px;padding:12px 20px;flex-wrap:wrap}.application-list__toolbar>.list-search{width:250px}.application-list__toolbar kbd{font-size:11px;border:1px solid var(--tk-border);padding:0 4px;color:var(--tk-text-3)}.application-list__count{padding:12px 20px;color:var(--tk-text-3);font-size:12px}
</style>
