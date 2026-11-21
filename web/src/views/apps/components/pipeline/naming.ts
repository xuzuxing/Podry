/**
 * Devtron 风格的流水线显示名。
 *
 * Devtron 的 workflow / CI 名为 `<前缀>-<数字应用号>-<4 位随机串>`（如 wf-4-lxij、ci-4-8m9v）。
 * Podry 的流水线主键是 UUID，没有数字应用号，因此这里由应用 ID 派生一个稳定短号；
 * 同一应用在「构建发布」画布与「配置 → 工作流」中显示同一个名字，刷新不跳变。
 */

/** 稳定 4 位后缀（小写字母 + 数字），与 Devtron 的随机串形式一致 */
export function devtronSuffix(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let value = hash
  let result = ''
  for (let i = 0; i < 4; i += 1) {
    result += alphabet.charAt(value % alphabet.length)
    value = Math.floor(value / alphabet.length)
  }
  return result
}

/** 由应用 ID 派生的稳定短号（1–90），仅用于显示 */
export function devtronAppNumber(appId: string): number {
  let hash = 7
  for (let i = 0; i < appId.length; i += 1) hash = (hash * 33 + appId.charCodeAt(i)) >>> 0
  return (hash % 90) + 1
}

/** wf-<appNumber>-<suffix> */
export function workflowDisplayName(appId: string, seed: string): string {
  return `wf-${devtronAppNumber(appId)}-${devtronSuffix(`${seed}:wf`)}`
}

/** ci-<appNumber>-<suffix> */
export function ciDisplayName(appId: string, pipelineId: string): string {
  return `ci-${devtronAppNumber(appId)}-${devtronSuffix(pipelineId)}`
}
