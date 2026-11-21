# 资源变更预览与提交

日期：2026-11-21。提前实现 E06，新增正式迁移 v12 的 resource_previews/resource_operations，两张表使正式业务表达到 30 张。HTTP 合同 V1.14.0，共 76 个操作，71 implemented / 5 planned。真实集群验收仍需独立完成。

## 调用流程

| 接口 | 结果 |
| --- | --- |
| `POST /api/clusters/{clusterId}/resources/dry-run` | 200 ResourcePreview，含 previewId、expiresAt 及逐对象 valid/action/ref/diff/error |
| `POST /api/clusters/{clusterId}/resources/apply` | 必须携带 Idempotency-Key；202 ResourceOperation，持久接收后由 Worker 执行 |
| `GET /api/resource-operations/{operationId}` | 200 ResourceOperation，当前逐项状态、成功对象 UID/resourceVersion 及安全错误 |

预览请求示例：

```json
{
  "documents": [{
    "manifest": "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: podry-demo\n  namespace: demo\ndata:\n  message: hello\n"
  }]
}
```

确认请求示例：

```json
{"previewId":"a1000000-0000-4000-8000-000000000001","stopOnError":false}
```

配置 `PODRY_RESOURCE_WRITES_ENABLED=false` 为默认值。预览仍可调用，但会读取集群并发起 Kubernetes dry-run，需要有效凭据和集群可达；它不是离线语法检查。执行关闭时 Apply 返回 503 resource_execution_unavailable，不消费预览或创建任务；显式开启需配置凭据加密密钥。新开关独立于构建/发布 Worker，当前实现每实例一个资源 Worker。

## 文档、权限和版本

- documents 数量 1–50；每个元素为单个严格 YAML/JSON 对象，单文档最多 256 KiB、合计最多 768 KiB。HTTP JSON 请求仍受既有请求体上限约束。拒绝重复键、多文档字符串、List/generateName 和非法路径/名称；不自行拆分或猜测资源复数。
- 用 Kubernetes Discovery 将 apiVersion/kind 唯一映射至实际 GVR，确认作用域和 get/create/update verbs。命名空间对象必须明确 namespace；集群级对象禁止指定 namespace。同一个物理目标不可在预览中重复出现，包括不同 API 版本。
- 每个目标同时需要 resource.view 与 resource.write，分别按精确 GVR 和作用域检查。没有目标权限时不读取对象正文。Discovery 类型元数据可能先于具体作用域检查；非法或无权对象返回安全的逐项错误。预览期间发现授权/凭据变化时不保存该预览。
- 创建使用 POST。已有对象更新要求同时提供 expectedUid/expectedResourceVersion，或保留 metadata.uid/resourceVersion；显式字段与 metadata 冲突时拒绝。更新使用带冻结 UID/resourceVersion 的 PUT 完整替换，未包含字段可能被删除。它不使用 Server Side Apply、force 或补丁合并。
- 预览向集群发送 dryRun=All、fieldValidation=Strict，获取准入/默认处理后的对象。status、managedFields 等服务端字段不进入提交，保留业务字段；任意 CRD 整数在解析、快照和核对中保持精确，不转为 float64。
- 预览有效期 10 分钟，绑定创建用户、tokenVersion、集群 API 地址、凭据 ID/版本与资源授权指纹。确认前检查所有目标；入队事务再次锁定用户、团队/项目授权和集群后重验，原子消费预览、插入任务、幂等结果与审计。Worker 每项发送前再次检查授权、类型和目标身份。网络 I/O 不持有数据库事务锁。

预览中的逐项 invalid 不意味着 HTTP 请求失败；前端需检查 items[].valid。存在任意无效项时 Apply 返回 422 resource_preview_invalid。过期或已消费的资源预览返回 409；集群/授权/凭据变化返回 409 revision_conflict，UID/版本变化返回相应 409。客户端应保留草稿、重新读取并重新预览，不能替换前置条件后自动提交。

## 敏感数据与幂等

原始文档、准入后的预期内容和固定执行输入均通过既有 AES-GCM Vault 加密，AAD 绑定预览/操作域及 ID，密文带 key_id。API、数据库安全投影及审计只记录引用、状态和本地错误；不保存/回显 YAML、Secret、ConfigMap、CRD 字段值或原始准入错误。Diff 的 before/after 为 JSON 字符串，只含 added/removed/changed 字段路径；不是可重新 Apply 的 Manifest。既有 Secret 读取仍脱敏，不能将脱敏结果直接作为完整替换文档。

Apply 使用现有用户/operation/key 范围的幂等合同。同键同请求返回首次接收的 202 快照；同键不同输入返回 409。重放须仍为请求拥有者，并保有所有目标的当前读取/写入权限；不解密、不访问远端，允许执行器关闭、密钥暂不可用或原预览已被消费。前端用 GET 获取当前进度，不能把重放的 queued 快照视为退回队列。换键消费同一预览会被拒绝。

准入事务在锁定预览后查询幂等结果；最终消费事务也保持预览在幂等记录之前的锁顺序，等待期间另一请求完成入队时返回已提交结果，不将同键并发重放误报为预览已消费。消费/lease 的时间判断使用数据库当前时钟，避免事务开始时间滞后导致过期输入仍被接受。

任务 GET 同样要求原拥有者及所有目标的当前权限；其他用户（包括另一管理员）得到 404。集群审计沿用现有管理员可见规则，可按 clusterId 检索。本阶段没有增加 Secret reveal 权限或明文出口。

## 执行、部分失败和恢复

任务整体状态保留 queued/running/succeeded/failed/partial/unknown。逐项状态为 pending/running/unknown/succeeded/failed/skipped。Worker 通过 SKIP LOCKED 领取，lease 60 秒，每步最多 40 秒；每次推进使用 owner + revision + 未过期 lease 的 CAS。发送前先同事务落账 running 意图和审计，再发一次 POST/PUT。旧 lease owner 无法回写结果。

已知拒绝（如版本冲突、422 准入拒绝）记录 failed；stopOnError=false 时允许后续项继续，true 时跳过尚未提交项。已成功对象不自动回滚。只要有成功又有失败/跳过则最终 partial；全部失败为 failed。成功仅表示 API 写入确认，不代表 Deployment 健康或 Job 已完成。

传输错误、超时、无效响应等可能已产生远端写入，记录 unknown 并跳过所有剩余 pending 项。进程在持久意图之后退出也走相同恢复路径，绝不因 lease 到期重新发送。恢复每隔至少 5 秒读取对象，必须同时匹配：

1. 目标 GVR/name/namespace，以及更新操作原 UID。
2. 平台保留 annotation 中的 operationId/index 与以签名密钥计算的计划 HMAC。
3. 忽略 status、服务端元数据及保留 annotation 后，内容与准入预期精确一致。

`podry.io/resource-operation` 与 `podry.io/resource-plan` 为保留 annotation；用户输入中同名字段会移除并重新生成。核对无对象、同名替换、内容变化、标记丢失或授权/凭据不再匹配时继续 unknown，不猜测成功，也不补写。签名标记不是对抗集群管理员复制对象的证明：创建响应丢失且尚未记录 UID 时，拥有完整读取/创建权限的外部操作者若复制精确内容和有效标记，可能满足核对条件；更新还要求原 UID。准入非确定性、控制器立即变更业务字段也可能使结果长期 unknown。

授权检查与远端请求之间仍存在分布式时间窗口：已发送请求不能因随后撤权而撤回；后续项将重验并停止。已发送项的真实结果仍需保留。当前没有人工解除 unknown、撤销操作、业务历史 GC、跨 Apply/Helm 的分布式目标排他锁或分布式事务；版本/CAS 约束不等同于这些能力。

## 数据库与验证边界

正式迁移 `000012_resource_operations` 包含不可变输入/预览触发器、预览单次消费、任务与预览同集群/用户复合外键、状态与 lease 对约束。任何预览或任务历史都会阻止 v12 降级，避免静默丢失。启动必须匹配干净 v12，迁移只通过显式命令执行；本轮没有迁移开发数据库。

独立服务角色还需对两张新表拥有 SELECT/INSERT/UPDATE，并保留既有幂等表写入和审计 INSERT 权限；迁移所有者授予这些权限，服务角色仍无需 DDL 或审计删除权限。以下为部署示例，本轮没有对开发数据库执行：

```sql
GRANT SELECT, INSERT, UPDATE ON resource_previews, resource_operations TO podry_service;
```

测试使用隔离 PostgreSQL 与本机 HTTPS Kubernetes fixture，覆盖严格文档/作用域、加密与安全 Diff、创建/更新、UID/RV 竞态、部分失败/停止、幂等/拥有者权限、执行开关、撤权/轮换、响应丢失、重启及 lease fencing。最终验证结果见 [开发进度](../../DEVELOPMENT_PROGRESS.md)。不访问真实集群，不代表 Kubernetes 准入、真实 RBAC 或工作负载就绪验收。

E07 继续实现删除、Deployment 重启/扩缩容及 HPA 边界；E08 的应用漂移继续基于现有实时 Diff，不静默回写应用基础配置。真实 CI/CD 与 B6 保持独立待验收。

后续已补齐后台关闭时的显式人工只读核对：`POST /api/resource-operations/{operationId}/reconcile`，以当前拥有者权限、操作 revision 和幂等键核对持久意图，跳过 pending，不重发写入。完整语义和密钥/恢复边界见 [资源人工核对](27-resource-reconciliation.md)；本节此前的 Worker 恢复合同保持适用。
