import type { DeploymentStageType, StageRun, StageRunStatus } from '@/types'
import { historyStageEvent } from '@/mock/historyLogFixtures'

export const stageTitle = (stage: DeploymentStageType): string => stage === 'PRECD' ? 'Pre-deployment' : 'Post-deployment'
export const stageStatusLabel: Record<StageRunStatus, string> = { queued: '排队中', running: '运行中', succeeded: '成功', failed: '失败', canceled: '已取消' }
export const stageIsActive = (status: StageRunStatus): boolean => status === 'queued' || status === 'running'

/** 按经过时间推进本地示例；不执行任务，也不会自动触发部署或相邻阶段。 */
export function advanceStageRun(run: StageRun, now = Date.now()): void {
  if (!stageIsActive(run.status)) return
  const elapsed = now - Date.parse(run.createdAt)
  if (elapsed >= 30_000) {
    run.status = 'succeeded'
    run.finishedAt = new Date(Date.parse(run.createdAt) + 30_000).toISOString()
  } else if (elapsed >= 1000) run.status = 'running'
}

export function stageTaskStatus(run: StageRun, index: number, now = Date.now()): StageRunStatus {
  if (run.status !== 'running') return run.status === 'failed' && index > 0 ? 'queued' : run.status
  const activeIndex = Math.min(run.snapshot.tasks.length - 1, Math.floor(Math.max(0, now - Date.parse(run.createdAt)) / 30_000 * run.snapshot.tasks.length))
  return index < activeIndex ? 'succeeded' : index === activeIndex ? 'running' : 'queued'
}

export function stageTaskLog(run: StageRun, taskId: string, now = Date.now()): string {
  const index = run.snapshot.tasks.findIndex(task => task.id === taskId)
  const task = run.snapshot.tasks[index]
  if (!task) return ''
  const status = stageTaskStatus(run, index, now)
  return [
    historyStageEvent(task.name, status),
    '[Mock] 本地阶段运行示例：没有执行脚本、启动容器或连接 Kubernetes。',
    `Stage: ${stageTitle(run.stage)} / Task: ${task.name}`,
    `Image: ${run.snapshot.artifact.imageRepository}@${run.snapshot.artifact.digest}`,
    `Configuration: v${run.configVersion} / Workflow: v${run.workflowVersion}`,
    `Execution environment: ${run.snapshot.settings.runInEnvironment ? run.snapshot.target.namespace : 'default worker'}`,
    `Status: ${stageStatusLabel[status]}`,
    status === 'queued' ? '[Mock] 等待示例任务。' : status === 'running' ? '[Mock] 正在展示运行状态；没有真实任务输出。' : `[Mock] 示例状态已结束：${stageStatusLabel[status]}。`,
  ].join('\n') + '\n'
}
