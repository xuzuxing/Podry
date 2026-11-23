<script setup lang="ts">
import { computed } from 'vue'
import { platformsOf, targetPlatforms } from '@/utils/buildOptions'

const props = defineProps<{ modelValue: string; disabled: boolean; readonly?: boolean; error?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const selected = computed(() => platformsOf(props.modelValue))
const options = computed(() => [...new Set([...targetPlatforms, ...selected.value])].map(value => ({ label: value, value })))
const custom = computed(() => selected.value.filter(value => !targetPlatforms.includes(value)))
function update(value: unknown) { emit('update:modelValue', platformsOf((Array.isArray(value) ? value : []).join(',')).join(',')) }
function create(value: unknown) { emit('update:modelValue', platformsOf([...selected.value, String(value)].join(',')).join(',')) }
</script>

<template>
  <section class="build-platforms">
    <h3>{{ readonly ? '构建目标平台' : '设置构建目标平台' }}</h3>
    <p class="build-platforms__hint">未设置时，使用运行 CI 的 Kubernetes 节点的架构和操作系统。</p>
    <div v-if="readonly" class="build-platforms__inherited"><t-tag v-for="platform in selected" :key="platform" variant="outline">{{ platform }}</t-tag><span v-if="!selected.length">未设置目标平台</span></div>
    <t-select v-else :value="selected" :options="options" multiple clearable filterable creatable :disabled="disabled" :tag-props="{ variant: 'outline' }" placeholder="输入以选择或创建目标平台" :min-collapsed-num="4" aria-label="构建目标平台" @change="update" @create="create"><template #panelBottomContent><div class="build-platforms__menu-hint">输入以添加目标平台</div></template></t-select>
    <p v-if="custom.length" class="build-platforms__warning"><t-icon name="error-circle" />{{ readonly ? '当前配置使用' : '已输入' }}自定义平台，请确认平台有效且构建器支持：{{ custom.join('、') }}</p>
    <p v-if="error" class="build-platforms__error">{{ error }}</p>
  </section>
</template>

<style scoped>
.build-platforms h3{margin:0;font-size:13px;font-weight:600}.build-platforms__hint{margin:4px 0 12px;font-size:13px;color:#596168;line-height:20px}.build-platforms__inherited{display:flex;flex-wrap:wrap;gap:8px;padding:8px;background:#f7f8fa;color:#767d84;font-size:13px;overflow-wrap:anywhere}.build-platforms__warning{display:flex;align-items:flex-start;gap:6px;color:#9b6400;font-size:12px;line-height:20px;margin:8px 0 0;overflow-wrap:anywhere}.build-platforms__warning .t-icon{flex:none;margin-top:3px}.build-platforms__menu-hint{padding:8px 12px;font-size:12px;color:#767d84;border-top:1px solid #e6e9ef}.build-platforms__error{font-size:12px;color:#d54941;margin:6px 0 0}
</style>
