<script setup lang="ts">
import { shallowRef } from 'vue'
import ErrorState from '@/components/ErrorState.vue'
import MetricCard from '@/components/overview/MetricCard.vue'
import InfrastructureHealthCards from '@/components/overview/InfrastructureHealthCards.vue'
import OverviewEmptyState from '@/components/overview/OverviewEmptyState.vue'
import OverviewDistribution from '@/components/overview/OverviewDistribution.vue'
import ClusterResourceAllocation from '@/components/overview/ClusterResourceAllocation.vue'
import { useInfraManagementOverview } from '@/composables/useInfraManagementOverview'
import '@/components/overview/management-overview.css'

const { loading, error, warnings, rows, nodes, reachable, unreachable, totalNodes, unknownNodes, cpuCapacity, memoryCapacity, healthParts, schedulingParts, nodeErrors, clusterDistribution, nodeDistribution, updatedAt, load } = useInfraManagementOverview()
const clusterGroup = shallowRef<'provider' | 'version'>('provider')
const nodeGroup = shallowRef<'cluster' | 'autoscaler'>('cluster')
</script>

<template>
  <div class="management-overview infrastructure-management-overview" :aria-busy="loading">
    <div v-if="loading" class="overview-skeleton" role="status" aria-label="加载基础设施概览"><div><div class="overview-skeleton__title" /><div class="overview-grid"><div v-for="card in 3" :key="card" class="overview-skeleton__card" /></div></div><div><div class="overview-skeleton__title" /><div class="overview-grid"><div v-for="card in 3" :key="card" class="overview-skeleton__panel" /></div></div><div class="overview-skeleton__panel" /></div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />
    <OverviewEmptyState v-else-if="!rows.length || !reachable.length" title="暂无可用集群" :description="rows.length ? '已添加的集群当前均无法连接，请检查连接配置后重试。' : '尚未添加集群，请先添加集群。'" icon="server" class="infra-empty"><router-link :to="{ name: rows.length ? 'clusters' : 'settings-clusters' }" class="infra-empty__action">{{ rows.length ? '查看集群' : '添加集群' }} <t-icon name="arrow-right" /></router-link><button class="overview-icon-button" aria-label="刷新基础设施概览" @click="load"><t-icon name="refresh" /></button></OverviewEmptyState>
    <template v-else>
      <div v-if="unreachable" class="overview-notice" role="status"><t-icon name="info-circle" size="20px" /><p><strong>资源统计不包含无法连接的集群</strong>部分集群连接失败，其资源数据未计入统计。</p><router-link :to="{ name: 'clusters', query: { status: 'unreachable' } }">查看无法连接的集群 <t-icon name="arrow-right" /></router-link></div>
      <div v-for="notice in warnings" :key="notice" class="overview-notice" role="status"><t-icon name="info-circle" /><p>{{ notice }}</p></div>
      <div class="management-overview__body">
        <section class="overview-section">
          <div class="overview-section__heading"><h2 class="overview-section__title">资源总览</h2><div class="infra-updated"><span>更新于 {{ updatedAt }}</span><button class="overview-icon-button" aria-label="刷新基础设施概览" title="刷新数据" @click="load"><t-icon name="refresh" size="18px" /></button></div></div>
          <div class="overview-grid">
            <MetricCard icon="server" title="可连接集群" :value="reachable.length" hint="连接正常的集群数量，不包含连接失败或未检测的集群" :to="{ name: 'clusters' }" tone="purple" />
            <MetricCard icon="cpu" title="CPU 总容量" :value="cpuCapacity" :unit="cpuCapacity === '—' ? '' : '核'" hint="可连接集群的 CPU 容量总和" tone="teal" />
            <MetricCard icon="data" title="内存总容量" :value="memoryCapacity" :unit="memoryCapacity === '—' ? '' : 'GiB'" hint="可连接集群的内存容量总和" />
          </div>
        </section>
        <section class="overview-section">
          <h2 class="overview-section__title">集群与节点</h2>
          <InfrastructureHealthCards :rows="rows" :nodes="nodes" :health-parts="healthParts" :scheduling-parts="schedulingParts" :node-errors="nodeErrors" :unknown-nodes="unknownNodes" :total-nodes="totalNodes" />
          <OverviewDistribution title="集群数量分布" :rows="clusterDistribution[clusterGroup]" unit="集群数量（个）">
            <template #tabs><div class="overview-tabs" role="tablist" aria-label="集群分组方式"><button role="tab" :aria-selected="clusterGroup === 'provider'" @click="clusterGroup = 'provider'">按云厂商</button><button role="tab" :aria-selected="clusterGroup === 'version'" @click="clusterGroup = 'version'">按集群版本</button></div></template>
          </OverviewDistribution>
          <ClusterResourceAllocation :rows="reachable" />
          <OverviewDistribution title="节点数量分布" :rows="nodeDistribution[nodeGroup]" unit="节点数量（个）">
            <template #tabs><div class="overview-tabs" role="tablist" aria-label="节点分组方式"><button role="tab" :aria-selected="nodeGroup === 'cluster'" @click="nodeGroup = 'cluster'">按集群</button><button role="tab" :aria-selected="nodeGroup === 'autoscaler'" @click="nodeGroup = 'autoscaler'">按自动扩缩容工具</button></div></template>
          </OverviewDistribution>
          <p v-if="nodeGroup === 'autoscaler'" class="overview-note">根据节点显式标签识别 Karpenter / Cast AI；无匹配标签显示“未检测到”，缺失节点详情显示“未知”。</p>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.infra-updated{display:flex;align-items:center;gap:8px;color:var(--tk-text-3);font-size:11px}.infra-empty{min-height:calc(100dvh - 80px)}.infra-empty__action{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;margin-top:8px;border-radius:4px;background:var(--tk-primary);color:#fff}
</style>
