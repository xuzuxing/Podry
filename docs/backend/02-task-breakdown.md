# 后端开发任务清单

日期：2026-11-21 · 状态：T02–T06、T08–T10、T11/T12 管理配置、T14 Git 及 T15–T18 构建范围已实现。T19 内置 Chart/预览/快照、T20 确认/持久 Helm 提交/占用及 T15 发布恢复已实现并通过隔离测试；T21 增加应用资源及 ReplicaSet/Pod 控制器链归属，T22 增加实时差异、查询时健康观察和 setup 候选。提前实现 T24 的统一停机 deadline 与 Worker drain，补充隔离数据库备份恢复演练；T23 真实 CI/CD、T24 生产恢复与外部清理仍未验收，P1 进入条件不变。健康缓存 60 秒，后台持续轮询已实现持久调度、当前请求者权限及租约 fencing，见 [持续健康巡检](25-background-health.md)；巡检和构建/发布 Worker 默认关闭。当前边界见 [进程启停与备份恢复](14-runtime-recovery.md)、[应用资源与健康观察](13-application-observation.md)、[发布执行与恢复](12-release-execution.md)、[发布规划](11-release-planning.md) 与 [构建执行](09-build-execution.md)。Git SHA-256 仓库尚未适配，fixture 通过不代表真实 CI/CD 验收。

T15/T24 补充显式发布人工核对接口，复用 v17 历史与事务；后台执行关闭时可只读核对已提交状态，不强制释放 unknown，见 [合同](26-release-reconciliation.md)。E06/E07 的资源 Apply/动作人工只读核对也已补齐，包含当前拥有者授权、revision/lease、当前连接凭据、逐项证据、pending 跳过及原子审计/幂等，见 [资源核对](27-resource-reconciliation.md)。通用 Apply/Helm 排他及无证据强制解锁仍未开放。

总体范围、估算、状态恢复和验收见 [开发计划](01-development-plan.md)；现有 API 的分期见 [接口矩阵](03-api-delivery-matrix.md)；参考函数和适配差异见 [Devtron 源码对照](04-devtron-source-mapping.md)。任务可拆为多个提交，但必须交付对应权限、错误与测试，不以创建空目录或空 handler 结项。

## 1. P0 任务

| ID / 阶段 | 开发内容 | 主要落点与持久化 | 依赖 | 完成条件 |
| --- | --- | --- | --- | --- |
| T00 / B0 | 固定合同、权限、分期和命令 | 处理计划 C01–C10；更新 OpenAPI 设计源、状态与数据设计的必要差异 | 无 | 字段/错误/事务/执行身份有明确规则，生成合同与说明一致 |
| T01 / B0 | 实际环境与最小技术验证计划 | 记录 Go/PG/K8s/BuildKit/Registry/Helm 版本；测试 Namespace、CA、网络、磁盘和平台 | 无 | 每项具备可访问证据或明确阻塞；未擅自安装/改集群 |
| T02 / B1 | 服务依赖装配与 API 边界 | `cmd/podry/main.go`、`internal/bootstrap`、`server.New`、`internal/httpx` | T00 | `/api` JSON 404、错误体、requestId、参数校验；普通请求和流分别设限；保留静态/SPA 能力 |
| T03 / B1 | 数据库、迁移与 sqlc | `internal/database/{migrations,queries,sqlcdb}`、`sqlc.yaml`、`go.mod`；迁移角色/服务角色 | T00、T01 | 空库/升级/约束/事务实测；生成代码可复现；连接失败不继续运行持久任务 |
| T04 / B1 | CLI 用户、认证与失效 | `internal/auth`、`cmd/podry`；users；`admin init`、`users create/disable/reset-password` 语义 | T02、T03 | CLI 账户可登录、me、logout；email 合同；tokenVersion/停用立即阻止新请求；无默认密码或 Refresh |
| T05 / B1 | 团队、项目与成员 | `internal/project`；teams/team_members/projects/project_members | T04 | 多用户真实管理；只能关联已有账户；重复/越权有明确结果 |
| T06 / B1 | 授权、审计与幂等基础 | auth policy、audit、事务工具；audit_events/idempotency_records | T04、T05 | 应用/目标双重授权；并发相同键只接收一次；不同请求 hash 冲突；敏感输入不进审计 |
| T07 / B2 | 版本化凭据与 Registry | `internal/credential`、`registry`；credentials/secret_versions/registries | T03、T06 | 认证加密、写入不回显、team 作用域、轮换留存；Registry 固定 digest 可验证 |
| T08 / B2 | 集群、环境、grant 与客户端 | `internal/cluster`、`environment`；clusters/environments/resource_grants | T06、T07 | 受限 kubeconfig、显式连接测试；凭据版本更新失效旧客户端；环境无默认自动发布 |
| T09 / B2 | Discovery、Namespace、List/Get | `internal/resource`；无需镜像全量资源到 PostgreSQL | T08 | 正确 GVR/作用域/verbs/分页；授权在查询前生效；Secret 脱敏；无权与空列表不混淆 |
| T10 / B2 | 事件与 Pod 日志 | `resource.Events/PodLogs`、NDJSON 适配；UID/容器身份 | T09 | tail/previous/follow、取消和定期授权重验；不把错误连接当空日志 |
| T11 / B3 | 应用与分节配置 | `internal/application`；applications/app_config_versions | T05、T06 | 同项目重名冲突；新应用 version=0 虚拟响应；节级合并、乐观锁、workloadKind 锁定；归档阻止活动任务 |
| T12 / B3 | 完整工作流模板 | `internal/pipeline`；pipelines/targets/bindings/workflow_version | T11；目标校验需 T08 | build_deploy 原子创建 CI/Binding/CD；版本、权限和唯一性失败全回滚；不触发执行 |
| T13 / B3 | Setup 与工作流读写 | `GetSetup/GetWorkflow/SaveWorkflow`；读配置事实而非存 configured | T12 | 配置/CI/CD/产物分别判断；一条 CI；未完成 CD 不计为完整环境 |
| T14 / B4 | Git 分支、提交与固定 SHA | `internal/git`；读取已配置仓库，不新增 Git 历史表 | T07、T11 | 公开/私有 HTTPS、超时/认证/空提交区分；拒绝用户 URL 内嵌凭据；固定完整 SHA；查询失败不写 Build |
| T15 / B4 | 持久任务与恢复基础 | `internal/worker`、build/deployment 执行接口；任务领取、lease、revision | T03、T06 | 短事务；进程重启扫描；有界并发；过期 Worker 不回写；旧 I/O 未确认不重复提交 |
| T16 / B4 | 构建意图与 Job 计划 | `TriggerBuild/PlanAttempt/EnsureJob`；builds/build_attempts，executionSpec | T12–T15 | 202 前持久化；确定 Job 名；固定 runner/Builder/凭据版本；无隐藏 Job 重试；同名异 UID/身份不覆盖 |
| T17 / B4 | 构建执行与 digest 落账 | 受控 source/runner 工具镜像、BuildKit metadata 解析、Registry；artifacts | T16 | 克隆固定 SHA；路径与符号链接越界拒绝；结构化结果复核；成功状态与产物同事务；真实镜像可拉取 |
| T18 / B4 | 构建历史与持久日志 | `internal/logstore`、Build/Attempt 查询；log_archives | T10、T17 | 实时日志与归档均可读；归档失败有状态且不抹除产物；保留期与安全文件路径；游标恢复规则明确 |
| T19 / B5 | 内置 Chart、预览与快照 | `internal/chart`、`CreatePreview`；deployment_previews/release_snapshots | T07、T12、T17 | Deployment/Job Chart 固定校验值；预留 Job 执行身份；digest 最后注入；敏感版本可解析；预览不写 K8s |
| T20 / B5 | 发布确认、目标占用与 Helm | `ConfirmRelease/EnsureRelease`；requests/deployments/targets | T15、T19 | 单次消费；202 返回 ReleaseRequest；保存后再出队；同物理目标串行；超时进 unknown 保留占用 |
| T21 / B5 | 状态观察与资源身份 | `ObserveDeployment/ListApplicationResources`；deployment_resources/current 指针 | T09、T20 | Deployment generation/Ready、Job Complete/Failed 分开；资源 UID/OwnerReference；成功才移动当前发布指针 |
| T22 / B5 | 历史、差异与应用状态 | ReleaseRequest/Deployment/Diff、Application health 投影 | T21 | 固定快照可追溯；区分 requestId/deploymentId；Job completed、服务 healthy 与任务成功不同概念 |
| T23 / B6 | 全链路和故障注入验收 | `tests/integration`、HTTP 调用脚本、阶段验证记录 | T18、T22 | BE-AC01–12；真实 PG/Git/Registry/BuildKit/Helm/K8s 证据；fake 测试单列 |
| T24 / B6 | 启停、备份恢复与清理 | bootstrap/worker/logstore；部署与恢复说明、DB+密钥+Chart/日志保留 | T23 | 停止领取后有界等待；未完任务可核对；恢复不重放未知提交；只清理已确认安全的任务级资源 |

“受控工具镜像”是平台维护的源码拉取与构建 runner，并非为 Podry 另建通用构建平台。T16 先确定 Job spec 和结果协议，再由 T17 实现最小工具；工具源代码建议放 `tools/build-runner/`，与应用业务后端一起版本化。

## 2. P1 / P2 排队任务

| ID | 范围 | 进入条件与重点 |
| --- | --- | --- |
| E01 / P1-A | 用户取消与重试 | 提前实现业务：持久意图、退出核对、竞态、固定输入新增 Attempt；B6/真实执行仍待验收，见 [记录](17-build-actions.md) |
| E02 / P1-A | Push Webhook 与开发环境自动部署 | 首批 GitHub Push 验签、Delivery 去重和冻结构建准入已实现（v15），见 [记录](23-git-webhooks.md)；on_ci_success 与显式非生产自动部署业务已补齐（v16），见 [记录](24-ci-auto-deploy.md)；生产只能手动，真实 CI/CD/B6 待验收 |
| E03 / P1-A | 额外环境、环境覆盖、独立 Binding 管理 | B6；固定一 CI、多 CD；版本冲突/目标唯一性/跨环境权限；已有目标占用不可改绑 |
| E04 / P1-A | 现有镜像导入、镜像应用、其他模板与克隆 | 提前实现镜像导入/镜像应用/external_image；v11，见 [记录](18-image-artifacts.md)。克隆已补齐，见 [克隆记录](19-application-cloning.md)；真实执行验收仍需 B6 |
| E05 / P1-A | 晋级与回滚 | E03；晋级只复用 Artifact，回滚复用完整历史快照；Chart/Secret/digest 缺失明确拒绝；Job 会重新执行 |
| E06 / P1-B | ConfigMap 与 Manifest Dry Run/Apply | 已提前实现三条接口、v12 加密快照、UID/RV、持久逐对象执行与 unknown 只读核对；默认关闭，真实验收仍需 B6，见 [资源写入](20-resource-writes.md) |
| E07 / P1-B | 删除、Deployment 重启/扩缩容 | 已提前实现 UID/RV 删除、Deployment 重启/扩缩容、HPA 与发布冲突、持久意图/只读恢复及审计；v13、默认关闭，见 [资源动作](21-resource-actions.md) |
| E08 / P1-B | 应用资源人工修改与漂移 | 已提前实现当前成功发布基线、显式只读刷新、脱敏摘要/有限历史及版本/权限失效；v14，不静默回写配置或宣称收敛，见 [应用漂移](22-application-drift.md)；真实验收仍需 B6 |
| E09 / P2 | Secret reveal、exec 会话与终端 | 已实现三个 HTTP 操作及 WebSocket/SPDY：独立授权、单次短票据、Origin/UID/用户检查及退出/停机回收，见 [实施合同](28-sensitive-resource-access.md)；真实集群待验收 |

P1 不引入第二套任务调度器或发布引擎。所有增强复用 P0 的执行身份、快照、幂等、占用与恢复。

2026-11-21 按“暂缓真实 CI/CD、继续业务开发”的安排，提前实现 E03 的独立绑定、版本化覆盖与 add_deploy，见 [实施记录](15-environment-bindings.md)。原 B6 进入条件仍用于真实执行验收；本批离线业务实现不表示 B6 已通过。目标/环境变更未扩展到 PUT 合同，创建后保持固定。

同日继续提前实现 E05 的晋级/回滚请求、来源追溯、历史 Chart/Secret 冻结与 Job 新身份，见 [晋级与回滚实施记录](16-release-actions.md)。复用既有 Worker；真实跨环境执行、旧镜像可拉取性及故障验收仍待基础设施恢复。

同日继续提前实现 E04 镜像导入、镜像应用和无 CI 手动工作流，接入已有发布链路；应用克隆随后通过 POST /apps 可选分支补齐。见 [镜像导入实施记录](18-image-artifacts.md)、[应用克隆实施记录](19-application-cloning.md)。

## 3. 代码和迁移交付约定

| 范围 | 约定 |
| --- | --- |
| handler | 校验、认证上下文、调用 service、DTO/HTTP 错误映射；不写 Helm/K8s 编排逻辑 |
| service | 权限、状态转换、事务边界、冻结输入；不持有 HTTP 请求对象 |
| SQL | 一阶段一组可验证迁移；queries 生成 sqlc；并发与唯一性测试用真实 PostgreSQL |
| 外部适配 | 超时、错误分类、资源身份、调用结果不确定性；外部成功后数据库写入失败必须可恢复 |
| 敏感输入 | 凭据解密最小范围；版本化引用；日志/审计脱敏；不要回显 kubeconfig、口令、Secret 值 |
| 状态 | 仅允许明确定义的转换；版本条件更新；状态投影与主体同事务维护 |
| 交付记录 | 每批写清实际实现、执行过的测试、真实环境证据、阻塞和未覆盖场景 |

账号命令、迁移命令及运行配置需要在 B0/B1 写入正式使用说明；Compose 只是待对齐输入，不通过修改示例就宣称功能可用。保留既有注释和无关工作区改动。

## 4. 建议分工与提交节奏

后端 A 负责身份/归属/应用/配置/合同；后端 B 负责平台/资源/Worker/外部执行。T15–T22 中涉及恢复和快照的一致性由同一负责人统筹，两人交叉评审。运维提供测试环境与受限凭据，测试人员从 T06 起累积 HTTP 集成用例。

建议按可运行批次提交：T02–T04 → T05–T06 → T07–T10 / T11–T13 → T14–T18 → T19–T22 → T23–T24。首次提交应能连接数据库、显式迁移、CLI 建账并完成登录，不一次性提交全部占位模块。

首批开工前，不需要先补前端或复制 Devtron API。先核对 [B0 合同补齐项](01-development-plan.md#4-b0-必须完成的合同补齐)，再把对应任务标为进行中；当前进度以本文件顶部说明和 [实施记录](05-implementation.md) 为准。

## 5. 本地 Devtron 源码核对后的补充

参考基线为 `D:/workspace/devtron` 的 `cebc4158bd9faa913b8d5071fa6425f61aa5c9ca`。以下检查点并入已有任务；完整证据、文件/函数及差异见 [源码对照第 9 节](04-devtron-source-mapping.md#9-开发任务补充与完成条件)。没有新增业务代码，也没有改变 76 个 HTTP 操作的分期。

| 检查点 | 并入任务 | 新增验收重点 |
| --- | --- | --- |
| SC01 | T00、T01 | 记录独立 Git/runner/Helm 适配边界；明确 Discovery 部分失败与配置合并规则；参考依赖版本不直接作为兼容矩阵 |
| SC02 | T12、T13 | Devtron 工作流容器不能证明模板原子性；注入 CI 成功、CD 失败，验证全回滚和并发幂等 |
| SC03 | T15–T18、T24 | 暂停 Job、CM/Secret 部分创建、解除暂停响应丢失均可恢复核对；按固定名称、UID、摘要确认归属 |
| SC04 | T07、T16、T19 | 修改 runner/Builder/凭据后恢复旧 Attempt，仍按冻结版本执行；旧凭据不可用明确失败，不读当前值替代 |
| SC05 | T15、T20–T23 | 重启扫描全部活动/unknown 任务；不同管线相同物理目标互斥；Helm 超时先核对，不直接重放；失败资源可查 |
| SC06 | T09、T10、T21、T23；E06/E07 | Discovery 部分失败、分页范围授权、同名资源新 UID、Secret 多出口脱敏；P1 写入按对象返回 partial 结果 |

这些内容细化原任务的完成条件，不以已有参考实现为理由扣除恢复、适配和真实验收工作量。

E09 三个 HTTP 操作及 WebSocket/SPDY 通道已实现，全部 79 个 HTTP 操作已注册。Secret 仅返回指定 key，终端采用同源短票据与当前用户/Pod UID/授权持续检查，DELETE/断连/drain 释放资源。实施与真实验收边界见 [敏感资源合同](28-sensitive-resource-access.md)。数据库仍为 v17，无新增迁移。
