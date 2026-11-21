# 资源 Apply 与动作人工核对

日期：2026-11-21。复用 v17、36 张业务表，无新增迁移。真实 CI/CD 继续暂缓；本接口只读访问远端，不启用任何后台执行器。

## 调用与结果

先读取 `GET /api/resource-operations/{operationId}` 返回的新增 `revision`，再调用：

Apply/动作接收接口的历史幂等重放继续返回原始接收快照，旧记录可能没有 revision；即使包含 revision，也不能代替 GET 的当前版本。核对接口自身的重放同样表示首次核对结果，后续进度仍须重新 GET。

```http
POST /api/resource-operations/{operationId}/reconcile
Authorization: Bearer <token>
Idempotency-Key: resource-manual-check-001
Content-Type: application/json

{"expectedRevision":4,"reason":"恢复后核对远端实际结果"}
```

返回 200 和 `operationId/revision/status/items/checkedAt`；`checkedAt` 来自最终事务的数据库时间，响应 `Cache-Control: no-store`。200 表示此次核对已保存，不保证操作成功。操作结果只包含安全 ref、逐项状态和本地错误码，不回传 Manifest、Secret 值或签名标记。

- 允许 running/unknown 且至少一项已有 running/unknown 持久提交意图；queued、终态或只有 pending 项返回 409 resource_operation_not_reconcilable。
- expectedRevision 必须为正数；过期版本返回 409 revision_conflict。有效 Worker lease 或行正在领取时返回 409 resource_reconciliation_busy，不抢租约。
- 每次读取预算 20 秒，先确认 Discovery 的类型、作用域和 get，再复用 Worker 的观察规则。Apply/create/update、restart/scale 需要冻结 UID（已知时）、操作签名和规范化内容匹配；不会仅凭同名或内容相似确认成功。
- delete 仅确认原 UID 消失，404 或同名新 UID 可确认原对象已删除；仍存在的原 UID、包括正在等待 finalizer 的原对象，保持 unknown。Discovery 不完整不能把资源路径 404 当作删除证据。
- 对没有发出的 pending 项只标记 skipped，不访问或继续提交，即使原 stopOnError=false。已明确的逐项终态保持不变。已确认项加 skipped/failed 可形成 partial；未解决项始终使整项操作保持 unknown。
- 读取失败、错误身份、签名不匹配、内容变化、错误 Type/UID 或缺少证据均保存安全 resource_outcome_unknown。不会再次执行 POST/PUT/DELETE、创建新操作或解除未确认的冲突占用。成功只代表对应写入已被观察确认，不代表工作负载健康。

## 权限、密钥与凭据

沿用原操作查询边界：只能由原请求拥有者发起，其他用户包括其他管理员返回 404。当前账号必须有效；所有冻结目标都必须仍有 resource.view 和对应动作权限：delete 为 resource.delete，其余为 resource.write。集群、团队/项目成员和 grant 在准入与最终事务重验，不使用原请求人历史权限代替当前权限。

新核对需要解密原操作加密计划，使用当前集群连接凭据；可在凭据轮换或原会话退出后，由同一用户的新有效会话显式恢复。冻结物理 API 地址不变；不会重建预览、替换原计划或改变操作归属。与 Worker 自动恢复要求原 stamp 相比，这是当前用户重新授权的一次只读操作。新核对没有原计划密钥时返回 503 resource_snapshot_unavailable；签名派生依赖原 JWT_SECRET，签名无法确认时保留 unknown，不能降低校验。

同键同请求返回首次持久结果，重放仍要求当前账号、拥有者和全部目标权限；无需密钥、网络或执行开关。相同键不同理由/版本/路径返回 409 idempotency_conflict。reason 去除首尾空白后须 1–1000 字符，仅参与幂等指纹；审计保存字符数，不保存理由原文。

## 事务与恢复

网络在两段短事务之间，不持有数据库锁或新租约。准入按账号、团队、项目、集群顺序稳定权限，再以 SKIP LOCKED 锁操作并检查 revision/lease/提交意图。最终同样重验权限、当前凭据版本、集群地址、grant 指纹和操作 revision；有竞争 Worker、新核对或中途凭据/授权变化时拒绝迟到结果。

最终状态、逐项 ref/错误、revision 增量、完成时间、过期 lease 清理、重试时间、审计及幂等结果在同一事务提交，失败整体回滚。只有证据明确的终态会结束 existing resource action 的 namespace 占用；unknown 继续阻止冲突发布。首次响应也读取 JSONB 持久表示，保证与重放字节一致。同键并发只产生一条结果和审计，不同键迟到返回 409。

请求取消、服务停机或网络读取未完成时保留原意图，之后可重新读取 revision 再核对。恢复仍须隔离旧实例、保留数据库历史、加密密钥和 JWT_SECRET；人工核对不能撤回已经在途的外部请求，也不能作为旧实例隔离的替代。无证据强制解锁、跨通用 Apply/Helm 的新增目标排他和多副本兼容验收仍待后续。

不新增表或服务角色权限；沿用 resource_operations、idempotency_records 和 audit_events。测试使用隔离 PostgreSQL、本机 HTTPS fixture；验证结果见根 [开发进度](../../DEVELOPMENT_PROGRESS.md)，不代表真实 Kubernetes、CI/CD、前后端联调或 B6 验收。
