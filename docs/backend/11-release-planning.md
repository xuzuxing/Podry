# 离线发布预览与发布事务

> 本页保留 v5 批次的范围和验证记录。后续已接入默认关闭的持久 Helm 执行器、目标占用与观察恢复，当前要求迁移 v6，接口为 59 implemented / 17 planned；详见 [发布执行与恢复](12-release-execution.md)。下文“执行器未接入”是本页历史状态。

日期：2026-11-20。用户确认 Gitea、Registry 容器暂不可用，要求跳过 CI/CD 实际执行。本批交付 B5 的发布规划与查询业务，不启动、修复这些容器，也不向真实 Kubernetes 提交资源。

## 当前范围

正式迁移增加至 **v5**，共 26 张业务表（不含 schema_migrations）；设计稿仍为 31 表。新增 deployment_previews、release_snapshots、release_requests、deployments。OpenAPI 共 76 个操作：58 个已实现、1 个部分实现、17 个未注册。

| 接口 | 本批行为 |
| --- | --- |
| `POST /apps/{appId}/deployment-previews` | 201；固定产物、权限检查、离线 Helm 渲染、脱敏 Values 与差异、10 分钟有效期 |
| `GET /apps/{appId}/deployments` | 200；按应用与 bindingId 过滤分页，空历史如实返回空数组 |
| `GET /release-requests/{requestId}` | 200；独立 requestId 与 deploymentId，检查应用可见性 |
| `GET /deployments/{deploymentId}` | 200；读取持久执行记录，不合成执行成功或 Helm revision |
| `POST /apps/{appId}/deployments` | **部分实现**：确认事务具备业务实现；生产执行器未装配，新的有效确认返回 503 `deployment_execution_unavailable`，不消费预览、不创建任务、不保留幂等占位 |

当前没有开启发布的环境变量。`UseReleases` 供后续能够消费持久任务的发布执行器装配使用；本批只在隔离测试中接入本地就绪检查，验证确认事务。它不证明已具备 Helm 执行、目标占用、状态观察或恢复能力。

预览要求应用已有该应用的已验证 Artifact、基础配置、环境绑定和已启用的手动 CD。不会为演示插入产物，不使用本地 Registry 镜像标签代替 Artifact；尚无构建产物的应用仍须等待 CI 联调或后续已有镜像导入能力。

## 固定 Chart 与敏感版本

`internal/chart` 使用 Helm SDK v3.20.1 的离线 engine 渲染随二进制嵌入的 Chart `podry/1.0.0`。Chart 支持 Deployment、一次性 Job，以及显式启用的 ClusterIP Service/Ingress；没有用户模板、hook、外部依赖、DNS 查询或 Kubernetes REST 客户端。Ingress 需要启用 Service 并设置 host。

Chart 包采用稳定文件顺序、时间和权限，固定 SHA-256 为 `ec64a72850fb0eba6408e24703ba31331f9e34172a5163b58b2badb469452228`；源码变化必须更新版本及经审阅的摘要。归档内容与摘要保存在不可变快照内，不依赖后续二进制仍保留原 Chart 文件。每份预览同时冻结渲染后的 Values、脱敏 Manifest 及其 SHA-256。

镜像与平台标签在受控渲染时注入，来自 Artifact 的 `repository@sha256:...`；用户 Values 无法覆盖它们。预览时预留 requestId/deploymentId，一次性 Job 名称由预留 deploymentId 派生；同一次确认和重放沿用该身份，不同预览使用不同 Job 名称。Deployment 的 selector 与 Service selector 不包含每次变化的执行 ID。

`SecretRef.targetKey` 同时表示版本化凭据 `payload.data` 中的来源键和容器环境变量名。预览检查准确版本可以解密、存在该键、操作者有权引用；仅保存凭据 ID/版本/键，公开 Values 与 Manifest 使用 `<redacted>` 占位（Secret 的 data 为该占位的 base64）。未来执行器须在内存解析这些准确版本后填入 Chart 的 `podry.secretData`，本批不执行该步骤，也不把明文保存在发布记录或审计中。

凭据轮换保留原 Secret 版本，已有预览继续引用冻结版本。目标集群认证引用也被冻结；集群凭据版本变化则使未消费预览失效，要求重新生成。

## 预览与确认边界

预览先在短事务中读取、授权并冻结输入，在事务外渲染，保存前再检查应用配置、workflow/CD、绑定和集群认证版本。只读取本地 PostgreSQL 和加密凭据，不查询 Git、Registry 或集群。

`diff.before` 来自该绑定上次成功发布的平台快照，没有成功发布时为空；`diff.after` 为本次脱敏渲染结果。响应 warnings 明确说明它不是集群实时漂移检查。`GET /deployments/{deploymentId}/diff` 的实时差异合同仍未实现，不以历史快照冒充当前资源。

确认校验预览创建者、10 分钟有效期、配置/绑定/workflow/CD/集群认证版本、当前项目部署权限和目标资源授权。执行器未接入时返回 503，客户端可保留输入，待恢复后重新生成过期预览。

接入可消费任务的执行器后，已实现的确认事务会原子消费预览、保存不可变 ReleaseSnapshot、创建 queued ReleaseRequest 和预留 Deployment、保存幂等响应与审计；不会先调用远端再补记数据库。相同幂等键返回原结果，不同键消费同一预览返回 409 `preview_consumed`；过期返回 410 `preview_expired`，版本变化返回 409 `revision_conflict`。重放仍重验当前应用和目标授权。

数据库约束冻结预览输入和发布快照。应用存在 queued/submitting/observing/unknown 发布时拒绝归档，避免活动任务失去所属应用。当前不移动 `currentDeploymentId`、不更新应用健康、不创建资源归属记录。

## 调用示例

先显式执行 `podry migrate up` 升级数据库；API 启动仍不自动迁移。`$appId`、`$bindingId`、`$artifactId`、`$configVersion` 和 `$headers` 取已有授权对象与登录结果，不包含演示假 ID。

```powershell
$body = @{
    bindingId = $bindingId
    artifactId = $artifactId
    expectedConfigVersion = $configVersion
} | ConvertTo-Json
$preview = Invoke-RestMethod -Method Post -Uri "http://localhost:8080/api/apps/$appId/deployment-previews" -Headers $headers -ContentType 'application/json' -Body $body
$preview.diff
# 当前发布执行器未接入，确认接口返回 503，不会生成假任务。
```

实际服务端口以部署配置为准。

## 验证与后续

已执行以下检查；测试使用隔离 PostgreSQL、受控测试 Artifact 与内置 Helm Chart，不依赖用户当前不可用的 Gitea/Registry。它们不构成真实 CI/CD 执行证据。

| 检查 | 结果与证据边界 |
| --- | --- |
| `./scripts/test-backend.ps1` | 45 个顶层用例、6 个 Token 子用例通过；1 个真实集群用例因未设置 `PODRY_TEST_KUBE_PAYLOAD` 跳过；包含 go vet、go build、Linux 测试/服务编译及真实 PostgreSQL 迁移与回归 |
| 新增 5 个发布 HTTP/数据库用例 | 离线渲染与 Secret 脱敏、执行器缺失不留任务/幂等占位、并发确认单次消费、重放、历史授权与活动发布归档保护、预览过期、配置/CD 变更、创建者/绑定/产物归属、Secret 原版本与目标授权撤销、不同 Job 预留名称 |
| `go test ./internal/chart -count=1 -v` | 通过；Chart 归档可由 Helm loader 读取、摘要与渲染稳定、YAML 可解析、固定 digest 与字面环境变量不被重新解释 |
| `sqlc vet` 与重新生成前后 SHA-256 对比 | 通过；生成文件可复现，未手改生成代码 |
| 文档与合同检查 | 35 个 Markdown、375 个本地链接、76 个操作、238 个 schema 引用、31 张设计稿表的结构检查通过；OpenAPI 分期为 58 implemented / 1 partial / 17 planned |

无权查询发布历史的账号沿用项目现有的 404 策略，隐藏对象存在性；跨操作者确认预览和撤销目标授权后确认返回 403。

后续 B5 仍需实现 Helm 提交、同物理目标占用、unknown 核对与发布恢复、Deployment/Job 分别观察、资源 UID/OwnerReference 关联及实时差异。B4 真实远端 CI 与 B6 端到端故障验收继续等待环境恢复。
