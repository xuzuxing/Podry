<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { getConfig, listCredentials, MockError, saveConfig } from '@/api'
import ErrorState from '@/components/ErrorState.vue'
import type { AppConfig, Credential, GitConfig } from '@/types'
import { notifySetupChanged } from '@/utils/appEvents'

interface GitForm {
  repositoryUrl: string
  branch: string
  accountMode: 'public' | 'credential'
  credentialId: string | null
}

const route = useRoute()
const router = useRouter()
const appId = computed(() => String(route.params.appId ?? ''))

const config = ref<AppConfig | null>(null)
const credentials = ref<Credential[]>([])
const form = ref<GitForm>(blankForm())
const saved = ref<GitForm>(blankForm())
const errors = ref<Record<string, string>>({})
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const conflict = ref(false)
const editing = ref(false)

function blankForm(): GitForm {
  return { repositoryUrl: '', branch: 'main', accountMode: 'public', credentialId: null }
}

const versionText = computed(() => (config.value ? `v${config.value.version}` : '—'))
const hasGit = computed(() => Boolean(config.value?.gitConfig))
const dirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(saved.value))
const gitCredentials = computed(() => credentials.value.filter((item) => item.kind === 'git'))
const accountOptions = computed(() => [
  { label: '公开仓库（匿名访问）', value: '' },
  ...gitCredentials.value.map((item) => ({ label: `${item.name}（v${item.version}）`, value: item.id })),
])
const accountValue = computed(() =>
  form.value.accountMode === 'credential' ? form.value.credentialId ?? '' : '',
)
const repoName = computed(() => {
  const url = form.value.repositoryUrl.replace(/\.git$/, '').replace(/\/+$/, '')
  return url.split('/').filter(Boolean).pop() ?? url
})

function fill(next: GitForm): void {
  form.value = { ...next }
  saved.value = { ...next }
}

async function load(): Promise<void> {
  if (!appId.value) return
  loading.value = true
  error.value = ''
  conflict.value = false
  errors.value = {}
  try {
    const [cfg, creds] = await Promise.all([getConfig(appId.value), listCredentials()])
    config.value = cfg
    credentials.value = creds
    fill(cfg.gitConfig ? { ...cfg.gitConfig } : blankForm())
    editing.value = !cfg.gitConfig
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Git 源加载失败'
  } finally {
    loading.value = false
  }
}

function onAccountChange(value: unknown): void {
  const id = typeof value === 'string' ? value : ''
  if (!id) {
    form.value.accountMode = 'public'
    form.value.credentialId = null
    return
  }
  form.value.accountMode = 'credential'
  form.value.credentialId = id
}

function startEdit(): void {
  errors.value = {}
  editing.value = true
}

function cancelEdit(): void {
  fill({ ...saved.value })
  errors.value = {}
  editing.value = false
}

function validate(): boolean {
  const next: Record<string, string> = {}
  const url = form.value.repositoryUrl.trim()
  if (!url) next.repositoryUrl = '请填写仓库地址'
  else if (!/^https:\/\//.test(url)) next.repositoryUrl = '仓库地址需以 https:// 开头'
  if (!form.value.branch.trim()) next.branch = '请填写默认分支'
  if (form.value.accountMode === 'credential' && !form.value.credentialId) next.credentialId = '请选择 Git 凭据'
  errors.value = next
  return Object.keys(next).length === 0
}

async function goNext(): Promise<void> {
  if (editing.value) {
    const ok = await save()
    if (!ok) return
  } else if (dirty.value) {
    const ok = await save()
    if (!ok) return
  }
  await router.push({ name: 'config-build', params: { projectId: route.params.projectId, appId: appId.value } })
}

async function save(): Promise<boolean> {
  if (!config.value || !validate()) return false
  saving.value = true
  conflict.value = false
  try {
    const payload: GitConfig = {
      repositoryUrl: form.value.repositoryUrl.trim(),
      branch: form.value.branch.trim(),
      accountMode: form.value.accountMode,
      credentialId: form.value.accountMode === 'credential' ? form.value.credentialId : null,
    }
    const updated = await saveConfig(appId.value, {
      section: 'git',
      expectedVersion: config.value.version,
      gitConfig: payload,
    })
    config.value = updated
    fill({
      repositoryUrl: updated.gitConfig?.repositoryUrl ?? payload.repositoryUrl,
      branch: updated.gitConfig?.branch ?? payload.branch,
      accountMode: updated.gitConfig?.accountMode ?? payload.accountMode,
      credentialId: updated.gitConfig?.credentialId ?? null,
    })
    editing.value = false
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
  <div class="git-page">
    <header class="git-page__head">
      <h1>Git 仓库</h1>
      <p>管理该应用的源码仓库。<span class="git-page__link">了解更多</span></p>
    </header>

    <t-alert
      v-if="conflict"
      theme="warning"
      title="配置已被他人更新"
      message="当前表单仍保留你的输入；重新读取会以服务端版本覆盖本地改动。"
      class="git-page__alert"
    >
      <template #operation>
        <t-button size="small" variant="outline" @click="load">
          <template #icon><t-icon name="refresh" /></template>
          重新读取
        </t-button>
      </template>
    </t-alert>

    <div v-if="loading" class="git-page__state">
      <t-loading size="small" text="加载中…" />
    </div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <template v-else>
      <button v-if="hasGit && !editing" type="button" class="git-add" @click="startEdit">
        <span class="git-add__plus">+</span>
        添加 Git 仓库
      </button>

      <section v-if="editing" class="git-card">
        <h2 class="git-card__title">添加 Git 仓库</h2>

        <div class="git-card__grid">
          <label class="git-field">
            <span class="git-field__label">Git 账号 <em>*</em></span>
            <t-select
              :value="accountValue"
              :options="accountOptions"
              placeholder="选择 Git 账号"
              @change="onAccountChange"
            />
            <span v-if="errors.credentialId" class="git-field__error">{{ errors.credentialId }}</span>
          </label>

          <label class="git-field">
            <span class="git-field__label">仓库地址 <em>*</em></span>
            <t-input v-model="form.repositoryUrl" placeholder="https://github.com/acme/repo.git" />
            <span v-if="errors.repositoryUrl" class="git-field__error">{{ errors.repositoryUrl }}</span>
            <span v-else class="git-field__hint">仅支持 HTTPS 克隆地址，不支持内嵌账号口令。</span>
          </label>
        </div>

        <div class="git-card__grid">
          <label class="git-field">
            <span class="git-field__label">默认分支 <em>*</em></span>
            <t-input v-model="form.branch" placeholder="main" />
            <span v-if="errors.branch" class="git-field__error">{{ errors.branch }}</span>
          </label>
        </div>

        <div class="git-card__foot">
          <t-button v-if="hasGit" variant="text" @click="cancelEdit">取消</t-button>
          <t-button theme="primary" :loading="saving" @click="save">保存</t-button>
        </div>
      </section>

      <section v-if="hasGit && !editing" class="git-repo">
        <div class="git-repo__main">
          <span class="git-repo__icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 2.8 21.2 12 12 21.2 2.8 12 12 2.8Z"
                stroke="#596168"
                stroke-width="1.3"
                stroke-linejoin="round"
              />
              <circle cx="12" cy="12" r="2.4" stroke="#596168" stroke-width="1.3" />
            </svg>
          </span>
          <div class="git-repo__text">
            <p class="git-repo__name">{{ repoName }}</p>
            <p class="git-repo__url">{{ form.repositoryUrl }}</p>
          </div>
        </div>
        <div class="git-repo__side">
          <span class="git-repo__branch">{{ form.branch }}</span>
          <span class="git-repo__account">{{ form.accountMode === 'public' ? '公开仓库' : '凭据访问' }}</span>
          <t-button variant="text" size="small" @click="startEdit">编辑</t-button>
        </div>
      </section>
    </template>

    <footer v-if="!loading && !error" class="git-page__foot">
      <span class="git-page__version">配置版本 {{ versionText }}</span>
      <t-button theme="primary" :disabled="editing || !hasGit" @click="goNext">下一步</t-button>
    </footer>
  </div>
</template>

<style scoped>
.git-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 20px 24px;
  background: #fff;
}
.git-page__head {
  margin-bottom: 16px;
}
.git-page__head h1 {
  margin: 0 0 6px;
  color: #000a14;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}
.git-page__head p {
  margin: 0;
  color: #596168;
  font-size: 12px;
  line-height: 18px;
}
.git-page__link {
  margin-left: 6px;
  color: #0066cc;
  cursor: pointer;
}
.git-page__alert {
  margin-bottom: 12px;
}
.git-page__state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
}
.git-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 52px;
  margin-bottom: 16px;
  color: #0066cc;
  font-size: 13px;
  background: #fff;
  border: 1px dashed #b1b7bc;
  border-radius: 4px;
  cursor: pointer;
}
.git-add:hover {
  border-color: #0066cc;
  background: #f7fafc;
}
.git-add__plus {
  font-size: 16px;
  line-height: 1;
}
.git-card {
  padding: 20px;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.git-card__title {
  margin: 0 0 18px;
  color: #000a14;
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
}
.git-card__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 24px;
  margin-bottom: 4px;
}
.git-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}
.git-field__label {
  color: #3b444c;
  font-size: 12px;
  line-height: 18px;
}
.git-field__label em {
  color: #f33e3e;
  font-style: normal;
}
.git-field__hint {
  color: #767d84;
  font-size: 11px;
  line-height: 16px;
}
.git-field__error {
  color: #f33e3e;
  font-size: 11px;
  line-height: 16px;
}
.git-card__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.git-repo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.git-repo__main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.git-repo__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: #f2f4f7;
  border-radius: 4px;
}
.git-repo__text {
  min-width: 0;
}
.git-repo__name {
  margin: 0 0 2px;
  color: #000a14;
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
}
.git-repo__url {
  margin: 0;
  overflow: hidden;
  color: #767d84;
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.git-repo__side {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
}
.git-repo__branch,
.git-repo__account {
  color: #596168;
  font-size: 11px;
  background: #f2f4f7;
  border-radius: 2px;
  padding: 2px 6px;
}
.git-page__foot {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 24px;
}
.git-page__version {
  color: #767d84;
  font-size: 11px;
}
</style>
