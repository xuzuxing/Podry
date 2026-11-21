# HTTP 接口与流协议

版本 V1.8，设计合同；身份、管理、应用配置、工作流、Git 查询、Kubernetes 资源/日志、构建/产物/日志、发布预览/确认与历史、应用资源和实时 Diff 共 61 个操作已实现，其余 15 个仍为设计。当前增量见 [应用资源与健康观察](../backend/13-application-observation.md)，前批见 [发布执行与恢复](../backend/12-release-execution.md)、[发布规划](../backend/11-release-planning.md)、[构建执行](../backend/09-build-execution.md) 与 [Kubernetes 读取](../backend/08-kubernetes-resources.md)。机器合同：[OpenAPI 3.1](openapi.json)，设计源：[build-openapi.mjs](../tools/build-openapi.mjs)。隔离数据库及模拟执行测试不等于真实 CI/CD 验收，构建/发布 Worker 默认关闭。数据字段以 OpenAPI Schema 与 [数据模型](../data/01-data-model.md) 为准。新增合同来自[新应用实际操作](../references/devtron-onboarding/README.md)，不能当作 Devtron 原生接口抓包结果。

## 1. 通用约定

Git/Registry 默认要求 HTTPS；开发环境 HTTP 服务需通过 `PODRY_HTTP_ALLOWED_HOSTS` 配置精确 host:port。URL 不能内嵌凭据，禁止重定向；Kubernetes 继续要求 HTTPS。详见 [本地 CI 示例](../backend/10-ci-local-demo.md)。

- 前缀 `/api`；JSON 使用 camelCase；UUID 作为字符串，时间为 RFC3339 UTC。
- 成功直接返回业务对象。同步创建 201，异步创建任务 202，删除成功 204；204 无响应体。
- 错误为 `{ "error": { "code": "revision_conflict", "message": "配置已更新，请重新预览" } }`；请求 ID 通过 `X-Request-ID` 响应头返回，不扩展现有错误体的必填字段。
- 认证为 `Authorization: Bearer <accessToken>`；每次请求校验用户状态、tokenVersion、目标归属及权限。登出增加 tokenVersion 使既有访问 Token 失效；首版无 Refresh Token 协议。
- 普通列表 `page` 从 1 开始、`pageSize` 默认 20、最大 100，返回 `{items,total,page,pageSize}`。K8s 列表返回 `{items,continueToken,resourceVersion}`，不假定有精确 total。
- 查询未授权业务对象返回 404 或符合平台策略的 403，不能返回其详情。所有 Secret/凭据/票据接口 `Cache-Control: no-store`。
- 请求超时不自动重试写接口；幂等重试必须复用相同 `Idempotency-Key` 和相同请求内容。

### 幂等与版本

构建触发/重试/取消、发布/晋级/回滚、资源操作、资源 Apply 均要求 `Idempotency-Key`。唯一作用域为 `(userId, operationId, key)`，绑定 method/path 与规范化 requestHash。相同键相同请求返回原状态码与结果；相同键不同内容返回 `idempotency_conflict`。结果至少保留 24 小时，运行中或 unknown 记录不得过期。

配置 PUT 使用 `expectedVersion`；资源更新使用读取时的 UID/resourceVersion，删除必须携带 UID。预览不可代替提交时再次授权和校验。

## 2. 端点清单

完整方法、字段及响应见 OpenAPI，以下为业务索引。

| 分组 | 主要端点 | 说明 |
| --- | --- | --- |
| 身份 | `POST /auth/login`、`GET /auth/me`、`POST /auth/logout` | 登录、身份、退出；无自助注册 |
| 归属 | `GET/POST /teams`、`GET/POST /projects`、各自 `/members` | 创建归属、关联已有用户、调整角色；不能通过成员接口创建账户 |
| 平台 | `GET/POST /clusters`、`GET/PATCH /clusters/{clusterId}`、`POST .../connection-tests` | 集群接入、状态与凭据更新 |
| 平台 | `GET/POST /environments`、`GET/POST /credentials`、`GET/POST /registries` | 环境、加密凭据和镜像仓库配置 |
| 授权 | `GET/POST /clusters/{clusterId}/resource-grants`、`DELETE .../{grantId}` | 管理员配置资源授权；凭据轮换使用 `PUT /credentials/{credentialId}` |
| 应用 | `GET/POST /apps`、`GET/PATCH /apps/{appId}` | 列表、新建、基础信息与归档 |
| 配置 | `GET/PUT /apps/{appId}/config` | 读取/创建配置版本 |
| 首次配置 | `GET /apps/{appId}/setup` | 当前步骤、阻塞原因、canBuild、deployableBindingIds；服务端派生 |
| 模板创建 | `POST /apps/{appId}/workflow-templates` | build_deploy 原子建立 CI/Binding/CD；add_deploy 原子补充部署步骤；要求幂等键 |
| 代码选择 | `GET /apps/{appId}/git/branches`、`GET .../git/commits` | Select Material 的只读分支和提交查询，完整 SHA 与 configVersion |
| 绑定 | `GET/POST /apps/{appId}/environments`、`PUT /apps/{appId}/environments/{bindingId}` | 目标绑定、触发策略和环境覆盖 |
| 工作流 | `GET/PUT /apps/{appId}/pipelines` | 一个 CI、多 CD 的定义；expectedVersion |
| 构建 | `GET/POST /apps/{appId}/builds` | 构建历史、触发构建 |
| 构建 | `GET /builds/{buildId}`、`GET .../attempts`、`POST .../cancel`、`POST .../retry` | 详情、尝试历史、取消和新 attempt |
| 产物 | `GET/POST /apps/{appId}/artifacts` | 查询产物、已有镜像导入并固定 digest |
| 发布 | `POST /apps/{appId}/deployment-previews` | 生成脱敏快照、Diff、短期 previewId |
| 发布 | `GET/POST /apps/{appId}/deployments` | 查询部署记录、消费 previewId 创建发布请求 |
| 发布 | `GET /release-requests/{requestId}`、`GET /deployments/{deploymentId}` | 请求与执行详情，两个状态各有明确含义 |
| 发布 | `POST /deployments/{deploymentId}/promote`、`POST .../rollback` | 创建新请求，原记录不可变 |
| 运行 | `GET /apps/{appId}/resources` | 根据绑定和资源清单返回当前对象关系 |
| 资源 | `GET /clusters/{clusterId}/discovery`、`GET .../namespaces` | 可访问资源类型及 Namespace |
| 资源 | `GET /clusters/{clusterId}/resources`、`GET .../resource`、`GET .../events` | 资源列表、详情和事件 |
| 资源写入 | `POST .../resources/dry-run`、`POST .../resources/apply` | 多文档预览和逐对象提交 |
| 资源操作 | `POST .../resource-actions`、`GET /resource-operations/{operationId}` | 删除、重启、扩缩容及任务结果 |
| Secret | `POST .../secrets/reveal` | 单独授权获取指定 key 明文，审计且禁止缓存 |
| 流 | `GET /builds/{buildId}/logs`、`GET .../pod-logs` | 认证 Fetch 流 |
| 终端 | `POST .../exec-sessions`、`DELETE /exec-sessions/{sessionId}` | 创建短期会话及关闭 |
| Webhook | `POST /webhooks/git/{provider}/{pipelineId}` | provider-specific 验签，不使用用户 Bearer |
| 审计 | `GET /audit-events` | 按授权范围过滤，不返回敏感原文 |

平台配置 POST/PATCH 由管理员调用；凭据字段只写入、不回传。Namespace 创建/删除通过通用资源接口进行，权限独立。首版不提供进行中的发布取消和节点 Drain 接口。

工作流配置定义：CI 的 definition 包含 manual、push、branch、webhookCredentialId；CD 包含 triggerMode（manual/on_ci_success）、upstreamPipelineId、deployTimeoutSeconds。服务端验证 definition 与 kind 匹配、上游属于同应用、首版生产绑定只能手动；工作流集合的 version 来自 applications.workflow_version。

### 首次配置与完整工作流合同

`POST /apps` 可选 cloneFromAppId。克隆要求读取源应用和配置所引用凭据的权限，以及目标项目配置权限；sourceMode 必须匹配源应用。只复制获准的配置快照，镜像 Repository 生成新应用自己的值，不复制凭据明文、流水线、目标绑定、构建、产物或运行资源；整个应用创建/快照复制为一个事务。若引用在目标作用域无权使用则拒绝创建，不静默扩大授权。Tags 本期只保留原型展示入口，尚无标签读写合同。

`GET /apps/{appId}/config` 在尚无配置时返回虚拟 version=0：gitConfig/buildConfig/chartConfig 为 null，deployValues={}，secretRefs=[]；数据库不写 version=0 行。第一次 Save 使用 expectedVersion=0。`PUT .../config` 增加 section=git/build/base，仅接受该节字段：git 接受 gitConfig；build 接受 buildConfig；base 接受 chartConfig、deployValues、secretRefs。其他节字段返回 422 validation_failed。服务端按 expectedVersion 读取完整快照，合并所保存节，追加新版本；不能用空表单覆盖其他节。

GitConfig.accountMode=public 时 credentialId=null；credential 模式必须引用可用、已授权的 Git 凭据。repositoryUrl 仅接受无内嵌用户/口令的 HTTPS 地址。BuildConfig 的 dockerfile、context 都相对仓库根目录，禁止绝对路径、`..` 越界和符号链接逃逸；platform 首版只接受 linux/amd64 或 linux/arm64，执行前校验 CI 节点/Builder 与目标平台的适配，不自动假定 QEMU 存在。

Base 的 chartConfig 指定 workloadKind（Deployment/Job）和平台内置 chartVersion。配置未显式保存前为 null，不能因为部署参数有默认值就算完成。第一次保存后 workloadKind 固定，改变返回 409 chart_type_locked；服务端验证版本来自内置允许列表。Job 参数只允许单次任务约定，禁止偷偷注入 CronJob、Service、Ingress 或 HTTP 就绪探针。它们不是用户可写的任意 Helm Chart 合同。

`GET .../setup` 按当前快照和启用的流水线派生：Git 模式 total=4，镜像模式 total=2（Git/Build 为 not_required）；workflow 仅在所需 CI 和至少一条可用 Binding/CD 均存在时完成。steps 标为 complete/pending/blocked/not_required，blockers 提供下一配置节。canBuild 只描述保存后的配置资格，不承诺 Git 当前可达；当前 deployableBindingIds 检查执行器开关、已启用 CD、已验证 Build/Attempt 产物、渲染配置、deploy 角色、目标写权限和准确版本凭据/Secret，不访问外部服务。预览、确认和 Worker 继续检查选定输入及目标占用。前端无需维护另一个 configured 真值。

当前 B4 已接入构建执行器：执行环境启用且配置有效、Git/Build/手动 CI 完整、平台匹配、应用未归档并具有 build 权限时 canBuild=true；它只表示配置资格，不主动探测网络。缺少上述条件时保留 execution_unavailable blocker。deployableBindingIds=[] 仍等待 B5；completed 只表示配置完整度，保存模板不代表构建/发布已经成功。

主要创建请求示例（均为 Podry UUID 样例）：

```http
POST /api/apps/a1000000-0000-4000-8000-000000000001/workflow-templates
Idempotency-Key: create-source-delivery-001
Content-Type: application/json
```

```json
{
  "template":"build_deploy",
  "expectedConfigVersion":3,
  "expectedWorkflowVersion":0,
  "ci":{"manual":true,"push":false,"branch":"master","webhookCredentialId":null},
  "deployment":{
    "binding":{
      "environmentId":"e1000000-0000-4000-8000-000000000001",
      "target":{"clusterId":"c1000000-0000-4000-8000-000000000001","namespace":"shop-dev","releaseName":"hello-world"},
      "overrideValues":{},"autoDeploy":false
    },
    "definition":{"triggerMode":"manual","upstreamPipelineId":null,"deployTimeoutSeconds":600}
  }
}
```

201 响应为 `{workflow,bindings,setup}`。build_deploy 的 null upstreamPipelineId 是请求占位，服务端改成新 CI UUID 后保存，响应中必须为实际 ID。expectedConfigVersion/expectedWorkflowVersion 同时检查；保存不会执行构建或部署。Namespace 是所选目标的值，服务端不盲信前端只读输入，必须检查授权。Binding.autoDeploy 与 CD.triggerMode 必须一致；测试和生产只能 manual。Environment.autoDeployAllowed 默认 false，由管理员仅对开发环境显式开启；production=true 强制 false，服务端不通过字符串名称猜环境权限。

模板分为 build_deploy（CI+Binding+CD）、build_only（只有 CI，允许 3/4）、external_image（Binding+CD，无 CI）、add_deploy（引用已有 CI 原子追加 Binding+CD；镜像模式上游为 null）。创建新流程遇到既有 CI 返回 409 workflow_exists；首版不能创建第二条 CI。目标冲突返回 409 target_conflict，缺少前置配置返回 422 prerequisite_missing，版本冲突返回 409 revision_conflict。任何失败均回滚 CI、Binding、CD 和工作流版本；相同幂等键重试返回原结果。现有 Binding/Workflow 独立接口保留给分步管理，但单独的 Binding 草稿不算完整部署管线，不自动解锁 Environment Overrides。

提交查询不返回合成内容：网络失败为 503 git_unavailable；认证失败、仓库错误、分支不存在分别为 422 git_auth_failed / git_repository_invalid / git_ref_not_found。错误信息脱敏。成功但列表无结果返回 items=[]。选择器在失败或无选中提交时禁用 Start Build；不会因此创建 failed Build。真正执行阶段的 clone 失败才产生 failed 构建记录。

BuildAttempt.logAvailability=runtime/archived/unavailable/expired，由 worker 与日志归档元数据派生，独立于 status。日志 GET 在开始流之前发现不可用时返回 404 log_unavailable 的 JSON 错误；已经打开的流用 error/end 事件结束，不伪造成功日志。镜像产物接口不能因历史日志缺失而隐藏成功产物。

## 3. 典型调用

### 3.1 触发构建

```http
POST /api/apps/a1000000-0000-4000-8000-000000000001/builds
Authorization: Bearer <accessToken>
Idempotency-Key: build-checkout-20261119-01
Content-Type: application/json

{"commitSha":"abcdef0123456789abcdef0123456789abcdef01","expectedConfigVersion":3}
```

202 返回 Build：

```json
{
  "id":"b1000000-0000-4000-8000-000000000001",
  "appId":"a1000000-0000-4000-8000-000000000001",
  "status":"queued",
  "commitSha":"abcdef0123456789abcdef0123456789abcdef01",
  "configVersion":3,
  "attemptNo":1,
  "artifactId":null,
  "createdAt":"2026-11-19T02:00:00Z"
}
```

取消返回当前 Build，可能是 canceling；重试返回同 Build 的新 attemptNo。unknown 状态拒绝重试并返回 `outcome_unknown`。

### 3.2 发布预览与确认

```json
{
  "bindingId":"e1000000-0000-4000-8000-000000000001",
  "artifactId":"f1000000-0000-4000-8000-000000000001",
  "expectedConfigVersion":3
}
```

发送到 `POST /apps/{appId}/deployment-previews`。响应包含 previewId、expiresAt、固定 imageRef、目标、脱敏 Values、Diff 和 warnings。预览有效期默认 10 分钟，存入数据库；预览过期、绑定版本或配置变更时必须重新预览。

当前已实现离线内置 Chart 预览，要求已有本应用的已验证 Artifact 与已启用的 CD。预览 Diff 比较平台上次成功发布的脱敏快照与本次渲染结果，不查询集群实时资源；warnings 明确该边界。`SecretRef.targetKey` 同时选择准确凭据版本的 `payload.data` 键和目标环境变量名。发布 Worker 已接入，`PODRY_RELEASE_ENABLED=false` 为默认值，此时新确认返回 503 `deployment_execution_unavailable`，不会消费预览或创建任务；显式开启后按以下合同持久接收 202。后续 Worker 占用目标并提交 Helm，unknown 保留占用且只核对、不重放。历史查询提供 startedAt/finishedAt/errorCode；资源归属、实时 Diff、健康观察和 setup 发布候选见 [应用资源与健康观察](../backend/13-application-observation.md)，执行恢复见 [发布执行与恢复](../backend/12-release-execution.md)。

`GET /deployments/{deploymentId}/diff` 比较不可变快照期望与当前根 UID 的实时读取，要求 app.view 与所有根类型的 resource.view。两边统一清理服务端状态/版本字段并脱敏；Secret 仅比较类型、键名和元信息。缺失对象从 after 省略，未记录 UID 或同名替换返回 409，上游失败返回错误。

`GET /apps/{appId}/resources?bindingId=...` 从记录的根 UID 与控制器 OwnerReference 读取根资源及 ReplicaSet/Pod 后代，逐类型过滤授权并脱敏。资源读取刷新 60 秒健康观察，详情/列表/health 筛选使用该投影；过期、新执行/revision、绑定修改或集群凭据轮换后为 unknown。Deployment 就绪为 healthy，Job 还需匹配的成功 Pod 才为 completed；没有后台健康轮询。应用摘要 health 需要 app.view，对象内容仍需要 resource.view。

确认 `POST /apps/{appId}/deployments`：

```json
{"previewId":"d1000000-0000-4000-8000-000000000001"}
```

202 返回 `ReleaseRequest`，包含 requestId、status、kind、bindingId、snapshotId、deploymentId（尚未创建时为 null）。前端先查询 `/release-requests/{requestId}`，拿到 deploymentId 后显示部署详情。不得把请求 ID 当作部署 ID。

`promote` 携带目标 bindingId 和 expectedConfigVersion，服务端复用源 artifact；`rollback` 以路径中的成功 Deployment 为源，在同绑定生成新请求。两种操作均返回 ReleaseRequest。

### 3.3 资源定位

```json
{
  "group":"apps",
  "version":"v1",
  "resource":"deployments",
  "namespace":"shop-dev",
  "name":"checkout-api",
  "uid":"21ee0000-0000-4000-8000-000000000001",
  "resourceVersion":"4821"
}
```

URL 的 clusterId 与此引用共同形成目标。core API group 使用空字符串。集群级资源省略 namespace。使用 GVR 解析 REST 路径，不假定 Kind 加 s 就是 resource 名称。

`POST .../resources/dry-run` 请求为 `{documents:[{manifest,expectedUid?,expectedResourceVersion?}]}`。响应 `previewId`、`expiresAt`、`items[{index,ref,action,diff,valid,error}]`。执行时提交 previewId，服务端复用固定文档并再次校验；支持 `stopOnError`，默认 false。

Apply 返回 `ResourceOperation` 的 202 任务引用；查询结果包含逐对象 `succeeded / failed / skipped`、ref、错误。整个 operation 可以 `partial`，不把部分成功转换为通用“全部失败”。

`POST .../resource-actions` 使用 `action=delete|restart|scale`、完整 ref 和 `replicas?`、`propagationPolicy?`。修改副本与重启先检查 Kind、HPA 和引用版本；不在浏览器执行 kubectl shell 字符串。

## 4. 流式日志

构建日志：`GET /builds/{buildId}/logs?attemptNo=1&follow=true&cursor=<opaque>`。响应 `application/x-ndjson`，每行一个事件：

```json
{"type":"log","cursor":"opaque-12","stage":"build","timestamp":"2026-11-19T02:00:01Z","message":"pushed image digest sha256:..."}
{"type":"status","status":"succeeded","cursor":"opaque-13"}
{"type":"end","cursor":"opaque-14"}
```

Pod 日志：`GET /clusters/{clusterId}/pod-logs?namespace=...&name=...&uid=...&container=...&tailLines=200&previous=false&follow=true`，同样 NDJSON；包含 log/end/error，不承诺和 Build 归档日志相同的断点恢复能力。历史实例已清理时返回明确错误。

浏览器使用带 Authorization 的 Fetch ReadableStream；不将长期 Bearer Token 放查询串，不使用无法附加认证头的裸 EventSource。流开始前的错误走 HTTP 状态，开始后的错误走 `type=error` 事件。客户端离开上下文时 Abort；连接中断显示断线，可重新请求，不推导执行失败。

## 5. Pod 终端协议

1. POST exec-sessions，提交 Pod ref、container、command 数组、tty；服务端验证 `pod.exec` 和 Pod UID。
2. 响应 sessionId、expiresAt、webSocketPath、一次性 ticket。ticket 默认 30 秒有效且只可消费一次。
3. 客户端通过响应中的同源 ws/wss 路径连接，使用 `Sec-WebSocket-Protocol`：`podry.exec.v1` 与 `ticket.<base64url-ticket>`；服务端验证 Origin、用户、ticket、会话归属，只回显正式协议名。网关禁止记录 ticket 协议值。
4. JSON 帧：客户端 `{"type":"stdin","data":"ls\n"}`、`{"type":"resize","cols":120,"rows":36}`、`{"type":"close"}`；服务端 `stdout/stderr` 的 data，`exit` 的 code，或 `error` 的 code/message。
5. 会话空闲默认 10 分钟关闭；Pod 替换、权限撤销或页面离开时关闭。DELETE 会话也必须检查用户归属。

此 WebSocket 协议通过本文定义；OpenAPI 仅覆盖会话 HTTP 创建/关闭。

## 6. 错误码与前端动作

| HTTP | code | 前端动作 |
| --- | --- | --- |
| 400 / 422 | validation_error | 保留输入，定位错误字段或文档序号 |
| 401 | unauthorized | 结束流与终端，提示重新登录 |
| 403 | forbidden | 显示无权限，不显示敏感数据 |
| 404 | not_found | 清理旧对象上下文，提示删除或无访问权 |
| 409 | revision_conflict | 保留草稿，重新读取和 Diff |
| 409 | target_busy | 展示占用的任务入口，禁止重复发布 |
| 409 | outcome_unknown | 显示核对中，不自动重试 |
| 409 | idempotency_conflict | 更正客户端重复使用不同请求的键 |
| 409 | secret_version_unavailable | 重新选择可用配置，禁止虚假完整回滚 |
| 410 | preview_expired | 重新预览并确认 |
| 429 | rate_limited | 根据 Retry-After 提示限流 |
| 502 / 503 | cluster_unavailable | 展示集群连接错误和重试入口 |

## 7. 与当前 Mock 的迁移

保留 `/api` 和现有错误体。现有 AppItem 的 repo/branch/status/replicas 是演示压平字段；真实模型中 Git、构建、环境绑定、健康状态分离，不应把旧 `status=running|deploying|stopped|failed` 扩展为所有任务状态。先替换共享 DTO 和 MSW，再接入后端；使用现有 `web/src/lib/request`，不另建 axios 单例。

## 8. V2 页面动作与合同映射

交互来源：[实例截图](../references/devtron-live/README.md)。所有路径仍以本文件的 `/api` 为前缀，页面 Hash 路由与 HTTP API 分离，不照抄 Devtron 后端协议。

| 页面动作 | 调用顺序 | 注意事项 |
| --- | --- | --- |
| Create Application | `POST /apps` → 配置页 `GET /apps/{appId}/config` | 应用先创建，不在创建表单中提交全部 CI/CD 配置 |
| Clone application | 读取有权限源应用配置 → `POST /apps` → 用户审阅后 `PUT /config` | 不克隆执行记录；凭据、目标与 Secret 逐项重新授权；部分失败进入新应用继续配置，不宣称跨请求原子操作 |
| Git / Build Configuration | GET 完整配置 → 本地修改对应片段 → PUT + expectedVersion | 分页签保存不能清空其它配置片段；冲突保留表单 |
| Workflow Editor / Update Pipeline | GET/PUT `/apps/{appId}/pipelines` | 更新定义，不触发构建或发布 |
| Select Material | GET `/git/branches` → GET `/git/commits?ref=…` | 服务端只访问应用已配置仓库，凭据不传回浏览器 |
| Start Build | POST `/apps/{appId}/builds` | 完整 commitSha 与选取时 configVersion，不传 UI 的短 SHA；202 后进入 Build History |
| Select Image | GET `/apps/{appId}/artifacts` | 已有镜像导入先 POST artifacts，固定 digest 后再可选 |
| REVIEW / Deploy | POST deployment-previews → 确认 POST deployments | 只提交 previewId；配置、目标变化使预览失效 |
| 历史条目 | GET builds/deployments + 详情/attempts/logs | 日志未存储、源代码不可用与请求错误分别呈现 |
| 点击资源、切换 Manifest / Events / Logs | discovery + resource / events / pod-logs | 多页签只是前端容器；每次仍校验权限，不复用其它资源的流 |
| Edit live manifest / Apply | resources/dry-run → resources/apply | 编辑时保留 UID/resourceVersion；资源页签不能成为跳过预览的通道 |

### 8.1 Select Material 的补充字段

分支查询接受 `keyword`、`cursor`、`limit`；提交查询要求 `ref`，可加 `shaPrefix`、`cursor`、`limit`，limit 默认 20、最大 100。游标为服务端不透明值。`shaPrefix` 只是指定仓库中的提交查找，不是任意全库搜索；实现应通过 Git provider 或受限本地缓存处理，不拼接 shell 命令。

提交响应：`items[{sha,subject,authorName,committedAt}]`、`nextCursor`、`configVersion`、`resolvedRef`、`observedAt`。不返回作者邮箱。显示可缩写 SHA，提交必须用完整 SHA。新查询取消旧请求，切换仓库配置后废弃原选择。上游不可达返回 503 `git_unavailable`；未配置 Git 返回 422 `git_not_configured`。两者保留面板和筛选输入。

当前查询实现使用 HTTPS smart Git（SHA-1 仓库），不依赖 Kubernetes 或外部 git 可执行文件。`ref` 是分支名；`resolvedRef` 为该分支 tip 的完整 SHA，空仓库为空字符串。分支按名字升序，keyword 不区分大小写；提交按 committer 时间降序，同时间按 SHA 升序，shaPrefix 只匹配所选分支可达历史。游标有效 5 分钟，绑定操作者、配置/凭据版本、查询与分支快照；篡改、过期或跨查询为 422 `validation_failed`，远端分支快照变化为 409 `git_ref_changed`，读取期间配置/凭据变化为 409 `revision_conflict`。超出读取预算返回 503 `git_query_limit`，不截断为假空列表。预算与已验证范围见 [实现说明](../backend/07-git-material.md)。

这两个只读端点已经加入 OpenAPI **设计稿**；没有实现对应后端。原型使用本地提交卡片，不调用 Git API。其内部 UI 状态不是正式 DTO。
