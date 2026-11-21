# Podry Web（Vue 3 + TDesign）

静态实现阶段：所有页面可点击、数据来自本地 mock，不连接真实后端与集群。

## 当前进度（2026-11-22）

- 24 个页面路由（33 个页面/状态）全部可访问，`check-pages` 无运行时错误。
- 应用工作区、集群资源、全局设置、操作记录、登录已完成 Devtron 对齐与中文化。
- 本次提交：`web/` 下 29 个修改文件 + 5 个新增文件；后端联调尚未开始。
- 验证：`vue-tsc` 0 错误、`npm run build` 通过、`check-pipeline` 通过、`check-pages` 通过。
页面范围见 [功能树](../docs/product/04-function-tree.md)，接口语义见 [接口约定](../docs/api/01-api-spec.md) 与 [OpenAPI](../docs/api/openapi.json)。

## 运行

```bash
npm install        # 依赖已在仓库 node_modules，可跳过
npm run dev        # http://localhost:5173
npm run build      # 类型检查 + 产出 dist/（go:embed 使用）
npm run preview    # 预览 dist
npm run check:pages -- http://localhost:4173   # Chrome 逐路由截图 + 运行时错误检查
```

演示账号：`admin@acme.dev`，密码任意（mock 校验，登录态存 localStorage `podry:session`）。

## 页面清单（24 个路由）

| 菜单 | 路由 | 页面文件 |
| --- | --- | --- |
| 工作台 / 项目 | `/` | `views/ProjectListView.vue` |
| 项目详情 | `/projects/:projectId` | `views/ProjectDetailView.vue` |
| 工作台 / 应用 | `/apps` | `views/AppListView.vue` |
| 应用 / 概览 | `/projects/:projectId/apps/:appId/overview` | `views/apps/AppOverviewView.vue` |
| 应用 / 构建发布 | `…/trigger` | `views/apps/BuildDeployView.vue` |
| 应用 / 构建历史 | `…/builds` | `views/apps/BuildHistoryView.vue` |
| 应用 / 发布历史 | `…/deployments` | `views/apps/DeploymentHistoryView.vue` |
| 应用 / 发布指标 | `…/metrics` | `views/apps/DeploymentMetricsView.vue`（部署频率、变更前置时间、变更失败率、MTTR、每日发布与按环境统计） |
| 应用 / 配置 | `…/config/{git,build,workflow}`、`…/config/base/{deployment-template,configmaps,secrets}`、`…/config/overrides/:envId/{deployment-template,configmaps,secrets}` | `views/apps/config/*.vue`（左侧导航对齐 Devtron Configurations：Git 仓库 / 构建配置 / 基础配置 / 工作流编辑器 + 环境覆盖 + 删除应用；基础配置与环境覆盖共用 部署模板 / ConfigMaps / Secrets 三个分区） |
| 应用 / 运行资源 | `…/resources?env=<bindingId>&view=analyzer&tab=<页签id>` | `views/apps/AppResourcesView.vue`（页签：K8s 资源 / 日志分析 / 点开的资源页签；资源按 Deployment → ReplicaSet → Pod → Containers 分层展示，`components/resource/ResourceHierarchy.vue`） |
| 集群资源 | `/clusters` | `views/clusters/ClusterListView.vue` |
| 集群工作区 | `/clusters/:clusterId` | `views/clusters/ClusterWorkspaceView.vue`（页签：概览 / 当前资源类型（Node、Event、Namespace、Deployment…，随左侧选择改名）/ 点击资源打开的资源页签；左侧列表顶部固定 Nodes、Events、Namespaces，下面按分类分组；`?resource=`、`?tab=`、`?open=` 可深链，兼容旧 `?view=`） |
| 节点详情 | `/clusters/:clusterId/node/detail/:nodeName/:tab` | `views/clusters/NodeDetailView.vue`（Summary / YAML / Node Conditions；节点列表点击进入，不是工作区页签） |
| 资源详情（公共组件） | 集群工作区页签 / 应用运行详情页签 | `components/resource/ResourceDetailPanel.vue`（Manifest / 事件 / 日志 / 终端，日志与终端仅 Pod；重启与扩缩容仅工作负载；隐藏托管字段、编辑实时 Manifest、Secret 查看明文） |
| 集群终端 | `/clusters/:clusterId/terminal` | `views/clusters/ClusterTerminalView.vue`（mock 会话 EX-02/EX-03，支持 kubectl get pods/nodes/namespaces/deployments） |
| 旧资源深链 | `/clusters/:clusterId/resources/:group/:resource/:namespace/:name/:tab` | 重定向到集群工作区并打开对应资源页签 |
| 操作记录 | `/audit` | `views/audit/AuditView.vue` |
| 全局设置 | `/settings/{members,clusters,environments,credentials,registries}` | `views/settings/*.vue` |
| 登录 | `/login` | `views/LoginView.vue` |

外层壳：`layouts/AppShell.vue`（48px 顶栏 + 190px 侧栏 + 路由菜单）；应用页签：`views/apps/AppWorkspaceLayout.vue`；配置聚焦导航：`views/apps/config/ConfigLayout.vue`；设置导航：`views/settings/SettingsLayout.vue`。

## 目录约定

```text
src/
├── api/index.ts          # mock API 门面：与 OpenAPI 同形的入参/出参 + MockError
├── mock/data.ts          # 固定数据集（2 团队 / 3 项目 / 6 应用 / 2 集群 / 14 类资源…）
├── types/index.ts        # DTO（对齐 openapi.json 的子集）
├── utils/format.ts       # 状态字典（health/build/deploy/log/connection/setup/role/audit）与时间格式
├── components/           # PageHeader / StatusTag / EmptyState / ErrorState / FilterBar / K8sKindTree（TDesign Tree）
├── layouts/AppShell.vue  # 全局壳
├── router/{index,routes,menu}.ts
├── stores/{session,ui}.ts
├── styles/base.less      # 设计令牌 + TDesign 收敛（直角、12px）+ 通用类
└── views/                # 页面（见上表）
```

## 接真实后端要改什么
1. `src/api/index.ts` 是本阶段唯一的“数据出口”。把每个函数体换成 `request.get/post`（沿用 `docs/architecture` 约定的 `/api` 前缀与 `{ error: { code, message } }`），页面无需改动。
2. `MockError` 换成现有的 `ApiError`（`code/status` 字段同名，页面里的错误分支可直接复用）。
3. `vite.config.ts` 的 `/api` 代理指向真实服务（默认 `http://127.0.0.1:5000`）。
4. 已接 mock 写接口（替换为真实调用即可）：环境覆盖保存、Manifest Dry run / Apply、创建资源、发布未知结果核对、导入外部镜像、集群接入、连接测试、凭据创建/轮换、镜像仓库新增/编辑、Secret 明文读取、终端会话创建/关闭、发布指标序列、灰度发布推进、创建应用/归档应用、创建项目、创建/编辑环境。

## 视觉与交互约定

- 布局对齐 docs/references/devtron-live/ 的 27 张真实截图：64px 图标轨道侧栏、顶部面包屑 + 应用页签、工作流图（Source → CI → 多 CD）、App Details 的环境条与两张状态卡、K8s Resources 页签、分类树 + 表格。
- 构建发布页按真实 Devtron Build & Deploy 复刻（`components/pipeline/TriggerGraph.vue`）：1280 固定画布、来源卡 200×64、CI/CD 节点 200×126、左侧 16px `MANUAL`/`AUTO` 触发条、2px 连线 + 实心箭头、一 CI 多 CD 的竖向主干分叉；工作流与 CI 显示名 `wf-<n>-<4位>` / `ci-<n>-<4位>` 由 `components/pipeline/naming.ts` 统一生成，配置页与画布同名。
- App 工作区逐页对齐 Devtron 并做中文落地：Overview 左档案 + 关于/环境（环境 / 最近部署 / 提交 / 部署时间）、App Details 三张状态卡（应用状态 / 部署状态 / 已部署提交）+ K8s 资源、Build History（选择流水线 + 时间线 + 日志/源码/产物）、Deployment History（选择环境 + 时间线 + 源码/配置）。
- Configurations 对齐 Devtron：基础配置 / 环境覆盖都拆成 部署模板、ConfigMaps、Secrets 三个分区；部署模板有 配置/继承/不覆盖/试运行 页签、GUI|YAML、带行号的 YAML 编辑器与 保存修改。工作流编辑器与 构建发布 共用 `TriggerGraph`（`editable` 模式：点击节点编辑，节点右侧 + / 删除增删流水线），不再使用旧的关系图 + 流水线表格。ConfigMap/Secret 是按 Devtron 结构补充的 mock 扩展（`types/index.ts` 的 `ConfigMapEntry` / `SecretEntry`，`api/index.ts` 的 list/save/delete），Backend 合同尚未定义，接真实后端时需要新增对应接口；Secret 只保存 key，不保存明文。
- 发布指标对齐 Devtron app tab：四张指标卡（部署频率 / 变更前置时间 / 变更失败率 / 平均恢复时间）、每日发布柱状图与按环境统计表；指标由现有发布与构建记录计算，可按环境和近 7/30/90 天筛选，不新增接口。
- 应用列表「导出 CSV」已实现：按当前筛选导出应用名/环境/集群/命名空间/最近发布，带 BOM 便于 Excel 打开。
- Pod 日志「下载」已实现：导出当前容器日志为 `.log` 文件；无日志时提示。
- 环境覆盖左侧「< 环境」支持下拉切换其他环境；部署模板底部提示「应用指标未在基础配置中启用」（对齐 Devtron）。
- 资源扩缩容/重启确认补影响说明：HPA 覆盖提示、滚动重启可用性说明，与删除确认共用资源摘要。
- 应用列表无数据时显示「还没有应用」空态与创建入口；筛选无结果显示「没有匹配的应用」。
- 流水线编辑抽屉底部增加「删除流水线」：二次确认后删除；存在依赖 CD 的 CI 会提示先删除下游。
- 集群资源页命名空间筛选改为 Devtron 的紧凑 pill 下拉（全部命名空间 / 具体 Namespace）。
- 删除应用确认对齐破坏性操作规范：不可撤销告警、输入应用名称二次确认、失败时拒绝归档。
- 应用头部应用名改为 Devtron 应用切换器：下拉列出同项目应用，切换后回到概览。
- 项目详情应用表对齐 Devtron 应用列表：应用名称 / 环境 / 集群 / 命名空间 / 最近发布 + 配置入口，环境与集群来自环境绑定。
- 资源删除确认补资源类型与 `namespace/name` 摘要、不可恢复告警，保留输入名称二次确认。
- 环境覆盖的「对比环境...」接入只读对比弹窗：选择基准/对比环境，合并基础配置与环境覆盖后逐参数展示，差异行高亮，不修改任何配置。
- 集群资源页对齐 Devtron Resource Browser：健康 / 生产环境两张占比卡、搜索与状态筛选、最近刷新与刷新、接入集群，表格列为集群 / 状态 / 类型 / 节点 / 节点错误 / K8s 版本 / CPU 容量 / 内存容量。
- 应用列表工具栏补「最近刷新」提示，与集群页一致。
- 构建发布页顶部新增摘要条：最近构建（状态 / commit / 时间）、最近发布（状态 / 环境 / 时间）、配置版本。
- 工作流画布标题右侧显示触发方式速览（构建手动/自动、部署条数与自动/手动分布），节点触发条带悬停说明。
- 全局设置的表单统一为右侧抽屉：创建/编辑环境、接入集群、新建/轮换凭据、邀请/移除成员、添加/编辑镜像仓库；抽屉 480/520/560px，表单滚动、底部固定操作。
- 全局设置列表统一加搜索与计数：集群按名称/API Server、环境按名称/类型、凭据按名称/类型、镜像仓库按名称/Endpoint；筛选无结果与无数据分别显示空态。
- 全局设置（原平台设置）布局对齐 Devtron Global Configuration：252px 分组导航（访问控制 / 基础设施 / 凭据与仓库）、全高白底、18px 页面标题、浅色表头、表格统一为带边框卡片；环境编辑、成员、集群、凭据、镜像仓库共用同一壳层。
- 基础环境支持编辑：名称、生产标记、自动发布开关；生产环境保存后自动关闭自动发布（mock 实现）。
- 顶栏「帮助」改为 Devtron 风格菜单：帮助文档、键盘快捷键、关于 Podry（静态提示）。
- 页面标题统一为中文：Git 仓库 / 部署模板 / 工作流编辑器（原 Git 源、Deployment Template、工作流）。
- 应用列表的「创建」改为 Devtron 风格 Create 菜单：自定义应用（打开新建抽屉）、从 Chart Store 创建 / Job（暂未接入提示，与未实现清单一致）。
- 工作流节点编辑改为 1024px Devtron 抽屉：前置 / 构建（部署）/ 后置阶段页签、左侧触发方式（自动 Push / 手动、CI 成功后 / 手动）、流水线名称、代码源与分支、只读的镜像与 Dockerfile 覆盖信息、底部更新流水线。
- 部署模板 GUI 按 Devtron 分组：工作负载（类型 / 副本 / Job 参数）、容器（端口 / host / 环境变量增删），环境变量与 YAML 双向同步（GUI 编辑写入 `env:`，YAML 解析回填表格）。
- 集群「创建 Kubernetes 资源」抽屉对齐 Devtron：1020px、多文档提示、带行号 YAML 编辑器、底部取消 / Dry run / 应用。
- 工作流编辑器空态对齐 Devtron：来源 → CI → CD 的流程示意、工作流说明、学习链接与「新建工作流」；创建工作流改为 860px 模板弹窗，按「构建容器镜像 / 接收容器镜像」分组展示模板卡片（源码构建并部署、仅源码构建、部署外部镜像），选中后在同一弹窗配置分支、环境与 releaseName。
- 新建应用对齐 Devtron 引导：应用列表 / 项目详情打开 1020px「新建应用」抽屉，可在「从零创建 / 克隆应用」间切换；克隆会复制源应用最新配置（版本 1）并生成新的镜像仓库路径，不复制流水线、环境绑定与执行历史。创建后进入配置向导；配置主页显示「已完成 N/4」（镜像应用 N/2）与下一步提示。Git 仓库页改为 Devtron 的「添加 Git 仓库」卡片 + 仓库卡片 + 底部「下一步」，构建配置改为「存储容器镜像 / 如何构建容器镜像」两张卡片 + 底部「保存并下一步」；保存后通过 `utils/appEvents.ts` 即时刷新进度。`api/index.ts` 的 `createApplication` 会同步初始化 setup，`saveConfig` / `saveWorkflow` 按当前配置重算，供概览与配置页共用。
- Select Material / Select Image 为 1024px 右侧全高弹窗（49px 标题栏 + 74px 操作栏），分别对应 `Build Pipeline '<ci>'` 与 `Deploy to <env>`，与 Devtron 的抽屉尺寸、底栏按钮和提交/镜像卡片一致。
- 直角体系：`--tk-radius: 2px`；正文 12px / 行高 18px；页底 `#f2f4f8`；主色 `#0052d9`；无阴影。
- 顶栏 48px、侧栏 190px（`≤1120px` 折叠为 64px）、页签栏 36px。
- 状态色只在 `utils/format.ts` 定义，页面用 `StatusTag` 渲染，禁止各页自写 `statusMap`。
- 中文文案；Kind、字段名、YAML、镜像地址等技术标识保留原值。

## 未实现清单（规划，先不做）

> 这些入口在界面上保留，点击提示「暂未接入接口」。等后端 / 后续迭代补齐，不在当前 mock 范围内。

| 项 | 说明 | 状态 |
| --- | --- | --- |
| **Chart Store / 应用模板** | 模板列表、模板详情（values.yaml）、用模板创建应用 | ⏸ 先不做，后续补充 |
| 成本 / 跨应用趋势报表 | 依赖成本数据源与多应用聚合 | ⏸ 未实现 |

> 以下原占位已实现为 mock：应用描述 / 所属项目 / 标签 / Readme 编辑、环境对比、健康明细、日志分析器、复制页面链接、刷新、新建项目、新建环境、集群连接测试。

## 已知边界

- 环境编辑（名称 / 生产标记 / 自动发布）已提供 mock 实现（`updateEnvironment`），Backend `PATCH /environments/{id}` 合同尚未定义，接真实后端时需补齐。

- 数据量小（6 个应用、每类资源 3–5 条），未做虚拟滚动与游标分页；接入真实集群时资源列表需要改为 `continueToken` 分页。
- 日志为静态文本，未实现 NDJSON 流与断线重连；终端会话为 mock（EX-02 / EX-03），真实实现需要一次性 ticket + WebSocket 通道。
- Manifest 支持编辑 → Dry run → 行级 Diff → Apply（写入本地 mock）；真实实现需要替换为服务端 dry-run 与 server-side apply。
- Secret 明文字段为 mock 值，读取会写一条 `secret.reveal` 审计；真实实现需独立授权与主密钥托管。
- 发布指标为确定性 mock 序列（24 个点），接入后来源是 metrics-server / Prometheus。
- 发布策略支持滚动 / 灰度（放量档位与逐档推进）/ 蓝绿（切流说明），灰度推进为 mock；真实实现需要 release 控制器配合。
- 日志支持容器切换、时间窗口与自动滚动（mock 过滤），未实现 NDJSON 流与断线重连。
- 写操作均已走本地 mock（环境覆盖、资源、平台设置、Secret/终端/指标），替换为真实 HTTP 时只需改 `src/api/index.ts`。
- `go:embed` 依赖 `web/dist`，`npm run build` 后才能 `go build`；`dist` 不入库。
