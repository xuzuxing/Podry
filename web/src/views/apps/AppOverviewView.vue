<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import {
  getApplication,
  getConfig,
  getMe,
  getProject,
  listArtifacts,
  listBindings,
  listBuilds,
  listDeployments,
  listEnvironments,
  listProjects,
  updateApplication,
} from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import type {
  AppConfig,
  Application,
  Artifact,
  Binding,
  Build,
  DeployStatus,
  Deployment,
  Environment,
  Project,
} from '@/types'
import { fmtRelative, fmtTime } from '@/utils/format'

type OverviewTab = 'about' | 'environments'

interface EnvRow {
  id: string
  envName: string
  production: boolean
  clusterId: string
  namespace: string
  releaseName: string
  deployStatus: DeployStatus | ''
  imageTag: string
  commit: string
  deployedAt: string
  operator: string
}

const route = useRoute()
const appId = computed(() => String(route.params.appId ?? ''))
const baseParams = computed(() => ({ projectId: String(route.params.projectId ?? ''), appId: appId.value }))

const loading = ref(true)
const error = ref('')
const tab = ref<OverviewTab>('about')

const app = ref<Application | null>(null)
const project = ref<Project | null>(null)
const config = ref<AppConfig | null>(null)
const bindings = ref<Binding[]>([])
const environments = ref<Environment[]>([])
const deployments = ref<Deployment[]>([])
const artifacts = ref<Artifact[]>([])
const builds = ref<Build[]>([])
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
    readme: '编辑应用说明',
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

/** 镜像 tag：harbor.acme.dev/acme/app:v1.42.0 → v1.42.0 */
function tagOf(imageRef: string): string {
  const parts = imageRef.split(':')
  return parts.length > 1 ? parts[parts.length - 1] : imageRef
}

const envRows = computed<EnvRow[]>(() =>
  bindings.value.map((binding) => {
    const environment = environments.value.find((item) => item.id === binding.environmentId)
    const current =
      deployments.value.find((item) => item.id === binding.currentDeploymentId) ??
      deployments.value
        .filter((item) => item.bindingId === binding.id)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
    const artifact = current ? artifacts.value.find((item) => item.id === current.artifactId) : undefined
    const build = artifact?.buildId ? builds.value.find((item) => item.id === artifact.buildId) : undefined
    return {
      id: binding.id,
      envName: environment?.name ?? binding.environmentId,
      production: environment?.production ?? false,
      clusterId: binding.target.clusterId,
      namespace: binding.target.namespace,
      releaseName: binding.target.releaseName,
      deployStatus: current?.status ?? '',
      imageTag: current ? tagOf(current.imageRef) : '',
      commit: build?.commitSha ? build.commitSha.slice(0, 7) : '',
      deployedAt: current?.createdAt ?? '',
      operator: current?.operator ?? '',
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
    const [appItem, projectItem, configItem, bindingItems, envItems, deployPage, artifactItems, buildPage, me, projectList] =
      await Promise.all([
        getApplication(appId.value),
        getProject(String(route.params.projectId ?? '')),
        loadConfig(),
        listBindings(appId.value),
        listEnvironments(),
        listDeployments(appId.value),
        listArtifacts(appId.value),
        listBuilds(appId.value),
        getMe(),
        listProjects(),
      ])
    app.value = appItem
    project.value = projectItem
    config.value = configItem
    bindings.value = bindingItems
    environments.value = envItems
    deployments.value = deployPage.items
    artifacts.value = artifactItems
    builds.value = buildPage.items
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
          <span class="ov__desc-text">{{ description || '写一句简短描述' }}</span>
          <button type="button" class="ov__edit-btn" title="编辑描述" @click="openMeta('description')">
            <t-icon name="edit" size="13px" />
          </button>
        </p>

        <div class="ov__divider" />

        <div class="ov__field">
          <div class="ov__field-head">
            <span class="ov__field-label">所属项目</span>
            <button type="button" class="ov__edit-btn" title="调整所属项目" @click="openMeta('project')">
              <t-icon name="edit" size="13px" />
            </button>
          </div>
          <div class="ov__field-value">{{ projectName }}</div>
        </div>

        <div class="ov__field">
          <span class="ov__field-label">创建时间</span>
          <div class="ov__field-value">
            {{ createdOn }}
            <span class="ov__field-note">静态数据</span>
          </div>
        </div>

        <div class="ov__field">
          <span class="ov__field-label">创建人</span>
          <div class="ov__field-value ov__field-value--row">
            <span class="ov__avatar">{{ createdBy.slice(0, 1) }}</span>
            {{ createdBy }}
          </div>
        </div>

        <div class="ov__field">
          <span class="ov__field-label">代码来源</span>
          <div class="ov__field-value ov__field-value--row">
            <t-icon name="git-branch" class="ov__git" size="14px" />
            {{ repoLabel || '—' }}
          </div>
        </div>

        <div class="ov__field">
          <div class="ov__field-head">
            <span class="ov__field-label">
              <t-icon name="tag" size="13px" />
              标签
            </span>
            <t-icon name="edit" class="ov__edit" size="13px" @click="openMeta('tags')" />
          </div>
          <div v-if="app.tags?.length" class="ov__tags">
            <t-tag v-for="tag in app.tags" :key="tag" size="small" variant="light" theme="primary">{{ tag }}</t-tag>
          </div>
          <p v-else class="ov__tags-text">
            为应用添加标签；标签会同步到对应的 Kubernetes 资源上。
            <button type="button" class="ov__link" @click="openMeta('tags')">添加标签</button>
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
            关于
          </button>
          <button
            type="button"
            class="ov__tab"
            :class="{ 'ov__tab--active': tab === 'environments' }"
            @click="tab = 'environments'"
          >
            环境
          </button>
        </div>

        <section v-if="tab === 'about'" class="tk-panel ov__readme">
          <div class="ov__readme-head">
            <span class="ov__readme-title">
              <t-icon name="file" size="14px" />
              说明
            </span>
            <button type="button" class="ov__link" @click="openMeta('readme')">编辑</button>          </div>
          <div class="ov__readme-body">
            <template v-if="readmeLines.length">
              <template v-for="(line, index) in readmeLines" :key="index">
                <h2 v-if="line.startsWith('## ')" class="ov__readme-h2">{{ line.slice(3) }}</h2>
                <p v-else-if="line.startsWith('- ')" class="ov__readme-li">{{ line.slice(2) }}</p>
                <p v-else>{{ line }}</p>
              </template>
            </template>
            <template v-else>
              <h2>介绍这个应用</h2>
              <p>
                用几句话描述这个应用。描述可以包含应用的用途、功能、收益与目标用户；写得清楚的描述能帮助使用者快速了解这个应用如何工作，请保持简洁准确。
              </p>
            </template>
          </div>
        </section>

        <section v-else class="ov__envs">
          <EmptyState
            v-if="!envRows.length"
            compact
            title="还没有环境绑定"
            description="完成基础配置后，在环境覆盖里创建绑定即可发布。"
            icon="layers"
          />
          <div v-else class="env-table">
            <div class="env-table__head">
              <span>环境<span class="env-table__sort">↑</span></span>
              <span>最近部署<span class="env-table__sort">→</span></span>
              <span>提交</span>
              <span>部署时间<span class="env-table__sort">⇅</span></span>
            </div>
            <router-link
              v-for="row in envRows"
              :key="row.id"
              class="env-row"
              :to="{ name: 'app-resources', params: baseParams, query: { env: row.id } }"
            >
              <span class="env-row__name">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M8 1.5 13.5 4.4v7.2L8 14.5 2.5 11.6V4.4L8 1.5Z"
                    stroke="#0066cc"
                    stroke-width="1.2"
                    stroke-linejoin="round"
                  />
                  <path d="M2.7 4.5 8 7.2l5.3-2.7M8 7.2v7" stroke="#0066cc" stroke-width="1.2" stroke-linejoin="round" />
                </svg>
                <span>{{ row.envName }}</span>
              </span>

              <span v-if="row.imageTag" class="env-row__deploy">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M14.5 4.5c2.5-1.4 4.7-1.3 6-.1 1.2 1.3 1.3 3.5-.1 6-1 1.8-2.6 3.6-4.7 5.2l-4.8-4.8c1.6-2.1 3.4-3.7 5.2-4.7l-1.6-1.6Z" fill="#f33e3e" />
                  <path d="M6.8 9.8 3 11l3.4 3.4L9.8 18l1.2-3.8" stroke="#0066cc" stroke-width="1.4" stroke-linejoin="round" />
                </svg>
                <span class="tag-chip" :title="row.imageTag">...{{ row.imageTag }}</span>
              </span>
              <span v-else class="env-row__muted">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="m2.5 2.5 7 7m0-7-7 7" stroke="#f33e3e" stroke-width="1.4" stroke-linecap="round" />
                </svg>
                未部署
              </span>

              <span v-if="row.commit" class="env-row__commit">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M4.25 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0v3.25m0-3.25h5.5a2 2 0 0 0 2-2V6.25m0 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"
                    stroke="#596168"
                    stroke-width="1.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span class="sha-chip">{{ row.commit }}</span>
              </span>
              <span v-else class="env-row__muted">—</span>

              <span v-if="row.deployedAt" class="env-row__at">
                <span class="env-row__avatar">{{ row.operator.slice(0, 1) || 'A' }}</span>
                <span>{{ row.operator || 'admin' }}</span>
                <span class="env-row__ago">{{ fmtRelative(row.deployedAt) }}</span>
              </span>
              <span v-else class="env-row__muted">—</span>
            </router-link>
          </div>
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
  width: 48px;
  height: 48px;
  color: var(--tk-primary);
  font-size: 20px;
  font-weight: 600;
  background: #eef4ff;
  border: 1px solid #d6e4ff;
  border-radius: 8px;
}
.ov__name {
  margin: 14px 0 0;
  color: #000a14;
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
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
  color: #3b444c;
  font-size: 24px;
  font-weight: 400;
  line-height: 32px;
}
.ov__readme-body p {
  max-width: 960px;
  margin: 10px 0 0;
  color: var(--tk-text-2);
  font-size: var(--tk-font);
  line-height: 21px;
}

/* ---- Environments 表（对齐 Devtron：Environment / Last Deployed / Commit / Deployed At） ---- */
.env-table {
  overflow: hidden;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.env-table__head,
.env-row {
  display: grid;
  grid-template-columns: 26% 30% 20% 24%;
  align-items: center;
  padding: 0 16px;
}
.env-table__head {
  height: 42px;
  color: #767d84;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border-bottom: 1px solid #e6e9ef;
}
.env-table__sort {
  margin-left: 6px;
  font-size: 11px;
  color: #959ba1;
}
.env-row {
  min-height: 46px;
  color: #3b444c;
  font-size: 13px;
  border-bottom: 1px solid #edf1f5;
}
.env-row:last-child {
  border-bottom: 0;
}
.env-row:hover {
  background: #f7fafc;
}
.env-row__name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #0066cc;
  font-weight: 400;
}
.env-row__name:hover {
  text-decoration: underline;
}
.env-row__deploy,
.env-row__commit,
.env-row__at {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.env-row__muted {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #3b444c;
}
.tag-chip {
  overflow: hidden;
  max-width: 150px;
  padding: 1px 6px;
  color: #0066cc;
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: #e8f0fe;
  border-radius: 2px;
}
.sha-chip {
  padding: 1px 6px;
  color: #0066cc;
  font-size: 12px;
  line-height: 18px;
  background: #e8f0fe;
  border-radius: 2px;
}
.env-row__avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: #fff;
  font-size: 10px;
  background: #f33e3e;
  border-radius: 50%;
}
.env-row__ago {
  color: #767d84;
}

@media (max-width: 1080px) {
  .ov__grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
  }
}
</style>
