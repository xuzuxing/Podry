# 管理、配置与工作流接口

日期：2026-11-20。本页记录按“先绕过 Kubernetes 连接，实现接口”完成的管理配置批次及调用方法；该批次未连接 Kubernetes。后续已按新要求接入 [Kubernetes 资源读取与日志](08-kubernetes-resources.md)，当前总覆盖以该记录为准。

> 本页计数和迁移 3 为历史批次记录。当前为 54 个 implemented / 22 个 planned，服务要求迁移 4；构建部署配置、迁移升级和验证边界见 [B4 构建执行](09-build-execution.md)。

## 当前覆盖

76 个合同操作中，当前 **48 个具备业务实现，28 个尚未注册并返回 JSON 404**。下表以本页管理配置及 [Git 查询](07-git-material.md) 为主；新增的 6 个资源读取/日志接口、真实连接测试及验证见 [Kubernetes 读取](08-kubernetes-resources.md)。历史 Git 批次为 41 implemented/1 unavailable/34 planned，当前连接测试已可执行。

| 模块 | 当前接口与行为 |
| --- | --- |
| B1，14 个 | 账户认证、团队/项目/成员、授权审计；账户创建仍只通过 CLI |
| 平台管理，14 个 | 凭据列表/创建/轮换；Registry 与环境列表/创建；集群列表/登记/详情/修改；grant 列表/创建/撤销 |
| 应用，11 个 | 列表/创建/详情/描述与归档；当前或历史配置读取/分节保存；setup；模板创建；环境绑定读取；工作流读取/保存 |
| Git 查询，2 个 | 已配置 HTTPS smart Git 仓库的分支/提交读取，服务端凭据、签名分页、配置版本与权限重验 |
| 连接测试，1 个 | 当前管理员显式读取真实 /version；HTTP 200 返回 connected/unavailable 并保存检查时间；配置变化时拒绝旧观察覆盖 |

实现分别位于 `internal/credential`、`internal/platform`、`internal/application`、`internal/gitremote` 及新增的 `internal/kubernetes`、`internal/resource`，查询在 `internal/database/queries`，通过 sqlc 生成 pgx/v5 代码。构建、产物、发布预览与执行仍未接入。应用 health 暂为 `unknown`，归档后为 `stopped`，不生成模拟健康状态。

## 启动与迁移

沿用 B1 的数据库和 JWT 配置，并显式执行 `podry migrate up`，当前正式迁移版本为 **3**：

| 版本 | 新增业务表 |
| --- | --- |
| 000001 | users、teams、team_members、projects、project_members、audit_events、idempotency_records |
| 000002 | credentials、secret_versions、clusters、environments、registries、resource_grants |
| 000003 | applications、app_config_versions、deployment_targets、app_environment_bindings、pipelines |

共 18 张业务表，另有 schema_migrations。保留已存在的迁移 000001，升级通过 000002/000003 前滚；`docs/data/schema.sql` 仍是全量设计稿，不能替代正式迁移。服务启动只核对版本，不能自动改表或建账。

凭据加密使用独立的 `PODRY_CREDENTIAL_KEY`，值为 32 随机字节的标准 Base64。生成示例：

```powershell
$credentialKeyBytes = New-Object byte[] 32
$credentialKeyGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$credentialKeyGenerator.GetBytes($credentialKeyBytes)
$credentialKeyGenerator.Dispose()
$env:PODRY_CREDENTIAL_KEY = [Convert]::ToBase64String($credentialKeyBytes)
# 将该值保存在部署使用的秘密配置中，与数据库一起备份；不要提交或每次启动重新生成。
```

密钥为空时，身份和非敏感配置接口仍可启动，凭据创建/轮换及需要解密的集群登记返回 `503 credential_key_unavailable`。格式错误时启动失败。当前只支持一个持久主密钥；keyId 用于识别密钥，尚未实现主密钥环和主密钥在线迁移。凭据轮换接口轮换的是 payload，不是主密钥。

在 B1 的服务角色授权上增加以下权限；迁移角色仍单独配置，服务角色不能是表/schema owner：

```sql
GRANT SELECT ON credentials, secret_versions, clusters, environments, registries,
    resource_grants, applications, app_config_versions, deployment_targets,
    app_environment_bindings, pipelines TO podry_service;
GRANT INSERT, UPDATE ON credentials, clusters, applications,
    app_environment_bindings TO podry_service;
GRANT INSERT ON secret_versions, registries, environments,
    app_config_versions, deployment_targets TO podry_service;
GRANT INSERT, UPDATE, DELETE ON resource_grants, pipelines TO podry_service;
```

secret_versions 和 app_config_versions 只有 INSERT/SELECT；另外使用触发器拒绝 UPDATE/DELETE，即使误授写权限也不能改历史内容。配置序列触发器在应用锁下验证连续版本与 workloadKind 锁定。credentials 的当前版本通过可延迟复合外键引用实际 secret_versions，事务提交前必须同时保存密文版本。

## 凭据、作用域与集群登记

所有凭据响应仅包含 `id/name/kind/teamId/version`，不返回 payload、密文或密钥。AES-256-GCM 使用随机 nonce；密文包含 nonce、密文和认证标签。AAD 绑定格式版本、凭据 UUID、凭据版本和 keyId，版本互换或篡改解密失败。轮换使用 expectedVersion，旧版本永久保留，版本冲突返回 409。

payload 必须严格匹配以下结构，不能提交额外字段：

```json
{"kind":"git","payload":{"username":"git","token":"<token>"}}
{"kind":"registry","payload":{"username":"robot","password":"<password>"}}
{"kind":"kubeconfig","payload":{"apiServer":"https://cluster.example.test:6443","certificateAuthorityData":"<Base64 PEM CA>","token":"<service-account-token>"}}
{"kind":"secret","payload":{"data":{"DATABASE_PASSWORD":"<secret>"}}}
```

上面只展示 kind/payload；创建请求还需要 name 和 teamId。kubeconfig 使用结构化 HTTPS 与 Token 或内联客户端证书/私钥；逐凭据 insecureSkipTLSVerify 需显式启用，默认校验且要求 CA。完整新结构见 [Kubernetes 连接凭据](08-kubernetes-resources.md#连接凭据与-tls)。不接受原始 YAML、exec/auth-provider、文件路径。它必须是平台作用域（teamId=null），集群 API 地址须与凭据完全一致。轮换不能改变 apiServer，切换其他集群应创建独立凭据。

平台管理员可管理全部凭据；团队管理员可管理本团队凭据。团队成员可读取本团队元数据，应用只能引用全局或应用所属团队的同类型凭据；跨团队引用被拒绝。全局 kubeconfig 元数据只对平台管理员可见。Registry 为全局配置，若带 credentialId，必须引用平台级 registry 凭据，不能借全局 Registry 暴露团队凭据。

集群登记和改名只保存数据库事实，初始 connectionStatus=unknown。轮换引用的凭据或更新集群配置会清空旧 serverVersion/lastCheckedAt 并重置为 unknown；本阶段没有 Kubernetes 客户端缓存。

环境和 Registry 的创建需要平台管理员。autoDeployAllowed=true 返回 422；没有默认为生产或开发环境开启自动发布。Registry endpoint 只接受无用户信息、query、fragment、路径的 HTTPS 地址，不在保存时宣称凭据有效或镜像可拉取。

## grant 与应用的双重授权

平台管理员管理 grant。主体为已存在的 user/team/project；namespace 语义如下：

- `"demo"`：只授权该 Namespace。
- `"*"`：授权全部 namespaced 目标，**不包含集群作用域**。
- `""`：集群作用域，不授权任何 namespaced 目标。

resources 采用 `group/resource`：核心组写 `core`。支持 `*` 和合法的 Discovery `group/plural`，包括 core/pods、apps/deployments 及自定义资源，不接受子资源路径；最多 128 项。actions 允许 resource.view/resource.write/resource.delete/pod.logs/pod.exec/secret.reveal/node.manage；保存授权不表示对应资源执行接口已经实现。

团队 grant 适用于该团队的有效成员；项目 grant 适用于该项目的有效成员及团队管理员。集群列表按当前 grant 过滤。模板和工作流变更同时要求应用 configure 权限及目标 resource.write：Deployment 或 Job 的 workload、core/configmaps，以及显式启用的 Service/Ingress 或 Secret 引用对应资源。

写入沿用 actor→团队→项目→应用→按 UUID 排序的集群锁，锁后重新鉴权。grant 变更也锁集群；团队 grant 另外锁其成员关联，撤销成员不能和授权后的写入交错。幂等重放仍重验当前应用与目标权限。集群管理事件写入 cluster_id；本阶段集群审计仍仅平台管理员可读，不能借普通 Namespace grant 查看其他 Namespace 的审计内容。

## 应用分节配置

创建仅支持 sourceMode=git；image、cloneFromAppId 返回 422。名称遵循合同中的小写 DNS 风格，同项目重复返回 409。列表支持 projectId、environmentId、health、keyword 和 page/pageSize，并过滤无权项目；keyword 搜索名称与描述。

新应用 GET config 返回虚拟 version=0，三个配置对象为 null，deployValues={}、secretRefs=[]，不插入配置行。PUT config 必须携带 expectedVersion 和 section，每次只能保存一节，其余节从当前快照合并，新版本追加保存完整内容。旧版 GET config?version=1 不受新修改影响。

| section | 必填内容 | 当前校验 |
| --- | --- | --- |
| git | gitConfig | 无内嵌用户信息的 HTTPS URL、受限分支；public 要求 credentialId=null，credential 模式引用可用 git 凭据 |
| build | buildConfig | 仓库相对 dockerfile/context；禁止绝对路径、反斜线、冒号和任意 `..` 段；Registry 存在、无 tag/digest/主机的 imageRepository；amd64/arm64；60–14400 秒；非敏感 buildArgs；checkScript 暂不支持 |
| base | chartConfig、deployValues、secretRefs | Deployment/Job，配置版本 1.0.0；首次保存后 workloadKind 固定；受控值与固定 Secret 版本 |

chartVersion=1.0.0 表示当前已接受的配置 schema，尚未交付 Chart 包、Helm 渲染和发布。保存时没有仓库工作树，符号链接逃逸校验仍需在未来构建执行器中实现。

deployValues 当前支持 replicaCount、containerPort、resources.requests/limits.cpu/memory、非敏感字面量 env、service.enabled/port/type=ClusterIP、ingress.enabled/host 和单次 Job 参数。拒绝 volumes、任意未知键、用户镜像和所有权字段；Job 拒绝 Deployment/Service/Ingress 字段。敏感变量应使用 secretRefs；targetKey 是环境变量键，不允许与明文 env 或其他引用重复。凭据版本必须存在并属于当前应用允许的作用域，渲染时的 Secret 解析尚待实现。

## 原子模板与工作流

POST workflow-templates 支持 build_deploy 和提前提供的 build_only：前者要求 Git/Build/Base 已保存，后者要求 Git/Build。必须携带 expectedConfigVersion、expectedWorkflowVersion 和 Idempotency-Key；当前 CI manual=true、push=false、webhookCredentialId=null，branch 与 Git 配置一致；CD triggerMode=manual，超时 60–7200 秒。新建绑定要求 overrideValues={}、autoDeploy=false。

build_deploy 在同一事务内创建一条 CI、物理 Target、环境 Binding、一条 CD、workflowVersion、幂等结果和审计；CD upstream 为 null 时解析为本次 CI UUID。目标、唯一性、版本、权限或后段校验失败全部回滚。已有工作流不允许再次套初始模板；external_image/add_deploy 和独立绑定修改暂未注册/开放。

错误码遵循接口合同：乐观版本冲突为 `409 revision_conflict`；目标或环境重复绑定为 `409 target_conflict`；前置配置缺失为 `422 prerequisite_missing`；已有工作流为 `409 workflow_exists`。

PUT pipelines 使用应用级 expectedVersion，至多一条 CI、每个实际绑定至多一条 CD；仅允许引用本应用已有绑定，已有管线不可改 kind/bindingId。保存可创建、修改或移除管线，版本递增；修改和删除同样检查目标授权。工作流和配置读取期间保持应用共享锁，避免混合新管线与旧 workflowVersion。

setup 从已存 Git/Build/Base 和启用的 CI/CD 推导进度，不存 configured 字段。**completed=4 只表示四组配置已齐全**：执行器、经过验证的 Artifact 和 Kubernetes 连接尚未接入，所以 canBuild=false、deployableBindingIds=[]，同时给出 execution_unavailable blocker。没有伪造 Build、Deployment、Artifact 或执行成功。

归档后配置、模板与工作流写入返回 409，已有配置仍可读、可恢复归档。当前没有任务接收或执行记录；未来接入任务前必须补活动/unknown 任务的归档占用检查，不能据本阶段测试宣称该执行场景已完成。

## 可复制的最小接口流程

先按 B1 说明迁移、CLI 建立管理员及团队/项目。下面从已有 projectId 开始，不需要集群配置：

```powershell
$api = 'http://127.0.0.1:5000/api'
$login = Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType 'application/json' -Body (@{
    email = 'admin@example.com'; password = '<CLI-created-password>'
} | ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($login.accessToken)" }
$projectId = '<existing-project-uuid>'
$registry = Invoke-RestMethod -Method Post -Uri "$api/registries" -Headers $headers -ContentType 'application/json' -Body (@{
    name = 'Public registry'; endpoint = 'https://registry.example.com'; credentialId = $null
} | ConvertTo-Json)
$app = Invoke-RestMethod -Method Post -Uri "$api/apps" -Headers $headers -ContentType 'application/json' -Body (@{
    projectId = $projectId; name = 'hello-world'; sourceMode = 'git'
} | ConvertTo-Json)
Invoke-RestMethod -Method Put -Uri "$api/apps/$($app.id)/config" -Headers $headers -ContentType 'application/json' -Body (@{
    expectedVersion = 0; section = 'git'; gitConfig = @{
        repositoryUrl = 'https://github.com/example/hello-world.git'; branch = 'main'
        accountMode = 'public'; credentialId = $null
    }
} | ConvertTo-Json -Depth 10)
Invoke-RestMethod -Method Put -Uri "$api/apps/$($app.id)/config" -Headers $headers -ContentType 'application/json' -Body (@{
    expectedVersion = 1; section = 'build'; buildConfig = @{
        dockerfile = 'Dockerfile'; context = '.'; registryId = $registry.id
        imageRepository = 'example/hello-world'; platform = 'linux/amd64'
        timeoutSeconds = 600; buildArgs = @{}
    }
} | ConvertTo-Json -Depth 10)
$headers['Idempotency-Key'] = 'hello-world-build-only-001'
Invoke-RestMethod -Method Post -Uri "$api/apps/$($app.id)/workflow-templates" -Headers $headers -ContentType 'application/json' -Body (@{
    template = 'build_only'; expectedConfigVersion = 2; expectedWorkflowVersion = 0
    ci = @{manual = $true; push = $false; branch = 'main'; webhookCredentialId = $null}
} | ConvertTo-Json -Depth 10)
Invoke-RestMethod -Uri "$api/apps/$($app.id)/setup" -Headers $headers
```

该流程保存实际配置，不连接仓库或 Registry，不启动构建。build_deploy 的完整请求结构继续见 [接口示例](../api/01-api-spec.md)。

## 验证证据与未验收部分

执行 `./scripts/test-backend.ps1`，先执行宿主 go vet/go build，再将当前测试和真实服务主程序交叉编译为 Linux/amd64，放入隔离 PostgreSQL 16.15 容器执行。**15 个顶层集成测试及 6 个 Token 子测试通过**，包括 B1 回归和以下新增场景：

- 实际迁移、凭据密文解密与版本保留、AAD 版本互换/篡改拒绝、不可变历史、作用域与审计脱敏。
- 不依赖 K8s 的集群登记、grant 创建/撤销及可见性；连接测试明确 503；拒绝自动发布和内嵌密码 URL。
- 配置虚拟版本 0、分节合并、历史读取、乐观冲突、workloadKind 锁定、明文敏感键拒绝、角色/成员撤销立即生效。
- 集群作用域授权不能代替 Namespace 授权；模板后段错误全回滚；幂等重放、不同内容冲突、撤权后的重放拒绝。
- 同版本并发保存仅一次成功；4 个并发同键模板请求得到同一 Binding；工作流版本冲突与归档阻止修改。
- 未登记任何集群/凭据时，保存 Git/Build 并创建 build_only 工作流；前置配置缺失有明确错误。不同应用争用同物理 Target 时，第二个模板全回滚。
- 从迁移 000001 升至 000003，原管理员、团队和项目保留；当前主程序的 CLI、真实 TCP HTTP 启动与退出。
- 普通服务角色可以写入凭据、应用和配置版本并运行约束触发器，仍无 DDL/删除审计权限。

另外通过 sqlc vet、生成前后文件摘要一致性检查及文档结构/本地链接/OpenAPI 引用检查。文档检查不等于所有计划接口都已通过运行时合同验证。

上述管理配置批次使用临时独立数据库和测试 CA/payload，不连接 Kubernetes，当时没有 Git、Registry digest、BuildKit、Helm、集群执行、部署、前端联调或业务验收证据。后续 Git 协议 fixture 验证见 [新增记录](07-git-material.md)。Windows 原生 Go 测试仍有此前记录的运行时不稳定情况，本阶段通过的是 Linux 静态二进制与真实 PostgreSQL 的测试路径。
