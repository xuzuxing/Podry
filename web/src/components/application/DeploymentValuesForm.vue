<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { parseValues, updateValuesField } from '@/utils/deploymentValues'
import type { WorkloadKind } from '@/types'

const props = defineProps<{ workloadKind: WorkloadKind }>()
const model = defineModel<string>({ required: true })
const parsed = computed(() => parseValues(model.value))
const values = computed(() => parsed.value.values ?? {})
const formError = shallowRef('')
const envRows = computed(() => Object.entries(values.value.env ?? {}).map(([key, value]) => ({ key, value })))
const newKey = shallowRef('')
const newValue = shallowRef('')

function update(key: string, value: unknown): void {
  model.value = updateValuesField(model.value, [key], value)
}
function updateJob(key: string, value: number): void {
  model.value = updateValuesField(model.value, ['job', key], value)
}
function removeEnv(key: string): void {
  model.value = updateValuesField(model.value, ['env', key], undefined, true)
}
function updateEnv(key: string, value: string): void {
  model.value = updateValuesField(model.value, ['env', key], value)
}
function addEnv(): void {
  const key = newKey.value.trim()
  if (!key) { formError.value = '请填写环境变量名称'; return }
  if (['__proto__', 'constructor', 'prototype'].includes(key)) { formError.value = '不支持的环境变量名称'; return }
  if (Object.hasOwn(values.value.env ?? {}, key)) { formError.value = '环境变量名称不能重复'; return }
  updateEnv(key, newValue.value)
  newKey.value = ''; newValue.value = ''; formError.value = ''
}
function resetField(key: string): void {
  model.value = updateValuesField(model.value, [key], undefined, true)
}
watch(model, () => { formError.value = '' })
</script>

<template>
  <div class="deployment-form">
    <p class="deployment-form__hint">{{ props.workloadKind }} · 未填写的字段保持未设置；其他自定义 Values 字段会保留。高级配置可切换 YAML 编辑。</p>
    <div class="deployment-form__grid">
      <template v-if="workloadKind === 'Deployment'">
        <label class="deployment-form__field"><span>副本数 <code>replicaCount</code></span><t-input-number :model-value="values.replicaCount" :min="0" :max="1000" placeholder="继承 / 未设置" @change="update('replicaCount', $event)" /><button v-if="values.replicaCount !== undefined" class="deployment-form__reset" @click="resetField('replicaCount')">移除此字段</button></label>
        <label class="deployment-form__field"><span>容器端口 <code>containerPort</code></span><t-input-number :model-value="values.containerPort" :min="1" :max="65535" placeholder="继承 / 未设置" @change="update('containerPort', $event)" /><button v-if="values.containerPort !== undefined" class="deployment-form__reset" @click="resetField('containerPort')">移除此字段</button></label>
        <label class="deployment-form__field"><span>域名 <code>host</code></span><t-input :model-value="values.host ?? ''" placeholder="未设置" @change="update('host', $event)" /><button v-if="values.host !== undefined" class="deployment-form__reset" @click="resetField('host')">移除此字段</button></label>
      </template>
      <template v-else>
        <label class="deployment-form__field"><span>失败重试 <code>job.backoffLimit</code></span><t-input-number :model-value="values.job?.backoffLimit" :min="0" :max="1000" @change="updateJob('backoffLimit', Number($event))" /></label>
        <label class="deployment-form__field"><span>执行时限 <code>job.activeDeadlineSeconds</code></span><t-input-number :model-value="values.job?.activeDeadlineSeconds" :min="1" :max="604800" @change="updateJob('activeDeadlineSeconds', Number($event))" /></label>
      </template>
    </div>
    <section class="deployment-form__env">
      <h3>环境变量</h3>
      <div v-for="row in envRows" :key="row.key" class="deployment-form__row"><code>{{ row.key }}</code><t-input :model-value="row.value" :aria-label="row.key" @change="updateEnv(row.key, $event)" /><t-button variant="text" theme="danger" :aria-label="`删除变量 ${row.key}`" @click="removeEnv(row.key)"><t-icon name="delete" /></t-button></div>
      <div class="deployment-form__row"><t-input v-model="newKey" placeholder="KEY" aria-label="新变量名称" /><t-input v-model="newValue" placeholder="value" aria-label="新变量值" /><t-button variant="outline" @click="addEnv">添加</t-button></div>
      <p v-if="formError" class="deployment-form__error" role="alert">{{ formError }}</p>
    </section>
  </div>
</template>

<style scoped>
.deployment-form { flex: 1; min-height: 0; overflow: auto; padding: 24px; }
.deployment-form__hint { margin: 0 0 24px; color: #767d84; font-size: 12px; }
.deployment-form__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; max-width: 820px; }
.deployment-form__field { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; font-size: 13px; }
.deployment-form__field code { font-size: 12px; color: #767d84; }
.deployment-form__reset { padding: 0; border: 0; background: none; color: #0066cc; font: inherit; font-size: 12px; cursor: pointer; }
.deployment-form__env { max-width: 820px; margin-top: 32px; padding-top: 16px; border-top: 1px solid #e6e9ef; }
.deployment-form__env h3 { font-size: 13px; }
.deployment-form__row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 64px; align-items: center; gap: 12px; margin-top: 8px; }
.deployment-form__error { color: #c9353f; font-size: 12px; }
</style>
