# 发布结果人工核对

日期：2026-11-21。本文是发布 unknown 人工核对的首批实施合同；后续资源 Apply/动作只读人工核对见 [资源核对](27-resource-reconciliation.md)，无证据强制解锁仍未开放。真实 CI/CD 继续暂缓。

## 调用与结果

先读取 `GET /api/deployments/{deploymentId}` 的 `revision`，再调用：

```http
POST /api/deployments/{deploymentId}/reconcile
Authorization: Bearer <token>
Idempotency-Key: manual-reconcile-001
Content-Type: application/json

{"expectedRevision":1,"reason":"恢复后核对远端实际结果"}
```

同步返回 200，包含 deploymentId、revision、status、helmRevision、errorCode、checkedAt 和 targetReleased。checkedAt 使用数据库时间；200 表示核对完成，不保证发布成功。理由去除首尾空白后为 1–1000 字符，仅参与幂等指纹；审计保留理由字符数，不保存自由文本，避免秘密进入审计。

- 仅允许已经持久提交意图的 submitting/observing/unknown；queued 和终态返回 409 deployment_not_reconcilable。
- expectedRevision 必须为正数且与当前部署一致，否则 409 revision_conflict。
- 有效 Worker 租约或行正被领取时返回 409 deployment_reconciliation_busy，不抢租约、不等待外部调用完成。
- 使用既有 Helm Observe，只读核对发布身份、首个 Helm revision、根 UID、镜像和工作负载状态；不调用 Submit、不创建新发布、不打开平台 Vault 中的运行时 Secret 历史版本。Helm SDK 仍需读取发布存储，根 Secret 的身份也需要读取；其中 Values/数据不进入响应、审计或本地观察记录。
- 确认 succeeded/failed 时原子更新请求、资源身份、当前成功指针和目标占用；只有 succeeded 推进成功指针。observing/unknown 继续占用目标。
- Helm 不存在、pending、failed、revision/UID/镜像冲突及远端读取失败仍为 unknown。超时只适用于已经确定 Helm deployed 且观察为 progressing 的发布，沿用既有发布超时规则；时间流逝不能单独消除 unknown。
- 全部后台开关关闭时仍可明确发起只读核对；不会启用 Worker。observing 可以再次核对，直至证据明确。

## 授权与并发

当前操作者必须登录有效，拥有应用 deploy、所有冻结资源的 resource.write 和 resource.view、Helm 存储 Secrets 的 view/write；Job 另需 pods 的 resource.view。不要求操作者是原发布者，也不继承原发布者权限。归档应用拒绝新核对。

核对使用当前绑定的同一物理目标和集群当前连接凭据，历史发布快照、Chart、镜像和 Secret 引用保持不变。准入及最终事务都重新检查用户、团队/项目、归档、完整目标授权、绑定、部署 revision/fencing/租约、资源 UID 基线及凭据版本。凭据或绑定在读取期间变化返回 409，不提交迟到结果。

数据库锁不跨网络读取；单次远端读取最多 20 秒。初始事务只获取只读快照，不持有租约。最终事务以部署 revision、状态、有效租约和目标 fencing CAS 收敛，并增加 revision，阻止旧 Worker 结果覆盖。并发核对可能重复只读 GET；同一幂等键只提交一个结果和一条审计。不同键的迟到结果返回 409。

同键同请求原样重放已保存响应，重放仍检查当前操作者、应用与冻结资源权限；不依赖执行器、解密密钥或集群在线。相同键不同请求返回 409 idempotency_conflict。失败事务不保留幂等记录或半条状态。请求中断、服务退出或崩溃不改变原提交意图与目标占用，之后可安全重新核对。

## 数据与验证边界

复用现有 deployments、deployment_resources、release_requests、deployment_targets、idempotency_records 和 audit_events，不新增表或迁移；正式版本仍是 v17、36 张业务表。恢复时保留以上记录及原始 fencing/revision，不直接改 SQL 清除占用。最小服务角色沿用原有权限。

本批测试与最终结果记录在根 [开发进度](../../DEVELOPMENT_PROGRESS.md)。隔离 PostgreSQL、HTTPS fixture 与 SDK fake 只验证业务合同，不能代表真实 Helm/Kubernetes、前后端联调或 CI/CD/B6 验收。

首次专项发现首次响应与 JSONB 重放的属性顺序不同，已改为首次也返回同事务内保存的规范表示，支持字节一致重放。最初本机编译还清理了未使用的测试 import 和遗漏的测试辅助引用；不将失败记录作为通过结果。

Job 完成最初被判为 observing。起初通过给列表条目补齐 TypeMeta 修正夹具；后续核对项目锁定的 apimachinery v0.35.1 的 `unstructured/helpers.go:decodeToList`，确认标准 PodList 可以省略每项的 apiVersion/kind，原观察器的结构体解码不兼容该合法响应。最终改用 UnstructuredList 按列表类型补齐 Pod 身份，同时明确校验 v1/PodList、v1/Pod、分页、UID、OwnerReference、镜像与 Succeeded；未放宽归属条件。集成夹具恢复为省略条目 TypeMeta 的合法 PodList，并增加 SDK 单元测试验证推断身份成功、显式非 Pod 不能冒充成功。先前专项和第一次全量发生在该修正前，最终版本重新完整验证，结果以根进度最终记录为准。

随后“运行时 Secret 密钥不可用”夹具试图删除不可变版本，被既有数据库保护正确拒绝。已改为保留所有历史、以另一密钥追加当前集群连接版本，并使用无法解密运行时 Secret 的服务完成核对；没有修改不可变约束。最终专项及全量结果见根进度。

列表修正前的全量为 160 个顶层、105 个子用例通过，1 个真实集群用例跳过。修正后的首次重跑在 Linux 服务编译阶段中断，尚未执行集成断言，PowerShell 只保留错误首行，不能据此确定根因。随后单独 Linux 服务构建通过；本工作树的 `web/dist` 同期有外部构建更新，而后端编译通过 go:embed 依赖其当时产物，但没有足够错误证据认定中断一定由此前端更新导致。本批没有构建或修改前端。最终完整验证另行重跑，准确结果和日志见根进度。
