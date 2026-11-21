# 应用资源、实时差异与健康投影

日期：2026-11-20。继续 B5 的业务开发，Gitea/Registry 故障期间仍暂停真实 CI/CD 执行。本批使用隔离 PostgreSQL 和只读 TLS 模拟 Kubernetes API；没有使用用户的 kubeconfig，没有访问 Gitea/Registry，也没有向真实集群写入资源。

## 接口与迁移

OpenAPI V1.8.0 共 76 个操作，**61 implemented / 15 planned**，P0 的 61 个操作已有业务实现；该计数不代表真实链路验收通过。新增接口：

```text
GET /api/apps/{appId}/resources?bindingId={bindingId}
GET /api/deployments/{deploymentId}/diff
```

应用详情、列表和 health 筛选使用同一数据库投影；setup 补充 deployableBindingIds。正式迁移增加至 **v7**，共 **28 张业务表**，另有 schema_migrations。000007 新增 binding_observations 表和 application_health 视图；31 表设计稿保持独立，运行数据库以正式迁移为准。

升级仍需显式执行：

```powershell
go run ./cmd/podry migrate up
```

服务账户需要对 binding_observations 具有 SELECT/INSERT/UPDATE 权限，对 application_health 具有 SELECT 权限；沿用其他业务表的既有权限。启动只核对 v7，不自动执行迁移。

## 资源归属与读取边界

bindingId 必填且必须属于 appId。读取该绑定当前物理目标上已记录的 Chart 根资源，按 apiVersion/kind/namespace/name 选择最近执行捕获的 UID。查询包含失败、提交中、观察中和未知执行的已知资源；没有 UID 记录的同标签对象不会被收编。

根对象必须匹配记录的 UID。后代通过带 controller=true 的 OwnerReference 关联，逐项核对父对象 apiVersion、kind、name、UID 和 namespace，支持 Deployment → ReplicaSet → Pod 与 Job → Pod。读取结束再次检查根对象 UID。标签用于健康检查中的执行身份核对，不能单独证明资源归属。

应用访问权限与当前资源授权取交集。复用 internal/resource 的授权快照、凭据解密、集群客户端和对象脱敏规则，每种类型单独判断 resource.view；未获授权的类型不会发起对象读取或后代列表请求。列表过滤无权资源；实时 Diff 要求所有根类型可读，否则整体拒绝，避免返回不完整的差异。

网络请求在事务外进行。结束后重验用户、项目访问、授权指纹、当前集群凭据，以及绑定、执行 revision 和资源身份；变化返回 404 或 409。集群读取失败返回明确错误，UID 替换返回 409 resource_identity_changed。没有读取到的已记录对象从结果省略，不能据此认定已删除应用。

读取预算为 20 秒、64 个根资源、每种后代列表最多 10 页且每页 200 个、最多返回 1000 个对象；超过预算返回错误。当前只覆盖版本化内置 Chart 的资源类型及上述控制器链，尚无通用 CRD 归属遍历。

Secret 返回 metadata、type 和排序后的键名，移除值及 annotations。所有资源沿用 managedFields 和 last-applied annotation 清理。应用资源 GET 只向 Kubernetes 发起 GET，请求可能更新 Podry 数据库的健康观察缓存。

## 两种 Diff

发布预览里的 diff 继续比较上次成功发布快照与新的离线渲染结果。它不读取集群。

新增 GET /deployments/{deploymentId}/diff 的 before 是该执行的不可变期望 Manifest，after 是当前集群中对应根 UID 的读取结果。两边统一转为排序后的 JSON Manifest 文档，清除 status、UID/resourceVersion/generation/creationTimestamp、managedFields 和 last-applied 数据；保留配置字段与标签，便于看到配置漂移。JSON 是合法 YAML 1.2。

所有期望根资源均需已有 UID 记录，尚未捕获完整身份返回 409 resource_identity_unconfirmed。同名对象 UID 替换返回 409；确实不存在的对象从 after 省略，因此可展示删除差异。上游失败不会伪装成空 after。历史执行的 UID 仍存在但已被后续发布修改时，接口展示当前配置相对历史快照的差异。

Secret 两边都只比较元信息、类型及键名，不能判断 Secret 值是否漂移。Diff 覆盖快照根对象，ReplicaSet/Pod 后代通过资源接口查看。服务端默认值和准入控制器添加的字段仍可能显示在 after 中，本批没有实现 Kubernetes 三方合并差异算法。

## 健康观察

本批采用查询时观察：资源 GET 完成后，针对该绑定最近执行的工作负载计算状态并缓存 60 秒。没有新增后台健康轮询器。客户端需要再次读取资源才能刷新观察，应用详情和列表本身不访问集群。

| health | 观察事实 |
| --- | --- |
| unknown | 没有完整工作负载身份、结果未知、未获得必要工作负载/成功 Pod 观察、读取失败或缓存失效 |
| progressing | Deployment 尚未满足 generation/副本/Available 条件，或 Job 尚未完成 |
| healthy | 当前 Deployment 执行标签与固定镜像匹配，generation、更新/就绪/可用副本及旧副本清退条件满足 |
| completed | 当前 Job Complete 且 succeeded≥1，并有当前 Job UID 控制、执行标签和固定应用镜像匹配的成功 Pod |
| degraded | 已记录工作负载缺失、执行标签或镜像漂移、Deployment ProgressDeadlineExceeded，或 Job Failed |
| stopped | Deployment 期望副本为 0 且观察到清退完成；归档应用沿用逻辑 stopped 投影 |

健康描述当前工作负载，不改变发布历史和 binding.currentDeploymentId。Job completed 与服务 healthy 分开；一次发布 succeeded 不直接生成健康观察。归档仍只改变应用的逻辑状态，不执行集群停机。

观察绑定到 binding version、最近 deployment ID/revision 和当前集群 credential ID/version；新执行、绑定编辑、凭据轮换或超过 60 秒后自动投影为 unknown。读取失败在输入仍一致时写入 unknown，防止继续复用旧 healthy。较早开始的并发查询不能覆盖较新的观察。

多绑定聚合顺序为 degraded → unknown → progressing → healthy → stopped → completed；没有绑定为 unknown，归档优先为 stopped。每个绑定都参与聚合，未观察的新绑定会使整体 unknown。列表计数和数据读取使用同一事务时间判断过期。健康为 app.view 范围的应用摘要，对象内容仍受 resource.view 限制。

## setup 发布候选

deployableBindingIds 依据本地事实计算：应用未归档、当前用户具备 deploy 角色、执行器开启、存在成功 Build/Attempt 验证的 Artifact、CD 已启用、部署配置可渲染、目标写授权包含 Helm Secret 存储、准确版本 Secret 和集群凭据可用。候选计算只读数据库并在内存校验/渲染，不访问 Git、Registry 或 Kubernetes，也不创建预览/发布任务。

候选不承诺远端可达或目标可立即执行；用户选定产物后的 preview/confirm 和 Worker 继续重验准确输入、授权与目标占用。默认 PODRY_BUILD_ENABLED=false、PODRY_RELEASE_ENABLED=false 保持不变。

## 验证记录

新增集成用例覆盖 UID 与控制器链、同标签/错误 OwnerReference 排除、逐类型授权、Secret 脱敏、实时漂移/缺失/上游失败、读取时撤权/轮换/绑定变化、健康筛选/过期/镜像漂移/零副本/Job 成功 Pod、失败及活动执行资源、多个绑定和本地 setup 候选。

前两轮专项回归分别发现测试夹具错误地 PATCH 不可变 apiServer、直接增加凭据版本触发外键；均改为合法夹具或正式轮换 API，未放宽产品约束。随后专项回归通过，最终全量回归包括本批 7 个顶层用例。

| 检查 | 结果与边界 |
| --- | --- |
| `./scripts/test-backend.ps1` | 56 个顶层用例和 13 个子用例通过；1 个真实集群用例因未配置 PODRY_TEST_KUBE_PAYLOAD 跳过。包含 go vet/build、Linux 编译、隔离真实 PostgreSQL、v7 up/down/up、v1 升级和服务角色启动/DDL 拒绝 |
| `go test ./internal/... ./cmd/... -count=1` | 通过；Chart 渲染和现有 Helm SDK/观察单元测试继续通过，SDK 存储/写端仍使用内存及 fake |
| sqlc | vet 通过，重新 generate 前后生成文件 SHA-256 一致 |
| 文档与合同 | 38 Markdown、380 本地链接、76 操作、238 schema 引用、31 张设计表的结构检查通过；OpenAPI V1.8.0 为 61 implemented / 15 planned |

本批证据仅覆盖隔离 PostgreSQL 和模拟 API，真实 Kubernetes Admission/RBAC、构建推送和 Helm 发布仍待环境恢复后验收。真实集群测试未配置凭据，构建/发布默认开关保持关闭。

后续 B6 重点为真实 Gitea → Kubernetes Job/BuildKit → Registry digest → Helm → 资源/健康链路及故障恢复验收；未知目标人工核对、晋级/回滚、通用资源写入与后台持续观察仍需后续合同和开发。
