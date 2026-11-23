<script setup lang="ts">
type Argument = { key: string; value: string }
const props = defineProps<{ modelValue: Argument[]; disabled: boolean; buildpack: boolean; error?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: Argument[]] }>()
function update(index: number, field: keyof Argument, value: unknown) {
  emit('update:modelValue', props.modelValue.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: String(value) } : item))
}
</script>

<template>
  <section class="build-arguments">
    <h3>{{ buildpack ? '构建环境变量' : 'Docker 构建参数' }}</h3>
    <p>{{ buildpack ? '构建镜像时传递给 Buildpacks 的环境变量。' : '构建镜像时通过 --build-arg 传递给 Dockerfile 的参数。' }}</p>
    <div v-if="modelValue.length" class="build-arguments__head"><span>名称</span><span>值</span><span /></div>
    <div v-for="(argument, index) in modelValue" :key="index" class="build-argument">
      <t-input :value="argument.key" :aria-label="'参数名称 ' + (index + 1)" placeholder="参数名称" :disabled="disabled" @change="update(index, 'key', $event)" />
      <t-input :value="argument.value" :aria-label="'参数值 ' + (index + 1)" placeholder="参数值" :disabled="disabled" @change="update(index, 'value', $event)" />
      <t-button variant="text" :aria-label="'删除参数 ' + (index + 1)" :disabled="disabled" @click="emit('update:modelValue', modelValue.filter((_, itemIndex) => itemIndex !== index))"><t-icon name="delete" /></t-button>
    </div>
    <span v-if="error" class="build-arguments__error">{{ error }}</span>
    <span v-if="disabled && !modelValue.length" class="build-arguments__empty">未设置{{ buildpack ? '构建环境变量' : 'Docker 构建参数' }}</span>
    <t-button v-if="!disabled" variant="text" theme="primary" @click="emit('update:modelValue', [...modelValue, { key: '', value: '' }])"><template #icon><t-icon name="add" /></template>添加参数</t-button>
  </section>
</template>

<style scoped>
.build-arguments h3{margin:0;font-size:13px;font-weight:600}.build-arguments p{margin:4px 0 12px;font-size:13px;color:#596168;line-height:20px}.build-argument,.build-arguments__head{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 32px;gap:8px;margin-bottom:8px}.build-arguments__head{font-size:12px;color:#767d84}.build-arguments__error{display:block;color:#d54941;font-size:12px;margin:6px 0}.build-arguments__empty{font-size:13px;color:#767d84}
</style>
