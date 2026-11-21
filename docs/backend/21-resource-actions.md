# 资源删除、重启与扩缩容

日期：2026-11-21。E07 提前实现业务与模拟执行路径，正式迁移 v13，仍为 30 张业务表。OpenAPI V1.15.0 共 76 个操作，72 implemented / 4 planned。沿用资源 Worker，默认关闭，真实集群验收独立进行。

## 调用和影响确认

`POST /api/clusters/{clusterId}/resource-actions` 必须携带 Idempotency-Key，返回 202 ResourceOperation。通过 `GET /api/resource-operations/{operationId}` 查询进度。请求示例：

```json
{
  "action": "scale",
  "ref": {
    "group": "apps", "version": "v1", "resource": "deployments",
    "namespace": "demo", "name": "podry-demo",
    "uid": "the-current-object-uid", "resourceVersion": "12345"
  },
  "replicas": 2
}
```

先读取目标并展示动作、名称、命名空间、当前 UID/版本和期望副本等影响，再提交完整 ref。提交的 UID/resourceVersion 即本次影响确认条件；接口不创建额外确认票据，也不自动替换过期条件。核心组使用空 group。命名空间对象必须明确 namespace，集群级对象禁止 namespace；Discovery 精确检查 GVR、作用域、Kind 与 get/delete/update 能力，不接受任意 subresource 或 shell 命令。

| action | 权限 | 执行和完成边界 |
| --- | --- | --- |
| delete | 同目标 resource.view + resource.delete，无须 resource.write | 发送一次带 UID 与 resourceVersion preconditions 的 DeleteOptions；propagationPolicy 支持 Foreground、Background、Orphan，省略默认 Background；GET 确认原 UID 不再存在才完成 |
| restart | 同目标 resource.view + resource.write | 仅 apps/v1 Deployment；在 Pod template 写 restartedAt 与本操作唯一标记，用冻结 UID/RV 的 PUT；不等待 rollout 健康 |
| scale | 同目标 resource.view + resource.write | 仅 apps/v1 Deployment；replicas 必须为 0–2147483647 整数，允许缩容到 0；在读取对象上修改 replicas，使用冻结 UID/RV 的 PUT；不等待副本就绪 |

每次动作仅针对一个对象，不批量删除或按标签选择。只允许 scale 提供 replicas，只允许 delete 提供 propagationPolicy。正在删除的资源拒绝新增动作。旧 UID、旧版本或同名替换在入队及发送前检查；远端请求仍携带 CAS 条件，以覆盖最后一次读取后的竞态。没有 force、清理 finalizer、强制终止或自动回滚。

## HPA 与发布冲突

scale 在准入和 Worker 发送前完整分页读取同 namespace 的 autoscaling/v2 HPA，按 scaleTargetRef 的 apps 组、Deployment Kind 和名称匹配。存在匹配项返回 409 resource_hpa_managed。列表失败、缺失、格式异常或超过分页预算返回 resource_hpa_unconfirmed，不把读取失败当作没有 HPA。集群执行凭据必须有相应 list 权限，平台调用者不额外获得 HPA 内容。restart 不改 replicas，允许与 HPA 共存；delete 显式确认整个资源删除，不隐式删除 HPA。

平台内动作与 Helm 发布采用保守的命名空间范围互斥：

- 动作入队和持久意图事务检查同集群/namespace 的活动目标与 queued/submitting/observing/unknown Deployment，存在时返回 resource_release_busy。集群级删除检查整个集群。
- 发布的目标验证事务检查同 namespace（或集群级）的 queued/running/unknown 资源动作，存在时返回 resource_action_busy。晋级、回滚和新目标验证复用同一入口。
- 两侧短事务使用相同 cluster 行锁稳定准入顺序，网络 I/O 不持数据库锁。unknown 动作持续阻止冲突发布，不能靠租约过期绕开。

该规则比按单对象匹配更保守，也不依赖可修改的 Helm 标签。它只覆盖本平台通过现有服务准入的新发布和 E07 动作；E06 通用 Apply、外部 kubectl/Helm、其他控制器没有纳入这一排他协议。HPA 创建/修改与写入之间仍有分布式窗口，Kubernetes 不提供与 HPA 列表原子提交的条件；CAS 不能消除所有外部写入竞争。

## 异步、恢复与审计

复用 [资源写入](20-resource-writes.md) 的加密快照、lease/revision、持久 running 意图和逐项状态。发送一次后，响应丢失、超时、无效响应或进程退出均转 unknown，只读取核对，不再次发送 delete、restart 或 scale。旧租约 Worker 无法提交状态。

restart/scale 必须匹配原 UID、操作签名标记与规范化预期内容才确认成功；正常写入响应也验证冻结动作的内容。准入注入或控制器更改业务字段可能使其保持 unknown。成功仅表示请求的资源变更已确认，不表示 Pod 完成重建或副本已经健康。

delete 仅在 GET 404 或同名对象已是另一 UID 时确认原目标已消失，绝不删除替换对象。对象仍存在，包括处于 deletionTimestamp/finalizer 等待阶段，保持 unknown，后续只读核对；HTTP 200/202 或 Status Success 本身不算删除完成。Foreground/Background/Orphan 的后代处理由 Kubernetes 决定，本接口不逐一验收后代是否消失，也不证明删除由本次请求独立造成。

快照包括读取的 Deployment 内容，因此沿用 Vault 加密，安全投影和审计不包含环境变量、Manifest 或远端错误正文。审计动作分别为 resource.delete/restart/scale 及其 .intent/.result，带 cluster scope、原始资源引用和本地安全状态。

同键同输入返回首次接收快照，GET 返回当前进度；重放无需网络/解密或执行开关，但重验拥有者和当前目标的动作权限。其他用户（包括其他管理员）查询返回 404。已轮换凭据、撤权或禁用用户阻止尚未发送的项；已持久发送意图无法证明结果时继续 unknown。缺少明确证据不会被自动置为失败并释放冲突范围。

## 数据库、运行与验证

新增 `000013_resource_actions`：apply 仍必须引用唯一且同用户/集群的 preview；delete/restart/scale 必须没有 preview。身份和密文保持不可变，沿用同一查询/Worker/安全状态表。不增加业务表或服务角色 DDL 权限；有动作历史时拒绝 v13 降级，只有 Apply 历史时可回到 v12，v12 自身的历史保护仍生效。启动要求干净 v13，只能显式迁移。

`PODRY_RESOURCE_WRITES_ENABLED=false` 仍为默认值。构建、发布和资源三个 Worker 均未开启。本批不迁移开发数据库、访问真实 Git/Registry/Kubernetes、修改根 web/ 或根 README，也不提交代码。

测试使用隔离 PostgreSQL 和本机 HTTPS fixture，覆盖三个动作、零副本、严格输入与身份/权限、远端 CAS、HPA 准入及执行前变化、响应丢失/新 Worker、finalizer/替换 UID、旧租约 fencing、并发幂等、离线重放、默认关闭、撤权/轮换、最小数据库角色和双向发布冲突。具体最终结果见 [开发进度](../../DEVELOPMENT_PROGRESS.md)，不能当作真实集群执行或 CI/CD 验收。

后续仍包括 E08 人工修改与漂移记录、E02 Webhook 与自动触发业务、E09 Secret reveal/终端、unknown 人工处置、通用 Apply 排他和后台健康观察；真实 CI/CD 与 B6 的验收条件保持不变。

最终全量验证：114 个顶层集成用例、44 个子用例通过，1 个真实集群用例跳过；单元测试、sqlc/合同生成一致性、文档与 Compose 配置检查通过。上述均为隔离验证；首轮发现的测试设置和历史降级顺序问题及修正经过保留在开发进度中。

后续增量已提供显式 [资源人工核对](27-resource-reconciliation.md)，可在后台关闭时核对 delete/restart/scale；需要原拥有者当前完整动作权限、操作 revision 和幂等键。finalizer 未完成继续 unknown，同名新 UID 只证明原删除目标消失，不操作新对象；无证据强制解锁仍未开放。
