import type { Build } from '@/types'

export function historyStageEvent(stage: string, status: string, startTime = '', endTime = '', targetPlatforms: string[] = []): string {
  return `STAGE_INFO|${JSON.stringify({ stage, status, startTime, ...(endTime ? { endTime } : {}), metadata: { targetPlatforms } })}`
}
/** Mock boundaries describe this local fixture; no historical phase timings are inferred. */
export function buildHistoryLogFixture(build: Build, lines: string[]): string[] {
  const source = lines.findIndex(line => line.startsWith('[source]'))
  const buildStart = lines.findIndex(line => line.startsWith('[buildkit]'))
  const exportStart = lines.findIndex(line => line.includes('#8 exporting'))
  const status = build.status === 'succeeded' ? 'Success' : build.status === 'failed' ? 'Failure' : build.status === 'running' || build.status === 'canceling' ? 'Progressing' : build.status
  if (buildStart < 0 || source < 0) return [historyStageEvent('准备构建', status), ...lines]
  const result = [historyStageEvent('准备构建', 'Success'), ...lines.slice(0, source), historyStageEvent('获取源码', 'Success'), ...lines.slice(source, buildStart)]
  const splitExport = exportStart >= 0 && build.status !== 'failed'
  result.push(historyStageEvent('构建镜像', build.status === 'succeeded' ? 'Success' : status, '', '', (build.buildConfigSnapshot?.platform ?? '').split(',').map(item => item.trim()).filter(Boolean)), ...lines.slice(buildStart, splitExport ? exportStart : undefined))
  // Long completed history exercises virtual rendering through the normal UI.
  if (build.id === 'bd-1011') {
    for (let index = 1; index <= 1800; index++) {
      const name = `module-${String(index).padStart(4, '0')}`
      result.push(`\x1b[36m[compile:mock]\x1b[0m ${name} ${index === 900 ? 'src/application/history/'.repeat(32) : 'compiled'} \x1b[32mOK\x1b[0m`)
    }
  }
  if (splitExport) result.push(historyStageEvent('推送镜像', status), ...lines.slice(exportStart))
  return result
}
