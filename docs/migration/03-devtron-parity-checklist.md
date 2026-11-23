# Devtron 迁移逐项对账清单

版本：V1.1 · 日期：2026-11-23 · 对照物：`docs/prototype/01-page-spec.md`、`docs/references/devtron-live/*`、`devtron-dashboard` 源码
状态：✅ 前端/Mock 已有 / 🚧 部分 / ❌ 缺失。✅ 不表示像素等价、真实后端或 Kubernetes 验收；本轮证据与剩余差异见 [布局与交互对账](04-devtron-layout-interaction-parity.md)。

> 用途：把"截图驱动"改成"清单驱动"。每轮开发按本清单自上而下清账，清完打勾并注明文件。

## 1. 应用详情（运行详情）`views/apps/AppResourcesView.vue`

| # | 功能点 | 参照 | 现状 |
| --- | --- | --- | --- |
| 1.1 | 环境条：ENV 选择 + 部署按钮 | 04 | ✅ |
| 1.2 | 环境条：复制链接 / 刷新 / 环境切换图标 | 04 | ✅ |
| 1.3 | Application Status 卡 + Details | 04 | ✅ |
| 1.4 | Deployment Status 卡 + Details（状态/时间/操作人） | 04 | ✅ |
| 1.5 | 状态抽屉：Application Status / Deployment Status 双页签 | 04 | ✅ |
| 1.6 | 状态抽屉：资源表 KIND/NAME/STATUS/MESSAGE + All/healthy 过滤 | 04 | ✅ |
| 1.7 | Monitoring 区块（CPU/Memory/2xx/3xx/5xx/Throughput/Latency） | 04 | ✅ |
| 1.8 | K8s Resources / Log Analyzer 同级页签 | 16 | ✅ 第四十轮补有 Pod 才显示、无 Pod 深链回退、资源页签返回和 Manifest 草稿保护 |
| 1.9 | 资源点开为应用内页签（不跳出应用） | 16 | ✅ |
| 1.10 | Deployment → ReplicaSet → Pod → Containers 层级 + 分组标题 | 16 | ✅ |
| 1.11 | Pod 的 New Pods / Old Pods 子页签 | 16 | ✅ |
| 1.12 | 每行按类型给操作（Manifest / Logs / Terminal / Events） | 16 | ✅ |
| 1.13 | Service 展示 URL 列 + ENDPOINTS / ENDPOINTSLICE 分组 | 16 | ✅ |
| 1.14 | 底部上下文条（Cluster / Namespace / All resources / Cluster terminal） | 16 | ✅ |
| 1.15 | Log Analyzer：工作负载多 Pod / 同名容器 / previous / 搜索 / 下载 | `LogAnalyzer.component.tsx`、`Logs.component.tsx`、`nodeDetail.util.tsx` | 🚧 第四十轮按工作负载/单 Pod 分组、同名容器聚合到单个 xterm 视窗，补暂停/清空/重连、自定义范围、逐源 grep 上下文、按 Pod 原文下载、缺容器跳过和部分读取失败；开发环境有双副本 fixture。仍为本地 Mock，真实 SSE/归档、完整 grep、全部状态像素验收待补 |

## 2. 资源浏览器（集群）`views/clusters/*`

| # | 功能点 | 参照 | 现状 |
| --- | --- | --- | --- |
| 2.1 | 集群列表 + 4 指标条 | 14 | ✅ |
| 2.2 | 工作区页签：Overview / 当前 Kind / 资源页签 | 15 | ✅ |
| 2.3 | Overview 页（集群元信息 + CPU/Memory 卡 + Readme） | 15 | ✅ |
| 2.4 | 左列表：Nodes / Events / Namespaces + 分类分组 | 16 | ✅ |
| 2.5 | Jump to Kind 搜索框（跳转 Kind） | `ResourceList/Sidebar.tsx`、16 | 🚧 第二十五轮补两处 Manager 的独立搜索浮层、重复 Kind/group 描述、短名称优先/文字高亮、键盘循环/Home/End/Enter、失焦清空；完整状态视觉仍待验收 |
| 2.6 | Kind 列表按类型不同列 | `ResourceList/K8SResourceList.tsx`、15/16 | 🚧 第二十四轮提供 19 组内置资源列与 Mock 动态附加列；任意服务端 Table、复杂 JSONPath 与全部字段待补 |
| 2.7 | Node 列表额外列 Roles/Version/Errors/Usage/Pods/Taints | `Constants.ts`、`ResourceList/ColumnSelector.tsx`、15 | 🚧 已有 12 项字段/用量条/列选择；第二十五轮补 Label/Node Groups/K8s Version 多选/草稿/Apply/chips、精确组合匹配、URL 深链恢复、同排工具栏及快捷键；版本独立接口和全部视觉状态待补 |
| 2.8 | Pod 列表额外列 Ready/Restarts/Node | 16 | ✅ |
| 2.9 | Deployment/StatefulSet 列 Ready、Updated、Available | 16 | 🚧 第二十四轮结构化解析 status/spec；缺失字段显示未知，仍需完整服务端 Table 字段 |
| 2.10 | Service 列 Type/Cluster-IP/Ports；Ingress 列 Hosts | 16 | ✅ |
| 2.11 | ConfigMap/Secret 列 Keys；PVC 列 Capacity/Access Modes | 16 | ✅ |
| 2.12 | Job/CronJob 列 Completions、Schedule、Duration、Last Schedule | 16 | 🚧 第二十四轮结构化解析已有 Manifest 字段；缺失显示未知，真实控制器状态待接 |
| 2.13 | 名称列复制按钮 + 行内 ⋮ 菜单 | 16 | ✅ |
| 2.14 | Events 聚合页 | `ResourceList/K8SResourceList.tsx`、16 | 🚧 第二十六轮补默认 Warning/Normal、URL 类型/搜索/排序分页、最近发生与计数排序；真实事件流/权限和全部视觉状态待补 |
| 2.15 | Namespace 列表页签 | 16 | ✅ |
| 2.16 | Create Resource（空白 YAML + Cancel/Apply + 逐项结果 + Edit YAML/Close） | `ResourceList/CreateResource.tsx`、20 | ✅ 第三十三轮前端 Mock：1024px 原生编辑器抽屉、直接应用、逐项创建/更新/失败、提交等待与关闭/路由拦截、返回编辑原文、关闭刷新/焦点与跨集群隔离；参考创建流程不要求先 Dry run，真实写入与全状态视觉仍待验收 |
| 2.17 | 集群终端 / 节点 Debug Mode | `ClusterNodes/ClusterTerminal.tsx`、16 | 🚧 第二十三轮补两行工具栏、分组节点/可创建 Namespace/镜像、bash/sh 与四项 URL、连接状态/历史/复制/全屏、Pod Events/Manifest/Review/重建与草稿保护；第三十九轮补共用 xterm/ANSI、光标与多行编辑/粘贴/历史、原生选择复制和尺寸重排。仅本地 Mock，可选下载、真实会话与服务端状态待补 |
| 2.18 | 节点详情页（Summary/YAML/Node Conditions + Cordon/Drain/Taints） | `ClusterNodes/NodeDetails.tsx`、15 | 🚧 第二十三轮补动作同排、独立滚动、元数据复制/显示全部、Pod 多列排序、原位 YAML Review/Apply 与动作草稿保护；概要与资源清单同步。完整节点字段/所有视觉状态与真实写入仍待对齐 |
| 2.19 | 切换集群清空旧集群页签 | spec `7.10 | ✅ |
| 2.20 | 同名 plural/Kind 跨 API group 导航与详情隔离 | `ResourceList/Sidebar.tsx`、`utils.tsx` | ✅ 第二十四轮覆盖两处 Manager 的树/计数/过滤、group URL、独立详情页签和删除；本地 Mock，真实任意 GVR 待接 |
| 2.21 | CRD 定义与自定义资源动态列 | `ResourceList/K8SResourceList.tsx` | 🚧 第二十四轮补 Group/Kind/Scope/Versions/Established 与两组同名示例的 printerColumns；完整动态 Table/JSONPath 待补 |
| 2.22 | 资源列表 URL 搜索/排序/分页与选择边界 | `ResourceList/K8SResourceList.tsx`、共享库 `useUrlFilters` / Pagination | ✅ 第二十六轮前端 Mock：1 起始页码、默认 100 条、按 Kind 默认排序、筛选回首页、完整匹配排序后分页、历史恢复、非法参数/末页删除回退、当前页选择和固定分页栏；真实服务端取数与大规模性能未验收 |
| 2.23 | 两个 Manager 共用动态资源页签、搜索列表与刷新 | `common/DynamicTabs/{DynamicTabs,DynamicTabsSelect,useTabs}` | ✅ 第二十七轮前端 Mock：固定入口/动态区域分离、活动项横向进入视野、搜索/直接关闭/键盘操作、当前资源刷新及草稿保护、最近访问回退和跨 Manager 保留详情页签/当前容器；访问历史仅本次会话，完整视觉状态仍待验收 |

## 3. 资源详情（共享组件）`components/resource/ResourceDetailPanel.vue`

| # | 功能点 | 参照 | 现状 |
| --- | --- | --- | --- |
| 3.1 | Manifest / Events / Logs / Terminal（Logs+Terminal 仅 Pod） | 17 | ✅ 第二十八轮补两处 Manager 详情页签/容器 URL、前进后退、清空页签存储后当前资源恢复与取消离开保持草稿 |
| 3.1a | 32px 页签/操作同排与按 Manager 区分删除 | `NodeDetail.component.tsx` | ✅ 第二十八轮前端 Mock：移除额外可见身份头、Manifest 操作紧随页签、重启同排、Infrastructure 删除靠右/Application 详情隐藏删除；扩缩容/Secret 明文保留更多入口，完整权限与全部视觉状态仍待验收 |
| 3.2 | Hide Managed Fields / Edit live manifest / Diff / Apply | 17 | 🚧 前端 Mock 已有完整 metadata.managedFields 隐藏、原位可编辑分栏、重新校验/应用读回、草稿保护及错误恢复；第三十一/三十二轮统一原生 CodeMirror 单栏/双栏，高亮、查找替换、折叠、撤销重做、编辑自动聚焦与虚拟渲染，第三十三轮创建抽屉也复用原生编辑器；第三十四轮扩展至应用配置/试运行/历史 YAML，第三十五轮共用内核扩展至 Dockerfile/Shell，第三十六轮补共用差异缩略图及 YAML 查找 Escape 焦点。补全、GUI/锁定字段与真实 dry-run/apply 待补齐；第三十七轮补共用 Vue/TDesign 查找/替换栏、命中计数、组合开关、原生多选区和快捷键 |
| 3.2a | Desired / Live Manifest 只读比较 | `NodeDetailTabs/Manifest.component.tsx` | 🚧 第二十九轮 Application 顶层资源入口、左期望/右实时、固定演示快照、噪声过滤、独立导出与异步隔离；第三十一轮升级原生 CodeMirror 双栏、对齐/高亮/折叠/查找/F7；第三十六轮补 30px 双栏差异缩略图、点击/拖动/键盘定位和标题/导出栏对齐。真实期望来源、服务端归一化、全状态视觉待补齐；第三十七轮补共用 Vue/TDesign 查找/替换栏、命中计数、组合开关、原生多选区和快捷键 |
| 3.3 | Secret 明文读取（授权 + 审计） | P2 | ✅ |
| 3.2b | 原生 YAML 语法诊断与比较模式切换 | 共享库 `EPe` / `W8` | ✅ 第三十八轮前端 Mock：单栏/创建/完整双栏的范围及末尾点诊断、重复键、多文档、Ctrl+Shift+M/F8；仅显示差异关闭诊断、完整模式恢复。任意资源 GUI/schema、服务端校验与真实权限保护仍待补齐 |
| 3.4 | Logs：容器 / previous / 范围 / 搜索 / 暂停恢复 / 下载 | spec `7.8`、`Logs.component.tsx` | 🚧 第十九轮前端 Mock：三类分组容器、独立上一实例、预设与四种自定义范围、字面 grep/上下文/管道、下载、Ctrl+C/暂停/滚动和容器深链；第三十九轮补 Pod 日志 xterm/ANSI/选择复制、可视行渲染、无换行横滚/自动换行和原文下载；第四十轮补独立多 Pod 分析器和逐源失败/下载，见 1.15。真实流/重连和完整 grep 语义待补齐 |
| 3.4a | Events：类型 / 原因 / 消息 / 次数 / 年龄 / 最近发生 | `EventsTable.tsx` | 🚧 已有深色六列、最新优先、固定表头与交错行、懒加载/刷新/空态；缺失首次时间显示占位，真实事件流与权限仍待接入 |
| 3.4b | Pod Terminal：连接 / 容器 / Shell / 清屏 / 全屏 | `Terminal.component.tsx`、`terminal/`、`CopyToast.tsx` | 🚧 第二十二轮共用 Vue 3 + TDesign 工具栏、三类容器/四种 Shell、连接/断开/重试/过期/离线、上下文全屏/Esc/焦点；第三十九轮补 xterm/ANSI、光标与多行编辑、粘贴/续行/历史、原生选择复制、清屏和尺寸重排，保留不可用拦截与迟到会话清理。仍为本地字面 Mock；动态临时容器、超时/并发限制、可选下载、真实 exec 和全部视觉状态待补齐 |
| 3.5 | Deployment 的 Scale / Restart 显式确认 | spec `7.7 | ✅ |
| 3.6 | Pod 行内快捷 Manifest/Logs/Terminal/Events | 16 | ✅ |

## 4. 构建 / 发布 / 配置 / 历史

| # | 功能点 | 参照 | 现状 |
| --- | --- | --- | --- |
| 4.1 | 构建部署流程图（Source → CI → 多 CD + AUTO） | 05 | ✅ |
| 4.2 | Select Material / Select Image 抽屉 + Review | 05 | ✅ 前端 Mock；逐仓库提交/搜索/刷新与全选齐校验；第十五轮补正则分支设置与 Webhook 过滤/选材/接收详情；第二十一轮补共用提交/PR/Tag 链接、复制、键盘与选择隔离、路径排除/显示隐藏/空态。完整 Provider、PR 策略、真实接收与规则一致性待补齐 |
| 4.3 | 发布策略（滚动/灰度/蓝绿） | P2 | ✅ |
| 4.4 | 构建历史（左记录右详情 + 按 CI 切换 + URL 上下文 + 日志 + 取消/重试） | 12、共享库 `CICDHistory/{LogsRenderer,LogStageHeader}` | ✅ 前端 Mock；逐仓库源码/构建配置快照、重试与共用日志，第二十一轮补提交/事件链接与完整 SHA 复制；第四十一轮补 STAGE_INFO 分段、状态/有效耗时/快照平台、ANSI 文本样式、虚拟可视行/吸顶标题、全部折叠/E、屏幕外匹配定位和滚动锚点。真实流/归档、任务文件、其他源码入口和全状态像素验收待继续 |
| 4.4a | 构建/阶段共用日志查看器 | 共享库 `LogsRenderer`、`Scroller`、`LogResizeButton` | 🚧 已有安全文本高亮、Enter/Shift+Enter、顶部/底部、手动滚动暂停、展开/Escape、原文下载与阶段任务 URL 恢复；第四十一轮已补 ANSI、STAGE_INFO、多节全部折叠/E、虚拟列表/吸顶标题与屏幕外匹配。真实流/归档/产物 ZIP 和全部状态视觉待继续 |
| 4.4b | 源码与镜像详情、Release tags / 备注 | 共享库 `ArtifactInfoModal`、`Artifacts`、`ImageCard`、`GitCommitInfoGeneric` | 🚧 第二十/二十一轮前端 Mock：800px 源码/镜像抽屉、完整引用/Digest/SHA 复制、历史与镜像选择共用、PR/Tag/分支链接、跨入口元信息与草稿保护。标签治理/权限、完整 Provider/PR 元数据与真实镜像数据待补齐；当前共享源码组件无文件 Diff UI，其他入口另核对 |
| 4.5 | 发布历史（状态/镜像/配置版本 + 晋级/回滚/未知核对） | 13 | ✅ 前端 Mock；独立配置快照、三类配置查看和当前配置对比，源码使用关联构建记录及共用提交/事件展示，缺失历史字段明确展示；完整状态与 Provider 策略待继续 |
| 4.6 | 配置五节（Git/构建/基础/工作流/覆盖）+ 版本与冲突 | 07–09 | ✅ |
| 4.7 | 基础配置 GUI/YAML 双模式 | 08 | ✅ 前端 Mock；完整 YAML 解析、原文/注释回读、GUI 定点更新和单一保存操作 |
| 4.7a | 部署模板继承、独立覆盖、Patch/Replace 预览、创建/删除/取消/离开确认 | `DeploymentTemplate/` | ✅ 前端 Mock；第三十四轮统一原生 YAML 高亮/折叠/查找替换/撤销重做、长文档虚拟渲染与完整原文回读，继承/合并/试运行只读；完整 Helm 渲染、服务端 Patch/保护规则待补齐 |
| 4.7b | Values schema 校验、字段补全与悬浮说明 | `DeploymentTemplateForm`、共享库 `vPe` | 🚧 第三十八轮前端 Mock：现有 Values 契约的类型/范围诊断、根字段/嵌套首字段/空行补全、类型/说明、原生插入/单步撤销、只读禁用候选；普通 ConfigMap/Secret 不套用 Chart schema，隐藏 Secret 清理诊断与私密消息。真实 Chart schema/版本目录、完整 GUI schema、权限及审批保护待接入 |
| 4.8 | Git 多仓库独立新增/编辑/过滤/克隆目录/子模块/删除确认 | `material/MaterialView.tsx` | ✅ 前端 Mock；已改用参考页面的逐仓库保存，取消旧版下一步按钮 |
| 4.9 | 构建配置三种方式、源码/上下文仓库、高级参数与底部「保存配置」 | `ciConfig/CIDockerFileConfig.tsx` | ✅ 前端 Mock；第十六轮补多平台、Secrets/SSH、Buildpacks 联动；第十七轮补托管 Dockerfile 工具栏、语言/框架模板切换与缓存/重置、复制及失败/竞态处理；第三十五轮升级 300px 浅色原生 Dockerfile 编辑器、高亮/查找替换/撤销重做/虚拟渲染与上下文历史隔离，继承只读可查找。实时目录、补全/其余上游工具栏与扩展版 Secrets UI 仍待核对；第三十七轮补共用 Vue/TDesign 查找/替换栏、命中计数、组合开关、原生多选区和快捷键 |
| 4.9a | 流水线逐仓库固定/正则分支、允许/删除构建覆盖 | `ciPipeline/SourceMaterials.tsx`、`CIPipelineN/AdvancedConfigOptions.tsx` | ✅ 前端 Mock；独立构建表单、有效配置触发、保存回读、版本冲突、引用仓库删除保护；第十五轮补 Webhook/具体分支；第十六轮补平台与两类引用；第十七轮补托管模板只读继承、独立覆盖/删除、保存基线与根路径历史快照；完整上游扩展组件待继续 |
| 4.10 | Base / Environment 的 ConfigMaps / Secrets 逐条配置 | `Shared/ConfigMapSecret/` | ✅ 前端 Mock；继承/覆盖/Patch/Replace、GUI/YAML、资源来源与挂载表单、清单预览和草稿保护；ESO/外部 Provider/保护审批等仍待补齐 |
| 4.10b | ConfigMap / Secret 键值表与批量编辑 | `ConfigMapSecretData`、共享库 `KeyValueTable` | ✅ 前端 Mock；键名编辑/稳定行、排序、空键/重复键/非法字符校验、GUI/YAML 切换保护、Secret 草稿显隐、遮蔽复制、注释与多行保存回读；第三十四轮 YAML 统一原生编辑器、固定高度/查找/全文复制与显隐撤销历史隔离。真实权限/Secret 明文不在本地实现中 |
| 4.10a | 环境配置对比（部署模板/ConfigMaps/Secrets/Manifest） | `DeploymentConfigCompare/`、共享库 `DeploymentConfigDiff` | 🚧 前端 Mock 已有独立路由、两侧环境/版本/文件 URL、当前保存/当前部署/历史快照、文件搜索/排序/过滤与 GUI/YAML；原生只读双栏、查找/F7、同步滚动、30px 缩略图和未改范围折叠。第四十二轮补 Configuration/Manifest、单个 Manifest Output、环境/Chart 默认值分组、默认独立版本和本地清单示例；第四十三轮补 Show/Hide variables value、原始引用/解析值差异重算、URL 恢复与历史独立解析快照，Manifest 使用当次解析值；Secret 保持遮蔽。受保护草稿/已发布/审批版本、完整变量作用域/管理/敏感值、真实 Chart 历史/Helm 渲染与全部状态像素验收仍待补齐 |
| 4.11 | 管线编辑抽屉（前置 / 主阶段 / 后置） | 09、`CIPipelineN/` | 🚧 前端 Mock 已有内嵌目录、Shell/Container、示例插件版本、类型化输入输出与引用、条件、排序/移动和草稿保护；CD 阶段独立触发、配置引用与执行环境、worker 禁用/修复已实现；第九轮增加独立运行节点、镜像触发、历史/多任务日志、取消重试和快照；第三十五轮 CI/CD 前后置与容器脚本共用 300px 原生 Shell 编辑器、高亮/查找替换/撤销重做/千行完整保存及任务历史隔离，修复查找 Escape 误关抽屉。完整插件目录/治理、运行时参数、Live 日志及产物文件仍待对齐，不执行真实任务 |
| 4.11a | 容器命令/参数、脚本/源码/主机挂载、端口与产物路径 | `CIPipelineN/{TaskTypeDetailComponent,MultiplsPort,MountFromHost,OutputDirectoryPath}.tsx` | ✅ 前端 Mock；逐行增删、开关、校验、保存回读/取消与旧配置兼容，不执行容器 |
| 4.11b | CD 前后置阶段 ConfigMap/Secret 引用 | `CIPipelineN/Sidebar.tsx`、`cdPipeline/CDPipeline.tsx` | ✅ 前端 Mock；目标环境有效配置、多选搜索/移除、阶段隔离、失效提示与保存校验，不注入真实资源 |
| 4.12 | 构建发布图：顶部流水线名称下拉快速切换 | 05/10 | ✅ |
| 4.13 | 构建发布图：节点 ⋮ 支持编辑流水线 / 历史 | 10 | ✅ |
| 4.13a | 构建发布与工作流共用同一关系图组件（布局/状态/操作一致） | 05/10 | ✅ |
| 4.13b | 图按「一条工作流一行」：一个源 → 一个构建 → N 个环境部署竖向栈（源/构建与部署栈垂直居中同线） | 05/06 | ✅ |
| 4.13c | 多工作流支持：每个 CI 链一行；无 CI 的镜像部署单独一行 | 05/06 | ✅ |
| 4.14 | 流水线模板仅保留「源码构建部署」「镜像部署」两种 | 05 | ✅ |

## 5. 平台与横切

| # | 功能点 | 现状 |
| --- | --- | --- |
| 5.1 | 操作记录 / 设置（成员、集群、环境、凭据、仓库） | ✅ |
| 5.2 | 登录 + mock 会话 | ✅ |
| 5.3 | 全局搜索（应用/集群/项目，/ 聚焦） | ✅ |
| 5.4 | Chart Store / 应用模板 | ❌ 已标注延期 |
| 5.5 | DORA / 成本报表 | ❌ 缺数据源 |
| 5.6 | 应用创建/克隆抽屉与身份表单 | ✅ 第十三轮前端 Mock；1024px 抽屉、250px 方法栏、卡片选源/搜索/返回、项目上下文、30 位名称/350 位描述、键值标签与传播元数据、草稿保护和创建后导航；企业模板/强制标签策略/真实权限与传播仍待补齐 |
| 5.7 | 应用概览档案、标签/项目编辑与说明 | ✅ 第十四轮前端 Mock；描述内联、800px 标签抽屉与旧标签保留、600px 项目弹窗及权限影响提示，移动项目同步路由与切换目录；Markdown 页内编辑/预览与草稿保护。强制标签、真实权限/传播和企业区块仍待对齐 |
| 5.8 | 概览环境页签、排序与镜像/提交详情 | ✅ 前端 Mock；第十四轮补页签/排序 URL、完整镜像名、历史深链与无环境继续配置；第二十/二十一轮补 800px 源码/镜像抽屉、统一元信息编辑和共用提交/事件链接与复制。完整标签治理、Provider 策略与逐状态视觉待继续 |

## 清理计划（按优先级）

| 批次 | 内容 | 状态 |
| --- | --- | --- |
| B1 | 2.5 Jump to Kind、2.6–2.12 按 Kind 列、3.4 Logs 容器/previous/行数/暂停 | ✅ 已完成 |
| B2 | 1.7 Monitoring 区块、1.15 Log Analyzer 容器/Live、2.16 Create Resource 抽屉化 | ✅ 已完成 |
| B3 | 4.7 基础配置 YAML 双模式、5.3 全局搜索 | ✅ 已完成 |
| B4 | Chart Store、DORA/成本 | 延期 |

## 6. 业务交互补全（对照 devtron-dashboard 源码二次盘点）

参照：appDetails/sourceInfo/EnvironmentSelector、RotatePodsModal、ScaleWorkloadsModal、k8Resource/nodeType/PodPopup、NodeDelete、nodeDetail

| # | 交互 | Devtron 出处 | 现状 |
| --- | --- | --- | --- |
| 6.1 | Restart workloads（勾选工作负载后重建 Pod） | RotatePodsModal | ✅ |
| 6.2 | Hibernate / Unhibernate（副本缩 0 / 恢复） | ScaleWorkloadsModal | ✅ |
| 6.3 | Delete release（输入应用名二次确认） | EnvironmentSelector | ✅ |
| 6.4 | Pod 行 ⋮：Check vulnerabilities（CVE 列表） | PodPopup | ✅ |
| 6.5 | Pod 行 ⋮：View Events / View Container Logs / Delete | PodPopup | ✅ |
| 6.6 | 工作负载行 ⋮：重启 / 扩缩容 | k8Resource 行操作 | ✅ |
| 6.7 | 节点行 ⋮：Cordon / Uncordon、Drain | nodeDetail | ✅ |
| 6.8 | 资源行 ⋮：查看日志（Pod） | k8Resource | ✅ |
| 6.9 | 外部监控 Links 列（Grafana/Kibana 等） | NodeLevelExternalLinks | ⏸ 依赖环境外链配置，暂不做 |
| 6.10 | Helm release Notes 只读抽屉（源组件不编辑应用说明） | NotesDrawer | ✅ 只读抽屉、Mock 取数与清理后的 Markdown 渲染；真实 Helm 数据待对接 |
| 6.11 | 资源列表批量勾选 + 批量删除 | NodeDelete 批量 | ✅ 本地 Mock 回写，含失败重试 |
| 6.12 | 应用列表 Clone / Delete app | app 列表、`Pages/App/CreateAppModal/` | ✅ 克隆预选来源、卡片列表按分页读完、归档/失效来源拦截、跨项目创建与最新配置副本；名称确认归档与刷新。Mock 不复制流水线/环境绑定/配置条目/执行历史 |
