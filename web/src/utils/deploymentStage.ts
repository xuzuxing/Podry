import type { CDDefinition, DeploymentStageSettings } from '@/types'

export function deploymentStageOf(definition: CDDefinition, stage: 'pre' | 'post'): DeploymentStageSettings {
  const trigger = stage === 'pre' ? definition.preStageTrigger : definition.postStageTrigger
  const runInEnvironment = stage === 'pre' ? definition.runPreStageInEnv : definition.runPostStageInEnv
  return {
    trigger: trigger === undefined ? 'auto' : trigger,
    runInEnvironment: runInEnvironment === undefined ? false : runInEnvironment,
  }
}

/** UI 和 Mock 保存共用；worker 不可用时保留已保存的选择，要求明确修正。 */
export function deploymentStageErrors(settings: DeploymentStageSettings, workerEnabled: boolean): string[] {
  const errors: string[] = []
  if (!['auto', 'manual'].includes(settings.trigger)) errors.push('请选择自动或手动触发')
  if (typeof settings.runInEnvironment !== 'boolean') errors.push('执行环境开关必须为布尔值')
  else if (settings.runInEnvironment && !workerEnabled) errors.push('目标环境未配置部署 worker，请关闭在应用环境执行')
  return errors
}
