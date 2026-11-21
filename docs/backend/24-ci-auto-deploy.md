# E02 构建成功后的自动部署

日期：2026-11-21。业务已接入；使用隔离 PostgreSQL、本机 HTTP/HTTPS fixture 和发布 SDK fake 验证。没有访问真实 Git、BuildKit、Registry 或 Kubernetes，不能作为真实 CI/CD、工作负载健康或 B6 验收。

本批不新增 HTTP 操作。OpenAPI V1.18.0 仍为 77 个操作、74 implemented / 3 planned；扩展环境策略、绑定、工作流和构建详情合同。正式迁移 v16，35 张业务表。新二进制要求显式迁移到干净 v16；开发数据库未迁移。

## 配置与授权

自动部署必须同时具备以下条件：

1. 平台管理员创建 `production=false, autoDeployAllowed=true` 的环境。默认 false；生产与允许自动部署同时为 true 会被 API 和数据库拒绝。本批没有新增环境策略修改接口。
2. 应用绑定使用 `autoDeploy=true`。独立创建绑定或调整开关只设置准入门槛，不创建工作流或自动授权；更新仍检查版本、前后资源权限和目标占用。
3. 该绑定有启用的 CD，`triggerMode=on_ci_success`，`upstreamPipelineId` 明确指向本应用的唯一 CI。手动/Push 构建都可以触发；镜像导入没有 CI，不能使用此模式。
4. 保存自动 CD 的用户拥有当前项目 deploy 权限，以及有效配置中全部资源和 Helm 存储 Secret 的写权限。保存者作为持久委托身份写入 `pipeline_deploy_authorizations`；不会使用 CI 请求者、GitHub sender 或匿名服务管理员身份。

直接保存工作流必须填写上游 ID。`build_deploy`、`add_deploy` 模板可以传 null，由服务在同一事务解析新建/已有 CI；显式错误的上游 ID 不会被覆盖。禁用的自动 CD 不保存委托，也不能配置到未允许自动部署的环境。生产 CD 始终只能手动。

已有应用可先将允许环境中的绑定设为 autoDeploy=true，再保存自动 CD；关闭时可将 CD 禁用或改回 manual。已排队/在途/unknown 发布占用目标时，绑定更新仍返回 target_busy；关闭 CD 不需要修改占用中的绑定。

示例：

```json
{
  "kind": "cd",
  "bindingId": "<binding UUID>",
  "enabled": true,
  "definition": {
    "triggerMode": "on_ci_success",
    "upstreamPipelineId": "<CI UUID>",
    "deployTimeoutSeconds": 600
  }
}
```

该示例是 `PUT /api/apps/{appId}/pipelines` 的 items 元素；请求同时携带当前 expectedVersion 和完整工作流，已有元素携带 id。模板/工作流保存本身不开始构建或发布。自动 CD 仍允许经人工预览、确认进行手动发布。

## 持久触发与版本边界

v16 的 Build INSERT 触发器在构建准入**同一事务**创建 `auto_deploy_intents`。它只捕获当时已经启用、具有明确委托且环境/绑定均允许自动部署的下游 CD，固定：

- Build、CI/CD、Binding、委托用户身份。
- configVersion、workflowVersion、CI/CD version、bindingVersion。
- 每个 `(build_id,pipeline_id)` 唯一，身份字段和终态不可改写、历史不可删除。

手动构建和 GitHub Push 都复用此入口；Build/Attempt/Delivery/审计任一失败，意图与构建一起回滚。数据库触发器使用调用者权限，未使用 SECURITY DEFINER。服务角色需要对应表的显式授权。

不会扫描历史 Artifact 补建意图。自动部署开启前已准入的构建、外部镜像导入都不会补发。较早构建在开启策略后才成功，也不会被新策略接管。

构建必须原子提交 succeeded 状态和经过既有校验的 Artifact，协调器才读取意图。queued、running、failed、canceled、unknown 不会触发发布。失败/取消后意图保持 waiting，保留给同一 Build 的显式重试；重试成功仍须满足**原始**冻结策略，新增/重存策略不会追溯授权。没有成功产物时不会反复领取该意图。

任何配置、整个工作流、CI/CD 或绑定版本变化都使旧意图失效；即使保存内容相同也会递增相应版本。此策略选择跳过旧构建，不自动改用最新部署参数。需要按当前策略重新触发一个新 Build。不同 Build 没有“只发布最新提交”的隐式语义；目标空闲且原策略仍有效时逐个准入。

## 发布准入和状态查询

进程内本地协调器每 2 秒尝试处理一条成功构建的意图，不执行网络操作。它先在短事务内重验委托用户、项目权限、目标授权、环境策略及全部冻结版本，再使用该 Build 的准确 Artifact 调用现有发布规划逻辑；事务外通过内置 Helm Chart 渲染。

最终事务再次重验全部输入和授权，检查既有资源动作排他及发布目标占用，然后原子创建并消费内部预览、冻结 ReleaseSnapshot、创建 ReleaseRequest/Deployment、更新意图和写审计。继续由既有 Helm Worker 执行、观察和恢复；没有第二套外部执行器。

协调器没有外部副作用，不需要外部执行 lease：渲染前后崩溃时没有部分请求；并发实例可以重复本地渲染，但最终按应用/意图/目标锁串行提交，终态和唯一约束保证一条意图最多一个发布请求。数据库错误导致事务回滚，之后可以继续处理。执行器关闭或目标忙时不创建预览/快照/发布记录。

`GET /api/builds/{buildId}` 在存在意图时返回可选 `autoDeployments[]`：

| 字段 | 含义 |
| --- | --- |
| id / pipelineId / bindingId | 持久意图和下游身份 |
| status | waiting、blocked、dispatched、skipped |
| errorCode | 安全错误码；不包含外部响应、密钥或原始数据库错误 |
| requestId | 仅 dispatched 有值，用已有发布请求/执行查询接口继续跟踪 |
| createdAt / updatedAt | 创建和最后处理时间 |

| 状态 | 行为 |
| --- | --- |
| waiting | 等待该 Build 提交成功产物；失败/取消后可以显式重试 Build，unknown 不会触发 |
| blocked | 执行器未启用、目标忙、凭据/数据库暂时不可用；30 秒后重新准入，始终重验策略；重复相同原因不重复写状态审计 |
| dispatched | 已在同一事务创建唯一发布任务；不等于 Helm 成功、镜像可拉取或应用健康 |
| skipped | 冻结版本/策略失效、账号禁用、撤权、归档或不可接受的输入；终态，不自动恢复或追溯补发 |

构建列表/触发响应不展开意图，无意图的构建详情也省略该字段。读取仍要求当前应用查看权限。审计增加 deployment.auto.blocked / skipped / dispatched，保留原始委托身份。

进入发布队列后，Helm Worker 在提交外部请求前再次检查自动策略、当前委托、版本、项目/目标/Secret 权限。尚未提交时关闭 CD 或修改策略会使发布失败并记录 release_authorization_revoked。已经提交的发布继续观察真实结果，不用撤权来掩盖外部状态；是否重新发布由用户决定。

## 停机、恢复和运行角色

构建、Helm 发布、资源写入三个执行 Worker 继续默认关闭。自动准入协调器复用 Bootstrap 的 drain/work 与统一停机 deadline；它可以记录 blocked，但只有现有发布执行器 Ready 才能创建发布请求。启用执行器会处理符合**原冻结策略**的等待项，需要在启用前按业务意图关闭不需要的 CD。

恢复必须保留 v16 两张新表、Build/Attempt/Artifact、预览/快照/请求/执行、原委托用户及审计。先隔离旧实例并关闭三个执行 Worker，按现有外部执行核对流程恢复。不要删除意图、手工重写终态或伪造成功产物。存在自动环境/绑定/CD 配置或意图历史时，v16 降级拒绝；空配置和无历史允许回 v15，之前的历史降级保护仍有效。

服务角色增量：

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON pipeline_deploy_authorizations TO podry_service;
GRANT SELECT, INSERT, UPDATE ON auto_deploy_intents TO podry_service;
```

仍需既有 Build、Artifact、工作流、预览、发布和审计权限。Build 捕获触发器不能靠高权限绕过授权；最小角色集成验证包含完整自动委托、捕获、发布入队和禁止删除历史。

## 验证范围与后续

集成覆盖环境生产限制、模板委托、构建准入触发器、失败构建等待、精确产物交接、既有发布 Worker 正向提交/观察和成功指针更新、并发去重、审计失败整体回滚、服务重建恢复、关闭执行器无副作用、目标占用、版本变化/撤权/禁用/环境关闭、委托与浏览器会话独立、排队后策略撤回及历史迁移保护。

本批没有启动本地 Gitea/Registry 或远端集群，没有改变执行开关，没有前后端联调。GitLab/Gitea Webhook、后台健康、unknown 人工处置、通用 Apply 排他、P2 Secret/exec 和真实 CI/CD/B6 仍需后续独立开发或验收。GitHub Push 的签名与 Delivery 合同见 [首批记录](23-git-webhooks.md)。

最终验证：全量 142 个顶层、70 个子用例通过，1 个真实集群用例跳过；增强的自动发布 Worker 正向专项单独通过。内部包/命令包测试、sqlc vet/16 文件和 OpenAPI 隔离生成一致性、Compose/文档/空白检查通过。完整数量、首次失败修正和日志记录见根目录 [开发进度](../../DEVELOPMENT_PROGRESS.md)。
