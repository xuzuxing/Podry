import type { AppConfig, Binding, ChartConfig, ConfigMapEntry, Deployment, DeployValues, Environment, SecretEntry } from '@/types'
import type { ConfigVariableSnapshot } from './configVariables'

/** 前端 Mock 对比目录，不代表服务端的配置发布或审批版本。 */
export interface ConfigComparisonCatalog {
  applicationName: string
  chartDefaults: ComparisonChartDefault[]
  config: AppConfig
  bindings: Binding[]
  environments: Environment[]
  configMaps: ConfigMapEntry[]
  secrets: SecretEntry[]
  deployments: Deployment[]
  variableSnapshots?: Record<string, ConfigVariableSnapshot>
}

export interface ComparisonChartDefault {
  id: string
  chartConfig: ChartConfig
  values: DeployValues
}
export type ComparisonResourceType = 'deployment' | 'configmaps' | 'secrets' | 'manifest'
export interface ComparisonSelection { environment: string; version: string }
export interface ComparisonDocument {
  values: Record<string, unknown>
  configmaps: Record<string, Record<string, unknown>>
  secrets: Record<string, Record<string, unknown>>
}
export interface ComparisonSide {
  label: string
  document: ComparisonDocument | null
  error: string
  notice: string
  deploymentId?: string
  variableSnapshot?: ConfigVariableSnapshot
  manifestContext?: {
    chartConfig: ChartConfig | null
    target: Binding['target'] | null
    workloadName: string
    /** 当前配置和 Chart 默认值没有固定镜像；历史只取对应发布的引用。 */
    imageRef: string | null
  }
}
export interface ComparisonOption { label: string; value: string }
export interface ComparisonFile {
  key: string
  type: ComparisonResourceType
  name: string
  label: string
  changed: boolean
  added: boolean
  removed: boolean
}
