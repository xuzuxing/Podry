# 晋级与历史快照回滚

2026-11-22 Secret 补充：新目标真实验证 SecretRef v1 → v2 → v1，回滚时凭据当前版本为 v3；历史值、Pod 引用和旧镜像/Chart 恢复，当前配置 v12/SecretRef v2 与凭据 v3 保留，同 output 续跑无重复。首个目标升级仍 pending/unknown，未强制处置，见 [Secret 历史恢复与边界](35-live-secret-history-rollback.md)。

2026-11-22 最新验证：新目标真实不同 digest 升级后，通过历史发布接口恢复旧 digest、Chart 1.0.0、一个副本和全部历史业务 Values；原当前配置 v8/绑定 v2 保留，执行快照为历史 v7/v1，幂等续跑无重复。见 [版本升级与回滚](33-live-version-upgrade-and-rollback.md)。业务 Secret 历史版本恢复及故障矩阵仍待验收。

2026-11-22 后续验证：同一真实构建 Artifact 从自动开发环境晋级到另一手动非生产环境，kind/sourceDeploymentId、独立环境覆盖、Pod digest 和 HTTP 均核对通过；没有重新构建，见 [自动部署与晋级实测](32-live-auto-deploy-and-promotion.md)。两个绑定共用集群和 namespace；不同版本回退仍待验证。

最新验证（2026-11-22）：真实 Helm Job 首次发布后，通过 rollback 接口使用相同 digest/归档 Chart 创建新身份并再次完成，revision 1 → 2；见 [实测与边界](31-live-build-actions-and-job.md)。这是历史 Job 重新执行验收，不代表不同版本回退或跨环境晋级已通过；下文保留最初业务交付记录。

日期：2026-11-21。按暂缓真实 CI/CD、继续业务开发的安排，提前实现 E05；依赖 [多环境绑定与覆盖](15-environment-bindings.md)，复用已有发布 Worker。真实链路与 B6 验收仍待基础设施恢复。

## 接口与行为

两个接口均要求 deploy.trigger、Idempotency-Key，并以路径中的成功 Deployment 为来源；返回 202 ReleaseRequest，创建新的 Request、Snapshot 和 Deployment。详情与列表的 sourceDeploymentId 指向来源，kind 为 promote 或 rollback，原记录和快照保持不可变。

| 操作 | 请求 | 业务输入 |
| --- | --- | --- |
| `POST /api/deployments/{deploymentId}/promote` | `{"bindingId":"目标绑定 UUID","expectedConfigVersion":4}` | 复用来源 Artifact 和固定 imageRef；采用同一应用另一个绑定的最新基础配置、覆盖、SecretRef 与 CD |
| `POST /api/deployments/{deploymentId}/rollback` | `{"reason":"恢复上次稳定版本"}` | 在来源绑定复用历史业务 Values、准确 Chart 归档、镜像 digest、SecretRef 版本和超时；新建执行身份 |

晋级不修改来源，不创建 Build，不重新解析可变 tag。目标必须属于同一应用，且不能是来源绑定。expectedConfigVersion 防止配置变化后误用新配置。当前只有经成功构建验证的 Artifact；外部镜像导入仍待 E04。

回滚不采用当前基础配置或覆盖，也不退回历史集群连接凭据。请求准入检查当前已启用 CD、工作流与目标授权，使用当前集群凭据版本；ConfigVersion/BindingVersion 保留历史业务版本，WorkflowVersion/PipelineVersion 记录本次准入版本。两阶段校验另行捕获当前绑定版本，不将它误当成历史版本。

回滚理由去除首尾空白后须为 1–1000 个字符，保存在不可变请求记录；审计只写来源、请求、部署、快照 ID，不复制自由文本。请求响应仍沿用原 ReleaseRequest 合同。

## 快照与执行

不改变 release.Plan v1 字段、顺序、schemaVersion 或历史摘要。来源先通过规范化快照、Chart 包和 Manifest 摘要及业务身份检查。回滚使用归档中的实际 Chart 包重新渲染，只替换平台管理的部署身份；不以当前内置包代替缺失或不支持的历史包。当前批准的历史版本仅 podry 1.0.0；新增 Chart 版本时需要扩展明确批准的版本及摘要映射。

新 Request/Deployment UUID 生成新的 Job 名称和 Secret 名称，Job 回滚会再次运行。业务 Values 不含解密明文；执行 Worker 按准确 SecretRef 版本解密到临时内存。缺少历史 Secret 版本返回 409 secret_version_unavailable；密钥或完整性错误保留其真实错误。Chart 缺失、损坏或不支持时拒绝，不能只把镜像换回旧版本来宣称完整回滚。

Artifact 与成功 Build 的本地关联、固定 imageRef 会重验；接口没有访问 Registry 验证旧 digest 当前可拉取。镜像真实可用性、Helm 提交与跨环境发布仍需真实执行验收。

两个短事务之间进行本地渲染；最终事务重验所有准入输入、权限与版本。现有 schema 要求 Snapshot 关联已消费的 Preview，因此派生操作原子写入一条内部已消费 Preview 作为来源记录；无需新增 HTTP 预览/确认步骤。

## 幂等、权限与占用

- 同键同输入返回原 202 与结果；不同路径或内容返回 idempotency_conflict。重放先检查当前应用 deploy 权限及冻结资源、Secret 凭据作用域；不依赖最新配置版本、执行开关或历史密钥可解密性。
- 权限涵盖实际工作负载、Service/Ingress、业务 Secret 和 Helm 存储 Secret。目标覆盖启用的资源不能逃过授权；回滚按历史资源校验。
- 目标有 queued/submitting/observing/unknown 或 active_deployment_id 时返回 target_busy；接口不清除占用或 fencing token。
- 默认 PODRY_RELEASE_ENABLED=false；返回 503 deployment_execution_unavailable，不留下任务、快照、内部 Preview 或幂等占位。已完成请求仍可在重授权后重放。
- 复用持久 Worker 的目标锁、lease、提交意图及 unknown 只核对机制。仅执行成功后推进 currentDeploymentId；接收请求不代表发布或健康成功。

## 迁移与验证

显式执行 `podry migrate up` 到 v9（000009_release_lineage）；API 不自动迁移。本批没有迁移开发数据库或重启服务。

v9 不新增表；release_requests 增加 source_deployment_id 和 reason。约束及 INSERT trigger 校验成功来源、同应用/同 Artifact、晋级不同绑定、回滚同绑定；UPDATE trigger 只允许状态变化，禁止改写历史来源/理由等身份。已有 deploy 的来源为 null，理由为空。降级遇到派生历史直接拒绝，绝不删除历史以满足旧约束；失败迁移可能标记 dirty，应调查错误和数据，不能 force 掩盖。

测试只用随机隔离 PostgreSQL、本地 Chart 渲染与模拟执行器；不连接用户 Git、Registry 或集群。覆盖目标最新配置与历史配置差异、Secret/集群凭据轮换、Job 新身份、幂等并发与重放撤权、目标 unknown/占用、无效来源及归档、执行器关闭零残留、历史依赖缺失，以及迁移保留与阻止丢失来源的降级。

| 检查 | 2026-11-21 实际结果 |
| --- | --- |
| 定向集成回归 | 6 个新增 E05 用例与环境覆盖迁移用例共 7 个全部通过；真实隔离 PostgreSQL、本地渲染、模拟执行器 |
| `./scripts/test-backend.ps1` | 74 个顶层集成用例、15 个子用例通过；1 个真实集群用例因 PODRY_TEST_KUBE_PAYLOAD 未配置跳过；含 go vet/build、Linux 编译、隔离 PG、真实 pg_dump/pg_restore 和编译后二进制停机 |
| `go test ./internal/... ./cmd/... -count=1` | 通过；保留原有 Chart 测试并增加归档保留/新身份及缺失、损坏、不支持版本拒绝测试 |
| sqlc vet / 重复生成 | 通过，生成前后文件摘要一致 |
| 文档结构检查 | 41 个 Markdown、402 个本地链接、76 个操作、238 个 Schema 引用、31 张设计表；不代表 SQL 执行或真实接口验收 |
| OpenAPI V1.10.0 SHA-256 | `f4e17090fc1a0e90fe7b3c33b311213eb8452e06d0db58c8c76fda2991efa400` |

构建使用工作树已有 web/dist；并行前端重建曾导致一次瞬时 embed 读取失败，重试及最终全量检查通过。没有修改前端、根 README、开发数据库或真实集群，没有提交代码；本批验证不代表前后端联调、真实 CI/CD、跨环境发布、旧镜像可拉取性或 B6 验收完成。
