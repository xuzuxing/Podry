<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import ErrorState from '@/components/ErrorState.vue'
import GitRepositoryCard from '@/components/application/GitRepositoryCard.vue'
import { useGitRepositories } from '@/composables/useGitRepositories'

const route = useRoute()
const appId = computed(() => String(route.params.appId ?? ''))
const { credentials, materials, loading, saving, error, conflict, newFormKey, deleteTarget, load, save, remove } = useGitRepositories(appId)
</script>

<template>
  <div class="git-page">
    <header class="git-page__head"><h1>Git 仓库</h1><p>管理该应用的源码仓库。</p></header>
    <t-alert v-if="conflict" theme="warning" title="配置已被更新" message="草稿已保留。重新读取最新配置后再编辑保存。" class="git-page__alert"><template #operation><t-button variant="text" @click="load">重新读取</t-button></template></t-alert>
    <div v-if="loading" class="git-page__state"><t-loading size="small" text="加载中…" /></div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />
    <template v-else>
      <GitRepositoryCard :key="'new-' + newFormKey" :materials="materials" :credentials="credentials" :saving="saving" @save="save" />
      <GitRepositoryCard v-for="material in materials" :key="material.id" :material="material" :materials="materials" :credentials="credentials" :saving="saving" @save="save" @delete="deleteTarget = $event" />
    </template>
    <t-dialog :visible="Boolean(deleteTarget)" header="删除 Git 仓库" :confirm-btn="{ content: '删除', theme: 'danger', loading: saving }" :close-on-overlay-click="!saving" @close="!saving && (deleteTarget = null)" @cancel="!saving && (deleteTarget = null)" @confirm="remove">
      <p>确认删除仓库 <strong>{{ deleteTarget?.repositoryUrl }}</strong>？</p><p>该仓库将从当前应用的源码配置中移除。</p>
    </t-dialog>
  </div>
</template>

<style scoped>
.git-page{width:100%;max-width:1012px;margin:0 auto;padding:24px;box-sizing:border-box}.git-page__head{margin-bottom:16px}.git-page__head h1{margin:0 0 4px;color:#000a14;font-size:18px;font-weight:400;line-height:26px}.git-page__head p{margin:0;color:#596168;font-size:12px;line-height:20px}.git-page__state{display:flex;justify-content:center;padding:80px 0}.git-page__alert{margin-bottom:16px}
</style>
