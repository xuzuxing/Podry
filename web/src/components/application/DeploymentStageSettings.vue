<script setup lang="ts">
import { computed } from 'vue'
import type { DeploymentStageSettings } from '@/types'
import { deploymentStageErrors } from '@/utils/deploymentStage'

const props = defineProps<{
  modelValue: DeploymentStageSettings
  stage: 'pre' | 'post'
  workerEnabled: boolean
  submitted: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: DeploymentStageSettings] }>()
const unavailableSelection = computed(() => props.modelValue.runInEnvironment && !props.workerEnabled)
const errors = computed(() => deploymentStageErrors(props.modelValue, props.workerEnabled))
function update(patch: Partial<DeploymentStageSettings>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}
</script>

<template>
  <section class="deployment-stage-settings" :data-stage="stage">
    <div class="deployment-stage-trigger">
      <h4>Trigger {{ stage === 'pre' ? 'PRE-DEPLOYMENT' : 'POST-DEPLOYMENT' }} STAGE</h4>
      <t-radio-group :value="modelValue.trigger" :aria-label="stage === 'pre' ? '前置阶段触发方式' : '后置阶段触发方式'" @change="update({ trigger: $event as DeploymentStageSettings['trigger'] })">
        <t-radio value="auto">Automatically</t-radio>
        <t-radio value="manual">Manually</t-radio>
      </t-radio-group>
    </div>
    <slot />
    <div class="deployment-stage-execution">
      <t-tooltip :disabled="workerEnabled" content="This Environment is not configured to run on devtron worker." placement="right">
        <t-checkbox class="deployment-stage-execution__toggle" :checked="modelValue.runInEnvironment" :disabled="!workerEnabled" :aria-label="stage === 'pre' ? '在应用环境执行前置任务' : '在应用环境执行后置任务'" @change="update({ runInEnvironment: Boolean($event) })">Execute tasks in application environment</t-checkbox>
      </t-tooltip>
      <p v-if="!workerEnabled" class="deployment-stage-execution__hint">此环境未配置部署 worker</p>
      <template v-if="unavailableSelection">
        <p class="deployment-stage-execution__error" role="alert">已保存的执行环境当前不可用，请关闭此选项后保存。</p>
        <t-button size="small" variant="text" theme="primary" @click="update({ runInEnvironment: false })">关闭在应用环境执行</t-button>
      </template>
      <p v-else-if="submitted && errors.length" class="deployment-stage-execution__error" role="alert">{{ errors[0] }}</p>
    </div>
  </section>
</template>

<style scoped>
.deployment-stage-settings{display:flex;flex-direction:column;gap:16px;border-top:1px solid var(--tk-border);padding-top:16px}
.deployment-stage-trigger h4{font-size:11px;line-height:18px;font-weight:600;color:var(--tk-text-2);margin:0 0 8px;overflow-wrap:anywhere}
.deployment-stage-trigger .t-radio-group{display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.deployment-stage-execution{border-top:1px solid var(--tk-border);padding-top:12px}
.deployment-stage-execution__toggle{display:flex;flex-direction:row-reverse;align-items:flex-start;justify-content:space-between;gap:8px;width:100%;font-size:12px;line-height:18px}
.deployment-stage-execution__toggle :deep(.t-checkbox__label){flex:1;margin:0;white-space:normal}.deployment-stage-execution__toggle :deep(.t-checkbox__input){flex:none;margin-top:1px}
.deployment-stage-execution__hint,.deployment-stage-execution__error{font-size:12px;line-height:18px;margin:8px 0 0}
.deployment-stage-execution__hint{color:var(--tk-text-2)}.deployment-stage-execution__error{color:#d54941}
</style>
