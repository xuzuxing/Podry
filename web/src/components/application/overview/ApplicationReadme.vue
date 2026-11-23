<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import ReleaseNotesMarkdown from '@/components/application/ReleaseNotesMarkdown.vue'
import { fmtTime } from '@/utils/format'
const props=defineProps<{source:string;editing:boolean;draft:string;saving:boolean;disabled:boolean;error:string;updatedBy?:string;updatedAt?:string}>()
const emit=defineEmits<{edit:[];'update:draft':[value:string];save:[];cancel:[]}>()
const preview=shallowRef(false)
watch(()=>props.editing,()=>{preview.value=false})
</script>
<template>
  <section class="tk-panel ov__readme">
    <header class="ov__readme-head"><strong><t-icon name="file" size="14px" />说明</strong><t-button v-if="!editing" size="small" variant="text" :disabled="disabled" @click="emit('edit')">编辑</t-button><t-radio-group v-else v-model="preview" size="small" variant="default-filled"><t-radio-button :value="false">编辑</t-radio-button><t-radio-button :value="true">预览</t-radio-button></t-radio-group></header>
    <div class="ov__readme-body">
      <template v-if="editing"><t-textarea v-if="!preview" :model-value="draft" aria-label="应用说明 Markdown" :disabled="saving" :autosize="{minRows:14,maxRows:24}" placeholder="使用 Markdown 介绍这个应用…" @change="emit('update:draft',String($event))" /><ReleaseNotesMarkdown v-else :source="draft || '尚未填写说明。'" /><p v-if="error" role="alert" class="ov__readme-error">{{error}}</p></template>
      <ReleaseNotesMarkdown v-else-if="source" :source="source" />
      <div v-else class="ov__readme-empty"><h2>介绍这个应用</h2><p>描述应用的用途、功能、收益与目标用户，帮助团队了解如何使用和维护这个应用。</p><t-button variant="outline" :disabled="disabled" @click="emit('edit')">添加说明</t-button></div>
    </div>
    <footer v-if="editing" class="ov__readme-footer"><span>支持 Markdown</span><t-button variant="outline" :disabled="saving" @click="emit('cancel')">取消</t-button><t-button :loading="saving" @click="emit('save')">保存</t-button></footer>
    <footer v-else-if="updatedAt" class="ov__readme-updated">{{updatedBy || '—'}} 更新于 {{fmtTime(updatedAt)}}</footer>
  </section>
</template>
<style scoped>
.ov__readme{margin-top:16px;overflow:hidden}.ov__readme-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:49px;padding:8px 20px;border-bottom:1px solid #dce1e7}.ov__readme-head strong{display:flex;align-items:center;gap:8px;font-size:13px}.ov__readme-body{padding:20px;min-height:180px}.ov__readme-empty h2{margin:0 0 12px;font-size:22px;font-weight:400}.ov__readme-empty p{color:#596168;line-height:22px;margin-bottom:20px}.ov__readme-footer{display:flex;align-items:center;gap:12px;padding:16px 20px;border-top:1px solid #dce1e7}.ov__readme-footer span{flex:1;font-size:12px;color:#767d84}.ov__readme-updated{padding:12px 20px;border-top:1px solid #dce1e7;color:#767d84;font-size:11px}.ov__readme-error{color:#d54941;font-size:12px;margin:12px 0 0}
</style>
