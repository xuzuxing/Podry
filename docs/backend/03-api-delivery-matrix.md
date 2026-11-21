# HTTP 接口分期矩阵

日期：2026-11-21 · 状态：全部 79 个 HTTP 操作已实现；E09 补齐 Secret reveal、终端创建/关闭和 WebSocket 通道。40–41 已补齐独立环境绑定与覆盖，模板支持 add_deploy；59–60 增加晋级与历史快照回滚。55 确认发布已装配持久 Helm Worker，开关默认关闭并返回 503，开启后返回 202；58 和 61 增加实时 Diff 与应用资源。30 补齐原子应用克隆，见 [克隆记录](19-application-cloning.md)。52 增加镜像导入、镜像应用与 external_image，见 [镜像实施记录](18-image-artifacts.md)。48–49 增加构建取消与固定输入重试，见 [实施记录](17-build-actions.md)。前批见 [晋级与回滚](16-release-actions.md)，前批见 [多环境绑定与覆盖](15-environment-bindings.md)、[应用资源与健康观察](13-application-observation.md)、[发布执行与恢复](12-release-execution.md)、[发布规划](11-release-planning.md)、[构建执行](09-build-execution.md)。67/68/70 已实现预览、持久 Apply 与任务查询，见 [资源写入](20-resource-writes.md)。69 已实现删除、Deployment 重启/扩缩容及 HPA/发布冲突，见 [资源动作](21-resource-actions.md)。75 已实现 GitHub Push 准入，见 [Webhook](23-git-webhooks.md)，显式非生产自动部署已补齐，见 [记录](24-ci-auto-deploy.md)。阶段列继续表示交付安排，CI/CD 真实执行按用户要求暂缓。

本表逐项映射现有 [OpenAPI](../api/openapi.json) 的 **79 个 HTTP 操作**：P0 61 个、P1 15 个、P2 3 个。它是排期索引，不代表完成率；同一操作的可选分支也可能分期交付。新增 78 为显式发布核对、79 为资源 Apply/动作人工核对，保留既有 operationId 与编号。

总体架构与 P0 范围见 [开发计划](01-development-plan.md)，任务见 [任务清单](02-task-breakdown.md)。路径省略统一前缀 `/api`。阶段 B0 完成合同补齐后，必须据新合同重新核对本表，不能沿用旧计数判断验收。

当前 OpenAPI SHA-256：`7a5d2a357b12bdda7edb6b0210be31c8308e158e77205831a29d12429954bb6e`（V1.22.0：79 implemented、0 planned；补齐 Secret reveal 和终端创建/关闭及 WebSocket/SPDY 通道，仍为 v17、36 张业务表）。

## 1. 交付约定

- P0 先交付配置、手动源码构建、手动发布、资源读取和审计；凭据/集群/Registry 的最小接口作为后端前置能力提前。
- P1 接口尚未实现时不注册，返回 JSON 404。P0 接口中的后续可选字段/模板返回 422 validation_failed 或 feature_not_available，说明当前不支持的字段，不能静默忽略或返回假成功。
- 保留合同全部状态枚举。即使用户取消/重试接口后移，P0 也必须支持 unknown 自动核对、任务恢复、执行超时与幂等；不能把恢复语义一起延期。
- 阶段是最早可验收时间。例如 B1 审计查询先可调用，后续 CI/CD/资源事件仍由各阶段补齐。
- HTTP 契约不包含账户 CLI、迁移命令、Worker 内部执行和 WebSocket 帧；这些按计划独立验收。

## 2. 完整映射

| 序号 | 方法与路径 | operationId | 优先级 | 阶段/任务 | 实施边界与验收重点 |
| --- | --- | --- | --- | --- | --- |
| 01 | `POST /auth/login` | `login` | P0 | B1 | email + password；仅 Access Token，无 Refresh |
| 02 | `GET /auth/me` | `getCurrentUser` | P0 | B1 | 校验用户状态和 tokenVersion |
| 03 | `POST /auth/logout` | `logout` | P0 | B1 | 增加 tokenVersion；活动流需收敛 |
| 04 | `GET /teams` | `listTeams` | P0 | B1 | 按有效成员/管理员权限过滤 |
| 05 | `POST /teams` | `createTeam` | P0 | B1 | 管理员创建；不自动创建账户 |
| 06 | `GET /projects` | `listProjects` | P0 | B1 | 按团队与项目权限过滤 |
| 07 | `POST /projects` | `createProject` | P0 | B1 | 校验团队管理权限 |
| 08 | `GET /teams/{teamId}/members` | `listTeamMembers` | P0 | B1 | 受限读取已有成员 |
| 09 | `POST /teams/{teamId}/members` | `upsertTeamMember` | P0 | B1 | 只关联已有账户，不能借此注册 |
| 10 | `DELETE /teams/{teamId}/members/{userId}` | `removeTeamMember` | P0 | B1 | 撤权后新请求和活动流收敛 |
| 11 | `GET /projects/{projectId}/members` | `listProjectMembers` | P0 | B1 | 校验项目归属 |
| 12 | `POST /projects/{projectId}/members` | `upsertProjectMember` | P0 | B1 | 受限分配项目角色 |
| 13 | `DELETE /projects/{projectId}/members/{userId}` | `removeProjectMember` | P0 | B1 | 撤权与资源授权联动 |
| 14 | `GET /clusters` | `listClusters` | P0 | B2 | 只列可见集群 |
| 15 | `POST /clusters` | `createCluster` | P0 | B2 | 管理员接入已有集群，不创建云集群 |
| 16 | `GET /clusters/{clusterId}` | `getCluster` | P0 | B2 | 不返回 kubeconfig 明文 |
| 17 | `PATCH /clusters/{clusterId}` | `updateCluster` | P0 | B2 | 凭据更新使旧客户端失效 |
| 18 | `POST /clusters/{clusterId}/connection-tests` | `testClusterConnection` | P0 | B2 | 读取真实 /version；HTTP 200 + connected/unavailable；凭据版本重验后保存观察 |
| 19 | `GET /clusters/{clusterId}/resource-grants` | `listResourceGrants` | P0 | B2 | 管理员查看授权 |
| 20 | `POST /clusters/{clusterId}/resource-grants` | `createResourceGrant` | P0 | B2 | 校验主体验证及资源/actions 白名单 |
| 21 | `DELETE /clusters/{clusterId}/resource-grants/{grantId}` | `deleteResourceGrant` | P0 | B2 | 撤权必须生效 |
| 22 | `GET /environments` | `listEnvironments` | P0 | B2 | 逻辑环境与实际绑定分开 |
| 23 | `POST /environments` | `createEnvironment` | P0 | B2 | 生产不能自动发布，P0 全部手动 |
| 24 | `GET /credentials` | `listCredentials` | P0 | B2 | 仅元信息，不返回 payload |
| 25 | `POST /credentials` | `createCredential` | P0 | B2 | 按 kind 验证并加密，限制引用作用域 |
| 26 | `GET /registries` | `listRegistrys` | P0 | B2 | 按现有 operationId 实现，凭据不回显 |
| 27 | `POST /registries` | `createRegistry` | P0 | B2 | 管理员配置仓库及凭据引用 |
| 28 | `PUT /credentials/{credentialId}` | `rotateCredential` | P0 | B2 | 按版本保留，通知客户端失效并审计 |
| 29 | `GET /apps` | `listApplications` | P0 | B3 | 项目/状态过滤与授权分页 |
| 30 | `POST /apps` | `createApplication` | P0 | B3 | 已支持 sourceMode=git/image；cloneFromAppId 原子复制授权配置，独立仓库路径，不复制执行状态 |
| 31 | `GET /apps/{appId}` | `getApplication` | P0 | B3 | 应用状态是执行/资源事实的投影 |
| 32 | `PATCH /apps/{appId}` | `updateApplication` | P0 | B3 | 基础字段与归档；活动/unknown 任务时禁止归档 |
| 33 | `GET /apps/{appId}/config` | `getAppConfig` | P0 | B3 | 未保存时虚拟 version=0，不插入假配置 |
| 34 | `PUT /apps/{appId}/config` | `saveAppConfig` | P0 | B3 | section 合并、expectedVersion、workloadKind 锁定 |
| 35 | `GET /apps/{appId}/setup` | `getApplicationSetup` | P0 | B3 | 派生进度；发布候选检查执行器、CD、已验证产物、配置和权限，不承诺网络可达 |
| 36 | `POST /apps/{appId}/workflow-templates` | `createWorkflowFromTemplate` | P0 | B3 | build_deploy、build_only、add_deploy 和 external_image 可保存；不触发执行 |
| 37 | `GET /apps/{appId}/git/branches` | `listGitBranches` | P0 | B4 | 已实现；已配置 HTTPS smart Git、筛选、签名分页和权限重验 |
| 38 | `GET /apps/{appId}/git/commits` | `listGitCommits` | P0 | B4 | 已实现；分支可达历史、完整 SHA、配置版本和分页；失败不写 Build；SHA-256 仓库尚未支持 |
| 39 | `GET /apps/{appId}/environments` | `listAppBindings` | P0 | B3 | 只返回实际绑定；初始为空 |
| 40 | `POST /apps/{appId}/environments` | `createAppBinding` | P1 | E03 | 已实现独立绑定；验证合并配置/实际资源权限与物理目标唯一性；不隐式建 CD |
| 41 | `PUT /apps/{appId}/environments/{bindingId}` | `updateAppBinding` | P1 | E03 | 已实现覆盖整体替换、乐观锁、占用/新旧资源权限检查；目标及环境不可修改 |
| 42 | `GET /apps/{appId}/pipelines` | `getWorkflow` | P0 | B3 | 一条 CI 与实际 CD 集合 |
| 43 | `PUT /apps/{appId}/pipelines` | `saveWorkflow` | P0 | B3 | expectedVersion；manual/push 已实现；on_ci_success 待后续 |
| 44 | `GET /apps/{appId}/builds` | `listBuilds` | P0 | B4 | 已实现；按应用、权限和时间分页 |
| 45 | `POST /apps/{appId}/builds` | `triggerBuild` | P0 | B4 | 已实现；SHA/配置版本固定，幂等意图落库后返回 202；真实 CI 待联调 |
| 46 | `GET /builds/{buildId}` | `getBuild` | P0 | B4 | 已实现；当前 Attempt 投影与产物身份 |
| 47 | `GET /builds/{buildId}/attempts` | `listBuildAttempts` | P0 | B4 | 已实现；执行身份、错误和 logAvailability |
| 48 | `POST /builds/{buildId}/cancel` | `cancelBuild` | P1 | E01 | 已实现：持久取消、暂停/退出确认与完成竞态 |
| 49 | `POST /builds/{buildId}/retry` | `retryBuild` | P1 | E01 | 已实现：固定原输入，新增 Attempt/Job/tag |
| 50 | `GET /builds/{buildId}/logs` | `streamBuildLogs` | P0 | B4 | 已实现；NDJSON、Attempt 归属、轮询/归档、签名游标与七天保留 |
| 51 | `GET /apps/{appId}/artifacts` | `listArtifacts` | P0 | B4 | 已实现；Registry 复核 digest 后落账，日志不可用不隐藏产物 |
| 52 | `POST /apps/{appId}/artifacts` | `importArtifact` | P1 | E04 | 已实现；幂等、Registry 内容验证与固定 digest，不创建虚构 Build |
| 53 | `POST /apps/{appId}/deployment-previews` | `previewDeployment` | P0 | B5 | 冻结配置/绑定/CD/Chart/digest/Secret，预留 Job 执行身份 |
| 54 | `GET /apps/{appId}/deployments` | `listDeployments` | P0 | B5 | 按绑定和应用授权过滤 |
| 55 | `POST /apps/{appId}/deployments` | `createReleaseRequest` | P0 | B5 | 已实现；开关默认关闭时 503、不消费预览；启用后 202，持久 Worker 串行占用物理目标、核对未知结果；真实执行未验收 |
| 56 | `GET /release-requests/{requestId}` | `getReleaseRequest` | P0 | B5 | requestId 与 deploymentId 分开 |
| 57 | `GET /deployments/{deploymentId}` | `getDeployment` | P0 | B5 | 执行状态、快照、Helm revision、startedAt/finishedAt/errorCode |
| 58 | `GET /deployments/{deploymentId}/diff` | `getDeploymentDiff` | P0 | B5 | 已实现；快照期望与实时根资源比较，统一脱敏/规范化；UID 替换或未捕获身份时 409 |
| 59 | `POST /deployments/{deploymentId}/promote` | `promoteDeployment` | P1 | E05 | 已实现请求业务；复用成功来源 Artifact、采用同应用另一绑定的当前配置；幂等/权限/占用校验，默认执行关闭 |
| 60 | `POST /deployments/{deploymentId}/rollback` | `rollbackDeployment` | P1 | E05 | 已实现请求业务；历史 Values/Chart/准确 Secret 版本、当前连接凭据、新 Job 身份和来源追溯；真实执行待验收 |
| 61 | `GET /apps/{appId}/resources` | `listApplicationResources` | P0 | B5 | 已实现；绑定/记录 UID/控制器 OwnerReference 与逐类型授权交集，刷新 60 秒健康观察；同投影支持默认关闭的后台巡检，见 [巡检合同](25-background-health.md) |
| 62 | `GET /clusters/{clusterId}/discovery` | `discoverResources` | P0 | B2 | 动态 GVR/作用域/verbs；按权限提供能力 |
| 63 | `GET /clusters/{clusterId}/namespaces` | `listNamespaces` | P0 | B2 | 仅授权 Namespace，不能泄露全量名称 |
| 64 | `GET /clusters/{clusterId}/resources` | `listResources` | P0 | B2 | K8s continueToken/resourceVersion；不假定 total |
| 65 | `GET /clusters/{clusterId}/resource` | `getResource` | P0 | B2 | 校验目标 UID；Secret、annotation 敏感字段脱敏 |
| 66 | `GET /clusters/{clusterId}/events` | `listResourceEvents` | P0 | B2 | 按资源 UID 关联，分清空态与连接错误 |
| 67 | `POST /clusters/{clusterId}/resources/dry-run` | `dryRunResources` | P1 | E06 | 已实现：严格单对象、view/write、UID/RV、加密与字段路径 Diff |
| 68 | `POST /clusters/{clusterId}/resources/apply` | `applyResources` | P1 | E06 | 已实现：幂等、CAS、持久意图/lease、partial/unknown；默认关闭 |
| 69 | `POST /clusters/{clusterId}/resource-actions` | `actOnResource` | P1 | E07 | 已实现：UID/RV 删除、Deployment 重启/扩缩容、HPA/发布冲突与只读恢复 |
| 70 | `GET /resource-operations/{operationId}` | `getResourceOperation` | P1 | E06/E07 | 已实现 Apply 和动作的拥有者查询及当前动作权限重验 |
| 71 | `POST /clusters/{clusterId}/secrets/reveal` | `revealSecret` | P2 | E09 | 已实现：精确 UID/RV、指定 key、独立授权、最终审计和 no-store |
| 72 | `GET /clusters/{clusterId}/pod-logs` | `streamPodLogs` | P0 | B2 | NDJSON；UID/容器/tail/previous/follow；断流不判任务失败 |
| 73 | `POST /clusters/{clusterId}/exec-sessions` | `createExecSession` | P2 | E09 | 已实现：单次票据、同源 WebSocket/SPDY、用户/权限/Pod UID 持续检查 |
| 74 | `DELETE /exec-sessions/{sessionId}` | `closeExecSession` | P2 | E09 | 已实现：拥有者审计关闭、上游取消、配额回收与停机回收 |
| 75 | `POST /webhooks/git/{provider}/{pipelineId}` | `receiveGitWebhook` | P1 | E02 | 已实现 GitHub HMAC、持久 Delivery 去重、显式用户授权与构建入队；非生产 on_ci_success 复用构建准入捕获与持久发布协调器 |
| 76 | `GET /audit-events` | `listAuditEvents` | P0 | B1 | 按项目/集群授权过滤；无敏感原文 |
| 77 | `GET /apps/{appId}/drift` | `getApplicationDrift` | P1 | E08 | 已实现：绑定必选，默认本地缓存/最近历史；显式 refresh=true 只读刷新；脱敏数量、60 秒失效、不自动修复 |
| 78 | `POST /deployments/{deploymentId}/reconcile` | `reconcileDeployment` | P1 | T15/T24 补充 | 已实现：当前操作者完整授权、只读 Helm 核对、revision/lease/fencing、事务审计与幂等；证据不足保留 unknown，见 [合同](26-release-reconciliation.md) |
| 79 | `POST /resource-operations/{operationId}/reconcile` | `reconcileResourceOperation` | P1 | E06/E07 恢复补充 | 已实现：原请求人当前完整权限、revision/lease、只读证据与凭据重验、pending 跳过、原子审计/幂等；unknown 不强制解除，见 [合同](27-resource-reconciliation.md) |

## 3. 分阶段出口

| 阶段 | 可独立验证的 HTTP 结果 |
| --- | --- |
| B1 | CLI 建账后登录，创建团队/项目并管理已有成员；查看权限内审计 |
| B2 | 接入集群/环境/Registry/凭据；按 GVR 读取资源、事件与 Pod 日志 |
| B3 | 新建空应用，分节保存配置，原子建立完整源码交付流水线，查询 setup |
| B4 | 真实 Git 提交构建成功，返回 Registry 可验证的 digest、历史与日志 |
| B5 | 发布预览、幂等确认、查询请求/部署状态，读取应用资源与配置差异 |
| B6 | 进程 drain/统一停机时限及隔离数据库恢复演练已补充，见 [启停与恢复记录](14-runtime-recovery.md)；真实链路、生产恢复和外部清理仍待验收 |

本表沿用原 operationId（包括 listRegistrys 的现有命名），不在排期文档中暗改客户端合同。未来如需调整名称或字段，先修订设计源和版本兼容说明。
