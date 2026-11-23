<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { Environment } from '@/types'
import type { OverviewApplication } from '@/composables/useAppManagementOverview'
import { activityPeriods, inPeriod } from '@/utils/managementOverview'
import type { DistributionRow, OverviewPeriod } from '@/utils/managementOverview'
import OverviewDistribution from './OverviewDistribution.vue'

const props = defineProps<{ entries: OverviewApplication[]; environments: Environment[]; now: Date }>()
const period = shallowRef<OverviewPeriod>('month')
const kind = shallowRef<'ci' | 'cd'>('ci')
const rows = computed(() => {
  const result: DistributionRow[] = []
  for (const { app, workflow, builds, deployments, bindings } of props.entries) {
    const target = { projectId: app.projectId, appId: app.id }
    if (kind.value === 'ci') {
      const ci = workflow?.items.filter(item => item.kind === 'ci') ?? []
      for (const pipeline of ci) {
        result.push({ id: `${app.id}:${pipeline.id}`, label: `${app.name} • ${pipeline.id}`, value: builds.filter(build => build.pipelineId === pipeline.id && inPeriod(build.createdAt, period.value, props.now)).length, to: { name: 'app-builds', params: target, query: { pipeline: pipeline.id } } })
      }
      const unassigned = builds.filter(build => (!build.pipelineId || !ci.some(item => item.id === build.pipelineId)) && inPeriod(build.createdAt, period.value, props.now))
      if (unassigned.length) result.push({ id: `${app.id}:unassigned`, label: `${app.name} • 未归属流水线`, value: unassigned.length, to: { name: 'app-builds', params: target } })
    } else {
      for (const binding of bindings) {
        const env = props.environments.find(item => item.id === binding.environmentId)
        result.push({ id: `${app.id}:${binding.id}`, label: `${app.name} • ${env?.name ?? binding.environmentId}`, value: deployments.filter(deployment => deployment.bindingId === binding.id && inPeriod(deployment.createdAt, period.value, props.now)).length, to: { name: 'app-deployments', params: target, query: { env: binding.environmentId } } })
      }
    }
  }
  return result.some(row => row.value > 0) ? result : []
})
</script>

<template>
  <OverviewDistribution title="流水线触发排行" :rows="rows" :unit="kind === 'ci' ? '构建触发次数' : '部署触发次数'" :empty-title="kind === 'ci' ? '暂无构建触发记录' : '暂无部署触发记录'">
    <template #actions><select v-model="period" class="overview-select" aria-label="流水线排行时间范围"><option v-for="option in activityPeriods" :key="option.value" :value="option.value">{{ option.label }}</option></select></template>
    <template #tabs><div class="overview-tabs" role="tablist" aria-label="流水线类型"><button role="tab" :aria-selected="kind === 'ci'" @click="kind = 'ci'">构建流水线</button><button role="tab" :aria-selected="kind === 'cd'" @click="kind = 'cd'">部署流水线</button></div></template>
  </OverviewDistribution>
</template>
