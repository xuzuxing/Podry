<script setup lang="ts">
/**
 * 应用配置布局：对齐 Devtron Configurations。
 * - 主视图：Git 仓库 / 构建配置 / 基础配置 / 工作流编辑器 + 环境覆盖 + 删除应用。
 * - Base / 环境覆盖视图：左侧切换为上下文面板（返回、对比环境、部署模板 / ConfigMaps / Secrets）。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { listEnvironments, listBindings, getApplication, getSetup, updateApplication } from '@/api'
import type { Application, ApplicationSetup, Binding, Environment, SetupKey } from '@/types'
import { onSetupChanged } from '@/utils/appEvents'

const route = useRoute()
const router = useRouter()
const appId = computed(() => String(route.params.appId ?? ''))
const projectId = computed(() => String(route.params.projectId ?? ''))
const routeName = computed(() => String(route.name ?? ''))

const environments = ref<Environment[]>([])
const bindings = ref<Binding[]>([])
const configuredEnvironments = computed(() => environments.value.filter((env) => bindings.value.some((binding) => binding.environmentId === env.id)))
const app = ref<Application | null>(null)
const loadingEnv = ref(false)
const setup = ref<ApplicationSetup | null>(null)
const deleteVisible = ref(false)
const deleting = ref(false)
const deleteConfirm = ref('')

const canDelete = computed(() => Boolean(app.value?.name) && deleteConfirm.value.trim() === app.value?.name)

function openDelete(): void {
  deleteConfirm.value = ''
  deleteVisible.value = true
}

const setupPercent = computed(() => {
  if (!setup.value?.total) return 0
  return Math.round((setup.value.completed / setup.value.total) * 100)
})
const nextSectionLabel = computed(() => {
  const labels: Record<SetupKey, string> = {
    git: 'Git 仓库',
    build: '构建配置',
    base: '部署模板',
    workflow: '工作流',
  }
  return setup.value?.nextSection ? labels[setup.value.nextSection] : ''
})

const isBase = computed(() => routeName.value.startsWith('config-base'))
const isOverride = computed(
  () => routeName.value.startsWith('config-override') && Boolean(route.params.envId),
)
const inContext = computed(() => isBase.value || isOverride.value)
const envId = computed(() => String(route.params.envId ?? ''))
const envName = computed(() => environments.value.find((item) => item.id === envId.value)?.name ?? envId.value)

const section = computed<'deployment' | 'configmaps' | 'secrets'>(() => {
  if (routeName.value.endsWith('configmaps')) return 'configmaps'
  if (routeName.value.endsWith('secrets')) return 'secrets'
  return 'deployment'
})

const mainItems = computed(() =>
  app.value?.sourceMode === 'image'
    ? [
        { label: '基础配置', name: 'config-base-deployment' },
        { label: '工作流编辑器', name: 'config-workflow' },
      ]
    : [
        { label: 'Git 仓库', name: 'config-git' },
        { label: '构建配置', name: 'config-build' },
        { label: '基础配置', name: 'config-base-deployment' },
        { label: '工作流编辑器', name: 'config-workflow' },
      ],
)

/** 主视图里 Base Configurations 的高亮判断 */
function mainActive(name: string): boolean {
  if (name === 'config-base-deployment') return isBase.value
  if (inContext.value) return false
  return routeName.value === name
}

const sectionItems = computed(() => {
  const prefix = isBase.value ? 'config-base' : 'config-override'
  return [
    { label: '部署模板', section: 'deployment' as const, name: `${prefix}-deployment`, icon: 'cloud' },
    { label: 'ConfigMaps', section: 'configmaps' as const, name: `${prefix}-configmaps`, icon: 'folder' },
    { label: 'Secrets', section: 'secrets' as const, name: `${prefix}-secrets`, icon: 'lock-on' },
  ]
})

function createEntry(kind: 'deployment' | 'configmaps' | 'secrets'): void {
  if (kind === 'deployment') return
  const name = isBase.value ? `config-base-${kind}` : `config-override-${kind}`
  void router.push({
    name,
    params: isOverride.value
      ? { projectId: projectId.value, appId: appId.value, envId: envId.value }
      : { projectId: projectId.value, appId: appId.value },
    query: { create: '1' },
  })
}

function compare(): void {
  void router.push({
    name: 'config-compare',
    params: { projectId: projectId.value, appId: appId.value, resourceType: section.value, resourceName: section.value !== 'deployment' && typeof route.query.entry === 'string' ? route.query.entry : undefined },
    query: { left: isOverride.value ? envId.value : 'base', leftVersion: 'saved', returnEnv: isOverride.value ? envId.value : 'base' },
  })
}

function switchEnv(id: string): void {
  if (id === envId.value) return
  void router.push({
    name: `config-override-${section.value}`,
    params: { projectId: projectId.value, appId: appId.value, envId: id },
  })
}

async function loadEnvironments(): Promise<void> {
  loadingEnv.value = true
  try {
    const [envs, appBindings] = await Promise.all([listEnvironments(), listBindings(appId.value)])
    environments.value = envs
    bindings.value = appBindings
  } catch {
    environments.value = []
  } finally {
    loadingEnv.value = false
  }
}

async function removeApplication(): Promise<void> {
  if (!canDelete.value) {
    MessagePlugin.warning('请输入应用名称后再确认归档')
    return
  }
  deleting.value = true
  try {
    await updateApplication(appId.value, { archived: true })
    deleteVisible.value = false
    MessagePlugin.success('应用已归档')
    await router.push({ name: 'apps' })
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '归档失败')
  } finally {
    deleting.value = false
  }
}

async function loadSetup(): Promise<void> {
  try {
    setup.value = await getSetup(appId.value)
  } catch {
    setup.value = null
  }
}

async function loadApplication(): Promise<void> {
  try {
    app.value = await getApplication(appId.value)
  } catch {
    app.value = null
  }
}

watch(
  appId,
  () => {
    void loadEnvironments()
    void loadSetup()
    void loadApplication()
  },
  { immediate: true },
)
watch(
  () => route.fullPath,
  () => {
    if (!inContext.value) void loadSetup()
  },
)

onUnmounted(
  onSetupChanged((id) => {
    if (id === appId.value) void loadSetup()
  }),
)
</script>

<template>
  <div class="cfg">
    <aside class="cfg__nav" :class="{ 'cfg__nav--context': inContext }">
      <!-- Base / 环境覆盖：上下文面板 -->
      <template v-if="inContext">
        <RouterLink v-if="isOverride" class="cfg__back" :to="{ name: 'config-workflow', params: { projectId, appId } }" aria-label="返回配置导航"><t-icon name="chevron-left" size="14px" /></RouterLink>
        <t-dropdown
          v-if="isOverride"
          trigger="click"
          placement="bottom-left"
          :popup-props="{ overlayClassName: 'cfg-env-popup' }"
        >
          <button type="button" class="cfg__ctx cfg__ctx--switch">
            <span class="cfg__ctx-name">{{ envName || '环境' }}</span>
            <t-icon name="chevron-down" size="12px" />
          </button>
          <template #dropdown>
            <t-dropdown-menu>
              <t-dropdown-item v-for="env in configuredEnvironments" :key="env.id" @click="switchEnv(env.id)">
                {{ env.name }}
              </t-dropdown-item>
            </t-dropdown-menu>
          </template>
        </t-dropdown>
        <router-link v-else class="cfg__ctx" :to="{ name: 'config-workflow', params: { projectId, appId } }">
          <t-icon name="chevron-left" size="14px" />
          <span class="cfg__ctx-name">基础配置</span>
        </router-link>
        <button type="button" class="cfg__compare" @click="compare">
          <t-icon name="swap" size="14px" />
          对比环境...
        </button>
        <nav class="cfg__sections">
          <template v-for="item in sectionItems" :key="item.name">
          <RouterLink
            class="cfg__section"
            :class="{ 'cfg__section--active': section === item.section }"
            :to="{ name: item.name, params: isOverride ? { projectId, appId, envId } : { projectId, appId } }"
          >
            <t-icon :name="item.icon" size="15px" />
            <span>{{ item.label }}</span>
            <button
              v-if="item.section !== 'deployment'"
              type="button"
              class="cfg__plus"
              :title="`新建 ${item.label}`"
              @click.prevent.stop="createEntry(item.section)"
            >
              +
            </button>
          </RouterLink>
          <div v-if="section === item.section && section !== 'deployment'" id="config-entry-navigation" />
          </template>
        </nav>
      </template>

      <!-- 主视图 -->
      <template v-else>
        <div v-if="setup && setup.completed < setup.total" class="cfg__progress">
          <div class="cfg__progress-head">
            <span>已完成 {{ setup.completed }}/{{ setup.total }}</span>
            <span class="cfg__progress-help">需要帮助？</span>
          </div>
          <div class="cfg__progress-bar">
            <span :style="{ width: `${setupPercent}%` }" />
          </div>
          <p v-if="nextSectionLabel" class="cfg__progress-next">下一步：{{ nextSectionLabel }}</p>
        </div>

        <nav class="cfg__main">
          <RouterLink
            v-for="item in mainItems"
            :key="item.name"
            class="cfg__item"
            :class="{ 'cfg__item--active': mainActive(item.name) }"
            :to="{ name: item.name, params: { projectId, appId } }"
          >
            {{ item.label }}
          </RouterLink>
        </nav>

        <p class="cfg__group">环境覆盖</p>
        <nav class="cfg__envs">
          <RouterLink
            v-for="env in configuredEnvironments"
            :key="env.id"
            class="cfg__env"
            :to="{ name: 'config-override-deployment', params: { projectId, appId, envId: env.id } }"
          >
            {{ env.name }}
          </RouterLink>
          <span v-if="loadingEnv" class="cfg__env cfg__env--muted">加载环境…</span>
          <span v-else-if="!configuredEnvironments.length" class="cfg__env cfg__env--muted">暂无环境</span>
        </nav>

        <div v-if="!configuredEnvironments.length && !loadingEnv" class="cfg__env-note">
          <t-icon name="help-circle" size="15px" />
          <p>
            环境覆盖允许在创建部署流水线后，为单个环境管理专属配置。
            <span class="cfg__env-more">了解更多</span>
          </p>
        </div>

        <div class="cfg__foot">
          <button type="button" class="cfg__delete" @click="openDelete">删除应用</button>
        </div>
      </template>
    </aside>

    <section class="cfg__content">
      <router-view />
    </section>

    <t-dialog
      v-model:visible="deleteVisible"
      header="删除应用"
      :confirm-btn="deleting ? '处理中…' : '归档应用'"
      @confirm="removeApplication"
    >
      <t-alert
        theme="error"
        title="归档后应用将从列表移除"
        message="运行中的资源不会被删除；该操作不可撤销。"
        class="cfg__delete-alert"
      />
      <p class="cfg__delete-text">
        请输入应用名称 <span class="u-mono">{{ app?.name }}</span> 以确认。
      </p>
      <t-input v-model="deleteConfirm" placeholder="输入应用名称" />
      <p class="u-dim cfg__delete-note">本操作为本地 mock，仅修改当前会话数据。</p>
    </t-dialog>

  </div>
</template>

<style scoped>
.cfg {
  display: flex;
  align-items: stretch;
  height: calc(100dvh - 102px);
  min-height: 0;
  overflow: hidden;
  background: #fff;
}
.cfg__nav {
  position: relative;
  display: flex;
  flex: none;
  flex-direction: column;
  width: 256px;
  min-height: 0;
  overflow: auto;
  padding: 16px 0 12px;
  background: #fff;
  border-right: 1px solid #e6e9ef;
}
.cfg__progress {
  margin: 0 12px 10px;
  padding: 10px 12px;
  background: #f7fafc;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.cfg__progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #3b444c;
  font-size: 12px;
  line-height: 18px;
}
.cfg__progress-help {
  color: #0066cc;
  font-size: 11px;
  cursor: pointer;
}
.cfg__progress-bar {
  height: 3px;
  margin-top: 8px;
  overflow: hidden;
  background: #e6e9ef;
  border-radius: 2px;
}
.cfg__progress-bar span {
  display: block;
  height: 100%;
  background: #1dad70;
  border-radius: 2px;
  transition: width 0.2s ease;
}
.cfg__progress-next {
  margin: 8px 0 0;
  color: #767d84;
  font-size: 11px;
}
.cfg__main {
  display: flex;
  flex-direction: column;
}
.cfg__item {
  display: flex;
  align-items: center;
  height: 32px;
  margin: 0 12px;
  padding: 0 8px;
  border-radius: 4px;
  color: #3b444c;
  font-size: 13px;
}
.cfg__item:hover {
  color: #0066cc;
  background: #f7fafc;
}
.cfg__item--active {
  color: #0066cc;
  background: #eaf2fd;
}
.cfg__group {
  margin: 16px 12px 8px;
  padding: 16px 8px 0;
  border-top: 1px solid #e6e9ef;
  color: #767d84;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.cfg__envs {
  display: flex;
  flex-direction: column;
}
.cfg__env {
  display: flex;
  align-items: center;
  height: 32px;
  margin: 0 12px;
  padding: 0 8px;
  color: #3b444c;
  font-size: 13px;
}
.cfg__env:hover {
  color: #0066cc;
  background: #f7fafc;
}
.cfg__env--muted {
  color: #959ba1;
}
.cfg__env-note {
  display: flex;
  gap: 8px;
  margin: 12px 12px 0;
  padding: 10px 12px;
  color: #596168;
  font-size: 11px;
  line-height: 16px;
  background: #f7f4ff;
  border: 1px solid #e3dbff;
  border-radius: 4px;
}
.cfg__env-note p {
  margin: 0;
}
.cfg__env-more {
  color: #664bee;
  cursor: pointer;
}
.cfg__foot {
  margin-top: auto;
  padding: 16px;
}
.cfg__delete {
  width: 100%;
  height: 36px;
  color: #f33e3e;
  font: inherit;
  font-size: 13px;
  background: #fff;
  border: 1px solid #f6b7b4;
  border-radius: 4px;
  cursor: pointer;
}
.cfg__delete:hover {
  background: #fdeceb;
}

/* ---- 上下文面板 ---- */
.cfg__ctx {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  margin: 0 12px 8px;
  padding: 0 8px;
  color: #3b444c;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid #e6e9ef;
}
.cfg__ctx--switch {
  width: calc(100% - 24px);
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1px solid #e6e9ef;
  cursor: pointer;
}
.cfg__ctx--switch:hover {
  color: #0066cc;
}
.cfg__ctx--switch { padding-left: 36px; }
.cfg__back { position: absolute; z-index: 1; top: 27px; left: 19px; display: grid; place-items: center; width: 20px; height: 20px; background: #fff; border: 1px solid #d0d4d9; border-radius: 4px; color: #596168; }
.cfg__nav--context { padding-top: 0; }
.cfg__nav--context .cfg__ctx { height: 36px; }
.cfg__nav--context .cfg__back { top: 8px; }
.cfg__nav--context .cfg__compare { height: 32px; margin: 0 12px 16px; color: #0066cc; }
.cfg__ctx-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cfg__compare {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  margin: 0 16px 12px;
  color: #3b444c;
  font: inherit;
  font-size: 12px;
  background: #fff;
  border: 1px solid #d0d4d9;
  border-radius: 4px;
  cursor: pointer;
}
.cfg__compare:hover {
  background: #f7fafc;
}
.cfg__sections {
  display: flex;
  flex-direction: column;
}
.cfg__section {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  margin: 0 8px;
  padding: 0 8px;
  border-radius: 4px;
  color: #3b444c;
  font-size: 13px;
}
.cfg__section:hover {
  color: #0066cc;
  background: #f7fafc;
}
.cfg__section--active {
  color: #0066cc;
  font-weight: 600;
  background: #eaf2fd;
}
.cfg__section > span {
  flex: 1;
}
.cfg__plus {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: #3b444c;
  font-size: 14px;
  line-height: 1;
  background: none;
  border: 0;
  border-radius: 2px;
  cursor: pointer;
}
.cfg__plus:hover {
  background: #dbeafe;
}

.cfg__delete-alert {
  margin-bottom: 12px;
}
.cfg__delete-text {
  margin: 0 0 8px;
  color: #3b444c;
  font-size: 12px;
}
.cfg__delete-note {
  margin: 8px 0 0;
  font-size: 11px;
}
.cfg__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 0;
  background: #f2f4f7;
}</style>
