<script setup lang="ts">
/**
 * Base / Environment Override 的 ConfigMaps 与 Secrets。
 * 对齐 Devtron：同一页面结构，空态插画 + Create 按钮；有数据时是名称/键/更新时间的列表。
 * Secret 只保存 key，不保存值，也不回显明文。
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import {
  deleteConfigMap,
  deleteSecret,
  listConfigMaps,
  listEnvironments,
  listSecrets,
  saveConfigMap,
  saveSecret,
} from '@/api'
import ErrorState from '@/components/ErrorState.vue'
import type { ConfigMapEntry, Environment, SecretEntry } from '@/types'
import { fmtTime } from '@/utils/format'

const props = defineProps<{ kind: 'configmaps' | 'secrets' }>()

interface DraftRow {
  key: string
  value: string
}

const route = useRoute()
const router = useRouter()
const appId = computed(() => String(route.params.appId ?? ''))
const envId = computed(() => String(route.params.envId ?? ''))
const isOverride = computed(() => String(route.name ?? '').startsWith('config-override'))
const scopeEnv = computed(() => (isOverride.value ? envId.value || null : null))

const isSecret = computed(() => props.kind === 'secrets')
const label = computed(() => (isSecret.value ? 'Secret' : 'ConfigMap'))
const labelPlural = computed(() => (isSecret.value ? 'Secrets' : 'ConfigMaps'))

const environments = ref<Environment[]>([])
const configMaps = ref<ConfigMapEntry[]>([])
const secrets = ref<SecretEntry[]>([])
const loading = ref(true)
const error = ref('')

const drawerVisible = ref(false)
const editingId = ref('')
const draftName = ref('')
const draftRows = ref<DraftRow[]>([{ key: '', value: '' }])
const draftError = ref('')
const saving = ref(false)

const deleteVisible = ref(false)
const deletingId = ref('')

const entries = computed(() =>
  isSecret.value
    ? secrets.value.map((item) => ({
        id: item.id,
        name: item.name,
        keys: item.keys,
        preview: item.keys.join(', '),
        updatedAt: item.updatedAt,
      }))
    : configMaps.value.map((item) => ({
        id: item.id,
        name: item.name,
        keys: Object.keys(item.data),
        preview: Object.entries(item.data)
          .map(([key, value]) => `${key}=${value}`)
          .join(', '),
        updatedAt: item.updatedAt,
      })),
)

const envName = computed(() => environments.value.find((item) => item.id === scopeEnv.value)?.name ?? '')

const emptyText = computed(() =>
  isSecret.value
    ? 'Secret 用于保存密码、访问令牌、SSH 密钥等敏感信息，挂载到 Pod 时可按需注入。'
    : 'ConfigMap 用键值对保存配置数据，可被 Pod 以环境变量或文件方式引用。',
)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    environments.value = await listEnvironments()
    if (isSecret.value) {
      secrets.value = await listSecrets(appId.value, scopeEnv.value)
    } else {
      configMaps.value = await listConfigMaps(appId.value, scopeEnv.value)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : `${labelPlural.value} 加载失败`
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editingId.value = ''
  draftName.value = ''
  draftRows.value = [{ key: '', value: '' }]
  draftError.value = ''
  drawerVisible.value = true
}

function openEdit(id: string): void {
  editingId.value = id
  draftError.value = ''
  if (isSecret.value) {
    const secret = secrets.value.find((item) => item.id === id)
    if (!secret) return
    draftName.value = secret.name
    draftRows.value = secret.keys.map((key) => ({ key, value: '' }))
  } else {
    const configMap = configMaps.value.find((item) => item.id === id)
    if (!configMap) return
    draftName.value = configMap.name
    draftRows.value = Object.entries(configMap.data).map(([key, value]) => ({ key, value }))
  }
  drawerVisible.value = true
}

function addRow(): void {
  draftRows.value.push({ key: '', value: '' })
}

function removeRow(index: number): void {
  draftRows.value.splice(index, 1)
  if (!draftRows.value.length) draftRows.value.push({ key: '', value: '' })
}

async function save(): Promise<void> {
  const name = draftName.value.trim()
  if (!name) {
    draftError.value = '请填写名称'
    return
  }
  if (!/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(name)) {
    draftError.value = '名称需为 3–63 位小写字母、数字或连字符'
    return
  }
  const rows = draftRows.value.filter((row) => row.key.trim())
  if (!rows.length) {
    draftError.value = '至少需要一个 key'
    return
  }
  const keys = rows.map((row) => row.key.trim())
  if (new Set(keys).size !== keys.length) {
    draftError.value = 'key 不能重复'
    return
  }
  saving.value = true
  draftError.value = ''
  try {
    if (isSecret.value) {
      const saved = await saveSecret({
        id: editingId.value || undefined,
        appId: appId.value,
        environmentId: scopeEnv.value,
        name,
        keys,
      })
      const index = secrets.value.findIndex((item) => item.id === saved.id)
      if (index >= 0) secrets.value[index] = saved
      else secrets.value.unshift(saved)
    } else {
      const data = Object.fromEntries(rows.map((row) => [row.key.trim(), row.value]))
      const saved = await saveConfigMap({
        id: editingId.value || undefined,
        appId: appId.value,
        environmentId: scopeEnv.value,
        name,
        data,
      })
      const index = configMaps.value.findIndex((item) => item.id === saved.id)
      if (index >= 0) configMaps.value[index] = saved
      else configMaps.value.unshift(saved)
    }
    drawerVisible.value = false
    MessagePlugin.success(`${label.value} 已保存`)
  } catch (err) {
    draftError.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

function confirmDelete(id: string): void {
  deletingId.value = id
  deleteVisible.value = true
}

async function remove(): Promise<void> {
  const id = deletingId.value
  deleteVisible.value = false
  try {
    if (isSecret.value) {
      await deleteSecret(id)
      secrets.value = secrets.value.filter((item) => item.id !== id)
    } else {
      await deleteConfigMap(id)
      configMaps.value = configMaps.value.filter((item) => item.id !== id)
    }
    MessagePlugin.success(`${label.value} 已删除`)
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '删除失败')
  }
}

watch(
  [appId, envId, () => props.kind],
  () => {
    void load().then(() => {
      if (route.query.create === '1') openCreate()
    })
  },
  { immediate: true },
)

watch(
  () => route.query.create,
  (value) => {
    if (value === '1') {
      openCreate()
      const query = { ...route.query }
      delete query.create
      void router.replace({ query })
    }
  },
)
</script>

<template>
  <div class="ce">
    <div v-if="loading" class="ce__state">
      <t-loading size="small" :text="`加载 ${labelPlural}…`" />
    </div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <template v-else>
      <div v-if="entries.length" class="ce__card">
        <div class="ce__head">
          <div class="ce__title">
            <span>{{ labelPlural }}</span>
            <span v-if="isOverride" class="ce__scope">{{ envName }} 覆盖</span>
          </div>
          <t-button size="small" @click="openCreate">新建 {{ label }}</t-button>
        </div>
        <div class="ce__table">
          <div class="ce__row ce__row--head">
            <span>名称</span>
            <span>键</span>
            <span>更新时间</span>
            <span />
          </div>
          <div v-for="entry in entries" :key="entry.id" class="ce__row">
            <button type="button" class="ce__name" @click="openEdit(entry.id)">{{ entry.name }}</button>
            <span class="ce__keys" :title="entry.preview">{{ entry.keys.length }} 个键 · {{ entry.preview || '—' }}</span>
            <span class="ce__time">{{ fmtTime(entry.updatedAt) }}</span>
            <span class="ce__actions">
              <button type="button" class="ce__link" @click="openEdit(entry.id)">编辑</button>
              <button type="button" class="ce__link ce__link--danger" @click="confirmDelete(entry.id)">删除</button>
            </span>
          </div>
        </div>
      </div>

      <div v-else class="ce__empty">
        <svg class="ce__art" width="148" height="120" viewBox="0 0 148 120" fill="none" aria-hidden="true">
          <rect x="30" y="26" width="58" height="70" rx="4" fill="#fdeceb" stroke="#f6b7b4" />
          <rect x="52" y="40" width="58" height="70" rx="4" fill="#fff" stroke="#d0d4d9" />
          <path d="M64 58h26M64 68h26M64 78h18" stroke="#b1b7bc" stroke-width="3" stroke-linecap="round" />
          <circle cx="98" cy="36" r="10" fill="#5b6678" />
          <path d="m94 36 3 3 6-6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <h3 class="ce__empty-title">{{ labelPlural }}</h3>
        <p class="ce__empty-text">{{ emptyText }}</p>
        <p v-if="isOverride" class="ce__empty-scope">当前编辑 {{ envName }} 的环境覆盖。</p>
        <t-button class="ce__empty-btn" @click="openCreate">+ 新建 {{ label }}</t-button>
      </div>
    </template>

    <t-drawer
      v-model:visible="drawerVisible"
      :header="`${editingId ? '编辑' : '新建'} ${label}`"
      size="560px"
      :close-btn="true"
      drawer-class-name="ce-drawer"
    >
      <div class="ce__form">
        <label class="ce__field">
          <span class="ce__label">名称 <em>*</em></span>
          <t-input v-model="draftName" placeholder="checkout-api-config" />
        </label>

        <div class="ce__rows-head">
          <span class="ce__label">{{ isSecret ? '键（值不会保存或回显）' : '数据（键 / 值）' }}</span>
          <t-button size="small" variant="text" @click="addRow">+ 添加键</t-button>
        </div>

        <div v-for="(row, index) in draftRows" :key="index" class="ce__pair">
          <t-input v-model="row.key" size="small" placeholder="键名" />
          <t-input
            v-if="isSecret"
            v-model="row.value"
            size="small"
            type="password"
            placeholder="••••••"
          />
          <t-input v-else v-model="row.value" size="small" placeholder="值" />
          <button type="button" class="ce__remove" title="删除该 key" @click="removeRow(index)">
            <t-icon name="close" size="14px" />
          </button>
        </div>

        <p v-if="draftError" class="ce__error">{{ draftError }}</p>
        <p v-if="isSecret" class="ce__hint">演示环境只保存 key 名称，不保存 Secret 值。</p>
      </div>

      <template #footer>
        <div class="ce__footer">
          <t-button variant="outline" @click="drawerVisible = false">取消</t-button>
          <t-button theme="primary" :loading="saving" @click="save">保存</t-button>
        </div>
      </template>
    </t-drawer>

    <t-dialog
      v-model:visible="deleteVisible"
      header="删除"
      :confirm-btn="`删除${label}`"
      @confirm="remove"
    >
      <p>确认删除该 {{ label }}？该操作只影响本地 mock 配置。</p>
    </t-dialog>
  </div>
</template>

<style scoped>
.ce {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.ce__state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px;
}

/* ---- 列表 ---- */
.ce__card {
  display: flex;
  flex-direction: column;
}
.ce__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 56px;
  padding: 0 16px;
  border-bottom: 1px solid #e6e9ef;
}
.ce__title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #000a14;
  font-size: 14px;
  font-weight: 600;
}
.ce__scope {
  padding: 1px 8px;
  color: #0066cc;
  font-size: 11px;
  font-weight: 400;
  background: #e8f0fe;
  border-radius: 2px;
}
.ce__table {
  display: flex;
  flex-direction: column;
}
.ce__row {
  display: grid;
  grid-template-columns: minmax(160px, 1.1fr) minmax(180px, 2fr) minmax(130px, 0.9fr) 120px;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  padding: 0 16px;
  border-bottom: 1px solid #edf1f5;
  font-size: 13px;
}
.ce__row:last-child {
  border-bottom: 0;
}
.ce__row--head {
  min-height: 40px;
  color: #767d84;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: #fbfcfd;
}
.ce__name {
  padding: 0;
  color: #0066cc;
  font: inherit;
  text-align: left;
  background: none;
  border: 0;
  cursor: pointer;
}
.ce__name:hover {
  text-decoration: underline;
}
.ce__keys {
  overflow: hidden;
  color: #596168;
  font-family: var(--tk-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ce__time {
  color: #3b444c;
  font-size: 12px;
}
.ce__actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}
.ce__link {
  padding: 0;
  color: #0066cc;
  font: inherit;
  font-size: 12px;
  background: none;
  border: 0;
  cursor: pointer;
}
.ce__link--danger {
  color: #f33e3e;
}

/* ---- 空态 ---- */
.ce__empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 60px 24px;
  text-align: center;
}
.ce__empty-title {
  margin: 6px 0 0;
  color: #000a14;
  font-size: 16px;
  font-weight: 600;
}
.ce__empty-text {
  max-width: 460px;
  margin: 0;
  color: #596168;
  font-size: 13px;
  line-height: 21px;
}
.ce__empty-scope {
  margin: 0;
  color: #767d84;
  font-size: 12px;
}
.ce__empty-btn {
  margin-top: 6px;
}

/* ---- 表单 ---- */
.ce__form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ce__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ce__label {
  color: #3b444c;
  font-size: 12px;
  font-weight: 600;
}
.ce__label em {
  color: #f33e3e;
  font-style: normal;
}
.ce__rows-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
}
.ce__pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 28px;
  gap: 8px;
  align-items: center;
}
.ce__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: #596168;
  background: none;
  border: 0;
  border-radius: 2px;
  cursor: pointer;
}
.ce__remove:hover {
  background: #edf1f5;
}
.ce__error {
  margin: 0;
  color: #f33e3e;
  font-size: 12px;
}
.ce__hint {
  margin: 0;
  color: #767d84;
  font-size: 12px;
}
.ce__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
