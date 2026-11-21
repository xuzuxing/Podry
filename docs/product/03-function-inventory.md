# 功能点清单：现状与分层

版本 V1.0 / 日期：2026-11-20 · 口径：以 [OpenAPI 3.1](../api/openapi.json)（61 路径 / 79 操作）、[产品说明](01-product-spec.md)、[技术架构](../architecture/01-architecture.md)、`web/` 与 `internal/` 工作树为准

> 历史基线提示：本文下方“0 个已实现”、起始模板和“合同有”状态保留为规划时快照，不代表当前工作树。v11 历史批次为 68 个操作已实现、8 个待开发；当前状态以正文最新增量、[接口矩阵](../backend/03-api-delivery-matrix.md) 和 [根进度](../../DEVELOPMENT_PROGRESS.md) 为准。真实 CI 验收尚待环境联调。

## 0. 一句话

**当前后端 79 个 HTTP 操作已全部实现。** 合同定义了 **79 个 HTTP 功能点 + 14 个平台功能点**：后端分期 P0 61 / P1 15 / P2 3，前端首版原清单需要其中 42 个。以下保留初始盘点的功能分类及部分历史现状，当前交付以文末后端增量和 [接口矩阵](../backend/03-api-delivery-matrix.md) 为准；真实 CI/CD 与 B6 尚未验收。

## 1. 现在实际有什么

| 层 | 现状 | 证据 |
| --- | --- | --- |
| 前端 | Vue 3 起始模板：`App.vue` 渲染 `HelloWorld`，依赖只有 `vue` | `web/package.json`、`web/src` |
| 后端 HTTP | 只有 `GET /healthz` 与 SPA 兜底；**`/api` 路由 0 条** | `internal/server/router.go` |
| 后端代码 | `router.go`（118 行）、`config.go`（46 行）、`main.go` | `internal/`、`cmd/` |
| 配置 | `config.go` 只读 `ENVIRONMENT/PODRY_SERVER_ADDR/PODRY_DATA_DIR/JWT_*`；JWT 字段**未被任何代码使用** | `internal/config/config.go` |
| 数据库 | `docker-compose` 有 `postgres` 服务；代码无 pgx 连接、无迁移、无 sqlc 生成物；`config.go` **不读 `DATABASE_URL`** | `docker-compose.yml`、`config.go` |
| 合同 | 76 个操作、31 张表、13 个错误码（设计稿，非实现） | `docs/api`、`docs/data` |
| 文档 | 产品/流程/页面/迁移方案齐备，可作为实现依据 | `docs/` |

## 2. 分层统计

两个口径不冲突，不要混用：

| 视角 | 分层 | 数量 | 依据 |
| --- | --- | ---: | --- |
| **后端交付**（排期权威） | P0 / P1 / P2 | **61 / 12 / 3** | [接口分期矩阵](../backend/03-api-delivery-matrix.md) |
| **前端首版**（本文"前端首版"列） | 需要 / 不需要 | **42 / 34** | [轻量化迁移方案](../migration/01-devtron-to-vue-plan.md) P0 |
| 缺合同 | 端点缺失 | 1（项目详情） | 本文 §3.1 |
| 缺合同 | 字段不足 | 4 项 | 本文 §3.7 |
| 平台功能点 | 非 HTTP | 14 | 本文 §4 |

后端 P0 的 61 个覆盖了前端首版需要的 42 个，多出的 19 个是管理类与前置能力：团队/项目成员增删、集群详情与接入、凭据与 Registry、资源授权、环境创建、连接测试。`POST /apps/{appId}/environments`（独立建绑定）与 `POST /apps/{appId}/artifacts`（镜像导入）在后端均按 P1 排期，前端首版不依赖它们（首个绑定由完整模板原子创建）。2026-11-21 已提前实现 E03 的独立建绑定及更新覆盖，连同 E01/E05 和 E04 镜像导入，加上 E06 资源写入和 E07 资源动作，后端当前总计 72 个已实现操作；应用克隆随后补齐，详见 [克隆记录](../backend/19-application-cloning.md) 和 [镜像导入](../backend/18-image-artifacts.md)。

## 3. 功能点明细

图例：`合同有`＝OpenAPI 已定义、代码未实现。"前端首版"列 `✓` 表示首版页面要用到，`需补` 表示要用但合同缺端点，`—` 表示首版不做（后端分期仍是 P0 或 P1，见 [接口分期矩阵](../backend/03-api-delivery-matrix.md)）。

### 3.1 身份与归属

| ID | 功能点 | 前端首版 | 端点 | 现状 |
| --- | --- | --- | --- | --- |
| ID-01 | 登录（Bearer） | ✓ | `POST /auth/login` | 合同有 |
| ID-02 | 当前身份 | ✓ | `GET /auth/me` | 合同有 |
| ID-03 | 登出（使旧 token 失效） | ✓ | `POST /auth/logout` | 合同有 |
| TM-01 | 团队列表 | ✓ | `GET /teams` | 合同有 |
| TM-02 | 创建团队 | — | `POST /teams` | 合同有 |
| MB-01 | 团队成员列表 | ✓ | `GET /teams/{id}/members` | 合同有 |
| MB-02 | 成员新增 / 改角色 | ✓ | `POST /teams/{id}/members` | 合同有 |
| MB-03 | 移除团队成员 | — | `DELETE /teams/{id}/members/{userId}` | 合同有 |
| MB-04 | 项目成员列表 | — | `GET /projects/{id}/members` | 合同有 |
| MB-05 | 项目成员新增 / 改角色 | — | `POST /projects/{id}/members` | 合同有 |
| MB-06 | 移除项目成员 | — | `DELETE /projects/{id}/members/{userId}` | 合同有 |
| PJ-01 | 项目列表 | ✓ | `GET /projects` | 合同有 |
| PJ-02 | 创建项目 | ✓ | `POST /projects` | 合同有 |
| PJ-03 | **项目详情** | 需补 | 无 | **缺合同**（只能从列表筛） |

### 3.2 平台配置

| ID | 功能点 | 前端首版 | 端点 | 现状 |
| --- | --- | --- | --- | --- |
| CL-01 | 集群列表 | ✓ | `GET /clusters` | 合同有 |
| CL-02 | 集群详情 | — | `GET /clusters/{id}` | 合同有 |
| CL-03 | 集群接入（kubeconfig / 凭据） | — | `POST /clusters` | 合同有 |
| CL-04 | 集群更新 | — | `PATCH /clusters/{id}` | 合同有 |
| CL-05 | 连接测试 | — | `POST /clusters/{id}/connection-tests` | 合同有 |
| GR-01 | 资源授权列表 | — | `GET /clusters/{id}/resource-grants` | 合同有 |
| GR-02 | 新增资源授权 | — | `POST /clusters/{id}/resource-grants` | 合同有 |
| GR-03 | 删除资源授权 | — | `DELETE /clusters/{id}/resource-grants/{grantId}` | 合同有 |
| EN-01 | 环境列表 | ✓ | `GET /environments` | 合同有 |
| EN-02 | 创建环境 | — | `POST /environments` | 合同有 |
| CR-01 | 凭据列表（不回显明文） | — | `GET /credentials` | 合同有 |
| CR-02 | 创建凭据 | — | `POST /credentials` | 合同有 |
| CR-03 | 轮换凭据 | — | `PUT /credentials/{id}` | 合同有 |
| RG-01 | Registry 列表 | — | `GET /registries` | 合同有 |
| RG-02 | 创建 Registry | — | `POST /registries` | 合同有 |

### 3.3 应用与配置

| ID | 功能点 | 前端首版 | 端点 | 现状 |
| --- | --- | --- | --- | --- |
| AP-01 | 应用列表 / 跨项目搜索 | ✓ | `GET /apps?projectId&keyword&health&environmentId` | 合同有 |
| AP-02 | 创建应用 / 克隆 | ✓ | `POST /apps`（`cloneFromAppId`） | 合同有 |
| AP-03 | 应用详情 | ✓ | `GET /apps/{appId}` | 合同有 |
| AP-04 | 归档应用 | ✓ | `PATCH /apps/{appId}` `{archived}` | 合同有 |
| CF-01 | 读配置（含历史版本） | ✓ | `GET /apps/{appId}/config?version` | 合同有 |
| CF-02 | 分节保存（乐观锁） | ✓ | `PUT /apps/{appId}/config` | 合同有 |
| ST-01 | 配置门控投影（steps / canBuild / 可发布绑定） | ✓ | `GET /apps/{appId}/setup` | 合同有 |
| WT-01 | 从模板建工作流（原子 CI + Binding + CD） | ✓ | `POST /apps/{appId}/workflow-templates` | 合同有 |
| GT-01 | 分支查询 | ✓ | `GET /apps/{appId}/git/branches` | 合同有 |
| GT-02 | 提交查询（固定 SHA） | ✓ | `GET /apps/{appId}/git/commits?ref` | 合同有 |
| BD-01 | 环境绑定列表 | ✓ | `GET /apps/{appId}/environments` | 合同有 |
| BD-02 | 独立创建环境绑定 | — | `POST /apps/{appId}/environments` | 后端已实现，真实执行待验收 |
| BD-03 | 更新绑定 / 环境覆盖 | — | `PUT /apps/{appId}/environments/{bindingId}` | 覆盖已实现；目标/环境不可变 |
| WF-01 | 读工作流（一 CI 多 CD） | ✓ | `GET /apps/{appId}/pipelines` | 合同有 |
| WF-02 | 保存工作流 | ✓ | `PUT /apps/{appId}/pipelines` | 合同有 |

### 3.4 构建与产物

| ID | 功能点 | 前端首版 | 端点 | 现状 |
| --- | --- | --- | --- | --- |
| BU-01 | 构建历史 | ✓ | `GET /apps/{appId}/builds` | 合同有 |
| BU-02 | 触发构建 | ✓ | `POST /apps/{appId}/builds` | 合同有 |
| BU-03 | 构建详情 | ✓ | `GET /builds/{buildId}` | 合同有 |
| BU-04 | Attempt 列表与日志可用性 | ✓ | `GET /builds/{buildId}/attempts` | 合同有 |
| BU-05 | 取消构建 | — | `POST /builds/{buildId}/cancel` | 合同有 |
| BU-06 | 重试构建（新 attempt） | — | `POST /builds/{buildId}/retry` | 合同有 |
| BU-07 | 构建日志（NDJSON） | ✓ | `GET /builds/{buildId}/logs?follow&cursor` | 合同有 |
| AR-01 | 产物列表（digest） | ✓ | `GET /apps/{appId}/artifacts` | 合同有 |
| AR-02 | 外部镜像导入 | — | `POST /apps/{appId}/artifacts` | 后端已实现；真实拉取待验收 |

### 3.5 发布

| ID | 功能点 | 前端首版 | 端点 | 现状 |
| --- | --- | --- | --- | --- |
| DP-01 | 发布预览（快照 + Diff + previewId） | ✓ | `POST /apps/{appId}/deployment-previews` | 合同有 |
| DL-01 | 发布历史 | ✓ | `GET /apps/{appId}/deployments?bindingId` | 合同有 |
| DL-02 | 创建发布请求（消费 previewId） | ✓ | `POST /apps/{appId}/deployments` | 合同有 |
| DL-03 | 发布请求详情 | ✓ | `GET /release-requests/{requestId}` | 合同有 |
| DL-04 | 部署详情（Helm 观察） | ✓ | `GET /deployments/{deploymentId}` | 合同有 |
| DL-05 | 配置 Diff | — | `GET /deployments/{deploymentId}/diff` | 合同有 |
| DL-06 | 晋级（复用产物） | — | `POST /deployments/{id}/promote` | 已实现请求业务；复用产物与目标当前配置，真实执行待验收 |
| DL-07 | 回滚（历史快照重新发布） | — | `POST /deployments/{id}/rollback` | 已实现请求业务；历史 Chart/Secret/Values、新 Job 身份，真实执行待验收 |
| DL-08 | 发布人工核对 | — | `POST /deployments/{id}/reconcile` | 已实现：当前完整授权、只读证据、revision/lease/fencing、事务审计与幂等；unknown 不强制解锁 |

### 3.6 运行资源

| ID | 功能点 | 前端首版 | 端点 | 现状 |
| --- | --- | --- | --- | --- |
| RS-01 | 应用运行资源清单 | ✓ | `GET /apps/{appId}/resources?bindingId` | 合同有 |
| RS-02 | 应用漂移摘要与观察历史 | — | `GET /apps/{appId}/drift?bindingId&refresh` | E08 已实现当前成功发布基线、只读刷新与脱敏数量历史，不回写配置或自动修复 |
| DS-01 | 资源类型发现（GVR / category / verbs） | ✓ | `GET /clusters/{id}/discovery` | 合同有 |
| DS-02 | Namespace 列表 | ✓ | `GET /clusters/{id}/namespaces` | 合同有 |
| RL-01 | 资源列表（continueToken） | ✓ | `GET /clusters/{id}/resources` | 合同有 |
| RL-02 | 资源详情（Manifest） | ✓ | `GET /clusters/{id}/resource` | 合同有 |
| RL-03 | 资源事件 | ✓ | `GET /clusters/{id}/events` | 合同有 |
| EX-01 | Pod 日志流 | ✓ | `GET /clusters/{id}/pod-logs` | 合同有 |
| RW-01 | 多文档 Dry Run | — | `POST /clusters/{id}/resources/dry-run` | 合同有 |
| RW-02 | Apply（逐对象结果） | — | `POST /clusters/{id}/resources/apply` | 合同有 |
| RW-03 | 资源操作（删除 / 重启 / 扩缩容） | — | `POST /clusters/{id}/resource-actions` | E07 已实现，执行默认关闭 |
| RW-04 | 操作结果查询 | — | `GET /resource-operations/{id}` | 合同有 |
| RW-05 | 操作人工只读核对 | — | `POST /resource-operations/{id}/reconcile` | 已实现：当前拥有者完整授权、revision/lease、逐项证据、pending 跳过与原子审计/幂等 |
| SC-01 | Secret 明文读取（独立授权 + 审计） | P2 | `POST /clusters/{id}/secrets/reveal` | 合同有 |
| EX-02 | 终端会话创建（ticket） | P2 | `POST /clusters/{id}/exec-sessions` | 合同有 |
| EX-03 | 终端会话关闭 | P2 | `DELETE /exec-sessions/{sessionId}` | 合同有 |

### 3.7 审计与外部事件

| ID | 功能点 | 前端首版 | 端点 | 现状 |
| --- | --- | --- | --- | --- |
| AU-01 | 操作审计列表 | ✓ | `GET /audit-events` | 合同有 |
| WH-01 | Git Webhook（验签 + Delivery 去重） | — | `POST /webhooks/git/{provider}/{pipelineId}` | 合同有 |

**字段级缺口**（端点有、字段不够用）：`Deployment` 无失败原因与 `updatedAt`；`Build` 无 `errorCode`（在 `BuildAttempt` 上）；`Application` 无环境数与最近发布；`DeployValues` 的 `resources/service/ingress/env/volumes` 无子结构；`User` 无权限清单与项目角色。

## 4. 平台功能点（非 HTTP，14 项）

这 14 项不暴露为接口，但缺任何一项，上面的 76 个功能点都跑不起来。

| ID | 功能点 | 现在 | 关键难点 |
| --- | --- | --- | --- |
| P-01 | 数据库连接与 31 张表迁移 | 无（`config.go` 不读 `DATABASE_URL`） | 先落地 8 张核心表才能跑闭环 |
| P-02 | sqlc 查询生成与事务边界 | 无 | "短事务领取 → 外部 I/O → 短事务落结果" |
| P-03 | 凭据与 Secret 版本加密（主密钥独立） | 无 | 主密钥与备份分离、轮换 |
| P-04 | 幂等记录（`idempotency_records`） | 无 | 作用域 `(user, op, key)`、24h 保留、unknown 不过期 |
| P-05 | 审计写入（覆盖所有写操作） | 无 | 脱敏；被拒绝也要记 |
| P-06 | 认证中间件与 tokenVersion | 无（JWT 配置未使用） | 登出使旧 token 立即失效 |
| P-07 | 权限动作与归属校验 | 无 | 11 个动作 × 项目 × 集群/Namespace 授权交集 |
| P-08 | 集群客户端池（client-go + Discovery 缓存） | 无 | 凭据更新失效旧连接；缓存不等于授权 |
| P-09 | 构建执行器（Job + BuildKit + 上下文拉取） | 无 | 无集群权限的构建容器、超时、清理 |
| P-10 | 发布执行器（Helm SDK + 内置 Chart + 串行锁） | 无 | 同目标串行、unknown 保留占用、确定性 Job 名 |
| P-11 | 流网关（NDJSON 日志、WS exec ticket） | 无 | 认证流、断线语义、ticket 单次 30s |
| P-12 | 日志归档与保留（`log_archives`） | 无 | `logAvailability` 四态派生 |
| P-13 | 管理员/账户 CLI（初始化超管、停用账户） | 无（`cmd/podry` 只有 serve） | 无自助注册、无默认口令 |
| P-14 | 启动自检与就绪（产物 / DB / 主密钥） | 半个（`main.go` 只检查 `index.html`） | 缺 DB、主密钥、构建集群预检 |

## 5. 其他（非前端）七条战线

| 战线 | 现在有什么 | 要建什么 | 主要依赖 |
| --- | --- | --- | --- |
| 数据层 | `docker-compose` 里的 postgres，代码零接入 | pgx 连接池、迁移工具、sqlc、31 表（先 8 张） | P-01 / P-02 |
| 身份与授权 | JWT 配置项（未使用） | 登录/登出、tokenVersion、11 个动作、项目与资源授权交集 | P-06 / P-07 |
| 集群接入 | 无 | kubeconfig 解析与加密、客户端池、连接测试、Discovery、限流 | P-03 / P-08 |
| 构建执行 | 无 | Job 编排、BuildKit 调用、Git 拉取、日志采集、取消/重试、产物入库 | P-09 / P-11 / P-12 |
| 发布执行 | 无 | 内置 Chart、Helm SDK、快照冻结、目标串行、状态观察、unknown 核对、晋级/回滚 | P-10 |
| 实时通道 | 无 | NDJSON（构建日志、Pod 日志）、WS + ticket（终端）、断线语义 | P-11 |
| 平台运维 | `main.go` 会检查内嵌产物 | 单实例部署、持久卷（日志/Chart）、主密钥注入、备份策略、健康检查 | P-13 / P-14 |

## 6. 最小闭环：先建这 10 个功能点

前端可以先用 Mock 起步，但真实闭环依赖下面的顺序（对应后端 M1–M5）：

| 序 | 功能点 | 为什么先做 |
| ---: | --- | --- |
| 1 | P-01 / P-02 + 8 张核心表 + 迁移 | 没有它，其余只能 Mock |
| 2 | ID-01/02/03 + P-06 | 所有请求的入口 |
| 3 | PJ-01/02、TM-01、MB-01/02 | 决定应用归属与可见范围 |
| 4 | AP-01~04、CF-01/02、ST-01 | 应用与配置是闭环起点 |
| 5 | CL-01、DS-01/02、P-08 | 资源查看的前置（先接一个集群） |
| 6 | GT-01/02 | 选择提交，只读投影 |
| 7 | BU-02/03/04/07 + P-09 | 真正产出镜像 |
| 8 | AR-01、DP-01、DL-02/04 + P-10 | 形成发布闭环 |
| 9 | RS-01、RL-01/02/03、EX-01 | 看到运行结果 |
| 10 | AU-01 + P-05 | 写操作全程可追溯 |

## 7. 开工前要统一的 5 处矛盾

| # | 矛盾 | 影响 | 建议 |
| --- | --- | --- | --- |
| 1 | `.env.example` 与 `config.go` 有 Refresh Token 配置（15m / 168h），但 [接口约定](../api/01-api-spec.md) 写"首版无 Refresh Token 协议" | 登录实现二选一不明 | 按接口约定：单 access token + tokenVersion，删除 refresh 配置 |
| 2 | 旧前端用 `organizations`，合同是 `teams`，文档措辞"团队" | 路由与 store 命名反复 | 统一为"团队 + 项目" |
| 3 | `config.go` 不读 `DATABASE_URL`，但 compose 与 `.env.example` 有 | 部署后连不上库 | 补配置读取与启动校验 |
| 4 | `User` 只有 `isSuperAdmin`，产品要求 11 个权限动作 | P0 权限做不了 | `/auth/me` 增 `permissions[]` 与项目角色 |
| 5 | `Deployment` 无失败原因、`Application` 无环境摘要 | P0"失败原因""头部环境数"缺数据 | 补字段，或在页面改用 Events/捆绑 N+1 |

## 8. 统计口径

- 79 个 HTTP 功能点 = OpenAPI 的 79 个 operation，一操作对一功能点；`GET /apps` 的多个筛选条件算一个功能点。
- "前端首版"列的 42 项与 [轻量化迁移方案](../migration/01-devtron-to-vue-plan.md) 的 P0 清单一致；差异仅为本文把"登出""团队与成员查看"算进首版（缺了它们页面不可用），把独立建绑定与镜像导入留在 P1。
- 后端分期（61 / 14 / 3）以 [接口分期矩阵](../backend/03-api-delivery-matrix.md) 为准；两处文档不一致时应改本文，不改矩阵。
- "现状"列只反映当前工作树；前端迁移按 `web/` 为 Vite + Vue 3 空工程处理。历史原型与验证记录仅用于交互溯源，不代表当前实现状态。

## 2026-11-21 后端增量

E08 已补齐，新增第 77 个 HTTP 操作、P1 合计 13 个；正式迁移 v14 共 31 张业务表，完整设计稿共 32 张表。漂移只比较当前成功发布的投影根，Secret 值不参与比较；缓存与历史都重验授权，平台未完成操作、版本变化或过期投影 unknown。见 [应用漂移](../backend/22-application-drift.md)。前文初始盘点的“合同有/无实现”等静态描述保留为历史口径，当前后端状态以本节和交付矩阵为准。

当前 OpenAPI V1.22.0：79 个已实现、0 个待实现；E01 构建取消与重试已提前实现业务，补充 E03 多环境与 E05 晋级/回滚；E04 镜像导入、镜像应用和 external_image 已实现，原子克隆已补齐，见 [实施记录](../backend/19-application-cloning.md)。E06 预览/异步提交/查询也已提前实现，见 [资源写入](../backend/20-resource-writes.md)。E07 的 UID 删除、Deployment 重启/扩缩容及 HPA/发布冲突已实现，见 [资源动作](../backend/21-resource-actions.md)。分期数量以当前矩阵为准，不能据此认为 B6 或真实 CI/CD 已验收；执行器仍默认关闭。详见 [构建取消与重试](../backend/17-build-actions.md) 和 [交付矩阵](../backend/03-api-delivery-matrix.md)。

E02 首批 GitHub Push Webhook 已实现验签、持久 Delivery 去重与 Build/Attempt 原子入队；正式迁移 v15，共 33 张业务表。后续 v16 已补齐 on_ci_success、显式非生产自动部署、持久意图/去重/恢复及构建详情状态，共 35 张业务表，见 [自动部署](../backend/24-ci-auto-deploy.md)；生产手动，真实执行仍待验收。Push 合同见 [Webhook](../backend/23-git-webhooks.md)。

T22 持续健康巡检已实现，见 [后台健康](../backend/25-background-health.md)。v17 共 36 张业务表；全局默认关闭，使用最近发布请求者的当前权限，持久租约与失败缓存失效，不触发集群写入。真实轮询容量和集群健康仍待独立验收。


发布人工核对已补齐，第 78 个 HTTP 操作、P1 共 14 个；不新增迁移，正式仍为 v17、36 张表。只读核对可独立于后台开关使用，真实集群及故障恢复仍待验收，见 [实施合同](../backend/26-release-reconciliation.md)。

资源 Apply/动作人工核对已补齐，第 79 个 HTTP 操作、P1 共 15 个；原拥有者当前权限、revision/lease 和凭据重验，核对不重发写入、pending 标记跳过，证据不足继续 unknown。正式仍为 v17、36 张表，见 [实施合同](../backend/27-resource-reconciliation.md)。

E09 已补齐 Secret 指定 key 明文读取、终端会话创建/关闭及真实 WebSocket/SPDY 桥接。独立授权、UID/凭据重验、一次性票据和停机回收见 [Secret 与终端](../backend/28-sensitive-resource-access.md)。会话临时存在进程内，数据库仍 v17；fixture 通过不代替真实集群验收。
