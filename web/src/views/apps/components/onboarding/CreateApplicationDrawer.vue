<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { createApplication, listApplications, listProjects } from '@/api'
import type { Application, Project } from '@/types'

const props = defineProps<{ visible: boolean; projectId?: string; initialMode?: 'scratch' | 'clone' }>()
const emit = defineEmits<{
  'update:visible': [value: boolean]
  created: [app: Application]
}>()

const router = useRouter()

const projects = ref<Project[]>([])
const apps = ref<Application[]>([])
const mode = ref<'scratch' | 'clone'>('scratch')
const sourceAppId = ref('')
const projectId = ref('')
const name = ref('')
const description = ref('')
const sourceMode = ref<'git' | 'image'>('git')
const submitting = ref(false)
const formError = ref('')
const projectsLoaded = ref(false)
const appsLoaded = ref(false)
const projectError = ref('')

const projectOptions = computed(() => projects.value.map((item) => ({ label: item.name, value: item.id })))
const sourceApp = computed(() => apps.value.find((item) => item.id === sourceAppId.value) ?? null)
const sourceOptions = computed(() =>
  apps.value.map((item) => ({
    label: `${item.name} · ${projects.value.find((p) => p.id === item.projectId)?.name ?? '—'}`,
    value: item.id,
  })),
)
const effectiveMode = computed<'git' | 'image'>(() =>
  mode.value === 'clone' ? sourceApp.value?.sourceMode ?? 'git' : sourceMode.value,
)
const nameValid = computed(() => /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(name.value.trim()))

async function loadProjects(): Promise<void> {
  if (!projectsLoaded.value) {
    try {
      projects.value = await listProjects()
      projectsLoaded.value = true
    } catch (err) {
      projectError.value = err instanceof Error ? err.message : '项目加载失败'
    }
  }
  if (!projectId.value) projectId.value = props.projectId || projects.value[0]?.id || ''
}

async function loadApps(): Promise<void> {
  if (appsLoaded.value) return
  try {
    const page = await listApplications()
    apps.value = page.items
    appsLoaded.value = true
  } catch {
    apps.value = []
  }
}

function onSourceChange(value: unknown): void {
  const id = typeof value === 'string' ? value : ''
  sourceAppId.value = id
  const app = apps.value.find((item) => item.id === id)
  if (app) {
    name.value = `${app.name}-copy`.slice(0, 53)
    sourceMode.value = app.sourceMode
  }
}

watch(
  () => props.visible,
  (open) => {
    if (!open) return
    formError.value = ''
    projectError.value = ''
    mode.value = props.initialMode ?? 'scratch'
    sourceAppId.value = ''
    name.value = ''
    description.value = ''
    sourceMode.value = 'git'
    projectId.value = props.projectId || ''
    void loadProjects()
    void loadApps()
  },
  { immediate: true },
)

function close(): void {
  emit('update:visible', false)
}

async function submit(): Promise<void> {
  if (submitting.value) return
  formError.value = ''
  if (!projectId.value) {
    formError.value = '请选择项目'
    return
  }
  if (!nameValid.value) {
    formError.value = '名称需为 3–63 位小写字母、数字或连字符，且以字母开头'
    return
  }
  if (mode.value === 'clone' && !sourceAppId.value) {
    formError.value = '请选择要克隆的源应用'
    return
  }
  submitting.value = true
  try {
    const app = await createApplication({
      projectId: projectId.value,
      name: name.value.trim(),
      description: description.value.trim(),
      sourceMode: effectiveMode.value,
      cloneFromAppId: mode.value === 'clone' ? sourceAppId.value : undefined,
    })
    emit('created', app)
    close()
    void MessagePlugin.success(
      mode.value === 'clone' ? `应用 ${app.name} 已从源应用克隆` : `应用 ${app.name} 已创建，请按步骤完成配置`,
    )
    await router.push(
      effectiveMode.value === 'image'
        ? { name: 'config-base-deployment', params: { projectId: projectId.value, appId: app.id } }
        : { name: 'config-git', params: { projectId: projectId.value, appId: app.id } },
    )
  } catch (err) {
    formError.value = err instanceof Error ? err.message : '创建应用失败'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <t-drawer
    :visible="visible"
    size="1020px"
    header="新建应用"
    :footer="true"
    :close-btn="true"
    drawer-class-name="ca-drawer"
    @close="close"
  >
    <div class="ca">
      <aside class="ca__rail">
        <button type="button" class="ca__mode" :class="{ 'ca__mode--active': mode === 'scratch' }" @click="mode = 'scratch'">
          <t-icon name="add-circle" size="16px" />
          从零创建
        </button>
        <button type="button" class="ca__mode" :class="{ 'ca__mode--active': mode === 'clone' }" @click="mode = 'clone'">
          <t-icon name="file-copy" size="16px" />
          克隆应用
        </button>

        <div class="ca__help">
          <p>在 Podry 中，应用代表你的软件项目或服务，是部署配置、环境与其他设置的容器。</p>
          <p>应用不区分环境，同一个应用可以部署到多个环境。</p>
        </div>

        <div class="ca__need">
          <span class="ca__need-dot" />
          需要帮助？
        </div>
        <span class="ca__docs">查看文档</span>
      </aside>

      <section class="ca__main">
        <div class="ca__card">
          <div class="ca__icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3.5" y="5" width="17" height="14" rx="3" stroke="#0066cc" stroke-width="1.5" />
              <path d="M8 10h8M8 13.5h5" stroke="#0066cc" stroke-width="1.5" stroke-linecap="round" />
              <circle cx="17.5" cy="6.5" r="2" fill="#0066cc" />
            </svg>
          </div>

          <div v-if="mode === 'clone'" class="ca__field">
            <span class="ca__label">源应用 <em>*</em></span>
            <t-select
              :value="sourceAppId"
              :options="sourceOptions"
              placeholder="选择要克隆的源应用"
              filterable
              @change="onSourceChange"
            />
            <span class="ca__hint">
              <t-icon name="info-circle" size="13px" />
              只复制源应用最新配置；不复制流水线、环境绑定、构建与发布历史。
            </span>
          </div>

          <div class="ca__row">
            <label class="ca__field">
              <span class="ca__label">项目 <em>*</em></span>
              <t-select v-model="projectId" :options="projectOptions" placeholder="选择项目" filterable />
              <span v-if="projectError" class="ca__error">{{ projectError }}</span>
            </label>
            <label class="ca__field">
              <span class="ca__label">应用名称 <em>*</em></span>
              <t-input v-model="name" placeholder="例如 checkout-api" :maxlength="53" />
              <span class="ca__hint">
                <t-icon name="info-circle" size="13px" />
                应用不区分环境，可部署到多个环境。
              </span>
            </label>
          </div>

          <label class="ca__field">
            <span class="ca__label">描述</span>
            <t-textarea v-model="description" :maxlength="4000" placeholder="一句话说明这个应用的职责（可留空）" :autosize="{ minRows: 3, maxRows: 5 }" />
          </label>

          <div v-if="mode === 'scratch'" class="ca__field">
            <span class="ca__label">应用类型</span>
            <t-radio-group v-model="sourceMode" variant="default-filled">
              <t-radio-button value="git">源码构建</t-radio-button>
              <t-radio-button value="image">容器镜像</t-radio-button>
            </t-radio-group>
            <span class="ca__hint">
              {{ sourceMode === 'git' ? '从 Git 仓库构建镜像，再部署到环境。' : '直接使用已有镜像，不创建构建流水线。' }}
            </span>
          </div>
          <div v-else class="ca__field">
            <span class="ca__label">应用类型</span>
            <span class="ca__hint">
              {{ effectiveMode === 'git' ? '源码构建（跟随源应用）' : '容器镜像（跟随源应用）' }}
            </span>
          </div>

          <p v-if="formError" class="ca__error ca__error--block">{{ formError }}</p>
        </div>

        <p class="ca__note">
          {{ mode === 'clone' ? '克隆会复制源应用最新配置（版本 1），随后进入配置向导；环境绑定与流水线需自行创建。' : '创建后进入配置向导：Git 仓库 → 构建配置 → 部署模板 → 工作流，共 4 步。' }}
        </p>
      </section>
    </div>

    <template #footer>
      <div class="ca__footer">
        <t-button variant="outline" @click="close">取消</t-button>
        <t-button theme="primary" :loading="submitting" @click="submit">创建应用</t-button>
      </div>
    </template>
  </t-drawer>
</template>

<style scoped>
.ca {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  min-height: 100%;
}
.ca__rail {
  padding: 20px 16px;
  background: #f7fafc;
  border-right: 1px solid #e6e9ef;
}
.ca__mode {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 36px;
  margin-bottom: 4px;
  padding: 0 10px;
  color: #3b444c;
  font-size: 13px;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}
.ca__mode:disabled {
  cursor: default;
  opacity: 1;
}
.ca__mode--active {
  color: #0066cc;
  background: #e8f1ff;
}
.ca__help {
  margin-top: 18px;
  padding-top: 16px;
  color: #596168;
  font-size: 12px;
  line-height: 20px;
  border-top: 1px solid #e6e9ef;
}
.ca__help p {
  margin: 0 0 10px;
}
.ca__need {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  color: #3b444c;
  font-size: 12px;
  font-weight: 500;
}
.ca__need-dot {
  width: 10px;
  height: 10px;
  background: #ff8300;
  border-radius: 2px;
}
.ca__docs {
  display: inline-block;
  margin-top: 6px;
  color: #0066cc;
  font-size: 12px;
  cursor: pointer;
}
.ca__main {
  padding: 24px;
  background: #fff;
}
.ca__card {
  padding: 20px;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.ca__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-bottom: 18px;
  background: #eef5ff;
  border-radius: 6px;
}
.ca__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 24px;
}
.ca__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
.ca__label {
  color: #3b444c;
  font-size: 12px;
  line-height: 18px;
}
.ca__label em {
  color: #f33e3e;
  font-style: normal;
}
.ca__hint {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #767d84;
  font-size: 11px;
  line-height: 16px;
}
.ca__error {
  color: #f33e3e;
  font-size: 11px;
  line-height: 16px;
}
.ca__error--block {
  margin: 4px 0 0;
  padding: 6px 8px;
  background: #fef0f0;
  border-radius: 2px;
}
.ca__note {
  margin: 12px 0 0;
  color: #767d84;
  font-size: 12px;
}
.ca__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
