<script setup lang="ts">
import type { GitCommit } from '@/types'
import GitCommitDetails from './GitCommitDetails.vue'

const props = defineProps<{ commit: GitCommit; repositoryUrl: string; selected: boolean; disabled: boolean }>()
const emit = defineEmits<{ select: [sha: string] }>()
function select() { if (!props.disabled && !props.commit.excluded) emit('select', props.commit.sha) }
</script>

<template>
  <div class="cmt" :class="{ 'cmt--active': selected, 'cmt--excluded': commit.excluded }" role="button" :tabindex="disabled || commit.excluded ? -1 : 0" :aria-pressed="selected" :aria-disabled="disabled || commit.excluded" :aria-label="`${commit.excluded ? '已排除提交' : '选择提交'} ${commit.sha}`" @click="select" @keydown.enter.self.prevent="select" @keydown.space.self.prevent="select">
    <GitCommitDetails :commit="commit" :repository-url="repositoryUrl" />
    <t-tooltip v-if="commit.excluded" content="该提交仅修改已排除路径中的文件，无法用于构建。请在 Git 仓库配置中调整路径规则。"><span class="cmt__excluded"><t-icon name="ban" size="14px" />已排除</span></t-tooltip>
    <span v-else class="cmt__pick" aria-hidden="true"><t-icon v-if="selected" name="check" size="12px" /></span>
  </div>
</template>

<style scoped>
.cmt{display:flex;align-items:flex-start;gap:12px;width:100%;box-sizing:border-box;padding:16px;color:#000a14;text-align:left;background:#fff;border:1px solid #d0d4d9;border-radius:4px;cursor:pointer}.cmt:hover{border-color:#b1b7bc}.cmt:focus-visible{outline:2px solid #0066cc;outline-offset:2px}.cmt--active,.cmt--active:hover{background:#f7fbff;border-color:#0066cc}.cmt[aria-disabled=true]{cursor:not-allowed}.cmt__pick{display:flex;flex:none;align-items:center;justify-content:center;width:16px;height:16px;margin-top:2px;color:#fff;border:1px solid #b1b7bc;border-radius:50%}.cmt--active .cmt__pick{background:#0066cc;border-color:#0066cc}.cmt__excluded{display:flex;align-items:center;gap:4px;flex:none;color:#d54941;font-size:12px;line-height:24px;cursor:help}.cmt--excluded{background:#fafbfc}
</style>
