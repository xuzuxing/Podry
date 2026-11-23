import type { GitCommit, GitMaterial, GitWebhookEvent } from '@/types'

/** 明确为本地接收事件示例，Payload 为归一化演示数据，不表示已收到远端通知。 */
export function mockWebhookEvents(appId: string, material: GitMaterial, commits: GitCommit[]): GitWebhookEvent[] {
  let repositoryHash = 2166136261
  for (const char of material.repositoryUrl) repositoryHash = Math.imul(repositoryHash ^ char.charCodeAt(0), 16777619)
  const prefix = `${appId}:${material.id}:${(repositoryHash >>> 0).toString(16)}`
  const examples = [
    { type: 'tag' as const, ref: 'v1.4.0', title: 'v1.4.0', values: { tag: 'v1.4.0', author: '李开发' } },
    { type: 'tag' as const, ref: 'v1.3.2', title: 'v1.3.2', values: { tag: 'v1.3.2', author: '王发布' } },
    { type: 'tag' as const, ref: 'experimental', title: 'experimental', values: { tag: 'experimental', author: '李开发' } },
    { type: 'pull_request' as const, ref: 'feature/order-split', title: '#42 支持订单拆分', pullRequest: { number: 42 }, values: { sourceBranch: 'feature/order-split', targetBranch: 'main', action: 'opened', author: '李开发' } },
    { type: 'pull_request' as const, ref: 'feature/order-split', title: '#42 支持订单拆分 · 更新提交', pullRequest: { number: 42 }, values: { sourceBranch: 'feature/order-split', targetBranch: 'main', action: 'synchronize', author: '李开发' } },
    { type: 'pull_request' as const, ref: 'release/1.x', title: '#39 修复发布分支', pullRequest: { number: 39 }, values: { sourceBranch: 'release/1.x', targetBranch: 'release/1.x', action: 'opened', author: '王发布' } },
  ]
  return examples.flatMap((example, index) => {
    const commit = commits[(index === 4 ? 3 : index) % commits.length]
    if (!commit) return []
    const id = `${prefix}:${example.type}:${index}`
    return [{ ...example, ...(example.pullRequest ? { pullRequest: { ...example.pullRequest } } : {}), id, commit: { ...commit, ...(commit.changedPaths ? { changedPaths: [...commit.changedPaths] } : {}) }, receivedAt: commit.committedAt,
      payload: { mock: true, delivery_id: id, event: example.type, repository: material.repositoryUrl, ref: example.ref, commit: commit.sha, ...example.values },
    }]
  })
}
