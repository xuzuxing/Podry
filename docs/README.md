# Podry 产品与实现基线

版本：V1.4 · 日期：2026-11-22 · 状态：在现有 `web/` 工程继续复刻 Devtron；Vue 3 + TDesign，当前前端使用本地 Mock。

本文档同时收录产品合同、后端计划、Devtron 参考事实，以及此前 Vue 原型的实现和验证记录。历史原型用于溯源；当前前端布局与交互以本地 Devtron 为准，范围为 Application Management + Infrastructure Management 的 K8s 资源管理。当前基线见 [复刻方案](migration/01-devtron-to-vue-plan.md)，实施和验证边界见 [布局与交互对账](migration/04-devtron-layout-interaction-parity.md)。

Podry 面向个人开发者和中小团队，提供两个核心工作区：应用 CI/CD、Kubernetes 资源查看与管理。功能与信息架构参考 Devtron Application Management 和 Resource Browser，采用 Podry 自身技术栈实现。

当前后端实施入口为 [后端开发计划](backend/01-development-plan.md)、[开发任务清单](backend/02-task-breakdown.md)、[HTTP 接口分期矩阵](backend/03-api-delivery-matrix.md) 和 [Devtron 后端源码映射与取舍](backend/04-devtron-source-mapping.md)。后端参考来自用户提供的 `D:/workspace/devtron`，固定提交并追踪关键调用。按 B0–B6 分期开发；身份、团队/项目、加密凭据、Registry、集群授权、应用配置、工作流、Git、Kubernetes 资源/日志、持久构建、发布预览/确认与历史、应用资源和实时 Diff、环境绑定/覆盖、晋级与回滚、构建取消/重试、已有镜像导入及资源变更预览/提交/操作查询以及删除/Deployment 重启/扩缩容及应用漂移及 GitHub Webhook 及发布/资源人工核对、Secret 明文和 Pod 终端共 79 个 HTTP 操作已实现。正式迁移版本 17；健康支持资源查询时观察与默认关闭的持久后台巡检，缓存仍为 60 秒，持久构建/发布/资源写入默认关闭，真实 CI/CD 执行按用户要求暂缓。当前增量见 [Secret 与终端](backend/28-sensitive-resource-access.md)、[发布人工核对](backend/26-release-reconciliation.md)、[后台健康巡检](backend/25-background-health.md) 与 [自动部署](backend/24-ci-auto-deploy.md)，前批见 [资源动作](backend/21-resource-actions.md)，前批见 [资源写入](backend/20-resource-writes.md)，前批见 [已有镜像导入](backend/18-image-artifacts.md)，前批见 [构建取消与重试](backend/17-build-actions.md)，前批见 [晋级与回滚](backend/16-release-actions.md)，前批见 [多环境绑定与覆盖](backend/15-environment-bindings.md)、 [应用资源与健康观察](backend/13-application-observation.md)、[发布执行与恢复](backend/12-release-execution.md)、[发布规划](backend/11-release-planning.md)、[Kubernetes 读取](backend/08-kubernetes-resources.md) 和 [构建执行](backend/09-build-execution.md)，B1 历史见 [后端实施记录](backend/05-implementation.md)。

已记录的交互证据来自用户测试实例的 **71 张实际截图**：前轮 27 张只读页面，新应用目录共 44 张（首次 26 张，2026-11-20 补拍 18 张构建、镜像、发布及资源页面）。此前的 [Vue 工程原型说明](prototype/02-vue-engineering.md)、[V2.1 离线原型](prototype/index.html)、[新应用实测及缺口](references/devtron-onboarding/README.md) 和 [完整流水线截图](references/devtron-onboarding/gallery.html) 保留作历史对照，不构成当前实现验收证据。主流程证据明确使用 **Build & Deploy from Source Code**，同时包含 CI 和 Deploy。V1 已保存在 [历史目录](prototype/archive-v1/README.md)。

历史 Vue 原型曾根据最新反馈本土化为中文研发交付台：桌面使用 152px 带文字导航，常驻项目/状态筛选；日常“构建发布”采用代码构建与环境发布列表，关系图保留在流水线配置页。新建应用使用居中弹窗，简单流水线编辑使用较窄抽屉。完整 Git → Build → Deploy、发布确认、资源 Review/Apply 均保留。上述中文简化方案为历史决定，已被 2026-11-22 的 Devtron 布局与交互优先原则覆盖；当前范围以 [复刻方案](migration/01-devtron-to-vue-plan.md) 为准。

进程启停与备份恢复基线见 [进程启停与备份恢复](backend/14-runtime-recovery.md)：统一停机 deadline、停止领取与在途步骤收尾、隔离 PostgreSQL 恢复演练。它补充 T24 的离线部分，真实 CI/CD、生产恢复和外部清理仍待验收。

## 阅读入口

| 分类 | 文件 | 用途 |
| --- | --- | --- |
| 产品说明 | [产品说明](product/01-product-spec.md) | 定位、术语、角色、功能范围与业务规则 |
| 产品说明 | [业务流程与状态](product/02-workflows-and-states.md) | 构建、发布、晋级、回滚、异常恢复 |
| 产品说明 | [功能点清单](product/03-function-inventory.md) | 79 个 HTTP 功能点与 14 个平台功能点的层级与实现现状 |
| 产品说明 | [功能树](product/04-function-tree.md) | 产品与平台能力的树形视图、分期标记与前后端对齐线 |
| 页面原型 | [页面与交互规格](prototype/01-page-spec.md) | 导航、页面字段、组件边界、状态覆盖 |
| 页面原型 | [Vue 3 + TDesign 工程原型](prototype/02-vue-engineering.md) | 工程入口、组件/API/Mock 分层、运行、构建与真实接口接入 |
| 页面原型 | [中文研发团队适配](prototype/04-localization.md) | 中文术语、构建发布工作台、简化创建与配置、技术标识边界 |
| 页面原型 | [可点击离线原型](prototype/index.html) | 直接打开，演示两个主工作区和核心流程 |
| 页面原型 | [视觉与原型边界](prototype/brand-spec.md) | 设计取值、模拟数据说明、原型使用方式 |
| 接口文档 | [接口约定与调用示例](api/01-api-spec.md) | 鉴权、错误码、端点、幂等、日志与终端协议 |
| 接口文档 | [OpenAPI 3.1](api/openapi.json) | 可供工具读取的 HTTP 接口合同 |
| 数据结构 | [数据模型](data/01-data-model.md) | 实体关系、字段、约束、生命周期与敏感信息 |
| 数据结构 | [PostgreSQL 设计稿](data/schema.sql) | 表、约束和索引；尚非正式迁移 |
| 技术设计 | [技术架构](architecture/01-architecture.md) | 模块职责、执行链、部署方式、恢复机制 |
| 后端开发 | [后端开发计划](backend/01-development-plan.md) | 当前源码基线、P0/P1/P2、模块职责、B0–B6、事务与恢复、投入估算 |
| 后端开发 | [开发任务清单](backend/02-task-breakdown.md) | T00–T24、增强任务、文件/函数落点、依赖和完成条件 |
| 后端开发 | [HTTP 接口分期矩阵](backend/03-api-delivery-matrix.md) | 现有 79 个操作的分期、交付阶段与可选字段边界 |
| 后端开发 | [管理与配置接口](backend/06-control-plane.md) | 管理配置、加密密钥与迁移、独立于 Kubernetes 的联调和验证 |
| 后端开发 | [Git 代码选择接口](backend/07-git-material.md) | HTTPS 分支/提交、私仓凭据、完整 SHA、分页及验证边界 |
| 后端开发 | [Kubernetes 资源读取与 Pod 日志](backend/08-kubernetes-resources.md) | 连接测试、mTLS/TLS 选项、Discovery、授权查询、Secret 脱敏与有界日志流；该批历史覆盖 48 个操作 |
| 后端开发 | [持久构建执行、产物与日志](backend/09-build-execution.md) | B4 六个接口、固定输入、Job/BuildKit、Registry digest、恢复和七天日志；当前 54 个可用操作，真实 CI 待联调 |
| 后端开发 | [本地 CI 联调与 podry-demo](backend/10-ci-local-demo.md) | Gitea/匿名 Registry、HTTP 精确放行、Go + chi + embed 示例与本地验证；远端互通待补 |
| 后端开发 | [离线发布预览与发布事务](backend/11-release-planning.md) | v5 批次记录：内置 Helm Chart、脱敏快照、确认事务、请求与执行历史 |
| 后端开发 | [持久发布执行与恢复](backend/12-release-execution.md) | 默认关闭的 Helm Worker、物理目标占用、租约 fencing、Deployment/Job 观察；真实执行待验收 |
| 后端开发 | [应用资源与健康观察](backend/13-application-observation.md) | UID/OwnerReference 归属、实时脱敏 Diff、60 秒健康观察和 setup 发布候选；v7 迁移 |
| 后端开发 | [进程启停与备份恢复](backend/14-runtime-recovery.md) | 停止领取、统一停机时限、在途步骤收尾、隔离数据库恢复演练与备份操作说明；真实 CI/CD/生产恢复待验收 |
| 后端开发 | [多环境绑定与覆盖](backend/15-environment-bindings.md) | 独立绑定、受控覆盖、add_deploy、版本/目标/权限保护；v8 迁移，真实执行待验收 |
| 后端开发 | [晋级与回滚](backend/16-release-actions.md) | 复用产物、历史 Chart/Secret/Values、新 Job 身份、来源/幂等/占用保护；v9 迁移，真实执行待验收 |
| 后端开发 | [已有镜像导入](backend/18-image-artifacts.md) | Registry 验证、镜像应用与无 CI 工作流；v11，真实拉取待验收 |
| 后端开发 | [应用克隆](backend/19-application-cloning.md) | 原子复制最新授权配置、独立镜像仓库、双向作用域检查，不复制工作流或执行状态；无新增迁移 |
| 后端开发 | [发布人工核对](backend/26-release-reconciliation.md) | 当前权限、只读 Observe、revision/lease/fencing、原子审计与幂等；不强制解锁 unknown |
| 后端开发 | [Secret 明文与 Pod 终端](backend/28-sensitive-resource-access.md) | 指定 key、独立授权、单次票据、WebSocket/SPDY 与停机回收；无新增迁移 |
| 后端开发 | [资源 Apply/动作人工核对](backend/27-resource-reconciliation.md) | 当前拥有者权限、只读逐项证据、revision/lease、pending 跳过、原子审计/幂等；不重发写入 |
| 后端开发 | [资源变更预览与提交](backend/20-resource-writes.md) | 严格文档、权限/CAS、加密预览、持久异步逐对象执行与 unknown 只读核对；v12，默认关闭写入 |
| 后端开发 | [资源删除、重启与扩缩容](backend/21-resource-actions.md) | UID/RV、HPA 与平台发布互斥、只读恢复；v13、执行默认关闭 |
| 后端开发 | [GitHub Push Webhook](backend/23-git-webhooks.md) | 验签、持久 Delivery 去重、显式用户授权与构建准入 |
| 后端开发 | [构建成功自动部署](backend/24-ci-auto-deploy.md) | 显式非生产策略、持久构建意图、版本/权限重验、发布去重与恢复 |
| 后端开发 | [后台持续健康巡检](backend/25-background-health.md) | 当前发布请求者权限、持久租约、失败失效、迟到结果保护与统一停机；默认关闭 |
| 后端开发 | [应用人工修改与漂移](backend/22-application-drift.md) | 当前成功发布基线、只读刷新、脱敏摘要/有限历史；v14、不自动修复 |
| 后端开发 | [构建取消与重试](backend/17-build-actions.md) | 持久取消、退出核对、固定输入与新 Attempt 身份；v10，真实执行待验收 |
| 后端开发 | [Devtron 后端源码映射与取舍](backend/04-devtron-source-mapping.md) | 本地参考提交、30 组源码入口、CI/CD/资源/恢复链路与 SC01–SC06 任务补充 |
| 开发验收 | [开发与验收计划](delivery/01-plan-and-acceptance.md) | 原 M0–M5 全量路线和用例；后端实施顺序以 B0–B6 为准 |
| 迁移方案 | [Devtron Dashboard → Podry Web 轻量化迁移方案](migration/01-devtron-to-vue-plan.md) | 首版 P0/P1/P2 范围、菜单、路由、组件边界、数据流与验收标准 |
| 迁移方案 | [参考项目清单与逐模块对照](migration/02-devtron-inventory.md) | Devtron 路由/页面/服务/协议事实，以及首版取舍映射 |
| 迁移对账 | [Devtron 迁移逐项对账清单](migration/03-devtron-parity-checklist.md) | 按页面/组件逐条列出功能点与现状（✅/🚧/❌）及清理批次 |
| 参考资料 | [参考范围与差异](references/01-devtron-mapping.md) | Devtron 对照、源码基线、范围取舍 |
| 参考资料 | [真实实例观察记录](references/devtron-live/README.md) | 现场操作路径、27 张截图与未执行边界 |
| 参考资料 | [截图画廊](references/devtron-live/gallery.html) | 应用 CI/CD、资源浏览器真实页面对照 |
| 参考资料 | [新应用实测与缺口补齐](references/devtron-onboarding/README.md) | 远程创建结果、完整模板、网络阻塞、原型补齐矩阵 |
| 参考资料 | [新应用截图画廊](references/devtron-onboarding/gallery.html) | 44 张真实截图，补齐构建产物、选镜像、发布成功和 Job/Pod 资源 |
| 检查工具 | [文档一致性检查](tools/check-docs.mjs) | 链接、OpenAPI 引用、操作 ID、SQL 表映射检查 |
| 检查工具 | [原型浏览器检查](tools/check-prototype.mjs) | 使用本机 Chrome 验证实际点击流程及截图 |
| 检查结果 | [验证记录](delivery/02-validation.md) | 本次实际执行结果与尚未验证的边界 |
| 检查结果 | [Vue 工程原型验证](delivery/03-vue-validation.md) | 27 项原生 Vue 浏览器检查、独立构建和生产构建边界 |


## 当前仓库与设计目标

- 本次检查的代码基线为 `fd8d50b`，工作区存在用户未提交的前端改动。
- 当前后端为 Go/chi + PostgreSQL/pgx/sqlc，已交付管理配置、工作流、Kubernetes 读取、持久构建、离线发布规划及默认关闭的持久 Helm 发布/恢复逻辑；真实 CI/CD 执行仍待联调验收，前端迁移状态以对应迁移文档和当前工程为准。
- 现有 `/api/apps` Mock 仅表示演示接口，不代表真实应用、权限、CI 或 Kubernetes 后端。
- 本设计沿用 chi，数据库计划采用 PostgreSQL + pgx + sqlc；CI 使用 Kubernetes Job + BuildKit；CD 使用 Helm SDK 与版本化内置 Chart。
- 2026-11-19 的文档及 HTML 原型交付限定在 `docs/`；2026-11-20 按用户要求增加 `web/prototype.html` 工程入口及 Vue 组件，复用现有依赖与请求客户端，保留原首页和登录入口。

## 核心约定

1. 团队 → 项目 → 应用；应用是独立构建、独立部署的单元，未来若恢复 Component 命名，应复用该实体。
2. 环境是平台级逻辑资源；目标绑定描述环境、集群、Namespace 和 Helm releaseName。
3. 构建产物由镜像 digest 标识，环境晋级复用产物。
4. 应用配置草稿、不可变发布快照、集群实时状态分别管理。
5. 同一物理 Helm 目标串行发布；未知结果必须核对，不自动释放占用并重复提交。
6. 两个主工作区共享资源详情、YAML、事件、日志、终端以及授权逻辑。
7. 接口使用 `/api`、camelCase JSON、字符串 UUID、RFC3339 UTC 时间；错误沿用 `{ error: { code, message } }`。
8. 本地原型中的数据和操作均为模拟；真实验收需要另行提供后端、集群和镜像仓库证据。

## 本地使用

工程原型在 `web/` 运行 `npm run dev:prototype`。独立交付运行 `npm run build:prototype`，产物在 `web/dist-prototype/`，再运行 `npm run preview:prototype`。它是原生 Vue 组件与 TDesign 控件，通过 axios + MSW 访问本地模拟 API；需要 HTTP 服务，不支持双击 HTML。普通 `npm run build` 只构建原有产品入口。详细目录和迁移边界见[工程说明](prototype/02-vue-engineering.md)。

无需 Node 环境时，仍可直接打开旧 `prototype/index.html`。两个版本共用已确认的交互方向，但自动化证据分别记录。新应用依次保存 Git → Build → Base，再从 New Workflow 选择 **Build & Deploy from Source Code**，一次创建 CI 和目标环境的 Deploy。首次 Git 表单内嵌，其他创建与执行使用右侧大抽屉；历史使用左记录右详情；应用内和集群内资源都使用可保留的资源页签。完整样例操作见[实测记录](references/devtron-onboarding/README.md)。

原型支持分步引导、完整工作流模板、Deployment/Job、模拟构建、部署确认、晋级、回滚、受控 YAML 修改、日志与模拟终端。Demo 面板可以切换只读、异常数据、任务结果和日志保存方式。所有业务数据和写入仅在本地内存，真实截图不代表 Podry 已接入测试实例。远程测试应用在 2026-11-19 曾因 Git 查询超时阻塞；2026-11-20 只读重访已观察到完整流水线构建、部署均成功，应用 Job 健康、2 个 Pod 已完成，详见 [补拍记录](references/devtron-onboarding/README.md)。本次补拍没有触发远程构建或部署。

文档静态检查：

```powershell
node docs/tools/check-docs.mjs
```

浏览器检查（需要本机安装 Chrome，可用 `PODRY_CHROME` 指定路径）：

```powershell
node docs/tools/check-prototype.mjs
```

OpenAPI 的设计源为 [build-openapi.mjs](tools/build-openapi.mjs)，修改后运行 `node docs/tools/build-openapi.mjs` 重新生成合同。不要将原型检查结果解释为真实 CI/CD 或 Kubernetes 验收。
