# Devtron 后端源码映射与实施取舍

版本：V1.0 · 日期：2026-11-20 · 状态：静态源码核对与开发规划，尚未实施。

本文依据用户提供的本地后端源码，补充 [后端开发计划](01-development-plan.md)、[任务清单](02-task-breakdown.md) 和 [接口分期矩阵](03-api-delivery-matrix.md)。源码用于解释业务链路和确定实现边界；Podry 继续采用 Go / chi / PostgreSQL / pgx / sqlc，CI 使用 Kubernetes Job + BuildKit，CD 使用 Helm SDK。完整主流程仍为 **Build & Deploy from Source Code**。

## 1. 核对基线与结论

| 项目 | 本轮记录 |
| --- | --- |
| 参考源码根目录 | `D:/workspace/devtron`，下文 Devtron 路径均相对此目录 |
| 参考提交 | `cebc4158bd9faa913b8d5071fa6425f61aa5c9ca`；检查时工作区干净 |
| Podry 根目录 | `D:/zuxcloud/Podry`；HEAD `fd8d50b4b9c613cfbef6005992373c4406d4f62f`，另有未提交内容 |
| 核对方法 | 阅读路由、handler、service、执行器、持久化与 vendored 工具实现；核对关键调用及函数行号 |
| 证据边界 | 未编译或启动 Devtron，未验证外部 runner / Git Sensor / Kubelink 服务，未操作集群；该提交与测试实例运行版本是否一致尚未核定 |
| Podry 状态 | 当前业务后端尚未实现；本文中的 Podry 模块、函数和事务均为开发目标 |

核对后保留现有 B0–B6 顺序及 P0/P1/P2 分期，增加源码阅读入口和明确的差异验收。主要结论：

1. Devtron 将工作流容器、CI 配置、CD 配置分别处理。已读的 `CreateAppWorkflow` 只保存工作流容器；不能从该函数推导出 CI/Binding/CD 在同一事务创建。Podry 的完整模板事务需要自行实现。
2. Devtron 同时包含 Argo Workflow 与原生 Job 执行器，默认执行器选择也有明确分支。原生 Job 已采用先暂停创建、再准备依赖、最后解除暂停的顺序，可以借鉴生命周期；不能因此认为构建工具和恢复协议已经可直接复用。
3. CI 完成通知、运行状态通知、镜像产物分别处理。Podry 应保留 Build / Attempt / Artifact 的职责边界，发布只消费已经验证的 Artifact。
4. Devtron 有持久发布请求、事件分发和启动恢复扫描；已读恢复查询会按流水线筛选最新请求。Podry 应核对自己的全部活动或未知任务，并以物理发布目标串行执行。
5. Devtron 的 Helm 发布路径调用 Kubelink gRPC 客户端；资源工具部分实现在 vendored common-lib。复制一个 service 文件不足以形成独立可运行后端。
6. Devtron 的快照重试会从当前配置恢复部分凭据。Podry 已选择版本化凭据引用，必须按自己的冻结合同实现，不能把“有配置快照”解释为全部执行输入不变。

## 2. 可回查的源码索引

以下为本地参考提交中的文件与起始行。路径采用代码形式，避免把开发机的跨盘目录写成文档发布后失效的相对链接。行号只对上述提交有效；S 编号供下文引用。

| 编号 | Devtron 文件与入口 | 本轮核实内容 |
| --- | --- | --- |
| S01 | `api/router/router.go:278`；`api/router/app/AppRouter.go:83` | 应用路由挂在 `/orchestrator/app`；工作流子路由为 `/app-wf` |
| S02 | `pkg/appWorkflow/AppWorkflowService.go:110`，`CreateAppWorkflow` | 检查名称并新增/更新工作流容器；此函数未创建 CI/CD |
| S03 | `api/router/app/pipeline/configure/PipelineConfigRouter.go:41`；`api/router/app/pipeline/trigger/PipelineTriggerRouter.go:58` | CI 配置、触发、日志、历史与 CD 发布分入口 |
| S04 | `pkg/pipeline/BuildPipelineConfigService.go:1378`，`CreateCiPipeline` | 准备 Registry / CI 模板，保存模板并交给编排服务添加 CI 管线 |
| S05 | `pkg/pipeline/DeploymentPipelineConfigService.go:465`，`CreateCdPipelines` | 目标环境、部署类型及 CD 请求校验；不能用 CI 配置代替 CD |
| S06 | `pkg/pipeline/CiHandler.go:154`，`FetchMaterialsByPipelineIdAndGitMaterialId` | 向 Git Sensor 请求变更；返回提交和仓库/分支错误信息 |
| S07 | `api/restHandler/app/pipeline/configure/BuildPipelineRestHandler.go:695`，`TriggerCiPipeline` | 登录、触发权限、输入校验后调用 CI 手动触发服务 |
| S08 | `pkg/build/trigger/HandlerService.go:330`，`HandleCIManual`；同文件 `:708`、`:952`、`:990` | 解析提交 → 准备请求和运行记录 → 提交执行；保存 GitTriggers、执行器等信息 |
| S09 | `pkg/pipeline/CiService.go:111`，`SaveCiWorkflowWithStage` | Workflow、阶段和最新状态投影在事务内保存 |
| S10 | `pkg/executor/WorkflowService.go:128`，`SubmitWorkflow`；同文件 `:423`，`getWorkflowExecutor` | 生成模板、写触发审计、选择执行器；空值或 awf 选择 Argo，system 选择 Job |
| S11 | `pkg/pipeline/executors/systemWorkflow.go:52`，`ExecuteWorkflow`；同文件 `:183`，`getJobTemplate`；`pkg/pipeline/executors/bean.go:44` | Job 暂停创建 → 带 OwnerReference 的 CM/Secret → 解除暂停；GenerateName、backoffLimit=0 |
| S12 | `pkg/pipeline/types/CiCdConfig.go:63`；`pkg/build/trigger/HandlerService.go:1105` | CI runner 镜像来自运行配置；Job 执行器本身不是 Dockerfile 构建实现 |
| S13 | `pkg/eventProcessor/in/WorkflowEventProcessorService.go:404`，`SubscribeCIWorkflowStatusUpdate`；同文件 `:584`，`SubscribeCICompleteEvent`、`:686`，`BuildCiArtifactRequest` | 状态通知与完成通知分开；完成事件携带镜像、digest 和提交材料信息 |
| S14 | `pkg/workflow/dag/WorkflowDagExecutor.go:963`，`HandleCiSuccessEvent` | 构造并保存 CiArtifact，形成 CI 与下游发布的产物交接 |
| S15 | `pkg/build/trigger/HandlerService.go:269`，`reTriggerCiFromSnapshot`；`pkg/workflow/trigger/audit/service/WorkflowTriggerAuditService.go:131`、`:198` | 重试读取快照，但部分敏感字段从当前环境或当前 Registry 配置恢复 |
| S16 | `pkg/pipeline/CiLogService.go:56`，`FetchRunningWorkflowLogs`；同文件 `:87`，`FetchLogs` | 运行中读取 Pod 日志，历史日志通过 blob-storage 下载后读取 |
| S17 | `api/restHandler/app/pipeline/trigger/PipelineTriggerRestHandler.go:114`，`OverrideConfig`；`pkg/deployment/trigger/devtronApps/deployStageHandlerCode.go:158`，`ManualCdTrigger` | 发布独立鉴权、校验并进入 CD 业务服务 |
| S18 | `pkg/deployment/manifest/ManifestCreationService.go:173`，`GetValuesOverrideForTrigger`；同文件 `:544`，`mergeOverrideValues` | 选择发布配置并合并 values；有策略、运行覆盖、CM/Secret、标签等不同层次 |
| S19 | `pkg/deployment/trigger/devtronApps/deployStageHandlerCode.go:606`，`handleCDTriggerRelease`；同文件 `:585`，`triggerAsyncRelease` | 发布请求及验证时间线落库；按模式发布异步事件或进入同步路径 |
| S20 | `pkg/eventProcessor/in/WorkflowEventProcessorService.go:171`、`:946`、`:1005` | 构造服务时启动未完成发布扫描；并发处理使用进程内锁和流水线上下文 |
| S21 | `pkg/deployment/trigger/devtronApps/userDeploymentRequest/repository/UserDeploymentRequestRepository.go:131`，`GetAllInCompleteRequests` | 根据时间线、运行状态及每条 pipeline 的最新请求选择恢复记录 |
| S22 | `pkg/deployment/trigger/devtronApps/deployStageHandlerCode.go:875`，`deployApp`；同文件 `:904`、`:1229`；`api/helm-app/gRPC/applicationClient.go:77` | CD 分 Argo / Flux / Helm；Helm 经客户端调用 Kubelink 安装/更新 release |
| S23 | `api/router/router.go:387`；`api/k8s/application/k8sApplicationRouter.go:37` | 资源入口挂在 `/orchestrator/k8s`，包含 Discovery、列表、对象、Events、Logs、Apply 等 |
| S24 | `api/k8s/application/k8sApplicationRestHandler.go:167`、`:577`、`:911`、`:950` | 对象、日志、Discovery、列表的 handler 与权限组织；日志有 Last-Event-ID 重连逻辑 |
| S25 | `pkg/k8s/application/k8sApplicationService.go:431`、`:656`、`:747`、`:780` | Pod 日志参数、Discovery 授权过滤、资源列表和逐对象 Apply |
| S26 | `pkg/k8s/K8sCommonService.go:104`，`GetResource`；同文件 `:232`，`ListEvents` | 通过集群配置与通用 K8s 工具读取 Manifest / Events |
| S27 | `vendor/github.com/devtron-labs/common-lib/utils/k8s/K8sUtil.go:971`、`:1090`、`:1140` | 事件查询、动态资源列表和 Discovery 的底层实现；含部分 API 不可用处理 |
| S28 | `pkg/deployment/deployedApp/status/resourceTree/ResourceTreeService.go:107`，`FetchResourceTree` | 应用资源树按 Argo / Helm / Flux 走不同适配路径 |
| S29 | `internal/sql/repository/pipelineConfig/CiWorkflowRepository.go:108`；`internal/sql/repository/CiArtifactRepository.go:63`；`internal/sql/repository/pipelineConfig/CdWorfkflowRepository.go:99` | CI 运行、镜像产物、CD Workflow/Runner 为不同模型；原文件名保留 Worfkflow 拼写 |
| S30 | `vendor/github.com/devtron-labs/common-lib/pubsub-lib/JetStreamUtil.go:22`；`go.mod:5` | 事件基础设施涉及 NATS 客户端；主工程还有 gorilla/mux、go-pg、Casbin、Argo 等依赖 |

`api/router/K8sRouter.go` 在此提交中仅有文件头和 package 声明，不能把它作为资源浏览器路由实现。资源链路以 S23–S27 为入口；这也说明目录名只能用于检索，必须继续核对调用体。

## 3. 应用配置与完整工作流

### 3.1 已核实的 Devtron 组织

S01–S05 分别组织工作流容器、CI 模板/管线和 CD 管线。`CreateAppWorkflow` 会处理名称并保存容器，CI 的 `CreateCiPipeline` 还会保存模板并调用 `AddPipelineToTemplate`，CD 的 `CreateCdPipelines` 单独检查环境和部署类型。

这些已读入口不提供 Podry 所需的“一次请求原子创建 CI + Binding + CD”证明；本轮也未完整追踪 Devtron 所有模板聚合入口，不能据此断言其所有创建流程都不具备事务。

### 3.2 Podry 实施决定

由 T12 的 `internal/pipeline.CreateWorkflowFromTemplate` 统一创建 CI、环境 Binding、CD 和工作流版本，在同一个 PostgreSQL 事务内完成。先校验应用、环境、目标权限和版本，再落库；任一失败全部回滚。保存配置不发起构建、建 Namespace 或发布。

T13 的 setup 由已保存的 Git / Build / Base / CI / CD 事实派生。只有 CI 时不能将完整工作流标记为配置完成；CD 必须有有效 Binding 和目标。一 CI 多 CD 的结构保留，首批只验收一条真实目标链路。

对应验收：BE-AC03。补充故障点为“CI 已插入、CD 写入失败”和“两个请求并发创建同一模板”；要求回滚完整、无悬空绑定，幂等重放得到同一结果。

## 4. 源码到镜像的构建链路

### 4.1 Devtron 调用与数据流

```text
BuildPipelineRestHandler.TriggerCiPipeline                 S07
  → build/trigger.HandlerService.HandleCIManual             S08
  → buildManualTriggerCommitHashes / triggerCiPipeline
  → prepareCiWfRequest / saveNewWorkflowForCITrigger
  → CiService.SaveCiWorkflowWithStage                       S09
  → WorkflowService.SubmitWorkflow                          S10
  → ArgoWorkflowExecutor 或 SystemWorkflowExecutor          S11

运行状态通知 → SubscribeCIWorkflowStatusUpdate              S13
构建完成通知 → SubscribeCICompleteEvent
  → BuildCiArtifactRequest：image + digest + material
  → validateAndHandleCiSuccessEvent
  → WorkflowDagExecutor.HandleCiSuccessEvent → CiArtifact    S14
```

Git 提交查询另经 `CiHandler` 调用 Git Sensor（S06）。构建容器使用配置的 runner 镜像（S12），不是由 `SystemWorkflowExecutor` 在 Go 进程内完成构建。完成事件携带 digest，是已核实的接收协议；runner 在容器内如何执行、上报和保证结果真实性，不在本轮已验证范围内。

### 4.2 Podry 的替换实现

| 关切 | Podry 拟实现 | 任务 |
| --- | --- | --- |
| Git Sensor | `internal/git` 独立读取已配置 HTTPS 仓库，固定完整 SHA；错误区分认证/出网/分支/空提交 | T14 |
| 受理与执行 | API 事务先保存 Build、Attempt、executionSpec、审计和幂等结果，返回 202；Worker 领取后执行 | T15、T16 |
| Job 生命周期 | 固定 Attempt 派生的 Job 名；记录 UID；暂停创建、依赖准备、解除暂停都可重复核对 | T16 |
| 构建工具 | 平台维护的 source/runner 工具镜像调用 BuildKit；版本、平台、超时、Builder 和凭据版本进入 executionSpec | T16、T17 |
| 镜像事实 | runner 读 metadata-file，写小型版本化结果；Worker 检查 Job/Pod、指定容器退出与结果，再向 Registry 复核 digest | T17 |
| 状态和产物 | Pod/Job 完成、Build 成功、Artifact 可用分别判定；构建成功与 Artifact 创建同事务 | T17 |
| 运行与历史日志 | 授权后流式读取；结束后归档到持久卷；日志归档状态与镜像构建结果独立 | T18 |

原生执行器的 `backoffLimit=0`（S11）与 Podry 的 Attempt 边界一致；Podry 同时固定 `restartPolicy=Never`。但该源实现使用 `GenerateName`，Podry 使用确定名称来核对“创建响应丢失”后的同一个 Job。即使如此，也不承诺分布式环境下远程任务绝对只执行一次；必须检查同 Attempt 的 Pod、结果来源和外部镜像，无法判定时进入 unknown。

如果采用暂停 Job 的顺序，T16 必须处理：创建成功但响应丢失、仅部分 CM/Secret 成功、解除暂停响应丢失、重启时 Job 已开始、同名依赖属于其他 UID。这些步骤不是跨数据库和 Kubernetes 的事务。名称、UID、OwnerReference 与 executionSpec 摘要不匹配时拒绝覆盖；错误/未知结果不能立即删除现场。Podry 首版不增加自定义 finalizer，使用 OwnerReference，并在结果与日志留存策略允许后清理。

### 4.3 快照与重试的差异

S15 的源码会从失败快照重建 WorkflowRequest、新建 CI Workflow，再调整执行身份；但 `restoreSecretsInWorkflowRequest` 使用当前环境的存储凭据，`restoreDockerRegistrySecrets` 查询当前 Registry 配置。因此这里的“按快照重试”不能直接等同于全部凭据保持原版本。

Podry 在 T07/T16 固定凭据版本引用、keyId 和保留规则，恢复时按引用解析。原版本不可解密、不可访问或已撤销时明确失败/阻塞，不静默替换为当前版本。用户重试 E01 新增 Attempt；自动恢复当前 Attempt 则核对现有执行。两者不能混用。

对应验收：BE-AC04–06，并增加“执行期间修改 BuildKit endpoint/runner 版本/Registry 凭据后重启”，验证旧 Attempt 仍使用冻结输入；当前配置只影响后续新执行。

## 5. 镜像到环境的发布链路

### 5.1 Devtron 已读链路

S17 的发布 handler 进行登录、参数和触发权限检查，然后进入 `HandlerService.ManualCdTrigger`。CD 处理包含以下阶段，具体走同步或异步受配置影响：

```text
ManualCdTrigger
  → handleCDTriggerRelease                                 S19
  → 保存 UserDeploymentRequest 和验证时间线，提交事务
  → 异步：GetValuesOverrideForTrigger + 发布审计 → 事件
     或同步：TriggerRelease
  → deployApp                                               S22
     ├─ Argo
     ├─ Flux
     └─ createHelmAppForCdPipeline
          → HelmAppClient.UpdateApplication
          或 InstallReleaseWithCustomChart → Kubelink gRPC
```

S18 的 `mergeOverrideValues` 按实际代码依次选择应用或环境解析值，叠加策略、release override、CM/Secret、标签。该函数里的简写注释不是 Podry 的合并合同，不能直接复制成“所有配置都是一套通用 JSON Patch”。

### 5.2 Podry 发布的实现边界

T19 实现无集群写入的 `CreatePreview`：按照 Podry 自身配置规则，冻结 Chart 内容及校验值、Artifact digest、配置版本、Binding/CD 版本和 Secret 版本；渲染用户可检查的脱敏 Manifest。Job 的部署 UUID 在预览内部预留，确认时沿用，保证预览与实际命名一致。

T20 的 `ConfirmRelease` 校验操作者、授权、有效期、版本和 preview 单次消费，在一个短事务内保存 ReleaseSnapshot、ReleaseRequest、queued Deployment 和幂等结果。Worker 再领取任务并占用 `cluster + namespace + releaseName` 对应物理目标，调用独立的 Helm SDK 适配器。Devtron 的 Kubelink 安装/升级客户端只作为业务参数参考，不引入第二个后端服务。

T21 的观察器分别判断 Deployment generation/就绪与 Job Complete/Failed，并持续保存资源 GVR、名称、UID、OwnerReference 等身份。Helm 调用结束只是观察输入，不直接等同于应用健康或一次性 Job 已成功。成功后才移动当前发布指针；失败与进行中的资源也可追查。

T22 提供发布记录、固定快照差异及应用健康投影。S28 的多后端资源树适配可以参考信息组织，Podry 首版从自身发布记录、Helm release 与 Kubernetes 对象构建关系，不依赖 Argo 健康状态库覆盖自己的状态判定。

对应验收：BE-AC07–09。增加“修改 Base / 绑定 / Secret 后再消费旧 preview”和“发布中查询失败资源”的用例；hello-world 必须按一次性 Job 验收完成状态，服务型 Deployment 使用独立测试镜像。

## 6. 任务恢复与并发控制

S20 在构造事件处理服务时触发 `ProcessIncompleteDeploymentReq`。S21 的查询使用运行状态与时间线判断未触发记录，并按 pipeline 取最新请求；处理过程中还有进程内锁和流水线上下文。这证明存在恢复机制，但不能据此证明任意故障点都能恢复、跨流水线目标互斥或多实例远程执行恰好一次。

Podry 的 T15/T20/T24 按以下规则实现：

| 场景 | Podry 要求 | 与已读参考的差异 |
| --- | --- | --- |
| 重启后扫描 | 扫描全部非终态及 unknown BuildAttempt/Deployment/任务，按持久意图继续核对 | 不照搬“每 pipeline 只取最新”筛选规则 |
| 并发发布 | 对物理目标做数据库占用，保存执行身份与版本；不同管线指向同 release 也互斥 | 不只按 pipelineId 做进程内互斥 |
| Worker 过期 | lease + revision 防止旧 Worker 回写；新 Worker 先核对外部资源 | 数据库 fencing 不能停止已经发出的远程 I/O |
| Helm 超时或连接断开 | 保存 unknown，保留占用，核对 Helm revision、Manifest 和资源身份 | 超时不能直接归为无副作用失败或重新安装 |
| Job 创建/发布响应丢失 | 用固定身份查询实际结果，身份不明时不重复提交 | Create 返回错误不证明远程未接受 |
| 删除与保留 | 活动或 unknown 禁止归档应用、重绑目标和自动清理；日志状态单独记录 | 不因 lease 过期或 API 请求结束而释放现场 |

这些保证属于 Podry 的开发与故障验收目标。静态源码阅读不能代替 BE-AC06、BE-AC08 和 BE-AC12 的真实环境证据。

## 7. Kubernetes 资源浏览与管理

### 7.1 读取链路

```text
/orchestrator/k8s                                          S23
  → K8sApplicationRestHandler：读取请求与权限上下文         S24
  → K8sApplicationService：Discovery / List / Pod Logs      S25
    或 K8sCommonService：Get / Events                      S26
  → common-lib K8sUtil：Discovery / Dynamic / Typed Client  S27
```

S27 使用 Discovery 获得 GVK/GVR、作用域和 verbs；列表可请求 Table 形式。S25 的列表读取后通过回调过滤对象。Podry 借鉴动态资源的思路，按自己的授权合同在请求前限制 cluster / namespace / GVR，再进行对象授权与脱敏；不能把 Table 列或隐藏菜单当作权限控制。

### 7.2 Podry 资源模块

| 功能 | 首批实现要求 | 任务/分期 |
| --- | --- | --- |
| Discovery | 保留 GVR、scope、verbs；缓存绑定集群及凭据版本；部分 API group 不可用时明确降级，不显示为空集群 | T09 / P0 |
| 列表 | 限定授权 Namespace，保留 K8s continue/resourceVersion 语义；Token 绑定查询范围，不能跨集群/资源复用；Table 非必需 | T09 / P0 |
| Manifest | 明确对象身份；Secret 默认不返回 data/stringData，移除可携带原值的 last-applied 等字段；列表、详情、差异和错误统一脱敏 | T09 / P0 |
| 事件 | 关联实际对象 UID；同名对象重建后不混入旧实例事件 | T10 / P0 |
| Pod 日志 | cluster / namespace / Pod UID / container 绑定授权；tail、previous、follow、取消和周期重验；使用现有 NDJSON 合同 | T10 / P0 |
| 应用运行资源 | 应用权限与目标资源权限取交集；从已记录 UID 与 OwnerReference 扩展关系，标签只作线索 | T21 / P0 |
| YAML / ConfigMap 管理 | 持久 preview → 确认 → 持久 operation；逐对象授权及结果；resourceVersion / UID 前置条件 | E06 / P1 |
| 删除/重启/扩缩容 | 明确适用 Kind、影响和授权，写审计；有任务记录可查询 | E07 / P1 |
| Secret reveal / exec | 另行设计授权和短期会话；不影响 P0 的资源和日志读取闭环 | E09 / P2 |

源码提示的三个差异必须在开发中处理：

- Discovery：S27 对部分 API 错误使用错误文本判断；Podry 应按所选 SDK 的结构化错误能力分类，B0 明确是可返回的 partial 还是整体失败，不能静默丢失资源类别。
- Events：已读 `ListEvents` 用名称、Namespace、Kind 选择事件，UID 参数为空。Podry 需要补 UID 约束或 UID 过滤，验证同名对象重建。
- Apply：S25 逐个检查并写入、聚合错误，不能提供整批 Kubernetes 事务。Podry 沿用逐对象 partial 结果；P1 明确不同 GVR 的 Patch/Apply 策略，不能把原生类型的 StrategicMergePatch 无条件套用到全部 CRD。

## 8. 数据、接口与依赖如何取舍

### 8.1 数据概念映射

下表是领域概念对应，不是导入 Devtron 数据库的迁移方案。Podry 表定义以 [数据模型](../data/01-data-model.md) 为准；执行快照等合同缺口先在 B0 补齐。

| Devtron 概念/证据 | Podry 概念 | 实施决定 |
| --- | --- | --- |
| AppWorkflow / AppWorkflowMapping（S02） | pipelines、targets、bindings、workflowVersion | 固定一 CI 多 CD，模板事务自行实现，不移植任意 DAG |
| CiTemplate / CiPipeline（S04） | app_config_versions、CI Pipeline | 配置版本与执行记录分离，版本冲突明确返回 |
| CiWorkflow（S08、S29） | builds + build_attempts | Build 表达构建请求，Attempt 表达一次实际执行与固定输入 |
| CiArtifact（S14、S29） | artifacts | 记录 SHA/config/Attempt 来源与已复核 digest；不只保存 tag |
| UserDeploymentRequest（S19、S21） | release_requests | 受理意图持久化；可查询请求与实际 Deployment 的关系 |
| CdWorkflow / CdWorkflowRunner（S29） | deployments | P0 不拆 pre/post 多阶段引擎；部署执行与资源健康分开 |
| 配置合并/发布历史（S18） | deployment_previews、release_snapshots | 预览单次消费、不可变快照、Chart 校验值、敏感版本引用 |
| ResourceTree（S28） | deployment_resources + 实时 K8s 读取 | 保存必要身份，不镜像整个集群；不是 Devtron 资源树 JSON 原样落库 |
| Blob 日志（S16） | log_archives + 持久卷 | 归档位置、保留状态可查；首版不要求对象存储 |

### 8.2 API 与技术依赖

Devtron 使用 `/orchestrator/**`、`token` 请求头、部分 POST 查询与自己的 DTO；Podry 保留 [接口合同](../api/01-api-spec.md) 中的 `/api`、Bearer、错误体、202、幂等和 NDJSON。页面交互相近不要求两套接口兼容；本轮不改动既有 76 个 operationId 或重新生成 API。

| 参考实现 | Podry 的对应决定 |
| --- | --- |
| gorilla/mux、go-pg、Wire、Casbin | chi、pgx/sqlc、显式依赖装配及现有授权合同；只参考职责与校验顺序 |
| Git Sensor | 内部 Git 适配器；不把外部传感器部署作为 P0 前置服务 |
| Argo Workflow / system Job + CI runner | 只实现原生 Job + 受控 BuildKit runner；工具、结果协议、恢复均自行交付 |
| NATS 事件与订阅（S13、S30） | PostgreSQL 持久任务；内存通知只负责唤醒，不承担消息可靠性 |
| Kubelink Helm gRPC（S22） | 进程内 Helm SDK 适配器；自行承担连接配置、取消、超时和结果核对 |
| Argo / Flux 资源树与 GitOps | P0 不引入；应用资源观察由 Helm 和 Kubernetes 适配完成 |
| vendored common-lib K8sUtil | 研究 Discovery / Dynamic Client 用法；不整体带入 Devtron 公共依赖树 |

源码依赖版本仅描述这个提交，不作为 Podry 的兼容版本选择。T01 仍需记录实际运行环境并锁定 SDK、runner 与 Chart。若后续决定复制具体代码，应在对应实施提交记录来源和文件许可；本轮只新增对照文档，没有复制业务源码或品牌资产。

## 9. 开发任务补充与完成条件

以下补充并入原任务，不新建第二条开发路线，不因为已有参考源码而缩减 B4/B5 的实现与故障验收估算。

| 检查点 | 关联任务 | 必须形成的结果 |
| --- | --- | --- |
| SC01 参考与依赖边界 | T00、T01 | 固定参考提交；确认独立 Git/runner/Helm 适配；明确 Discovery partial/错误及合并规则的合同表示 |
| SC02 完整模板事务 | T12、T13 | CI/Binding/CD 失败回滚、并发模板幂等、setup 不虚报完成；对应第 3 节 |
| SC03 Job 部分创建恢复 | T15–T18、T24 | 固定 Job 名/UID、依赖 OwnerReference、暂停阶段恢复、结果与日志留存；对应第 4 节 |
| SC04 快照与凭据冻结 | T07、T16、T19 | 凭据轮换后旧执行恢复、旧 preview 校验、不可用历史版本明确失败；对应第 4/5 节 |
| SC05 发布未知结果核对 | T15、T20–T23 | 全活动任务扫描、跨管线物理目标互斥、Helm 超时保留占用、失败资源身份可查；对应第 5/6 节 |
| SC06 动态资源与权限 | T09、T10、T21、T23；P1 的 E06/E07 | Discovery 降级、分页授权、同名不同 UID 事件/日志、Secret 全出口脱敏、逐对象 partial；对应第 7 节 |

下一批仍按 T00–T04 开始：先修订合同并完成实际环境验证，再建立服务装配、数据库迁移与 CLI 账户认证。阅读了参考源码不代表 B0 环境验证已通过，更不代表任何业务接口已经交付。
