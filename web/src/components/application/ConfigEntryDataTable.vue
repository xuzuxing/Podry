<script setup lang="ts">
import { useConfigDataTable } from '@/composables/useConfigDataTable'
const props = defineProps<{ modelValue: string; readonly: boolean; secret: boolean; masked: boolean; external: boolean; volume: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { parsed, displayed, descending, mutationError, sort, change } = useConfigDataTable(() => props.modelValue, value => emit('update:modelValue', value))
</script>

<template>
  <div class="entry-form__pairs">
    <p v-if="parsed.error" role="alert" class="entry-form__error">{{ masked ? 'Secret 草稿已隐藏。显示/编辑值后切换 YAML 修正。' : `${parsed.error}，请切换 YAML 修正。` }}</p>
    <template v-else>
      <div class="entry-form__pair entry-form__pair--head">
        <button type="button" class="key-sort" :aria-label="descending ? '按键名升序排列' : '按键名降序排列'" @click="sort()">{{ volume ? 'File Name' : 'Key' }} <t-icon :name="descending ? 'arrow-down' : 'arrow-up'" /></button>
        <span>{{ external ? '引用值由已有资源提供' : volume ? 'File Content' : 'Value' }}</span><span />
      </div>
      <div v-for="row in displayed" :key="row.id" class="entry-form__pair" :data-row-id="row.id">
        <div class="key-cell">
          <t-input :model-value="row.key" :readonly="readonly || masked" :status="row.error ? 'error' : undefined" :aria-label="`键名 ${row.index + 1}`" :aria-invalid="!!row.error" :aria-describedby="row.error ? `key-error-${row.id}` : undefined" placeholder="Key" @change="change({type:'key',index:row.index,value:String($event)})" />
          <small v-if="row.error" :id="`key-error-${row.id}`" class="entry-form__error" role="alert">{{ row.error }}</small>
        </div>
        <t-textarea :model-value="external ? '由已有资源提供' : masked ? '••••••' : row.value" :readonly="readonly || masked || external" :autosize="{minRows:1,maxRows:6}" :aria-label="`值 ${row.key}`" @change="change({type:'value',index:row.index,value:String($event)})" />
        <t-button v-if="!readonly && !masked" variant="text" theme="default" :aria-label="`删除键 ${row.key}`" @click="change({type:'remove',index:row.index})"><t-icon name="delete" /></t-button>
      </div>
      <div v-if="!readonly && !masked" class="entry-form__add"><t-button variant="text" @click="change({type:'add'})"><template #icon><t-icon name="add" /></template>添加键</t-button></div>
      <p v-if="!displayed.length" class="entry-form__empty">{{ readonly || masked ? '没有配置数据。' : '添加键值，或切换 YAML 批量编辑。' }}</p>
      <p v-if="mutationError" class="entry-form__error" role="alert">{{ mutationError }}</p>
    </template>
  </div>
</template>

<style scoped>
.entry-form__pairs{border:1px solid #dce1e7;border-radius:4px}.entry-form__pair{display:grid;grid-template-columns:minmax(130px,1fr) minmax(180px,2fr) 40px;align-items:start;gap:12px;padding:10px 12px;border-bottom:1px solid #edf1f5;font-size:12px}.entry-form__pair--head{background:#f7f9fb;color:#596168;align-items:center}.key-sort{display:flex;align-items:center;gap:8px;background:none;border:0;padding:0;cursor:pointer;font:inherit;color:inherit}.key-cell{min-width:0}.entry-form__error{display:block;margin:6px 0;color:#d54941;font-size:12px;overflow-wrap:anywhere}.entry-form__pairs>p{padding:0 12px}.entry-form__add{padding:4px}.entry-form__empty{color:#767d84;font-size:12px}
</style>
