<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'

import { createEnvironment, listApplications, listBindings, listEnvironments, updateEnvironment } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import PageHeader from '@/components/PageHeader.vue'
import type { Environment } from '@/types'

const environments = ref<Environment[]>([])
const counts = ref<Record<string, number>>({})
const loading = ref(false)
const error = ref('')
const keyword = ref('')

const dialogVisible = ref(false)
const editingId = ref('')
const envName = ref('')
const production = ref(false)
const autoDeploy = ref(true)

const columns = [
  { colKey: 'name', title: '名称', width: 160 },
  { colKey: 'production', title: '类型', width: 90 },
  { colKey: 'autoDeployAllowed', title: '自动发布允许', width: 160 },
  { colKey: 'appCount', title: '绑定应用数', width: 110 },
  { colKey: 'actions', title: '操作', width: 80 },
]

const rows = computed(() =>
  environments.value.map((env) => ({
    id: env.id,
    name: env.name,
    production: env.production,
    autoDeployAllowed: env.autoDeployAllowed,
    appCount: counts.value[env.id] ?? 0,
  })),
)

const filteredRows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return rows.value
  return rows.value.filter((row) =>
    [row.name, row.production ? '生产' : '非生产', row.autoDeployAllowed ? '允许' : '不允许']
      .some((value) => value.toLowerCase().includes(kw)),
  )
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [envList, appPage] = await Promise.all([listEnvironments(), listApplications({ page: 1, pageSize: 100 })])
    const bindingGroups = await Promise.all(appPage.items.map((app) => listBindings(app.id)))
    const next: Record<string, number> = {}
    for (const group of bindingGroups) {
      for (const binding of group) {
        next[binding.environmentId] = (next[binding.environmentId] ?? 0) + 1
      }
    }
    environments.value = envList
    counts.value = next
  } catch (err) {
    error.value = err instanceof Error ? err.message : '环境列表加载失败'
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editingId.value = ''
  envName.value = ''
  production.value = false
  autoDeploy.value = true
  dialogVisible.value = true
}

function openEdit(row: { id: string; name: string; production: boolean; autoDeployAllowed: boolean }): void {
  editingId.value = row.id
  envName.value = row.name
  production.value = row.production
  autoDeploy.value = row.autoDeployAllowed
  dialogVisible.value = true
}

async function confirmEnv(): Promise<void> {
  const name = envName.value.trim()
  if (!name) {
    MessagePlugin.warning('请输入环境名称')
    return
  }
  if (editingId.value) {
    try {
      await updateEnvironment(editingId.value, {
        name,
        production: production.value,
        autoDeployAllowed: autoDeploy.value,
      })
      MessagePlugin.success(`环境 ${name} 已更新`)
      dialogVisible.value = false
      await load()
    } catch (err) {
      MessagePlugin.error(err instanceof Error ? err.message : '更新环境失败')
    }
    return
  }
  try {
    await createEnvironment({ name, production: production.value, autoDeployAllowed: autoDeploy.value })
    MessagePlugin.success(`环境 ${name} 已创建`)
    dialogVisible.value = false
    await load()
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '创建环境失败')
  }
}

watch(production, (value) => {
  if (value) autoDeploy.value = false
})

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="environments">
    <PageHeader title="基础环境" description="环境决定发布目标是开发、预发布还是生产；生产环境强制手动发布。">
      <template #actions>
        <t-button theme="primary" size="small" @click="openCreate">
          <template #icon>
            <t-icon name="add" />
          </template>
          创建环境
        </t-button>
      </template>
    </PageHeader>

    <ErrorState v-if="error" :message="error" @retry="load" />

    <t-loading v-else :loading="loading">
      <div class="environments__toolbar">
        <t-input v-model="keyword" size="small" clearable placeholder="搜索环境名称 / 类型" class="environments__search">
          <template #prefix-icon><t-icon name="search" /></template>
        </t-input>
        <span class="environments__count">共 {{ filteredRows.length }} 个环境</span>
      </div>

      <t-table row-key="id" :data="filteredRows" :columns="columns" size="small" hover>
        <template #name="{ row }">{{ row.name }}</template>
        <template #production="{ row }">
          <t-tag :theme="row.production ? 'danger' : 'default'" variant="light" size="small">
            {{ row.production ? '生产' : '非生产' }}
          </t-tag>
        </template>
        <template #autoDeployAllowed="{ row }">
          <t-tag v-if="row.production" theme="warning" variant="light" size="small">生产强制手动</t-tag>
          <t-tag v-else-if="row.autoDeployAllowed" theme="success" variant="light" size="small">允许</t-tag>
          <t-tag v-else theme="default" variant="light" size="small">不允许</t-tag>
        </template>
        <template #appCount="{ row }">{{ row.appCount }}</template>
        <template #actions="{ row }">
          <t-button size="small" variant="text" @click="openEdit(row)">编辑</t-button>
        </template>
        <template #empty>
          <EmptyState
            v-if="keyword"
            title="没有匹配的环境"
            description="调整关键字后再试。"
            icon="search"
            compact
          />
          <EmptyState v-else title="还没有环境" description="创建开发、预发布或生产环境后，应用才能绑定发布目标。" icon="layers" compact />
        </template>
      </t-table>
    </t-loading>

    <p class="environments__foot">绑定应用数按环境汇总各应用的发布绑定；生产环境发布必须人工确认。</p>

    <t-drawer
      v-model:visible="dialogVisible"
      :header="editingId ? '编辑环境' : '创建环境'"
      size="560px"
      :footer="false"
      @close="dialogVisible = false"
    >
      <div class="settings-drawer">
        <div class="settings-drawer__scroll">
          <label class="settings-drawer__field">
            <span class="settings-drawer__label">环境名称</span>
            <t-input v-model="envName" placeholder="例如 预发布环境" />
          </label>
          <div class="environments__switch">
            <div>
              <p class="environments__switch-title">是否生产</p>
              <p class="environments__switch-desc">生产环境强制手动发布，且发布前需二次确认。</p>
            </div>
            <t-switch v-model="production" />
          </div>
          <div class="environments__switch">
            <div>
              <p class="environments__switch-title">允许自动发布</p>
              <p class="environments__switch-desc">仅非生产环境可开启；生产环境固定为手动。</p>
            </div>
            <t-switch v-model="autoDeploy" :disabled="production" />
          </div>
          <p class="settings-drawer__hint">生产环境保存后仍会强制手动发布，自动发布开关不会生效。</p>
        </div>
        <div class="settings-drawer__footer">
          <t-button variant="outline" @click="dialogVisible = false">取消</t-button>
          <t-button theme="primary" @click="confirmEnv">{{ editingId ? '保存' : '创建' }}</t-button>
        </div>
      </div>
    </t-drawer>
  </div>
</template>

<style scoped>
.environments__foot {
  margin: 8px 0 0;
  color: var(--tk-text-3);
  font-size: 11px;
}
.environments__toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
.environments__search {
  width: 260px;
}
.environments__count {
  margin-left: auto;
  color: var(--tk-text-3);
  font-size: 11px;
}
.environments__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  color: var(--tk-text-2);
}
.environments__switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 0;
  border-top: 1px solid var(--tk-border);
}
.environments__switch-title {
  margin: 0;
  font-weight: 600;
}
.environments__switch-desc {
  margin: 2px 0 0;
  color: var(--tk-text-3);
  font-size: 11px;
  line-height: 16px;
}
.environments__hint {
  margin: 8px 0 0;
  color: var(--tk-text-3);
  font-size: 11px;
}
</style>
