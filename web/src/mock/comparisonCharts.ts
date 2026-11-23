import type { ChartConfig } from '@/types'
import type { ComparisonChartDefault } from '@/types/configComparison'

/** 前端演示目录，与现有模板选择器一致；不是 Helm 仓库或 Devtron Chart 历史。 */
export function comparisonChartDefaults(chart: ChartConfig | null): ComparisonChartDefault[] {
  if (!chart) return []
  return ['1.4.0', '1.2.0'].map(chartVersion => ({
    id: `chart:${chart.workloadKind}:${chartVersion}`,
    chartConfig: { workloadKind: chart.workloadKind, chartVersion },
    values: chart.workloadKind === 'Deployment'
      ? { replicaCount: 1, containerPort: 8080, env: {} }
      : { env: {}, job: { backoffLimit: 6, activeDeadlineSeconds: 600 } },
  }))
}
