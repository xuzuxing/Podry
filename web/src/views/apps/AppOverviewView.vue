<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import {
  getApplication,
  getConfig,
  getMe,
  getProject,
  listBindings,
  listDeployments,
  listEnvironments,
  listProjects,
  updateApplication,
} from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import StatusTag from '@/components/StatusTag.vue'
import type {
  AppConfig,
  Application,
  Binding,
  DeployStatus,
  Deployment,
  Environment,
  Project,
} from '@/types'
import { fmtTime } from '@/utils/format'

type OverviewTab = 'about' | 'environments'

interface EnvRow {
  id: string
  envName: string
  production: boolean
  clusterId: string
  namespace: string
  releaseName: string
  deployStatus: DeployStatus | ''
}

const route = useRoute()
const appId = computed(() => String(route.params.appId ?? ''))

const loading = ref(true)
const error = ref('')
const tab = ref<OverviewTab>('about')

const app = ref<Application | null>(null)
const project = ref<Project | null>(null)
const config = ref<AppConfig | null>(null)
const bindings = ref<Binding[]>([])
const environments = ref<Environment[]>([])
const deployments = ref<Deployment[]>([])
const createdBy = ref('张运维')

/* 元信息编辑：描述 / 所属项目 / 标签 / Readme */
type MetaField = 'description' | 'project' | 'tags' | 'readme'
const metaVisible = ref(false)
const metaField = ref<MetaField>('description')
const metaText = ref('')
const metaTags = ref<string[]>([])
const metaTagInput = ref('')
const metaProjectId = ref('')
const metaSaving = ref(false)
const projects = ref<Project[]>([])

const metaTitle = computed(() => {
  const map: Record<MetaField, string> = {
    description: '编辑应用描述',
    project: '调整所属项目',
    tags: '编辑标签',
    readme: '编辑 Readme',
  }
  return map[metaField.value]
})

const readmeLines = computed(() =>
  (app.value?.readme ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
)

function openMeta(field: MetaField): void {
  metaField.value = field
  metaText.value = field === 'tags' ? '' : field === 'readme' ? (app.value?.readme ?? '') : (app.value?.description ?? '')
  metaTags.value = [...(app.value?.tags ?? [])]
  metaTagInput.value = ''
  metaProjectId.value = app.value?.projectId ?? ''
  metaVisible.value = true
}

function addTag(): void {
  const value = metaTagInput.value.trim()
  if (!value) return
  if (!metaTags.value.includes(value)) metaTags.value.push(value)
  metaTagInput.value = ''
}

function removeTag(tag: string): void {
  metaTags.value = metaTags.value.filter((item) => item !== tag)
}

async function saveMeta(): Promise<void> {
  if (!app.value) return
  metaSaving.value = true
  try {
    const patch: { description?: string; projectId?: string; tags?: string[]; readme?: string } = {}
    if (metaField.value === 'description') patch.description = metaText.value
    if (metaField.value === 'readme') patch.readme = metaText.value
    if (metaField.value === 'tags') patch.tags = metaTags.value
    if (metaField.value === 'project') {
      if (!metaProjectId.value) {
        MessagePlugin.warning('请选择目标项目')
        return
      }
      patch.projectId = metaProjectId.value
    }
    const updated = await updateApplication(app.value.id, patch)
    app.value = updated
    metaVisible.value = false
    MessagePlugin.success(`${metaTitle.value}已保存`)
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    metaSaving.value = false
  }
}

const envColumns = [
  { colKey: 'envName', title: '环境', width: 150 },
  { colKey: 'clusterId', title: 'Cluster', width: 120 },
  { colKey: 'namespace', title: 'Namespace', width: 150 },
  { colKey: 'releaseName', title: 'Release', width: 160 },
  { colKey: 'status', title: '状态', width: 120 },
]

const initial = computed(() => (app.value?.name ?? '?').slice(0, 1).toUpperCase())
const appName = computed(() => app.value?.name ?? '')
const description = computed(() => app.value?.description ?? '')
const createdOn = computed(() => fmtTime(app.value?.updatedAt))
const projectName = computed(() => project.value?.name ?? '—')

/** 取仓库名：https://github.com/acme/checkout-api.git → checkout-api */
const repoLabel = computed(() => {
  const url = config.value?.gitConfig?.repositoryUrl ?? ''
  if (!url) return ''
  const tail = url.replace(/\/+$/, '').split('/').pop() ?? ''
  return tail.replace(/\.git$/, '') || url
})

const envRows = computed<EnvRow[]>(() =>
  bindings.value.map((binding) => {
    const environment = environments.value.find((item) => item.id === binding.environmentId)
    const current = deployments.value.find((item) => item.id === binding.currentDeploymentId)
    return {
      id: binding.id,
      envName: environment?.name ?? binding.environmentId,
      production: environment?.production ?? false,
      clusterId: binding.target.clusterId,
      namespace: binding.target.namespace,
      releaseName: binding.target.releaseName,
      deployStatus: current?.status ?? '',
    }
  }),
)

async function loadConfig(): Promise<AppConfig | null> {
  try {
    return await getConfig(appId.value)
  } catch {
    // 尚未生成配置的应用不阻塞概览
    return null
  }
}

async function load(): Promise<void> {
  if (!appId.value) return
  loading.value = true
  error.value = ''
  try {
    const [appItem, projectItem, configItem, bindingItems, envItems, deployPage, me, projectList] = await Promise.all([
      getApplication(appId.value),
      getProject(String(route.params.projectId ?? '')),
      loadConfig(),
      listBindings(appId.value),
      listEnvironments(),
      listDeployments(appId.value),
      getMe(),
      listProjects(),
    ])
    app.value = appItem
    project.value = projectItem
    config.value = configItem
    bindings.value = bindingItems
    environments.value = envItems
    deployments.value = deployPage.items
    createdBy.value = me.name || '张运维'
    projects.value = projectList
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载应用概览失败'
  } finally {
    loading.value = false
  }
}

watch(appId, load, { immediate: true })
</script>

<template>
  <div class="ov">
    <div v-if="loading" class="ov__state">
      <t-loading size="small" />
      <span class="u-muted">加载应用概览…</span>
    </div>

    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <EmptyState
      v-else-if="!app"
      title="应用数据不完整"
      description="未能读取该应用的概览数据，请返回项目后重新进入。"
      icon="error-circle"
    />

    <div v-else class="ov__grid">
      <!-- 左列：应用档案 -->
      <aside class="ov__side">
        <div class="ov__icon">{{ initial }}</div>
        <h1 class="ov__name">{{ appName }}</h1>

        <p class="ov__desc" :class="{ 'ov__desc--placeholder': !description }">
          <span class="ov__desc-text">{{ description || 'Write a short description' }}</span>
          <button type="button" class="ov__edit-btn" title="编辑描述" @click="openMeta('description')">
            <t-icon name="edit" size="13px" />
          </button>
        </p>

        <div class="ov__divider" />

        <div class="ov__field">
          <div class="ov__field-head">
            <span class="ov__field-label">Project</span>
            <button type="button" class="ov__edit-btn" title="调整所属项目" @click="openMeta('project')">
              <t-icon name="edit" size="13px" />
            </button>
          </div>
          <div class="ov__field-value">{{ projectName }}</div>
        </div>

        <div class="ov__field">
          <span class="ov__field-label">Created on</span>
          <div class="ov__field-value">
            {{ createdOn }}
            <span class="ov__field-note">静态数据</span>
          </div>
        </div>

        <div class="ov__field">
          <span class="ov__field-label">Created by</span>
          <div class="ov__field-value ov__field-value--row">
            <span class="ov__avatar">{{ createdBy.slice(0, 1) }}</span>
            {{ createdBy }}
          </div>
        </div>

        <div class="ov__field">
          <span class="ov__field-label">Code source</span>
          <div class="ov__field-value ov__field-value--row">
            <t-icon name="git-branch" class="ov__git" size="14px" />
            {{ repoLabel || '—' }}
          </div>
        </div>

        <div class="ov__field">
          <div class="ov__field-head">
            <span class="ov__field-label">
              <t-icon name="tag" size="13px" />
              Tags
            </span>
            <t-icon name="edit" class="ov__edit" size="13px" @click="openMeta('tags')" />
          </div>
          <div v-if="app.tags?.length" class="ov__tags">
            <t-tag v-for="tag in app.tags" :key="tag" size="small" variant="light" theme="primary">{{ tag }}</t-tag>
          </div>
          <p v-else class="ov__tags-text">
            为应用添加标签；标签会同步到对应的 Kubernetes 资源上。
            <button type="button" class="ov__link" @click="openMeta('tags')">Add Tags</button>
          </p>
          <button v-if="app.tags?.length" type="button" class="ov__link" @click="openMeta('tags')">
            编辑标签
          </button>
        </div>
      </aside>

      <!-- 右列：About / Environments -->
      <section class="ov__main">
        <div class="ov__tabs">
          <button
            type="button"
            class="ov__tab"
            :class="{ 'ov__tab--active': tab === 'about' }"
            @click="tab = 'about'"
          >
            About
          </button>
          <button
            type="button"
            class="ov__tab"
            :class="{ 'ov__tab--active': tab === 'environments' }"
            @click="tab = 'environments'"
          >
            Environments
          </button>
        </div>

        <section v-if="tab === 'about'" class="tk-panel ov__readme">
          <div class="ov__readme-head">
            <span class="ov__readme-title">
              <t-icon name="file" size="14px" />
              Readme
            </span>
            <button type="button" class="ov__link" @click="openMeta('readme')">Edit</button>
          </div>
          <div class="ov__readme-body">
            <template v-if="readmeLines.length">
              <template v-for="(line, index) in readmeLines" :key="index">
                <h2 v-if="line.startsWith('## ')" class="ov__readme-h2">{{ line.slice(3) }}</h2>
                <p v-else-if="line.startsWith('- ')" class="ov__readme-li">{{ line.slice(2) }}</p>
                <p v-else>{{ line }}</p>
              </template>
            </template>
            <template v-else>
              <h2>Describe this application</h2>
              <p>
                用几句话描述这个应用。描述可以包含应用的用途、功能、收益与目标用户；写得清楚的描述能帮助使用者快速了解这个应用如何工作，请保持简洁准确。
              </p>
            </template>
          </div>
        </section>

        <section v-else class="tk-panel ov__envs">
          <div class="tk-panel__head">
            <span>Environments</span>
            <span class="u-muted">{{ envRows.length }} 个环境绑定</span>
          </div>
          <EmptyState
            v-if="!envRows.length"
            compact
            title="还没有环境绑定"
            description="完成基础配置后，在环境覆盖里创建绑定即可发布。"
            icon="layers"
          />
          <t-table v-else :data="envRows" :columns="envColumns" row-key="id" size="small" hover>
            <template #envName="{ row }">
              <span class="ov__env">
                {{ row.envName }}
                <t-tag v-if="row.production" size="small" variant="outline" theme="warning">生产</t-tag>
              </span>
            </template>
            <template #clusterId="{ row }">
              <span class="u-mono">{{ row.clusterId }}</span>
            </template>
            <template #namespace="{ row }">
              <span class="u-mono">{{ row.namespace }}</span>
            </template>
            <template #releaseName="{ row }">
              <span class="u-mono">{{ row.releaseName }}</span>
            </template>
            <template #status="{ row }">
              <StatusTag v-if="row.deployStatus" kind="deploy" :value="row.deployStatus" />
              <span v-else class="u-dim">未发布</span>
            </template>
          </t-table>
        </section>
      </section>
    </div>

    <t-dialog
      v-model:visible="metaVisible"
      :header="metaTitle"
      width="560px"
      :confirm-btn="metaSaving ? '保存中…' : '保存'"
      @confirm="saveMeta"
    >
      <div class="ov__meta">
        <template v-if="metaField === 'description'">
          <p class="u-dim">一句话说明这个应用做什么、给谁用。</p>
          <t-textarea v-model="metaText" :autosize="{ minRows: 3, maxRows: 6 }" placeholder="例如：结算主链路 API，负责购物车结算与订单提交" />
        </template>

        <template v-else-if="metaField === 'readme'">
          <p class="u-dim">支持简单 Markdown：`## 标题`、`- 列表项`、普通段落。</p>
          <t-textarea v-model="metaText" :autosize="{ minRows: 8, maxRows: 16 }" placeholder="## checkout-api ..." />
        </template>

        <template v-else-if="metaField === 'tags'">
          <p class="u-dim">标签会用于筛选与资源标记。</p>
          <div class="ov__meta-tags">
            <t-tag
              v-for="tag in metaTags"
              :key="tag"
              size="small"
              variant="light"
              theme="primary"
              closable
              @close="removeTag(tag)"
            >
              {{ tag }}
            </t-tag>
            <span v-if="!metaTags.length" class="u-dim">还没有标签</span>
          </div>
          <div class="ov__meta-add">
            <t-input v-model="metaTagInput" size="small" placeholder="输入标签后回车" @enter="addTag" />
            <t-button size="small" variant="outline" @click="addTag">添加</t-button>
          </div>
        </template>

        <template v-else>
          <p class="u-dim">移动应用会改变它在项目列表中的归属，环境绑定不受影响。</p>
          <t-select
            v-model="metaProjectId"
            :options="projects.map((item) => ({ label: item.name, value: item.id }))"
            placeholder="选择目标项目"
          />
        </template>
      </div>
    </t-dialog>
  </div>
</template>

<style scoped>
.ov {
  display: flex;
  flex-direction: column;
}
.ov__state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 56px 16px;
}
.ov__grid {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  gap: 40px;
  align-items: start;
  padding: 8px 0 24px;
}

/* ---- 左列 ---- */
.ov__side {
  min-width: 0;
}
.ov__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  color: var(--tk-primary);
  font-size: 18px;
  font-weight: 600;
  background: #eef4ff;
  border: 1px solid #d6e4ff;
  border-radius: 8px;
}
.ov__name {
  margin: 12px 0 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}
.ov__desc {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 6px 0 0;
  color: var(--tk-text-2);
}
.ov__desc--placeholder {
  color: var(--tk-text-3);
}
.ov__edit-btn {
  padding: 0;
  color: var(--tk-text-3);
  background: none;
  border: 0;
  cursor: pointer;
  line-height: 0;
}

.ov__desc-text {
  min-width: 0;
}
.ov__edit {
  flex: none;
  margin-top: 2px;
  color: var(--tk-text-3);
  cursor: pointer;
}
.ov__edit:hover {
  color: var(--tk-primary);
}
.ov__divider {
  height: 1px;
  margin: 18px 0;
  background: var(--tk-border);
}
.ov__field + .ov__field {
  margin-top: 16px;
}
.ov__field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ov__field-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--tk-text-3);
  font-size: 12px;
}
.ov__field-value {
  margin-top: 3px;
  color: var(--tk-text);
  font-size: var(--tk-font);
  word-break: break-word;
}
.ov__field-value--row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ov__field-note {
  margin-left: 6px;
  color: var(--tk-text-3);
  font-size: 11px;
}
.ov__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 18px;
  height: 18px;
  color: #fff;
  font-size: 10px;
  background: var(--tk-danger);
  border-radius: 50%;
}
.ov__git {
  flex: none;
  color: var(--tk-warning);
}
.ov__tags-text {
  margin: 4px 0 0;
  color: var(--tk-text-3);
  font-size: 12px;
  line-height: 19px;
}
.ov__link {
  padding: 0;
  color: var(--tk-primary);
  font: inherit;
  font-size: 12px;
  background: none;
  border: 0;
  cursor: pointer;
}
.ov__link:hover {
  text-decoration: underline;
}

/* ---- 右列 ---- */
.ov__main {
  min-width: 0;
}
.ov__tabs {
  display: inline-flex;
  padding: 2px;
  background: #f2f4f8;
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.ov__tab {
  height: 26px;
  padding: 0 14px;
  color: var(--tk-text-2);
  font: inherit;
  font-size: 12px;
  background: none;
  border: 0;
  border-radius: 2px;
  cursor: pointer;
}
.ov__tab:hover {
  color: var(--tk-primary);
}
.ov__tab--active {
  color: var(--tk-text);
  font-weight: 600;
  background: var(--tk-surface);
  box-shadow: 0 1px 2px rgba(16, 42, 99, 0.08);
}
.ov__readme,
.ov__envs {
  margin-top: 16px;
}
.ov__readme-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 16px;
  border-bottom: 1px solid var(--tk-border);
}
.ov__readme-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}
.ov__readme-body {
  padding: 20px 24px 28px;
}
.ov__readme-body h2 {
  color: #2b3a52;
  font-size: 20px;
  font-weight: 500;
  line-height: 28px;
}
.ov__readme-body p {
  max-width: 960px;
  margin: 10px 0 0;
  color: var(--tk-text-2);
  font-size: var(--tk-font);
  line-height: 21px;
}
.ov__env {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

@media (max-width: 1080px) {
  .ov__grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
  }
}
</style>
