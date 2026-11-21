<script setup lang="ts">
/**
 * 应用配置布局：对齐 Devtron Configurations。
 * - 主视图：Git 仓库 / 构建配置 / 基础配置 / 工作流编辑器 + 环境覆盖 + 删除应用。
 * - Base / 环境覆盖视图：左侧切换为上下文面板（返回、对比环境、部署模板 / ConfigMaps / Secrets）。
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { listEnvironments, updateApplication } from '@/api'
import type { Environment } from '@/types'

const route = useRoute()
const router = useRouter()
const appId = computed(() => String(route.params.appId ?? ''))
const projectId = computed(() => String(route.params.projectId ?? ''))
const routeName = computed(() => String(route.name ?? ''))

const environments = ref<Environment[]>([])
const loadingEnv = ref(false)
const deleteVisible = ref(false)
const deleting = ref(false)

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

const mainItems = [
  { label: 'Git 仓库', name: 'config-git' },
  { label: '构建配置', name: 'config-build' },
  { label: '基础配置', name: 'config-base-deployment' },
  { label: '工作流编辑器', name: 'config-workflow' },
]

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
  MessagePlugin.info('跨环境比较暂未接入；可在 Devtron 的 Compare With 中查看 diff。')
}

async function loadEnvironments(): Promise<void> {
  loadingEnv.value = true
  try {
    environments.value = await listEnvironments()
  } catch {
    environments.value = []
  } finally {
    loadingEnv.value = false
  }
}

async function removeApplication(): Promise<void> {
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

watch(appId, loadEnvironments, { immediate: true })
</script>

<template>
  <div class="cfg">
    <aside class="cfg__nav">
      <!-- Base / 环境覆盖：上下文面板 -->
      <template v-if="inContext">
        <router-link class="cfg__ctx" :to="{ name: 'config-workflow', params: { projectId, appId } }">
          <t-icon name="chevron-left" size="14px" />
          <span class="cfg__ctx-name">{{ isBase ? '基础配置' : envName || '环境' }}</span>
        </router-link>
        <button type="button" class="cfg__compare" @click="compare">
          <t-icon name="swap" size="14px" />
          对比环境...
        </button>
        <nav class="cfg__sections">
          <RouterLink
            v-for="item in sectionItems"
            :key="item.name"
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
        </nav>
      </template>

      <!-- 主视图 -->
      <template v-else>
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
            v-for="env in environments"
            :key="env.id"
            class="cfg__env"
            :to="{ name: 'config-override-deployment', params: { projectId, appId, envId: env.id } }"
          >
            {{ env.name }}
          </RouterLink>
          <span v-if="loadingEnv" class="cfg__env cfg__env--muted">加载环境…</span>
          <span v-else-if="!environments.length" class="cfg__env cfg__env--muted">暂无环境</span>
        </nav>

        <div class="cfg__foot">
          <button type="button" class="cfg__delete" @click="deleteVisible = true">删除应用</button>
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
      <p>归档后该应用不再出现在应用列表中，运行中的资源不会被删除。</p>
      <p class="u-dim">本操作为本地 mock，仅修改当前会话数据。</p>
    </t-dialog>
  </div>
</template>

<style scoped>
.cfg {
  display: flex;
  align-items: stretch;
  min-height: calc(100vh - 130px);
  background: #fff;
}
.cfg__nav {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 252px;
  padding: 8px 0 12px;
  background: #fff;
  border-right: 1px solid #e6e9ef;
}
.cfg__main {
  display: flex;
  flex-direction: column;
}
.cfg__item {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 20px;
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
  margin: 18px 0 6px;
  padding: 0 20px;
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
  height: 38px;
  padding: 0 20px;
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
  height: 40px;
  padding: 0 16px;
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

.cfg__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  padding: 12px;
  background: #fff;
}</style>
