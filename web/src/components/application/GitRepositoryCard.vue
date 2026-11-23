<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { Credential, GitMaterial } from '@/types'
import { repositoryName } from '@/utils/gitMaterials'

const props = defineProps<{
  material?: GitMaterial
  materials: GitMaterial[]
  credentials: Credential[]
  saving: boolean
}>()
const emit = defineEmits<{ save: [material: GitMaterial]; delete: [material: GitMaterial] }>()
const expanded = shallowRef(!props.material && props.materials.length === 0)
const cloneDirectory = shallowRef(Boolean(props.material))
const excludeFiles = shallowRef(Boolean(props.material?.filterPatterns.length))
const showHelp = shallowRef(true)
const errors = ref<Record<string, string>>({})
const patterns = shallowRef('')
const draft = ref<GitMaterial>(blank())
const account = computed({
  get: () => draft.value.accountMode === 'public' ? '__public__' : draft.value.credentialId ?? '',
  set: (id: string) => {
    draft.value.accountMode = id === '__public__' ? 'public' : 'credential'
    draft.value.credentialId = id === '__public__' ? null : id
  },
})
const accounts = computed(() => [
  { label: '公开仓库（匿名访问）', value: '__public__' },
  ...props.credentials.map((item) => ({ label: item.name, value: item.id })),
])
const name = computed(() => repositoryName(props.material?.repositoryUrl ?? ''))

function blank(): GitMaterial {
  return { id: '', repositoryUrl: '', branch: 'main', credentialId: null, accountMode: 'public', checkoutPath: './', fetchSubmodules: false, filterPatterns: [] }
}
function reset() {
  draft.value = props.material ? { ...props.material, filterPatterns: [...props.material.filterPatterns] } : blank()
  patterns.value = draft.value.filterPatterns.join('\n')
  excludeFiles.value = Boolean(patterns.value)
  cloneDirectory.value = Boolean(props.material)
  errors.value = {}
}
function cancel() {
  reset()
  expanded.value = false
}
function save() {
  const next: Record<string, string> = {}
  const url = draft.value.repositoryUrl.trim()
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) next.repositoryUrl = 'Git 仓库地址需以 http:// 或 https:// 开头'
    if (parsed.username || parsed.password) next.repositoryUrl = '请通过 Git 账号选择凭据，不要在地址中填写口令'
  } catch { next.repositoryUrl = url ? '请输入有效的 Git 仓库地址' : '请填写仓库地址' }
  if (!account.value || (draft.value.accountMode === 'credential' && !props.credentials.some((item) => item.id === draft.value.credentialId))) next.account = '请选择 Git 账号'
  const checkoutPath = cloneDirectory.value ? draft.value.checkoutPath.trim() : './'
  if ((props.materials.length > 0 || cloneDirectory.value) && !checkoutPath) next.checkoutPath = '请填写克隆目录'
  else if (checkoutPath && !checkoutPath.startsWith('./')) next.checkoutPath = '克隆目录必须以 ./ 开头'
  if (checkoutPath.split('/').includes('..')) next.checkoutPath = '克隆目录不能包含上级目录 ..'
  if (props.materials.some((item) => item.id !== props.material?.id && item.checkoutPath.replace(/\/+$/, '') === checkoutPath.replace(/\/+$/, ''))) next.checkoutPath = '该克隆目录已被其他仓库使用'
  errors.value = next
  if (Object.keys(next).length) return
  emit('save', { ...draft.value, id: props.material?.id ?? `git-${crypto.randomUUID()}`, repositoryUrl: url, checkoutPath, filterPatterns: excludeFiles.value ? patterns.value.split('\n').map((line) => line.trim()).filter(Boolean) : [] })
}

// 只在本仓库的已保存内容发生变化时重置，保留其他仓库正在编辑的草稿。
watch(() => JSON.stringify(props.material), () => { reset(); expanded.value = !props.material && !props.materials.length }, { immediate: true })
</script>

<template>
  <button v-if="!material && !expanded" type="button" class="git-add" :disabled="saving" @click="expanded = true">
    <t-icon name="add" size="20px" /> 添加 Git 仓库
  </button>
  <article v-else class="git-repository" :class="{ 'git-repository--expanded': expanded }">
    <button v-if="material && !expanded" type="button" class="git-repository__summary" :aria-expanded="expanded" @click="expanded = true">
      <svg class="git-repository__icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" transform="rotate(45 12 12)" fill="#f4511e"/><path d="m8 5 8 8m-5-5v9" fill="none" stroke="white" stroke-width="1.6"/><circle cx="11" cy="8" r="1.5" fill="white"/><circle cx="16" cy="13" r="1.5" fill="white"/><circle cx="11" cy="17" r="1.5" fill="white"/></svg>
      <span class="git-repository__info"><span class="git-repository__name">{{ name }}</span><span class="git-repository__url">{{ material.repositoryUrl }}</span></span>
      <t-icon name="chevron-down" size="16px" />
    </button>
    <form v-else class="git-form" @submit.prevent="save">
      <header class="git-form__header"><h2>{{ material ? '编辑 Git 仓库' : '添加 Git 仓库' }}</h2><t-button v-if="material" variant="text" aria-label="收起仓库" :disabled="saving" @click="cancel"><t-icon name="chevron-up" /></t-button></header>
      <div class="git-form__source">
        <label class="git-field"><span>Git 账号 <em>*</em></span><t-select v-model="account" :options="accounts" :disabled="saving" /><span v-if="errors.account" class="git-field__error">{{ errors.account }}</span></label>
        <label class="git-field"><span>Git 仓库地址 <em>*</em></span><t-input v-model="draft.repositoryUrl" name="repositoryUrl" placeholder="输入 Git 仓库地址" :disabled="saving" /><span v-if="errors.repositoryUrl" class="git-field__error">{{ errors.repositoryUrl }}</span></label>
      </div>
      <t-alert v-if="draft.accountMode === 'public'" theme="info" message="该 Git 账号以匿名方式读取，仅能访问公开仓库。" />
      <div class="git-option">
        <t-checkbox v-model="excludeFiles" :disabled="saving">排除此仓库中特定文件或文件夹</t-checkbox>
        <div v-if="excludeFiles" class="git-option__details">
          <div class="git-pattern-info"><p>设置提交的文件路径包含与排除规则。<t-button size="small" variant="text" @click="showHelp = !showHelp">{{ showHelp ? '隐藏说明' : '了解规则' }}</t-button></p><div v-if="showHelp"><p>在路径前添加 <code>!</code> 表示排除，例如 <code>!docs/**</code>。</p><p>支持 <code>*</code>、<code>/*</code>、<code>/**</code>；规则冲突时，以后面的规则为准。每行一条规则。</p></div></div>
          <t-textarea v-model="patterns" name="filterPatterns" placeholder="!docs/**&#10;src/**" :autosize="{ minRows: 3, maxRows: 8 }" :disabled="saving" />
        </div>
      </div>
      <div class="git-option">
        <t-checkbox v-model="cloneDirectory" :disabled="saving">设置克隆目录</t-checkbox>
        <p class="git-option__hint">当应用的构建需要多个 Git 仓库时，为每个仓库设置独立的目录。</p>
        <div v-if="cloneDirectory" class="git-option__details"><t-input v-model="draft.checkoutPath" name="checkoutPath" placeholder="例如 ./web" :disabled="saving" /><span v-if="errors.checkoutPath" class="git-field__error">{{ errors.checkoutPath }}</span></div>
        <span v-else-if="errors.checkoutPath" class="git-field__error">{{ errors.checkoutPath }}</span>
      </div>
      <div class="git-option"><t-checkbox v-model="draft.fetchSubmodules" :disabled="saving">递归拉取 Git 子模块</t-checkbox><p class="git-option__hint">使用父仓库默认远程地址所配置的凭据。</p></div>
      <footer class="git-form__footer">
        <t-tooltip v-if="material" :content="materials.length === 1 ? '至少需要保留一个 Git 仓库' : '删除 Git 仓库'"><span><t-button theme="danger" variant="text" :disabled="materials.length === 1 || saving" @click="emit('delete', material)">删除</t-button></span></t-tooltip>
        <div class="git-form__actions"><t-button variant="text" :disabled="saving" @click="cancel">取消</t-button><t-button theme="primary" type="submit" :loading="saving">保存</t-button></div>
      </footer>
    </form>
  </article>
</template>

<style scoped>
.git-add{display:flex;align-items:center;gap:8px;width:100%;min-height:66px;margin:0 0 16px;padding:16px 20px;text-align:left;color:#0066cc;font:inherit;background:white;border:1px dashed #ccd1d9;border-radius:8px;cursor:pointer}
.git-add:hover{background:#f7fbff;border-color:#0066cc}.git-add:focus-visible,.git-repository__summary:focus-visible{outline:2px solid #0066cc;outline-offset:2px}
.git-repository{margin-bottom:12px;background:#fff;border:1px solid #d0d4d9;border-radius:8px;overflow:hidden}.git-repository__summary{display:flex;align-items:center;gap:12px;width:100%;min-height:70px;padding:15px 20px;text-align:left;background:transparent;border:0;cursor:pointer;font:inherit;color:#000a14}
.git-repository__icon{flex:none}.git-repository__info{display:flex;flex:1;flex-direction:column;min-width:0;gap:2px}.git-repository__name{font-size:14px;font-weight:500}.git-repository__url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#596168}.git-repository__summary>.t-icon{color:#959ba1}
.git-form{display:flex;flex-direction:column;gap:16px;padding:16px 20px}.git-form__header{display:flex;justify-content:space-between;align-items:center;min-height:24px}.git-form__header h2{margin:0;font-size:16px;font-weight:600}.git-form__source{display:grid;grid-template-columns:250px minmax(0,1fr);gap:16px}.git-field{display:flex;flex-direction:column;gap:8px;font-size:13px;color:#3b444c}.git-field em{color:#f33e3e;font-style:normal}.git-field__error{display:block;font-size:12px;color:#d54941;margin-top:4px}
.git-option{font-size:14px}.git-option__hint{margin:4px 0 0 28px;color:#596168;font-size:12px;line-height:20px}.git-option__details{margin:8px 0 0 28px}.git-pattern-info{padding:8px;border:1px solid #d0d4d9;border-bottom:0;border-radius:4px 4px 0 0;font-size:12px;line-height:20px}.git-pattern-info p{margin:0}.git-pattern-info code{padding:1px 4px;background:#f0f2f5;border-radius:3px}.git-form__footer{display:flex;align-items:center;justify-content:space-between}.git-form__actions{display:flex;gap:8px;margin-left:auto}
@media(max-width:1050px){.git-form__source{grid-template-columns:minmax(0,1fr)}}
</style>
