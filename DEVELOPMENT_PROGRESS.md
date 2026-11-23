# Podry 开发进度与待办

更新日期：2026-11-23。本文记录后端当前实现基线及剩余工作；首批后端已提交为 f9685e4，本次后端提交收录后续开发的多环境、晋级/回滚、构建取消/重试、已有镜像导入、应用克隆、资源写入、资源动作与应用漂移、GitHub Webhook、非生产自动部署、后台健康巡检、发布与资源操作人工核对、Secret 明文和 Pod 终端能力。下方各轮“未提交”等表述保留为当时的开发记录，当前提交范围以本段和文末记录为准。

## 当前基线

- 技术栈：Go + chi、PostgreSQL + pgx/v5 + sqlc；CI 为 Kubernetes Job + BuildKit，CD 为 Helm SDK + 内置版本化 Chart。
- HTTP 合同：OpenAPI V1.24.0，共 79 个操作，全部已实现；新增 GitHub/Gitea/GitLab/Gitee 四平台 Webhook，保留 Chart 1.1.0 的受控 IngressClass/TLS 配置。接口已实现不等同于真实集群或 CI/CD 验收完成。
- 正式数据库迁移：v19，36 张业务表及 schema_migrations；新增构建/发布清理调度、错误与完成证据，`docs/data/schema.sql` 仍不能代替正式迁移。
- 默认 `PODRY_BUILD_ENABLED=false`、`PODRY_RELEASE_ENABLED=false`、`PODRY_RESOURCE_WRITES_ENABLED=false`；只读后台巡检同样默认 `PODRY_HEALTH_POLLING_ENABLED=false`。2026-11-22 已在独立测试实例显式启用构建/发布，完成三轮 Deployment 链路、Helm TLS Ingress、运行中取消/重试、有限 Job 发布与历史快照重新执行，以及非生产自动部署和同 Artifact 跨环境绑定晋级；见 [基础验收](docs/backend/29-live-cicd-acceptance.md)、[Ingress](docs/backend/30-ingress-helm-release.md)、[Job 与构建动作](docs/backend/31-live-build-actions-and-job.md)、[自动部署与晋级](docs/backend/32-live-auto-deploy-and-promotion.md)。较早 Job 发布仍为 unknown 并保留目标占用；默认配置保持关闭。
- 最新补充：[不同 digest/Chart/完整业务配置升级回滚](docs/backend/33-live-version-upgrade-and-rollback.md) 已通过，新目标 revision 3；单步 Discovery 缓存修复已验证。podry-job-live 和较早自动升级所在 podry-demo-auto 两个 unknown 继续占用各自目标。
- 最新恢复验收：[两条真实 unknown 人工核对](docs/backend/34-live-release-reconciliation.md) 通过。四个后台开关关闭仍可显式核对；同证据续跑、幂等冲突、旧 revision 和目标占用保护通过，unknown 与成功指针保留，无新增构建/发布；原测试 API 已恢复。
- 最新 Secret 验收：[业务 Secret 历史版本恢复](docs/backend/35-live-secret-history-rollback.md) 在新目标通过；SecretRef v1 → v2 → v1，当前凭据 v3、当前配置 v12/SecretRef v2 保留。同 output 续跑无重复。首个 Secret 目标升级仍 pending/unknown，根因未确定，目前三条 unknown 均保留占用。
- 最新清理实现：`PODRY_RESOURCE_CLEANUP_ENABLED=false`，默认保留构建资源 24h、被替代发布资源 168h；校验日志、终态、UID/RV 和引用，持久重试与审计，不清理当前工作负载或 unknown，见 [构建/发布资源自动清理](docs/backend/39-resource-cleanup.md)。真实集群回收仍待验收。
- 前端正在独立开发，本次不提交根目录 `web/`、其配套页面检查脚本及根 README 的前端改动。本文的状态仅代表后端，不代表前后端已完成联调。

## 已实现

| 阶段 | 已实现内容 | 验证边界 / 入口 |
| --- | --- | --- |
| B1 基础与身份 | 显式数据库迁移、CLI 建账、登录/退出/token 失效、团队/项目/成员、权限、审计、幂等事务 | [基础实施记录](docs/backend/05-implementation.md)；使用真实隔离 PostgreSQL 验证 |
| B2 平台接入与资源读取 | 加密版本化凭据、Registry/集群/环境/grant、显式连接测试、Discovery、Namespace、资源列表/详情、事件、Pod 日志 | [管理配置](docs/backend/06-control-plane.md)、[Kubernetes 读取](docs/backend/08-kubernetes-resources.md)；Secret 脱敏、UID/权限重验 |
| B3 应用与工作流 | 应用创建/查询/修改/归档、Git/Build/Base 分节配置与乐观锁、build_only/build_deploy 原子模板、一 CI 与实际 CD 集合、setup 派生状态 | [任务与分期](docs/backend/02-task-breakdown.md)、[接口矩阵](docs/backend/03-api-delivery-matrix.md)；保存配置不隐式执行 |
| B4 Git 与持久构建 | 分支/提交查询与固定 SHA、持久任务/lease/revision、受控 runner、Job 创建/准备/启动恢复、Registry digest 复核、Artifact、历史、NDJSON 日志与七天归档 | [构建执行](docs/backend/09-build-execution.md)、[真实 CI](docs/backend/29-live-cicd-acceptance.md)、[运行中取消与重试](docs/backend/31-live-build-actions-and-job.md) 通过；故障矩阵尚未完成 |
| B4 示例项目 | `docs/example/podry-demo`，Go + chi + embed，最小 ping/pong、Dockerfile 和使用说明 | [示例与本地 CI 记录](docs/backend/10-ci-local-demo.md)；本地构建记录不代表远端流水线验收 |
| B5 发布规划与执行 | 内置 Chart、离线预览、不可变快照、发布确认、请求与执行历史、持久 Helm Worker、物理目标占用/fencing、unknown 核对、成功后更新当前发布指针 | [执行与恢复](docs/backend/12-release-execution.md)；真实 Deployment revision 3/TLS Ingress、[有限 Job 发布及历史快照重新执行](docs/backend/31-live-build-actions-and-job.md) 通过；发布故障矩阵仍待验收 |
| B5 应用观察 | 记录 UID 与控制器 OwnerReference 的资源归属、应用资源查询、期望快照与实时资源 Diff、查询时健康观察、60 秒缓存、setup 发布候选 | [应用资源与健康](docs/backend/13-application-observation.md)；现已补充默认关闭的后台巡检，见 [持续健康](docs/backend/25-background-health.md) |
| 发布人工核对 | 显式只读 Observe、当前操作者权限、revision/lease/fencing 和凭据重验、原子状态/占用/审计/幂等；后台关闭时可用 | [实施合同](docs/backend/26-release-reconciliation.md)；证据不足继续 unknown，无强制解锁 |
| B6 / T24 离线部分 | 停止领取与在途收尾分离、HTTP/Worker/连接池共用停机时限、强制退出保留提交意图、隔离数据库备份恢复演练与操作说明 | [进程启停与备份恢复](docs/backend/14-runtime-recovery.md)；已补充真实构建中的优雅重启观察恢复，生产恢复及外部资源清理仍待验收 |
| E03 提前业务实现 | 独立环境绑定、版本化受控覆盖、add_deploy 复用一 CI 新增 CD、预览冻结合并配置、权限/目标/版本保护 | [多环境绑定与覆盖](docs/backend/15-environment-bindings.md)；[真实双环境绑定/覆盖](docs/backend/32-live-auto-deploy-and-promotion.md)通过，共用集群和 namespace，跨集群未验收 |
| E05 提前业务实现 | 成功发布的产物晋级、历史业务配置/Chart/Secret 回滚、不可变来源追溯、新 Job 身份、幂等/权限/占用重验 | [真实历史 Job 重新执行](docs/backend/31-live-build-actions-and-job.md)、[跨环境绑定晋级](docs/backend/32-live-auto-deploy-and-promotion.md)及[不同 digest/Chart/完整业务配置回滚](docs/backend/33-live-version-upgrade-and-rollback.md)通过；业务 Secret 版本恢复与故障矩阵仍待验收 |
| E01 提前业务实现 | 持久取消意图、Job 暂停与 Pod 退出核对、完成竞态、原输入重试、新 Attempt/Job/tag、幂等与权限重验 | [构建取消与重试](docs/backend/17-build-actions.md)；[真实暂停/Pod 退出与冻结输入重试](docs/backend/31-live-build-actions-and-job.md) 通过；远端 BuildKit 进程与推送中断边界仍待验收 |
| E04 提前业务实现 | 已有镜像导入、Registry digest 验证、镜像应用与 external_image、无 CI 多环境、预览/确认/晋级/回滚复用、原子应用克隆 | [镜像导入](docs/backend/18-image-artifacts.md)、[克隆](docs/backend/19-application-cloning.md)；v11，真实镜像拉取待验收 |
| 资源操作人工核对 | 当前拥有者完整权限、revision/lease、当前凭据、只读逐项证据、pending 跳过及原子审计/幂等 | [实施合同](docs/backend/27-resource-reconciliation.md)；后台关闭时可用，不重发写入或强制解除 unknown |
| E06 提前业务实现 | 严格 Manifest 预览、UID/RV 检查、加密快照、幂等异步提交、逐项 partial、unknown 只读核对与审计 | [资源写入](docs/backend/20-resource-writes.md)；v12，执行器默认关闭，真实集群待验收 |
| E07 提前业务实现 | UID/RV 删除、Deployment 重启/扩缩容、HPA 与平台发布冲突、持久意图/只读恢复 | [资源动作](docs/backend/21-resource-actions.md)；v13，执行器默认关闭，真实集群待验收 |
| E08 提前业务实现 | 当前成功发布基线漂移、显式只读刷新、脱敏数量摘要、有限历史及版本/权限失效 | [应用漂移](docs/backend/22-application-drift.md)；v14，不回写配置、不自动修复，真实集群待验收 |

| E02 业务实现 | GitHub/Gitea/GitLab/Gitee Push 认证/去重、显式委托、构建准入冻结自动意图、精确产物发布、权限/版本重验、并发去重与恢复 | [Webhook](docs/backend/23-git-webhooks.md)、[非生产自动部署](docs/backend/24-ci-auto-deploy.md)；v16，生产手动，[真实自动 CD](docs/backend/32-live-auto-deploy-and-promotion.md)通过；四平台 Push 真实供应商投递及在途故障仍待验收 |

## 剩余 P0 开发与验收

| 优先顺序 | 工作 | 当前状态及完成要求 |
| --- | --- | --- |
| 1 | T23 真实 CI 全链路 | 固定 SHA、受控 runner、BuildKit 推送、Registry digest、Artifact、归档、运行中取消及同 Build 冻结输入重试、幂等续跑已通过，见 [31](docs/backend/31-live-build-actions-and-job.md)；推送中断等故障场景待验收 |
| 2 | T23 真实 CD 全链路 | Deployment/TLS Ingress、有限 Job/历史快照重新执行、自动部署、双环境绑定晋级，以及不同 digest/Chart/副本/环境变量升级与历史回滚已通过；业务 Secret 版本恢复、跨集群及故障矩阵仍待验收 |
| 3 | T23 故障注入与权限验收 | 已验证优雅重启观察恢复及 Job 回滚短暂 unknown 后只读收敛；podry-job-live、podry-demo-auto 两个 unknown 继续占用，见 [33](docs/backend/33-live-version-upgrade-and-rollback.md)。Discovery 超时已修复，新目标验收通过；强杀、响应丢失、部分写入、凭据轮换/撤权、新 UID 和目标并发等矩阵仍待完成 |
| 4 | T24 生产恢复与安全清理 | 已实现默认关闭的构建/旧发布资源 GC，见 [清理合同](docs/backend/39-resource-cleanup.md)；真实集群清理、共享归档多实例、生产备份恢复及业务记录保留期仍待办 |
| 5 | 持续健康实际验收 | 后台巡检已实现持久调度、租约恢复、权限重验和失效保护；默认关闭，真实部署、负载与持续新鲜度待验收 |

T23 已完成普通 Deployment 链路与部分恢复验证，T23 故障矩阵 / B6 整体验收尚未完成，后续 P1 的真实执行验收进入条件保持原计划。此前按用户暂缓真实 CI/CD 的安排，E01/E03/E05 及 E04 镜像导入、应用克隆、E06 资源写入提前实现业务与模拟执行路径。不能把未知状态置为成功或直接清除目标占用；发布与资源 Apply/动作人工只读核对已补齐；无证据强制解锁仍未开放。Git SHA-256 仓库及多副本运行兼容性尚未完成验证/适配。

## HTTP 接口补齐

原剩余的三个 E09/P2 接口已实现：Secret 指定 key 明文读取、Pod 终端会话创建、拥有者关闭。终端同时接入真实 WebSocket → client-go SPDY 通道；详细授权、票据、配额与进程回收合同见 [Secret 与终端](docs/backend/28-sensitive-resource-access.md)。全部 79 个 HTTP 操作已注册，真实集群和前后端联调仍待验收。

GitHub/Gitea/GitLab/Gitee Push 已接入统一持久构建准入；协议差异与 v18 迁移见 [四平台 Webhook](docs/backend/38-git-webhook-providers.md)。显式非生产 on_ci_success 复用原持久构建/发布。资源人工修改/漂移已复用 E06/E07 并补齐 E08 观察记录，不静默回写基础配置。E03 的额外 CD/环境覆盖已实现并通过同集群双环境绑定真实晋级；跨集群未验收，目标迁移未开放。P2 Secret/exec 已实现；真实终端与 Secret 操作仍需受控环境验收。

## 2026-11-21 验证记录

以下为首批 f9685e4 提交前同一工作树的完整验证，详细过程见各阶段实施记录；本轮 E03 验证记录见后续补充。不将 Mock/SDK fake 结果描述为真实集群验收。

| 检查 | 实际结果 |
| --- | --- |
| `./scripts/test-backend.ps1` | 60 个顶层集成用例和 15 个子用例通过，1 个真实集群用例因未配置秘密环境跳过；包含 go vet/build、Linux 编译、真实隔离 PG、迁移/最小角色、真实 pg_dump/pg_restore 和编译后二进制停机 |
| `go test ./internal/... ./cmd/... -count=1` | 通过，含 Bootstrap、配置、Chart 和 Helm 观察单元测试 |
| `docker compose config --quiet` | 通过，仅解析配置 |
| `node docs/tools/check-docs.mjs` | 通过，结构检查；不代替 SQL 执行或 HTTP 契约验收 |
| 暂存快照检查 | 单独导出暂存树后文档结构检查通过，不依赖未提交文件；根目录本进度记录的相对链接也已检查 |
| OpenAPI | V1.8.0，SHA-256：`e475bd8060b97fcd5c848c7dfb24d20d58d3d636898ef1e7906123a8535c81b1` |

测试未修改开发数据库或真实集群。Go 服务的 embed 构建需要先具备 `web/dist` 静态资源；本次不提交前端改动，未将本轮后端验证扩大为干净检出的前端构建或前后端联调验收。

## 本轮 E03 验证补充（未提交）

- `./scripts/test-backend.ps1`：68 个顶层集成用例和 15 个子用例通过，1 个真实集群用例跳过；新增 8 个多环境用例全部通过。
- `go test ./internal/... ./cmd/... -count=1`、sqlc vet、生成代码摘要一致性、文档结构检查均通过。
- E03 当时的 OpenAPI V1.9.0 SHA-256：`fb102fe0ddad874ea8a4fe328b70f8f18cf5a930e1c507c7ac00792e5efe7a0d`；正文写明已实现 63 个，但生成脚本漏标两个绑定接口，机器标记实际为 61/15。本轮 E05 已修正生成源。
- E03 基线需要显式 `podry migrate up` 至 v8；E05 当时要求 v9，当前 E01 要求 v10。尚未迁移开发数据库。降级遇到非空环境覆盖会拒绝，避免丢失配置。
- 本轮未修改根目录 web/、根 README，也未执行真实 CI/CD。完整边界见 [多环境实施记录](docs/backend/15-environment-bindings.md)。

## 本轮 E05 验证补充（未提交）

- 新增晋级与回滚两条接口，OpenAPI V1.10.0 为 65 implemented / 11 planned；修正 E03 两个已实现绑定接口遗留的 planned 标记。
- 定向集成回归：6 个新增 E05 用例与环境覆盖迁移用例共 7 个全部通过；单元测试、sqlc vet/重复生成一致性、文档结构检查通过。
- `./scripts/test-backend.ps1` 全量通过：74 个顶层集成用例、15 个子用例通过；1 个真实集群用例因秘密环境未配置跳过。包含 go vet/build、隔离 PG、真实备份恢复和编译后二进制停机验证。
- E05 当时的 OpenAPI SHA-256：`f4e17090fc1a0e90fe7b3c33b311213eb8452e06d0db58c8c76fda2991efa400`。
- 显式迁移要求为 v9；尚未迁移开发数据库。存在晋级/回滚历史时降级拒绝，不丢弃来源与理由。
- 本轮未改根目录 web/、根 README，未提交代码或执行真实 CI/CD；验证仍使用工作树已有 embed 前端产物，不代表前后端联调验收。详见 [晋级与回滚实施记录](docs/backend/16-release-actions.md)。

## 本轮 E01 验证补充（未提交）

- 已实现取消/重试两条接口；OpenAPI V1.11.0 为 67 implemented / 9 planned。SHA-256：`5f52fb9cbf3464b9911d3876e31e8f63b1ec2151b6caa4c4fe9f54d7745592a8`。
- `./scripts/test-backend.ps1` 全量回归通过：82 个顶层集成用例、18 个子用例；1 个真实集群用例因秘密环境未配置跳过。包含 go vet/build、隔离 PG、迁移/角色、备份恢复和编译后二进制停机；套件时限随规模调至 300 秒。
- 全量回归后补充了历史 Attempt 日志跟随与当前重试操作者的检查，最终 `^TestBuildAction` 专项 9 个顶层、3 个子用例通过；覆盖取消/完成竞态、响应丢失/重启、同名替换、并发幂等、创建/准备/启动在途取消、原配置/凭据版本保留、历史日志与权限撤销。
- `go test ./internal/... ./cmd/... -count=1`、sqlc vet、生成代码一致性和文档结构检查通过；后端 diff 无空白错误。上述测试使用模拟 Kubernetes/Registry，未执行真实 CI/CD。
- 当前代码要求显式迁移至干净 v10；没有迁移开发数据库、修改根 web/ 或根 README，也未提交代码。新取消/重试历史会阻止降级。详见 [构建取消与重试](docs/backend/17-build-actions.md)。

## 首次提交范围（f9685e4）

提交后端代码、正式迁移与 sqlc 生成代码、受控构建 runner、测试、后端运行配置、示例及规划/合同/实施文档，保留既有注释。

不提交根目录 `web/`、根 README 的并行前端改动、`scripts/check-pipeline.mjs`、本地编辑器状态、运行产物或集群秘密文件 `docs/k3s.yaml`。`docs/example/podry-demo/web/dist/index.html` 是示例项目最小 embed 资源，属于示例源码；历史 `docs/prototype/` 和 `docs/references/` 为交互/规划证据，不代表本次交付 Web 应用。

下一次继续开发时，先核对 [后端任务清单](docs/backend/02-task-breakdown.md) 与本文件；E02 GitHub Push 与显式非生产自动部署已补齐；下一阶段可接续通用 Apply/Helm 目标排他；后台健康已实现并等待真实验收，真实 CI/CD 与 B6 仍需独立验收。

## 本轮 E04 镜像业务验证补充（未提交）

- 已实现镜像导入、sourceMode=image 和 external_image；可向已有镜像工作流追加无 CI 的环境 CD。本批之后应用克隆已补齐，见后续记录。此批 HTTP 合同 V1.12.0，68 implemented / 8 planned，SHA-256：`2da5118a72b9afc71c28e5829b2d93f691400648c1e63a0803a4c185154faea7`。
- `./scripts/test-backend.ps1` 全量通过：89 个顶层集成用例、22 个子用例；1 个真实集群用例因秘密环境未配置跳过。新增 6 个顶层用例和 4 个竞态子用例通过，覆盖镜像工作流、固定 digest、并发幂等、离线重放、远端失败、读取期间轮换/撤权/归档/地址变更、冻结凭据作用域、发布预览/确认/晋级/回滚及迁移约束。
- `go test ./internal/... ./cmd/... -count=1` 通过；新增 Registry 单元测试覆盖本地 HTTP/TLS、Basic/Bearer、外部 token realm 凭据隔离、重定向拒绝、manifest/index、请求 digest 和大小限制。sqlc vet/重复生成一致性、文档结构检查和 diff 空白检查通过。
- 正式迁移 v11，仍为 28 张业务表；镜像产物不创建 Build/Attempt，冻结 Registry、凭据版本及导入者。存在外部产物或镜像应用时拒绝降级。开发数据库未迁移。
- 测试使用隔离 PG 与本地 Registry fixture；外部 manifest 验证不等于 blob 可拉取，也不自动配置集群镜像拉取认证。真实 Registry/集群、镜像拉取、跨环境执行仍待验收，两个 Worker 保持默认关闭。未修改根目录 web/、根 README，未提交代码。详见 [镜像导入实施记录](docs/backend/18-image-artifacts.md)。
- 全量回归后保留了原构建操作从 v9 升级至当前版本的验证路径；`^TestBuildActionMigrationAndValidation$` 最终专项通过，确认 v11→v10→v9→v11 升级后原执行快照保持一致。

## 本轮 E04 应用克隆验证补充（未提交）

- `POST /apps` 的 cloneFromAppId 已实现：原子复制最新授权配置，目标配置独立从版本 1 开始，未保存源保持虚拟版本 0；保留准确 Secret 引用并生成新应用独立镜像仓库路径，不复制工作流、绑定、产物或执行状态。允许可读的已归档源应用。
- 校验源项目读取、目标项目配置权限，以及 Git/Secret/间接 Registry 凭据在双方作用域的引用权限；按稳定顺序锁定团队与项目，等待锁期间撤权后拒绝。新应用、快照及来源审计同事务提交；名称冲突返回 409，创建接口无幂等重放合同。
- 克隆专项：6 个顶层、7 个子用例通过，覆盖完整/部分/未配置的 Git 与镜像应用、独立历史、轮换后固定 Secret 版本及无解密复制、三类跨团队凭据拒绝、失败全回滚、双向并发、同名冲突和锁等待撤权。
- `./scripts/test-backend.ps1` 全量通过：95 个顶层集成用例、29 个子用例；1 个真实集群用例因未配置秘密环境跳过。包含 go vet/build、Linux 编译、隔离 PostgreSQL、迁移/最小角色、真实备份恢复及编译后二进制停机检查。
- `go test ./internal/... ./cmd/... -count=1`、文档结构与根进度链接、OpenAPI 可选字段/无幂等合同检查、后端 diff 空白检查均通过。OpenAPI V1.13.0，仍为 68 implemented / 8 planned，SHA-256：`d91bf42208ff9eba52cb06e5bde6be96194c8cd0ec8fc9574f79effc8a711abd`。
- 本批无新增迁移或 SQL 查询，正式版本保持 v11、28 张业务表；没有迁移开发数据库、访问真实 Git/Registry/Kubernetes 或修改根目录 web/、根 README，未提交代码。测试仍使用工作树已有 embed 前端产物，不代表干净前端构建或真实 CI/CD 验收。
- 下一阶段接续 E06 资源变更预览/提交；真实 CI/CD 与 B6 仍需独立验收。完整合同与使用入口见 [应用克隆实施记录](docs/backend/19-application-cloning.md)。

## 本轮 E06 资源写入验证补充（未提交）

- 已实现资源 dry-run、Apply 与操作查询三条接口。严格单对象 YAML/JSON、精确作用域和 view/write 授权、更新 UID/resourceVersion、POST 创建/PUT 完整替换、字段路径 Diff、10 分钟加密预览及安全审计均已接入；不会静默回写应用配置。
- 新增独立资源 Worker，默认 `PODRY_RESOURCE_WRITES_ENABLED=false`，预览可单独使用但需集群可达。持久逐项意图、60 秒 lease/revision、partial/stopOnError、unknown 只读核对与不重复提交已实现；执行开关已加入环境示例和 Compose，未启动或修改运行服务。
- 正式迁移 v12，30 张业务表；预览/操作输入不可变、预览单次消费和同用户/集群约束。存在历史时拒绝降级。独立服务角色新增两张表的 SELECT/INSERT/UPDATE，完整最小角色流程已验证。开发数据库尚未迁移。
- 最终 `./scripts/test-backend.ps1` 全量通过：105 个顶层集成用例、35 个子用例；1 个真实集群用例因未配置秘密环境跳过。包含 go vet/build、Linux 编译、隔离 PostgreSQL、v12 升降级与历史迁移路径、最小服务角色，以及既有真实 pg_dump/pg_restore 和编译后二进制停机验证。
- 本批新增 10 个顶层资源用例、6 个子用例，覆盖加密存储/安全错误、作用域、完整替换、UID/RV 与创建竞态、部分失败、四组并发幂等、拥有者/撤权、凭据轮换、缺密钥重放、响应丢失、无证据 unknown、旧 Worker fencing。修复后的专项另有 11 个顶层用例通过（资源 10 个与服务角色 1 个）。
- 首次回归发现测试重建路由时遗漏 Platform 装配；并发专项随后捕获预览锁等待导致同键误报已消费的竞态。已修正测试装配及准入锁/幂等读取顺序，并通过上述最终全量回归，不将首次失败描述为全程通过。
- `go test ./internal/... ./cmd/... -count=1`、sqlc vet/重复生成一致性、OpenAPI 生成一致性、文档结构/进度链接、Compose 配置解析和后端 diff 空白检查通过。OpenAPI V1.14.0 为 71 implemented / 5 planned，SHA-256：`21454ea0179e8fddcdd1b16eccb58cd8c1b3ddf48c2b5e10e3934fa1a1488661`。
- 验证使用隔离 PG 和本机 HTTPS fixture；没有访问真实 Git/Registry/Kubernetes、迁移开发数据库、修改根 web/ 或根 README，未提交代码。不代表真实准入/RBAC、工作负载健康、前后端联调或 CI/CD 验收；构建/发布/资源写入三个 Worker 保持默认关闭。
- 下一阶段接续 E07 删除、Deployment 重启/扩缩容及 HPA 边界；unknown 人工处置、跨 Helm/Apply 的目标排他、后台健康与真实 CI/CD/B6 仍待后续完成。完整合同见 [资源写入实施记录](docs/backend/20-resource-writes.md)。

## 本轮 E07 验证补充（未提交）

- 已实现 resource-actions，支持 UID/RV 条件删除和 Deployment 重启/扩缩容；HPA 管理/无法确认时拒绝 scale。按 namespace 与平台发布双向排他，unknown 持续占用；重启/扩缩容成功不代表工作负载健康。
- 正式迁移 v13、仍为 30 张表；仅 Apply 引用 preview，动作直接冻结引用与加密计划。动作历史阻止降级；保留 v12 及更早升级/降级测试路径。开发数据库未迁移。
- OpenAPI V1.15.0 为 72 implemented / 4 planned，SHA-256：`cb7e84c240300479fe691490eea1d61c4a94a50225e9b0ea8ac2753f0623a1ad`。后续 HTTP 剩余 Webhook、Secret reveal 和 exec 会话创建/关闭；E08 人工修改/漂移记录、后台健康、人工 unknown 处置与通用 Apply 排他仍待开发。
- 首轮专项发现发布/动作 fixture 试图轮换 API 地址（被既有保护拒绝）和测试重复降级；已修正测试设置。首次全量还发现历史镜像测试在降级后继续调用当前版本 API，已将降级断言移至该用例末尾，保留原历史保护覆盖。最终结果见下方完整验证记录。
- 使用隔离 PG 与本机 HTTPS fixture；没有访问真实 Git/Registry/Kubernetes、迁移开发数据库或修改根 web/、根 README，未提交代码。三个 Worker 保持默认关闭，真实 CI/CD/B6 仍独立待验收。详见 [资源动作实施记录](docs/backend/21-resource-actions.md)。

- 最终 `./scripts/test-backend.ps1` 全量通过：114 个顶层集成用例、44 个子用例；1 个真实集群用例因未配置秘密环境跳过。包含 go vet/build、Linux 编译、隔离 PG、v13 与历史迁移、最小角色完整 Apply/删除，以及既有 pg_dump/pg_restore 和编译后二进制停机检查。最终日志为本机临时目录中的 podry-resource-actions-final.log。
- 修正后的资源专项通过：20 个顶层、15 个子用例（9 个新动作、10 个原资源写入和 1 个最小角色）；最终全量另包含 HPA 第二页匹配与分页循环拒绝覆盖。
- `go test ./internal/... ./cmd/... -count=1`、sqlc vet/重复生成一致性、OpenAPI 生成一致性、Compose 配置解析、文档结构/进度链接及后端 diff 空白检查通过。文档结构检查为 46 个 Markdown、455 个本地链接、76 个 HTTP 操作、238 个 schema 引用、31 张设计稿表；结构检查不代替运行验收。
- 下一阶段可继续 E08 人工修改/漂移记录；E02 Webhook 与自动触发仍需明确业务策略，真实 CI/CD 和 B6 不以本次 fixture 结果替代。

## 2026-11-21 E08 应用漂移补充

- 已补齐 `GET /api/apps/{appId}/drift?bindingId=...`：默认本地缓存/历史，显式 `refresh=true` 只读刷新。基线为当前成功发布的不可变快照；只比较已捕获 UID 的期望根，历史执行 Diff 不改写当前漂移状态。
- 持久化仅保存状态、数量、版本身份摘要和时间；不保存 Manifest、字段路径、字段值或值摘要。Secret 值不参与比较，响应明确 `secretValuesCompared=false`。人工修改继续复用 E06/E07 及其审计，不回写基础配置、不自动修复或宣称收敛。
- 缓存 60 秒，按绑定/发布/revision/凭据/根 UID/平台操作版本失效。读取失败、同名换 UID、身份不完整、新执行未稳定或平台操作未完成时为 unknown。缓存与历史均要求完整根授权，最终事务内再次重验，关闭等待绑定锁期间被撤权的窗口。
- 正式迁移 v14，共 31 张业务表；每绑定保留最近 100 次，查询返回当前成功基线最近 20 次。存在观察历史时拒绝降级。开发数据库尚未迁移，启动新二进制前需显式迁移至 v14。
- OpenAPI V1.16.0：77 个操作，73 implemented / 4 planned；SHA-256 为 `80c9f827629c999bf895198635ae303310818f971b8bbbdb1fa896b73e7813c6`。
- 最终漂移专项 `^TestApplicationDrift`：10 个顶层、6 个子用例通过，含真实 PostgreSQL 锁等待期间撤权、旧读取晚完成、无密钥缓存读取、历史保留上限及迁移保护。前批迁移/最小服务角色专项另外 5 个顶层用例通过。
- `sqlc vet`、14 个 sqlc 文件及 OpenAPI 的临时目录生成一致性、Compose 配置解析、文档结构检查和 diff 空白检查通过。文档检查为 47 Markdown、462 本地链接、77 操作、242 schema 引用、32 张设计表；根进度链接也已核对。
- 首次全量在 102 个顶层用例通过后触发原 300 秒套件总超时，没有断言失败；总预算调整为 420 秒后重跑，业务超时和 Worker lease 保持原值。最终结果如下。
- 下一阶段可推进 E02 Git Webhook 与自动触发；后台健康、unknown 人工处置、通用 Apply 排他、真实 CI/CD/B6 仍待后续完成。本批未修改根 web/、根 README，未提交代码；完整合同见 [应用漂移](docs/backend/22-application-drift.md)。

| 最终检查 | 实际结果 |
| --- | --- |
| `./scripts/test-backend.ps1` | 124 个顶层、50 个子用例通过，1 个真实集群用例因未配置秘密环境跳过；含 go vet/build、Linux 编译、隔离真实 PostgreSQL、全部历史迁移保护、最小服务角色、数据库备份恢复与编译后二进制停机 |
| `go test ./internal/... ./cmd/... -count=1` | 最终内部包与命令包回归通过；最终授权窗口由上述集成专项验证 |
| 本机日志 | 全量 `$env:TEMP/podry-application-drift-final-full.log`；漂移专项 `$env:TEMP/podry-application-drift-final-targeted.log`；单元 `$env:TEMP/podry-application-drift-units.log` |

上述证据为隔离数据库/本机 HTTPS fixture 和 SDK fake 的结果，不代表真实 Git、BuildKit、Registry、Helm/Kubernetes 或生产恢复验收。三个 Worker 继续默认关闭。

## 2026-11-21 E02 GitHub Push 首批补充（未提交）

- 已实现 `POST /api/webhooks/git/github/{pipelineId}`：原始字节 HMAC-SHA256、1 MiB 限制、严格 JSON、仓库/分支/删除过滤、持久 Delivery 去重及安全审计。仅首批 GitHub；GitLab/Gitea 明确拒绝，真实供应商投递仍待验收。
- CI 模板和工作流保存支持 manual/push 组合，至少启用一种；Push 使用独立 Secret 的 data.webhookSecret。保存者明确承担触发授权，投递时重验账号、团队/项目权限、凭据作用域、当前 CI 和仓库授权；等待项目锁期间撤权的竞态已验证。浏览器退出不取消明确的工作流委托。
- Build/Attempt 的冻结输入、投递记录及审计同事务写入，失败整体回滚；签名密钥不进入 runner。重复 Delivery 原样重放，不同 body/event 返回 409。新 Push 在构建开关关闭时返回 503，不占用 Delivery；ignored/replay 可独立工作。服务重建及现有 Worker 的权限重验/恢复路径已验证。
- 正式迁移 v15，33 张业务表；新增 pipeline_push_authorizations、webhook_deliveries。不可变投递记录及 Push 配置阻止降级；已补齐全部历史降级路径及最小服务角色权限。开发数据库未迁移。
- OpenAPI V1.17.0：77 个操作、74 implemented / 3 planned。SHA-256：`f76f0ff96c32ffd642c204b7569e004a1f8acf3663bd66f5d9547c3655b6f549`。剩余 HTTP 为 Secret reveal 及 exec 会话创建/关闭。
- 首轮 Webhook 专项 9 个顶层、12 个子用例通过。随后加入作用域/模板和服务角色验证；全量 `./scripts/test-backend.ps1` 为 134 个顶层、62 个子用例通过，1 个真实集群用例因未配置秘密环境跳过，包含 go vet/build、Linux 编译、隔离 PostgreSQL、历史迁移、最小角色、备份恢复及二进制停机检查。
- 修正 Push-only 的 setup 状态：不提供手动构建，也不因此误报执行环境不可用。该修正后的最终专项 `^TestGitWebhook|^TestServiceRoleCannotRunDDL$`：11 个顶层、12 个子用例通过；最终 `go test ./internal/... ./cmd/... -count=1` 通过。
- sqlc vet、15 个 sqlc 文件与 OpenAPI 隔离重生成字节一致、Compose 配置、文档结构和 diff/新增文件空白检查通过。文档检查 48 Markdown、471 本地链接、77 HTTP 操作、242 schema 引用、33 张设计表；结构检查不代替运行验收。
- 日志位于本机临时目录：`podry-webhook-full.log`、`podry-webhook-targeted-final.log`、`podry-webhook-units-final.log`。
- 下一阶段继续 E02 on_ci_success：显式非生产环境策略、固定上游/产物/版本、持久自动发布准入、去重/崩溃恢复及权限重验。当前仍拒绝 on_ci_success 和 autoDeploy=true；生产继续手动。真实 CI/CD、后台健康、unknown 人工处置、通用 Apply 排他及 B6 仍待后续。

本批未操作真实 Git/Registry/Kubernetes，未迁移开发数据库、修改根 web/ 或根 README，未提交代码。三个 Worker 保持默认关闭。完整配置、调用与恢复语义见 [GitHub Push Webhook](docs/backend/23-git-webhooks.md)；fixture 成功不代表真实构建或部署验收。

## 2026-11-21 E02 非生产自动部署补充（未提交）

- 已实现显式非生产环境 autoDeployAllowed、绑定 autoDeploy、on_ci_success 与当前 CD 保存者的 deploy 委托。生产始终手动，CI 请求者不隐式获得发布权限；浏览器退出不撤回明确委托，禁用账号/撤权会阻止准入。
- 构建准入同事务捕获持久 auto_deploy_intents，固定 Build、上游与 CD、配置/工作流/CI/CD/绑定版本和委托用户，不追溯补发历史产物。失败/取消/unknown 不派发；同一 Build 的显式重试成功可以继续使用原意图，但仍须满足原冻结策略。
- 本地协调器在事务外渲染，最终预览消费、快照、请求、执行、意图和审计原子提交；并发去重、服务重建/崩溃恢复、目标互斥及两次授权/版本检查已接入。复用现有 Helm Worker，排队后提交前再查自动策略，已经提交的继续观察实际结果。
- 构建详情新增可选 autoDeployments，返回 waiting/blocked/dispatched/skipped、安全错误码及 requestId。执行器关闭、目标忙或暂时不可用时保留 blocked，30 秒后重验；不会产生多余预览或半条发布记录。dispatched 仅表示排队，不代表部署或健康成功。
- 正式迁移 v16，共 35 张业务表；新增两张表的最小服务角色权限与历史降级路径已同步。存在自动策略/配置或意图历史时拒绝降级。开发数据库未迁移，启动新二进制前必须显式匹配干净 v16。
- OpenAPI V1.18.0，仍为 77 个操作、74 implemented / 3 planned。SHA-256：`4a9bf04254fd6cdb61630f14efb48212c6258ecc679e8250affbc6f72d5d8b31`；增加配置可选分支和构建详情状态，没有新增 HTTP 操作。
- 精确产物交接专项已覆盖模拟构建成功 → 自动发布准入 → 既有发布 Worker 提交/观察 → 当前绑定指针更新，提交仅一次。专项使用本机 HTTPS fixture 与 SDK fake，不是实际集群执行。最终全量检查在下方记录。真实 Git/BuildKit/Registry/Helm/Kubernetes、前后端联调及 B6 仍未验收。三个外部执行 Worker 默认关闭，本地自动准入协调器受既有发布执行器 Ready 控制。
- 下一阶段可继续后台健康巡检、unknown 人工处置或通用 Apply 排他；GitLab/Gitea Webhook 与 P2 Secret/exec 仍待独立开发。完整合同见 [构建成功自动部署](docs/backend/24-ci-auto-deploy.md)。

本批没有修改根 web/、根 README、迁移开发数据库、启动真实流水线或提交代码。

验证过程补充：新增自动部署定向用例通过；最小角色测试直接调用服务时传入 Go int 而非 JSON 数值的问题已修正。首次全量为 141 个顶层、70 个子用例通过，1 个真实集群用例跳过；另有一处旧 Webhook 配置降级测试遗漏 v16→v15 的前置步骤而失败。已补齐该步骤，保留原 v15 历史保护断言；最终结果以下方记录为准。

| 最终检查 | 实际结果 |
| --- | --- |
| `./scripts/test-backend.ps1` | 142 个顶层、70 个子用例通过；1 个真实集群用例因未配置秘密环境跳过。包含 go vet/build、Linux 编译、隔离 PostgreSQL、v16 与全部历史迁移、最小服务角色、真实 pg_dump/pg_restore 及编译后二进制停机 |
| 自动发布 Worker 正向专项 | 增强后的 `TestAutoDeployBuildWorkerAtomicArtifactHandoff` 单独通过：模拟构建/Registry 校验 → 精确 Artifact → 自动发布 → SDK fake 提交/观察 → 绑定成功指针，提交一次。此测试增强发生在全量二进制编译后，另以独立专项验证 |
| `go test ./internal/... ./cmd/... -count=1` | 内部包及命令包通过；无真实外部执行 |
| 生成与静态检查 | sqlc vet、16 个 sqlc Go 文件和 OpenAPI 的隔离重生成字节一致；Compose 配置、文档结构、根进度链接、后端 diff 与新增源码空白/编码检查通过。文档为 49 Markdown、484 本地链接、77 操作、243 schema 引用、35 张设计表 |
| 日志 | 本机临时目录中的 `podry-auto-deploy-full-final.log`、`podry-auto-deploy-positive-worker.log`、`podry-auto-deploy-units.log`。首次失败日志保留为 `podry-auto-deploy-full.log`，不作为最终通过结果 |

最终结果属于隔离数据库、本机 HTTPS fixture 和 SDK fake，不是实际 CI/CD、集群健康或 B6 验收。三个外部执行 Worker 继续默认关闭。

## 2026-11-21 后台持续健康巡检补充

- 已接入默认关闭的 PODRY_HEALTH_POLLING_ENABLED。无需资源页面持续打开，后台按最近发布请求者的当前 app/resource 权限刷新既有 60 秒健康投影；没有新增 HTTP 操作或 DTO 字段，不刷新漂移缓存。
- v17 新增 binding_health_polls，正式共 36 张业务表。新绑定同事务生成调度行；每次完成或失败后 30 秒检查，45 秒租约、25 秒步骤预算、事务外读取与 token fencing。失效、撤权和全部过滤清除旧缓存，较新的交互观察保留。
- 交互观察和巡检统一数据库时钟。最终事务重验账号、项目、归档、授权指纹、绑定、根 UID、执行 revision 与凭据；统一 Runtime drain/work、崩溃租约恢复及最小服务角色权限已接入。v17 降级只删除可重建调度元数据，保留既有历史降级保护。
- OpenAPI V1.19.0，共 77 操作、74 implemented / 3 planned。SHA-256：`965a66bf718f8da7c137cf993b219ad711e48d965540e4f05f7ad4ad62177e94`。开发数据库未迁移；启动新二进制需要显式匹配干净 v17。
- 下一阶段可推进 unknown 人工核对处置或通用 Apply 排他；Secret/exec、GitLab/Gitea Webhook、真实 CI/CD 和 B6 仍待开发或独立验收。实施合同见 [后台持续健康巡检](docs/backend/25-background-health.md)。

### 本批最终验证

- ./scripts/test-backend.ps1 全量：150 个顶层、82 个子用例通过；1 个真实集群用例跳过。覆盖统一数据库时钟、健康租约/撤权/迟到结果/交互观察/drain、v17 与历史迁移、最小服务角色、真实 pg_dump/pg_restore 和编译后二进制停机。
- go test ./internal/... ./cmd/... -count=1、sqlc vet、17 个 sqlc 文件与 OpenAPI 独立重生成一致性、Compose、文档结构与空白/编码检查通过。文档结构检查为 50 Markdown、495 本地链接、77 操作、243 schema 引用、36 张设计表。
- 首轮专项修正两处缺 observedGeneration 的夹具；首次全量在最后一项开始时耗尽原 420 秒预算，无断言失败。脚本总预算调整为 480 秒；包含时钟修正的最终全量在调整前已启动，并在原 420 秒内通过。业务超时和租约长度保持不变。
- 使用隔离 PostgreSQL、本机 HTTPS fixture 和既有 SDK fake；没有访问真实 Git/Registry/Kubernetes、迁移开发数据库或修改根 web/、根 README，未提交代码。三个写执行 Worker 和只读健康巡检均继续默认关闭；不代表实际集群、前后端联调或 CI/CD/B6 验收。

## 2026-11-21 发布人工核对补充（未提交）

- 新增 POST /api/deployments/{deploymentId}/reconcile 和部署详情/列表 revision。当前操作者可以显式只读核对 submitting/observing/unknown；全部后台开关关闭时仍可用。queued/终态、有效租约、过期 revision 和不匹配目标拒绝，不重复提交、不强制释放 unknown。
- 核对前后重验用户、项目与资源权限、当前连接凭据、绑定和根身份；数据库锁不跨网络，20 秒读取预算。最终 CAS、资源记录、请求状态、成功指针、占用、审计和幂等结果同事务；同键首次与重放字节一致，不同键迟到结果拒绝。
- Helm pending/failed/不存在、revision/UID/镜像冲突和读取失败继续 unknown；确认的 Deployment/Job 结果沿用自动观察规则。Job 还需 Pod 查看权限。没有打开平台运行时 Secret 历史版本；Helm/根 Secret 的 Values/数据不回传或落库；理由只进入幂等指纹，审计保存长度。
- OpenAPI V1.20.0，共 78 个操作、75 implemented / 3 planned；SHA-256：431677160733332421cae98095ceb779e4273362b18446a28274cc13a3d37f04。复用现有历史，正式迁移仍为 v17、36 张业务表；没有迁移开发数据库。合同见 [发布人工核对](docs/backend/26-release-reconciliation.md)。
- 下一阶段可继续资源 Apply/动作的人工核对或通用 Apply 与 Helm 的目标排他；P2 Secret/exec、GitLab/Gitea Webhook、真实 CI/CD 和 B6 仍待独立开发或验收。

列表兼容修正前专项：16 个顶层、27 个子用例通过，包含新核对接口、既有发布 Worker 和最小服务角色。sqlc vet、17 个 sqlc 文件及 OpenAPI 的临时目录独立生成一致性、Compose、文档结构和后端空白/新增源码编码检查通过。当前文档为 51 Markdown、505 本地链接、78 操作、246 schema 引用、36 设计表；根进度 37 个本地链接也已核对。为新增 PostgreSQL/HTTPS 并发、撤权及回滚夹具将套件预算由 480 秒调整为 600 秒，业务读取超时和 Worker 租约保持原值。

复核锁定 SDK 后补充修正 Job PodList 解码：标准类型化列表可省略每个条目的 TypeMeta，现使用 UnstructuredList 补齐类型，同时保留并增强 Pod 类型、UID/OwnerReference、镜像与成功状态校验。最终集成夹具保留该合法省略形式；新增内部回归证明正常类型推断成功、显式错误 Kind 保持 observing。该变更发生在首次全量二进制编译后，因此最终版本另跑完整后端回归，结果以下方最终记录为准；先前通过不冒充最终代码验证。

| 最终检查 | 实际结果 |
| --- | --- |
| `./scripts/test-backend.ps1` | 最终 PodList 修正后的完整回归退出码 0：160 个顶层、105 个子用例通过，0 失败；1 个真实集群只读用例因未配置秘密环境跳过。包含 go vet/build、Linux 编译、隔离 PostgreSQL、历史迁移保护、最小服务角色、数据库备份恢复及编译后二进制停机检查；临时测试容器已清理 |
| `go test ./internal/... ./cmd/... -count=1` | 最终内部包与命令包通过，包含合法 PodList 省略条目 TypeMeta 和显式错误 Kind 的回归 |
| 生成与静态检查 | sqlc vet、17 个 sqlc 文件及 OpenAPI 独立重生成逐字节一致、Compose 配置解析通过；51 Markdown、505 本地链接、78 操作、246 schema 引用、36 设计表与根进度 37 个本地链接核对通过 |
| 本机日志 | 最终全量 `$env:TEMP/podry-reconciliation-full-verified.log`；最终内部回归 `$env:TEMP/podry-reconciliation-units-final.log`；列表修正前专项 `$env:TEMP/podry-reconciliation-targeted-complete.log` |

列表修正前另有一次完整回归通过，但不作为最终代码证据。修正后的首次完整重跑在 Linux 服务编译阶段中断，未执行集成断言；错误记录不足以确定根因。随后独立 Linux 构建及上述最终完整重跑均通过，详细过程保留在发布人工核对合同中。

本批验证使用隔离数据库、本机 HTTPS fixture 与 SDK fake，没有访问真实 Git/BuildKit/Registry/Kubernetes、迁移开发数据库、重启运行服务或修改根 web/、根 README，未暂存或提交代码；工作树中的前端并行改动继续保留。四个后台开关保持默认关闭。上述通过不代表真实 CI/CD、前后端联调或 B6 验收；资源 Apply/动作人工核对、通用 Apply/Helm 排他、GitLab/Gitea Webhook 与 P2 Secret/exec 仍待开发。

## 2026-11-21 资源 Apply/动作人工核对（未提交）

- 新增 `POST /api/resource-operations/{operationId}/reconcile` 和 Operation DTO 的 revision。原拥有者可在全部后台开关关闭时，以当前完整目标权限只读核对 running/unknown 的持久意图；不要求恢复原登录会话或原连接凭据版本，冻结物理目标与操作计划不变。
- Apply/create/update、Secret/CRD、Deployment restart/scale 复用签名标记、规范化内容及已知 UID 证据；删除确认原 UID 消失。finalizer、错误身份/内容/签名、Discovery 不完整或读取失败保留 unknown。不重发外部写入，不强制释放未知占用；未发出的 pending 项跳过，不因人工核对恢复执行。
- 两段短事务间最多 20 秒外部读取；前后重验当前账号、团队/项目成员、所有目标动作权限、集群连接凭据、revision 与 Worker lease。状态/逐项结果、完成时间、过期 lease、重试时间、审计和幂等同事务；旧 Worker 或不同键的迟到结果无法覆盖，审计失败完整回滚。
- 首次与同键重放字节一致；重放重验当前授权，无需密钥/网络/执行器。新核对需要解密原计划并核验签名；理由只参与幂等指纹，审计仅记录长度。详细调用与恢复边界见 [资源人工核对](docs/backend/27-resource-reconciliation.md)。
- OpenAPI V1.21.0：61 路径、79 操作，76 implemented / 3 planned，P0 61 / P1 15 / P2 3；SHA-256：`510fd04494f794bd24fb8d8b906e2170766344821c7ca8659a9db7eff3bbaec8`。预览/操作的逐项 error Schema 同时对齐实际 code/message DTO，GET 授权说明对齐按动作所需的权限。无新增迁移/表或服务角色权限，仍为 v17、36 张业务表。
- 初次专项在 Linux 测试二进制链接时因 C 盘空间不足中断，未执行断言；独立捕获的 Go 链接器日志明确报告磁盘空间不足。后续把本轮 TEMP/TMP/GOTMPDIR 转到 `D:/Temp/podry-resource-reconciliation-20261121`，没有清理用户文件或修改系统环境变量。首批专项为 12 个顶层、21 个子用例通过；增强后的成员撤权/行锁/动作占用专项为 3 个顶层、6 个子用例通过。
- 内部回归一度因并行前端构建替换 web/dist 哈希资源而出现 go:embed 文件不存在错误；完整日志保留。未构建或修改前端，最终内部包/命令包重跑通过。独立 sqlc 重生成 17 个 Go 文件与 OpenAPI 逐字节一致，sqlc vet、Compose 配置、文档结构/接口矩阵/根链接及格式编码检查通过；完整回归结果在下方最终记录。
- 下一阶段推进通用 Apply 与 Helm 的目标排他；GitLab/Gitea Webhook、P2 Secret/exec、无证据强制处置及真实 CI/CD/B6 仍待后续开发或验收。开发数据库和运行服务保持原状，四个后台开关默认关闭，未暂存或提交代码。

| 最终检查 | 实际结果 |
| --- | --- |
| `./scripts/test-backend.ps1` | 最终完整回归退出码 0：172 个顶层、128 个子用例通过，0 失败；1 个真实集群只读用例因未配置秘密环境跳过。包含 go vet/build、Linux 编译、隔离 PostgreSQL、历史迁移、最小服务角色、pg_dump/pg_restore 及编译后二进制停机检查；本轮临时测试容器已清理 |
| 本批新增覆盖 | 12 个资源人工核对顶层用例、23 个子用例均纳入上述最终完整回归；覆盖 Apply/create/update/Secret/自定义类型、三个动作与 finalizer、unknown 证据、pending 跳过、租约/行锁/CAS、同键/不同键并发、当前凭据轮换、新登录、撤权/成员锁等待、缺密钥重放和审计回滚；最小角色流程也已增强 |
| `go test ./internal/... ./cmd/... -count=1` | 最终内部包与命令包回归退出码 0，日志 units-final.log；此前 embed 文件被并行构建替换导致的失败保留在 units.log，不混为通过 |
| 生成与静态检查 | sqlc vet、17 个 sqlc Go 文件及最终 OpenAPI 独立重生成逐字节一致、Compose 配置通过；52 Markdown、516 本地链接、79 HTTP 操作、250 schema 引用、36 设计表核对通过，根进度 39 个本地链接有效；矩阵、SHA-256、编码、gofmt 与后端 diff 空白检查通过 |
| 本机日志目录 | `D:/Temp/podry-resource-reconciliation-20261121`：full-final.log、units-final.log、targeted.log、targeted-locks.log；其中最终完整回归覆盖最终 Go 源码与所有新增集成用例 |

以上为隔离 PostgreSQL、本机 HTTPS fixture 和既有 SDK fake 的验证，不代表真实 Kubernetes/CI/CD、前后端联调或 B6 验收。没有访问用户真实集群/Registry/Git、迁移开发数据库、重启服务、构建或修改根 web/、修改根 README，也没有暂存、提交或推送；前端并行改动继续保留。正式数据库仍为 v17，四个后台开关保持默认关闭。

## 2026-11-22 E09：补齐最后三个 HTTP 操作（未提交）

- 已实现 `POST /api/clusters/{clusterId}/secrets/reveal`：精确 Secret UID/resourceVersion、独立 secret.reveal、唯一 key 与内容预算；仅返回指定 key 的 Base64 bytes。最终账号/成员/授权/凭据检查与审计同事务；审计失败不释放值，值、key 名及理由原文不落库、不进入幂等缓存，响应 no-store。
- 已实现 `POST /api/clusters/{clusterId}/exec-sessions`：独立 pod.exec、Pod UID/容器/argv，30 秒单次随机票据、同源 WebSocket、client-go SPDY 实际输入/输出/resize/exit。全局 16/每用户 2 个临时会话，待连接计入；输入/输出预算、登录/空闲/最长时限、当前权限与 Pod 持续核对均接入。
- 已实现 `DELETE /api/exec-sessions/{sessionId}`：仅当前拥有者，审计后取消；断连、输入背压、Pod 替换、撤权、协议错误和 drain 也会关闭上游。会话不持久化，重启失效；没有增加迁移或表，仍为 v17、36 张业务表。
- 新增可选 `PODRY_PUBLIC_ORIGIN`，支持 HTTPS 代理后的精确来源配置；不信任客户端转发头。`.env.example`、Compose 和配置验证已接入，四个后台开关保持默认关闭。终端是显式用户动作，不依赖后台写入开关。
- OpenAPI V1.22.0：61 路径、79 操作，79 implemented / 0 planned；SHA-256：`7a5d2a357b12bdda7edb6b0210be31c8308e158e77205831a29d12429954bb6e`。实施、接入示例、单实例边界和 Kubernetes exec 缺少原子 UID 条件的竞态说明见 [Secret 明文与终端](docs/backend/28-sensitive-resource-access.md)。

| 最终验证 | 实际结果 |
| --- | --- |
| 最终 Go 源码的分段全量集成回归 | **187 个顶层、160 个子用例通过，1 个真实集群用例跳过，清单遗漏 0**。以 `go test -list` 的全部 188 个顶层名称核对：完整运行在 600 秒总预算到期前通过 145 个、跳过 1 个；随后精确补跑剩余 42 个，补跑退出码 0。不能将首次完整运行写成成功；脚本总预算现为 900 秒，业务超时/租约不变 |
| 新增敏感资源用例 | 15 个顶层、32 个子用例均纳入最终覆盖；实际本机 HTTPS/SPDY/WebSocket、stdin/stdout/stderr/TTY/退出码、票据过期/并发消费/重放/Origin、归属/配额、撤权/凭据轮换/Pod 替换、断开/关闭/drain、输入帧超限、握手卡住取消、无界错误 body 拒绝、审计失败与敏感内容不落库。最小数据库角色流程也已通过 |
| 内部包与命令包 | `go test ./internal/... ./cmd/... -count=1` 通过；后续 stdin 队列修正后，最终 resource/config 包另跑通过。最终补跑同时完成 go vet/build 与 Linux 编译 |
| 生成与静态检查 | sqlc vet、OpenAPI 独立目录重生成字节一致、Compose、文档链接/结构、gofmt、源码编码与后端 diff 空白通过；53 Markdown、527 本地链接、79 HTTP 操作、250 schema 引用、36 张设计表与根进度 41 个本地链接通过核对 |
| 本机证据 | `D:/Temp/podry-sensitive-access-20261121`：`completion-verified.log`、`coverage-verified.json`、`coverage-discovery.json`、`test-list.log`、`units-final.log`、`units-sensitive-verified.log`。`full-verified.log` 是 600 秒超时的首段证据，并非单次全量成功日志 |

过程修正：最初退出审计使用了既有数据库枚举之外的结果，已改为收到退出码才记 succeeded/failed，中断结果 unknown；补齐目标不读 stdin 时的有界队列与断连回收。此前为该修正主动停止过一次隔离完整回归，其后连接失败不计为验收。另有补跑构建中断（错误信息不足，未确定原因，独立 go vet 重验通过）和 PowerShell 序列化筛选导致零用例运行，均不计入通过；最终按实际用例名称集合复核分段覆盖。

本批没有访问真实 Kubernetes/Git/Registry、迁移开发数据库、重启真实服务、修改根 web/ 或根 README，也未暂存/提交/推送。测试临时目录与编译缓存使用 D 盘，未清理用户文件。真实终端/Secret、前后端联调、真实 CI/CD 与 B6 仍待验收；通用 Apply/Helm 排他、GitLab/Gitea Webhook、生产恢复与外部安全清理仍为后续工作。

## 2026-11-22 后端提交记录

- 本次提交 `feat(backend): complete delivery workflows and resource APIs` 收录上述后端业务、v8–v17 迁移、sqlc 产物、79 个 HTTP 操作合同、测试及配套开发文档。
- 验证沿用 E09 最终源码的分段回归证据：187 个顶层、160 个子用例通过，1 个真实集群用例跳过；首次完整运行超时，精确补跑 42 例退出码 0。本次仅补充提交状态记录并检查暂存范围及空白，不重复运行耗时集成测试。
- `web/` 并行改动及无关图片保留在工作树，本次不收录；没有推送远端。真实集群、CI/CD、前后端联调和 B6 的待验收边界保持上述记录。

## 2026-11-22 真实 CI/CD 恢复联调（未提交）

- 使用用户更新的 Gitea、Registry 和 K3s 连接，在专用 `podry-cicd-live` namespace 部署 rootless BuildKit。独立 PostgreSQL 16.15 迁移至 v17，独立 API 显式启用构建/发布；开发数据库、默认四个开关及前端未修改。
- 两轮真实 Git → Kubernetes Job → BuildKit → Registry → Helm Deployment 通过，均从 main 冻结同一完整 SHA。真实 manifest digest、受控 runner、Job/Pod UID、Artifact 来源、当前发布指针及 archived 日志核对通过；Helm 分别执行 install 与 upgrade，当前 revision 2，Deployment 1/1 Ready。Service port-forward 的 `/ping` 为 `200 pong`，embed 页面为 200；未验收公网应用 Ingress。
- 第一轮构建运行中优雅 stop/start 独立后端容器，恢复使用原 Attempt/Job UID 后成功；只证明该观察恢复场景。第二轮成功后同证据文件续跑通过，数据库保持 2 Build / 2 Attempt / 2 Artifact / 2 Request / 2 Deployment，没有重复提交。
- 新增 [可续跑验收器](scripts/test-cicd-live.mjs)、[BuildKit 清单](tools/cicd-live/buildkit.yaml)、[受控 runner Dockerfile](tools/cicd-live/runner.Dockerfile) 与 [CA 配置](tools/cicd-live/buildkitd.toml)。[详细复现与边界](docs/backend/29-live-cicd-acceptance.md)、[公开证据摘录](docs/backend/evidence/2026-11-22-cicd-live.json) 已补齐；秘密、完整日志及连接材料留在仓库外。
- 为当前 K3s 节点新增 Registry 专用 CA/hosts.toml 后，真实镜像拉取成功；未关闭 Registry/Git TLS 校验或重启节点。节点 CA 重启持久性未验收。Docker daemon 直接 HTTPS push 仍因测试 CA 信任失败，runner 发布采用本机匿名暂存 Registry 与临时 blob/manifest 校验复制，不计为 docker push HTTPS 通过。
- 针对本批验证：脚本语法与 help、BuildKit 清单 server dry-run、仓库 runner Dockerfile 实际构建及可执行权限/buildctl/git 检查通过；文档结构/链接、根进度链接、编码与改动空白检查通过。没有改 Go 业务源码或重跑 Go 全量回归。
- 真实测试实例、构建 Jobs 和当前应用保留供检查。本轮未暂存、提交或推送。T23 故障矩阵、有限 Job 工作负载发布、取消/重试、自动部署、晋级/回滚、跨环境与 T24 生产恢复/安全 GC 仍待验收；Gitea/GitLab Webhook 仍待开发。
- 随后曾直接增加独立测试应用 Ingress：app.podry.dev → 现有 Service，使用 Traefik 与现有测试 CA 签发 HTTPS 证书。直接域名访问首页为 200、`/ping` 为 `200 pong`；用户随后要求入口也必须通过 CI/CD 和 Helm 下发，已按下一节完成替换。

## 2026-11-22 Ingress 随 CI/CD 与 Helm 发布（未提交）

- 新增内置 Chart 1.1.0，支持受控 `ingress.className/tlsSecretName/clusterIssuer`；保留 Chart 1.0.0 原包与摘要，历史快照可继续复用。保存配置、环境覆盖、手动/自动发布、晋级及 setup 渲染均使用所选 Chart 版本，回滚使用历史归档；无数据库迁移，默认执行开关不变。
- 测试应用保存为配置 v4，按 [发布配置样例](tools/cicd-live/app-release-values.json) 启用 app.podry.dev 的 HTTPS 入口；重新触发第三个真实 Build，完成 Git → BuildKit → Registry → Artifact → Helm upgrade，当前 release revision 3 / Chart 1.1.0 / deployed。
- 从 Helm release 存储核对 TLS Ingress 清单与版本，真实 Ingress 带 Helm 所有权及本次 deployment-id，证书 Ready。撤掉原手工入口后，同域名只剩一个 Helm 管理的路由；直接域名 `/ping` 为 `200 pong`，首页为 200。详见 [完整记录](docs/backend/30-ingress-helm-release.md) 和 [公开证据](docs/backend/evidence/2026-11-22-ingress-helm.json)。
- 验证：chart/application/release 单元测试通过；go vet/build/Linux 编译通过；隔离 PostgreSQL 中六个定向集成用例通过，覆盖 TLS 预览/确认、旧 Chart、环境覆盖、自动部署快照与晋级/历史 Job 回滚路径。第三轮真实链路及撤掉手工入口后的 HTTPS 访问另行通过。未重跑全量 Go 集成回归；上述晋级/自动部署/Job 回滚定向用例仍属于 fixture 验证。
- 仅替换独立测试 API 的二进制并优雅重启；web 及开发数据库未修改，未暂存/提交/推送。前两轮证据保留为当时事实，T23 故障矩阵和生产恢复边界不变。

## 2026-11-22 真实构建动作与有限 Job 发布（未提交）

- 新增 [一次性 Job 程序](docs/example/podry-demo/cmd/podry-job/main.go)、[Dockerfile.job](docs/example/podry-demo/Dockerfile.job)、[Job 配置样例](tools/cicd-live/job-release-values.json) 和 [可续跑验收器](scripts/test-cicd-actions-live.mjs)。专用 Gitea 分支仅增加两个验收文件，main 未改动；原 app.podry.dev 保持 Helm revision 3。
- 两轮真实运行中取消均在实际等待输出后发起，核对 Job 暂停、Pod 退出和无 Artifact；同 Build 重试保留 SHA/配置/凭据版本/runner 等输入，创建新 Attempt/Job/tag，成功产物与 Registry 原始 digest 一致。取消 Pod 已删除、日志 unavailable；成功重试日志 archived，不能声称取消日志全部保留或所有远端 BuildKit 副作用已撤销。
- 修正两个验收器使用 resolvedRef 选择分支 HEAD。最初相同提交时间导致选中缺少 Dockerfile.job 的父提交，两条 source 失败 Build 留在历史，不计为通过。
- Helm server dry-run 复现客户端 OpenAPI schema 下载超时；清单通过 Kubernetes server dry-run。install/upgrade 改为跳过重复客户端 schema 下载，保留业务 Values 校验及实际 API 服务端校验。原 unknown 发布保留 podry-job-live 目标占用；修复后在新目标 podry-job-verified 完成 Job 首次发布及同 digest 历史快照重新执行，revision 1 → 2，两次 Pod exit 0、日志 podry-job: pong，成功后推进当前发布指针。
- 最终链路以同一证据文件续跑通过，应用历史总数保持 4 Build / 6 Attempt / 2 Artifact / 3 Request / 3 Deployment，包含上述失败与 unknown。原 Web 应用正常 HTTPS `/ping` 为 200 pong。见 [详细记录](docs/backend/31-live-build-actions-and-job.md)、[公开证据](docs/backend/evidence/2026-11-22-cicd-actions-job.json)。
- 验证：release 单元测试、go vet/build/Linux 编译和 5 个隔离 PostgreSQL 定向集成用例通过；示例本地运行、两次真实取消/重试、最终两轮 Helm Job 及幂等续跑另行通过。未重跑全量集成回归。仅优雅更新独立测试 API；未修改主开发数据库、默认开关或根 web/，未暂存/提交/推送主仓库。
- 剩余：保留的 unknown 恢复处置、自动部署、不同版本回退与跨环境晋级、推送中断/强杀/响应丢失/凭据轮换/撤权/UID 替换等故障矩阵，以及生产恢复/安全 GC；T23/B6 尚未整体结项。

## 2026-11-22 真实自动部署与跨环境晋级（未提交）

- 新建独立 podry-demo-auto 应用、显式允许自动部署的非生产开发环境和手动预发环境。在触发前完成两条 CD 配置；真实 CI 准入捕获 waiting 意图，成功后自动 dispatched → Helm succeeded，未调用手动预览/确认。数据库核对冻结配置/工作流/管线/绑定版本及委托身份一致。
- 同 Artifact 经 promote 接口发布到第二环境，kind/sourceDeploymentId、两份 Helm Chart 1.1.0/revision 1、Pod imageID、环境覆盖 development/staging、各自当前发布指针及 Service HTTP 均核对通过，没有新建构建。两个环境共用集群和 namespace，不代表跨集群隔离；原 app.podry.dev 未改配置或重新发布。
- 扩展 [验收器](scripts/test-cicd-live.mjs) 的 --auto-deploy 与 --promote-from，保存模式/来源/版本和幂等身份，自动路径只观察原请求，晋级复用既有 Build。两个发布成功后优雅重启独立 API，ready 后沿原证据顺序续跑均通过；本应用保持 1 Build / 1 Attempt / 1 Artifact / 1 Intent / 2 Preview / 2 Snapshot / 2 Request / 2 Deployment，无重复任务。启动过程中首次 fetch failed 保留为过程记录，不算通过。
- [详细复现与限制](docs/backend/32-live-auto-deploy-and-promotion.md)、[公开证据](docs/backend/evidence/2026-11-22-auto-deploy-promotion.json) 已补齐。较早 podry-job-live 仍 unknown，activeDeploymentId 未变，无强制解锁或重提。
- 本批仅修改验收工具和文档；脚本语法/help、真实链路/重启续跑、旧手动模式兼容性及文档/链接/秘密/空白检查通过。原 Ingress 验收沿旧证据文件续跑通过，revision 3 不变，公网 HTTPS `/ping` 仍为 200 pong。没有新增 Go 业务代码、数据库迁移或全量 Go 回归；未改根 web/、开发数据库或默认四个后台开关，未暂存/提交/推送。
- 后续：不同 digest 升级及完整历史配置回退、T23 故障/权限矩阵与 unknown 核对、GitLab/Gitea Webhook、持续健康真实验收、T24 生产恢复和安全 GC。T23/B6 尚未整体结项。

## 2026-11-22 不同镜像版本升级与历史回滚（未提交）

- 示例新增 /version，Dockerfile 通过 APP_VERSION 注入标记；独立 Gitea 分支仅修改 router/Dockerfile，main 未改。新版真实 Build 生成不同 SHA/digest 的第二个 Artifact；未修改根 web/。
- 较早向原自动目标升级进入 unknown。只读 Helm upgrade server dry-run 复现重复 Discovery 耗尽 20 秒 context；单步复用 Discovery/RESTMapper 后相同诊断通过。修复只缓存同一步，下一步重新发现；未延长超时、lease 或放松资源身份检查。原 unknown 不重提，继续占用。
- 在新手动目标 podry-demo-rollback 复用两个既有 Artifact：旧版晋级、新版升级、历史回滚全部 succeeded，Helm revision 1 → 2 → 3，Chart 1.0.0 → 1.1.0 → 1.0.0。升级两个 Pod 均为新 digest、/version=live-v2；回滚恢复旧 digest、一个副本、全部历史 Values/环境变量，/version=404、/ping=200 pong。Chart 包摘要及内容与历史归档一致。
- 新增 [可续跑验收器](scripts/test-cicd-rollback-live.mjs)，并修正通用手动验收器使用已有 Artifact 时按当前发布配置预览。同一回滚 output 第二次运行通过，应用总数保持 2 Build / 2 Attempt / 2 Artifact / 2 Intent / 6 Request / 6 Deployment；包含原自动发布/预发晋级、较早 unknown 和新目标三个成功发布，不将所有记录计为成功。
- 当前应用配置仍 v8、绑定仍 v2，回滚发布使用历史配置 v7/绑定 v1；当前发布指针已指向回滚，没有修改配置编辑器或 Git 分支。较早 podry-job-live 与本次 podry-demo-auto 两条 unknown 均保留占用。原 app.podry.dev HTTPS /ping 仍正常。
- 验证：release 单元测试（新增真实 Discovery/manifest Build 缓存边界用例）、vet/build/Linux 编译及 3 个隔离 PostgreSQL 定向集成通过；真实构建、三个发布步骤、逐 Pod/Service HTTP 和幂等续跑另行通过。脚本语法/help、文档/链接/编码/秘密/空白检查通过。未重跑全量 Go 集成；仅优雅更新独立 API 二进制，开发数据库、默认开关和前端未改，未暂存/提交/推送。
- [完整记录](docs/backend/33-live-version-upgrade-and-rollback.md)、[公开证据](docs/backend/evidence/2026-11-22-version-upgrade-rollback.json) 已补齐。下一步：unknown 只读核对、T23 故障/权限矩阵、业务 Secret 历史版本恢复、持续健康实际验收；GitLab/Gitea Webhook、生产恢复与安全 GC 仍待开发或验收。T23/B6 尚未整体结项。

## 2026-11-22 真实 unknown 人工核对与占用保护（未提交）

- 新增 [可续跑核对验收器](scripts/test-cicd-reconciliation-live.mjs)，在 POST 前保存原 revision、幂等键及集群元数据。同 output 始终重放原操作；比较冻结身份、成功指针、Helm 存储元数据和 Deployment/Job/Service spec 摘要，不保存 Secret data 或 Values。
- 优雅停止专用测试 API，在临时实例显式关闭四个后台开关；两条已有 unknown 的人工核对仍可执行。每条同 output 两次通过、响应字节一致；同键变更理由和新键旧 revision 分别返回 idempotency_conflict / revision_conflict。两条状态与占用仍保留，fencing/成功指针不变。
- 向被占用的 podry-demo-auto 再次晋级返回 409 target_busy。有效验收前后独立数据库总数相同：9 Build / 11 Attempt / 7 Artifact / 2 Intent / 12 Preview / 12 Snapshot / 12 Request / 12 Deployment；每条仅新增一条核对审计，重放无重复。
- 首轮脚本误读绑定目标字段，集群比较作废；修正为 binding.target、增加必需字段校验后以新 output 完整重验通过。首轮实际 Job 核对及审计保留，不删除历史；详细审计基线与增量保存在证据中。
- 原测试 API 已恢复、临时实例已移除；原 API 仍可读取两条 unknown，app.podry.dev 正常 DNS/TLS 的 /ping 返回 200 pong。集群前后比较未观察到 Helm 记录或根配置变化，但不能替代集群审计证明没有短暂写入。
- 本轮无 Go 业务变更，未重跑 Go 全量集成。脚本语法/help、真实 HTTP 与只读数据库/集群验证通过；文档结构与链接、编码、敏感值和空白检查通过。根 web/ 与并行文档未改，未暂存/提交/推送。
- [完整记录](docs/backend/34-live-release-reconciliation.md)、[公开证据](docs/backend/evidence/2026-11-22-release-reconciliation.json)。下一步为业务 Secret 历史版本恢复、持续健康真实验收及在途崩溃/权限/凭据故障矩阵；unknown 最终收敛、生产恢复与安全 GC 仍未验收，T23/B6 未整体结项。

## 2026-11-22 真实业务 Secret 历史恢复（未提交）

- 扩展 [回滚验收器](scripts/test-cicd-rollback-live.mjs) 的可选 Secret 验证：随机测试值仅从环境注入，在内存比较归档 Helm Values、当前 Secret 和 Pod 引用，不打印/保存明文、Base64 或单值摘要。原无 Secret 模式保留，本轮未另跑旧夹具。
- 首个 podry-demo-secret 目标 v1 发布成功，升级停在 Helm revision 2 / pending-upgrade，平台 unknown；原工作负载仍为 v1，目标占用保留。只读拦截诊断及强制 dryRun=All 的创建/更新诊断能在相同预算完成，但未确定原提交中断根因，未修改超时、重提或强制解锁。
- 在新手动目标 podry-demo-secret-verified 复用既有两个 Artifact，完成旧版晋级、新版升级、凭据轮换至 v3 后的历史回滚。Helm revision 1 → 2 → 3、Chart 1.0.0 → 1.1.0 → 1.0.0、快照 SecretRef v1 → v2 → v1；真实 Secret 匹配历史 v1，与 v2/v3 不同，新执行 Secret 名称/UID 和 Pod 引用正确，旧镜像、一个副本、普通配置及 HTTP 恢复。
- 当前应用配置仍 v12/SecretRef v2，凭据仍 v3、三个加密历史版本保留；绑定 v1、workflow v6，成功指针更新为回滚。未读取应用进程环境，不将 Secret 数据与 Pod 引用验收写成应用逻辑消费证明；Helm 存储仍包含运行时 Secret，未宣称集群静态加密。
- 同 output 第二次运行通过，Request/Deployment 不变。全测试数据库续跑前后均为 9 Build / 11 Attempt / 7 Artifact / 2 Intent / 17 Preview / 17 Snapshot / 17 Request / 17 Deployment，无新增构建或重复任务；包含历史失败/unknown，非全成功。现有三条 unknown 均继续占用目标，原公网 HTTPS /ping 仍为 200 pong。
- 只读 SQL、API 元数据/快照/审计及五份验收输出的随机值原文/Base64 扫描通过；脚本语法/help、真实运行/续跑、文档/链接/编码/空白检查通过。本轮无 Go 业务/迁移变更，未重跑 Go 全量集成；未重启服务或改默认开关，未改根 web/，未暂存/提交/推送。
- [完整记录](docs/backend/35-live-secret-history-rollback.md)、[公开证据](docs/backend/evidence/2026-11-22-secret-history-rollback.json)。剩余：pending 升级根因与 unknown 有证据收敛、持续健康真实验收、集群凭据/Vault 密钥轮换与撤权/强杀/响应丢失/多实例矩阵、GitLab/Gitea Webhook、生产恢复和安全 GC。T23/B6 未整体结项。

## 2026-11-22 发布请求取消与脱敏诊断（未提交）

- 真实 HTTP 回归复现：Helm transport 覆盖原请求 context，取消请求后响应体仍阻塞。已改为保留原请求并绑定步骤取消，响应体完成/失败/关闭后释放绑定；原请求取消、步骤取消、客户端超时与响应生命周期用例通过。未延长 HTTP/步骤/Helm 时限，lease/fencing/占用保护不变。
- 提交增加阶段/操作/结果/安全错误分类与总耗时，HTTP 仅输出固定 method/resource、状态及响应头耗时。日志不包含原始错误、URL、对象名、Header 或报文；泄漏标记测试通过。真实 SDK 配合内存存储/fake 写端模拟升级失败后仍 unknown，重放没有再次 Update 或新增历史。
- 原 pending 仍未定位。补上真实 Helm 存储读取的隔离诊断在 16.047 秒内完成强制 dryRun 的 Secret 创建及 Service/Deployment 更新检查；存储写入仍在内存，DELETE 全拦截，不是完整真实提交。诊断前后原 UID/generation/旧执行身份保持，升级业务 Secret 未落地；三条 unknown 均继续占用。全测试库仍 9 Build / 11 Attempt / 7 Artifact / 2 Intent / 17 Preview / 17 Snapshot / 17 Request / 17 Deployment，公网 /ping 为 200 pong。
- internal/cmd 测试、发布包 vet/build、新增 SDK 故障回归，以及独立 PostgreSQL 的 6 个顶层集成用例/关闭恢复两个子用例通过。首次通用后端脚本因 web/dist 文件在 embed 枚举后消失而停在 vet，随后独立编译/执行定向后端集成；通用脚本与全量集成不标为通过。
- [完整记录](docs/backend/36-release-cancellation-diagnostics.md)、[公开证据](docs/backend/evidence/2026-11-22-release-cancellation-diagnostics.json)。未更新测试 API 二进制或重启/重新发布，修复后的真实提交验收仍待进行；未改根 web/、开发库或默认开关，未暂存/提交/推送。原 pending 根因、有证据收敛及 T23/B6 其余矩阵仍待处理。

## 2026-11-22 修复后真实发布与后台健康验收（未提交）

- 已编译并优雅更新独立测试 API，JSON /healthz 与鉴权应用读取通过。首轮验收等待未就绪后自动回退；修正验收路径/启动等待后完成更新，没有修改业务时限、lease 或身份保护。
- 原成功 Secret 绑定复用已有 Artifact，完成新升级 revision 4 和历史回滚 revision 5；新/旧镜像、两/一副本、历史 Secret v2/v1、Pod/Service HTTP 通过，回滚同 output 续跑 passes=2。当前配置 v12/SecretRef v2、凭据 v3 保留。升级日志定位本次短暂 unknown 为提交成功后的观察预算到期，后续只读收敛 succeeded；不能据此解释原 pending 故障。
- 新增 [后台健康只读验收器](scripts/test-health-live.mjs)。有效临时实例仅开启健康巡检，三个写 Worker 关闭；不调用资源刷新接口，两次自动观察间隔 51.953 秒，详情及 healthy 筛选正确。停用后观察年龄 62.002 秒时投影/详情/筛选回到 unknown，重启产生更新 healthy 观察并沿原 output 续跑通过。首轮重复环境变量配置的输出舍弃，最终证据使用四个唯一开关的实例。
- 临时巡检实例已回收，主测试 API 的健康开关仍关闭，后续缓存会正常过期；公网 /ping 仍 200 pong。健康生命周期期间发布计数保持不变；全测试库最终为 9 Build / 11 Attempt / 7 Artifact / 2 Intent / 19 Preview / 19 Snapshot / 19 Request / 19 Deployment，仅新增上述两条成功发布。原三条 unknown 均保留占用，没有重发、删除历史或强制解锁。
- [完整记录](docs/backend/37-live-release-and-background-health.md)、[公开证据](docs/backend/evidence/2026-11-22-live-release-background-health.json)。本轮无新的 Go 业务修改，未重跑全量 Go 测试；实际 Linux 编译/启动、真实链路与续跑、工具语法/help、文档/敏感值检查分别记录。未改根 web/、开发库或默认开关，未暂存/提交/推送。长期巡检容量、原 pending 根因、权限/轮换/强杀/响应丢失/多实例矩阵和 T23/B6 仍未整体完成。

## 2026-11-23 Gitea、GitLab、Gitee Webhook（未提交）

- 统一 `POST /api/webhooks/git/{provider}/{pipelineId}` 接入 github/gitea/gitlab/gitee；原 ReceiveGitHubWebhook 服务方法保留兼容包装。新增协议适配，不增加第二套构建执行器。
- Gitea 使用原始 body HMAC-SHA256，PushPayload 支持省略 deleted。GitLab 支持旧版 Secret Token 与新版 whsec_ Standard Webhooks 签名，投递身份优先 webhook-id/Idempotency-Key，兼容旧 Event UUID。Gitee 支持毫秒时间戳签名及显式 Token 模式；认证模式从凭据读取，不接受请求诱导回退。
- 独立 Secret 继续使用 data.webhookSecret，可选 data.webhookAuthMode=signature/token。Gitee 投递使用去除顶层 password/sign/timestamp 后的事件内容摘要，支持重签名重试；相同内容的独立事件会合并。Gitee 时间戳签名不覆盖 body，相关完整性依赖 HTTPS，未声称提供 raw-body HMAC。
- 新 provider 复用原委托用户/项目/凭据授权、CI 与仓库/分支验证、固定 SHA、Build/Attempt、Delivery 与安全审计原子事务，并保留自动部署意图捕获。新建投递 503 不消费身份，重放重验当前权限、认证及凭据版本；并发相同投递只产生一个构建。
- 正式迁移 v18 仅扩展 webhook_deliveries.provider 约束，仍为 36 张业务表。非 GitHub 投递历史（含 ignored）阻止降级，v17/dirty 被新二进制拒绝；没有修改历史迁移或 sqlc 查询。OpenAPI V1.24.0，仍为 79 个操作；生成模型无需变化。
- 首轮定向集成失败于新测试夹具：仅挂载 Webhook 的重建路由缺少凭据管理接口，后续轮换返回 404；已修正为重建重放后恢复完整测试路由。该轮不记为通过，最终回归结果单独补记。原始日志 D:/Temp/podry-webhook-providers-20261123.log。
- 本批未迁移开发库、重启现有测试 API、创建真实供应商 Webhook 或运行真实 CI/CD；四个默认 Worker 开关保持关闭，未修改根 web/，未暂存/提交/推送。实施与接入见 [四平台 Webhook](docs/backend/38-git-webhook-providers.md)。

| 本批最终验证 | 结果 |
| --- | --- |
| `./scripts/test-backend.ps1` | 完整退出码 0；193 个顶层、168 个子用例通过，0 失败，1 个真实集群只读用例因未注入配置跳过。包含 go vet/build、Linux 集成/服务二进制编译、隔离 PostgreSQL、v18 与历史降级保护、最小服务角色、备份恢复及停机检查；测试容器已自动回收 |
| `go test ./internal/... ./cmd/... -count=1` | 退出码 0，包含新协议单元测试和原有内部包回归 |
| sqlc/OpenAPI | sqlc vet 通过；独立目录重生成的 17 个 sqlc Go 文件及 OpenAPI 逐字节一致。OpenAPI SHA-256：`86c2e5e10015c64ce23c92ebe839de7a703996d5b546719eda44c1190680c4db` |
| 文档/格式 | 64 Markdown、617 本地链接、79 HTTP 操作、250 schema 引用、36 张设计表结构检查通过；本批 Go 格式、源码/文档编码与 diff 空白检查通过 |
| 本地证据 | 完整回归 D:/Temp/podry-webhook-providers-full-20261123.log；内部回归 D:/Temp/podry-webhook-providers-units-20261123.log。首轮夹具失败日志单独保留，不混入通过结果 |

后续验收：三家真实供应商 Webhook 配置/投递及完整自动 CI/CD；本批已完成业务和隔离集成实现，不等同于真实供应商投递成功。原有 unknown 根因、T23/B6 故障矩阵、生产恢复及安全 GC 仍保持既有待办。

## 2026-11-23 构建与发布资源自动清理

- 新增独立清理 Worker，默认 `PODRY_RESOURCE_CLEANUP_ENABLED=false`；构建保留 24h，被替代发布保留至少 168h。CI/CD 提交关闭时可以独立回收已安全结束的旧任务。
- 构建校验冻结输入、原 Job UID、控制器和 Pod 终态；七天内必须有可验证归档，超过日志有效期允许到期回收。归档损坏/缺失保留运行时资源；归档到期先安全移除确切文件，再记录 expired，防止原回收游标漏删文件。
- 发布只回收同一 binding/物理 target 被后续成功发布替代的旧 Job 与版本 Secret。当前工作负载、Helm 存储、快照/凭据版本、Artifact 和业务历史保留；旧 ReplicaSet、Pod 和 CronJob 等仍引用 Secret 时保留。Job 缺失也不能代替其原 Pod 已消失的证据。
- UID/resourceVersion 条件 DELETE + 消失复查，处理 finalizer、响应丢失、同名新 UID；持久调度/重试/安全审计，多实例 SKIP LOCKED，有界事务接入统一 drain/work。原执行状态、租约、目标占用和 fencing 不被清理任务重写。
- 正式迁移 v19，仍为 36 表；新增 cleanup_attempts/error_code/next_cleanup_at/resources_cleaned_at，存在清理历史拒绝降级。sqlc 查询及生成文件已更新；HTTP 仍为 V1.24.0/79 个操作。完整策略见 [清理合同](docs/backend/39-resource-cleanup.md)。
- 首轮 10 个定向集成用例通过，随后补充归档损坏/缺失、保留期/租约、当前/unknown 发布与 drain/finalizer/分页用例。全量回归期间修正过期归档文件回收、补强缺失 Job 的孤立 Pod 保护，并补齐 Ingress TLS、ServiceAccount、CSI 的引用检查；最终源码专项与全量快照分开验证。
- 未启用开发服务清理、迁移开发数据库或删除现有 K3s 资源；未修改 web/、未暂存/提交/推送。真实集群回收、CRD/外部控制器引用、共享日志存储多实例及生产恢复仍待验收；业务记录与 Registry blob 保留策略仍待开发。

| 本批验证 | 结果与范围 |
| --- | --- |
| 全量 `./scripts/test-backend.ps1` | 退出码 0；200 个顶层、176 个子用例通过，0 失败，1 个真实集群只读用例未注入配置而跳过。含 go vet/build、隔离 PostgreSQL、迁移/历史保护、最小角色、备份恢复与停机；该编译快照早于随后几项清理边界补强 |
| 最终源码清理专项 | `-TestPattern TestResourceCleanup` 退出码 0；9 个顶层、8 个子用例通过，覆盖最终归档文件回收、缺失 Job/孤立 Pod 和扩展后的引用列表；未把分层验证描述为最终源码的一次完整全量运行 |
| 最终源码内部回归 | `go test ./internal/... ./cmd/... -count=1` 退出码 0；包括 Ingress/ServiceAccount 端点、CSI 引用、分页不完整、finalizer 及清理配置单元测试 |
| SQL / 文档 / 配置 | sqlc vet 通过；独立目录重生成 18 个 Go 文件逐字节一致；65 Markdown、629 本地链接、79 HTTP 操作、250 schema 引用、36 张设计表结构检查通过；Compose 配置与本批 diff 空白检查通过 |
| 复跑中断与恢复 | 一次专项复跑在 go vet 根包阶段被 PowerShell NativeCommandError 中断，仅捕获包头，没有足够诊断确认根因；独立 go vet 重跑退出码 0，随后最终专项复跑完整通过。未修改或重建 web/ 来绕过检查 |
| 本地日志 | 全量 D:/Temp/podry-cleanup-full-20261123.log；最终内部回归 D:/Temp/podry-cleanup-final-units-20261123.log；最终清理专项 D:/Temp/podry-cleanup-verified-retry-20261123.log。测试容器由脚本自动回收 |
