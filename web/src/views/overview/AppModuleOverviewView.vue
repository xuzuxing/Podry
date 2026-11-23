<script setup lang="ts">
import { computed } from 'vue'
import ErrorState from '@/components/ErrorState.vue'
import MetricCard from '@/components/overview/MetricCard.vue'
import ApplicationDoraMetrics from '@/components/overview/ApplicationDoraMetrics.vue'
import ApplicationActivityChart from '@/components/overview/ApplicationActivityChart.vue'
import ApplicationPipelineInsights from '@/components/overview/ApplicationPipelineInsights.vue'
import { useAppManagementOverview } from '@/composables/useAppManagementOverview'
import '@/components/overview/management-overview.css'

const { loading, error, warnings, projectCount, environments, entries, pipelines, productionPipelines, productionDeployments, builds, deployments, now, load } = useAppManagementOverview()
const ciCount = computed(() => pipelines.value.filter(({ pipeline }) => pipeline.kind === 'ci').length)
const cdCount = computed(() => pipelines.value.filter(({ pipeline }) => pipeline.kind === 'cd').length)
const externalCiCount = computed(() => entries.value.filter(({ app }) => app.sourceMode === 'image').length)
</script>

<template>
  <div class="management-overview application-management-overview" :aria-busy="loading">
    <div v-if="loading" class="overview-skeleton" role="status" aria-label="加载应用概览"><div v-for="section in 2" :key="section"><div class="overview-skeleton__title" /><div class="overview-grid"><div v-for="card in section === 1 ? 3 : 6" :key="card" class="overview-skeleton__card" /></div></div><div class="overview-skeleton__panel" /></div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />
    <template v-else>
      <div v-for="notice in warnings" :key="notice" class="overview-notice" role="status"><t-icon name="info-circle" /><p>{{ notice }}</p><button class="overview-icon-button" aria-label="重新加载应用概览" @click="load"><t-icon name="refresh" /></button></div>
      <div class="management-overview__body">
        <!-- At a Glance -->
        <section class="overview-section">
          <div class="overview-section__heading"><h2 class="overview-section__title">资源总览</h2><button class="overview-icon-button" aria-label="刷新应用概览" title="刷新数据" @click="load"><t-icon name="refresh" size="18px" /></button></div>
          <div class="overview-grid">
            <MetricCard icon="folder" title="项目" :value="projectCount" hint="当前项目总数" :to="{ name: 'projects' }" tone="orange" />
            <MetricCard icon="app" title="应用" :value="entries.length" hint="通过 Kubernetes 原生 CI/CD 管理的应用总数" :to="{ name: 'apps' }" />
            <MetricCard icon="layers" title="环境" :value="environments.length" hint="在 Podry 中创建的环境总数" :to="{ name: 'settings-environments' }" tone="green" />
          </div>
        </section>
        <!-- Workflow Overview -->
        <section class="overview-section">
          <h2 class="overview-section__title">工作流概览</h2>
          <div class="overview-grid">
            <MetricCard icon="tools" title="构建流水线" :value="ciCount" hint="所有应用的构建流水线总数" />
            <MetricCard icon="image" title="外部镜像源" :value="externalCiCount" hint="使用外部镜像源的应用数量" tone="teal" />
            <MetricCard icon="rocket" title="部署流水线" :value="cdCount" hint="所有应用的部署流水线总数" />
            <MetricCard icon="secured" title="已启用安全扫描的工作流" value="—" hint="当前尚未接入工作流安全扫描统计" tone="green" />
            <MetricCard icon="git-branch" title="生产流水线 GitOps 合规率" value="—" hint="当前尚未接入 GitOps 合规统计" tone="purple" />
            <MetricCard icon="chart-bar" title="生产流水线" :value="productionPipelines.length" hint="CD 流水线中绑定生产环境的流水线数量" tone="orange" />
          </div>
        </section>
        <!-- Build & Deployment Metrics -->
        <section class="overview-section">
          <h2 class="overview-section__title">构建与部署指标</h2>
          <ApplicationDoraMetrics :deployments="productionDeployments" :pipeline-count="productionPipelines.length" :now="now" />
          <ApplicationActivityChart :builds="builds" :deployments="deployments" :now="now" />
          <ApplicationPipelineInsights :entries="entries" :environments="environments" :now="now" />
        </section>
      </div>
    </template>
  </div>
</template>
