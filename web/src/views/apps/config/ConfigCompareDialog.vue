<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { getConfig, listBindings, listEnvironments } from '@/api'
import type { AppConfig, Binding, DeployValues, Environment } from '@/types'

const props = defineProps<{ visible: boolean; appId: string; envId?: string }>()
const emit = defineEmits<{ 'update:visible': [value: boolean] }>()

const loading = ref(false)
const error = ref('')
const config = ref<AppConfig | null>(null)
const bindings = ref<Binding[]>([])
const environments = ref<Environment[]>([])
const left = ref('')
const right = ref('')

const options = computed(() => [
  { label: '基础配置（Base）', value: '' },
  ...bindings.value.map((binding) => ({
    label: environments.value.find((env) => env.id === binding.environmentId)?.name ?? binding.environmentId,
    value: binding.environmentId,
  })),
])

function envName(envId: string): string {
  if (!envId) return '基础配置'
  return environments.value.find((env) => env.id === envId)?.name ?? envId
}

function flatten(values: DeployValues, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (input: unknown, path: string): void => {
    if (input === null || input === undefined) return
    if (typeof input === 'object') {
      Object.entries(input as Record<string, unknown>).forEach(([key, value]) => walk(value, path ? `${path}.${key}` : key))
      return
    }
    out[path] = String(input)
  }
  walk(values, prefix)
  return out
}

const leftValues = computed<Record<string, string>>(() => {
  const base = config.value?.deployValues ?? {}
  if (!left.value) return flatten(base)
  const binding = bindings.value.find((item) => item.environmentId === left.value)
  return flatten({ ...base, ...(binding?.overrideValues ?? {}) })
})

const rightValues = computed<Record<string, string>>(() => {
  const base = config.value?.deployValues ?? {}
  if (!right.value) return flatten(base)
  const binding = bindings.value.find((item) => item.environmentId === right.value)
  return flatten({ ...base, ...(binding?.overrideValues ?? {}) })
})

interface DiffRow {
  key: string
  left: string
  right: string
  changed: boolean
}

const rows = computed<DiffRow[]>(() => {
  const keys = [...new Set([...Object.keys(leftValues.value), ...Object.keys(rightValues.value)])].sort()
  return keys.map((key) => {
    const leftValue = leftValues.value[key] ?? '—'
    const rightValue = rightValues.value[key] ?? '—'
    return { key, left: leftValue, right: rightValue, changed: leftValue !== rightValue }
  })
})
const changedCount = computed(() => rows.value.filter((row) => row.changed).length)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [cfg, bindingList, envList] = await Promise.all([
      getConfig(props.appId),
      listBindings(props.appId),
      listEnvironments(),
    ])
    config.value = cfg
    bindings.value = bindingList
    environments.value = envList
    left.value = props.envId && bindingList.some((item) => item.environmentId === props.envId) ? props.envId : ''
    const other = bindingList.find((item) => item.environmentId !== left.value)
    right.value = other?.environmentId ?? (bindingList[0]?.environmentId ?? '')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载配置失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.visible,
  (open) => {
    if (open) void load()
  },
  { immediate: true },
)

function close(): void {
  emit('update:visible', false)
}
</script>

<template>
  <t-dialog
    :visible="visible"
    header="对比环境"
    :footer="false"
    width="820px"
    @close="close"
  >
    <div class="cmp">
      <p class="cmp__desc">对比基础配置与环境覆盖合并后的部署参数；只读，不修改任何配置。</p>
      <p v-if="error" class="cmp__error">{{ error }}</p>

      <div class="cmp__selector">
        <label class="cmp__field">
          <span>基准</span>
          <t-select v-model="left" :options="options" size="small" />
        </label>
        <span class="cmp__arrow">→</span>
        <label class="cmp__field">
          <span>对比</span>
          <t-select v-model="right" :options="options" size="small" />
        </label>
        <span class="cmp__count">{{ changedCount }} 项差异</span>
      </div>

      <div v-if="loading" class="cmp__state"><t-loading size="small" text="加载配置…" /></div>
      <table v-else class="cmp__table">
        <thead>
          <tr>
            <th class="cmp__key">参数</th>
            <th>{{ envName(left) }}</th>
            <th>{{ envName(right) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key" :class="{ 'cmp__row--changed': row.changed }">
            <td class="cmp__key u-mono">{{ row.key }}</td>
            <td class="u-mono">{{ row.left }}</td>
            <td class="u-mono">{{ row.right }}</td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="3" class="cmp__empty">两侧都没有可对比的部署参数。</td>
          </tr>
        </tbody>
      </table>

      <div class="cmp__footer">
        <t-button variant="outline" @click="close">关闭</t-button>
      </div>
    </div>
  </t-dialog>
</template>

<style scoped>
.cmp {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cmp__desc {
  margin: 0;
  color: #596168;
  font-size: 12px;
  line-height: 18px;
}
.cmp__error {
  margin: 0;
  color: #f33e3e;
  font-size: 12px;
}
.cmp__selector {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}
.cmp__field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  color: #3b444c;
  font-size: 12px;
}
.cmp__arrow {
  padding-bottom: 6px;
  color: #767d84;
}
.cmp__count {
  padding-bottom: 6px;
  color: #e37318;
  font-size: 12px;
  white-space: nowrap;
}
.cmp__state {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}
.cmp__table {
  width: 100%;
  max-height: 380px;
  overflow: auto;
  border-collapse: collapse;
  font-size: 12px;
}
.cmp__table th {
  padding: 8px 12px;
  color: #767d84;
  font-weight: 500;
  text-align: left;
  background: #f7fafc;
  border-bottom: 1px solid #e6e9ef;
}
.cmp__table td {
  padding: 8px 12px;
  color: #3b444c;
  border-bottom: 1px solid #edf1f5;
}
.cmp__key {
  width: 36%;
  color: #596168;
}
.cmp__row--changed td {
  background: #fff8e8;
}
.cmp__row--changed td:nth-child(2),
.cmp__row--changed td:nth-child(3) {
  color: #b95d00;
}
.cmp__empty {
  padding: 20px;
  color: #767d84;
  text-align: center;
}
.cmp__footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}
</style>
