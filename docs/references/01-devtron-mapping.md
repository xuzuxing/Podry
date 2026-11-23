# Devtron 参考范围与差异

> 2026-11-22 当前决定：Application Management 与 Infrastructure Management 的 K8s 资源管理按用户提供的本地 Devtron 复刻布局和交互。下文的中文简化与首版延期取舍为历史记录，已被 [当前复刻方案](../migration/01-devtron-to-vue-plan.md) 覆盖。新一轮实施证据见 [布局与交互对账](../migration/04-devtron-layout-interaction-parity.md)。

调研日期：2026-11-19，补拍：2026-11-20。首轮为官方文档与公开源码静态阅读；随后登录用户测试实例，采集 27 张只读截图，新应用目录首次 26 张，补拍构建、镜像、部署与资源页面 18 张，现共 44 张。业务参考与现场证据以 [只读观察](devtron-live/README.md) 和 [新应用完整流水线实测](devtron-onboarding/README.md) 为准，公开源码仅作设计背景。当前页面于 2026-11-20 进行了中文团队适配，布局和操作入口以 [中文团队适配](../prototype/04-localization.md) 为准；保留以下历史观察事实用于溯源。

2026-11-20 后续补充：用户提供本地后端源码 `D:/workspace/devtron`，提交同为 `cebc4158bd9faa913b8d5071fa6425f61aa5c9ca`。已进一步静态核对 CI 执行器、产物交接、CD/Helm、动态资源、发布恢复及持久模型，形成 [后端源码映射与取舍](../backend/04-devtron-source-mapping.md)，并并入 B0–B6 任务。本地源码没有启动或修改，测试实例是否运行相同提交仍未核定；截图、静态调用和 Podry 实施验收分别记录。

## 1. 参考源

- 后端仓库：<https://github.com/devtron-labs/devtron>，本次读取 main 的 `cebc4158bd9faa913b8d5071fa6425f61aa5c9ca`。
- 前端仓库：<https://github.com/devtron-labs/dashboard>，本次读取 develop 的 `ecea7af01c628e0b60720e53fe969e204cdbe8ef`。
- 应用配置：<https://docs.devtron.ai/docs/user-guide/creating-application>。
- 工作流：<https://docs.devtron.ai/docs/user-guide/creating-application/workflow>。
- Resource Browser：<https://docs.devtron.ai/docs/user-guide/resource-browser>。
- 资源操作：<https://docs.devtron.ai/docs/user-guide/resource-browser/manage-resources>。
- 节点操作：<https://docs.devtron.ai/docs/user-guide/resource-browser/nodes>。
- Kubernetes API 语义：<https://kubernetes.io/docs/reference/using-api/api-concepts/>。
- client-go：<https://github.com/kubernetes/client-go>；BuildKit：<https://github.com/moby/buildkit>。

这些地址用于溯源，不是依赖锁文件。开发时需要重新核对支持版本与兼容性，不使用“最新版本”作为未经验证的约束。

## 2. 源码定位

| 源码路径 | 参考用途 |
| --- | --- |
| dashboard `src/Pages-Devtron-2.0/ApplicationManagement/ApplicationManagementRouter.tsx` | 应用管理路由、配置与扩展入口 |
| dashboard `src/Pages/Applications/DevtronApps/Details/AppConfigurations/` | 基础配置、环境覆盖、部署配置组织 |
| dashboard `src/Pages/App/Configurations/WorkflowEditor/` | CI/CD 工作流编辑与配置步骤 |
| dashboard `src/components/ResourceBrowser/ResourceBrowserRouter.tsx` | 集群列表与详情路由 |
| dashboard `src/components/ResourceBrowser/ResourceBrowser.service.tsx` | 动态资源、Namespace、Node 取数 |
| dashboard `src/components/ResourceBrowser/ResourceList/` | 资源分类、列表、动态详情、操作菜单 |
| devtron `api/router/app/pipeline/configure/PipelineConfigRouter.go` | 配置、构建、历史、产物、日志等端点组织 |
| devtron `api/router/app/pipeline/trigger/PipelineTriggerRouter.go` | 发布、启停和 Pod 轮换入口 |
| devtron `pkg/pipeline/`、`pkg/appWorkflow/`、`pkg/cluster/` | 交付编排、工作流、集群服务的业务划分 |

## 3. 对照与取舍

运行时已确认：配置和执行分入口、配置二级菜单、创建/提交/镜像/管线编辑的大抽屉、左列表右详情的历史页面，以及应用和集群各自保留上下文的资源页签。首次新应用观察实际创建测试应用、保存配置、运行过临时 CI，并按用户要求替换成 Build & Deploy from Source Code 完整工作流；2026-11-19 结束时受 Git 超时阻塞。2026-11-20 只读补拍已观察到完整 CI #4 / build #6 成功，以及已有 CD #3 发布由 In progress 转为 Succeeded，1 个健康 Job 和 2 个已完成 Pod；补拍没有触发构建或部署。没有资源浏览器写入或远程终端。实际部署版本和 edition 未核定。

| Devtron 参考能力 | Podry 方案 |
| --- | --- |
| 应用配置、构建、环境部署 | 首版核心范围，按 Vue + Go 实现 |
| 连接式 CI/CD 工作流 | 首版固定一 CI 多 CD，后续扩展复杂编排 |
| 新应用 0/4 引导与模板 | 主流程 Build & Deploy from Source Code，原子创建 CI/Binding/CD；禁止默认生成环境 |
| Job & CronJob 基础 Chart | Podry 支持一次性应用 Job；CronJob 调度与独立 Job 流程平台后续评估 |
| 环境覆盖与发布历史 | 首版固定配置快照、digest、目标环境覆盖 |
| 资源浏览与 YAML/事件/日志/终端 | 首版保留集群、资源列表、Manifest、Events、Pod Logs；Terminal 与资源写入后续接入，与应用运行资源共用 |
| 节点管理 | 首版查看；Cordon/Drain 等后续独立授权设计 |
| Argo/GitOps 等执行集成 | 首版使用 Kubernetes Job + Helm，不要求安装同套依赖 |
| 模板、策略、AI、集群比较等 | 动态组件和开关依赖需逐项核对，后续评估 |
| React 前端与公共组件库 | 不直接移植，复用交互概念、独立实现 Vue 组件 |

本次没有完整核对各功能的商业版本授权边界，不将代码里的开关或动态加载直接解释为免费/付费归属。若后续复用源码或资产，先核对具体文件的 LICENSE、NOTICE 与分发要求；前端组件独立重写；本轮背景资产的来源和许可证见 `web/brand-spec.md`。

## 4. 本仓库差异

本目录是本次方案的设计基线。当前代码使用 chi，前端请求层已集中到 `web/src/lib/request`，存在未提交改动。旧的 Gin 规划、数据库示例或历史原型不能当成当前实现。首轮离线原型已归档，V2 按测试实例的交互结构重做，仍不接入 `web/` 工程。

新增文档和离线原型不等于后端复刻完成，真实功能以里程碑的后端与集群证据为准。
