import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { parse } from 'yaml'
import { getClusterOverview, getNodeDetail, listClusters, listResources } from '@/api'
import type { Cluster, ClusterOverview, NodeDetail } from '@/types'
import { overviewStatusLabel, parseQuantity } from '@/utils/managementOverview'
import type { ChartPart, DistributionRow } from '@/utils/managementOverview'

export interface InfraClusterRow { cluster: Cluster; overview: ClusterOverview | null }
export interface InfraNode { clusterId: string; clusterName: string; detail: NodeDetail }

export function useInfraManagementOverview() {
  const loading = shallowRef(true)
  const error = shallowRef('')
  const warnings = shallowRef<string[]>([])
  const rows = shallowRef<InfraClusterRow[]>([])
  const nodes = shallowRef<InfraNode[]>([])
  const updatedAt = shallowRef('')
  let generation = 0
  const reachable = computed(() => rows.value.filter(row => row.cluster.connectionStatus === 'connected'))
  const unreachable = computed(() => rows.value.length - reachable.value.length)
  const totalNodes = computed(() => reachable.value.reduce((sum, row) => sum + row.cluster.nodeCount, 0))
  const unknownNodes = computed(() => Math.max(0, totalNodes.value - nodes.value.length))
  const capacity = (resource: 'cpu' | 'memory') => {
    const values = reachable.value.map(row => parseQuantity(row.overview?.[resource].capacity ?? (resource === 'cpu' ? row.cluster.cpuCapacity : row.cluster.memoryCapacity), resource))
    return values.some(value => value === null) || !values.length ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  }
  const cpuCapacity = computed(() => { const value = capacity('cpu'); return value === null ? '—' : Number(value.toFixed(2)).toLocaleString() })
  const memoryCapacity = computed(() => { const value = capacity('memory'); return value === null ? '—' : Number((value / 2 ** 30).toFixed(2)).toLocaleString() })
  const healthParts = computed<ChartPart[]>(() => [
    { label: 'Healthy', value: reachable.value.filter(row => row.overview?.status === 'Healthy').length, color: '#34a66f' },
    { label: 'Unhealthy', value: reachable.value.filter(row => row.overview?.status === 'Unhealthy').length, color: '#e9aa27' },
    { label: 'Connection Failed', value: unreachable.value, color: '#e96560' },
    { label: 'Unknown', value: reachable.value.filter(row => !row.overview).length, color: '#b7c2cf' },
  ].filter(part => part.value > 0))
  const schedulingParts = computed<ChartPart[]>(() => [
    { label: 'Schedulable', value: nodes.value.filter(node => !node.detail.unschedulable).length, color: '#34a66f' },
    { label: 'Unschedulable', value: nodes.value.filter(node => node.detail.unschedulable).length, color: '#e96560' },
    { label: 'Unknown', value: unknownNodes.value, color: '#b7c2cf' },
  ].filter(part => part.value > 0))
  const nodeErrors = computed<ChartPart[]>(() => {
    const counts = new Map<string, number>()
    const labels: Record<string, string> = { NetworkUnavailable: 'Network Unavailable', MemoryPressure: 'Insufficient Memory', DiskPressure: 'Disk Pressure', PIDPressure: 'Insufficient PID', Ready: 'Kubelet Not Ready' }
    for (const node of nodes.value) for (const condition of node.detail.conditions.filter(condition => condition.haveIssue)) {
      const label = labels[condition.type] ?? 'Other Errors'
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return [...counts.entries()].map(([label, value], index) => ({ label, value, color: ['#c83a37', '#e65b54', '#f0887f', '#f5afa8'][index % 4]! }))
  })

  const clusterDistribution = computed(() => {
    const versions = new Map<string, number>()
    const providers = new Map<string, number>()
    for (const row of reachable.value) {
      const version = row.overview?.kubernetesVersion ?? row.cluster.serverVersion ?? 'Unknown'
      versions.set(version, (versions.get(version) ?? 0) + 1)
      // 只根据节点显式的 providerID 识别云厂商，不根据集群名称或生产标记猜测。
      const names = new Set(nodes.value.filter(node => node.clusterId === row.cluster.id).map(node => {
        try {
          const manifest = parse(node.detail.manifest)
          const id: unknown = manifest?.spec?.providerID
          if (typeof id !== 'string' || !id) return 'Not detected'
          const scheme = id.split('://')[0]?.toLowerCase()
          return ({ aws: 'AWS', gce: 'Google Cloud', azure: 'Azure', vsphere: 'VMware' } as Record<string, string>)[scheme ?? ''] ?? 'Other'
        } catch { return 'Not detected' }
      }))
      const provider = names.size === 1 ? [...names][0]! : names.size > 1 ? 'Mixed / Unknown' : 'Not detected'
      providers.set(provider, (providers.get(provider) ?? 0) + 1)
    }
    const convert = (map: Map<string, number>): DistributionRow[] => [...map.entries()].map(([label, value]) => ({ id: label, label: overviewStatusLabel(label), value }))
    return { version: convert(versions), provider: convert(providers) }
  })
  const nodeDistribution = computed(() => {
    const autoscalers = new Map<string, number>()
    for (const node of nodes.value) {
      const labels = node.detail.labels.map(label => label.split('=')[0])
      const name = labels.some(label => label?.startsWith('karpenter.sh/') || label?.startsWith('karpenter.k8s.aws/')) ? 'Karpenter'
        : labels.some(label => label?.startsWith('provisioner.cast.ai/')) ? 'Cast AI' : 'Not detected'
      autoscalers.set(name, (autoscalers.get(name) ?? 0) + 1)
    }
    if (unknownNodes.value) autoscalers.set('Unknown (details unavailable)', unknownNodes.value)
    return {
      cluster: reachable.value.map(({ cluster }): DistributionRow => ({ id: cluster.id, label: cluster.name, value: cluster.nodeCount, to: { name: 'cluster-workspace', params: { clusterId: cluster.id }, query: { resource: 'nodes', group: '' } } })),
      autoscaler: [...autoscalers.entries()].map(([label, value]) => ({ id: label, label: overviewStatusLabel(label), value })),
    }
  })

  async function load(): Promise<void> {
    const current = ++generation
    loading.value = true
    error.value = ''
    try {
      const clusters = await listClusters()
      const notices = new Set<string>()
      const nextRows: InfraClusterRow[] = []
      const nextNodes: InfraNode[] = []
      for (let offset = 0; offset < clusters.length; offset += 6) {
        if (current !== generation) return
        const batch = await Promise.all(clusters.slice(offset, offset + 6).map(async cluster => {
          if (cluster.connectionStatus !== 'connected') return { cluster, overview: null, nodes: [] }
          const [overview, resources] = await Promise.allSettled([getClusterOverview(cluster.id), listResources(cluster.id, { group: '', resource: 'nodes' })])
          if (overview.status === 'rejected' || resources.status === 'rejected') notices.add('部分集群的概览或节点数据读取失败，缺失值显示为“未知”。请刷新重试。')
          const details: InfraNode[] = []
          const items = resources.status === 'fulfilled' ? resources.value : []
          for (let i = 0; i < items.length; i += 8) {
            const results = await Promise.allSettled(items.slice(i, i + 8).map(item => getNodeDetail(cluster.id, item.ref.name)))
            for (const result of results) {
              if (result.status === 'fulfilled') details.push({ clusterId: cluster.id, clusterName: cluster.name, detail: result.value })
              else notices.add('部分节点详情读取失败，节点调度统计显示为“未知”。')
            }
          }
          return { cluster, overview: overview.status === 'fulfilled' ? overview.value : null, nodes: details }
        }))
        for (const item of batch) { nextRows.push({ cluster: item.cluster, overview: item.overview }); nextNodes.push(...item.nodes) }
      }
      if (current !== generation) return
      rows.value = nextRows
      nodes.value = nextNodes
      warnings.value = [...notices]
      updatedAt.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    } catch (err) {
      if (current === generation) error.value = err instanceof Error ? err.message : '加载基础设施概览失败'
    } finally { if (current === generation) loading.value = false }
  }
  onMounted(load)
  onBeforeUnmount(() => { generation++ })
  return { loading, error, warnings, rows, nodes, reachable, unreachable, totalNodes, unknownNodes, cpuCapacity, memoryCapacity, healthParts, schedulingParts, nodeErrors, clusterDistribution, nodeDistribution, updatedAt, load }
}
