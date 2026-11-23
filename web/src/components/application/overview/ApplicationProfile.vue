<script setup lang="ts">
import { computed } from 'vue'
import type { AppConfig, Application, Project } from '@/types'
import { fmtTime } from '@/utils/format'
import { legacyApplicationTags, overviewRepositories } from '@/utils/applicationOverview'
import { APPLICATION_DESCRIPTION_LIMIT } from '@/utils/applicationCreation'
const props = defineProps<{application:Application;project:Project|null;config:AppConfig|null;editing:boolean;text:string;saving:boolean;disabled:boolean;error:string;submitted:boolean}>()
const emit = defineEmits<{edit:[field:'description'|'project'|'tags'];'update:text':[text:string];save:[];cancel:[]}>()
const repositories = computed(() => overviewRepositories(props.config))
const legacy = computed(() => legacyApplicationTags(props.application))
</script>
<template>
  <aside class="ov__side">
    <div class="ov__icon"><t-icon name="application" size="28px" /></div>
    <h1 class="ov__name">{{application.name}}</h1>
    <div v-if="editing" class="ov__description-editor">
      <t-textarea :model-value="text" aria-label="应用描述" :disabled="saving" :status="submitted && error ? 'error' : undefined" :autosize="{minRows:3,maxRows:7}" placeholder="写一句简短描述" @change="emit('update:text',String($event))" @keydown.ctrl.enter.prevent="emit('save')" />
      <small>{{text.length}} / {{APPLICATION_DESCRIPTION_LIMIT}}</small>
      <p v-if="error" role="alert" class="ov__error">{{error}}</p>
      <div class="ov__actions"><t-button size="small" variant="outline" :disabled="saving" @click="emit('cancel')">取消</t-button><t-button size="small" :loading="saving" @click="emit('save')">保存</t-button></div>
    </div>
    <div v-else class="ov__desc"><span class="ov__desc-text">{{application.description || '写一句简短描述'}}</span><button type="button" class="ov__edit-btn" aria-label="编辑描述" :disabled="disabled" @click="emit('edit','description')"><t-icon name="edit" size="14px" /></button></div>
    <div class="ov__divider" />
    <div class="ov__field"><div class="ov__field-head"><span class="ov__field-label">所属项目</span><button type="button" class="ov__edit-btn" aria-label="调整所属项目" :disabled="disabled" @click="emit('edit','project')"><t-icon name="edit" size="14px" /></button></div><div class="ov__field-value">{{project?.name ?? '—'}}</div></div>
    <div class="ov__field"><span class="ov__field-label">创建时间</span><div class="ov__field-value">{{application.createdAt ? fmtTime(application.createdAt) : '未记录'}}</div></div>
    <div class="ov__field"><span class="ov__field-label">创建人</span><div class="ov__field-value"><span v-if="application.createdBy" class="ov__avatar">{{application.createdBy.slice(0,1)}}</span>{{application.createdBy || '未记录'}}</div></div>
    <div v-if="application.sourceMode==='git' && repositories.length" class="ov__field"><span class="ov__field-label">代码来源</span><div class="ov__repositories"><div v-for="repository in repositories" :key="repository.id"><t-icon name="git-branch" size="14px" /><a v-if="repository.url" :href="repository.url" target="_blank" rel="noopener noreferrer" :title="repository.url">{{repository.name}}</a><span v-else>{{repository.name}}</span></div></div></div>
    <div class="ov__divider" />
    <div class="ov__field"><div class="ov__field-head"><span class="ov__field-label"><t-icon name="tag" size="16px" />标签</span><button type="button" class="ov__edit-btn" aria-label="编辑标签" :disabled="disabled" @click="emit('edit','tags')"><t-icon name="edit" size="14px" /></button></div>
      <div v-if="application.labels?.length || legacy.length" class="ov__tags">
        <span v-for="label in application.labels" :key="label.key" class="ov__tag" :title="`${label.key}:${label.value}${label.propagate ? '（已勾选传播，Mock 未写集群）' : ''}`"><t-icon v-if="label.propagate" name="share" size="12px" aria-label="已勾选传播" /><span class="ov__tag-key">{{label.key}}</span><span aria-hidden="true">:</span><span class="ov__tag-value">{{label.value}}</span></span>
        <t-tag v-for="tag in legacy" :key="tag" size="small" variant="outline" :title="'旧版标签：'+tag">{{tag}}</t-tag>
      </div>
      <p v-else class="ov__tags-text">为应用添加标签，并选择需要传播的标签。<button type="button" class="ov__link" :disabled="disabled" @click="emit('edit','tags')">添加标签</button></p>
    </div>
  </aside>
</template>
<style scoped>
/* ---- 左列 ---- */
.ov__side{min-width:0}.ov__icon{display:flex;align-items:center;justify-content:center;width:48px;height:48px;color:#0066cc;background:#e8f1ff;border-radius:8px}.ov__name{margin:12px 0;color:#000a14;font-size:16px;line-height:24px;overflow-wrap:anywhere}.ov__desc{display:flex;align-items:flex-start;gap:8px;color:#596168;font-size:13px;line-height:20px}.ov__desc-text{flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}.ov__edit-btn{flex:none;border:0;background:none;color:#767d84;cursor:pointer;padding:2px}.ov__edit-btn:hover{color:#0066cc}.ov__divider{height:1px;background:#dce1e7;margin:16px 0}.ov__field+.ov__field{margin-top:12px}.ov__field-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.ov__field-label{display:flex;align-items:center;gap:8px;color:#767d84;font-size:13px;line-height:20px}.ov__field-value{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;line-height:20px;margin-top:4px;overflow-wrap:anywhere}.ov__avatar{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:#0066cc;color:white;border-radius:50%;font-weight:400;font-size:11px}.ov__repositories{display:flex;flex-direction:column;gap:4px;margin-top:4px}.ov__repositories>div{display:flex;align-items:center;gap:8px;min-width:0;font-size:13px}.ov__repositories a{color:#000a14;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ov__repositories a:hover{color:#0066cc}.ov__tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.ov__tag{display:inline-flex;align-items:center;gap:3px;max-width:100%;border:1px solid #dce1e7;border-radius:4px;background:white;padding:2px 6px;font-size:12px;line-height:18px;min-width:0}.ov__tag-key,.ov__tag-value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.ov__tag-key{max-width:140px}.ov__tag-value{max-width:140px}.ov__tags-text{font-size:13px;line-height:20px;color:#767d84;margin:8px 0}.ov__link{padding:0;border:0;background:none;color:#0066cc;cursor:pointer;font:inherit}.ov__description-editor{display:flex;flex-direction:column;gap:8px}.ov__description-editor small{color:#767d84;font-size:11px}.ov__actions{display:flex;justify-content:flex-end;gap:8px}.ov__error{margin:0;font-size:12px;color:#d54941}
</style>
