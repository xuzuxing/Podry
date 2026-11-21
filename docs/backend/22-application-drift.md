# E08 应用资源人工修改与漂移记录

日期：2026-11-21。业务实现基于 E06/E07 和 B5 的资源归属、脱敏与实时 Diff；不执行自动纠正，不将差异推回应用基础配置。本批只用隔离 PostgreSQL 和本机 HTTPS Kubernetes fixture 验证，真实 CI/CD 与 B6 尚未验收。

## 查询与刷新

新增 `GET /api/apps/{appId}/drift?bindingId=<uuid>`。默认仅查询数据库缓存和历史，不解密集群凭据、不访问 Kubernetes；可在三个 Worker 都关闭时使用。返回 `Cache-Control: no-store`。

显式添加 `refresh=true` 才向集群发起只读 GET，并记录本次比较。每次刷新独立记录，不要求 Idempotency-Key。非法 boolean 返回 422。没有当前成功发布基线时返回 `unknown/no_baseline`，不访问集群、不生成虚假记录。

响应字段：

| 字段 | 含义 |
| --- | --- |
| bindingId / baselineDeploymentId | 当前绑定及其 currentDeploymentId；没有成功基线时后者为 null |
| status | aligned / drifted / unknown；是当前投影结果，独立于应用健康 |
| reason | compared、read_failed、identity_changed、identity_unconfirmed、release_unsettled、resource_operation_pending、no_baseline、no_observation、stale |
| current | 仍有效的最新观察；过期、身份失效或存在未完成平台操作时为 null |
| history | 当前成功发布基线最近 20 次观察，按观察开始时间倒序；历史状态不代表现在仍然成立 |
| secretValuesCompared | 始终 false，不能依据 aligned 认定 Secret 值相同 |

每条观察只有 id、deploymentId、status、reason、resourceCount、changedCount、missingCount、observedAt。changedCount 是内容有差异的现存根资源数量，missingCount 是原 UID 对应名称返回 404 的数量，二者不重复。详情继续使用已授权的 `GET /api/deployments/{deploymentId}/diff`，该历史接口不会生成或更新漂移观察。

人工修改继续使用 E06 Manifest Dry Run/Apply 或 E07 删除、重启、扩缩容，并沿用其逐对象授权、UID/RV、幂等与审计。刷新不会自动触发这些操作，也不推断差异由哪个操作者造成。

## 基线、归属与比较边界

- 基线是绑定的当前成功执行及不可变发布快照，不是最新应用配置草稿，也不是任意历史执行。新发布成功切换指针后，查询切换到新基线的观察历史；旧基线记录仍受保留上限约束。
- 必须捕获快照中所有期望根的准确 UID。没有完整身份时为 unknown；不会借助标签收编同名资源。原根 404 算缺失差异，同名换 UID 算 unknown/identity_changed。
- 只比较内置 Chart 的期望根；ReplicaSet、Pod、历史执行残留和其他外部资源不计入数量，不把额外资源存在称为已对齐。
- 复用 B5 Diff 的确定性排序与投影：去除 status、UID/RV/generation/creationTimestamp、managedFields 和 last-applied 等记账字段。Secret 只比较元信息/type/排序后的键名，不比较值及 annotations。
- 非 Secret 的业务字段、标签和其他保留 annotations 参与比较。因此重启标记、扩容、默认字段、admission 注入也可能产生差异；没有三方合并或通用默认值忽略算法。
- aligned 仅表示本次已读取的投影根相同；不表示健康、Secret 值相等、未被外部随后修改或集群状态已收敛。多对象 GET 不构成 Kubernetes 原子快照，仍存在外部写入窗口。

## 权限、并发和失效

缓存、刷新及历史都要求 app.view 与当前基线每一种根资源的 resource.view 取交集。权限不足返回 404，并在解密和网络请求前拒绝；不会部分读取后声称 aligned。

数据库锁不跨网络。网络完成后重验用户、项目、资源授权、绑定、最新执行、当前成功执行、凭据版本和根 UID；期间撤权返回 404，身份变化返回 409，不保存失效观察。稳定输入下的上游失败只存 unknown/read_failed，避免旧 aligned 掩盖本次失败；不保存上游错误正文。

当前缓存有效期为观察开始时间起 60 秒。绑定版本、当前/最新执行与 revision、凭据版本、根 UID，以及平台资源操作数量/revision 改变均使旧观察失效。按开始时间排序，较早请求晚完成不会覆盖较新观察。

存在比当前成功基线更新的执行时，保守返回 unknown/release_unsettled，包括失败执行可能留下部分修改的情况。集群内任意 queued/running/unknown 平台资源操作均保守返回 unknown/resource_operation_pending，既包括 E07 动作也包括 E06 Apply；即使操作位于其他 namespace 也会暂时阻止比较。操作进入终态后必须重新刷新，不把操作成功直接映射为 aligned。外部 kubectl、Helm、HPA 等不会触发平台即时失效，仍依赖下次刷新或到期。

## 持久化与恢复

正式迁移 v14 新增 application_drift_observations，当前共有 31 张业务表。只保存绑定/基线身份、不可逆版本身份摘要、枚举、数量与时间，不保存 Manifest、字段路径、字段值或值摘要，避免低熵 Secret/环境变量值进入数据库。身份摘要只覆盖绑定、执行、凭据版本、根 UID 及平台操作版本信息。

每次刷新事务内插入并按开始时间裁剪为每绑定最近 100 条；读取只返回当前基线最近 20 条。没有后台轮询或无限增长的观察队列。历史数量有明确上限，不提供全量历史分页或跨基线查询；审计中的人工修改记录按原合同保留。

恢复必须使用匹配干净 v14 的二进制/数据库；备份包含观察表，但恢复后的记录仍须通过身份和 60 秒有效期检查。没有观察时允许 v14→v13；存在记录时拒绝降级，避免静默丢失历史。不要为降级随意删除记录。三个 Worker 的默认开关保持关闭。

## 验证边界

集成测试复用本机只读 HTTPS fixture 与真实隔离 PostgreSQL：比较/缺失/Secret 键名投影、健康独立与不回写配置、上游失败/UID 替换、过期/版本失效、权限撤销与并发版本变化、旧请求晚完成、新基线历史隔离、100 条保留上限、无密钥缓存查询、迁移保护及未完成平台操作失效。

测试结果和完整命令见根目录 [开发进度](../../DEVELOPMENT_PROGRESS.md)。本批没有迁移开发数据库、连接真实集群、启动 CI/CD 或修改运行服务；真实环境的默认字段、资源漂移、手工操作与后续刷新仍需联调验收。
