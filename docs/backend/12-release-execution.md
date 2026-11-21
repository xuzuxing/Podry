# 持久发布执行与恢复

日期：2026-11-20。继续 B5 的后端业务开发。Gitea、Registry 不可用期间，本批只在隔离 PostgreSQL、内存 Helm 存储及本机 TLS 模拟 API 上验证；没有连接用户的 Git/Registry，也没有向真实集群提交资源。

本文件保留 v6 批次交付时点；后续 v7、应用资源与实时差异、查询时健康观察见 [下一批实施记录](13-application-observation.md)。

## 交付范围

正式迁移为 **v6**，共 **27 张业务表**，另有 schema_migrations。000006 在现有 deployments/deployment_targets 上增加租约、版本、时间、错误码、占用和 fencing token，新增 deployment_resources；不重建 v5 不可变快照。设计 SQL 仍是 31 表的完整设计稿。

OpenAPI V1.7.0 共 76 个操作：**59 implemented / 17 planned**。确认发布已装配可消费任务的执行器，受显式开关保护。实现状态表示具备业务代码；真实 CI/CD 验收仍未完成。

| 范围 | 当前行为 |
| --- | --- |
| 确认发布 | 开关开启后，沿用同事务冻结快照、单次消费预览、创建请求/执行、幂等响应和审计，返回 202；关闭时返回 503，不消费预览或遗留任务 |
| 持久 Worker | API 同进程启动；从 PostgreSQL 扫描 queued/submitting/observing/unknown；关闭开关时不领取任务、不访问集群 |
| 物理目标互斥 | 按 deployment_targets 的唯一 cluster/namespace/releaseName 占用；同目标其他请求可以排队，但不能进入外部执行 |
| Helm 提交 | 使用冻结 Chart 包和 Values、准确版本集群凭据与 Secret；安装或升级，不下载依赖，不创建 Namespace，不执行 hook、自动回滚或失败清理 |
| 结果核对 | 提交意图持久化后才调用 Helm；后续只核对本次执行身份、快照摘要、revision 和资源，不重放 install/upgrade |
| 资源观察 | Deployment 检查 generation、更新/就绪/可用副本及旧副本清退；Job 检查 Failed/Complete，并要求成功 Pod 的当前 Job UID、标签和固定镜像一致 |
| 资源身份 | 提交中、失败和未知时也保存已观察到的 Chart 对象身份、UID、OwnerReferences 和 generation；相同名字换 UID 进入 unknown，不能覆盖旧身份 |
| 历史与指针 | 查询接口增加 startedAt、finishedAt、errorCode；成功才移动 binding.currentDeploymentId，失败保留上次成功指针 |

本批尚未实现应用资源浏览接口、ReplicaSet/Pod 等后代资源归属展示、实时 Diff、持续健康投影和 setup 的 deployableBindingIds 候选计算。应用 health 仍为 unknown，归档为 stopped；不会把一次发布成功合成持续 healthy。晋级、回滚仍在后续 P1。

## 冻结输入与敏感数据

`internal/release.Plan` 是 v5 快照类型的共享定义，保留原 JSON 字段名和字段顺序，以兼容已有 canonical SHA-256。执行核对快照、Chart 包、脱敏 Manifest 的摘要及请求/执行/应用/绑定/目标 ID，不按新的配置重新渲染输入。

只有首次提交前重新检查发起用户、项目 deploy 角色、目标资源授权和 Secret 引用权限。Helm 存储使用 Secrets，因此即使 Chart 没有运行时 Secret，也需要目标 `core/secrets` 写授权。已经提交的请求优先核对外部结果；之后的撤权不能把已有远程写入隐藏为“未执行”。

运行时 Secret 按冻结 ID、版本、targetKey 解密，只在内存填入 `podry.secretData`，不会向集群提交预览中的 `<redacted>`。恢复观察只解析冻结集群凭据，不再读取应用运行时 Secret。Podry 的快照、资源记录和审计不保存解密值或 Helm 原始错误。

Helm 自身的 Kubernetes Secret 会包含渲染后的发布内容和已解析 Values，这是 Helm 的集群侧存储行为；集群身份需要对应读写权限，读取这些记录应按敏感 Secret 管理。集群连接继续使用平台受限的内联凭据，支持已配置的 insecureSkipTLSVerify，不加载本机 kubeconfig 或执行认证插件。凭据同时保留 CA 与跳过校验标志时，适配器按显式跳过标志构造 client-go 配置，已通过 TLS 模拟 API 验证兼容性。

Helm 的 pending/failed 描述可能被 SDK 改写，因此核对身份使用 Helm Values 中平台写入的 appId、bindingId、deploymentId 和 snapshotSHA256，描述仅供辅助。只能升级同应用/绑定且状态 deployed 的既有发布；拒绝接管外部同名 release。

## 租约、未知结果与恢复

Worker 在短事务中锁定候选执行和物理目标，取得 60 秒租约与 revision。目标首次占用增加 fencing token，同次执行恢复保持 token。每次外部步骤最多 20 秒；所有 Helm 请求绑定步骤 context，SDK 内部协程在期限结束后不能继续发起新请求。

数据库回写同时检查 lease owner、revision、租约有效期、目标 owner 和 fencing token；资源身份、请求状态、当前指针、审计与终态释放在同一事务提交。过期 Worker 的整个回写事务被拒绝。数据库 fencing 不约束已到达 Kubernetes 的请求，不构成远端 exactly-once 保证。

| 情况 | 恢复规则 |
| --- | --- |
| queued，尚无提交意图 | 重验授权并按冻结输入进行一次提交 |
| 提交前撤权 | failed；不调用 Helm，释放占用 |
| 提交响应丢失或进程退出 | submitting/unknown 保留占用；重启后 Observe，禁止再次 Submit |
| Helm 不存在、pending、failed、身份或 revision 不符 | unknown 并保留占用；不存在也不能证明旧请求从未到达集群 |
| 对象 UID 或镜像身份变化 | unknown，保留已捕获身份；不把新对象覆盖为旧执行资源 |
| 已确认 Helm deployed，工作负载仍未就绪 | observing；超过冻结部署期限后 failed |
| Helm 仍不确定且超过部署期限 | 保持 unknown，不因时间到达而释放物理目标 |
| 观察到成功 | succeeded，同事务移动当前成功指针并释放占用 |
| Job Failed 或 Deployment ProgressDeadlineExceeded | 在 Helm 已确定 deployed 且资源读取完整时 failed；保留资源身份，释放占用 |

unknown 没有自动解锁、重试或“强制成功”入口；需要后续受控人工核对能力。Worker 关闭或进程退出不会取消/删除已经运行的工作负载。失败资源清理与持续健康观察留待后续开发。

## 配置与迁移

API 启动只检查版本，升级需要显式执行：

```powershell
go run ./cmd/podry migrate up
```

默认配置保持：

```dotenv
PODRY_RELEASE_ENABLED=false
PODRY_RELEASE_CONCURRENCY=1
```

并发限制为 1–4。开关为 true 时还要求稳定的 PODRY_CREDENTIAL_KEY；目标集群与凭据来自已确认快照，无单独全局 kubeconfig 参数。当前环境继续保留 false，待用户提供可用环境后再安排真实验收。CI 开关 PODRY_BUILD_ENABLED 与发布开关独立。

使用独立数据库服务角色时，除既有 v5 权限，还需对 release_requests、deployments、deployment_targets 及 deployment_resources 进行相应 INSERT/UPDATE，对相关业务表进行 SELECT，并保留 binding 更新与审计 INSERT 权限。服务角色不需要 DDL 权限。隔离集成测试会验证该角色可以启动且不能执行迁移。

## 验证边界

- `internal/release` 单元测试：本机 TLS 模拟 API 核对执行身份、revision、UID、固定镜像、Deployment/Job 成功条件；覆盖 Helm pending/failed/缺失及替换资源，恢复路径不写集群。
- Helm SDK 测试：实际 install/upgrade action、Chart loader、模板渲染和 release 存储逻辑；存储使用内存 driver，Kubernetes 写端使用 SDK fake，证明执行使用准确 Chart 包和已解析 Secret。它不代表真实 API Server/Admission/RBAC 验收。
- PostgreSQL/HTTP 集成测试：固定 Secret 版本、提交前意图与占用、撤权后的结果核对、当前指针、响应丢失后的重启恢复、同目标串行、unknown 超时不解锁、租约 fencing 和失败不移动指针。

已执行 `./scripts/test-backend.ps1`：49 个顶层用例及 8 个子用例通过，1 个真实集群用例因未设置 PODRY_TEST_KUBE_PAYLOAD 跳过；包含 go vet、go build、Linux 编译、正式迁移升级/降级和真实 PostgreSQL。最终 revision 冲突保护另外运行发布专项回归，覆盖原 revision 不被后续冲突观察覆盖。`go test ./internal/release ./internal/chart -count=1`、sqlc vet/生成一致性和文档结构检查均通过。

首次全量回归曾发现 Helm Secret 权限提前影响工作流保存，已将该要求移至发布准入/执行并通过原有工作流回归；同次编译服务启动未就绪问题在专项复测和后续全量中均未复现，增加了启动失败日志以便后续定位。本记录不把首次失败描述为全程通过。

本批不把 fixture 产物视为生产可导入产物；没有添加绕过 CI 的假 Artifact 接口。下一批 B5 补应用资源归属、实时差异与应用状态投影，B6 真实链路和故障验收继续等待环境恢复。
