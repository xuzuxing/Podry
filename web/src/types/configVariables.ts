export interface VariableConfiguration {
  values: Record<string, unknown>
  configmaps: Record<string, Record<string, unknown>>
}

/** 本地 Mock 的解析回执；历史必须与当次原始配置一起保存。Secret 不进入解析回执。 */
export interface ConfigVariableSnapshot {
  source: VariableConfiguration
  resolved: VariableConfiguration | null
  variableNames: string[]
  error: string
}
