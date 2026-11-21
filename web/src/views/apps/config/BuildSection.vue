<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { getConfig, listRegistries, MockError, saveConfig } from '@/api'
import ErrorState from '@/components/ErrorState.vue'
import type { AppConfig, BuildConfig, Registry } from '@/types'
import { notifySetupChanged } from '@/utils/appEvents'

interface BuildForm {
  registryId: string
  imageRepository: string
  dockerfile: string
  context: string
  platform: 'linux/amd64' | 'linux/arm64'
  timeoutSeconds: number
}

const route = useRoute()
const router = useRouter()
const appId = computed(() => String(route.params.appId ?? ''))

const platformOptions = [
  { label: 'linux/amd64', value: 'linux/amd64' },
  { label: 'linux/arm64', value: 'linux/arm64' },
]

const config = ref<AppConfig | null>(null)
const registries = ref<Registry[]>([])
const form = ref<BuildForm>(blankForm())
const saved = ref<BuildForm>(blankForm())
const errors = ref<Record<string, string>>({})
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const conflict = ref(false)

function blankForm(): BuildForm {
  return {
    registryId: '',
    imageRepository: '',
    dockerfile: 'Dockerfile',
    context: '.',
    platform: 'linux/amd64',
    timeoutSeconds: 1800,
  }
}

const versionText = computed(() => (config.value ? `v${config.value.version}` : '—'))
const dirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(saved.value))
const registryOptions = computed(() =>
  registries.value.map((item) => ({ label: `${item.name} · ${item.endpoint}`, value: item.id })),
)
const currentRegistry = computed(() => registries.value.find((item) => item.id === form.value.registryId) ?? null)
const imagePreview = computed(() => {
  const repository = form.value.imageRepository.trim()
  if (!repository) return '填写 Repository 后显示推送地址'
  const endpoint = (currentRegistry.value?.endpoint ?? '').replace(/^https?:\/\//, '')
  return `${endpoint ? `${endpoint}/` : ''}${repository}:<build-tag>`
})

function fill(next: BuildForm): void {
  form.value = { ...next }
  saved.value = { ...next }
}

function pathError(label: string, value: string): string {
  const text = value.trim()
  if (!text) return `请填写${label}`
  if (text.startsWith('/')) return `${label}不能以 / 开头（应为仓库内相对路径）`
  if (text.includes('..')) return `${label}不能包含 ..`
  return ''
}

async function load(): Promise<void> {
  if (!appId.value) return
  loading.value = true
  error.value = ''
  conflict.value = false
  errors.value = {}
  try {
    const [cfg, registryList] = await Promise.all([getConfig(appId.value), listRegistries()])
    config.value = cfg
    registries.value = registryList
    fill(
      cfg.buildConfig
        ? { ...cfg.buildConfig }
        : { ...blankForm(), imageRepository: '', registryId: registryList[0]?.id ?? '' },
    )
  } catch (err) {
    error.value = err instanceof Error ? err.message : '构建配置加载失败'
  } finally {
    loading.value = false
  }
}

function validate(): boolean {
  const next: Record<string, string> = {}
  if (!form.value.registryId) next.registryId = '请选择镜像仓库'
  const repository = form.value.imageRepository.trim()
  if (!repository) next.imageRepository = '请填写镜像 Repository'
  else if (repository.startsWith('/')) next.imageRepository = 'Repository 不能以 / 开头'
  const dockerfileError = pathError('Dockerfile 路径', form.value.dockerfile)
  if (dockerfileError) next.dockerfile = dockerfileError
  const contextError = pathError('Context 路径', form.value.context)
  if (contextError) next.context = contextError
  if (!Number.isFinite(form.value.timeoutSeconds) || form.value.timeoutSeconds <= 0) {
    next.timeoutSeconds = '构建超时需为正整数（秒）'
  }
  errors.value = next
  return Object.keys(next).length === 0
}

async function goNext(): Promise<void> {
  const ok = dirty.value ? await save() : true
  if (!ok) return
  await router.push({ name: 'config-base', params: { projectId: route.params.projectId, appId: appId.value } })
}

async function save(): Promise<boolean> {
  if (!config.value || !validate()) return false
  saving.value = true
  conflict.value = false
  try {
    const payload: BuildConfig = {
      registryId: form.value.registryId,
      imageRepository: form.value.imageRepository.trim(),
      dockerfile: form.value.dockerfile.trim(),
      context: form.value.context.trim(),
      platform: form.value.platform,
      timeoutSeconds: Math.round(form.value.timeoutSeconds),
    }
    const updated = await saveConfig(appId.value, {
      section: 'build',
      expectedVersion: config.value.version,
      buildConfig: payload,
    })
    config.value = updated
    fill(payload)
    MessagePlugin.success(`已保存（配置版本 v${updated.version}）`)
    notifySetupChanged(appId.value)
    return true
  } catch (err) {
    if (err instanceof MockError && err.code === 'revision_conflict') conflict.value = true
    else MessagePlugin.error(err instanceof Error ? err.message : '保存失败')
    return false
  } finally {
    saving.value = false
  }
}

watch(appId, load, { immediate: true })
</script>

<template>
  <div class="build-page">
    <header class="build-page__head">
      <div>
        <h1>构建配置</h1>
        <p>定义镜像存储位置与构建方式；Dockerfile 与 Context 均相对仓库根目录。</p>
      </div>
      <span class="build-page__doc">查看文档</span>
    </header>

    <t-alert
      v-if="conflict"
      theme="warning"
      title="配置已被他人更新"
      message="当前表单仍保留你的输入；重新读取会以服务端版本覆盖本地改动。"
      class="build-page__alert"
    >
      <template #operation>
        <t-button size="small" variant="outline" @click="load">
          <template #icon><t-icon name="refresh" /></template>
          重新读取
        </t-button>
      </template>
    </t-alert>

    <div v-if="loading" class="build-page__state">
      <t-loading size="small" text="加载中…" />
    </div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <template v-else>
      <t-alert
        v-if="registries.length === 0"
        theme="warning"
        title="尚未接入镜像仓库"
        message="请先在「平台设置 → 镜像仓库」中登记仓库，保存构建配置前必须选择仓库。"
        class="build-page__alert"
      />

      <section class="build-card">
        <h2 class="build-card__title">存储容器镜像</h2>
        <div class="build-grid">
          <label class="build-field">
            <span class="build-field__label">镜像仓库 <em>*</em></span>
            <t-select v-model="form.registryId" :options="registryOptions" placeholder="选择镜像仓库" clearable />
            <span v-if="errors.registryId" class="build-field__error">{{ errors.registryId }}</span>
            <span v-else class="build-field__hint">推送凭据由仓库自身的凭据引用决定。</span>
          </label>
          <label class="build-field">
            <span class="build-field__label">镜像 Repository <em>*</em></span>
            <t-input v-model="form.imageRepository" placeholder="acme/checkout-api" />
            <span v-if="errors.imageRepository" class="build-field__error">{{ errors.imageRepository }}</span>
            <span v-else class="build-field__hint u-ellipsis">推送地址：{{ imagePreview }}</span>
          </label>
        </div>
        <div class="build-info">
          <t-icon name="info-circle" size="14px" />
          覆盖：镜像仓库与 Dockerfile 位置可按流水线覆盖，此处保存的是默认值。
        </div>
      </section>

      <section class="build-card">
        <h2 class="build-card__title">如何构建容器镜像？</h2>

        <div class="build-modes">
          <div class="build-mode build-mode--active">
            <span class="build-mode__icon"><t-icon name="file" size="16px" /></span>
            <div>
              <p class="build-mode__title">使用仓库中的 Dockerfile</p>
              <p class="build-mode__desc">指定仓库内的 Dockerfile 与构建上下文，完全控制构建过程。</p>
            </div>
          </div>
        </div>

        <div class="build-grid">
          <label class="build-field">
            <span class="build-field__label">Dockerfile 路径 <em>*</em></span>
            <t-input v-model="form.dockerfile" placeholder="docker/Dockerfile" />
            <span v-if="errors.dockerfile" class="build-field__error">{{ errors.dockerfile }}</span>
            <span v-else class="build-field__hint">例如 docker/Dockerfile；不能以 / 开头，也不能包含 ..。</span>
          </label>
          <label class="build-field">
            <span class="build-field__label">Context 路径 <em>*</em></span>
            <t-input v-model="form.context" placeholder="." />
            <span v-if="errors.context" class="build-field__error">{{ errors.context }}</span>
            <span v-else class="build-field__hint">构建上下文目录，通常为 . 或 docker。</span>
          </label>
        </div>

        <div class="build-grid">
          <label class="build-field">
            <span class="build-field__label">目标平台</span>
            <t-select v-model="form.platform" :options="platformOptions" />
            <span class="build-field__hint">单平台构建；跨平台镜像需在流水线中分别构建。</span>
          </label>
          <label class="build-field">
            <span class="build-field__label">构建超时（秒） <em>*</em></span>
            <t-input-number
              v-model="form.timeoutSeconds"
              :min="60"
              :max="86400"
              :step="60"
              theme="normal"
              placeholder="1800"
            />
            <span v-if="errors.timeoutSeconds" class="build-field__error">{{ errors.timeoutSeconds }}</span>
            <span v-else class="build-field__hint">超时后构建 Job 被终止，可在构建历史中看到失败原因。</span>
          </label>
        </div>
      </section>
    </template>

    <footer v-if="!loading && !error" class="build-page__foot">
      <span class="build-page__meta">
        配置版本 {{ versionText }}
        <em v-if="dirty">· 有未保存修改</em>
      </span>
      <div class="build-page__actions">
        <t-button variant="outline" :loading="saving" :disabled="!dirty" @click="save">保存</t-button>
        <t-button theme="primary" :loading="saving" :disabled="!registries.length" @click="goNext">
          保存并下一步
        </t-button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.build-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 20px 24px;
  background: #fff;
}
.build-page__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.build-page__head h1 {
  margin: 0 0 6px;
  color: #000a14;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}
.build-page__head p {
  margin: 0;
  color: #596168;
  font-size: 12px;
  line-height: 18px;
}
.build-page__doc {
  color: #0066cc;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}
.build-page__alert {
  margin-bottom: 12px;
}
.build-page__state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
}
.build-card {
  padding: 20px;
  margin-bottom: 16px;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.build-card__title {
  margin: 0 0 16px;
  color: #000a14;
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
}
.build-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
}
.build-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  margin-bottom: 12px;
}
.build-field__label {
  color: #3b444c;
  font-size: 12px;
  line-height: 18px;
}
.build-field__label em {
  color: #f33e3e;
  font-style: normal;
}
.build-field__hint {
  overflow: hidden;
  color: #767d84;
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.build-field__error {
  color: #f33e3e;
  font-size: 11px;
  line-height: 16px;
}
.build-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  padding: 8px 10px;
  color: #0066cc;
  font-size: 12px;
  line-height: 18px;
  background: #eef5ff;
  border-radius: 2px;
}
.build-modes {
  margin-bottom: 16px;
}
.build-mode {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  background: #f7fafc;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.build-mode--active {
  background: #f2f7ff;
  border-color: #b5d4f8;
}
.build-mode__icon {
  color: #0066cc;
  line-height: 1;
}
.build-mode__title {
  margin: 0 0 2px;
  color: #000a14;
  font-size: 13px;
  line-height: 18px;
}
.build-mode__desc {
  margin: 0;
  color: #767d84;
  font-size: 11px;
  line-height: 16px;
}
.build-page__foot {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: auto;
  padding-top: 20px;
}
.build-page__meta {
  color: #767d84;
  font-size: 11px;
}
.build-page__meta em {
  color: #e37318;
  font-style: normal;
}
.build-page__actions {
  display: flex;
  gap: 8px;
}
</style>
