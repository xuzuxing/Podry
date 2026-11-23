# Podry Web（Vue 3 + TDesign）

静态实现阶段：所有页面可点击、数据来自本地 mock，不连接真实后端与集群。

## 当前进度（2026-11-23）

按本地 Devtron 复刻两个 Manager 导航、单页头、应用筛选与资源工作区；补齐资源动作、流水线阶段任务、多 CI 关系及构建日志下载/镜像标签备注。

第二轮补齐 Git 多仓库的新增/展开编辑/过滤规则/克隆目录/子模块/删除确认、三种构建方式及高级参数、按 CI 切换构建历史和触发后的定位。配置页灰色底板、居中表单、侧栏与底部保存栏同步对齐。接口接入按用户要求暂缓。

第三轮对齐部署模板的只读继承、独立覆盖、无覆盖空态、创建/删除覆盖、Patch/Replace 本地合并预览、取消恢复与离开提示。YAML 改用完整解析并保留原文与自定义字段；GUI 定点更新，长 YAML 内部滚动且行号同步。基础配置统一为“保存修改”，环境对比及发布相关当前值表共用合并规则。

第四轮补齐 ConfigMap/Secret 逐条继承与覆盖、挂载表单、配置对比、发布配置快照和 Markdown Notes；完整 Helm 渲染仍待补齐。

第五轮补齐流水线逐仓库固定/正则分支、可编辑构建覆盖、多仓库独立提交选择和全选齐校验。新构建记录逐仓库源码与有效构建配置快照，重试沿用原始配置，构建/发布历史不再用应用当前仓库信息冒充历史；缺失快照明确展示。所有行为仍为前端 Mock。

当前仍为本地 Mock，尚未达到 Devtron 全部细节的完全等价。源码映射、剩余差异和验证证据见 [布局与交互对账](../docs/migration/04-devtron-layout-interaction-parity.md)。

第六轮补齐前后置任务的内嵌目录、示例插件与版本参数、四种类型的输入输出变量、全局/前序输出引用、Trigger/Skip/Pass/Fail 条件表单。任务列表与详情独立滚动，排序/删除/移动后校验依赖；流水线增加关闭、路由与刷新事件的草稿保护。完整远程插件目录、File/运行时变量及真实执行仍待补齐。

第七轮补齐容器命令/参数、可选脚本挂载、源码/主机目录挂载、端口映射与多条产物路径；部署流水线前后置阶段独立选择目标环境 ConfigMap/Secret，支持搜索、移除与失效引用校验。保存回读、取消草稿和 1280px 布局已做浏览器验证。

第八轮补齐 CD 前后置独立自动/手动触发，以及在应用环境执行任务的开关。根据目标绑定的显式 Mock worker 能力展示可用/禁用与提示；旧记录中不可用的已选执行环境提供关闭修复入口，不能直接保存。设置进入保存回读和完整草稿保护。验证命令为 `node scripts/check-deployment-stages.mjs` 与 `node scripts/check-deployment-stage-parity.mjs http://127.0.0.1:5182`。

第九轮补齐 CD 独立前后置节点、阶段镜像选择与运行历史。可从预发布环境的示例阶段直接进入，查看逐任务日志、历史源码与配置快照，取消或沿用旧快照重试；环境/流水线/阶段/运行选择保存在 URL 中。状态为本地时间推进的 Mock，不自动触发部署或相邻阶段，Artifacts 仅展示未生成文件与声明路径。验证命令为 `node scripts/check-stage-runs.mjs` 和 `node scripts/check-stage-run-parity.mjs http://127.0.0.1:5182`。日志工具在第十一轮继续补齐；真实执行、任务产物和远程插件目录仍待补齐。

第十轮将环境对比改为独立工作区：支持两侧环境与当前保存/当前部署/历史发布版本选择、URL 恢复、文件搜索/排序/变更过滤、GUI/并排 YAML。发布配置页可打开版本对比并返回原记录，缺失快照不回填当前值；草稿离开保护和 1280px 内部滚动保留。验证命令为 `node scripts/check-config-comparison.mjs` 与 `node scripts/check-config-comparison-parity.mjs http://127.0.0.1:5182`。受保护草稿/审批发布版本、默认 Chart 历史和 Manifest 对比仍待补齐。

第十一轮为构建和 CD 前后置任务接入共用日志工作区：搜索/逐处高亮、匹配计数和 Enter/Shift+Enter 跳转、折叠、换行、暂停/恢复跟随、顶部/底部跳转、展开/Escape 还原及完整原文下载。页签/阶段任务保存在 URL 中，切换记录丢弃旧请求，轮询保留搜索；构建日志镜像/digest 与 Job 使用本次历史元数据。新增 `node scripts/check-history-logs.mjs`（30 项）与 `node scripts/check-history-log-parity.mjs http://127.0.0.1:5182`（43 项）；同轮生产构建另通过 41 项阶段历史、30 项配置历史、38 项关键交互与 46 个路由/状态检查。仍无真实日志流/归档、ANSI/多节虚拟列表或任务产物 ZIP，Mock 新记录整页刷新会重置。

页面范围见 [功能树](../docs/product/04-function-tree.md)，接口语义见 [接口约定](../docs/api/01-api-spec.md) 与 [OpenAPI](../docs/api/openapi.json)。

## 运行

```bash
npm install        # 依赖已在仓库 node_modules，可跳过
npm run dev        # http://localhost:5173
npm run build      # 类型检查 + 产出 dist/（go:embed 使用）
npm run preview    # 预览 dist
npm run check:pages -- http://localhost:4173   # Chrome 逐路由截图 + 运行时错误检查
node scripts/check-devtron-parity.mjs http://localhost:4173  # 关键交互回归
node scripts/check-configuration-parity.mjs http://localhost:4173 # 配置/多 CI 历史交互回归
node scripts/check-deployment-template-parity.mjs http://localhost:4173 # 部署模板/环境覆盖交互回归
node scripts/check-pipeline-material-parity.mjs http://localhost:4173 # 多仓库/流水线覆盖/源码历史交互
node scripts/check-build-materials.mjs # 本地 Mock 提交范围、配置冲突和快照隔离
node scripts/check-pipeline-task-parity.mjs http://localhost:4173 # 任务/变量/条件/草稿浏览器交互
node scripts/check-pipeline-tasks.mjs # 本地 Mock 任务依赖与插件参数校验
node scripts/check-task-execution-parity.mjs http://localhost:4173 # 容器高级表单/CD 阶段配置引用
node scripts/check-task-execution.mjs # 本地 Mock 容器配置/阶段引用作用域与校验
```

演示账号：`admin@acme.dev`，密码任意（mock 校验，登录态存 localStorage `podry:session`）。

## 页面清单（26 个路由）

| 菜单 | 路由 | 页面文件 |
| --- | --- | --- |
| Application Management / 项目 | `/projects` | `views/ProjectListView.vue` |
| 项目详情 | `/projects/:projectId` | `views/ProjectDetailView.vue` |
| 应用管理 / 概览 | `/apps/overview` | `views/overview/AppModuleOverviewView.vue` |
| 工作台 / 应用 | `/apps` | `views/AppListView.vue` |
| 应用 / 概览 | `/projects/:projectId/apps/:appId/overview` | `views/apps/AppOverviewView.vue` |
| 应用 / 构建发布 | `…/trigger` | `views/apps/BuildDeployView.vue` |
| 应用 / 构建历史 | `…/builds?pipeline=<CI>&build=<记录>&tab=logs或source或artifacts` | `views/apps/BuildHistoryView.vue`、`components/application/history/HistoryLogViewer.vue` |
| 应用 / 发布历史 | `…/deployments`；阶段 `?type=PRECD或POSTCD&env=<环境>&pipeline=<CD>&run=<记录>&tab=<页签>&task=<任务>` | `views/apps/DeploymentActivityView.vue`、`DeploymentHistoryView.vue`、`components/application/StageRunHistory.vue` |
| 应用 / 发布指标 | `…/metrics` | `views/apps/DeploymentMetricsView.vue`（部署频率、变更前置时间、变更失败率、MTTR、每日发布与按环境统计） |
| 应用 / 配置 | `…/config/{git,build,workflow}`、`…/config/base/{deployment-template,configmaps,secrets}`、`…/config/overrides/:envId/{deployment-template,configmaps,secrets}` | `views/apps/config/*.vue`（左侧导航对齐 Devtron Configurations：Git 仓库 / 构建配置 / 基础配置 / 工作流编辑器 + 环境覆盖 + 删除应用；基础配置与环境覆盖共用 部署模板 / ConfigMaps / Secrets 三个分区） |
| 应用 / 运行资源 | `…/resources?env=<bindingId>&view=analyzer&tab=<页签id>` | `views/apps/AppResourcesView.vue`（页签：K8s 资源 / 日志分析 / 点开的资源页签；资源按 Deployment → ReplicaSet → Pod → Containers 分层展示，`components/resource/ResourceHierarchy.vue`） |
| 基础设施管理 / 概览 | `/clusters/overview` | `views/overview/InfraModuleOverviewView.vue` |
| 集群资源 | `/clusters` | `views/clusters/ClusterListView.vue` |
| 集群工作区 | `/clusters/:clusterId` | `views/clusters/ClusterWorkspaceView.vue`（页签：概览 / 当前资源类型（Node、Event、Namespace、Deployment…，随左侧选择改名）/ 点击资源打开的资源页签；左侧列表顶部固定 Nodes、Events、Namespaces，下面按分类分组；`?resource=`、`?tab=`、`?open=` 可深链，兼容旧 `?view=`） |
| 节点详情 | `/clusters/:clusterId/node/detail/:nodeName/:tab` | `views/clusters/NodeDetailView.vue`（Summary / YAML / Node Conditions；节点列表点击进入，不是工作区页签） |
| 资源详情（公共组件） | 集群工作区页签 / 应用运行详情页签 | `components/resource/ResourceDetailPanel.vue`（Manifest / 事件 / 日志 / 终端，日志与终端仅 Pod；重启与扩缩容仅工作负载；隐藏托管字段、编辑实时 Manifest、Secret 查看明文） |
| 集群终端 | `/clusters/:clusterId/terminal` | `views/clusters/ClusterTerminalView.vue`（mock 会话 EX-02/EX-03，支持 kubectl get pods/nodes/namespaces/deployments） |
| 旧资源深链 | `/clusters/:clusterId/resources/:group/:resource/:namespace/:name/:tab` | 重定向到集群工作区并打开对应资源页签 |
| 操作记录 | `/audit` | `views/audit/AuditView.vue` |
| 全局设置 | `/settings/{members,clusters,environments,credentials,registries}` | `views/settings/*.vue` |
| 登录 | `/login` | `views/LoginView.vue` |

外层壳：`layouts/AppShell.vue`（48px 顶栏 + 64px Manager 图标轨道 + 224px 悬停子菜单）；应用页签：`views/apps/AppWorkspaceLayout.vue`；配置聚焦导航：`views/apps/config/ConfigLayout.vue`；设置导航：`views/settings/SettingsLayout.vue`。

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
- 基础/环境覆盖的「对比环境...」进入独立只读对比路由，支持两侧环境、当前保存值和历史快照、文件导航及差异高亮；不修改任何配置。
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
- 集群「创建 Kubernetes 资源」抽屉第三十三轮按参考修正：1024px、空白原生 YAML 编辑器、多文档提示、底部取消 / 应用；应用后保留逐项结果，支持返回编辑或关闭刷新列表。
- 工作流编辑器空态对齐 Devtron：来源 → CI → CD 的流程示意、工作流说明、学习链接与「新建工作流」；创建工作流改为 860px 模板弹窗，按「构建容器镜像 / 接收容器镜像」分组展示模板卡片（源码构建并部署、仅源码构建、部署外部镜像），选中后在同一弹窗配置分支、环境与 releaseName。
- 新建应用对齐 Devtron 引导：应用列表 / 项目详情打开 1024px「新建应用」抽屉，250px 方法栏，可在「从零创建 / 克隆应用」间切换；克隆先通过卡片搜索/选择来源，再填写新应用信息，可返回并保留草稿。克隆会复制源应用最新配置（版本 1）并生成新的镜像仓库路径，不复制流水线、环境绑定、ConfigMap/Secret 与执行历史。创建后进入配置向导；配置未完成时显示「已完成 N/4」（镜像应用 N/2）与下一步提示，全部完成后隐藏进度卡。Git 仓库页按每个仓库独立保存，构建配置底部改用「保存配置」，不再使用旧版的下一步按钮；保存后通过 `utils/appEvents.ts` 即时刷新进度。`api/index.ts` 的 `createApplication` 会同步初始化 setup，`saveConfig` / `saveWorkflow` 按当前配置重算，供概览与配置页共用。
- Select Material / Select Image 为 1024px 右侧全高弹窗（49px 标题栏 + 74px 操作栏），分别对应 `Build Pipeline '<ci>'` 与 `Deploy to <env>`，与 Devtron 的抽屉尺寸、底栏按钮和提交/镜像卡片一致。
- 直角体系：`--tk-radius: 2px`；正文 12px / 行高 18px；页底 `#f2f4f8`；主色 `#0052d9`；无阴影。
- 顶栏 48px、Manager 轨道 64px，子菜单在悬停/聚焦时展开；`/` 跳转应用列表。
- 状态色只在 `utils/format.ts` 定义，页面用 `StatusTag` 渲染，禁止各页自写 `statusMap`。
- 中文文案；Kind、字段名、YAML、镜像地址等技术标识保留原值。

## 未实现清单（规划，先不做）

> 这些入口在界面上保留，点击提示「暂未接入接口」。等后端 / 后续迭代补齐，不在当前 mock 范围内。

| 项 | 说明 | 状态 |
| --- | --- | --- |
| **Chart Store / 应用模板** | 模板列表、模板详情（values.yaml）、用模板创建应用 | ⏸ 先不做，后续补充 |
| 成本 / 跨应用趋势报表 | 依赖成本数据源与多应用聚合 | ⏸ 未实现 |

> 以下原占位已实现为 mock：应用描述 / 所属项目 / 标签 / Readme 编辑、环境对比、健康明细、日志分析器、复制页面链接、刷新、新建项目、新建环境、集群连接测试。

## 第十二轮：配置数据编辑

ConfigMap / Secret 数据表支持直接编辑键名、按键排序、新增/删除、空键/重复键/非法字符逐行校验。排序不修改 YAML，改名保留稳定行及输入焦点；GUI 编辑保留注释和多行格式。YAML 提供批量编辑和复制，格式无效时阻止保存与模式切换，未保存保护覆盖无效键草稿。

Secret 默认隐藏；显示/编辑只作用于临时草稿，隐藏和复制使用遮蔽内容，保存仍只记录键和挂载信息，保存/取消后重新锁定。数据卷表头显示 File Name / File Content。继承和合并预览继续只读，Patch 与资源引用行为保留。

新增 `node scripts/check-config-data.mjs`（33 项数据/状态检查）与 `node scripts/check-config-data-parity.mjs http://127.0.0.1:5182`（51 项浏览器检查）。同轮重新通过 36 项配置条目、44 项配置对比、43 项任务/阶段配置引用、46 个路由/状态，以及 18 项快照 Mock、38 项对比 Mock 检查。浏览器复制测试拦截 `writeText` 验证内容/错误提示，没有操作系统剪贴板验收。结果和截图见 `screenshots-config-data-parity/`；完整差异见 [页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。外部 Provider/ESO、配置保护与审批、真实 Secret 和权限仍待补齐。

## 第十三轮：应用创建与克隆

创建引导采用可搜索克隆卡片、来源面包屑/返回、项目与名称组合行、350 位描述和折叠标签键值表，名称按参考配置限制 3–30 位。标签支持新增/删除、逐行格式/重复校验及传播选项；传播只记录元数据。项目详情创建预选项目，返回选源保留身份草稿；关闭/路由/刷新事件有未保存保护，名称冲突可修正重试，提交防重。

克隆目录按分页完整读取并过滤归档来源，避免首 20 条截断。Mock 复制边界见上方说明；源码应用进入 Git 配置，镜像应用进入部署模板。企业模板、项目强制标签策略、真实权限/克隆/传播仍未接入；概览标签编辑已在第十四轮统一为键值表。

新增 `node scripts/check-application-creation.mjs`（46 项数据/Mock）与 `node scripts/check-application-creation-parity.mjs http://127.0.0.1:5182`（48 项浏览器）检查。覆盖创建/跨项目克隆/镜像、标签回读、来源分页、键盘 Enter/Escape、草稿保护与 1280px 内部滚动；同轮回归通过 38 项关键交互、51 项配置数据与 46 个路由/状态。截图与结果见 `screenshots-application-creation-parity/`；完整证据和差异见 [页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。

## 第十四轮：应用概览编辑与环境列表

关于页调整为 300px 档案侧栏，环境页隐藏侧栏；页签、名称/部署时间排序写入 URL。描述在侧栏内编辑并沿用 350 位校验；标签使用 800px 抽屉复用创建时的键值/传播表，保留旧版纯文本标签且允许明确移除。所属项目使用 600px 弹窗展示权限影响提示，保存检查同名冲突，并同步项目路由与应用切换目录。

说明提供页内 Markdown 编辑/预览、原文保存及更新时间，复用现有清理渲染。环境表支持完整镜像名、镜像/源码详情、指定发布历史链接和空态继续配置；描述、标签、项目、说明共用草稿保护。旧 fixture 缺失的创建事实显示未记录，新建应用才记录当前创建人和时间。

新增 `node scripts/check-application-overview.mjs`（39 项数据/Mock）与 `node scripts/check-application-overview-parity.mjs http://127.0.0.1:5182`（49 项浏览器）；构建通过，回归通过 48 项创建/克隆、38 项关键交互、46 个路由/状态和 46 项创建数据检查。截图与结果见 `screenshots-application-overview-parity/`。真实权限/传播、企业版概览区块及完整镜像详情仍未实现；完整证据见 [页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。

## 第十五轮：Git 事件源与分支设置

流水线的 Tag Creation / Pull Request 使用 Webhook 事件过滤配置，支持按字段增删正则条件；单仓库显示有限事件目录，多仓库沿用固定分支/分支正则。构建抽屉可选择符合过滤条件的事件，进入同一抽屉内的“已接收 Webhook”视图，查看通过/未通过的过滤结果及 Payload，返回保留选择，编辑入口直接打开对应流水线。新构建及重试保留当次事件的源码快照。

分支正则采用 600px“设置分支”弹窗，正则约束与具体检出分支分别保存，检查必填/匹配并保留版本冲突检测。取消不改变选择，保存清理变化仓库的所选提交并同步画布，重新打开保留已保存分支。

新增检查：`node scripts/check-git-sources.mjs`（本地 Mock）和 `node scripts/check-git-source-parity.mjs http://127.0.0.1:5182`（生产预览交互和截图）。公共 Provider 的事件目录及归一化 Payload 均为本地示例，没有接收真实 Webhook、提供真实 URL/密钥、执行 PR 合并或自动构建；完整元数据和逐状态视觉对齐仍需继续。

本轮类型检查/生产构建、57 项新增 Mock 与 42 项新增浏览器检查通过；最终生产构建还通过 35 项多仓库、30 项配置/历史、38 项关键交互及 46 个路由/状态回归，浏览器均无运行时错误与控制台警告。截图和结果位于 `screenshots-git-source-parity/`。分支弹窗与事件列表已人工复查，未声明所有状态逐像素一致。

## 第十六轮：构建平台、Secrets／SSH 和 Buildpacks

目标平台支持多选三个预设、搜索创建自定义值和清空；空值表示跟随构建节点。自定义平台保存前确认，返回修改保留输入。应用与流水线覆盖共用表单，继承时只读，删除覆盖恢复应用配置；选材摘要和新构建/重试快照保留有效选项。

Secrets／SSH 支持引用增删、来源、必填和重复 ID 校验，只保存 `type/id/secretName/key`，不接收凭据明文。上游对应 UI 为可选扩展库组件，本地没有其实现，本轮按已确认类型与调用契约提供 Mock 引用表；扩展版具体布局和目录选择仍待核对。

Buildpacks 增加语言、版本、自动检测与自定义 Builder，使用明确标记的离线示例目录；版本选择联动相应环境变量。环境变量与 Docker 参数独立保存，切换构建方式保留草稿，Buildpacks 隐藏 Docker 平台及凭据选项。长表单改为配置导航和内容独立滚动，顶部页签及底部保存栏保持可见。

新增检查：`node scripts/check-build-options.mjs`（42 项本地 Mock）和 `node scripts/check-build-options-parity.mjs http://127.0.0.1:5182`（30 项浏览器）。类型检查/生产构建、43 项部署模板、44 项配置对比、46 个路由/状态、38 项关键交互、42 项 Git 事件与 30 项配置/历史回归通过，浏览器均无运行时错误和控制台警告；截图与结果位于 `screenshots-build-options-parity/`。完整实时目录、真实凭据解析、多平台执行和全部状态逐像素验收尚未完成。

## 第十七轮：托管 Dockerfile 编辑器

托管模式改为仓库、语言、框架、重置与复制的一体化工具栏和固定 300px 行号编辑器；支持长文/横向滚动、Tab 缩进与 Shift+Tab 离开。语言联动首框架，切换即读取模板，缓存保留基线；编辑不修改模板，重置回基线，保存回读后以自定义正文为基线。旧自定义内容与下架模板继续保留。

应用和流水线覆盖共用组件；继承显示只读值，允许覆盖创建独立草稿，删除立即恢复应用内容。模板加载期间禁止保存，快速切换/销毁/只读转换会丢弃过期响应，仓库/上下文/参数的同期修改保留；失败支持重试或返回当前内容。托管模式有效路径固定为仓库根目录 `Dockerfile`，已有 Dockerfile 路径仍在模式草稿中保留，历史与重试冻结模板身份和完整正文。

新增 `node scripts/check-dockerfile-templates.mjs`（31 项离线状态/Mock）和 `node scripts/check-dockerfile-template-parity.mjs http://127.0.0.1:5182`（35 项生产浏览器）。类型检查与生产构建通过，新增浏览器检查零运行时错误/控制台警告；截图与结果见 `screenshots-dockerfile-template-parity/`。八个模板仅为离线编辑样例；未连接模板服务、写入 Git 或执行构建，语法高亮/补全等完整 Monaco 能力和全部状态逐像素验收仍待补齐。

同一生产构建另通过 42 项构建选项 Mock、30 项构建选项浏览器、35 项多仓库选材、30 项配置/历史、38 项关键交互及 46 个路由/状态回归，浏览器均无运行时错误/控制台警告。文档结构与差异空白检查通过。

## 第十八轮：资源 Manifest 工作区

应用和集群资源详情共用深色行号编辑器、一体化工具栏与原位左右分栏预览：当前清单只读，修改栏可继续编辑，内容变动立即失效校验，重新检查后才能保存。支持复制/下载、Tab 缩进、长清单纵横滚动及分栏联动，短原文不会反向拉回较长修改栏。隐藏字段只处理完整的 `metadata.managedFields` 子树，保留其他元数据、同名业务字段及注释。

现有资源编辑检查单文档和身份不变；创建也使用 YAML 文档解析。Mock 保存保留隐藏托管字段，检查 UID 和原清单快照，冲突/保存失败保留草稿；成功提交后读取失败单独提示并支持重新读取。资源/详情页签、关闭其他/全部、路由、集群/环境切换、顶部刷新和页面关闭均加入草稿保护。环境切换清除原活动详情，集群刷新重读资源，同集群内资源深链可以连续打开。开发环境 Deployment 示例命名空间已纠正。

新增 `node scripts/check-resource-manifests.mjs`（48 项本地状态/Mock）与 `node scripts/check-resource-manifest-parity.mjs http://127.0.0.1:5182`（48 项生产浏览器），均通过。类型检查与生产构建、38 项关键交互、46 个路由/状态及资源动作 Mock 回归通过；浏览器无运行时错误/控制台警告，文档结构与差异空白检查通过。截图及结果见 `screenshots-resource-manifest-parity/`。

以上是本地字段检查和 Mock 保存，不含 Kubernetes schema/server-side dry-run、真实权限或 resourceVersion 并发验收；完整 Monaco 高亮/补全/差异块行对齐、GUI schema、锁定字段与 desired/live 漂移比较仍待补齐。

## 第十九轮：Pod 日志与资源事件

应用与集群资源详情共用 Pod 日志工作区：三类容器分组、独立上一实例、上游范围预设、500px 四种自定义范围弹窗、按 Enter/按钮提交的文字搜索和字面 `grep -i/-A/-B/-C`/管道过滤。取消范围编辑保留当前日志，非法数值及未来时间不能提交；无时间范围匹配时显示空态。完整范围下载不受搜索过滤影响，上一实例文件名明确标记。增加换行、手动滚动暂停跟随、顶部/底部定位、暂停/继续与 Ctrl+C；不会向上一实例或初始化/临时容器追加模拟日志。

容器解析只读三个 Pod spec 列表，应用资源树和日志分析同步修正；“全部容器”读取各自日志。旧资源深链保留详情页签与指定容器，非 Pod 的日志深链回落 Manifest。请求切换/隐藏/销毁后迟到的响应失效，错误、缺失历史和空态分别展示。事件改为深色六列表格、最新优先与独立懒加载，缺失首次发生时间显示占位。

以上仍为 Mock：没有真实流/重连/归档、ANSI/xterm、虚拟列表和完整 grep 正则或多 Pod 分析器布局。模拟追加最多保留 10000 行，指定行数时按更小范围保留，不执行命令。

新增 `node scripts/check-pod-logs.mjs`（49 项离线）与 `node scripts/check-pod-log-parity.mjs http://127.0.0.1:5182`（44 项生产浏览器）均通过。类型检查与生产构建通过；本轮还回归通过 48 项资源 Manifest、38 项关键交互及 46 个路由/状态浏览器检查，零运行时错误/控制台警告，另通过 48 项 Manifest 离线检查。范围弹窗单选项裁切/溢出修正后再次通过新增完整浏览器检查，其他回归为修正前同轮证据。截图与结果见 `screenshots-pod-log-parity/`；文档结构及差异空白检查通过。

## 第二十轮：源码与镜像详情

按照本地 Devtron 共享库 `ArtifactInfoModal` 改为右侧 800px 全高抽屉：源码卡片在上，连接线与镜像产物在下。概览镜像/提交号、构建历史、发布历史 Source 和 Configuration 共用详情；选择镜像在原位展开源码及完整 Digest。外部镜像明确没有构建源码，历史缺失字段继续显示占位，不借当前配置补造历史。

四处入口统一编辑 Artifact 的 Release tags 和备注，跨页面导航可以回读；选择镜像的标签按钮和详情展开不会改变已选镜像，搜索支持标签与备注。编辑器包含数量/长度校验、去重、关闭/路由/刷新保护与异步失效处理；复制支持完整地址、标签和 Digest。镜像导入保留 registry 端口，确认发布后直接定位目标环境和本次记录，Source/Configuration URL 同步修正。

仍为当前页面会话内的 Mock，刷新恢复 fixture；没有接入仓库、后端或执行真实发布。标签治理/权限/审批、源码文件变更与 Git diff、CI 产物 ZIP 和全量视觉验收仍待补齐。新增检查为 `node scripts/check-artifact-details.mjs` 与 `node scripts/check-artifact-detail-parity.mjs http://127.0.0.1:5182`，截图及结果位于 `screenshots-artifact-detail-parity/`。

新增 31 项离线和最终 39 项生产浏览器检查通过，零运行时错误/控制台警告；最终类型检查与生产构建通过。另回归通过 49 项概览、38 项关键交互、46 个路由/状态、30 项配置/历史及 43 项历史日志浏览器检查。最后修正同 ID 镜像列表刷新时的草稿保留，修正后重跑新增完整浏览器检查，其他回归为局部修正前同轮证据。文档结构及差异空白检查通过。

## 第二十一轮：提交、PR/Tag 与已排除提交

源码历史和选材共用 Vue 3 + TDesign 的提交/事件组件，支持完整 SHA 复制、Git 提交链接、PR 链接复制、Tag 与源/目标分支链接。链接和复制不会切换选中项，卡片支持键盘；复制失败后显示可手动选择的完整 SHA。历史始终使用当次仓库与事件快照，修改当前配置不改写旧记录。

选材增加“显示/隐藏已排除提交”：默认隐藏，搜索可定位排除项；排除项显示原因、禁止选择/构建，全部排除显示专用空态。各仓库独立保存开关，刷新保留有效选择。Mock 使用明确的变更路径演示有序包含/排除规则，缺少路径不会被推断排除，实际触发层再次校验。正则源码快照分别保存表达式与检出分支。

只读核对上游共享源码实现后，确认其没有文件 Diff 面板；此前的源码文件变更/Git diff 待办需要先定位其他真实入口，不在这些组件添加自创界面。仍无远程 Git、后端、PR 合并或真实构建；Provider 策略和规则一致性仍需后续核对。新增验证命令为 `node scripts/check-source-details.mjs`（37 项离线）与 `node scripts/check-source-detail-parity.mjs http://127.0.0.1:5182`（39 项浏览器），截图及结果位于 `screenshots-source-detail-parity/`。

## 第二十二轮：两个 Manager 的 Pod 终端

新增 `PodTerminalWorkspace` / `usePodTerminal`，应用与集群资源详情共用连接/断开、清屏、普通/初始化/临时容器分组、四种 Shell 与全屏交互。深链传入的容器会保留；切换容器或 Shell 会重建 Mock 会话。支持历史命令与草稿恢复、Ctrl+C/Ctrl+D/exit、Ctrl+L/⌘K、选中复制及失败提示；全屏提供应用/环境或集群/Namespace 上下文，Ctrl+Shift+F 展开、Esc 恢复并还原焦点。

新增连接中/错误重试/离线恢复/会话过期状态，已知终止或等待容器禁用输入。Mock 边界校验集群、Pod UID、容器和 Shell，关闭、快速切换、隐藏/销毁会清理迟到会话。命令仍只做字面回显，不执行 Shell。xterm/ANSI/多行编辑、动态临时容器、可选文件下载及独立集群管理/节点调试终端仍需继续核对。

验证：`node scripts/check-pod-terminal.mjs`（42 项离线）、`node scripts/check-pod-terminal-parity.mjs http://127.0.0.1:5182`（37 项生产浏览器，零错误/警告）；另回归通过 49 项日志离线及 44 项日志、48 项 Manifest、38 项关键交互浏览器检查。截图与结果在 `screenshots-pod-terminal-parity/`，最终类型检查与生产构建通过。仍为本地 Mock 与代表性截图验证。

## 第二十三轮：节点详情与集群调试终端

节点详情的调试入口现在按 URL 选中对应节点。集群终端使用独立 `ClusterTerminalWorkspace` / `useClusterTerminal`，提供两行工具栏、分组节点、可创建命名空间/公开镜像、bash/sh、节点 Debug Mode、连接状态/历史/复制与上下文全屏。调试 Pod 的事件和 Manifest 支持独立页签、隐藏托管字段、原位 Review/Apply、重建确认与草稿保护；调试 Pod 仅存在工作区本地状态，不创建真实资源。

节点详情补动作与页签同排、左右独立滚动、joined key/value 元数据复制/显示全部/收起、Pod 多列排序与复制，YAML 复用共用 Manifest 编辑器。Mock 节点 YAML、通用资源和概要同步，调度与元数据字段有本地基本检查；真实 schema、xterm/ANSI、服务端并发/超时及可选文件下载仍未接入。

验证脚本：`node scripts/check-cluster-terminal.mjs`（43 项离线检查）、`node scripts/check-cluster-terminal-parity.mjs http://127.0.0.1:5182`（50 项生产预览交互，零运行时错误/警告）；截图及结果位于 `screenshots-cluster-terminal-parity/`。原有 37 项 Pod 终端、48 项 Manifest 与 38 项关键交互浏览器检查通过。具体最终证据见[页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。

## 第二十四轮：资源类型身份与 CRD/节点列表

两处 Manager 共用 group + plural 的资源类型身份；同名 Kind 按组分支显示，支持短名称搜索、异步展开与 K/Esc。集群列表通过 `resource` + `group` URL 恢复状态；旧深链可用，未知组明确报错，详情与删除不会混淆同名资源。

新增 `resourceListing.ts`、`ResourceColumnSelector` 与 `ResourceUsageCell`：19 组内置资源列和 Mock 动态附加列使用结构化 YAML 字段，CRD 定义展示 Group/Kind/Scope/Versions/Established；节点列表补 12 项字段、CPU/Memory 实际用量条/Tooltip/NA、独立调度警示、搜索列/Apply/必选列、数值排序及键盘行操作。Discovery 有 32 类，新增两组同名 Rollout 与 CRD 样例；两组均为本地 Mock。

完整节点筛选、Jump 搜索浮层、任意服务端 Table/复杂 JSONPath、URL 排序分页、Discovery verbs 与权限及所有状态视觉仍待补齐。详情继续共用 Manifest/Events，接口按当前要求暂缓。验证记录与剩余差异见[页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。

验证：`node scripts/check-resource-listing.mjs`（41 项离线）、`node scripts/check-resource-listing-parity.mjs http://127.0.0.1:5182`（47 项生产浏览器，零错误/警告）；截图与结果在 `screenshots-resource-listing-parity/`。构建与本轮 48 项 Manifest、50 项节点/集群终端、37 项 Pod 终端、38 项关键交互及 46 个页面/状态回归通过；最后短名称补充后的复查范围见页面对账文档，仍仅为前端 Mock 证据。

## 第二十五轮：节点筛选与 Kind 搜索浮层

节点列表增加 Label、Node Groups、K8s Version 三类多选筛选、草稿/Apply、逐项移除/Clear filters 和选项搜索。名称搜索及已应用筛选写入 URL，可通过深链、刷新、前进/后退恢复；同类 OR、跨类 AND，节点组精确匹配。候选项来自当前集群完整本地节点数据，版本尚未调用独立接口。

两处 Manager 共用独立 Jump to Kind 结果浮层，保留原树，支持同 Kind API group 描述、短名称优先、安全文字高亮、K/Esc/Enter/上下键循环/Home/End、鼠标选择与失焦清空。节点搜索/筛选/列选择同排，提供 `/` 和 F 快捷键。

规则在 `resourceFilters.ts`，URL 状态在 `useNodeListFilters`，交互拆为 `NodeListFilters` / `KindSearchPicker`。接口继续使用前端 Mock；URL 排序分页、动态服务端 Table、完整权限及全部视觉状态仍待继续。验证命令为 `node scripts/check-resource-filters.mjs` 和 `node scripts/check-resource-filters-parity.mjs http://127.0.0.1:5182`；详细证据见[页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。

本轮新增 32 项离线和 54 项生产浏览器检查通过，浏览器零错误/警告；截图及结果见 `screenshots-resource-filters-parity/`。最终构建及 47 项资源列表、50 项节点/集群终端、48 项 Manifest、46 个页面/状态回归通过；同轮关键交互的具体复查时点见对账文档。

## 第二十六轮：资源 URL 排序分页与事件列表

普通资源、节点和事件共用 `pageNumber` / `pageSize` / `sortBy` / `sortOrder` URL 状态，默认每页 100 条。搜索、命名空间和事件类型也从 URL 恢复；用户修改筛选/排序/每页条数回到第一页，前进后退恢复原页，切换 Kind 保留条数和搜索。非法参数与超出末页在对应数据加载完成后校正，删除末页最后一行自动回退。

先筛选和排序全部匹配行，再截取当前页；勾选限定当前页，上下文变化清空旧选择。列表内部滚动，固定表头和底部分页栏，支持键盘翻页。事件页默认 Warning，可切 Normal，按 Last seen 最近优先及数值次数排序，支持消息搜索与相同分页状态。

实现拆为 `resourceListState.ts` / `useResourceListState` / `ResourceListPagination` / `ResourceEventsTable`。验证命令为 `node scripts/check-resource-pagination.mjs` 和 `node scripts/check-resource-pagination-parity.mjs http://127.0.0.1:5182`。浏览器通过现有 YAML 页面创建 100 个临时 Mock ConfigMap，验证跨页/搜索/排序/历史/选择/删除与 1280px；不改变默认 fixture，也不连接后端。详细证据和剩余差异见[页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。

验证：新增 28 项离线、45 项最终稳定生产包浏览器检查通过，最终构建及同轮稳定包的 54 项筛选/38 项关键交互复验通过，浏览器零错误/警告。同轮另有 47 项资源列表、50 项节点/终端、48 项 Manifest、46 个页面/状态回归记录，具体时点见对账文档。

## 第二十七轮：动态资源页签

Application Manager 和 Infrastructure Manager 共用 `ResourceWorkspaceTabs`：固定入口保持可见，资源页签独立横向滚动，并提供 Kind/名称/Namespace/group 搜索菜单、单项关闭、键盘操作、同步状态和当前资源刷新。刷新/切换/关闭继续经过 Manifest 草稿保护，关闭活动项回到本次会话最近访问的资源或固定列表。

Pod 日志和终端同步当前容器，“在集群中查看”保留详情页签与容器。接口继续使用前端 Mock。

验证命令：`node scripts/check-resource-tabs.mjs`、`node scripts/check-resource-tabs-parity.mjs http://127.0.0.1:5182`。截图和浏览器结果位于 `screenshots-resource-tabs-parity/`，完整对账与剩余差异见 [页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。

## 第二十八轮：资源详情与地址恢复

两处 Manager 共用 32px 详情页签/操作栏，Manifest 编辑/预览/应用与重启同排，Infrastructure 删除靠右，Application 详情按参考隐藏删除。扩缩容与 Secret 明文保留在更多操作中，复制/下载位于编辑器底栏。

`resourceTab` / `container` URL 记录详情页签与容器，支持刷新、前进后退和清空本地页签记录后恢复当前资源。导航取消保留原 URL 和 Manifest 草稿，固定列表/环境切换清理详情参数；应用深链恢复限于当前应用已加载资源。

新增验证：`node scripts/check-resource-detail-location.mjs`（18 项离线检查）、`node scripts/check-resource-detail-parity.mjs http://127.0.0.1:5182`（32 项生产浏览器检查）。本轮最终生产包合计通过 281 项相关浏览器检查，零运行时错误/控制台警告；结果与截图位于 `screenshots-resource-detail-parity/`。仍是前端 Mock，完整编辑器、期望/实时 Manifest 比较及所有状态视觉继续见对账文档。

## 第二十九轮：期望与实时 Manifest 比较

Application 顶层资源的只读 Manifest 工具栏增加比较入口，左侧期望、右侧实时；Pod/ReplicaSet 等子资源和 Infrastructure 不显示。关闭后返回原清单并恢复入口焦点，原有编辑 Review 和草稿保护继续独立工作。

演示期望快照在 fixture 初始化时固定，实时编辑不会覆盖期望。比较过滤 status、服务端身份/托管字段和 last-applied 注解，整理映射键顺序，保留数组顺序和标量类型；提供增删行、上一处/下一处、F7/Shift+F7、联动滚动和各侧独立复制下载。加载失败可重试，缺失快照不使用实时值填补。

验证命令：`node scripts/check-resource-comparison.mjs`（27 项离线）、`node scripts/check-resource-comparison-parity.mjs http://127.0.0.1:5182`（34 项生产浏览器）。最终构建与共计 196 项相关生产包浏览器检查通过，零运行时错误/控制台警告；截图与结果在 `screenshots-resource-comparison-parity/`。当前是本地 Mock 比较，真实期望来源、Kubernetes 归一化、完整编辑器与全部状态视觉仍见 [页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。

## 第三十一轮：资源原生差异编辑器

资源编辑 Review、Application 期望/实时比较和集群调试 Pod Review 共用 Vue 封装的 CodeMirror 6 MergeView，与当前参考共享库保持同一编辑器体系。补齐多行增删后的相同行对齐、行内差异、YAML 高亮、折叠、查找替换、撤销重做和 F7/Shift+F7；原清单只读，资源 Review 右侧修改立即使旧校验失效。

差异编辑器按需加载，长清单只渲染可视区域，复制/保存仍包含完整原文，视觉对齐不修改文档。保留内部滚动、草稿保护、应用读回和调试 Pod 重建流程。运行时依赖许可证见 `public/licenses/codemirror-LICENSES.txt`。

新增原生交互检查：`node scripts/check-resource-diff-parity.mjs http://127.0.0.1:5182`，覆盖多行对齐、只读/编辑、查找替换、折叠、撤销重做、草稿保护及 800 行清单；截图和结果在 `screenshots-resource-diff-parity/`。普通单栏编辑器、完整上游工具栏/差异缩略图、GUI/schema/补全及真实接口仍见 [页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。

本轮最终生产构建、75 项离线检查和 234 项相关生产包浏览器检查通过，其中新增原生差异交互 38 项；浏览器零运行时错误/控制台警告。仍使用前端 Mock。

## 第三十二轮：单栏资源 Manifest 编辑器

普通资源 Manifest、节点 YAML 和调试 Pod 的查看/编辑统一使用原生 CodeMirror，与双栏 Review 共用高亮、行号、折叠和键盘配置。查看保持只读，编辑自动聚焦；资源页脚和调试 Pod 工具栏提供查找入口，编辑模式支持替换、撤销重做、Tab 缩进，Shift+Tab 可离开编辑器。

千行清单只渲染可视行，复制和保存读回仍保留完整中文、注释和末尾换行。切换资源清空旧撤销历史，取消导航保留草稿；校验、Review 和调试 Pod 重建继续使用现有工作区流程。创建资源抽屉、其他配置编辑器、GUI/schema/补全及完整上游工具栏仍见 [页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。

新增 `node scripts/check-resource-editor-parity.mjs http://127.0.0.1:5182`，覆盖 38 项单栏原生交互，包括只读保护、查找/替换、折叠、撤销重做、编辑焦点、草稿保护、历史隔离和千行清单；结果及截图在 `screenshots-resource-editor-parity/`。接口仍为前端 Mock。

本轮最终生产构建、75 项离线检查和 319 项相关生产包浏览器检查通过，浏览器零运行时错误/控制台警告。保留既有主 chunk 体积警告；共享编辑器运行时按需加载。

## 第三十三轮：资源创建抽屉

创建资源使用 1024px 抽屉与空白原生 CodeMirror，按 Devtron 源码直接 Apply，应用后显示类型/名称/状态/说明四列结果，区分创建、更新和失败；支持 Edit YAML 恢复原文、Close 刷新列表。提交期间阻止关闭/路由切换，浮层内隔离全局导航快捷键；失败保留草稿，部分成功后再失败仍能在关闭时刷新。重新打开或切换集群时使用独立空白会话。

复用单栏编辑器的高亮、查找替换、撤销重做和长清单虚拟渲染，结果内部滚动、表头和底部按钮保持可见。新增 `node scripts/check-resource-creation.mjs`（35 项离线）与 `node scripts/check-resource-creation-parity.mjs http://127.0.0.1:5182`（47 项生产浏览器）；截图和结果在 `screenshots-resource-creation-parity/`。类型检查与生产构建通过，仍为前端 Mock；真实权限/写入、其他配置编辑器和完整上游工具栏见 [页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。

本轮共通过 110 项离线与 270 项最终生产包浏览器检查；浏览器零运行时错误/控制台警告。回归范围包含资源 Manifest、分页、节点筛选/Kind 搜索、单栏编辑器和关键业务交互。

## 第三十四轮：应用配置与历史 YAML 编辑器

部署模板、ConfigMap/Secret、试运行和历史快照的 YAML 改用共用原生 CodeMirror，补高亮、折叠、查找替换、撤销重做与长文档虚拟渲染。配置表单/历史编辑区保持固定高度，复制与保存保留完整注释、引号和末尾换行。Secret 显隐和配置上下文切换重置撤销历史；隐藏后的查找、复制与撤销不能恢复明文。

环境/历史 YAML 对比改用原生双栏差异，提供独立查找、同步滚动、F7 导航、未改范围折叠与双侧展开。查找命中折叠内容时自动展开；全文复制仍保留折叠内容，切换环境更新两侧标签与折叠范围。原有 GUI、Patch/Replace、保存和离页保护继续保留。

新增 `node scripts/check-config-editor-parity.mjs http://127.0.0.1:5182`，覆盖 51 项生产包 Mock 交互；截图与结果在 `screenshots-config-editor-parity/`。完整上游工具栏、schema/补全和 Dockerfile/任务脚本原生编辑器等剩余差异见 [页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。

本轮类型检查/生产构建、89 项离线与 382 项相关浏览器检查通过；浏览器零运行时错误和控制台警告。最后仅修正历史快照列宽后复验 207 项浏览器检查；具体范围和证据顺序见页面对账文档，接口仍为前端 Mock。

## 第三十五轮：Dockerfile 与流水线任务代码编辑器

应用构建、CI 覆盖的 Dockerfile，以及 CI/CD 前后置 Shell 和容器挂载脚本，统一使用 300px 浅色原生 CodeMirror。支持 Dockerfile/Shell 语法高亮、查找替换、撤销重做、Tab 缩进和 Shift+Tab 离开；千行正文内部滚动与虚拟渲染，全文复制和保存保留 shebang、中文、注释、空行和末尾换行。

模板/仓库、任务、执行方式及覆盖访问变化隔离撤销历史；校验状态变化保留当前撤销栈。继承态可查找且不能编辑/替换；容器关闭脚本挂载保留当前内容。修复查找 Escape 误关流水线抽屉，原有模板缓存/重置/复制、保存和草稿保护继续使用。业务组件通过 `ScriptCodeEditor` 复用 `codeEditor` / `codeEditorSetup`，资源和应用 YAML 保留原有适配层及深色主题；新增 `@codemirror/legacy-modes` 提供按需加载的脚本模式。

新增 `node scripts/check-script-editor-parity.mjs http://127.0.0.1:5182`，51 项原生编辑器生产包 Mock 检查通过，截图和结果在 `screenshots-script-editor-parity/`。本轮类型检查/生产构建、91 项离线与 359 项相关浏览器检查通过；最终浏览器结果零运行时错误/控制台警告。一次并发 YAML 回归出现测量循环警告，完整重跑后通过；没有屏蔽警告。保留既有主 chunk 警告。全部证据均为前端 Mock，不含后端、真实构建或 Kubernetes 验收；完整上游工具栏、schema/补全、扩展版配置与全状态视觉差异见 [页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。

## 第三十六轮：双栏差异缩略图与查找焦点

资源 Manifest Review、期望/实时比较、环境配置对比与发布历史，共用右侧 30px 双栏差异缩略图。支持点击、拖动、Home/End/PageUp/PageDown/方向键定位；随正文、滚动、尺寸和显示密度更新。“仅显示差异”时隐藏，恢复全文后重绘；三类对比页标题及导出栏保留相同列宽。原生文档仍持有完整正文与撤销历史，定位不修改草稿或通过未完成的校验。

缩略图用 Canvas 对原生已测量行块进行有界采样，避免复制长清单编辑器；与上游缩小 MergeView 的渲染方式不同，未声明逐像素一致。离开页面时清理绘制、观察器和指针捕获。YAML 单栏/双栏查找先处理 Escape 并返回对应编辑器焦点，保留外层抽屉。

类型检查与生产构建通过；资源差异 62 项、单栏 Manifest 38 项、资源创建 47 项，共 147 项浏览器检查通过，零运行时错误/控制台警告。`scripts/check-config-editor-parity.mjs` 的 55 项功能断言及零运行时错误断言通过，但最终零警告断言未通过：千行 ConfigMap 单栏阶段仍出现一次既有测量循环警告，单独复跑也保留该问题。结果及截图在各自 `screenshots-*-parity/`，没有屏蔽警告或把该套记为全部通过。全部仍为前端 Mock，接口继续暂缓；完整查找工具栏、默认配置比较切换、schema/补全/锁定字段与其余差异见 [页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。

## 第三十七轮：共用查找/替换工具栏

资源 Manifest、Review、创建抽屉、应用配置/历史 YAML、Dockerfile 和 CI/CD 脚本统一使用 Vue/TDesign 查找面板。提供可收起替换行、大小写/全词/正则组合开关、当前位置/总数、上下项、选择全部与关闭。原生 CodeMirror 执行搜索、替换、多选区编辑和撤销；1000 项以上禁用原生全选，仍显示完整计数。只读/隐藏 Secret 不暴露替换入口，编辑器上下文和历史隔离继续保留。

支持 Ctrl+F、Ctrl+Alt+F（以及 Ctrl+H 别名）、Enter/Shift+Enter、F3/Ctrl+G、替换行内 Ctrl+Enter/Ctrl+Alt+Enter 和 Escape。双栏查询独立，窄栏工具栏内部换行，销毁时卸载 Vue 面板。上游这几类配置调用未传入共享 Header 的默认比较值，本轮没有增加无来源的默认比较入口。

新增 `node scripts/check-editor-search-parity.mjs http://127.0.0.1:5182`，45 项生产浏览器检查通过；通过公开 DOM、键盘、剪贴板操作验证工具栏，结果与截图在 `screenshots-editor-search-parity/`。同轮相关 255 项浏览器回归通过，最后的无效查询保护重建后复验新增全部 45 项，详细验证顺序见对账记录。配置测量警告本轮早期仍复现，最终 57 项完整复跑零警告；根因尚未确认，不记为已修复。接口继续暂缓，当前仍是前端 Mock；其余差异及验证记录见[页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。

## 第三十八轮：YAML 诊断与 Values 字段补全

共用 YAML 单栏、创建抽屉及完整双栏支持语法错误标记、Ctrl+Shift+M 诊断面板和 F8 定位；折叠比较关闭诊断，回到完整比较恢复。部署 Values 额外提供本地 Chart schema 的类型/范围检查、根字段/嵌套字段/空行补全和类型/说明悬浮提示。Enter 插入、Escape 关闭，原文、注释与单步撤销保留；只读继承不提供插入候选，隐藏 Secret 会清理诊断及私密错误信息。

schema 只覆盖现有演示 Values 契约，允许自定义字段；普通 ConfigMap/Secret、试运行和任意 K8s Manifest 不套用该 Chart schema。真实 Chart schema/目录、任意资源 GUI、权限/审批保护和全状态像素验收仍待继续，当前仍为前端 Mock。新增验证脚本为 `node scripts/check-yaml-validation-parity.mjs http://127.0.0.1:5182`；依赖许可证见 `public/licenses/yaml-schema-LICENSES.txt`。

本轮类型检查/生产构建和 350 项生产 Mock 浏览器检查通过（新增校验 50、查找 45、配置/Secret/历史 57、资源创建 47、资源单栏 38、资源双栏 62、脚本 51），各套零运行时错误和控制台警告。长 ConfigMap 本次未出现测量警告，之前的间歇问题仍未定位；保留已有主 chunk 体积警告，schema 库带来的额外分包成本见对账文档。

## 第三十九轮：xterm 终端与 Pod 日志

Pod 终端、集群终端和节点 Debug Mode 共用原生 `@xterm/xterm@6` + FitAddon，保留 Vue 3 + TDesign 的选择器、会话状态、全屏和调试 Manifest 草稿保护。新增 ANSI 颜色/回车覆盖、原生选择复制、光标与多行编辑、粘贴/续行/完整历史；Mock 仍只解析有限字面命令，不执行 Shell。字体暂沿用本地 Consolas/Courier New，与上游 Inconsolata 仍有差异。

Pod 日志使用 xterm 可视行渲染和 ANSI 显示，保留自动换行/无换行横滚、跟随/暂停、范围、上一容器、grep 和原文完整下载；新增 debugger 颜色/进度 fixture。构建/发布历史日志、多 Pod 分析器、真实流/exec、动态临时容器和文件下载仍待继续。许可证见 `public/licenses/xterm-LICENSES.txt`，新增浏览器验证命令为 `node scripts/check-terminal-xterm-parity.mjs http://127.0.0.1:5182`。

本轮构建及 185 项生产包浏览器检查通过（新增 xterm 54、Pod 终端 37、集群调试 50、Pod 日志 44），各套零运行时错误和控制台警告；另有 134 项 Mock 逻辑检查通过。已人工检查 1280px 的日志和集群终端截图，并修复 legacy viewport 黑色底条。共享 xterm/输入适配分包约 338.34 KB（gzip 86.05 KB），主 chunk 的既有体积警告仍保留，不能替代真实会话或全状态视觉验收。

## 第四十轮：多 Pod 日志分析器

运行详情中的“日志分析”按 Devtron 源码改为工作负载/单 Pod 分组选择与同名容器聚合，汇入一个带 Pod 前缀的 xterm 视窗；替换旧级别统计卡片和“全部容器”选择。支持三类容器、上一实例、四种自定义范围、逐 Pod grep 上下文、暂停/继续/Ctrl+C、清空/重连、换行/滚动和逐 Pod 原文下载。缺容器明确跳过，部分 Pod 读取失败不会隐藏其他成功日志。

开发环境增加第二个 checkout Pod，分别提供 app/envoy 和上一实例日志，用于实际操作聚合、缺容器和部分失败。分析器遵守资源 Manifest 草稿保护，保留页签切换时的选择、范围与搜索；无 Pod 环境隐藏入口并修复深链。组件见 `LogAnalyzerWorkspace` / `useLogAnalyzer` / `utils/logAnalyzer.ts`，沿用 Vue 3 + TDesign 和现有 xterm/范围对话框。

验证命令：`node scripts/check-log-analyzer.mjs`（离线状态/请求检查）、`node scripts/check-log-analyzer-parity.mjs http://127.0.0.1:5182`（生产包浏览器检查与截图）。Mock 按源分块回放，未验证真实 SSE 到达顺序、服务端完整 grep、归档或真实集群；构建/发布历史日志和全状态像素验收仍待继续。

本轮类型检查/生产构建、209 项生产 Mock 浏览器检查（分析器 38、Pod 日志 44、动态页签 32、资源列表 47、路由状态 48）及 85 项离线检查（分析器 36、Pod 日志 49）通过；浏览器均无运行时错误或控制台警告。已人工检查聚合/部分失败截图，保留既有主 chunk 体积警告。

## 第四十一轮：构建／发布历史分段日志

构建及前后置任务历史按 Devtron `LogsRenderer` / `LogStageHeader` 使用独立阶段虚拟列表：支持 STAGE_INFO 更新、每节行号、状态、有效起止时间的耗时、构建快照目标平台、成功阶段初始收起、独立/全部折叠与 E 快捷键。新增 `HistoryLogViewport` / `HistoryLogStageHeader`，保留共用查看器的工具栏、全屏、跟随和下载。

ANSI 作为安全的 Vue 文本样式显示，支持基本/256/RGB 颜色及字体样式；字面搜索跨颜色片段计一次，能够展开所属阶段并定位未挂载行。可视行按换行后的实际高度测量，阶段标题吸顶，刷新与尺寸改变保留滚动锚点；完整下载包含原始 ANSI 和阶段事件，不截断屏幕外日志。

`bd-1011` 增加 1,800 行编译、长行与 ANSI Mock 样例；没有从整体构建耗时推算缺失的历史阶段时间。损坏事件保留文本，缺失状态显示未知，旧单节日志兼容。未连接真实日志流、归档、对象存储或任务执行服务，也未完成所有状态的像素验收。

验证命令：`node scripts/check-history-log-stages.mjs`（阶段/ANSI/布局/状态离线检查）、`node scripts/check-history-log-parity.mjs http://127.0.0.1:5182`（生产包浏览器检查与截图）；原有历史日志和阶段执行检查继续保留。

本轮类型检查/生产构建、175 项生产 Mock 浏览器检查（历史日志 56、阶段运行 41、配置/历史 30、路由状态 48）及 129 项离线检查通过；浏览器均无运行时错误和控制台警告。已人工检查长日志换行和 1280px 构建/任务截图，保留既有主 chunk 体积警告。

## 第四十二轮：Manifest 对比与 Chart 默认值

配置对比导航增加 Devtron 的 `Configuration / Manifest` 页签，Manifest 使用单个 `Manifest Output`。两侧环境/历史版本、交换、刷新、浏览器前进后退和直接访问继续由 URL 管理；关闭时恢复来源配置条目或发布历史记录。环境下拉分为基础配置、`Environments`、`Chart default values`，本地目录提供与现有模板选择器一致的 Deployment/Job 两个版本，默认值不混入应用/环境覆盖或发布历史。

Manifest 面板复用原生只读 YAML 双栏、查找、差异定位、缩略图和未改范围折叠。当前配置明确使用 `<IMAGE>` 占位，历史仅使用当次快照的 Chart、目标、镜像与配置条目；缺失快照/目标/镜像保持不可用。Secret 仅展示键和遮蔽值，外部配置只生成引用，支持环境变量、卷/SubPath/文件权限的示例差异。

此预览仅支持现有前端示例 Values 契约的 `replicaCount/containerPort/host/env/job`，未支持字段报错并可切回完整配置；不是实际 Helm 渲染或集群校验，也不是 Devtron Chart 仓库历史。受保护草稿/审批发布版本、作用域变量转换、完整 Chart schema/目录及所有状态像素验收仍待继续。

验证命令：`node scripts/check-config-manifest.mjs`（离线检查）、`node scripts/check-config-manifest-parity.mjs http://127.0.0.1:5182`（生产浏览器检查与截图）；现有配置对比和快照回归继续保留。

本轮类型检查/生产构建通过；最终生产包的 Manifest 41 项、配置对比 44 项、配置条目/历史/Notes 36 项浏览器检查通过，合计 121 项，均零运行时错误/控制台警告。Manifest 50 项、配置对比 38 项和快照 18 项离线检查通过，共 106 项；已检查 1280px 及 Chart 默认值截图。以上为前端 Mock 证据。

## 第四十三轮：配置变量转换与历史解析快照

配置对比的版本工具栏按 Devtron 增加 `Show variables value / Hide variables value` 方形按钮，切换原始 `@{{variable-name}}` 与解析值，同时重算 GUI/YAML、文件变更标记和差异过滤。`resolveVariables=1` 随 URL 保留，交换环境、切换文件、刷新、前进后退和 Manifest 往返继续恢复模式；无变量的应用隐藏按钮。Manifest 固定使用相应版本的解析结果，不提供配置转换按钮。

发布历史配置支持同一按钮、单栏 GUI/YAML、与当前配置对比，以及携带转换模式进入版本对比。Mock 发布捕获当次解析结果，回滚保留来源结果，晋级使用目标环境；历史缺少解析快照、原始配置与快照不匹配或变量未知时明确报错，可关闭转换查看原文，不用当前变量回填历史。Secret 继续只展示键和遮蔽值，不进入解析回执。

`payment-worker` 的编辑源包含两个显式示例引用，开发/生产解析值不同；独立历史记录保留旧解析值，原有缺快照记录仍不可还原。本地 adapter 仅替换部署 Values 与 ConfigMap 数据中的已登记字面字符串，不执行表达式/递归模板，不代表完整作用域优先级、变量管理、敏感变量或挂载元数据解析。

验证命令：`node scripts/check-config-variables.mjs`、`node scripts/check-config-variables-parity.mjs http://127.0.0.1:5182`。类型检查/生产构建通过；最终同一生产包新增 39 项及配置对比/Manifest/配置历史回归合计 160 项浏览器检查通过，零运行时错误/控制台警告；变量、比较、Manifest、快照合计 144 项离线检查通过。截图与结果见 `web/screenshots-config-variables-parity/`，已人工核对 1280px、历史与异常状态。以上为前端 Mock 验证。

## 已知边界

- 配置条目使用 `ConfigEntryWorkspace` / `ConfigEntryForm` / `useConfigEntries`：基础与环境配置共用 GUI/YAML、继承与独立覆盖、Patch/Replace、已有资源引用和数据卷挂载表单。Secret 配置只保存键与挂载元数据，不保存输入明文；与资源浏览器的 Mock Secret reveal 是两个不同场景。
- 环境对比支持部署模板、ConfigMaps、Secrets 的独立路由、有效配置、历史版本、并排 YAML、第四十二轮的 Manifest/Chart 默认值及第四十三轮的变量转换示例；受保护草稿/审批发布版本、完整变量作用域/管理/敏感值及真实 Chart 渲染/目录仍未对齐。发布配置使用独立快照，两条 checkout 开发记录及一条 payment 变量历史为固定示例，其他缺失快照记录显示不可还原；新触发/晋级/回滚处理本地快照，不执行真实部署。
- Notes 以 `marked` + `DOMPurify` 清理渲染 Markdown；仍为 Mock Helm 内容。
- 新增验证命令：`node scripts/check-config-entry-parity.mjs http://127.0.0.1:5182`（浏览器交互及截图）、`node scripts/check-config-snapshots.mjs`（本地 Mock 的快照隔离、Patch/Replace、晋级/回滚及 Secret 字段检查）。对账与剩余差异见 [页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。

- 环境编辑（名称 / 生产标记 / 自动发布）已提供 mock 实现（`updateEnvironment`），Backend `PATCH /environments/{id}` 合同尚未定义，接真实后端时需补齐。

- 默认数据量较小，第二十六轮补普通资源/节点/事件的本地分页，跨页交互使用创建 100 个 Mock 资源验证。虚拟滚动、服务端 `continueToken`、实际大集群性能与快照一致性尚未验收。
- 日志来自本地 fixture 和有限模拟追加，Pod 日志已使用原生 xterm/ANSI 与可视行渲染；未实现 NDJSON 流与断线重连。终端已有原生 xterm 输入/输出，会话仍为 mock（EX-02 / EX-03），真实实现需要一次性 ticket + WebSocket 通道。
- Manifest 支持编辑 → Dry run → 行级 Diff → Apply（写入本地 mock）；真实实现需要替换为服务端 dry-run 与 server-side apply。
- Secret 明文字段为 mock 值，读取会写一条 `secret.reveal` 审计；真实实现需独立授权与主密钥托管。
- 发布指标为确定性 mock 序列（24 个点），接入后来源是 metrics-server / Prometheus。
- 发布策略支持滚动 / 灰度（放量档位与逐档推进）/ 蓝绿（切流说明），灰度推进为 mock；真实实现需要 release 控制器配合。
- 日志支持容器切换、时间窗口与自动滚动（mock 过滤），未实现 NDJSON 流与断线重连。
- 写操作均已走本地 mock（环境覆盖、资源、平台设置、Secret/终端/指标），替换为真实 HTTP 时只需改 `src/api/index.ts`。
- `go:embed` 依赖 `web/dist`，`npm run build` 后才能 `go build`；`dist` 不入库。

## 两个 Manager 的概览页

`/apps/overview` 与 `/clusters/overview` 按本地 Devtron 源码对齐页头、指标卡和纵向图表布局；支持时间范围、图表切换、排行排序分页、刷新、健康明细和历史/节点跳转。数据仍来自现有 Mock。缺失扫描/GitOps、交付周期、恢复时间与效能评级保留为不可用；不可达集群不计入容量，缺失节点详情显示“未知”，历史接口的 50 条截断会提示。

两个概览统一归属现有 `/apps` 和 `/clusters` 路径体系，命名路由为 `apps-overview`、`clusters-overview`。顶部导航入口使用新地址；旧 `/application-management/overview`、`/infrastructure-management/overview` 及原命名路由仍可重定向，保留查询参数和锚点。概览布局由路由元信息识别，不会被误判为应用或集群详情工作区。

已补充简体中文本土化：页头和模块导航、概览指标、图表/图例、筛选排序、分页、空态/提示与健康明细统一中文；保留 DORA、CPU、GitOps、Kubernetes 等技术名词和真实资源名称。刷新时间使用本地时区的 24 小时制，构建耗时使用秒/分钟/小时，名称排序采用 `zh-CN`。状态仅在展示层转换，API 枚举和明细筛选值不变。

验证命令：`node scripts/check-management-overview-data.mjs`（23 项数值/日期/耗时）、`node scripts/check-management-overview-parity.mjs http://127.0.0.1:5197`（45 项生产预览交互、路由兼容与响应式）、`node scripts/check-management-overview-states.mjs http://127.0.0.1:5196`（19 项开发服务器隔离内存状态）。路由调整后生产构建及后两项共 64 项浏览器检查通过，零运行时错误和 Vue 警告；后两者分别连接预先启动的生产预览和开发服务器，保存截图与结果；详细范围与剩余差异见[页面对账文档](../docs/migration/04-devtron-layout-interaction-parity.md)。
