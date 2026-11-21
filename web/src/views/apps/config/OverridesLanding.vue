<script setup lang="ts">
/**
 * 环境覆盖入口：Devtron 的左侧导航直接列环境；这里直接跳到第一个已绑定环境的
 * Deployment Template，没有绑定环境时给出空态。
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { listBindings, listEnvironments } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import type { Binding, Environment } from '@/types'

const route = useRoute()
const router = useRouter()
const appId = computed(() => String(route.params.appId ?? ''))
const projectId = computed(() => String(route.params.projectId ?? ''))

const bindings = ref<Binding[]>([])
const environments = ref<Environment[]>([])
const loading = ref(true)
const error = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [bindingList, environmentList] = await Promise.all([listBindings(appId.value), listEnvironments()])
    bindings.value = bindingList
    environments.value = environmentList
    const first = bindingList[0]
    if (first) {
      await router.replace({
        name: 'config-override-deployment',
        params: { projectId: projectId.value, appId: appId.value, envId: first.environmentId },
      })
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '环境覆盖加载失败'
  } finally {
    loading.value = false
  }
}

watch(appId, load, { immediate: true })
</script>

<template>
  <div class="ovl">
    <div v-if="loading" class="ovl__state">
      <t-loading size="small" text="加载环境绑定…" />
    </div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />
    <EmptyState
      v-else-if="!bindings.length"
      title="还没有环境绑定"
      description="先在 Build & Deploy 创建工作流并绑定环境，才能配置环境覆盖。"
    >
      <template #action>
        <router-link :to="{ name: 'config-workflow', params: { projectId, appId } }">去创建工作流</router-link>
      </template>
    </EmptyState>
  </div>
</template>

<style scoped>
.ovl {
  padding: 24px;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.ovl__state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px;
}
</style>
