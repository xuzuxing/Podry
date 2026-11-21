# Vue 3 + TDesign 工程原型

日期：2026-11-20。将已确认的 V2.1 Devtron 交互迁入当前 `web/` 工程，业务后端仍为 Mock。旧单文件原型和真实截图保留为对照。

> 历史记录：本文描述此前的 Vue 原型实现与验证方式。当前 Devtron → Vue 迁移按 `web/` 为 Vite + Vue 3 空工程处理，首版范围、菜单和路由以 [轻量化迁移方案](../migration/01-devtron-to-vue-plan.md) 为准；本文不构成当前实现前提。

最新版本按 [中文研发团队适配](04-localization.md) 调整：152px 中文导航、常驻筛选、代码构建与环境发布工作台、简化弹窗与抽屉；流水线关系图仅用于配置。Devtron 提供业务参考，CloudBase 提供配色参考。变量集中在 `styles.css`，`PrototypeApp.vue` 负责导航外壳。Git → Build → Deploy 全流程保留，具体尺寸与反馈见 [视觉规范](brand-spec.md)。

## 实施结构

- 复用当前 Vue 3、TypeScript、Vite、TDesign 按需加载、Pinia 和 axios RequestClient，不新增第二套依赖。
- 新增 `web/prototype.html` 独立入口，使用自己的 Vue Router、Pinia 和样式。现有 `index.html`、登录页、首页、用户状态与路由守卫继续使用各自入口。
- 入口只负责初始化，页面只编排组件。应用、配置、流水线、执行历史、资源浏览器各自拆分。
- 请求通过独立 API 模块和 DTO；MSW 接管请求，模拟数据、校验和状态推进集中在 Mock 层，组件不直接修改 Mock 数据。
- 开发默认 Mock；显式原型构建也保留 Mock，可使用静态服务器预览。普通生产构建不生成原型入口、不打包这些 Mock。切换真实接口前须补齐认证和未实现的合同。

## 组件边界

| 组件 | 职责与通信 |
| --- | --- |
| PrototypeApp / PrototypeLayout | Provider、主导航、工作区容器；路由提供页面 |
| ApplicationList / CreateApplicationDrawer | 列表常驻项目/状态筛选；创建组件使用居中 Dialog，通过 created 事件通知列表，按来源进入代码或部署模板配置 |
| ApplicationWorkspace | 加载应用与配置、应用页签；向子组件传递 appId |
| ConfigurationPanel | Git / Build / Base 独立表单、前置锁与进度；保存调用 store |
| WorkflowCanvas / WorkflowDrawer | 组织工作流及分支、完整模板、追加 CD；加载业务状态并处理操作 |
| WorkflowNode | 纯展示节点，接收 kind/name/subtitle/status/editable/disabled；通过 configure 事件请求编辑，默认 slot 放执行按钮 |
| DeliveryWorkbench | 构建上下文与环境发布列表；props 接收状态与目标，emits 请求构建/发布/记录/配置，不请求 API |
| ExecutionDrawer | 选择提交、选择镜像、Review 和确认；关闭销毁未提交选择 |
| ExecutionHistory | 左记录右详情，日志、快照、重试、取消与核对 |
| ApplicationResources | 保留应用与环境上下文；复用资源工作区 |
| ClusterList / ResourceWorkspace | 集群入口、Kind/Namespace 筛选、去重页签；appId 可限定资源范围 |
| ResourceDetail / ResourceActionDrawer | Manifest、事件、日志、模拟终端、Diff 及显式动作 |
| DemoControls | 角色、网络、执行结果、日志保留的演示控制，只修改 Mock 场景 |

状态采用 Pinia；派生进度、资格和筛选使用 computed；轮询、请求与未保存离开保护使用 composable 并在卸载时清理。所有 SFC 使用 `<script setup lang="ts">`。

实际文件：页面在 `web/src/prototype/views/`，业务组件在 `web/src/prototype/features/`；API 为 `web/src/api/modules/platform.ts`，DTO 为 `web/src/api/types/platform.ts`，Store 为 `web/src/stores/modules/platform.ts`。`PrototypeApp` 同时承担独立原型的轻量外壳。原计划中的 PrototypeLayout 不再额外拆出一层。

## 运行与构建

在 `web/` 下执行：

```powershell
npm run dev:prototype
```

默认使用现有 Vite 端口 5173，打开 `/prototype.html`。Hash 后保留原有应用和资源工作区路径。已有 dev server 占用端口时可执行 `npm run dev:prototype -- --port 5177`，或在原有 dev server 直接访问这个入口。

独立演示产物：

```powershell
npm run build:prototype
npm run preview:prototype
```

产物目录为 `web/dist-prototype/`，需要通过 localhost 或 HTTPS 的静态服务器访问。Hash 路由无需服务器做深层路径回退；HTML、assets 和 mockServiceWorker.js 必须一同托管。Mock 数据保存在当前页面内存，刷新重置，不能作为持久化数据源。

普通 `npm run build` 只输出原 `index.html` 到 `dist/`；不将原型入口和原型处理器加入产品包。原型使用显式 TDesign 组件导入和类型，避免依赖上一次按需构建产生的全局组件声明；现有产品入口继续使用原来的自动导入约定。为保证独立入口样式完整，原型加载 TDesign 样式，后续可再优化样式体积。

原型使用独立的 `web/vite.prototype.config.ts`，继承现有 Vite 插件和别名，仅指定 `prototype.html` 与 `dist-prototype/`。产品配置保持当前工作区版本；原型的 dev/build scripts 显式选择独立配置。中文状态、环境别名和时间在 `utils/display.ts` 映射，不翻译接口枚举与资源身份。

## 当前覆盖

| 模块 | 工程版交互 |
| --- | --- |
| 应用 | 搜索、项目 Filter、创建、可选克隆配置，独立新应用进度 |
| 配置 | 内嵌 Git、样例填充、Build 相对路径校验、Deployment/Job、分节保存、配置版本、GUI/受控 YAML、离开未保存提示 |
| 工作流 | 空态、模板选择、完整 Build + Deploy、仅构建、外部镜像、显式追加环境、手动 CI/CD 编辑、环境覆盖 |
| 构建 | 完整 SHA 选择、错误/无结果禁用、启动、左记录右详情、日志可用性、取消和保留输入重试 |
| 发布 | 当前应用镜像、digest、预览、名称确认、版本检查、历史快照、晋级/回滚、新 Job 执行警告、未知结果占用与 Mock 核对 |
| 应用资源 | 按绑定环境定位、Job Complete / Pod Succeeded、应用上下文保留、显式跳转全局浏览器 |
| 资源浏览器 | 集群、Kind、Namespace、名称筛选、全宽去重页签、Manifest/事件/Pod 日志、受控修改、扩缩容、重启、删除、ConfigMap 创建 |
| 演示与审计 | 操作员/只读、空数据/离线、成功/失败/发布未知、日志归档切换、写操作审计 |

资源页签、Kind、Namespace 和详情子页签映射到 Hash query；页面内保留多个打开的资源，切换集群清空上下文。刷新后 Mock 资源 ID 会重建，因此旧资源 query 无法作为持久化书签，界面会退回列表。

## 模拟与真实接入边界

- `api/modules/platform.ts` 是所有原型业务调用出口，复用既有 `RequestClient`。页面通过 Store 或该 API 模块获取数据，不 import `mocks/data`。纯 Manifest 展示器为独立工具，由 UI 与 Mock 共同使用。
- 独立入口始终注册自己的 `prototype-browser.ts`，不复用现有首页的样例 `/apps` handler；两个入口的内存数据和 Pinia 互不共用。注册失败显示启动失败，不回退到真实 API。不要在这条原型入口配置真实 API 地址。
- Mock 使用 `/api` 下的业务路径，但 DTO 是设计合同的简化子集，不是全部 76 个 HTTP 操作的实现；尚未实现完整分页、团队/项目/凭据/RBAC 管理、Webhook、真实日志流、Helm/Job 调度和 Kubernetes 授权。流水线编辑当前只保存名称与手动策略；自动触发和插件阶段明确标为后续范围。
- `/api/prototype/settings` 与 `/api/prototype/deployments/{id}/reconcile` 只控制演示。真实核对必须读取实际 worker/集群观察结果，不能复用 Mock 的“改成 succeeded”。当前镜像 digest、Git 提交、日志和资源身份全部是合成数据。
- 资源 YAML 不是通用解析器：已有 Deployment 仅编辑 replicas，已有 ConfigMap 仅编辑 LOG_LEVEL；新资源仅接受展示的单份 ConfigMap 模板，其他字段变化被拒绝。Secret 始终脱敏。终端只处理 help / clear / status，不打开 exec session。
- 真实接入建议从现有产品入口挂入这些页面，复用其用户态与路由守卫；将业务 API 调用对齐 `docs/api/openapi.json`，补齐认证和授权，再逐个移除对应 Mock。保留视图、表单、画布和资源组件，替换模拟状态推进与协议适配层。不要把“接口路径相似”理解为只改开关即可投产。

## 交互与视觉基线

53 张 Devtron 截图用于业务对照；当前布局按中文团队习惯调整。桌面 152px 中文导航，1120px 及以下折叠为 64px，720px 以下为 48px；工作区头部 48px、应用页签 36px。日常构建发布使用左右工作台，配置保留关系图，历史保留左记录右详情，资源保留动态页签。新建应用用居中弹窗，简单流水线编辑为 560px 抽屉；需展示镜像或 YAML 差异时保留宽抽屉。正文 13px，控件/节点/抽屉圆角 4/8/12px，主色 `#0052d9`。保留悬停、按下、键盘轮廓和减少动态效果支持；完整源码构建并部署链路不变。

## 验证要求

类型检查、普通生产构建、独立原型构建；浏览器验证新应用 0/4 → 配置 → 完整模板 → Build → 镜像 → Deploy，以及资源页签、写入 Review、只读、失败、未知结果恢复。截图与报告单独记录，不能把旧 HTML 原型的 36 项通过结果用于证明 Vue 版本。

本次已通过 27 项 Vue 浏览器检查，见[验证记录](../delivery/03-vue-validation.md)和[机器报告](../delivery/vue-prototype-check.json)。重跑时先在终端 1 启动 `npm exec vite -- preview --outDir dist-prototype --host 127.0.0.1 --port 5176 --strictPort`，再在终端 2 运行 `npm run check:prototype`。可用 `PODRY_PROTOTYPE_URL` 指定服务地址，`PODRY_CHROME` 指定 Chrome 路径。

反馈另运行 `node scripts/check-prototype-feedback.mjs`，在同一独立产物上验证中文工作台的环境入口、配置节点悬停、键盘聚焦、点击名称编辑、抽屉圆角、36px 页签及减少动态效果设置。结果与截图见 [反馈报告](../delivery/vue-feedback-check.json) 和 [截图索引](vue-screenshots/README.md)。
