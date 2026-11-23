import type { AppConfig, Binding, ConfigMapEntry, DeploymentConfigSnapshot, SecretEntry } from '@/types'
import { effectiveValues } from './deploymentValues'
import { effectiveEntries } from './configEntries'
import { configDocument } from './configDocument'
import { captureConfigVariables } from './configVariables'

export function captureDeploymentConfig(config: AppConfig, binding: Binding, maps: ConfigMapEntry[], secrets: SecretEntry[], variables?: Readonly<Record<string, string>>): DeploymentConfigSnapshot {
  const baseMaps = maps.filter((item) => item.appId === config.appId && !item.environmentId)
  const ownMaps = maps.filter((item) => item.appId === config.appId && item.environmentId === binding.environmentId)
  const baseSecrets = secrets.filter((item) => item.appId === config.appId && !item.environmentId)
  const ownSecrets = secrets.filter((item) => item.appId === config.appId && item.environmentId === binding.environmentId)
  const snapshot = JSON.parse(JSON.stringify({
    source: 'trigger', capturedAt: new Date().toISOString(), baseValues: config.deployValues,
    values: effectiveValues(config.deployValues, binding), configMaps: effectiveEntries(baseMaps, ownMaps),
    secrets: effectiveEntries(baseSecrets, ownSecrets), target: binding.target, chartConfig: config.chartConfig,
  })) as DeploymentConfigSnapshot
  if (variables) snapshot.variableSnapshot = captureConfigVariables(configDocument(snapshot.values, snapshot.configMaps, snapshot.secrets), variables)
  return snapshot
}
