<script setup lang="ts">
import type { MaterialSelectionState } from '@/composables/useBuildMaterials'
import { repositoryName } from '@/utils/gitMaterials'
import { fmtRelative, shortSha } from '@/utils/format'
import { isWebhookSource, sourceLabels } from '@/utils/gitSources'

defineProps<{ states: MaterialSelectionState[]; activeId: string; disabled: boolean }>()
const emit = defineEmits<{ select: [id: string]; refresh: [state: MaterialSelectionState] }>()
/** 仓库名，Devtron 左侧仓库卡展示 `/checkout-api` 形式 */
const label = (url: string) => '/' + repositoryName(url)
</script>

<template>
  <aside class="build-repositories">
    <p class="build-repositories__title">Git 仓库 <span>{{ states.filter(item => item.selectedSha).length }}/{{ states.length }}</span></p>
    <div class="build-repositories__list">
      <article v-for="state in states" :key="state.material.id" class="build-repository" :class="{ 'build-repository--active': activeId === state.material.id }">
        <button type="button" class="build-repository__select" :aria-pressed="activeId === state.material.id" :disabled="disabled" :title="state.material.repositoryUrl" @click="emit('select', state.material.id)"><t-icon name="code" size="20px" /><strong>{{ label(state.material.repositoryUrl) }}</strong><t-icon v-if="state.selectedSha" name="check-circle-filled" class="build-repository__selected" /></button>
        <t-select v-if="activeId === state.material.id && state.source.type === 'branch'" :value="state.branch" :aria-label="'构建分支 ' + state.material.id" :options="state.branches.map(item => ({label:item.name,value:item.name}))" disabled size="small" variant="borderless" placeholder="没有匹配的分支" />
        <span v-else class="build-repository__branch">{{ isWebhookSource(state.source) ? sourceLabels[state.source.type] : state.branch || '尚未设置分支' }}</span>
        <span class="build-repository__sha">{{ state.selectedSha ? shortSha(state.selectedSha) : '尚未选择提交' }}</span>
        <div class="build-repository__updated"><span>{{ state.loading ? '读取中…' : state.error ? '读取失败' : isWebhookSource(state.source) ? `${state.events.length} 个已接收事件` : state.commits[0] ? '更新于 ' + fmtRelative(state.commits[0].committedAt) : '暂无提交' }}</span><button type="button" :disabled="disabled || state.loading" aria-label="刷新仓库提交" @click="emit('refresh', state)"><t-icon name="refresh" size="14px" /></button></div>
      </article>
    </div>
  </aside>
</template>

<style scoped>
.build-repositories{display:flex;flex-direction:column;min-height:0;border-right:1px solid #e6e9ef}.build-repositories__title{display:flex;justify-content:space-between;flex:none;margin:0;padding:12px 20px;border-bottom:1px solid #e6e9ef;font-size:13px;font-weight:600}.build-repositories__title span{color:#767d84;font-size:12px}.build-repositories__list{overflow:auto;min-height:0;padding:16px}.build-repository{padding:12px;margin-bottom:12px;background:#f7fafc;border:1px solid #e6e9ef;border-radius:4px}.build-repository--active{background:#f0f7ff;border-color:#0066cc}.build-repository__select{display:flex;align-items:center;gap:8px;width:100%;padding:0;margin-bottom:8px;border:0;background:none;cursor:pointer;text-align:left;font:inherit;font-size:12px}.build-repository__select>.t-icon:first-child{color:#f4511e;flex:none}.build-repository__select strong{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.build-repository__selected{color:#00875f;flex:none;margin-left:auto}.build-repository__branch,.build-repository__sha{display:block;font-size:12px;line-height:24px;color:#596168;overflow-wrap:anywhere}.build-repository__sha{font-family:monospace;color:#0066cc;font-size:11px}.build-repository__updated{display:flex;align-items:center;justify-content:space-between;gap:4px;color:#767d84;font-size:11px;margin-top:6px}.build-repository__updated button{display:flex;align-items:center;border:0;background:none;color:#596168;cursor:pointer;padding:4px}.build-repositories :deep(.t-input){padding:0;background:transparent;border-color:transparent}.build-repositories :deep(.t-input__inner){font-size:12px}
</style>
