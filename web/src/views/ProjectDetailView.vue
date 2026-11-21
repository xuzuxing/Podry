<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { MockError, createApplication, getProject, listApplications, listTeams } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import FilterBar from '@/components/FilterBar.vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import type { Application, Project } from '@/types'
import { fmtRelative } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const projectId = computed(() => String(route.params.projectId ?? ''))

const loading = ref(true)
const error = ref('')
const project = ref<Project | null>(null)
const teamName = ref('')
const apps = ref<Application[]>([])

const keyword = ref('')
const health = ref('')
const source = ref('')

const dialogVisible = ref(false)
const submitting = ref(false)
const formError = ref('')
const formName = ref('')
const formDesc = ref('')
const formSource = ref<'git' | 'image'>('git')

const healthOptions = [
  { label: '全部健康状态', value: '' },
  { label: '健康', value: 'healthy' },
  { label: '进行中', value: 'progressing' },
  { label: '异常', value: 'degraded' },
  { label: '已完成', value: 'completed' },
  { label: '已停止', value: 'stopped' },
  { label: '未知', value: 'unknown' },
]

const sourceOptions = [
  { label: '全部来源', value: '' },
  { label: 'Git 源码', value: 'git' },
  { label: '已有镜像', value: 'image' },
]

const formSourceOptions = [
  { label: 'Git 源码', value: 'git' },
  { label: '已有镜像', value: 'image' },
]

const columns = [
  { colKey: 'name', title: '应用名称', width: 200 },
  { colKey: 'health', title: '健康状态', width: 110 },
  { colKey: 'source', title: '来源', width: 110 },
  { colKey: 'envCount', title: '环境数', width: 90 },
  { colKey: 'lastDeployedAt', title: '最近发布', width: 130 },
  { colKey: 'actions', title: '操作', width: 80 },
]

const filtered = computed<Application[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  return apps.value.filter((app) => {
    if (kw && !app.name.toLowerCase().includes(kw) && !app.description.toLowerCase().includes(kw)) return false
    if (health.value && app.health !== health.value) return false
    if (source.value && app.sourceMode !== source.value) return false
    return true
  })
})

const headerDescription = computed(() => {
  if (!project.value) return '加载中…'
  return `${teamName.value} · ${apps.value.length} 个应用`
})

async function load(): Promise<void> {
  if (!projectId.value) return
  loading.value = true
  error.value = ''
  try {
    const [projectItem, appPage, teamItems] = await Promise.all([
      getProject(projectId.value),
      listApplications({ projectId: projectId.value, page: 1, pageSize: 500 }),
      listTeams(),
    ])
    project.value = projectItem
    apps.value = appPage.items
    teamName.value = teamItems.find((team) => team.id === projectItem.teamId)?.name ?? projectItem.teamId
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载项目失败'
  } finally {
    loading.value = false
  }
}

watch(projectId, load, { immediate: true })

function onKeywordChange(value: string): void {
  keyword.value = value
}

function onHealthChange(value: unknown): void {
  health.value = typeof value === 'string' ? value : ''
}

function onSourceChange(value: unknown): void {
  source.value = typeof value === 'string' ? value : ''
}

function clearFilters(): void {
  keyword.value = ''
  health.value = ''
  source.value = ''
}

function openCreate(): void {
  formName.value = ''
  formDesc.value = ''
  formSource.value = 'git'
  formError.value = ''
  dialogVisible.value = true
}

function onNameChange(value: string | number): void {
  formName.value = String(value)
}

function onDescChange(value: unknown): void {
  formDesc.value = typeof value === 'string' ? value : ''
}

function onFormSourceChange(value: unknown): void {
  formSource.value = value === 'image' ? 'image' : 'git'
}

async function submitCreate(): Promise<void> {
  if (submitting.value) return
  formError.value = ''
  const name = formName.value.trim()
  if (!name) {
    formError.value = '请输入应用名称'
    return
  }
  submitting.value = true
  try {
    const created = await createApplication({
      projectId: projectId.value,
      name,
      description: formDesc.value.trim(),
      sourceMode: formSource.value,
    })
    dialogVisible.value = false
    void MessagePlugin.success(`应用 ${created.name} 已创建，请继续完成配置`)
    await router.push({ name: 'app-overview', params: { projectId: projectId.value, appId: created.id } })
  } catch (err) {
    if (err instanceof MockError) {
      if (err.status === 409 || err.status === 422) {
        formError.value = err.message
      } else {
        void MessagePlugin.error(err.message)
      }
    } else {
      formError.value = err instanceof Error ? err.message : '创建应用失败'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="project-detail">
    <PageHeader back="/" :title="project?.name ?? '项目详情'" :description="headerDescription">
      <template #actions>
        <t-button theme="primary" size="small" @click="openCreate">
          <template #icon><t-icon name="add" /></template>
          新建应用
        </t-button>
      </template>
    </PageHeader>

    <FilterBar :keyword="keyword" placeholder="按应用名称或描述搜索" @update:keyword="onKeywordChange">
      <template #extra>
        <t-select
          class="project-detail__select"
          :value="health"
          :options="healthOptions"
          placeholder="健康状态"
          clearable
          @change="onHealthChange"
        />
        <t-select
          class="project-detail__select"
          :value="source"
          :options="sourceOptions"
          placeholder="来源"
          clearable
          @change="onSourceChange"
        />
      </template>
      <template #actions>
        <span class="u-dim">共 {{ filtered.length }} 个应用</span>
      </template>
    </FilterBar>

    <section class="tk-panel project-detail__table">
      <ErrorState v-if="error" :message="error" @retry="load" />

      <EmptyState
        v-else-if="!loading && apps.length === 0"
        title="还没有应用"
        description="应用是构建与发布的最小单位，先创建一个应用，再按步骤完成配置。"
        icon="app"
      >
        <template #action>
          <t-button theme="primary" size="small" @click="openCreate">新建应用</t-button>
        </template>
      </EmptyState>

      <EmptyState
        v-else-if="!loading && filtered.length === 0"
        compact
        title="没有匹配的应用"
        description="调整关键字或清空筛选条件后再试。"
        icon="search"
      >
        <template #action>
          <t-button size="small" variant="outline" @click="clearFilters">清空筛选</t-button>
        </template>
      </EmptyState>

      <t-table v-else row-key="id" :data="filtered" :columns="columns" :loading="loading" size="small" hover>
        <template #name="{ row }">
          <router-link :to="{ name: 'app-overview', params: { projectId, appId: row.id } }">
            {{ row.name }}
          </router-link>
        </template>
        <template #health="{ row }">
          <StatusTag kind="health" :value="row.health" />
        </template>
        <template #source="{ row }">
          <span class="u-muted">{{ row.sourceMode === 'image' ? '已有镜像' : 'Git 源码' }}</span>
        </template>
        <template #lastDeployedAt="{ row }">
          <span v-if="row.lastDeployedAt">{{ fmtRelative(row.lastDeployedAt) }}</span>
          <span v-else class="u-dim">未发布</span>
        </template>
        <template #actions="{ row }">
          <router-link :to="{ name: 'app-overview', params: { projectId, appId: row.id } }">进入</router-link>
        </template>
      </t-table>
    </section>

    <t-dialog
      :visible="dialogVisible"
      header="新建应用"
      :width="480"
      :confirm-btn="submitting ? '正在创建…' : '创建应用'"
      cancel-btn="取消"
      @confirm="submitCreate"
      @close="dialogVisible = false"
      @cancel="dialogVisible = false"
    >
      <div class="project-detail__form">
        <t-alert v-if="formError" theme="error" :message="formError" />

        <label class="project-detail__field">
          <span>应用名称</span>
          <t-input :value="formName" placeholder="3–53 位小写字母、数字或连字符，例如 checkout-api" @change="onNameChange" />
          <span class="project-detail__hint">同项目内名称唯一，创建后用于镜像与 release 命名。</span>
        </label>

        <div class="project-detail__field">
          <span>来源</span>
          <t-radio-group :value="formSource" :options="formSourceOptions" @change="onFormSourceChange" />
        </div>

        <label class="project-detail__field">
          <span>描述</span>
          <t-textarea :value="formDesc" placeholder="一句话说明这个应用的职责（可留空）" @change="onDescChange" />
        </label>

        <p class="project-detail__note u-dim">静态演示：应用会写入本地 mock，配置与构建按后续步骤完成。</p>
      </div>
    </t-dialog>
  </div>
</template>

<style scoped>
.project-detail__select {
  width: 150px;
}
.project-detail__table {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
.project-detail__form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.project-detail__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--tk-text-2);
}
.project-detail__hint {
  color: var(--tk-text-3);
  font-size: 11px;
  line-height: 16px;
}
.project-detail__note {
  margin: 0;
  font-size: 11px;
  line-height: 16px;
}
</style>
