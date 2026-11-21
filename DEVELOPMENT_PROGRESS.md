# Podry 开发进度与待办

更新日期：2026-11-21。本文记录本次后端提交的实现基线及剩余工作；后续开发完成后应同步更新本文件和对应后端实施记录。

## 当前基线

- 技术栈：Go + chi、PostgreSQL + pgx/v5 + sqlc；CI 为 Kubernetes Job + BuildKit，CD 为 Helm SDK + 内置版本化 Chart。
- HTTP 合同：OpenAPI V1.8.0，共 76 个操作，61 个已实现、15 个待实现。接口已实现不等同于真实集群或 CI/CD 验收完成。
- 正式数据库迁移：v7，28 张业务表及 schema_migrations；`docs/data/schema.sql` 是包含后续能力的 31 表设计稿，不能代替正式迁移。
- 默认 `PODRY_BUILD_ENABLED=false`、`PODRY_RELEASE_ENABLED=false`。真实 CI/CD 按当前安排暂缓，保持配置、读取和离线预览可独立联调。
- 前端正在独立开发，本次不提交根目录 `web/`、其配套页面检查脚本及根 README 的前端改动。本文的状态仅代表后端，不代表前后端已完成联调。

## 已实现

| 阶段 | 已实现内容 | 验证边界 / 入口 |
| --- | --- | --- |
| B1 基础与身份 | 显式数据库迁移、CLI 建账、登录/退出/token 失效、团队/项目/成员、权限、审计、幂等事务 | [基础实施记录](docs/backend/05-implementation.md)；使用真实隔离 PostgreSQL 验证 |
| B2 平台接入与资源读取 | 加密版本化凭据、Registry/集群/环境/grant、显式连接测试、Discovery、Namespace、资源列表/详情、事件、Pod 日志 | [管理配置](docs/backend/06-control-plane.md)、[Kubernetes 读取](docs/backend/08-kubernetes-resources.md)；Secret 脱敏、UID/权限重验 |
| B3 应用与工作流 | 应用创建/查询/修改/归档、Git/Build/Base 分节配置与乐观锁、build_only/build_deploy 原子模板、一 CI 与实际 CD 集合、setup 派生状态 | [任务与分期](docs/backend/02-task-breakdown.md)、[接口矩阵](docs/backend/03-api-delivery-matrix.md)；保存配置不隐式执行 |
| B4 Git 与持久构建 | 分支/提交查询与固定 SHA、持久任务/lease/revision、受控 runner、Job 创建/准备/启动恢复、Registry digest 复核、Artifact、历史、NDJSON 日志与七天归档 | [Git 选择](docs/backend/07-git-material.md)、[构建执行](docs/backend/09-build-execution.md)；真实远端 CI 尚未验收 |
| B4 示例项目 | `docs/example/podry-demo`，Go + chi + embed，最小 ping/pong、Dockerfile 和使用说明 | [示例与本地 CI 记录](docs/backend/10-ci-local-demo.md)；本地构建记录不代表远端流水线验收 |
| B5 发布规划与执行 | 内置 Chart、离线预览、不可变快照、发布确认、请求与执行历史、持久 Helm Worker、物理目标占用/fencing、unknown 核对、成功后更新当前发布指针 | [发布规划](docs/backend/11-release-planning.md)、[执行与恢复](docs/backend/12-release-execution.md)；执行器默认关闭，恢复不重复 Submit |
| B5 应用观察 | 记录 UID 与控制器 OwnerReference 的资源归属、应用资源查询、期望快照与实时资源 Diff、查询时健康观察、60 秒缓存、setup 发布候选 | [应用资源与健康](docs/backend/13-application-observation.md)；后台持续健康轮询尚未实现 |
| B6 / T24 离线部分 | 停止领取与在途收尾分离、HTTP/Worker/连接池共用停机时限、强制退出保留提交意图、隔离数据库备份恢复演练与操作说明 | [进程启停与备份恢复](docs/backend/14-runtime-recovery.md)；未完成真实链路、生产恢复或外部资源清理验收 |

## 剩余 P0 开发与验收

| 优先顺序 | 工作 | 当前状态及完成要求 |
| --- | --- | --- |
| 1 | T23 真实 CI 全链路 | 等待可互通的 Git、BuildKit、Registry 与构建集群；验证固定 SHA 拉取、受控 runner、真实镜像推送与 digest 复核，不能用 fixture Artifact 替代 |
| 2 | T23 真实 CD 全链路 | 在受控环境验证 Helm 提交、Deployment/Job 结果、应用资源/实时 Diff/健康，以及请求、部署、产物与快照的追溯链 |
| 3 | T23 故障注入与权限验收 | 在真实执行端验证进程重启、提交响应丢失、部分写入、超时、凭据轮换、权限撤销、同名新 UID 和同物理目标互斥；按 BE-AC01–12 留证据 |
| 4 | T24 生产恢复与安全清理 | 已有隔离 PG 演练；仍需真实部署的多实例停机/隔离、备份集合恢复及外部状态核对；Job/Secret/ConfigMap 安全 GC、业务记录保留期未实现 |
| 5 | 持续健康观察 | 当前依赖应用资源 GET 刷新健康缓存；后台持续轮询、调度/失效/权限策略和实际部署验证待开发 |

T23 / B6 尚未验收，后续 P1 进入条件保持原计划。开发时不能把未知状态置为成功或直接清除目标占用；受控人工核对与处置仍需后续合同和实现。Git SHA-256 仓库及多副本运行兼容性尚未完成验证/适配。

## 剩余 15 个 HTTP 操作

路径均省略 `/api`。当前这些操作未注册，按现有约定返回 JSON 404。

| 阶段 | 方法与路径 | 待实现内容 |
| --- | --- | --- |
| E03 / P1 | `POST /apps/{appId}/environments` | 新增独立环境绑定、目标与授权/版本校验 |
| E03 / P1 | `PUT /apps/{appId}/environments/{bindingId}` | 修改绑定/覆盖、占用检查与乐观锁 |
| E01 / P1 | `POST /builds/{buildId}/cancel` | 取消等待实际退出，处理取消/完成竞态 |
| E01 / P1 | `POST /builds/{buildId}/retry` | 固定原输入并新增 Attempt |
| E04 / P1 | `POST /apps/{appId}/artifacts` | 导入已有镜像并从 Registry 解析固定 digest |
| E05 / P1 | `POST /deployments/{deploymentId}/promote` | 复用 Artifact，使用目标环境配置 |
| E05 / P1 | `POST /deployments/{deploymentId}/rollback` | 复用历史完整快照及准确 Chart/Secret 版本 |
| E06 / P1 | `POST /clusters/{clusterId}/resources/dry-run` | 逐对象预览、权限与版本检查、敏感 YAML 保护 |
| E06 / P1 | `POST /clusters/{clusterId}/resources/apply` | 重验预览并逐对象提交，返回部分成功/失败 |
| E07 / P1 | `POST /clusters/{clusterId}/resource-actions` | UID 删除、重启、扩缩容与 HPA 边界 |
| E06/E07 / P1 | `GET /resource-operations/{operationId}` | 异步资源操作与部分失败详情 |
| E09 / P2 | `POST /clusters/{clusterId}/secrets/reveal` | 独立明文授权、审计与 no-store |
| E09 / P2 | `POST /clusters/{clusterId}/exec-sessions` | 短期一次性票据、Origin/用户/Pod UID 校验 |
| E09 / P2 | `DELETE /exec-sessions/{sessionId}` | 会话归属、关闭与资源回收 |
| E02 / P1 | `POST /webhooks/git/{provider}/{pipelineId}` | 首批 GitHub 验签、Delivery 去重及显式自动部署策略 |

已实现接口中的后续分支也需要开发：image/clone 应用、external_image/add_deploy 模板、额外 CD/环境覆盖、push/on_ci_success；资源人工修改/漂移复用 E06/E08，不静默回写基础配置。P2 Secret/exec 仍需独立评审。

## 2026-11-21 验证记录

以下为本次提交前同一工作树的最近完整验证，详细过程见各阶段实施记录；不将 Mock/SDK fake 结果描述为真实集群验收。

| 检查 | 实际结果 |
| --- | --- |
| `./scripts/test-backend.ps1` | 60 个顶层集成用例和 15 个子用例通过，1 个真实集群用例因未配置秘密环境跳过；包含 go vet/build、Linux 编译、真实隔离 PG、迁移/最小角色、真实 pg_dump/pg_restore 和编译后二进制停机 |
| `go test ./internal/... ./cmd/... -count=1` | 通过，含 Bootstrap、配置、Chart 和 Helm 观察单元测试 |
| `docker compose config --quiet` | 通过，仅解析配置 |
| `node docs/tools/check-docs.mjs` | 通过，结构检查；不代替 SQL 执行或 HTTP 契约验收 |
| 暂存快照检查 | 单独导出暂存树后文档结构检查通过，不依赖未提交文件；根目录本进度记录的相对链接也已检查 |
| OpenAPI | V1.8.0，SHA-256：`e475bd8060b97fcd5c848c7dfb24d20d58d3d636898ef1e7906123a8535c81b1` |

测试未修改开发数据库或真实集群。Go 服务的 embed 构建需要先具备 `web/dist` 静态资源；本次不提交前端改动，未将本轮后端验证扩大为干净检出的前端构建或前后端联调验收。

## 本次提交范围

提交后端代码、正式迁移与 sqlc 生成代码、受控构建 runner、测试、后端运行配置、示例及规划/合同/实施文档，保留既有注释。

不提交根目录 `web/`、根 README 的并行前端改动、`scripts/check-pipeline.mjs`、本地编辑器状态、运行产物或集群秘密文件 `docs/k3s.yaml`。`docs/example/podry-demo/web/dist/index.html` 是示例项目最小 embed 资源，属于示例源码；历史 `docs/prototype/` 和 `docs/references/` 为交互/规划证据，不代表本次交付 Web 应用。

下一次继续开发时，先核对 [后端任务清单](docs/backend/02-task-breakdown.md) 与本文件；环境未恢复时可完善离线验收准备，但不能标记真实 CI/CD 或 B6 已验收。
