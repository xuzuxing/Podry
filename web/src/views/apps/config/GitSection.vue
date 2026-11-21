<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { getConfig, listCredentials, MockError, saveConfig } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import PageHeader from '@/components/PageHeader.vue'
import type { AppConfig, Credential, GitConfig } from '@/types'

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

function blankForm(): GitForm {
  return { repositoryUrl: '', branch: 'main', accountMode: 'public', credentialId: null }
}

const versionText = computed(() => (config.value ? `v${config.value.version}` : '—'))
const firstSave = computed(() => config.value !== null && config.value.gitConfig === null)
const savedReady = computed(() => config.value?.gitConfig !== null && config.value?.gitConfig !== undefined)
const dirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(saved.value))
const gitCredentials = computed(() => credentials.value.filter((item) => item.kind === 'git'))
const credentialOptions = computed(() =>
  gitCredentials.value.map((item) => ({ label: `${item.name}（v${item.version}）`, value: item.id })),
)
const credentialHint = computed(() =>
  form.value.accountMode === 'credential'
    ? '凭据仅以 ID 引用，服务端不会回显凭据内容。'
    : '公开仓库无需凭据；切换为「使用凭据」后可选择。',
)

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
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Git 源加载失败'
  } finally {
    loading.value = false
  }
}

function clearCredentialIfPublic(): void {
  if (form.value.accountMode === 'public') form.value.credentialId = null
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
  const ok = await save()
  if (!ok) return
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
    MessagePlugin.success(`已保存（配置版本 v${updated.version}）`)
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
  <div class="sec">
    <PageHeader title="Git Repository" description="声明源码仓库与访问账号；本分区保存后生成新的配置版本。">
      <template #actions>
        <span v-if="dirty" class="hint-dirty">有未保存修改</span>
        <t-button
          variant="outline"
          :loading="saving"
          :disabled="loading || config === null || !savedReady"
          @click="goNext"
        >
          保存并下一步
        </t-button>
        <t-button theme="primary" :loading="saving" :disabled="loading || config === null" @click="save">
          <template #icon><t-icon name="save" /></template>
          保存
        </t-button>
      </template>
    </PageHeader>

    <t-alert
      v-if="conflict"
      theme="warning"
      title="配置已被他人更新"
      message="当前表单仍保留你的输入；重新读取会以服务端版本覆盖本地改动。"
    >
      <template #operation>
        <t-button size="small" variant="outline" @click="load">
          <template #icon><t-icon name="refresh" /></template>
          重新读取
        </t-button>
      </template>
    </t-alert>

    <div v-if="loading" class="sec__state">
      <t-loading size="small" text="加载中…" />
    </div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <div v-else class="git">
      <div class="git__main">
        <t-alert
          v-if="firstSave"
          theme="info"
          title="首次保存后解锁构建配置"
          message="该应用还没有 Git 源；保存后「构建配置」分区自动解锁。"
        />

        <section class="tk-panel">
          <div class="tk-panel__head">
            <span>源码仓库</span>
            <span class="u-dim">配置版本 {{ versionText }}</span>
          </div>
          <div class="tk-panel__body">
            <div class="fld-grid">
              <div class="fld fld--wide">
                <span class="fld__label">仓库地址 <em>*</em></span>
                <t-input v-model="form.repositoryUrl" placeholder="https://github.com/acme/checkout-api.git" />
                <span v-if="errors.repositoryUrl" class="fld__err">{{ errors.repositoryUrl }}</span>
                <span class="u-dim">仅接受 HTTPS 克隆地址，例如 https://github.com/acme/checkout-api.git。</span>
              </div>
              <div class="fld">
                <span class="fld__label">默认分支 <em>*</em></span>
                <t-input v-model="form.branch" placeholder="main" />
                <span v-if="errors.branch" class="fld__err">{{ errors.branch }}</span>
                <span class="u-dim">构建默认读取该分支的最新提交，再固定为一个提交 SHA。</span>
              </div>
            </div>
          </div>
        </section>

        <section class="tk-panel">
          <div class="tk-panel__head">
            <span>访问账号</span>
            <span class="u-dim">{{ form.accountMode === 'credential' ? '凭据引用' : '匿名访问' }}</span>
          </div>
          <div class="tk-panel__body">
            <div class="fld-grid">
              <div class="fld">
                <span class="fld__label">账号模式</span>
                <t-radio-group v-model="form.accountMode" @change="clearCredentialIfPublic">
                  <t-radio value="public">公开仓库</t-radio>
                  <t-radio value="credential">使用凭据</t-radio>
                </t-radio-group>
                <span class="u-dim">公开仓库匿名克隆；私有仓库需引用 Git 类型凭据。</span>
              </div>
              <div class="fld">
                <span class="fld__label">凭据</span>
                <t-select
                  v-model="form.credentialId"
                  :options="credentialOptions"
                  :disabled="form.accountMode !== 'credential'"
                  placeholder="选择 Git 凭据"
                  clearable
                />
                <span v-if="errors.credentialId" class="fld__err">{{ errors.credentialId }}</span>
                <span class="u-dim">{{ credentialHint }}</span>
              </div>
              <div v-if="form.accountMode === 'credential' && gitCredentials.length === 0" class="fld fld--wide">
                <EmptyState
                  compact
                  icon="info-circle"
                  title="暂无 Git 凭据"
                  description="请先在「平台设置 → 凭据」中创建 Git 类型凭据，再回到此处引用。"
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      <aside class="git__aside">
        <section class="tk-panel">
          <div class="tk-panel__head"><span>说明</span></div>
          <div class="tk-panel__body">
            <ul class="tips">
              <li>
                <t-icon name="info-circle" />
                <span>凭据只引用不回显：只保存凭据 ID，凭据内容由凭据服务持有。</span>
              </li>
              <li>
                <t-icon name="info-circle" />
                <span>保存 URL 不代表仓库可达：可达性在构建时以固定提交验证。</span>
              </li>
              <li>
                <t-icon name="lock-on" />
                <span>本分区保存后配置版本 +1，并解锁构建配置。</span>
              </li>
            </ul>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.sec {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sec__state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
}
.hint-dirty {
  color: var(--tk-warning);
}
.git {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.git__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.git__aside {
  width: 252px;
  flex: none;
}
.tips {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--tk-text-2);
}
.tips li {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  line-height: 18px;
}
.tips .t-icon {
  flex: none;
  margin-top: 2px;
  color: var(--tk-text-3);
}
.fld-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.fld {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.fld--wide {
  grid-column: 1 / -1;
}
.fld__label {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--tk-text-2);
}
.fld__label em {
  color: var(--tk-danger);
  font-style: normal;
}
.fld__err {
  color: var(--tk-danger);
  font-size: 11px;
  line-height: 16px;
}
@media (max-width: 1180px) {
  .git {
    flex-direction: column;
  }
  .git__aside {
    width: auto;
  }
}
</style>
