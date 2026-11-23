# Devtron 布局与交互对账

日期：2026-11-23。当前方向：在现有 `web/` 继续补充 Application Management，以及 Infrastructure Management 的 Kubernetes 资源管理；布局与交互有冲突时以用户提供的 Devtron 为准。

这是已有页面的持续补齐，不是“全部 Devtron 功能已完成”的声明。用户已明确接口接入暂缓，继续优先对齐页面。前端目前全部使用本地 Mock，没有连接 Podry 后端或真实 Kubernetes 集群。

## 对照证据

- 本地参考：`D:/workspace/devtron-dashboard`，提交 `ecea7af01c628e0b60720e53fe969e204cdbe8ef`。
- 实例截图：`docs/references/devtron-live/`、`docs/references/devtron-onboarding/`。截图与本地源码的 edition/部署版本不保证相同，优先使用用户指定源码，截图辅助检查布局。
- 参考仓库只读；没有安装、运行或修改参考工程，没有对远程 Devtron 实例执行操作。

| Devtron 源码 | Vue 实现与本轮行为 |
| --- | --- |
| `components/Navigation/{Navigation,NavItem}.tsx`、`constants.ts`、`styles.scss` | `components/navigation/ManagerNavigation.vue`；两个 Manager、64px 轨道、224px 悬停/聚焦子菜单、菜单搜索、Escape/外部点击关闭 |
| `components/app/details/AppHeader.tsx` | `layouts/AppShell.vue`、`AppWorkspaceLayout.vue`；单一 48px 页头、面包屑和操作 Teleport，保留应用七个页签 |
| `components/app/list-new/AppListFilters.tsx` | `ApplicationFilters.vue`、`useApplicationList.ts`；两栏筛选器、多选/移除条件、搜索、URL 恢复、同一个 Binding 内匹配环境/集群/Namespace、CSV 导出 |
| 应用列表创建/克隆/删除入口 | `ApplicationTable.vue`、`CreateApplicationDrawer.vue`、`DeleteApplicationDialog.vue`；行内克隆预选来源，删除必须输入名称，归档后刷新列表 |
| `Pages/App/CreateAppModal/{ApplicationInfoForm,CloneApplicationSelectionList,Sidebar,HeaderSection}.tsx`、`AppClone/AppCloneList.tsx` | `ApplicationIdentityForm.vue`、`ApplicationTagsEditor.vue`、`CloneApplicationList.vue`、`useApplicationCreation.ts`；1024px 创建抽屉、250px 方法栏、可搜索克隆卡片、返回与草稿保留、项目/名称/描述/标签表单及创建后导航 |
| `components/app/Overview/{Overview,TagChipsContainer,EnvironmentList}.tsx`、`details/{AboutTagEditModal,AboutAppInfoModal}.tsx` | `overview/{ApplicationProfile,ApplicationReadme,ApplicationMetadataOverlays,OverviewEnvironmentTable}.vue`、`useApplicationOverview.ts`、`useApplicationMetadata.ts`；内联描述、800px 标签抽屉、600px 项目弹窗、Markdown 编辑/预览、URL 页签/排序和镜像/源码详情 |
| `components/ResourceBrowser/ResourceList/{Sidebar,ClusterSelector,ColumnSelector}.tsx` | `K8sKindTree.vue`、`ClusterWorkspaceView.vue`、`ResourceListTable.vue`；分组 Kind、Jump to Kind、集群/Namespace 选择、搜索、排序、列选择、批量选择与删除 |
| `ResourceList/{NodeActionsMenu,DeleteResourcePopup}.tsx` | `ResourceActionDialog.vue`；删除名称确认、Force delete、重启、扩缩容、Cordon/Uncordon、Drain、Taints；应用、集群和节点共用动作，含错误/重试 |
| `ClusterNodes/{NodeDetails,ClusterTerminal}.tsx`、`ResourceBrowser/ResourceList/AdminTerminal.tsx` | `NodeMetadataPanel.vue`、`NodePodsPanel.vue`、`ClusterTerminalWorkspace.vue`、`ClusterDebugManifest.vue`、`ClusterDebugEvents.vue`、`useClusterTerminal.ts`；节点元数据/Pod 排序、原位 YAML、两行集群终端工具栏、调试 Pod 事件/Manifest 与节点 Debug Mode |
| 资源上下文页签与详情 | `resourceTabs.ts`、`ResourceDetailPanel.vue`；应用/集群分开维护页签，右键关闭当前/其他/全部，删除后关闭资源并刷新；容器日志入口保留选择的容器 |
| `v2/appDetails/k8Resource/nodeDetail/NodeDetailTabs/Manifest.component.tsx`、`nodeDetail.util.tsx` | `ResourceManifestWorkspace.vue`、`ResourceYamlEditor.vue`、`ResourceDetailTabs.vue`、`useResourceManifest.ts`；深色行号编辑器、只隐藏托管子树、原位分栏 Review/Apply、草稿保护与读回；完整 Monaco 和可选扩展能力待补齐 |
| `NodeDetailTabs/{Logs,LogViewer,Events}.component.tsx`、`EventsTable.tsx`、`CustomLogsModal/CustomLogsModal.tsx`、`nodeDetail.util.tsx` | `PodLogsWorkspace.vue`、`PodLogRangeDialog.vue`、`ResourceEventsWorkspace.vue`、`usePodLogs.ts`；分组容器、独立上一实例、预设与四种自定义范围、文本 grep 过滤、下载/暂停/滚动及深色六列事件；完整终端渲染与真实连接待补齐 |
| `components/CIPipelineN/{TaskList,Sidebar,CustomScript}.tsx` | `PipelineStageEditor.vue`、`PipelineEditDrawer.vue`；Shell/Container 任务、条件/变量/脚本/工作目录/产物路径、排序、跨阶段移动、保存和重新打开 |
| 工作流 Source → CI → CD 关系 | `WorkflowSection.vue`、`BuildDeployView.vue`、`TriggerGraph.vue`；每条 CI 只连接自己的 CD，无 CI 的外部镜像单独显示；新建追加已有工作流，各 CI 独立配置触发 |
| `v2/appDetails/sourceInfo/environmentStatus/NotesDrawer.tsx` | `ReleaseNotesDrawer.vue`、`ReleaseNotesMarkdown.vue`；50% 宽只读 Notes、Markdown 标题/列表/代码块/表格、加载/空态/错误态与关闭；展示经过清理的 Mock Helm 输出 |
| 构建日志与镜像产物操作 | `BuildHistoryView.vue`、`ArtifactMetadataDialog.vue`；日志实际下载为文件，镜像 Release tags/备注编辑后回写 Mock |
| 共享库 `ArtifactInfoModal`、`Artifacts`、`ImageCard` 与概览 `EnvironmentList.tsx` | `ArtifactDetailsDrawer.vue`、`ArtifactDetailsBody.vue`、`ArtifactSummaryCard.vue`、`useArtifactDetails.ts`；800px 右侧源码/镜像抽屉、四个页面入口、选择镜像原位展开和统一元信息编辑；企业版标签策略与完整变更文件待补齐 |
| `components/material/{MaterialList,MaterialForm,MaterialView}.tsx`、`material.scss` | `GitRepositoryCard.vue`、`useGitRepositories.ts`；独立新增仓库、折叠/展开编辑、匿名账号提示、克隆目录、文件过滤、子模块、取消恢复和删除确认；不能删除唯一仓库或构建配置使用中的仓库 |
| `components/ciConfig/{CIDockerFileConfig,BuildContext,CIConfigForm}.tsx`、`css/forms.scss` | `BuildMethodFields.vue`、`BuildAdvancedOptions.vue`、`BuildSection.vue`；1012px 表单容器、三种构建方式、源码/上下文仓库、模板编辑、Builder 镜像、相对路径、高级平台/参数/超时以及底部保存配置 |
| `ciConfig/{CICreateDockerfileOption,CreateDockerFileLanguageOptions}.tsx`、`CIPipelineN/CustomScript.tsx` | `ManagedDockerfile.vue`、`DockerfileCodeEditor.vue`、`TaskScriptEditor.vue`、`ScriptCodeEditor.vue`；仓库/语言/框架工具栏、300px 原生 CodeMirror、Dockerfile/Shell 高亮、查找替换/撤销重做、模板与任务历史隔离；目录为离线样例，完整上游工具栏/补全待补齐 |
| `components/app/details/cIDetails/CIDetails.tsx` | `BuildHistoryView.vue`、`BuildDeployView.vue`；按 CI 独立筛选历史和画布状态，URL 记录 pipeline/build，触发后定位对应流水线，重试保留归属并清空旧产物；未关联流水线记录单独展示 |
| `Pages/Applications/DevtronApps/Details/AppConfigurations/MainContent/DeploymentTemplate/`、`NoOverrideEmptyState.tsx`、`constants.tsx` | `useDeploymentTemplate.ts`、`DeploymentValuesEditor.vue`、`DeploymentValuesForm.vue`；基础/环境模板、只读继承、独立覆盖、Patch/Replace 本地合并预览、无覆盖空态、创建/删除确认、取消恢复与离开提示 |
| `Pages/Shared/ConfigMapSecret/{ConfigMapSecretContainer,ConfigMapSecretForm,ConfigMapSecretData}.tsx`、`AppConfigurations/Navigation/Navigation.helper.tsx` | `ConfigEntryWorkspace.vue`、`ConfigEntryList.vue`、`ConfigEntryForm.vue`、`useConfigEntries.ts`；上下文导航内逐条配置、继承/覆盖/环境独有状态、创建/删除覆盖、来源/挂载表单、GUI/YAML 与本地清单预览 |
| `AppConfigurations/MainContent/DeploymentConfigCompare/{DeploymentConfigCompare,DeploymentConfigCompareWrapper}.tsx`、`utils.ts` | `ConfigComparisonWorkspace.vue`、`ComparisonVersionSelector.vue`、`ComparisonFileNav.vue`、`useConfigComparison.ts`、`ConfigurationDiff.vue`；独立路由、URL 两侧环境/版本/条目、文件导航与历史快照对比；保护草稿/审批版本和 Manifest 尚未对齐 |
| `components/ciPipeline/SourceMaterials.tsx`、`CIPipelineN/AdvancedConfigOptions.tsx` | `PipelineSourceFields.vue`、`PipelineBuildOverride.vue`；逐仓库固定/正则分支、继承/允许覆盖/删除覆盖、独立构建表单、校验与版本冲突提示 |
| `components/app/details/triggerView/BuildImageModal/{GitInfoMaterial,TriggerBuildSidebar}.tsx` | `BuildRepositoryList.vue`、`useBuildMaterials.ts`、`SelectMaterialDrawer.vue`；234px 仓库侧栏、独立提交/分支/搜索/刷新状态、全部选择后触发、源码和有效构建配置快照 |
| `CIPipelineN/{PreBuild,TaskDetailComponent,TaskTypeDetailComponent}.tsx`、`VariableDataTable/`、`ConditionDataTable/`、`PluginDetailHeader/` | `TaskCatalogPanel.vue`、`PipelineTaskDetail.vue`、`TaskVariablesEditor.vue`、`TaskConditionsEditor.vue`；内嵌任务目录、示例插件版本表单、类型化变量与条件、独立滚动及草稿保护 |
| `CIPipelineN/Sidebar.tsx` 的 `triggerPipelineMode` / `renderExecuteTask`、`cdPipeline/CDPipeline.tsx` | `DeploymentStageSettings.vue`、`deploymentStage.ts`；CD 前后置独立触发、应用环境执行开关、worker 不可用提示、失效选择修复与共用保存校验 |
| `app/details/triggerView/workflow/nodes/triggerPrePostCDNode.tsx`、`app/details/cdDetails/utils.tsx` | `StageWorkflowNode.vue`、`StageImagePicker.vue`、`DeploymentActivityView.vue`、`StageRunHistory.vue`；独立阶段节点、镜像选择、PRECD/POSTCD 详情上下文、任务日志、取消/重试与触发快照 |
| `app/details/cIDetails/CIDetails.tsx`、`cdDetails/CDDetails.tsx` 与本地共享库 `LogsRenderer`、`LogStageHeader`、`Scroller`、`LogResizeButton` | `history/{HistoryLogViewer,HistoryLogViewport,HistoryLogStageHeader}.vue`、`useHistoryLogViewer.ts`；共用阶段事件/状态/耗时/平台、虚拟可视行和吸顶标题、ANSI 文本样式、搜索定位、全部折叠/E、顶部/底部跳转、换行/跟随、展开与原文下载；页签/任务 URL 恢复 |

| `CIPipelineN/{TaskTypeDetailComponent,MultiplsPort,MountFromHost,OutputDirectoryPath,Sidebar}.tsx`、`cdPipeline/CDPipeline.tsx` | `TaskExecutionFields.vue`、`TaskMappingEditor.vue`、`StageResourcePicker.vue`；容器命令/参数、脚本/源码/主机挂载、端口/产物路径，以及 CD 前后阶段独立的目标环境配置引用 |

## 第二轮：Git、构建配置与构建历史

- Git 页由覆盖单个仓库改为多个独立仓库条目；多仓库字段只写入前端 Mock。旧 `gitConfig` 保留首仓库摘要，用于兼容其他页面；`gitMaterials` 是前端扩展。
- 配置侧栏只列出应用已绑定环境，已完成配置时隐藏引导进度卡；Git/Build 使用灰色底板与居中表单。修正应用工作区的外层留白，保存栏贴合底部。
- Dockerfile、创建 Dockerfile、Buildpacks 三种方式均可切换、校验、保存和重新打开。Node.js/Go/Python 是本地示例模板，不是已接入的上游模板目录；构建方式和高级字段不代表实际构建支持。
- Build 增加前端 Mock 的 `pipelineId`、触发分支与仓库快照字段。已有 checkout/payment fixture 明确绑定原 CI；没有归属的旧记录不分配给新建 CI。后端 OpenAPI 未改动。
- 构建历史左侧切换 CI 后独立展示记录或空态；从画布查看详情、触发构建后带入流水线上下文。取消请求刷新完成前禁用操作；重试不继承已完成构建的产物。
- 构建历史时间线、记录行高、页签和深色日志区域继续对齐参考布局；没有声明逐像素等价。

## 第三轮：部署模板与环境继承

- 环境的“继承”页签只读展示基础 Values，不再混入该环境的覆盖；“覆盖”独立编辑原始覆盖字段。“不覆盖”展示空态与创建入口。页签通过 `headerTab` 查询参数恢复，切换视图不会把草稿误标为已保存。
- 创建覆盖可从空对象开始；保存空对象后仍保留显式覆盖状态。删除覆盖需要确认，恢复继承且保留环境绑定。新增 `overrideEnabled`、`overrideMergeStrategy`、`overrideValuesYaml` 都是前端 Mock 元数据。
- 对照上游 Patch/Replace 的入口与文案增加本地策略预览。Patch 递归合并对象、数组整体替换；Replace 使用完整覆盖对象。环境对比、发布预览和发布历史当前值表共用这一规则。此处不代表已实现上游所有服务端 Patch 规则、保护字段或审批流程。
- YAML 使用 `yaml` 解析库替代原来的正则字段提取，保留自定义嵌套对象、数组、块字符串及原文注释；GUI 定点更新字段，并在编辑别名引用时展开当前引用。重复 key、无效语法、错误字段类型会禁用保存；没有执行 Helm schema 或集群验证。
- 基础配置改为单一“保存修改”操作；补齐取消修改确认、未保存离开确认和浏览器刷新提示。保存保持乐观版本检查；本轮未专门注入并发冲突做浏览器验收。
- 收紧上下文侧栏、36px 顶部页签、紧凑工具栏与编辑器边框；长 YAML 仅编辑区内部滚动，行号同步，保存栏保持可见。未声明逐像素等价。
- “试运行”展示当前草稿合并后生成的简化 Deployment/Job 清单，明确标注本地预览；不是完整 Helm 模板渲染，也不执行集群请求。第三轮结束时尚未实现的历史配置快照、ConfigMap/Secret 逐条继承与覆盖，已在第四轮继续补齐如下。

## 第四轮：配置条目、跨环境对比、发布快照与 Notes

- ConfigMap/Secret 从列表加 560px 抽屉改为逐条配置工作区；条目嵌入原有上下文导航，正文使用配置/继承/覆盖/试运行页签，底部保存栏固定可见。环境页同时列出基础条目与环境独有条目；只有继承的条目默认打开只读继承页。
- 支持按名称匹配基础配置，创建空 Patch、切换 Patch/Replace、只读合并预览、删除覆盖后恢复继承。Patch 只合并数据键，来源和挂载设置沿用基础配置；Replace 使用完整条目。基础条目删除后留下的环境条目按环境独有配置展示。
- 表单提供创建资源/引用已有 Kubernetes 资源、环境变量/数据卷挂载、绝对挂载路径、subPath 与可选八进制文件权限；编辑已有条目时名称锁定。新增字段全部属于前端 Mock 扩展，不代表已有后端合同。
- 数据支持 GUI/YAML 切换、键增删、多行值、原文注释回读、重复键/类型/挂载路径/文件权限校验。切换条目、离开页面、取消修改和浏览器刷新有草稿保护。未绑定环境显示错误，不能进入编辑表单。
- Secret 只保存键和挂载设置；输入的临时明文在保存后被丢弃，继承、预览、历史、对比都只显示遮蔽值。因此 Secret 对比只覆盖键及设置，不具备判断真实 Secret 值相同或不同的能力。
- 第四轮环境对比扩展到部署模板、ConfigMaps、Secrets；两侧选择环境后读取合并后的有效配置，可切换条目、交换两侧、仅看差异、查看字段表或带新增/删除行标记的并排 YAML。当时使用全屏尺寸弹窗；独立路由与历史版本选择已在第十轮继续补齐，保护草稿/审批版本仍待对齐。
- 发布配置不再把当前值冒充历史值：两条 checkout 开发环境记录提供明确标注的固定本地示例快照；其他原有记录保留“未保存配置快照”状态。新触发发布捕获部署值、有效 ConfigMaps/Secrets、目标与 Chart 元数据，后续配置变更不改写快照；晋级捕获目标环境配置，回滚沿用来源快照。Secret 快照不存明文。
- 发布历史的配置页可切换部署值/ConfigMaps/Secrets、只读 YAML、与当前有效配置比较；目标信息也从快照读取。第四轮仍存的当前仓库元数据混入源码历史问题，已在第五轮改用构建记录；完整任务产物对齐仍属于后续工作。
- Notes 使用 `marked` 与 `DOMPurify` 渲染并清理 Markdown，支持标题、列表、代码块、表格和引用；脚本、事件属性及危险 URL 被清理，外链设置窗口隔离属性，图片不加载。数据仍是本地示例，未调用真实 Helm。

## 第五轮：逐仓库构建、流水线覆盖与源码快照

- 构建流水线编辑页为每个 Git 仓库配置固定分支或分支正则。正则检查语法；触发时只列出匹配分支，固定分支只读。没有匹配分支显示明确空态，并禁止开始构建。未增加 Git tag、PR/Webhook 事件调试或真实代码拉取。
- “允许覆盖”从应用当前构建配置建立独立草稿，可编辑镜像仓库/Repository、三种构建方式、源码/上下文仓库、Dockerfile/Builder、高级参数、单个平台及超时。“删除覆盖”恢复应用当前值，不影响其他流水线；应用配置本身不被流水线覆盖改写。编辑抽屉内容区内部滚动，底部操作栏固定。
- 提交选择保留 1024px 抽屉与 234px 仓库侧栏。仓库切换分别保留提交、搜索与分支；单仓库刷新保留仍有效的选择，变更分支仅清空当前仓库的提交。全部仓库选齐才可开始构建；异步结果按会话与请求序号隔离，避免迟到响应串用。
- 本地 Mock 按仓库/分支生成稳定提交集合；拒绝漏选/重复选择、其他仓库或分支的提交、过期应用/工作流版本。增删 Git 仓库同步调整已配置的流水线代码源；流水线覆盖引用的源码/上下文仓库也有删除保护。没有实现远程 Git 或构建服务。
- 新构建捕获所有仓库的 URL、克隆目录、分支、SHA、提交信息/作者/时间，以及有效构建配置和工作流版本。构建历史“源码”逐仓库展示，并可展开本次构建配置。主提交跟随有效构建配置指定的源码仓库；重试沿用原始源码与构建配置，后续编辑不改写历史。修正重试先加载旧记录再加载新记录导致页签被再次重置的问题。
- 发布历史源码页复用关联构建记录，不再拿应用当前仓库与分支补全历史。既有缺少快照的记录只展示已保存字段，并标记仓库/分支/作者/时间未记录；不伪造历史。任务阶段、参数解析结果、Git diff 与完整跨版本比较仍待补齐。

## 第六轮：任务目录、变量条件与流水线草稿

- 前后置阶段保持任务侧栏，添加任务时在右侧打开目录，支持搜索、分类与无匹配空态。Shell/Container 自定义脚本入口保留；目录另提供两个明确标识的本地示例插件，用于验证参数表单与版本切换，不冒充完整 Devtron 插件目录。切换版本保留同名且同类型的输入，重新读取该版本的输出定义。
- 任务详情拆为说明/执行方式、输入、触发条件、脚本/产物、输出和结果条件。侧栏与详情分别滚动，保存栏固定。输入与输出支持 String、Number、Boolean、Date；输入可选自定义值、三个本地全局示例变量或前序任务输出。后置任务可引用前置输出；跨任务通过稳定 ID 关联，排序不会把引用误指向另一任务。
- Trigger/Skip 使用当前任务输入变量，Pass/Fail 使用输出变量；提供六种比较运算符，String/Boolean 仅支持等于/不等于。CI 后置任务支持“构建失败时仍触发”。Container 不提供脚本输出，切换前确认清除输出与结果条件。条件只保存配置，未执行实际表达式或脚本。
- 编辑与 Mock 保存共用校验：变量名称/重复/类型/值、输出引用顺序和类型、条件变量与运算符、容器镜像以及插件版本结构。排序、删除、跨阶段移动或修改输出后会标明失效引用并阻止保存；目前保留原引用供修复，与上游部分操作直接清空依赖字段仍有行为差异，后续继续核对。
- 新增嵌套配置深拷贝，取消草稿不会污染已保存任务。取消、抽屉关闭、路由离开/更新与 beforeunload 事件共用草稿保护；可继续编辑或放弃修改。保存成功更新基线，重新打开只读取保存版本。加载期间隐藏可编辑内容，避免异步初始化覆盖用户草稿。
- 第六轮结束时尚未覆盖的容器命令/挂载高级表单、阶段 ConfigMap/Secret 引用已在第七轮继续补齐。远程/完整插件目录、插件创建与治理、File/运行时变量及完整任务执行日志仍待对齐。

## 第七轮：容器执行配置与部署阶段资源引用

- 容器任务从单一脚本输入扩展为 Container image、Mount custom code、Command、Args、Port mapping、源码挂载、主机目录映射和多个 Output directory path。对照上游按逗号拆分 Args；可留空命令/参数使用镜像入口。脚本仅在启用自定义代码挂载时显示和校验，路径与命令独立配置，不自动替用户改写命令。镜像示例与自定义值输入保留，提示镜像需要包含 /bin/sh；示例镜像没有实际拉取或验证。
- 新建容器默认不挂载脚本；旧版只有脚本的容器通过兼容映射保留脚本挂载语义。关闭挂载保留隐藏字段用于重新开启，但不校验未启用的挂载。端口/目录/产物支持逐行增删；UI 与 Mock 保存共用脚本路径、端口范围/重复、目录完整性、空产物与 /devtroncd 保留目录校验。
- 运行字段和映射表拆为独立 Vue 组件，任务详情保留编排职责。Shell 保留脚本、工作目录和源码路径提示，产物路径改为逐行编辑。嵌套容器配置与产物路径纳入深拷贝、保存回读、跨阶段移动和草稿保护。
- 按上游 Sidebar 条件，仅在 CD 前后置阶段显示 CONFIGMAPS & SECRETS。加号切换为可搜索的多选菜单，选择后保持打开，Escape/外部点击关闭；列表支持逐项移除。前后置阶段分别持有引用；CI 阶段不展示此入口。目标环境字段改为显示实际绑定环境和 Namespace。
- 选项读取当前应用和 CD 绑定环境的基础配置与环境覆盖，按类型与逻辑名称去重；只返回名称、类型和来源标记。移除覆盖后可回落同名基础配置，不因条目 ID 变化丢失引用；其他应用或环境专属项不可选，Secret 不返回键或明文。
- 被删除的配置保留为失效引用并阻止保存，移除后可修复。引用验证同时进入 Mock 保存边界，不能绕过页面串用名称/类型、提交重复或不存在的引用。配置仍是当前会话内的表单数据，没有创建容器、挂载资源或执行脚本。
- 第七轮结束时尚未补齐的 CD 独立触发、应用环境执行及 worker 状态在第八轮继续实现如下。容器与任务的完整上游错误提示/字段细节、完整任务运行日志和产物查看仍待补齐。

## 第八轮：部署阶段触发与执行环境

- 按上游 Sidebar，将 CD 前后置阶段侧栏排列为任务列表、阶段触发方式、ConfigMap/Secret 引用、执行环境。前后置分别提供 Automatically / Manually，与部署主阶段的触发设置独立；CI 前后置不显示这些 CD 选项。主阶段有前置任务时，自动触发说明改为“前置阶段成功后自动”。
- `DeploymentStageSettings.vue` 负责阶段设置展示与更新，`PipelineStageEditor.vue` 组合任务和侧栏，抽屉持有前后置草稿并负责加载和保存。新设置进入保存回读、取消/继续编辑/放弃修改、路由与刷新事件保护，切换环境不混用状态。
- Execute tasks in application environment 的 worker 能力显式来自目标绑定集群的 Mock 元数据（开发集群启用、生产集群禁用），不从连接状态或生产标记推断；这只是本地能力示例，不代表真实 worker 检测。缺失元数据按不可用处理。未配置时禁用复选框并保留 Devtron 原文 tooltip；触发方式仍可编辑保存。
- 如果旧记录启用了当前不可用的执行环境，保留已存勾选并显示原因和“关闭在应用环境执行”修复入口，保存前定位对应阶段。UI 与 Mock 共用触发枚举、布尔值和 worker 可用性校验；缺失旧字段兼容自动触发/默认环境执行，无效显式值拒绝保存。
- 第八轮结束时尚未覆盖的独立运行图和阶段历史/日志在第九轮继续补齐如下。实际调度、产物文件和虚拟环境专属逻辑仍待补齐，不能视为真实自动执行验收。

## 第九轮：CD 独立阶段运行与历史

- Build & Deploy 仅为有任务的 CD 显示 Pre-deployment / Post-deployment 节点；每条环境链按前置、部署、后置排列，各自显示触发方式和最近状态。节点含独立的选择镜像与详情入口，阶段连线与 1280px 内部横向滚动保留。配置画布继续使用原 CD 编辑节点。预发布环境提供前后置示例任务，脚本不实际执行。
- `StageImagePicker.vue` 提供按 tag/digest 搜索、展开镜像详情、刷新/空态/错误重读与触发。目录限制为当前应用、对应上游 CI 的镜像，另保留本应用外部镜像；新触发同时检查配置与工作流版本、任务、引用和 worker 能力。阶段操作不走部署预览/策略表单，不创建 Deployment，也不变更环境当前发布。
- 发布历史通过 `DeploymentActivityView.vue` 组合 Deployment / Pre-deployment / Post-deployment。阶段页含环境、流水线、记录列表与 Logs / Source / Configuration / Artifacts 页签；URL 保存 `type=PRECD|POSTCD`、`env`、`pipeline`、`run`。切换环境或阶段清理旧选择，失效或跨环境/阶段记录显示未找到，不回退展示另一条记录。原发布历史继续使用独立组件。
- 阶段记录固定触发时的任务、变量/条件、执行设置、配置引用及有效配置、环境目标、镜像 digest、历史构建信息和两个版本号。Secret 仅保存键与挂载元数据。后续修改当前流水线或镜像备注不改写历史。失败/已取消的重试创建新记录、增加次数并关联来源，沿用原快照；仍检查流水线、目标和所需 worker 可用性，目标字段顺序变化不算环境变化。
- `StageRunDetail.vue` 和 `StageTaskLogs.vue` 提供逐任务选择、状态、日志刷新、自动换行/跟随和本地下载。运行记录与日志异步切换有过期响应保护，离开页面停止轮询。取消有确认弹窗，终态禁用取消；同流水线同阶段不允许并发触发，前后置记录分别维护。历史有运行中记录时定时刷新，画布可手动刷新状态。
- 本地示例在读取时按时间从 queued 推进为 running，约 30 秒显示 succeeded；不是任务执行结果。不会自动触发相邻阶段或真实部署。Artifacts 显示明确的未生成文件状态，仅列出配置声明的路径；没有制造可下载产物。日志工具在第十一轮继续补齐；真实日志流、任务产物和自动阶段调度仍未完成。

## 第十轮：独立配置对比与历史版本选择

- 对照 Devtron 的 DeploymentConfigCompare、Wrapper 与路由，将原环境对比弹窗替换为独立工作区 `/projects/:projectId/apps/:appId/config/compare/:resourceType?/:resourceName?`。保留 Podry 应用页头与配置页签，左侧为文件导航，右侧为两侧版本选择和只读差异。配置页入口经过原有草稿离开保护；关闭按来源环境和当前查看的配置文件返回。
- `useConfigComparison.ts` 管理目录加载、过期响应保护和 URL 上下文；`ComparisonVersionSelector.vue` 只发出选择事件，`ComparisonFileNav.vue` 负责文件导航、搜索、名称升降序和只看变更文件。`ConfigurationDiff.vue` 继续提供 GUI、并排 YAML、行号、增删高亮与字段级差异过滤，文件和详情各自内部滚动。
- 两侧均支持当前已保存配置、当前部署快照与历史发布；默认比较侧优先选择该环境最新历史记录。切换环境清理该侧旧版本，交换同时交换环境与版本。URL 保存 `left/right`、`leftVersion/rightVersion` 及资源路径，刷新、直接打开和浏览器后退可恢复选择。未指定条目时补全首项，明确指定的失效条目不回退到其他条目。
- 当前配置按继承/覆盖规则合并，历史只读取记录自身的固定快照。Mock 目录包含本应用全部历史，不受原发布列表 50 条分页截断；按应用和环境验证历史归属。失效环境/版本、跨环境/应用记录、没有当前部署和缺少快照分别显示错误，不能用当前配置填补历史。Secret 只对比键和挂载元数据，即使旧快照额外包含明文也不输出；遮蔽值不能证明真实值相同。
- 发布历史配置页新增“打开版本对比”，固定所选发布与当前保存值。返回恢复该发布、环境和配置页签；发布页支持 `deployment` 深链及分页之外的记录，页内深链变化和浏览器后退同步选择。没有修改配置、触发构建或创建部署。
- 差异比较保留数值/字符串/布尔/null 的类型差别、数组顺序和空容器；对象键顺序不制造差异，点号键与嵌套路径不混用。1280px 下版本表单换行、文件导航和差异区域保持内部滚动。
- 这里的“当前已保存配置”不是受保护的发布版本，也不包含编辑器未保存草稿。第十轮时尚无 Manifest/默认值及变量转换；第四十二/四十三轮已补本地示例，受保护草稿/已发布/审批模型、真实 Chart 历史与完整作用域变量仍有差异，不能视为全量 Devtron 对比功能完成。

## 第十一轮：构建与阶段历史的共用日志工作区

- 继续只读核对 Devtron CI/CD 历史页，以及已安装的 `@devtron-labs/devtron-fe-common-lib`（4.0.14-pre-2）的声明和本地打包实现。上游包含搜索/匹配定位、阶段折叠、Scroller 与 LogResizeButton；Artifacts 按运行状态、对象存储能力和上传结果决定下载 ZIP，未发现该普通历史组件自带文件树。因此本轮不把配置路径冒充任务生成文件。
- `history/HistoryLogViewer.vue` 负责日志展示和工具栏，`useHistoryLogViewer.ts` 管理搜索、跟随及滚动，`historyLogs.ts` 生成文本分段。构建历史与 CD 前后置任务共用此组件。搜索忽略大小写，正则特殊字符按字面匹配；逐处高亮、计数、上/下一项循环跳转以及 Enter/Shift+Enter 可操作，日志不作为 HTML 解析。
- 日志区支持自动换行、单个当前日志节折叠/展开、滚到顶部/底部。搜索、向上手动滚动或跳到顶部会暂停跟随；勾选跟随或跳到底部恢复。刷新及历史状态轮询保留当前搜索和暂停状态，不强行把正在查看的日志拉回底部。下载仍导出完整原始文本，不受关键词或折叠影响。
- 展开后通过 Teleport 将日志区显示为覆盖窗口的工作区，保留查询、换行与滚动位置；展开时仍可下载。Escape/还原按钮返回并恢复展开按钮焦点，Tab 在展开区内循环，离开页签或页面清除浮层。不是浏览器 Fullscreen API。1280px 下工具栏换行，任务侧栏和日志各自滚动，长镜像地址不撑宽页面。
- 构建页 `tab=logs|source|artifacts` 与 `pipeline/build` 一起恢复，默认成功构建仍展示镜像产物。阶段页 `tab=logs|source|config|artifacts` 与 `task` 保留所选历史任务，浏览器后退可恢复任务；失效页签/任务有明确空态，不能回退到另一任务日志。切换环境/流水线/阶段或选择另一运行时清理旧任务上下文，重试回到新记录的 Logs。新增 Mock 运行仍只在当前 SPA 文档会话存在，整页刷新不会持久化它们。
- 构建日志异步加载增加独立请求代次与卸载保护，元数据和整体加载也丢弃过期结果。修正原 Mock 中写死 checkout 镜像、把产物 ID 当 digest、取消 Job 名称固定等问题；使用本次构建关联的同应用/同构建产物，缺失时明确说明元数据未记录。queued、canceling、unknown 不显示成功文案，构建日志显式说明没有运行命令或推送镜像。
- 仍有差异：没有真实 SSE/NDJSON 日志流、重连、持久化归档、ANSI 着色、`STAGE_INFO` 多节状态/耗时与虚拟列表，也没有运行时任务输出和对象存储 ZIP。当前只折叠所选日志节，不代表上游“全部阶段折叠”完整等价；产物区保持未生成文件空态。

## 第十二轮：ConfigMap / Secret 键值编辑与 YAML 批量编辑

- 只读核对 `Shared/ConfigMapSecret/ConfigMapSecretData.tsx`、`utils.ts` 与已安装共享库的 `KeyValueTable`。本轮补齐可编辑键名、稳定行标识、键排序、空键/重复键/非法字符逐行校验、Secret 统一显隐及 YAML 复制。上游未发现键值表多选批量删除入口；批量编辑沿用 YAML，不另造多选删除界面。
- `ConfigEntryForm` 保留来源/名称/挂载表单；`ConfigEntryDataEditor` 组合模式/显隐/复制工具栏、YAML 编辑器与 `ConfigEntryDataTable`。`useConfigDataTable` 管理行标识和显示顺序，`configEntryData.ts` 直接修改 YAML AST，保留文件/行内注释、多行值和未编辑节点。排序及 GUI/YAML 切换不修改草稿；编辑键名不重排正在输入的行，新增空行置顶。
- 重复键不会相互覆盖，空键和非法键保留在草稿供修正，并进入现有保存校验和离开确认。无效 GUI 行阻止切换模式，无效 YAML 保留 YAML 编辑器修正。字符串别名可显示，修改锚点同步引用，删除仍被引用的锚点给出提示且保留草稿；嵌套对象、数组及非字符串值须在 YAML 修正。数据卷显示 File Name / File Content 表头。
- Secret 默认隐藏，显示/编辑只解锁本次临时草稿；隐藏不覆盖草稿，保存、取消及切换继承/合并/试运行视图会重新锁定。隐藏的 YAML 和复制内容移除值、注释与锚点，格式错误也不在隐藏视图泄漏解析片段。现有键统一用占位符，保存仍只传键集合和挂载信息，不保存或取得真实明文。已有 Kubernetes 资源继续保留原来的 subPath 键名指定能力，值只读；这与上游外部资源隐藏内部数据编辑器仍有差异。
- 继承与合并预览只读，Patch 元数据继承、空 Patch、覆盖删除回落与草稿保护继续保留。配置重置使用草稿代次重新挂载表单，避免切换条目或保存后沿用上一个条目的显隐/排序/错误状态。
- 仍有差异：外部 Secret Provider/ESO、受保护配置/审批、真实权限和 Secret 读写未接入；没有逐像素比对全部配置状态。Secret 显隐以本地只存键的边界实现，不能当作服务端解密或授权验收。

## 第十三轮：应用创建与克隆引导

- 对照 `Pages/App/CreateAppModal/`，创建抽屉调整为 1024px，方法侧栏 250px、标题栏 49px、固定底栏 74px。从零创建显示项目与名称的 `/` 组合行、描述、可折叠标签；克隆先显示可搜索的应用卡片，选源后进入信息页，提供面包屑与返回。表单、标签表、克隆列表拆成组件，加载和提交放到 `useApplicationCreation.ts`。
- 项目默认空；从项目详情进入时预选当前项目。选择克隆源不自动生成名称；返回列表或切换创建方式保留身份表单。行菜单入口预选来源，镜像克隆跟随来源类型。源码应用创建后进入 Git 配置，镜像应用进入部署模板。保留 Podry 已有的源码/镜像类型选择。
- 应用名限制 3–30 位、小写字母开头、字母或数字结尾，中间允许连字符；30 位依据参考仓库关闭的 `FEATURE_APP_NAME_40_CHAR_ENABLE`。描述最多 350 位。标签键/值/传播选项支持增删与逐行错误，忽略完全空行，检查重复键、DNS 前缀及字符/长度；提交前和 Mock 写入边界共用校验。结构化标签保存为副本并在概览回读，传播只记录意图，不写 Kubernetes。
- 克隆目录按 100 条分页读完并去重，过滤归档应用，避免旧版只读取首 20 条；中断旧请求、空页和重复分页有保护。加载失败可重试，源应用失效明确提示。克隆仍只复制源应用最新 Git、构建和部署模板配置，配置版本重置为 1、镜像仓库路径指向新应用；不复制环境绑定、流水线、ConfigMap/Secret 或执行历史，不能据此推断真实服务端克隆语义。
- 名称冲突保留草稿，提交期间锁定方式切换和关闭、防止重复创建。关闭、路由离开和刷新事件复用草稿保护；重开清理旧错误、标签和来源。创建说明入口可打开本地说明。克隆卡片使用原生按钮，支持键盘聚焦与 Enter 选择；1280px 下表单和卡片区独立滚动，底栏保持可见。
- 仍有差异：企业版模板创建、项目强制标签策略、权限驱动的项目/源应用目录、完整服务端克隆与传播未接入。概览旧字符串标签编辑已在第十四轮替换为键值编辑器。没有逐像素验收所有创建状态。

## 第十四轮：概览档案、标签、说明与环境列表

- 对照 `components/app/Overview/`，关于页采用 300px 档案侧栏与 32px 间距；环境页隐藏档案侧栏并展开列表。`tab=about|environments` 写入 URL，深链恢复页签，无效值回退关于并保留其他查询参数。路由页仅组合四个业务组件，加载和编辑分别由两个 composable 管理，异步结果有代次保护。
- 描述从通用弹窗改为侧栏内编辑，350 位限制、取消/保存、错误保留和首尾去空格；编辑不再丢失已保存标签。档案列出全部已配置 Git 仓库，HTTP/SSH/SCP 地址转换为网页链接，去除地址内凭据并拒绝危险协议。创建人/创建时间只读取已记录字段；新建应用记录这两个字段，旧 fixture 缺失则显示“未记录”，不再取当前用户和更新时间冒充。
- 标签使用上游 800px 右侧“管理标签”抽屉，复用创建表单的键/值/传播表、逐行校验与增删。概览显示键值标签及传播图标，保存/重开保留传播选项。旧 fixture 的 `order`、`critical` 等没有键值结构，单独保留原文，用户可明确移除；不自动编造其值或传播设置。标签仍只写 Mock 元数据，不修改 Kubernetes 资源。
- 所属项目使用 600px 对话框，变更时展示原项目用户可能失权、目标项目用户可能获得权限的提示，并标明 Mock 边界。写入前检查项目存在、目标项目同名冲突和其他字段，失败不产生部分更新。成功同步概览项目、项目路由和应用页头切换目录，保持应用 ID、环境及配置归属。真实权限和项目标签策略仍未接入。
- 应用说明由简化逐行渲染与弹窗编辑改为页内 Markdown 编辑/预览，支持标题、列表、表格、代码与链接；复用现有 `marked`/`DOMPurify` 渲染，拒绝脚本/图片等内容并隔离外链。保存保留 Markdown 原文、空行及 Mock 更新人/更新时间。描述、说明、标签和项目编辑共用关闭/路由/刷新事件草稿保护；页签切换同样经过保护，保存中阻止重复提交与离开。
- 环境表头的名称与部署时间支持真实排序及 `sortBy`/`sortOrder` URL 恢复；最近部署可切换完整/紧凑镜像名。镜像与提交打开只读详情和历史源码快照，部署时间进入指定发布，环境名称进入对应运行详情。未部署环境保留空值排序，无绑定时提供继续配置入口。绑定引用的发布/构建若不在历史首 50 条，通过现有 Mock 详情读取补齐；不使用其他应用的记录填补。
- 差异继续保留：企业版依赖目录、部署窗口/发布轨道、强制标签策略、真实权限/传播与服务端 Note 版本未接入；Git Web 地址只做常见形式转换，不能识别自托管实例的所有网页路由；镜像详情在第二十轮继续按上游抽屉结构补齐，完整源码变更文件与标签治理仍待继续。没有逐像素完成全部状态验收。

## 第十五轮：Webhook 代码源、事件选材与设置分支

- 对照上游 `ciPipeline/SourceMaterials.tsx`、`ConfigureWebhook.tsx`、`WebhookSelectorCondition.tsx`、`ciPipeline.service.ts`，保留固定分支/分支正则，并将 Tag Creation 和 Pull Request 作为 Webhook 事件配置，而非独立的固定 Tag 或 Tag 正则检出类型。单仓库且存在示例 Provider 目录时显示事件选项，多仓库仅提供两种分支类型；已有 Webhook 流水线必须先改为分支源才能添加仓库。
- Webhook 表单包含仓库前置配置说明、事件过滤字段及正则的增删、字段去重/剩余选项和无效正则校验；切换类型会清理无关字段，流水线草稿保护保留。自动触发文案随代码源切换为 Push 或 Webhook。未编造可用的接收 URL、密钥或远端事件。
- 对照 `BuildImageModal/GitInfoMaterial.tsx` 与 `CiWebhookDebuggingModal.tsx`，选材仅显示符合全部过滤条件的事件，卡片显示 Tag 或 PR 来源/目标分支/动作，按事件 ID 选择；同一 SHA 的不同通知仍为独立事件。刷新和进入/返回接收视图保留有效选择，无匹配事件提供空态和诊断入口。
- 已接收视图在同一构建抽屉内切换，采用 250px 事件侧栏，包含全部示例通知、通过数量、逐字段接收值/配置正则/过滤结果和只读 Payload 复制；隐藏构建操作栏。编辑过滤入口通过工作流深链打开对应流水线，先消化查询参数再打开抽屉，避免路由保护立即关闭编辑器。加载、错误和重试分别处理。
- 对照 `triggerView/BranchRegexModal.tsx`，分支正则改用 600px 设置分支弹窗，未设置时自动打开；可输入满足约束的具体分支，检查必填与匹配后读取提交。正则和当前分支分别保存，保留配置/工作流版本冲突检查；取消保留原选择，保存只清理变化仓库的提交/搜索，其他仓库保持不变。保存后同步画布分支，重新打开沿用已保存分支。匹配但不存在的分支返回空提交。
- 新构建记录源码类型、当次事件 ID、引用、提交与 Payload 的独立快照；源码页显示事件详情，重试沿用原快照。触发入口检查仓库、事件类型、过滤条件、提交和引用一致性，不能只凭同 SHA、旧事件或其他仓库事件发起构建。旧构建不补造事件信息。
- 以上为 Vue 3 + TDesign 与本地 Mock。GitHub/GitLab/Bitbucket 公共域名对应的是有限示例目录，Payload 为归一化演示结构；自托管 Provider、完整事件/选择器元数据、PR 检出/合并策略、固定过滤项、真实签名/接收/自动触发和 Go regexp 兼容性仍待接口及后续页面核对。没有完成全部上游状态的逐像素验收。

## 第十六轮：多平台、构建引用与 Buildpacks 联动

- 对照 `ciConfig/TargetPlatformSelector.tsx`、`CIConfig.utils.ts` 与 `CIConfigForm.tsx`，目标平台从单选改为可搜索、可创建的多选；预设为 `linux/arm64`、`linux/amd64`、`linux/arm/v7`。允许清空，新配置默认跟随构建节点平台；既有配置保留原值。自定义平台即时提示，应用保存与流水线覆盖保存共用确认弹窗，返回修改保留草稿，确认后才写入 Mock。平台存储为去重后的逗号分隔字符串。
- `BuildTargetPlatforms`、`BuildArguments`、`BuildSecretReferences` 与 `BuildPlatformConfirmation` 共用于应用配置和流水线覆盖。继承时平台为只读标签或未设置提示，引用不可编辑；允许覆盖以应用当前配置建立独立副本，删除覆盖恢复最新应用值。选材抽屉显示有效平台及两类引用数量，新构建与重试记录当次配置快照，不随后续应用/流水线变更改写。
- 上游 `CIAdvancedConfig.tsx` 与 `CIPipelineN/AdvancedConfigOptions.tsx` 通过可选扩展组件加载 `BuildSecrets`，当前本地安装的共享库不包含该组件的 UI 实现。依据 `dist/Common/CIPipeline.Types.d.ts` 的 `BuildSecretType`（`type/id/secretName/key`）和调用处的校验/保存契约，新增 Secrets／SSH 引用增删、来源、必填与组内 ID 去重表单；来源支持 `BUILD_INFRA`、`SOURCE_CODE`。这里只实现可用的 Mock 引用编辑，具体字段排布、目录选择与扩展版组件的逐状态视觉仍待核对，不能标记为上游完整 UI 等价。
- 对照 `CIBuildpackBuildOptions.tsx`，Buildpacks 增加语言、版本和可输入自定义 Builder 的联动表单；离线示例目录包含四种语言，版本选择维护相应的版本环境变量，自动检测/自定义 Builder 清理受管理参数并保留用户变量。Docker 构建参数与 Buildpacks 环境变量分别保存，三种构建方式切换保留各自草稿；兼容早期 Mock 的环境变量字段。Buildpacks 直接显示环境变量，隐藏 Docker 平台与 Secrets／SSH；有效构建快照不包含这些未启用的 Docker 选项。完整实时 Builder/语言/版本元数据与模板目录仍待补齐。
- 应用与流水线共用 `validateBuildConfig`，Mock 保存也校验引用、相对路径、平台和仓库；失败不递增配置版本。引用只存来源与键等白名单字段，丢弃额外凭据明文字段；数组和返回结果均为独立副本。没有读取真实 Secret、验证 Builder 可用性、下载镜像或执行注入/构建。
- 长表单截图发现配置导航与顶部页签随外层内容一起滚动，现改为固定配置工作区高度，左导航和主内容分别滚动，保存栏保持可见。新增 1440px/1280px 几何检查；部署模板和独立配置对比一并回归。超时字段仍沿用 Podry Mock 的秒制设置，不视为上游构建执行时限协议。

## 第十七轮：托管 Dockerfile 模板与共用编辑器

- 对照 `CICreateDockerfileOption.tsx` 与 `CreateDockerFileLanguageOptions.tsx`，把旧的「模板 + 应用模板」及自适应文本框改为一体化工具栏：Dockerfile 所在仓库、语言、框架、条件显示的重置修改与复制；正文固定 300px，增加行号、同步滚动、横向滚动与 Tab 两空格缩进，Shift+Tab 可离开编辑区。构建上下文继续显示在编辑器下方，根页面与流水线抽屉内部滚动，保存操作保持可达。
- 切换语言自动选首个框架并读取正文，切换框架立即读取。按语言/框架缓存模板基线，正文编辑不污染缓存；切回同一模板恢复缓存基线，重置恢复当前基线。保存并重新打开后，已保存自定义内容作为基线；旧配置没有模板身份时保留其自定义内容，已下架模板保留身份与正文供继续编辑。
- 新增 `useDockerfileTemplates` 管理目录、模板请求、加载/错误和缓存。连续切换只应用最后一次响应，等待期间仓库、上下文、参数变更保留；切换构建方式、关闭/销毁编辑区或转为只读后，旧响应不能写回。模板读取失败保留原正文并禁止保存，支持重试或返回当前内容；目录失败/空目录允许继续编写已有正文，空白正文仍执行共用必填校验。
- 应用构建和流水线覆盖共用同一组件。继承时仓库/语言/框架为只读值，正文只读、复制入口隐藏；允许覆盖建立独立草稿，删除覆盖立即回到应用正文，重新允许覆盖从当前应用内容开始。覆盖保存回读、取消/继续编辑/放弃和重置基线均经过页面检查，不改写应用配置。
- 托管 Dockerfile 的有效构建路径固定为所选仓库根目录 `Dockerfile`，自有 Dockerfile 路径仍在模式草稿中保留。应用/覆盖保存保留正文注释、空行、末尾空白和换行；新构建与重试快照包含当次语言、框架、正文及有效根路径，删除覆盖不改写历史。
- 模板元数据和正文由本地 Mock 返回，八个离线编辑样例涵盖 Node.js/Express/Next.js、Go、Python/FastAPI、Java/Spring Boot 和 HTML/Nginx，不代表上游实时模板目录或已经验证可构建的项目方案。没有写入 Git、访问模板服务、构建镜像或接入后端。当前代码编辑器未包含上游 Monaco 的语法高亮、补全等完整功能，也未声明所有状态逐像素一致。

## 第十八轮：资源 Manifest 工作区与草稿保护

- 对照资源详情的 `Manifest.component.tsx`，应用和集群入口共用深色编辑器、行号、复制/下载、编辑工具栏及原位左右分栏预览。左侧当前清单只读，右侧可继续编辑；继续修改立即使校验失效，重新检查后才可应用，返回编辑保留草稿。两栏支持纵横滚动联动，短清单截断滚动时不会反向拉回长清单，长内容在编辑器内滚动；Tab 插入两空格，Shift+Tab 保留焦点导航。
- 纠正此前字段过滤：只删除完整的 `metadata.managedFields` YAML 子树，保留 UID、resourceVersion、generation、creationTimestamp 和同名业务字段。没有托管字段时保留原文；有托管字段时通过 YAML 节点删除并保留注释和业务内容。读取失败时显示原文及错误，不做半截正则过滤。Mock 模拟保留提交中省略的服务端托管字段。
- 现有对象编辑要求一个资源文档，检查 YAML、必填身份及 apiVersion/kind/name/namespace 不变；无效输入保留草稿并原位报错。创建资源也改用 YAML 文档解析，避免多行内容中的伪字段干扰身份。修正两个开发环境 Deployment fixture 的命名空间，所有资源 fixture 的清单身份与引用一致。
- `useResourceManifest` 负责异步校验、保存、错误与重新读取：较旧校验、切换对象/集群和销毁后的响应不写回当前状态；保存失败保留草稿。使用 UID 与原始清单快照进行 Mock 乐观检查，冲突时保留草稿并提供重新读取；成功提交但读回失败单独告知，避免直接重复提交。这不是 Kubernetes resourceVersion 协议。
- 详情页签、资源操作、资源页签关闭/切换、关闭其他/全部、路由离开、集群/环境切换与两处顶部刷新均先处理未保存草稿。取消离开保留活动页签与正文，确认后才变更页签存储；关闭非活动资源不会打断当前编辑。页面关闭/刷新通过 beforeunload 提示；实际关闭浏览器后的草稿不持久化。环境切换关闭原活动详情，集群顶部刷新重读当前资源；修复同集群内资源深链不消费 `open` 参数的问题。
- 当前是本地字段检查和 Mock 保存，没有 Kubernetes schema/server-side dry-run、真实权限/并发验证。完整 Monaco 语法高亮/补全/差异块行对齐仍待补齐；GUI schema、锁定字段、desired/live 漂移比较依赖参考工程的可选扩展或服务，本轮没有编造对应能力，也未声明全状态逐像素一致。

## 第十九轮：Pod 日志与资源事件工作区

- 对照 `Logs.component.tsx` 和范围弹窗，应用与集群的 Pod 详情共用容器/上一容器/日志范围/下载/搜索工具栏。范围预设与上游一致：15/30 分钟、1/2 小时、500/1000/5000/10000 行；默认 500 行。500px 自定义弹窗含时长（分钟/小时）、正整数行数、浏览器时区的指定日期时间及全部可用日志；非法值和未来时间禁用完成，取消保留原范围与日志。
- 容器从 Pod `spec.containers/initContainers/ephemeralContainers` 三个列表解析，分组显示，不再误取环境变量、卷和状态的 `name`。应用资源树和日志分析的容器目录共用解析；分析中“全部容器”按各容器独立读取。开发 Pod 增加代理、初始化及临时容器的离线 fixture。上一实例独立记录，缺失时明确提示，不把当前实例日志改前缀当成历史。
- 搜索按 Enter/按钮提交，支持普通文本与本地 `grep -i/-A/-B/-C`、引号和 grep 管道过滤；显示结果与原范围行数。原文仅作为文本渲染，不执行命令；当前按字面文本匹配，没有实现完整 grep 正则/选项。下载保留所选范围的完整原文，不受显示搜索影响；历史实例文件名带 `previous`。
- 日志正文采用上游的 `#181920` 底色和 14px/1.4 等宽字号；支持换行、自动滚动、手动上滚暂停跟随、顶部/底部定位、暂停/继续和日志区 Ctrl+C。Ctrl+C 有选中文本或输入框焦点时保留复制语义。模拟追加只对活动页签的普通容器生效，暂停、上一实例、初始化/临时容器及错误态不追加；范围过滤没有结果时真实返回空列表，不再回填过期日志。
- `usePodLogs` 管理请求代次、加载/错误/不可用/空态与模拟流。快速切换、页签隐藏、刷新和销毁使旧响应失效；失败保留工作区内的重连入口。日志按页签激活读取，Manifest 不再预取日志。旧资源深链恢复指定详情页签与容器；非 Pod 的日志/终端页签回落 Manifest。
- 事件使用上游深色六列布局：类型图标、原因、消息、次数、年龄与最近发生，最近发生优先、交错行和固定表头。年龄只有 fixture 提供首次发生时间时才展示，否则为 `—`；按当前资源懒加载，独立错误/重试/空态不会阻断 Manifest。资源详情事件数在读取后显示。
- 仍为本地 Mock。没有连接 Kubernetes 日志或事件流，没有 NDJSON/WebSocket 重连、归档、ANSI/xterm 选择复制、虚拟列表、完整 grep 服务端语义和多 Pod 分析器的完整上游布局；模拟追加最多保留 10000 行（行数范围采用更小值）。当前局部截图验收不等于全部状态逐像素一致。

## 第二十轮：源码与镜像详情、跨入口标签与备注

- 只读核对本地 Devtron `EnvironmentList.tsx` 的镜像/提交入口，以及已安装共享库 `@devtron-labs/devtron-fe-common-lib` 4.0.14-pre-2 中 `ArtifactInfoModal` 的声明与打包实现。上游普通详情是右侧 800px 全高抽屉，源码卡片在上、连接线与镜像产物卡片在下；不是此前的居中 800px 弹窗。本轮按该结构用 Vue 3 + TDesign 重写，没有复制 React 组件。
- `ArtifactDetailsDrawer` 负责详情外框、部署环境/时间/操作人和元信息编辑入口；`ArtifactDetailsBody` 组合源码/镜像状态；`ArtifactSummaryCard` 展示标签、完整地址、Digest、来源、创建时间、Release tags 与备注，通过 `edit/details` 事件交给父层。`useArtifactDetails` 只在打开/展开时按应用和产物 ID 读取，直接读取关联 Build，不受历史第一页 50 条限制；失效的旧响应、应用串用和销毁后的写回被拒绝。镜像失败与关联源码失败分别重试。
- 概览的镜像标签与提交号、构建历史的产物、发布历史 Source 卡片与 Configuration 中的 Image 共用抽屉。没有关联产物时仅展示历史镜像地址；外部镜像明确没有构建源码；旧记录继续提示快照不完整，不借当前配置补造历史。完整复制镜像 tag、引用地址与 Digest，复制受限时提示手动复制。
- 选择镜像保留 1024px 抽屉和原有 Review/发布策略，详情在卡片内展开关联源码和完整 Digest。标签/备注入口改为可操作按钮，点击或展开不会切换当前选中镜像；镜像支持键盘 Enter/Space 选择，搜索覆盖镜像地址、仓库、Digest、Release tags 和备注。元信息保存后刷新目录，保留选择与展开状态。
- 构建历史、发布历史、概览与镜像选择写入同一份 Artifact 元信息，替换发布历史此前只在组件内存追加的字符串标签。编辑器有长度/数量校验、标签去空格/去重、未保存关闭/路由/刷新保护和保存期间禁用；异步保存固定当次输入，关闭/换目标/销毁后的旧回调不覆盖新编辑器。备注作为文本渲染，保留换行。
- 修复镜像导入的仓库端口/摘要解析，`registry:5000/team/app:v2` 不再把 `registry` 当成仓库。镜像卡片和历史使用统一 tag/digest 展示。确认发布后携带目标环境、本次记录和 Source 页签进入发布历史，避免落入“未选择环境”；历史 URL 从 Configuration 切回 Source 时同步页面。
- 仍为前端 Mock；跨入口保存只在当前页面会话有效，刷新恢复 fixture。没有接入镜像仓库、后端、权限策略或真实部署；标签软删除/审批/继承/治理、CI 产物 ZIP、源码文件变更与 Git diff、所有状态的逐像素验收仍待补齐。上游无源码时为空态，本地保留已记录的外部镜像信息以支持现有镜像部署路径。

## 第二十一轮：提交与 Webhook 源码信息、已排除提交

- 只读核对本地 Devtron `GitInfoMaterial.tsx`、`material/constants.ts`，以及共享库 4.0.14-pre-2 的 `GitCommitInfoGeneric`、`GitMaterialInfoHeader` 与 `GitChanges` 打包实现。普通提交展示 Git 链接、短 SHA 与完整 SHA 复制，Webhook 展示 PR/Tag 和分支信息；当前共享源码组件没有渲染文件差异面板，`changes/showChanges` 数据字段不能作为已存在 Diff UI 的证据。此前待办中的源码文件变更/Git diff 改为需要另找上游实际入口核对，不在这些入口添加自创 Diff 面板。
- 用 Vue 3 + TDesign 实现 `GitCommitDetails`、`GitWebhookDetails` 和 `BuildCommitCard`。构建历史、阶段历史、发布历史、概览镜像详情与选镜像展开继续通过 `BuildSourceSnapshot` 共用历史展示；选材卡片与已接收 Webhook 使用相同提交/事件信息。链接和复制不切换选中提交/事件，卡片支持 Enter/Space，子按钮键盘操作不会触发卡片选择。
- 提交复制完整 SHA，失败后在卡片中提供可选择的完整文本，重试成功收起该文本。PR 使用记录的编号/链接，提供源/目标分支和链接复制；Tag 使用当次 ref。链接规范化 HTTP/HTTPS、SCP/SSH 仓库，支持已识别的 GitHub/GitLab/Bitbucket/Azure 路径；去掉仓库 URL 的用户口令/查询参数，拒绝非 HTTP 链接。未知 Provider 保留短 SHA 和复制入口，不猜测提交页面。历史不使用应用当前地址、作者、时间或 PR 编号补全。
- 选材工具栏按上游增加“显示/隐藏已排除提交”菜单，各仓库独立保存当前抽屉内的显示状态；默认隐藏，搜索可定位排除项。排除卡片显示原因且无法触发构建，所有提交被排除时有专用空态；Webhook 的路径排除与事件过滤分别提示。刷新保留有效选择并清除失效排除项，开关、搜索、链接和复制均不清除已有有效选择。
- Mock 提交增加明确的 `changedPaths` 示例，依据 Git 仓库的有序包含/排除规则计算排除状态；`!` 排除，后匹配的规则覆盖先匹配，包含 `*`、`/*`、`/**` 的本地匹配。只有全部已记录变更路径均被排除的提交才禁止构建，混合修改仍可构建；缺少路径元数据不推断排除。Mock 触发层也拒绝绕过 UI 的排除项，所有嵌套路径和事件返回独立副本。正则构建快照分别记录配置的表达式与实际检出分支，重试沿用原快照。
- 仍为当前页面会话内的 Mock，不获取远程 Git、执行 Git diff、合并 PR、接收 Webhook 或启动真实构建。路径匹配是依据上游帮助文本实现的本地演示，尚无真实 Git 服务端规则一致性验证；企业 Provider、复杂 PR 策略、所有状态逐像素验收仍待继续。

## 第二十二轮：两个 Manager 共用 Pod 终端

- 只读对照 Devtron `Terminal.component.tsx`、`terminal/TerminalWrapper.component.tsx`、`terminal/Terminal.tsx`、`terminal/terminal.utils.tsx`、`CopyToast.tsx` 和 `config/constants.ts`：工具栏包括连接/断开、清屏、三类分组容器与 `sh / bash / powershell / cmd`；终端背景为 `#181920`，支持上下文全屏和恢复。文件/目录下载通过可选的 `@devtron-labs/devtron-fe-lib` 导入，当前参考仓库未提供该组件实现，不能以调用占位推断其完整界面。
- 新增 Vue 3 + TDesign `PodTerminalWorkspace`，应用与集群的 `ResourceDetailPanel` 共用。初次打开终端才创建 Mock 会话，深链/容器日志入口传入的容器会被保留；容器和 Shell 切换清理旧会话、清空旧回显并重新连接。普通/初始化/临时容器按组展示并组内排序，读取 Pod spec，不将环境变量等字段当成容器。
- 提供连接中、已断开/继续连接、失败/重试、离线/恢复、会话过期状态。已知已终止/等待中的容器显示明确原因，输入禁用；Pod 另一容器崩溃时，有明确 Running 状态的 sidecar 仍可用。示例 init 容器补明确 Completed 状态，日志仍可查看其历史。缺少状态不会被视为已证实真实可执行。
- 深色区域内提供命令输入、历史上下翻页及草稿恢复、Ctrl+C 中断、Ctrl+D/exit 断开、Ctrl+L/⌘K 与工具栏清屏。选中输出自动复制并提示，失败保留选择并说明原生复制方式。命令仅做本地字面回显，HTML/Shell 替换不会执行；不是 xterm、真实文件系统或远程 Shell。
- 全屏按钮与 Ctrl+Shift+F 展开；Esc 恢复、焦点回到调用位置，并约束全屏键盘焦点。顶部保留 Podry；应用入口显示应用/环境/Pod，集群入口显示集群/Namespace/Pod。离开终端页签退出全屏，已建立的会话可在同一资源面板内返回使用；连接中的隐藏、资源变化、主动断开和销毁会使旧请求失效，迟到成功返回的会话也会清理。
- `usePodTerminal` 独立负责会话生命周期、30 分钟过期、网络状态与命令历史；Mock 创建边界校验集群归属、Pod UID、实际容器、Shell 和已知状态，会话 ID 加序号避免并发碰撞。原有集群管理终端调用保持兼容。没有添加真实接口或后端合同。
- 仍需对齐：xterm/ANSI/光标与多行编辑、连接超时/并发限制等服务端状态、动态临时容器增删、可选文件/目录下载和更多终端状态视觉。集群管理/节点调试终端是独立入口，本轮只回归其可达性，没有把它视为已完成同等深度对齐。

## 数据与操作边界

- 页面通过 `src/api/index.ts` 读写同一份 Mock 数据；本轮新增的前端方法不能视为后端已提供相同端点。修改在当前页面会话内保留，刷新会重新加载固定 fixture；资源页签另由 Pinia 持久化。
- 资源读取按集群/Namespace 收敛，新建资源记录集群归属。新增 RBAC、存储、网络策略、HPA、配额、PDB、CRD 等 Discovery fixture；没有 fixture 的类型显示空态，可经 Manifest 创建示例。
- 删除/扩缩容/节点调度/Taints 会修改 Mock；重启只记录 Mock 事件，Drain 仅简化节点 Pod 列表，不执行 eviction，不模拟 PDB 或真实控制器。
- Manifest Dry run 使用 YAML 文档解析与必填身份检查，不是 Kubernetes schema/server-side 验证。编辑现有或创建 Manifest 都会使旧的校验失效，重新检查后才可 Apply；现有资源另检查身份不变。
- 终端、本地日志流、构建/发布和阶段任务均不是实际远程执行。
- 本次未改后端，未提交、暂存或推送；保留工作区原有 `crop-ref22.png`。

## 第二十三轮：节点详情、集群终端与节点调试

- 对照本地 `ClusterNodes/NodeDetails.tsx`、`ClusterNodes/ClusterTerminal.tsx`、`ResourceBrowser/ResourceList/AdminTerminal.tsx`；保持 Vue 3 Composition API + TDesign，参考仓库只读。
- 集群终端重写为薄路由与独立工作区/会话 composable：首行分组节点、可创建 Namespace、可创建公开镜像；次行 Terminal / Pod Events / Pod Manifest、断开/继续、清屏、bash/sh 与节点 Debug Mode。`node/namespace/image/shell` 四项 URL 可恢复并同步默认值，节点详情“调试”现在选择正确节点；自动选择隐藏并清除 Debug Mode。
- 镜像目录在上游由服务端配置提供，本地只给 BusyBox/netshoot 示例，支持自定义路径，不声称是上游完整目录。调试 Pod 只存在当前工作区的 Mock 状态，不写入集群资源存储；节点 taints 转换为 tolerations，Debug Mode 的本地清单展示 host 字段/挂载。
- 终端支持只读 kubectl 本地查询、节点/Pod hostname、历史与未提交草稿、Ctrl+C/Ctrl+D/exit、Ctrl+L/⌘K、选中复制、离线/恢复、过期和错误重试。暂停/继续及 Shell 切换复用当前调试 Pod，保留已应用的 Manifest 和生命周期事件；目标变化/快速切换/销毁会释放迟到会话，命令中断后忽略迟到输出，不执行任何真实 Shell。
- 调试 Pod 提供六列事件、深色行号 Manifest、隐藏托管子树、原位 Review、身份/节点/容器检查、重建确认和保存读回；隐藏的 managedFields 在应用时保留。页签、选择器、路由和刷新事件保护草稿；全屏提供节点/Namespace 元信息、快捷键、Esc/焦点恢复与弹窗层级。
- 节点详情动作移至页签同排；左右列独立滚动。资源 CPU/Memory 优先，元数据为 joined key/value 与复制、前十条/显示全部/收起，三类元数据各自保留展开状态；Taints 可编辑。Pod 默认名称升序，支持命名空间、数值百分比和时长排序、名称复制与详情导航。
- 节点 YAML 复用资源 Manifest 的编辑/原位 Review/Apply/校验失效/草稿保护与冲突读回；节点动作也保护未保存 YAML。节点概要/通用资源统一初始清单，Mock 写入同步 labels/annotations/taints/unschedulable；本地补字符串元数据、布尔调度字段与 taint effect 的基本检查，仍不代表 Kubernetes schema 验证。移除每次渲染都显示“刚刚更新”的虚假时间。
- 上游“Resource overcommitted”的触发实现检查 CPU `usagePercentage > 100`，提示文案却说明 limits；本轮保留上游这一条件与文案的不一致，便于后续用户统一调整。
- 仍待：真实调试 Pod 生命周期/终端连接、完整 xterm/ANSI/多行编辑、服务端超时/并发限制、可选文件下载、完整 Monaco 与节点所有状态视觉验收。没有扩大到接口或集群执行。

## 第二十四轮：资源发现身份、CRD 与节点列表

- 对照本地 `ResourceBrowser/ResourceList/Sidebar.tsx`、`utils.tsx`、`K8SResourceList.tsx`、`ColumnSelector.tsx`、`K8sResourceListTableCellComponent.tsx`、`K8sResourceListTableUsageCell.tsx` 与 `ResourceBrowser/Constants.ts`。参考仓库 HEAD 仍为 `ecea7af01c628e0b60720e53fe969e204cdbe8ef`，只读；Vue 3 + TDesign 重实现。
- 两处 Manager 的 Kind 树、计数、列表过滤和应用层级根节点改用 group + plural 身份。同 Kind 跨组按上游显示 Kind 父节点、API group 子节点；异步 Discovery 到达及浏览器前进/后退自动展开正确祖先。Jump to Kind 支持 Kind/plural/group/shortNames 搜索、K 聚焦、Esc 清空失焦，选择后清空搜索。未知分类排在已知分类之后。
- 集群列表支持 `resource` + `group` 查询参数，保留不带 group 的旧深链；显式未知 group 报 Discovery 不匹配，不读回其他组。切组更新列并清除旧勾选和排序；详情身份、操作回读与删除关闭页签包含 group，同名资源可同时打开独立页签。异步行操作忽略切换上下文后的迟到结果。
- 将工作区内列定义与正则抽取移至 `resourceListing.ts`：19 组内置资源列按 API group 匹配，另支持 Mock Discovery 的动态 printerColumns。结构化解析 ConfigMap/Secret Data、Service ports/NodePort/协议、Ingress、工作负载、存储、Job/CronJob、RBAC 与 CRD 字段；缺失字段显示未知，不用 Running 推断 1/1，不用 labels/annotations 数量代替 Data。简单点路径/数字下标可读；复杂 JSONPath 显示未知，未声称支持任意服务端 Table 响应。
- Discovery fixture 从 30 类增至 32 类（补 core Event 与第二组 Rollout）。新增两份 CRD 定义及两组同名 `checkout-canary` 资源，明确为本地示例：定义表展示 Group/Kind/Scope/served Versions/Established 条件，资源表按各组显示不同附加列，false/0 保留。Manifest 查看、修改及删除仍复用原有前端 Mock，不连接集群。
- 节点列表补齐上游 12 项字段：名称、状态、角色、错误、CPU、内存、K8s 版本、节点组、Pods、Taints、Age、禁止调度。CPU/Memory 使用节点详情中记录的实际用量、百分比与 Allocatable，提供比例条/Tooltip；缺失实际用量显示 NA，不由百分比伪造。SchedulingDisabled 独立警示色；集群级列表不受保留的 Namespace 查询限制。Pod 的 Node 字段可进入节点详情。
- 列选择拆为 `ResourceColumnSelector`，支持搜索、空态、草稿勾选、Apply 与点击外部应用；节点 name/status/errors 固定必选。名称列横向固定，表格自行滚动；名称默认升序，百分比/计数/存活时间按数值比较，未知值始终置后。行链接支持 Enter、上下/Home/End 移动及 Shift+F10 菜单。删除/扩缩容弹窗表单改用明确类名，避免通用 label 样式把复选框与文字排成两行。
- 尚有差异：完整节点 label/node-group/K8s-version 筛选、Jump 搜索浮层的全部上游行为、任意 GVR/动态 Table/复杂 JSONPath、URL 排序分页、Discovery verbs 与权限控制及所有状态截图仍待继续对齐；Discovery verbs 本身不等同于用户 RBAC。真实 API 按用户要求暂缓，本轮无后端修改、真实资源写入或全页面逐像素验收。

## 第二十五轮：节点组合筛选与 Jump to Kind 浮层

- 对照只读参考仓库的 `ResourceList/NodeListSearchFilter.tsx`、`ResourceList/constants.ts`、`ResourceList/utils.tsx`、`ResourceList/Sidebar.tsx`、`ResourceBrowser/Utils.tsx`。HEAD 仍为 `ecea7af01c628e0b60720e53fe969e204cdbe8ef`；继续以 Vue 3 + TDesign 重实现，接口暂缓。
- 新增 `NodeListFilters` 和 `useNodeListFilters`。节点列表提供 Label、Node Groups、K8s Version 三类多选：同类值 OR、类别之间 AND；标签精确匹配 key=value，允许合法空值，节点组和版本精确匹配，空选项不参与匹配。选择先保留草稿，Apply 写入 `label` / `nodeGroup` / `k8sVersion` URL；点击外部或 Esc 取消当前草稿。可逐项移除标签或 Clear filters，保留名称搜索、命名空间和其他 URL 参数。
- 名称搜索使用 `searchKey` URL，支持深链、刷新及浏览器前进/后退。候选项从当前集群完整已加载节点数据生成，不随已应用筛选缩减；缺失节点组/版本不添加空选项，未知已选值仍显示并可清除。当前版本候选来自本地节点 Mock，尚非上游的独立版本查询接口。补充 `mainnode` / `mainnode-2` / `devnode` 样例标签，节点概要、Manifest 与列表继续共享元数据。
- 搜索、Filters 和 Column 位于同一工具栏；`/` 聚焦节点名称搜索，F 打开筛选并聚焦选项搜索。使用项目既有 `list-search` 约定避免同时打开全局搜索；等 TDesign 浮层可聚焦后转移焦点，关闭/销毁时取消待处理的聚焦。
- 两处 Manager 共用 `KindSearchPicker`：仅非空查询打开独立结果浮层，原树保持可见；重复 Kind 展示 API group，精确短名称优先，匹配文字安全高亮。支持 K、Esc、Enter、上下键循环及 Home/End，鼠标选择/失焦关闭后清空输入；无匹配显示空态。Kind 切换清除分页/排序查询，离开 Event 移除 eventType，保留命名空间等相关上下文。
- 规则和候选数据提取放入 `resourceFilters.ts`，页面负责组合；节点列选择仍复用 `ResourceColumnSelector`。尚需继续：URL 排序分页、任意 GVR/服务端 Table、复杂 JSONPath、Discovery verbs/真实权限、完整字段、全部筛选/浮层视觉状态验收；本轮不代表与 Devtron 全页面逐像素等价。

## 第二十六轮：资源列表 URL 排序分页与事件筛选

- 对照只读参考仓库 `ResourceList/K8SResourceList.tsx`、`Sidebar.tsx`、`ResourceFilterOptions.tsx`，并核对已安装 `@devtron-labs/devtron-fe-common-lib@4.0.14-pre-2` 的 `useUrlFilters` 与 Pagination。查询参数使用 `pageNumber`（从 1 开始）、`pageSize`、`sortBy`、`sortOrder=ASC/DESC`；默认每页 100 条，普通资源提供 100/150/200、节点提供 20/40/50，并保留跨 Kind 带入的当前条数，避免选择框空白。
- 新增 `resourceListState.ts`、`useResourceListState` 与 `ResourceListPagination`，普通资源和节点共用受控表格状态。先筛选全部匹配行，再全量排序、最后截取当前页；普通资源默认按 Namespace（无该列时按 Name），节点按 Name。排序在同列 ASC/DESC 两态循环，不因 TDesign 的第三次点击回到其他默认列。无效页码/条数/列/方向有安全回退，超出页码在对应加载完成后校正，删除末页最后一行退回有效页，避免加载中空数组破坏深链。
- 普通资源搜索也使用 `searchKey` URL，匹配当前 Kind 展示字段；名称/命名空间/事件类型/节点筛选/排序/每页条数的用户操作重置页码。浏览器前进后退直接恢复 URL 的搜索、命名空间、排序、条数和页码，不由双向 watcher 再次重置；Kind 切换清理旧排序/页码，保留搜索与条数。异步列表和集群请求忽略旧响应。
- 分页显示真实匹配总数、当前范围、最多五个页码、上一页/下一页和 Rows per page；按钮可键盘操作并标注当前页。翻页、排序或筛选清空之前的勾选，仅对当前页执行批量操作；表格内容独立滚动，表头/搜索和底部分页栏常驻，列表上下文切换回到首行。
- 事件页拆为 `ResourceEventsTable`，默认 Warning、可切换 Normal，`eventType=normal` 写入 URL；默认 Last seen 升序（最近发生优先），计数按数值排序，事件名称/类型/命名空间/原因/消息/次数可搜索，共用 URL 分页及空态。真实事件流和权限仍未接入。
- 数据仍完全来自前端 Mock；浏览器的大列表由现有 YAML 创建页面一次创建 100 个 ConfigMap 得到，不扩充默认 fixture、不修改 Vue 内部状态。任意 GVR/服务端 Table、复杂 JSONPath、独立版本查询、完整 Discovery verbs/RBAC、所有字段和逐状态视觉仍待继续，不能据此宣称全复刻已完成。

## 第二十七轮：两个 Manager 共用动态资源页签

- 对照本地参考同一提交的 `common/DynamicTabs/{DynamicTabs.tsx,DynamicTabsSelect.tsx,useTabs.ts}`：固定入口与动态资源页签分开，动态区域横向滚动，选中项进入可见区域；右侧提供当前资源同步/刷新和可搜索页签菜单。没有运行或修改参考工程。
- 新增 `ResourceWorkspaceTabs`，两处 Manager 共用。搜索匹配 Kind、名称、命名空间和 API group，列表显示资源身份和活动勾选，支持直接关闭单项、无结果状态、键盘上下循环/Home/End/Enter/Escape 与外部关闭。关闭按钮改为独立原生按钮，避免嵌套在选择按钮内；多页签/1280px 下固定入口、工具区和浮层保持可用。
- 关闭活动页签优先回到本次会话最近访问的资源或固定列表，跳过已关闭项；应用作用域、集群、命名空间和 group 继续隔离，关闭接口也校验作用域。访问顺序不写入持久化，刷新页面后不声称能还原此前的访问历史。
- 当前资源刷新复用 Manifest 草稿确认，只有实际详情读回成功才更新同步时间；确认期间重复点击不会重复刷新，确认期间已更换活动资源则丢弃旧刷新。原有右键关闭/关闭其他/关闭全部和行入口继续使用父页面的草稿保护。
- `ResourceDetailTabs` 补左右/Home/End 焦点移动，Enter 激活仍经过原有离开确认。日志和终端只由活动工作区向上同步实际容器选择；应用的“在集群中查看”保留 Manifest/Events/Logs/Terminal 页签与当前容器，不再总是回到 Manifest。
- 当前仍是前端 Mock。详情头部、更多终端/日志能力、完整编辑器、任意 GVR/服务端 Table 以及全部状态视觉继续列为差异，本轮没有声明全部 Devtron 页签/编辑器行为逐像素等价。

## 第二十八轮：资源详情共用操作栏与 URL 恢复

- 对照同一只读参考提交的 `NodeDetail.component.tsx` 与 `ResourceList/NodeDetailComponentWrapper.tsx`：资源详情使用 32px 页签/操作同排，移除额外可见身份头；Kind/名称/Namespace/UID 保留在无障碍身份文本中，动态页签继续展示名称并提供搜索身份信息。
- 新增 `ResourceDetailActions`，Manifest、事件、日志和终端共用。隐藏托管字段、编辑/预览/应用/取消紧随详情页签，重启位于其后；Infrastructure 的删除靠右，Application 详情按参考不显示该删除入口。扩缩容与 Secret 明文通过更多操作继续访问，复制/下载移到编辑器底栏，忙碌状态禁用资源操作；Manifest 草稿保护继续共用。
- 新增 `resourceDetailLocation.ts` 与 `useResourceDetailLocation`。两处 Manager 的 `resourceTab` / `container` URL 保存当前详情页签与容器，详情切换进入浏览历史，容器切换替换当前记录；路由保护接受后才更新 store。返回固定列表或切换环境清理详情参数，保留环境、列表搜索/命名空间等上下文。
- 现有 `tab` 标识本身包含作用域、集群、group、plural、Namespace、名称，可在清空本地页签存储后恢复当前资源。Infrastructure 通过 Discovery 解析 Kind，Application 限于当前应用已加载资源；校验作用域/集群/地址，拒绝非法地址，支持 `system:discovery` 等 RBAC 名称，仅核心 Pod 开放日志/终端。旧资源详情路径与已有持久化页签兼容；不恢复未保存草稿或先前会话访问顺序。
- 本轮仍为 Vue 3 + TDesign 前端 Mock。详情完整 GUI/Schema、期望/实时清单比较、动态临时容器、真实权限与所有状态逐像素验收仍待继续，不代表真实 API/Kubernetes 接入完成。

## 第二十九轮：期望与实时 Manifest 比较

- 对照同一只读参考提交的 `NodeDetail.component.tsx` 与 `NodeDetailTabs/Manifest.component.tsx`：Application 顶层资源的 Manifest 只读工具栏增加比较入口，打开后期望在左、实时在右，两侧只读；关闭按钮位于期望侧标题，关闭后焦点返回入口。Pod、ReplicaSet 等受控制器管理的子资源以及 Infrastructure 不显示该入口。参考中的外部 Helm/配置漂移开关依赖后端能力，本轮仅提供明确标识的本地演示。
- 新增 `ResourceManifestComparison` / `useResourceManifestComparison` / `resourceManifestComparison.ts`。期望清单在 Mock fixture 初始化时独立捕获，实时编辑、重新打开和重新读取均不把当前实时值提升为期望；快照缺失显示空态，加载失败可重试，UID/集群切换和组件销毁忽略迟到响应。期望来源仅标注“演示期望快照”，不冒充 Helm release 或 Git 历史。
- 比较忽略顶层 status、服务端身份/托管字段及 last-applied 注解，递归整理映射键顺序，保留数组顺序、标量类型与配置变化。身份不匹配、多文档、循环 YAML 引用和过复杂结构显示错误，不以实时资源填补快照。当前规则不是 Kubernetes 默认值补全、predicted live 或服务端 Schema 归一化。
- 左右清单显示增删行，提供上一处/下一处差异与 F7/Shift+F7 循环跳转、联动滚动、各侧独立复制和带 desired/live 后缀的完整下载；无差异状态明确显示。原有可编辑 Review 与只读期望比较独立，保留编辑草稿离开保护；比较状态离开无需草稿确认。
- 仍为 Vue 3 + TDesign 前端 Mock。完整 Monaco 高亮/补全/差异块行对齐、GUI schema、锁定字段、真实期望来源/服务端归一化与全部状态逐像素验收仍待继续。

## 第三十轮：Application / Infrastructure Management 概览

- 以本地 `D:/workspace/devtron-dashboard/src/Pages-Devtron-2.0/{ApplicationManagement,InfrastructureManagement}/Overview` 为依据，对齐两个 `/overview` 路由的面包屑、整页灰底、1200px 内容区、20px 内边距、32px 分区间距及 8px 卡片间距。指标卡恢复左侧名称/数值、右侧图标与悬停跳转结构；基础设施路由正确选中 Infrastructure 导航。
- 应用概览保留三张总览卡和六张工作流卡，依次展示 DORA Metrics、Triggers & Build Time、Most & least triggered pipelines。构建/耗时/发布切换、独立时间范围、图例开关、流水线分类/数值排序/分页及历史深链均可操作。刷新重算外部镜像计数，生产流水线按 CD 的生产环境绑定统计。
- 基础设施概览按顺序展示健康/节点错误/调度环图、集群分布、Cluster Capacity & Resource Allocation、节点分布；补厂商/版本与集群/Autoscaler 分组、排序、容量/使用/请求/限制的独立展示、分页及节点入口。点击健康图例打开可搜索的集群/节点明细抽屉，并可进入现有详情页；Unknown 节点解释缺失信息，不生成不存在的节点身份。
- CPU/内存容量只汇总可达集群，按 Kubernetes 单位换算；不可达集群显示提示并链接至带状态筛选的集群列表。节点调度和错误读取实际返回的节点详情，当前 fixture 的 3/9 个已读取节点之外保留 Unknown；厂商只根据显式 providerID 识别，Autoscaler 目前识别 Karpenter/Cast AI 标签。
- DORA 的发布频率与失败比例只使用已返回的生产发布记录；没有已结束生产发布时显示空态。缺少提交交付/故障恢复事件和按流水线的效能分级时，不生成交付周期、恢复时间或评级。安全扫描/GitOps 显示缺失值。当前历史接口每个应用最多 50 条，检测到截断时提示统计不完整；应用目录遍历分页。仍是 Vue + TDesign 前端 Mock，未增加后端统计接口，也不代表真实 Kubernetes 或全状态逐像素验收。
- 验证：最终 `npm run build` 类型检查和生产构建通过，保留既有 npm 配置及约 1.318 MB 主 chunk 警告。`node scripts/check-management-overview-data.mjs` 的 23 项数值/日期检查通过；`node scripts/check-management-overview-parity.mjs http://127.0.0.1:5197` 的 39 项最终生产包浏览器检查通过；`node scripts/check-management-overview-states.mjs http://127.0.0.1:5196` 的 19 项开发服务器隔离内存 Mock 状态检查通过。后两者均无运行时错误/Vue 警告；覆盖健康明细、跳转、刷新、800/1024/1280px、全部不可达、部分失败/重试、空数据、生产失败比例、历史截断、排行分页及跨页应用计数。截图与结果分别位于 `web/screenshots-management-overview-parity/` 和 `web/screenshots-management-overview-states/`，已人工查看两页、容量/节点及异常状态截图。

### 概览本土化补充（2026-11-23）

- 保持上述 Devtron 信息层级和布局，将两个概览页的页头、模块导航、指标卡、DORA/趋势/排行、图例、时间筛选、排序分页、空态、提示及明细抽屉统一为简体中文；移除应用指标卡中的 Devtron 产品名称。DORA、GitOps、CPU、Kubernetes、云厂商/扩缩容工具及真实资源名称保留原标识。
- 健康、调度及错误分类只在展示层转换，原始状态仍用于图例选择和明细过滤；厂商/版本/扩缩容分布保留稳定 ID，仅转换兜底文案。名称排序使用中文区域规则，菜单兼容中文和原英文关键词；刷新时间采用本地时区 24 小时制，耗时采用秒/分钟/小时。
- 验证：类型检查与生产构建通过，既有 npm 配置和主 chunk 警告保留；23 项数值/日期/耗时、41 项生产预览浏览器、19 项隔离内存 Mock 状态检查通过。浏览器无运行时错误和 Vue 警告，覆盖中文/英文关键词搜索、24 小时时间格式、中文图例明细、跳转、分页和 800/1024/1280px 布局。已查看两页及健康明细中文截图；截图沿用上述目录。这些证据仍仅限前端 Mock。

### 概览路由归一（2026-11-23）

- 应用概览统一为 `/apps/overview`（`apps-overview`），基础设施概览统一为 `/clusters/overview`（`clusters-overview`），顶部应用/集群导航的概览入口同步更新。原 `/application-management/overview`、`/infrastructure-management/overview` 与原命名路由保留为重定向，查询参数和锚点继续保留。
- 外层壳根据 `meta.managementOverview` 识别概览布局和中文标题，避免新路径被应用/集群详情匹配规则误判；`/clusters/:clusterId` 及 `/projects/:projectId/apps/:appId/overview` 继续使用原有工作区。
- 验证：`npm run build` 通过，保留既有 npm 配置及主 chunk 警告；概览生产包 45 项与隔离内存 Mock 状态 19 项浏览器检查通过，零运行时错误和 Vue 警告。包含新地址直达、导航入口、旧地址参数/锚点兼容、详情工作区和 800/1024/1280px 布局；证据仅限前端 Mock。

## 第三十一轮：资源原生差异编辑器

- 继续对照同一参考提交的 `NodeDetailTabs/Manifest.component.tsx`，并核对已安装共享库的 `CodeEditor`、`CodeEditorRenderer` 类型及实现。当前上游实际使用 CodeMirror 6 / MergeView；此前文档中将完整编辑器统一称为 Monaco 不准确。本轮使用原生 CodeMirror 包由 Vue 3 封装，不引入上游 React 组件。
- 新增 `ResourceYamlDiffEditor`、`ResourceDiffNavigation` 与 `resourceYamlMerge.ts`，共用于 Application 期望/实时比较、两处 Manager 的资源 Review，以及集群调试 Pod Review。原清单始终只读；资源 Review 右侧可继续编辑，另外两类比较两侧只读。右侧修改沿原有 v-model 同步，立即使旧校验失效；校验、应用/读回、重建调试 Pod 和离开草稿保护仍由原工作区管理。
- 多行增删使用原生视觉占位对齐相同后续行，增加行内字符差异、真实 YAML 语法高亮、嵌套折叠、原生选择/撤销重做、各侧独立查找与右侧可编辑时的替换、Ctrl+F/Escape 和循环 F7/Shift+F7。视觉占位不写入文档，中文、注释、字面 HTML 和末尾换行继续作为原文保存/复制。
- 两栏固定高度并内部滚动，保留程序滚动不反向拉回另一栏的保护；长清单只渲染可视区域，完整复制和保存仍包含未渲染行。组件卸载销毁原生实例/滚动监听，迟到的懒加载不创建编辑器；加载错误可重试。CodeMirror 运行时按需加载为约 381 KB（gzip 125 KB）的独立生产 chunk；保留 17 个运行时依赖的许可证文本 `web/public/licenses/codemirror-LICENSES.txt`。
- 本轮只升级资源双栏比较/Review；单栏普通资源编辑器、其他配置页、上游全部搜索工具栏/差异缩略图、GUI/schema/字段锁定/补全、真实期望来源和服务端归一化仍待继续。当前仍为前端 Mock，不代表真实 Kubernetes 或所有状态逐像素等价。

## 第三十二轮：单栏 Manifest 与调试 Pod 编辑器

- 继续核对参考 `Manifest.component.tsx` 的单栏 `CodeEditor` 和 `autoFocus: isEditMode`。两处 Manager 的资源 Manifest、节点 YAML、集群调试 Pod 的普通查看/编辑统一改为 Vue 3 封装的原生 CodeMirror；进入编辑自动聚焦，只读查看不抢焦点。资源页脚和调试 Pod 工具栏补可见查找入口。
- 新增 `resourceYamlEditor.ts` 管理单栏原生实例；抽出 `resourceYamlSetup.ts`，单栏和双栏共用 YAML 高亮、深色主题、行号、折叠、原生选择、查找/替换、撤销重做及键盘配置。Tab 两空格缩进，Shift+Tab 保留正常焦点导航。父工作区继续负责校验/Review/保存读回与草稿保护。
- 原生文本变更通过 v-model 同步；只读同时限制状态与 DOM 输入，外部资源快照替换清空旧撤销历史，避免撤回其他资源文本。保留原文注释、中文、字面 HTML 和末尾换行，托管字段切换继续显示完整子树。实例按需加载并在卸载时销毁，迟到加载不创建已卸载编辑器。
- 千行 Manifest 在单栏内部纵横滚动，只渲染可视行；复制、Review、保存读回仍处理完整文本。共享运行时约 357 KB（gzip 117 KB），差异功能另按需加载；没有新增依赖。
- 本轮范围为资源普通查看/编辑与调试 Pod；创建资源抽屉和其他配置编辑器、完整上游工具栏/差异缩略图、GUI/schema/锁定字段/补全仍待继续。接口仍使用前端 Mock。

## 第三十三轮：资源创建抽屉与逐项应用结果

- 核对同一参考提交的 `ResourceBrowser/ResourceList/CreateResource.tsx`、`Constants.ts`、`PageHeader.buttons.tsx` 与结果表格样式。参考实际流程是空白 YAML → 直接 Apply → 保留逐项结果 → Edit YAML / Close；此前创建抽屉必须先 Dry run、成功后自动关闭的交互不符，本轮以参考为准替换。现有对象编辑的校验/Review 流程继续保留。
- 创建抽屉调整为 1024px，窄屏限制为视口宽度；空白原生 CodeMirror 自动聚焦，多文档提示、查找入口与底部 Cancel / Apply 同屏。空白/纯空白禁止提交，支持原生高亮、查找替换、撤销重做和完整原文。修复编辑器先于抽屉显示时首次聚焦失效的竞态，开启 TDesign 的显式关闭按钮。
- `ResourceCreateDrawer` 负责布局、关闭与路由交互；`useResourceCreation` 管理编辑/提交/结果状态与迟到响应隔离，`ResourceCreationResults` 展示类型/名称/状态/说明四列。按每项实际结果区分已创建、已更新、失败与跳过，未知成功只显示已应用；同名结果逐项保留，失败说明按字面文本渲染，不伪造成功。
- 应用期间展示专用等待页，禁止重复提交、取消、关闭与路由切换；创建浮层内 K、Ctrl+K 和 / 不触发底层导航/搜索，原生编辑器查找的 Escape 先关闭查找。请求失败返回编辑并保留全文；部分成功结果也保留在抽屉，返回编辑恢复提交的完整 YAML。
- 结果关闭、标题关闭和 Escape 都按累计写入状态刷新资源列表与 Namespace 选项，并恢复创建入口焦点。此前成功后再次提交失败仍保留刷新标记；取消草稿后重新打开是空白且撤销历史独立，跨集群和卸载后的迟到结果不污染当前会话。
- 千行 YAML 在编辑器内部纵横滚动并虚拟渲染；长结果列表内部滚动、固定表头和底部操作栏，新增 1280px / 640px 抽屉布局检查。接口继续使用现有前端 Mock；真实 Kubernetes schema、权限、API 和全部状态逐像素验收仍未完成。

## 第三十四轮：应用配置与历史快照的原生 YAML 编辑器

- 核对参考 `Pages/Applications/DevtronApps/Details/AppConfigurations/MainContent/DeploymentTemplate/DeploymentTemplateForm.tsx`、`Pages/Shared/ConfigMapSecret/ConfigMapSecretData.tsx` 和共享库 `DeploymentConfigDiff` 的实际代码。部署模板、ConfigMap/Secret、试运行、历史快照的单栏 YAML 统一复用原生 CodeMirror；环境/历史对比的 YAML 改用原生 MergeView，移除手写 LCS 和逐行 `<pre>`。保留既有 GUI、保存/版本、Patch/Replace、遮蔽与离页确认逻辑。
- `DeploymentValuesEditor` 作为应用配置适配器，只负责 typed v-model/只读合同和标题、状态、查找/操作插槽；`ConfigurationDiff` 保留 GUI 参数表和模式选择，`ConfigurationYamlDiff` 负责双栏标签、两侧查找和差异导航。共用编辑器继续管理懒加载、原生实例与卸载，业务父组件继续管理草稿和保存。
- 单栏支持高亮、行号、折叠、查找替换、原生撤销重做和 Tab 两空格缩进，Shift+Tab 可移出编辑器；应用配置不强制抢焦点。ConfigMap 表单固定 360px 编辑区域，历史 YAML 360px、历史比较 420px；快照面板限定为现有配置列的 800px 最大宽度，修复长内容撑宽外层。长配置内部纵横滚动与虚拟渲染，保存和复制保留完整文本及末尾换行。
- 环境/历史比较提供原生行内/多行差异、同步滚动、F7/Shift+F7 和上一处/下一处。开启“仅显示差异”折叠未改范围，点击可双侧展开；折叠不删减文档，全文复制仍包含不可见内容。查找命中折叠区时自动展开两侧对应范围并滚动到结果，折叠提示中文显示。
- 交换两侧和切换配置时同步原生可访问标签、文档、差异数量及折叠范围；外部文本、只读或标签变化会重置单栏历史，避免撤销恢复其他配置或已隐藏 Secret。显隐仅保留当前草稿，隐藏后的查找/复制/撤销不包含明文，保存仍只持久化键与挂载元数据。
- 本轮继续使用前端 Mock，没有新增依赖或连接后端/集群。完整上游工具栏/差异缩略图、补全/schema/锁定字段、Dockerfile/任务脚本编辑器及全状态视觉仍待继续核对。

## 第三十五轮：Dockerfile 与流水线任务的原生代码编辑器

- 对照 `ciConfig/CICreateDockerfileOption.tsx`、`CreateDockerFileLanguageOptions.tsx`、`CIPipelineN/CustomScript.tsx` 及安装的共享库 CodeEditor 实现，确认 Dockerfile/Shell 模式、300px 高度、浅色编辑区/行号和覆盖只读行为。应用构建、CI 构建覆盖、CI/CD 前后置 Shell 及容器挂载脚本统一接入原生 CodeMirror，移除 textarea 与手工行号；不把脚本当作 YAML 解析。
- `ScriptCodeEditor` 管理懒加载、实例/重试、输入合同和原生查找的 Escape；`DockerfileCodeEditor` 与 `TaskScriptEditor` 分别负责业务标签、模板上下文和 Shell 查找入口，父组件继续持有正文、模板目录、任务和保存/校验。抽出 `codeEditor` / `codeEditorSetup` 共用内核，资源 YAML 通过原有适配层继续使用深色主题与 YAML 模式。本轮新增 `@codemirror/legacy-modes`，Dockerfile/Shell 语法按需加载。
- 原生查找替换、Ctrl+F、Tab 两空格、Shift+Tab 离开、撤销/重做、全文复制与千行虚拟渲染均作用于完整文本；保存保留 shebang、中文、注释、空行及末尾空白/换行。正文替换、仓库/模板身份、任务或执行方式/挂载上下文变化重置撤销历史，表单校验状态更新保留当前历史。模板原有缓存、重置、错误重试和在途响应隔离继续由父层管理。
- 继承/加载期间禁止编辑；继承态仍可查找，但不显示替换。允许覆盖、删除覆盖、关闭重开及切换任务时不会撤销恢复上一份草稿。CI/CD Shell 和容器脚本参与原有保存、必填校验与取消/放弃保护；关闭脚本挂载保留当前内容，再打开建立独立历史。
- 修复代码查找的 Escape 冒泡导致整个 TDesign 流水线抽屉关闭的问题：先关闭查找并恢复编辑器焦点，再允许后续 Escape 使用抽屉原有关闭逻辑。1280px 下编辑区内部滚动，任务侧栏和底部保存栏保持可达。截图与结果在 `web/screenshots-script-editor-parity/`，覆盖应用 Dockerfile、长 CI Shell 和 CD 后置 Shell。
- 仍为前端 Mock，没有连接 API、模板服务、Git、执行器或 Kubernetes；完整上游工具栏/差异缩略图、schema/补全/锁定字段、扩展版配置/审批与全部页面状态的视觉对账仍待继续。

## 第三十六轮：共用双栏差异缩略图与查找焦点

- 核对本地共享库 `CodeEditor/Extensions/DiffMinimap.tsx` 的安装包实现及 `CodeEditor/types.d.ts`：普通双栏右侧为 30px 缩略图，支持点击定位、拖动视口；`collapseUnchangedDiffView` 隐藏缩略图。没有把任意换行、格式化或全屏按钮当作已确认的上游要求。
- `ResourceYamlDiffEditor` 继续负责 Vue 加载与布局，`resourceYamlMerge` 管理原生文档、差异与滚动，独立 `resourceDiffMinimap` 模块负责缩略图和指针/键盘交互。资源编辑 Review、期望/实时只读比较、应用环境配置和发布历史对比共用同一实现；标题、两侧导出栏为 30px 缩略图留位，保持正文分栏对齐。
- 缩略图按原生已测量行块绘制两栏文本及增删颜色，包含插入间隔；Canvas 按输出像素限制采样数量，不再克隆两套编辑器 DOM。长文档完整复制、校验/应用和撤销重做仍由原生编辑器处理。点击、拖动及 Home/End/PageUp/PageDown/方向键只改变滚动；两栏分别保留自身横向滚动条形成的末尾边界。
- 滚动、文档更新、折叠/展开、窗口尺寸和显示密度变化刷新缩略图与视口。仅显示差异时隐藏并移出 Tab 顺序，恢复完整视图后重新绘制；关闭比较/切换路由释放 ResizeObserver、显示密度监听、指针捕获和绘制帧。整个页面的 pointer-events/user-select 不参与拖动状态。
- YAML 单栏和双栏先处理原生查找的 Escape 并返回对应编辑器焦点，保留外层抽屉及草稿；下一次 Escape 仍交给外层原有逻辑。只读/遮蔽、草稿保护和业务校验合同继续由现有父组件管理。
- 仍为前端 Mock。缩略图交互和列宽已对照上游，Canvas 文本采样与上游缩小 MergeView 的绘制方式不同，尚无逐像素一致性评分；完整查找工具栏、schema/补全/锁定字段、默认配置切换及扩展权限状态仍需继续对齐。

## 第三十七轮：共用查找/替换工具栏

- 对照相同参考提交，以及已安装共享库 `@code-editor-B65UyYB4.js` 内的 Find/Replace 面板、`B8` 计数逻辑和快捷键，复刻可收起替换行、大小写/全词/正则开关、当前位置/总数、上一项/下一项、选择全部及关闭的布局与交互。原生输入和 TDesign 按钮由 Vue 组件渲染；深色 YAML、浅色 Dockerfile/Shell 共用适配层，没有引入 React 运行时。
- `CodeEditorSearchPanel.vue` 只展示查询快照并发出动作；`codeEditorSearch.ts` 使用原生 SearchQuery、选择、替换与历史命令，查询/替换展开状态归当前编辑器上下文，业务草稿仍由原页面持有。Ctrl+F、Ctrl+Alt+F、Enter/Shift+Enter、F3/Ctrl+G、上游 Ctrl+Enter 与提示的 Ctrl+Alt+Enter、Escape 均接入；补 Ctrl+H 作为直接打开替换的常用别名。
- 输入查询和组合开关即时更新全篇计数，选区变化更新当前位置；无结果、空查询和无效正则禁用相关动作，提供可访问的状态和错误标记。选择全部使用原生多选区，支持一次输入修改多个匹配和一次撤销；超过原生命令的 1000 项上限时禁用全选，计数仍显示完整总数。
- 替换区关闭后重新打开保留当前编辑器内状态；只读继承、期望/实时、比较原栏及隐藏 Secret 不显示替换入口，执行动作时再次检查只读。Secret 显隐、切换模板/任务/资源沿用已有的实例/历史隔离；关闭面板或 Escape 返回对应编辑器焦点。编辑器销毁卸载 Vue 面板，不添加正文代理、隐藏输入或测试钩子。
- 同时覆盖普通 Manifest、Review、创建抽屉、部署 Values、ConfigMap/Secret、环境/历史比较、Dockerfile 和 CI/CD Shell/容器挂载脚本。双栏各自持有查询，窄栏内换行，避免工具栏越界；保留原生虚拟文档、保存、草稿保护及校验失效链路。
- 已核对上游默认比较切换的实际条件：共享 Header 需要提供 `lhsValue`，本轮检查的部署模板、ConfigMap/Secret、托管 Dockerfile 调用没有传入该值。未据共享 Header 的能力凭空新增这些页面的默认比较入口；受保护草稿、Chart 默认历史及 Express Edit 比较仍按实际调用继续核对。schema/补全/锁定字段和全状态视觉差异仍未完成。

## 第三十八轮：YAML 诊断、Values schema 与字段补全

- 参考提交仍为 `ecea7af01c628e0b60720e53fe969e204cdbe8ef`。核对 `DeploymentTemplateForm.tsx:254`、`ConfigMapSecretData.tsx:327`、`Manifest.component.tsx:746`，以及共享库 `@code-editor-B65UyYB4.js` 的 `W8`、`EPe`、`vPe` 和 `X8`：`noParsing` 控制初始内容归一化，不会关闭非比较模式的 schema 校验/补全/悬浮说明；普通 Manifest 和 ConfigMap/Secret 调用没有提供 Chart schema。折叠比较排除语法诊断，双栏没有附加 Chart schema。
- `resourceYamlSyntax.ts` 统一单栏、资源创建和完整双栏的 YAML 语法诊断。基于现有 YAML 解析器报告重复键、未闭合结构与文件末尾错误，保留范围/点诊断、原文及多文档边界；支持原生诊断面板快捷键 Ctrl+Shift+M 和 F8 定位，不额外增加 gutter 或业务工具栏。保存、Apply 及错误恢复仍由原有父页面决定，不会因编辑器诊断改写或丢弃草稿。
- `resourceYamlValidation.ts` 使用与上游相同的 `codemirror-json-schema@0.8.0`，为部署 Values 接入字段类型/范围诊断、根字段与嵌套字段补全、类型/说明提示。只读状态不提供插入候选，Enter 接受补全，Escape 关闭；补全属于原生历史，支持单步撤销。针对首个未完成嵌套键和空行，用临时解析上下文获取候选，不向实际文档、业务草稿或撤销历史写入占位字段。
- `ResourceYamlEditor` 和 `DeploymentValuesEditor` 只增加可选 `validatorSchema` 输入；`codeEditor.ts` 的独立配置 compartment 不接管业务状态。`deploymentValuesSchema.ts` 仅描述现有本地 Chart fixture 的 `replicaCount`、`containerPort`、`host`、`env` 和 `job` 约束，允许其他自定义字段。配置/继承/合并值使用该 schema，试运行清单不套用 Values schema；ConfigMap/Secret 和任意 K8s Manifest 不被错误套用 Chart 字段。
- 核对上游 Secret 锁定是遮蔽值和整块只读，未发现该调用使用局部可编辑保护范围。本轮保留现有整块只读/显隐历史隔离，确认隐藏 Secret 会清除诊断面板、私密错误内容及撤销记录。真实权限锁定、受保护审批、任意资源 GUI/schema 与真实 Chart schema/版本目录仍待接入，不把本地字段提示记为完整 Helm/Kubernetes 校验。
- 完整双栏各自独立报告语法错误；切换“仅显示差异”移除诊断扩展及打开的诊断面板，返回完整比较恢复。原有差异定位、折叠、缩略图、查找、只读边界和原文回读继续保留。悬浮说明采用文本 DOM，原生 schema 候选说明沿用库渲染；没有增加 React 运行时。新增依赖及其依赖树的 85 组许可证说明保存在 `web/public/licenses/yaml-schema-LICENSES.txt`。

## 第三十九轮：原生终端、ANSI 与 Pod 日志虚拟渲染

- 参考提交仍为 `ecea7af01c628e0b60720e53fe969e204cdbe8ef`。核对 `NodeDetailTabs/terminal/Terminal.tsx`、`LogViewer.component.tsx`、`ClusterNodes/ClusterTerminal.tsx`，采用同版本 `@xterm/xterm@6.0.0` 与 `@xterm/addon-fit@0.11.0`；保留现有 Vue 3 + TDesign 工具栏和 Podry 品牌。上游字体为 Inconsolata，本地暂沿用 Consolas/Courier New，不将本轮记为字体或全部状态逐像素验收。
- `useXtermSurface` 负责原生终端、尺寸观察、字体就绪重排、选择事件和卸载清理；`TerminalViewport` 只接收输出、草稿、提示符、连接/忙碌状态和会话上下文，通过事件交还编辑、提交、历史、中断、断开与清屏。Pod 和集群工作区继续负责会话、容器/Shell、URL、重连、全屏与调试 Pod 草稿保护，不建立真实终端通道。
- 两类终端支持原生 ANSI 颜色、回车覆盖与清行、选择复制/失败提示、光标左右/Home/End、Backspace/Delete、Ctrl+A/E/U/K/W、完整命令历史和 Ctrl+C/D/L。Shift+Enter、多行粘贴、引号与反斜杠续行保留可编辑草稿，显式 Enter 才提交；删除按完整 Unicode grapheme 处理，覆盖常用中文/Emoji 混合输入与光标编辑。输入最多保留 16384 个 UTF-16 单元，截断不拆开最后一个 grapheme；控制字节不作为编辑指令回放。
- `terminalInput.ts` 仅拆分本地字面命令，保留引号内换行与反斜杠续行；没有执行 Shell、变量替换、管道或脚本。Pod 沿用有限演示命令，集群终端依次读取有限的本地只读 kubectl 结果；异步返回仍检查会话代次和命令令牌，断开/中断后不能写回旧结果。增加显式 `ansi` 演示命令，不把颜色示例解释成真实服务执行结果。
- Pod 日志复用 xterm 的可视行渲染、ANSI、选择复制和内置纵向滚动，保留无换行时的内部横向滚动，以及自动换行、滚动跟随/手动暂停、顶部/底部导航、三类容器、上一实例、范围、grep 和完整范围下载。下载读取原始记录，保留 ANSI 字节，不以虚拟 DOM 或过滤结果代替原文；容器/范围/搜索上下文切换清理旧缓冲与选择。补充 debugger 的有限 ANSI/进度/字面 HTML fixture；没有更改远端日志接口。
- 本轮只覆盖 Pod 资源日志，构建/发布历史共用日志仍有独立渲染及多节状态差异。多 Pod 分析器、真实日志流/重连/归档、完整 grep 服务、真实 exec、动态临时容器、文件下载、超时/并发服务状态与全状态视觉验收继续保留。新增依赖的许可证见 `web/public/licenses/xterm-LICENSES.txt`。
- 人工查看 1280px 的 Pod ANSI 日志和集群 Debug 终端截图后，按上游 `base.scss` 补齐 legacy viewport 背景和 12px 圆角滚动条，修复剩余空白高度露出的黑色条带。尚未完成所有终端状态、字体和复杂 Unicode 字符的逐像素验收。

## 第四十轮：多 Pod Log Analyzer

- 参考提交仍为 `ecea7af01c628e0b60720e53fe969e204cdbe8ef`。核对 `NodeTreeDetailTab.tsx`、`logAnalyzer/LogAnalyzer.component.tsx`、`NodeDetailTabs/Logs.component.tsx`、`nodeDetail.util.tsx` 和 `components/app/grepSSEworker.ts`：上游按工作负载/单 Pod 分组，选择一个容器并将各 Pod 日志以前缀汇入一个视窗，下载按 Pod 分别发起。本轮据此替换旧统计卡片、“全部容器”及普通段落列表，没有设计多个独立日志面板。
- 新增 `LogAnalyzerWorkspace` 负责 TDesign 选择器、工具栏、搜索、自定义范围与下载；`useLogAnalyzer` 负责选择、并行读取、逐源结果和代次清理；`logAnalyzer.ts` 负责命名空间内的 owner 图、容器并集和逐 Pod 搜索上下文。资源路由页只传入当前环境资源、激活状态和刷新序号。沿用 Vue 3 Composition API、现有 xterm 视窗与日志范围对话框。
- 工作负载聚合支持 ReplicaSet → Deployment / Job → CronJob 等已提供的 owner 链，缺少父对象时保留明确的 owner 分组，独立 Pod 保留单独选项；不会跨 Namespace 查找同名父对象，循环 owner 不会无限遍历。容器保持三类分组，只请求包含所选容器的 Pod，缺少容器的数量会提示；选择不包含当前容器的 Pod 时要求显式选择容器。
- 工具栏包含暂停/恢复（Ctrl+C）、清空、Pod/容器、上一实例、范围、重连与逐 Pod 原文下载；底部状态和日志行/Pod 数明确区分本地 Mock。grep/管道/上下文按每个 Pod 独立计算，可搜索 Pod 名前缀，保持字面匹配边界。下载忽略显示搜索，保留各 Pod 当前范围的原始记录和 ANSI，上一实例文件名独立；不会把失败源伪装成下载成功。
- 复用 xterm 的 ANSI/虚拟行/选择复制、换行、内部横滚和滚动跟随。每个源分别保存错误；一个 Pod 无上一实例或读取失败时，仍显示其他成功源，失败源列出 Pod 名与重连入口。Mock 主容器每 5 秒分别追加，上一实例、初始化/临时容器不追加；清空仅清当前视窗，重连重新读取所选范围。迟到响应、隐藏或卸载后返回的结果不能覆盖新选择。
- 开发环境增加 `checkout-api-5b8d7c9f4-v8m2q` 第二个 Pod fixture，含 app/envoy 独立日志和 app 的上一实例；与原 Pod 的初始化/临时容器差异用于演示缺容器及部分读取失败。API 实现保持原有 Mock，未连接后端或集群。
- 分析器仅在环境含 Pod 时出现，无 Pod 深链回到资源列表；新增入口遵守 Manifest 草稿离开保护，资源与日志页签切换保留分析器的 Pod/容器、范围和搜索状态。修复原有空资源页签 ID 导致从分析器点击 K8s 资源无响应的问题；1280px 时搜索栏整体换行，筛选按钮保持同组。
- 上游源码存在默认选项、容器取首 Pod、new/old 选项拼接等实现细节，本轮按可用资源图和容器并集保证本地选择有效；没有虚构历史 Pod/版本。Mock 历史按源分块回放，不代表真实 SSE 到达顺序或时序归并。真实 SSE/重连/归档、完整 grep、真实批量下载服务、构建/发布历史多节日志及全部状态逐像素验收继续保留。

## 第四十一轮：构建／发布历史的阶段虚拟日志

- 核对 `cIDetails/CIDetails.tsx`、`cdDetails/CDDetails.tsx` 及已安装共享库 `dist/Shared/Components/CICDHistory/{LogsRenderer,LogStageHeader,types}.d.ts` 和 `dist/index.js` 的实际实现：历史日志使用 `STAGE_INFO|JSON` 阶段事件、按阶段重置行号、成功阶段初始收起、独立/全部展开与 E、状态/耗时/平台、ANSI 着色、匹配跳转和虚拟吸顶标题；其实现与 Pod 日志的 xterm 分开。
- 共用 `HistoryLogViewer` 保留 Vue 3 + TDesign 的工具栏、全屏焦点圈和下载；新增 `HistoryLogViewport` 管理可视行、行高测量、内部滚动及吸顶标题，`HistoryLogStageHeader` 展示阶段信息。`historyLogs.ts` 按阶段名与开始时间更新重复事件，同名不同时间的重试独立；无阶段的旧日志兼容单节，损坏事件保留原文。缺失状态明确未知；缺少有效开始/结束时间不推断耗时。
- ANSI 只转换为受限的 Vue 文本样式，支持基本/高亮色、256 色、RGB、粗体/斜体/下划线和逐项重置；OSC 链接及其他控制命令不转换为 DOM，日志 HTML 保持文本。搜索按可见文本进行，跨 ANSI 片段的同一次命中只计一次，隐藏控制码不参与匹配；未使用 `v-html`。
- 虚拟列表按实际换行行高测量，保留当前阶段标题，并通过完整数据索引定位屏幕外匹配；搜索自动展开匹配阶段，不展开无关阶段。刷新、换行和尺寸改变保持滚动锚点；超出视窗高度的换行日志定位匹配本身。顶部/底部、手动暂停、跟随、全屏/还原及离开清理沿用共用交互。下载保留全部原始日志、ANSI 和阶段事件，不受当前挂载行/折叠/搜索影响。
- 构建 Mock 日志增加准备/源码/构建/推送分段，失败记录不生成成功推送阶段，排队记录仅准备阶段。`bd-1011` 增加 1,800 行编译与长行/ANSI 样例，通过正常历史入口验证虚拟渲染。阶段平台仅取构建快照，不读取当前配置；没有用整体构建起止时间推算历史阶段耗时。前后置任务日志提供对应任务事件和状态，继续保留任务/配置/源码 URL 隔离及自动刷新。
- 本轮不引入依赖，也未修改后端、概览或导航业务代码。真实 SSE/NDJSON、断线重连、归档/对象存储 ZIP、真实运行输出与完整字体/Unicode/逐状态像素验收仍待补齐；Mock 虚拟列表验证不代表真实海量日志或服务端性能验收。

## 第四十二轮：Manifest 对比与 Chart 默认版本

- 继续以参考提交 `ecea7af01c628e0b60720e53fe969e204cdbe8ef` 为基准，核对 `DeploymentConfigCompare.tsx` 的页签切换/版本保留/生成说明、`utils.ts` 的 Chart default values 分组和已安装共享库 `DeploymentConfigDiff` 的实现：Manifest 使用单个 `Manifest Output` 与 YAML 输出，不拆成独立 Kind 导航；配置排序与作用域转换仅适用于 Configuration。
- `ConfigComparisonWorkspace` 保持组合入口，`ComparisonFileNav` 增加两页签及 Manifest 单项导航；`ComparisonVersionSelector` 按基础配置、Environments、Chart default values 分组，选择默认 Chart 使用独立 `default` 版本，选择环境重置到当前保存值。`useConfigComparison` 保留环境/历史版本、交换、刷新、前进后退和直接访问，切页签不受配置搜索/过滤影响，关闭恢复原配置类型/条目或历史记录。
- 新增 `ComparisonManifestPanel` 复用 `ConfigurationYamlDiff` 的原生只读双栏、查找、F7/差异导航、缩略图与未改范围折叠；生成 YAML 展开重复标签，不引入非模板输出的共享对象别名。`configComparisonManifest.ts` 仅消费两侧已经解析的配置和快照上下文，不访问当前 Mock DB；历史目标、镜像和 Chart 不从现值补齐，缺失快照/上下文有明确错误，Secret 从脱敏文档重新构造。
- `comparisonCharts.ts` 是与现有模板选择器一致的本地 Deployment/Job 1.4.0/1.2.0 示例目录，两个版本使用相同的现有演示契约默认值，没有虚构版本差异或上游 Chart 历史。默认值不继承应用 Values/配置条目，不包含环境 Namespace；当前配置没有固定发布镜像，清单明确使用 `<IMAGE>`。返回数据及上下文均为深副本，后续当前配置/目标/Chart 修改不能污染历史清单。
- 本地 Manifest 支持现有 `replicaCount/containerPort/host/env/job` 及配置条目环境引用、卷/SubPath/八进制权限；外部条目仅引用、不创建资源，Secret 只输出键和遮蔽值。`host` 到 Service/Ingress 的关系是前端示例映射，不声称等同真实 Chart。未知 Values、非法字段或不支持的 Chart 显示原因，不输出省略字段的部分结果，仍可切回 Configuration 查看完整配置。
- 没有新增依赖或修改后端、概览、导航业务代码。受保护草稿/已发布/审批版本、作用域变量转换、完整 Chart 版本目录/GUI schema、实际 Helm 渲染和所有状态逐像素验收继续保留；页面明确标记本地 Mock 及服务端校验边界。

## 第四十三轮：作用域变量转换与发布历史解析值

- 同一参考提交下核对已安装共享库 `ToggleResolveScopedVariables`、`DeploymentConfigDiff` 与 `DeploymentHistoryDiffView`：按钮遵循 `Show variables value / Hide variables value`，配置转换采用原始值/解析回执两种视图，历史必须读取当次结果；Manifest 不提供该配置转换按钮。当前只使用本地显式 Mock 契约，不冒充服务端变量解析。
- `ScopedVariablesToggle` 仅接收布尔状态并发出更新事件；`useConfigComparison` 负责 URL 模式和两侧转换，`ConfigComparisonWorkspace` 将按钮放在版本工具栏。GUI/YAML、文件标记/数量和只看变更过滤一起更新；交换、切文件、刷新、后退/直接访问和 Manifest 往返保留模式，无变量应用隐藏入口。
- `configDocument.ts` 统一有效配置与历史的脱敏文档；`configVariables.ts` 校验解析回执与原始配置一致，保留类型/数组并输出独立副本，只做已登记字面字符串替换，不执行表达式或递归模板。解析回执不包含 Secret；使用解析结果时也不允许额外 Secret 字段覆盖遮蔽文档。缺解析快照、配置不匹配、未知/不支持引用均报错且不显示部分结果，可关闭转换恢复原文。
- `DeploymentSnapshotPanel` 使用同一脱敏文档与解析契约，单栏 GUI/YAML、当前配置对比及跳转版本对比同步转换状态；离开时废弃旧加载响应。Mock 发布触发保存当次结果，回滚保留来源回执，晋级捕获目标环境。Manifest 固定使用对应版本的解析结果，历史不读取当前变量回填。
- `payment-worker` 的真实 Mock 编辑源增加 `payment-region/payment-queue` 引用，固定开发/生产示例值不同；另增独立历史 fixture 保存 `cn-beijing/payments-legacy` 旧值，不从当前配置反推历史。原有 `d-payment-dev-1` 等缺快照记录保持缺失。这里没有实现变量管理/上传、完整作用域优先级、敏感变量、Secret/挂载元数据解析，也没有接入后端、概览或导航业务改动。

## 验证

- 第四十三轮类型检查/生产构建通过；主 chunk 1302.82 KB，保留原有体积警告。最终同一生产包新增变量转换 39 项、配置对比 44 项、Manifest 41 项及配置/历史/Notes 36 项共 160 项浏览器检查通过，零运行时错误/控制台警告。覆盖环境差异重算、字面引用/GUI/YAML、Secret 遮蔽、URL/交换/刷新/后退、历史单栏与当前对比、跳转返回、未知变量错误恢复、历史隔离及 1280px。结果与截图见 `web/screenshots-config-variables-parity/` 和现有对应目录；已人工核对窄屏、历史与异常状态，保留 `failure-round43`。
- 第四十三轮变量 38 项、配置比较 38 项、Manifest 50 项及快照 18 项共 144 项离线检查通过，包含解析缺失/失效、类型/特殊字符、非递归替换、Secret 额外字段排除、深副本、触发/回滚/晋级与历史隔离。旧配置条目回归改为等待目标 Secret 路由及条目加载，避免把上一页的列表视为目标页就绪；检查断言保持。22 个范围文件 UTF-8/冲突/空白、5 个脚本语法和范围差异检查通过；文档结构检查通过（71 Markdown、662 本地链接、81 HTTP operations、260 schema refs、36 SQL tables）。上述为前端 Mock 证据，未做真实 Devtron API、Helm、集群或全部状态逐像素验收。

- 第四十二轮类型检查/生产构建通过，无新增依赖，保留既有 1302.47 KB 主 chunk 体积警告。最终同一生产包的 `check-config-manifest-parity.mjs` 41 项、`check-config-comparison-parity.mjs` 44 项及 `check-config-entry-parity.mjs` 36 项全部通过，共 121 项浏览器检查，均零运行时错误/控制台警告；覆盖分组默认值、只读输入、两页签/历史 URL、交换/刷新/后退、错误修复、返回来源、搜索隔离、未支持字段和 1280px。截图与结果见 `web/screenshots-config-manifest-parity/` 等对应目录，人工检查历史/默认值对比与窄屏、错误状态；中途失败截图 `failure-round42` 保留。
- 第四十二轮新增 `check-config-manifest.mjs` 50 项、现有配置对比 38 项及快照 18 项离线检查通过，共 106 项；覆盖历史/目录深副本、当次 Chart/目标/镜像、Secret 额外字段排除、默认值无继承、环境/卷/SubPath/文件权限、Job/零副本、字段错误及缺失上下文。15 个范围文件 UTF-8/冲突/空白、2 个脚本语法、范围差异检查通过；文档结构检查通过（71 Markdown、660 本地链接、81 HTTP operations、260 schema refs、36 SQL tables）。以上是前端 Mock 证据，不代表真实 Helm/API/集群或全部状态像素验收。
- 第四十一轮类型检查/生产构建通过；最终生产包的历史日志 56 项、阶段运行 41 项、配置/构建历史 30 项、路由/状态 48 项全部通过，合计 175 项浏览器检查，均零运行时错误和控制台警告。结果与截图见 `web/screenshots-history-log-parity/`、`web/screenshots-stage-run-parity/`、`web/screenshots-config-parity/` 和 `web/screenshots-pages-parity/`；人工检查长日志/ANSI/换行、1280px 构建与任务历史截图。历史脚本调整为验证可视 DOM 和完整搜索计数，不再要求所有匹配同时挂载；保留原有失败截图，新失败使用 `failure-round41`。
- 第四十一轮 `check-history-log-stages.mjs` 新增 57 项、原有 `check-history-logs.mjs` 30 项和 `check-stage-runs.mjs` 42 项离线检查通过，合计 129 项，覆盖 ANSI/跨样式搜索、损坏事件、同名重试、状态/耗时/平台验证、万行布局/定位、折叠/跟随/上下文清理和 Mock 归属。没有新增依赖；主 chunk 约 1302.47 KB（gzip 336.45 KB）的既有警告保留，历史查看器共享 JS 分包约 18.8 KB。没有真实 API、日志流、任务执行或完整像素验收。
- 第四十轮类型检查/生产构建通过，既有主 chunk 约 1302.47 KB（gzip 336.43 KB）的体积警告保留。最终生产包通过 `check-log-analyzer-parity.mjs` 38 项、`check-pod-log-parity.mjs` 44 项、`check-resource-tabs-parity.mjs` 32 项、`check-resource-listing-parity.mjs` 47 项，以及 `check-pages.mjs` 48 个路由状态，合计 209 项浏览器检查，均零运行时错误和控制台警告。新增截图和结果见 `web/screenshots-log-analyzer-parity/`；人工查看 1280px 聚合与 1440px 部分上一实例失败截图，尚未完成全状态逐像素比较。
- 第四十轮 `check-log-analyzer.mjs` 36 项及 `check-pod-logs.mjs` 49 项离线检查通过，合计 85 项，包含 owner 图/Namespace/循环、容器并集、独立上下文、并行结果、部分失败、迟到请求、隐藏/卸载清理、清空与逐源 Mock 追加、范围及独立上一实例。11 个本轮范围文件 UTF-8/冲突标记/行尾空白、3 个脚本语法及范围内 `git diff --check` 通过。上述验证均为前端 Mock，没有新增后端或真实集群验收。
- 第三十九轮类型检查/生产构建通过。最终同一生产包的 `check-terminal-xterm-parity.mjs` 54 项、`check-pod-terminal-parity.mjs` 37 项、`check-cluster-terminal-parity.mjs` 50 项、`check-pod-log-parity.mjs` 44 项全部通过，合计 185 项浏览器检查，各套零运行时错误和控制台警告。覆盖两个 Manager 的 Pod 入口、集群/节点调试、字面/键盘输入、光标/多行/历史、超长输入截断、ANSI/进度覆盖、复制失败、断线/重连、全屏、日志虚拟行/换行/跟随/过滤/下载和调试 Manifest 草稿保护；截图及结果保存在对应 `web/screenshots-*-parity/` 目录。
- 本轮离线 Mock 检查 `check-pod-terminal.mjs` 42 项、`check-cluster-terminal.mjs` 43 项、`check-pod-logs.mjs` 49 项通过，合计 134 项。22 个范围内文件的 UTF-8/空白/冲突标记、5 个浏览器脚本/驱动的语法和新增依赖锁一致性检查通过；文档结构检查为 69 Markdown、653 本地链接、81 HTTP operations、260 schema refs、36 SQL tables，仅结构检查，未执行 SQL。主 chunk 约 1302.47 KB（gzip 336.44 KB）的既有警告保留；资源工作区共享 xterm/输入适配分包新增约 338.34 KB（gzip 86.05 KB），不是零加载成本。以上不是接口、真实 Shell、集群操作或全范围像素验收。
- 第三十八轮类型检查和生产构建通过；原有主 chunk 仍约 1.302 MB，并保留既有体积警告。当前共用编辑器 chunk 约 357.77 KB（gzip 113.95 KB），YAML 支持约 51.91 KB，schema/单栏适配约 399.54 KB（gzip 137.62 KB），还包含 schema 库的 Markdown/Shiki 附属分包；不能将这次新增 schema 能力记为零加载成本。
- 新增 `check-yaml-validation-parity.mjs` 的 50 项生产 Mock 浏览器检查全部通过：字段类型/上下界/嵌套约束、重复键与末尾语法诊断、修正清除、Ctrl+Space 补全、首个未完成嵌套字段/空行、去除已有候选、Enter/Escape/单步撤销、悬浮文本/视口、继承只读、Secret 私密诊断清理、两处 Manager 的创建/Review 和折叠比较关闭/恢复。人工查看 1280px 字段悬浮说明截图，未做全状态逐像素评分。
- 同一最终生产包的查找 45 项、配置/Secret/历史 57 项、资源创建 47 项、资源单栏 38 项、资源双栏 62 项、Dockerfile/Shell 51 项均通过；连同新增共 350 项。各套结果均零浏览器运行时错误和控制台警告。长 ConfigMap 本轮未触发测量循环警告，但未定位之前的间歇问题根因，不记为已修复。
- 本轮 17 个范围内文件的 UTF-8/冲突/空白检查、脚本语法、manifest/lock 一致性与范围内 `git diff --check` 通过；文档结构检查仍为 68 Markdown、646 本地链接、81 HTTP operations、260 schema refs、36 SQL tables。仅结构检查，未执行 SQL；没有后端、真实构建/发布、Helm 或 Kubernetes 验收。

- 第三十七轮类型检查/生产构建通过，共用编辑器运行时约 342.94 KB（gzip 109.54 KB）；保留既有约 1.302 MB 主 chunk 警告。显式声明现有 TDesign 图标依赖，锁文件复用已安装的 0.4.12，没有新增另一套 UI 或编辑器运行时。
- 新增 `node scripts/check-editor-search-parity.mjs http://127.0.0.1:5182` 的 45 项生产 Mock 浏览器检查通过；覆盖组合开关与计数、无效正则保留修正、无匹配禁用、替换展开/保留、键盘导航/替换、单步撤销、多选区输入、1000 项边界、只读继承、双栏独立查询和 Escape/焦点、1280px 工具栏边界。人工查看双栏查找截图，深色配色、替换区和控件均在栏内；不是全部状态逐像素评分。
- 同轮通过资源单栏 38 项、资源差异 62 项、创建 47 项、Dockerfile/Shell 51 项及应用配置/Secret/历史 57 项，共 255 项浏览器回归；连同新增共 300 项。原有替换测试改为显式展开替换区后执行真实交互，没有降低正文/保存/撤销/草稿保护断言。最后增加无效查询 Enter 保护后重新构建，并复验新增全部 45 项；255 项为该保护之前的同轮生产包证据。
- 上述最终各套结果均零浏览器运行时错误/控制台警告；配置测量循环警告本轮早期仍曾复现，诊断及最终完整复跑未再触发。未定位根因、未修改依赖或屏蔽警告，因此仍保留为间歇问题，不能记为已修复。Chrome 仍占用的临时 profile 保留。
- 文档结构检查通过（68 Markdown、646 本地链接、81 HTTP operations、260 schema refs、36 SQL tables）；仅结构检查，未执行 SQL。当前仍为前端 Mock，没有后端、真实构建/部署或 Kubernetes 验收。

- 第三十六轮 `npm run build` 类型检查与生产构建通过，保留既有约 1.318 MB 主 chunk 警告。`check-resource-diff-parity.mjs` 扩展为 62 项，覆盖两处 Manager 的缩略图、点击/拖动/键盘定位、双栏各自末尾边界、撤销重做/校验、高分屏、原文读回、标题/导出对齐与关闭清理；`check-resource-editor-parity.mjs` 38 项、`check-resource-creation-parity.mjs` 47 项通过，合计 147 项生产包浏览器检查，均零运行时错误和控制台警告。人工查看 Infrastructure Review 与发布历史对比截图，未做全页面逐像素评分。
- 配置/Secret/历史的 `check-config-editor-parity.mjs` 扩展为 57 项目标断言：55 项功能断言和零运行时错误断言通过，最终零警告断言未通过。并发及单独复跑均捕获一次既有 `Measure loop restarted more than 5 times`，阶段日志定位到千行 ConfigMap 单栏保存/滚动后、尚未打开缩略图的阶段；保留告警与失败结果，不计为整套通过。完整对比、折叠隐藏/恢复、列宽、历史引用和路由清理的新增断言均通过。
- 本轮 12 个文件的 UTF-8、行尾空白与冲突标记检查、两个修改后的浏览器脚本语法及范围内跟踪文件差异检查通过。文档结构检查仍为 66 Markdown、633 本地链接、81 HTTP operations、260 schema refs、36 SQL tables，仅结构检查；没有执行 SQL 或连接后端/真实集群。
- 第三十五轮 `npm run build` 类型检查/生产构建通过；新增 Dockerfile/Shell 模式包，脚本语言运行时约 6.75 KB（gzip 2.80 KB），共用编辑内核约 327.5 KB（gzip 105.85 KB），均按需加载；保留既有约 1.318 MB 主 chunk 警告。Dockerfile 模板 31 项、任务 25 项和容器/阶段引用 35 项离线检查通过，共 91 项；Vite 中间件仍有既有 24678 WebSocket 端口占用提示，断言及退出成功。
- 新增 `node scripts/check-script-editor-parity.mjs http://127.0.0.1:5182` 的 51 项生产浏览器检查通过，覆盖 Dockerfile/Shell 模式、高亮、编辑与查找替换、Tab/Shift+Tab、撤销重做、千行全文保存/复制/内部滚动/虚拟渲染、模板与任务历史隔离、继承只读与覆盖删除、查找 Escape、空脚本校验及撤销恢复、CI/CD 前后置脚本、容器挂载和草稿保护。截图人工检查应用 Dockerfile、长 CI 脚本和 CD 脚本的布局。
- 本轮另通过 Dockerfile 模板 35 项、任务目录 32 项、容器/配置引用 43 项、配置/构建历史 30 项、阶段运行/历史快照 41 项、资源单栏 38 项、资源差异 38 项及应用配置/Secret/历史编辑器 51 项生产包浏览器回归；连同新增共 359 项，最终结果均零运行时错误/控制台警告。一次配置编辑器并发回归出现 CodeMirror 测量循环警告，完整重跑该 51 项后通过，未屏蔽警告。验收脚本使用真实原生键盘/剪贴板/滚动操作。
- 最后收紧脚本校验标记，仅空脚本标记正文无效，容器挂载路径错误不再误标脚本内容；重新构建后通过原生编辑器 51 项及容器/引用 43 项，共 94 项针对性复验。文档结构检查通过（66 Markdown、633 本地链接、81 HTTP operations、260 schema refs、36 SQL tables）；23 个本轮文件的 UTF-8/空白/冲突标记、6 个浏览器脚本语法和跟踪文件 `git diff --check` 检查通过。新增依赖已补充至现有 CodeMirror 许可证清单。

- 第三十四轮 `npm run build` 类型检查和生产构建通过，无新增依赖；保留既有 npm 配置与约 1.318 MB 主 chunk 警告。原有配置数据 33 项、配置对比 38 项、配置快照 18 项离线检查均通过，共 89 项；中间件启动有既有 24678 WebSocket 端口占用提示，断言和进程退出均成功。
- 新增 `node scripts/check-config-editor-parity.mjs http://127.0.0.1:5182` 的 51 项生产包浏览器检查通过；覆盖原生高亮/行号/折叠、Tab/Shift+Tab、撤销重做、查找、千行配置的内部纵横滚动/虚拟渲染/全文复制/原文保存、继承和试运行只读、Secret 显隐历史隔离、双栏差异/F7、折叠区命中揭示、双侧展开、交换标签/范围、相同配置空差异、历史隔离与 1280px 配置列宽度/滚动边界。截图和结果在 `web/screenshots-config-editor-parity/`；人工查看单栏、千行双栏和滚动后的历史比较截图。
- 本轮另通过部署模板 43 项、配置数据 51 项、配置条目/历史/Notes 36 项、配置对比 44 项、资源单栏 38 项、原生差异 38 项、期望/实时比较 34 项及创建抽屉 47 项浏览器回归；连同新增共 382 项，均零浏览器运行时错误/控制台警告。最后仅修正历史快照列宽后，重新通过新增 51 项、条目/历史/Notes 36 项、配置对比 44 项及资源单栏/差异各 38 项。验收脚本改为真实 CodeMirror 键盘/剪贴板操作；原生差异的真实点击等待关闭中的确认弹窗停止拦截指针，Notes 入口等待异步页面可见。
- 第三十四轮文档结构检查通过（66 Markdown、629 本地链接、79 HTTP operations、250 schema refs、36 SQL tables）；本轮 20 个文件的 UTF-8/冲突标记/空白检查与跟踪文件 `git diff --check` 通过。仍为前端 Mock 和代表性交互/截图证据，不替代真实 API/Kubernetes、全部页面逐像素与用户验收。

- 第三十三轮最终 `npm run build` 类型检查/生产构建通过，保留既有 npm 配置与约 1.318 MB 主 chunk 警告；没有新增依赖。新增 `node scripts/check-resource-creation.mjs` 的 35 项离线检查通过，覆盖逐项映射、空输入、直接提交、重复拦截、精确原文、编辑往返、失败重试、累计刷新、部分结果、跨集群/卸载迟到隔离。原有 Manifest 48 项、期望比较 27 项也重新通过，共 110 项离线检查。
- 新增 `node scripts/check-resource-creation-parity.mjs http://127.0.0.1:5182` 的 47 项生产浏览器检查通过，覆盖空白/焦点/直接应用、原生编辑/查找/替换/撤销重做、Escape 与三种全局快捷键隔离、提交等待/关闭/路由拦截、逐项部分结果、已更新、返回编辑原文、后续失败仍刷新、关闭入口焦点、历史/跨集群隔离、千行完整复制与内部滚动、80 条结果及 1280px/640px 布局，零运行时错误/控制台警告。截图与结果见 `web/screenshots-resource-creation-parity/`，已查看部分失败结果、长清单及两种宽度的长结果截图。
- 同一最终生产包另通过资源 Manifest 48 项、资源分页 45 项、节点筛选/Kind 搜索 54 项、单栏编辑器 38 项与关键交互 38 项；连同新增创建流程共 270 项浏览器检查，均零运行时错误/控制台警告。创建相关脚本改用原生键盘/剪贴板输入及显式结果关闭；关键交互脚本同步当前已存在的中文常驻侧栏选择器，限定创建按钮的点击范围并等待抽屉内容可见，没有修改概览或导航业务源码。
- 文档结构检查通过（65 Markdown、629 本地链接、79 HTTP operations、250 schema refs、36 SQL tables），本轮 17 个文件 UTF-8/空白/冲突标记和修改范围差异检查通过。全部为前端 Mock 与代表性截图证据，不代替真实后端/Kubernetes 或全页面逐像素验收；后端与其他页面的并行工作保留。

- 第三十二轮最终 `npm run build` 类型检查/生产构建通过，保留既有 npm 配置与约 1.318 MB 主 chunk 警告。共享 CodeMirror 运行时约 357 KB（gzip 117 KB），单栏与双栏复用同一份；现有期望比较 27 项和 Manifest 48 项离线检查通过。
- 同一最终生产包新增 `node scripts/check-resource-editor-parity.mjs http://127.0.0.1:5182` 的 38 项单栏浏览器检查通过，覆盖只读保护、可见查找入口/无替换、Ctrl+F/Escape、原文复制、高亮/折叠、编辑自动聚焦、Tab/Shift+Tab、撤销重做、父级草稿/刷新保护、错误修复、Review 往返/旧实例销毁、跨资源历史隔离及千行清单的纵横滚动/虚拟渲染/完整保存/尾部搜索。截图与结果见 `web/screenshots-resource-editor-parity/`，已查看普通编辑和 1280px 长清单只读截图。
- 最终生产包同时通过原生差异 38 项、Manifest 48 项、期望比较 34 项、资源详情 32 项、动态页签 32 项、资源列表 47 项和节点/集群终端 50 项，连同新增检查共 319 项，均零运行时错误/控制台警告。原有脚本改用公开键盘/剪贴板读取原生完整文档，资源列表删除检查同步至现有共用页签 DOM；未添加组件内部测试钩子。全部为前端 Mock 证据。
- 文档结构检查通过（65 Markdown、629 本地链接、79 HTTP operations、250 schema refs、36 SQL tables），本轮文件 UTF-8/空白/冲突标记及修改范围差异检查通过。后端与其他页面的并行工作保留。

- 第三十一轮最终 `npm run build` 类型检查/生产构建通过，保留既有 npm 配置与约 1.318 MB 主 chunk 警告；新增 CodeMirror 运行时独立懒加载 chunk 约 381 KB（gzip 125 KB）。现有期望比较 27 项和 Manifest 48 项离线检查通过。
- 最终稳定生产包 `node scripts/check-resource-diff-parity.mjs http://127.0.0.1:5182` 的 38 项原生交互检查通过：左右只读/可编辑保护、原文/中文/注释/换行、四行插入后的相同行坐标对齐、行内高亮、安全文本、F7、两侧查找/右侧替换、Ctrl+F/Escape、撤销重做、无效 YAML 保留/修复再校验、取消导航保留 Review、折叠/展开、准确保存读回和 800 行内部滚动/可视区域渲染/完整复制。截图和结果见 `web/screenshots-resource-diff-parity/`，人工查看原生多行差异与 1280px 长清单截图。
- 同一生产包另通过期望比较 34 项、Manifest 48 项、资源详情 32 项、动态页签 32 项、节点/集群终端 50 项，合计 234 项浏览器检查，均零运行时错误/控制台警告。Manifest 脚本等待创建抽屉操作实际可见后点击，修复并发浏览器下动画尚未结束时的测试竞态；未变更业务流程。全部为前端 Mock 证据，不替代真实后端/Kubernetes 或全部状态逐像素验收。
- 文档结构检查通过（65 Markdown、623 本地链接、79 HTTP operations、250 schema refs、36 SQL tables）；修改范围差异空白与本轮文件 UTF-8/冲突标记检查通过。并行概览的第三十轮记录和后端工作保留。

- 第二十九轮最终 `npm run build` 类型检查/生产构建通过，保留约 1.318 MB 主 chunk 的体积警告。`node scripts/check-resource-comparison.mjs` 的 27 项离线检查及原有 Manifest 48 项检查通过，覆盖固定快照、比较噪声/数组/标量规则、差异块、长清单、错误/空态/重试与异步隔离。
- 最终稳定生产包 `node scripts/check-resource-comparison-parity.mjs http://127.0.0.1:5182` 的 34 项浏览器检查通过：入口范围、左右方向/只读/无差异、编辑后快照不变、差异键盘跳转、关闭焦点、独立复制下载/复制失败、环境/Manager 切换、子资源排除、1280px 与长清单内部滚动。结果与截图见 `web/screenshots-resource-comparison-parity/`，人工查看实时漂移和 1280px 长清单截图。
- 同一最终生产包另通过 Manifest 48 项、资源详情 32 项、动态页签 32 项、节点/集群终端 50 项，共计 196 项浏览器检查，均零运行时错误/控制台警告。这些是前端 Mock 证据，不代表真实后端/Kubernetes 或全页面逐像素验收。
- 文档结构检查通过（64 Markdown、617 本地链接、79 HTTP operations、250 schema refs、36 SQL tables），本轮 15 个文件的 UTF-8/空白/冲突标记检查及修改范围 `git diff --check` 通过；后端和并行概览/导航工作保留。

- 第二十八轮最终 `npm run build` 类型检查/生产构建通过，保留既有 npm 配置与约 1.316 MB 主 chunk 警告。新增 `node scripts/check-resource-detail-location.mjs` 的 18 项离线检查通过，覆盖跨 Manager/集群/同名 group 身份、RBAC 名称、非法地址/容器、核心 Pod 页签限制和查询上下文；既有 19 项资源页签检查也通过。
- 第二十八轮稳定生产包新增 `node scripts/check-resource-detail-parity.mjs http://127.0.0.1:5182` 的 32 项浏览器检查通过，零运行时错误/控制台警告。覆盖紧凑工具栏/删除位置/更多操作、两处 Manager URL 与容器同步、清空本地页签记录后的恢复、前进后退、取消导航保留草稿、跨作用域限制、Secret 明文和 1280px；结果与截图见 `web/screenshots-resource-detail-parity/`。
- 同一最终生产包通过 Manifest 48 项、资源页签 32 项、Pod 日志/事件 44 项、Pod 终端 37 项、节点/集群终端 50 项和关键交互 38 项浏览器回归；连同新增检查共 281 项，均零运行时错误/控制台警告。全部使用前端 Mock，不能替代真实后端/Kubernetes 或全页面逐像素验收。
- 本轮文档结构检查通过（63 Markdown、608 本地链接、79 HTTP operations、250 schema refs、36 SQL tables）；修改范围差异空白及 15 个本轮文件 UTF-8/空白检查通过。人工查看 Infrastructure Manifest 和 1280px Application Review 截图，后端、并行概览/导航工作与既有截图保留。

- 第二十七轮最终 `npm run build` 类型检查/生产构建通过；保留既有 npm 配置和约 1.316 MB 主 chunk 警告。新增 `node scripts/check-resource-tabs.mjs` 的 19 项离线检查通过，覆盖作用域/同名身份、最近访问/失效项回退、跨作用域关闭隔离、草稿取消/重复刷新、确认期间切换资源及同步时间只记录成功读回。
- 第二十七轮最终稳定生产包新增 32 项页签浏览器检查通过，零运行时错误和控制台警告，覆盖九页签溢出/活动项可见、搜索/空态/身份信息、键盘选择与关闭后焦点、最近访问回退、草稿保护刷新/切换、两处 Manager 独立页签、当前 Logs/Terminal 与容器跨 Manager 跳转、同名跨组搜索及 1280px。结果与截图在 `web/screenshots-resource-tabs-parity/`；截图等待浮层动画结束，开发期中间失败不作为最终通过证据。
- 第二十七轮最终生产包另通过 48 项 Manifest 与 44 项日志/事件浏览器回归，均零运行时错误/控制台警告；同轮 Pod 终端 37 项在最后仅修改页签浮层焦点/滚动前通过。仍是前端 Mock 和代表性交互证据，没有真实 API/Kubernetes 或全部状态逐像素验收。
- 第二十七轮文档结构检查通过（62 Markdown、602 本地链接、79 HTTP operations、250 schema refs、36 SQL tables）；修改范围差异空白和新增文件 UTF-8/空白检查通过。后端、`DEVELOPMENT_PROGRESS.md`、并行概览/导航工作及既有截图保留。

- 第二十六轮最终 `npm run build` 类型检查与生产构建通过，保留既有 npm 配置和主 chunk 体积警告。`node scripts/check-resource-pagination.mjs`：28 项离线检查通过；既有资源列表 41 项和节点筛选 32 项离线检查通过。参考仓库 HEAD 再次确认仍为 `ecea7af01c628e0b60720e53fe969e204cdbe8ef`。
- 第二十六轮最终稳定生产包 `node scripts/check-resource-pagination-parity.mjs http://127.0.0.1:5182`：45 项检查通过，零浏览器运行时错误/警告。通过页面创建 100 个 Mock ConfigMap 验证默认 100 条/总数、全量排序再分页、同列两态排序、每页条数、当前页选择/跨页清理、键盘/aria、内部滚动/固定表头/底部分页、翻页回首行、深链/刷新/前进后退、搜索/命名空间/Kind/集群切换、非法参数/空态和末页删除回退，并验证 Warning/Normal、事件时间/计数排序及消息搜索。结果与截图在 `web/screenshots-resource-pagination-parity/`；人工查看 101 条第一页、末页和 1280px 事件截图。
- 同轮稳定生产包另通过 54 项节点筛选/Kind 浮层与 38 项关键交互浏览器复验，零浏览器错误/警告；最后仅调整同列排序第三次点击的循环，随后重新构建并跑完上述 45 项。资源列表 47 项、节点/集群终端 50 项、Manifest 48 项、页面/状态 46 项在同轮通过，其中后三组在滚动复位/迟到响应保护细调前运行。构建未结束时误启动的一批浏览器结果已剔除，45/54/38 为稳定包重新运行的记录；这些结果不能替代全部状态逐像素验收。
- 节点筛选回归脚本改为等待浮层关闭动画结束再重新打开；浏览器助手在关闭时释放 Windows Chrome 的 stderr/进程引用。之前两个已写入成功结果的进程滞留在退出阶段，已精确结束；被占用的临时目录和中间失败截图保留，以对应目录最终 `results.json` 为成功证据。没有绕过之前的文件清理拒绝。
- 第二十六轮文档结构检查通过（60 Markdown、591 本地链接、79 HTTP operations、250 schema refs、36 SQL tables）；本轮跟踪文件 `git diff --check` 与 13 个修改/新增文件的 UTF-8/空白检查通过。未连接真实 API/Kubernetes，未修改后端实现或完成全页面逐像素验收。
- 第二十五轮最终 `npm run build` 类型检查和生产构建通过，保留既有 npm 配置和约 1.315 MB 主 chunk 警告。新增 `node scripts/check-resource-filters.mjs` 的 32 项离线检查通过，原有资源列表 41 项离线检查通过；仅为本地规则与 Mock 证据。
- 第二十五轮 `node scripts/check-resource-filters-parity.mjs http://127.0.0.1:5182`：54 项生产浏览器检查通过，零运行时错误/控制台警告。覆盖三类节点筛选的 OR/AND/精确匹配、草稿/Apply/外部取消、逐项移除/清空、完整候选/未知选择/空态、URL 保留/深链/刷新/前进后退/集群切换、`/` 与 F 焦点、两处 Manager 的 Kind 浮层/高亮/短名称排序/键盘循环/Home/End/Enter/失焦，以及 Kind URL 清理和 1280px 工具栏/浮层边界。结果和截图在 `web/screenshots-resource-filters-parity/`，人工查看节点筛选和跨组 Kind 搜索截图。
- 第二十五轮最终构建另通过原有资源列表 47 项、节点/集群终端 50 项、资源 Manifest 48 项及页面/状态 46 项浏览器回归；同轮关键交互 38 项在最终 Enter 独立事件绑定前通过，该绑定由最终新增 54 项检查验证。浏览器均无运行时错误或控制台警告。节点元数据增加一项样例标签，对应终端回归的展开数量由 16 调整为 17，未缩减验证范围。
- 第二十五轮文档结构检查通过（59 Markdown、586 本地链接、79 HTTP operations、250 schema refs、36 SQL tables），本轮范围 `git diff --check`、新增文件 UTF-8 与空白检查通过。未连接真实 API/Kubernetes，未完成全部页面和状态逐像素验收。
- 第二十四轮 `npm run build` 类型检查与生产构建通过，既有 npm 配置及约 1.315 MB 主 chunk 警告保留。`node scripts/check-resource-listing.mjs`：41 项离线检查通过，覆盖 group 身份/旧深链/未知组、动态列/false/0、结构化字段/异常 YAML/别名、CRD 状态、实际用量来源、数值排序及同名跨组写入/删除隔离；原有节点/集群终端 43 项离线检查与资源动作 Mock 检查通过。
- 第二十四轮 `node scripts/check-resource-listing-parity.mjs http://127.0.0.1:5182`：47 项生产浏览器检查通过，零运行时错误和控制台警告。覆盖两处 Manager 分组/选择/过滤、历史恢复、独立页签、CRD、节点实际用量条、列搜索/草稿/Apply/点击外部、键盘及固定 Namespace/Event 短名称、删除关闭正确组页签、弹窗复选框排版与 1280px。截图及结果见 `web/screenshots-resource-listing-parity/`；人工查看跨组列表、CRD、应用 Manifest、节点列表与删除弹窗。均为前端 Mock；未验收真实任意 GVR/服务端 Table/权限或全部状态逐像素等价。
- 第二十四轮另回归通过 48 项资源 Manifest、50 项节点/集群终端、37 项 Pod 终端、38 项关键交互与 46 个页面/状态浏览器检查，均无运行时错误和控制台警告。最后固定资源短名称补充后重新通过构建及完整新增 47 项，其他浏览器回归为该局部补充前同轮证据。文档结构检查通过（58 Markdown、576 本地链接、79 HTTP operations、250 schema refs、36 SQL tables），本轮差异空白及新增文件 UTF-8 检查通过。
- 第二十三轮最终 `npm run build` 类型检查与生产构建通过；保留既有 npm 配置和约 1.315 MB 主 chunk 警告。新增 `node scripts/check-cluster-terminal.mjs` 的 43 项离线检查通过，覆盖 URL/名称校验、调试清单与 tolerations、身份/容器限制、迟到会话释放、命令中断/历史、重建与托管字段、错误重试/过期、节点写入同步与隔离。原有 42 项 Pod 终端、48 项资源 Manifest 离线检查及资源动作 Mock 检查通过。
- 第二十三轮最终 `node scripts/check-cluster-terminal-parity.mjs http://127.0.0.1:5182`：50 项生产浏览器检查通过，零运行时错误与控制台警告；覆盖节点独立滚动/动作同排/排序/复制/元数据展开、节点 YAML Review/Apply 和动作草稿保护、节点调试深链、两行工具栏、Shell/命名空间/镜像切换、自定义创建、历史/选择复制/断开/重连/离线、Debug Mode/事件/清单、重建和切换草稿保护、全屏/弹窗层级/焦点、控制平面 tolerations、路由换集群/错误态和 1280px 布局。结果及截图见 `web/screenshots-cluster-terminal-parity/`；人工查看节点概要、调试清单、全屏和 1280px 截图，剪贴板操作在浏览器内拦截。
- 第二十三轮最终生产构建回归通过 37 项 Pod 终端、48 项资源 Manifest 和 38 项关键交互浏览器检查，均零运行时错误及控制台警告。仍只证明前端 Mock 与代表性交互/截图，没有真实调试 Pod、Shell、Kubernetes 或全部页面逐像素验收。
- 第二十二轮最终 `npm run build` 类型检查与生产构建通过，既有 npm 配置及约 1.315 MB 主 chunk 警告保留。新增 `node scripts/check-pod-terminal.mjs`：42 项离线检查通过，覆盖四种 Shell、字面命令、运行/终止/等待状态、集群/UID/容器边界、并发 ID、关闭与过期、命令历史、迟到成功/失败重试、隐藏/资源切换/销毁清理；原有 49 项 Pod 日志离线检查也通过。没有连接 Kubernetes 或执行真实 Shell。
- 第二十二轮最终 `node scripts/check-pod-terminal-parity.mjs http://127.0.0.1:5182`：37 项生产浏览器检查通过，零运行时错误与控制台警告。覆盖两个 Manager、容器深链、分组/四种 Shell、命令安全文本、历史/草稿/Ctrl+C/Ctrl+D/exit、选择复制/失败恢复/清屏、连接中断开与继续、网络离线/恢复、全屏/元信息/快捷键/焦点、错误态和 1280px 布局。截图及结果见 `web/screenshots-pod-terminal-parity/`，人工查看集群普通/全屏、不可用 Pod 与应用普通/全屏。剪贴板在浏览器内拦截，没有写入系统剪贴板。
- 第二十二轮最终生产构建另回归通过 44 项 Pod 日志、48 项资源 Manifest 与 38 项关键交互浏览器检查，均零运行时错误及控制台警告；文档结构与本轮差异空白/新增文件 UTF-8 检查通过。不是 Kubernetes、真实终端、后端或全部状态逐像素验收。
- 第二十一轮 `npm run build` 类型检查与生产构建通过；既有 npm 配置与约 1.315 MB 主 chunk 警告保留。`node scripts/check-source-details.mjs`：37 项离线检查通过，覆盖链接/Provider/ref 编码/非法 URL、路径规则顺序与通配符/未知元数据、仓库隔离/嵌套副本、排除项触发拒绝、选择刷新清理、正则/检出分支快照和历史/重试保留。没有访问远程 Git 或后端。
- 第二十一轮 `node scripts/check-source-detail-parity.mjs http://127.0.0.1:5182`：最终 39 项浏览器检查通过，零运行时错误与控制台警告；覆盖 Git 链接/完整 SHA 复制与失败恢复、7 位展示、鼠标/键盘/子控件选择隔离、排除项菜单/搜索/刷新/全排除空态、当前仓库修改后的历史链接、PR/Tag/分支与接收详情/原事件 Payload、未知 Provider 与 1280px 内部滚动。截图及结果位于 `web/screenshots-source-detail-parity/`；人工查看选材、历史和 PR/接收详情四张截图。外链和剪贴板通过浏览器内拦截验证，不打开真实提交或写入系统剪贴板。
- 第二十一轮另通过 57 项 Git 源与 31 项构建选材 Mock；浏览器回归通过 42 项 Git 事件源、35 项多仓库选材、39 项镜像详情、38 项关键交互与 46 个路由/状态，均无运行时错误和控制台警告。新增源码与镜像/多仓库检查在最终 7 位 SHA 展示修正后再次执行，其他回归为该局部展示修正前同轮证据。文档结构检查与 `git diff --check` 通过；仍为前端 Mock 与局部视觉证据，未做真实 Git/构建/发布或全状态逐像素验收。
- 第二十轮最终 `npm run build` 类型检查与生产构建通过；既有 npm 配置及约 1.315 MB 主 chunk 警告保留。`node scripts/check-artifact-details.mjs`：31 项离线检查通过，覆盖 registry 端口/tag/digest 与实际 Mock 导入、元信息边界/去重/输入固定/独立副本、Build 归属、懒加载/隐藏/快切/缺失/失败/销毁。没有访问镜像仓库或后端。
- 第二十轮最终生产构建的 `node scripts/check-artifact-detail-parity.mjs http://127.0.0.1:5182`：39 项浏览器检查通过，零运行时错误和控制台警告；覆盖概览镜像/提交、800px 抽屉/上下文/源码顺序/完整 Digest/复制、标签校验/去重/安全文本/草稿保护、四入口回读、同一镜像刷新保留草稿、选择与展开隔离、搜索/键盘、既有预览、外部镜像 Mock 发布到指定历史记录及 1280px 布局。截图与结果见 `web/screenshots-artifact-detail-parity/`，人工查看概览、发布详情、镜像选择与外部镜像；复制通过拦截 clipboard 写入验证。
- 第二十轮另回归通过 49 项应用概览、38 项关键交互、46 个路由/状态、30 项配置/历史、43 项历史日志浏览器检查，均无运行时错误与控制台警告。最后仅收敛元信息编辑器的同 ID 监听，避免列表刷新重置草稿；修正后重做生产构建并再次通过上述 39 项新增完整检查，其他回归为该局部修正前的同轮证据。文档结构与 `git diff --check` 通过；不是后端、真实部署或全部状态逐像素验收。
- 第十九轮 `npm run build` 类型检查与生产构建通过，既有 npm 配置及约 1.315 MB 主 chunk 警告保留。新增 `node scripts/check-pod-logs.mjs`：49 项离线检查通过，覆盖 YAML 三类容器/无效输入、范围与字面 grep/上下文/管道、独立容器与上一实例、时间边界/真实空结果，以及慢请求/迟到错误/隐藏/销毁/重连和模拟流隔离。
- 第十九轮最终生产构建的 `node scripts/check-pod-log-parity.mjs http://127.0.0.1:5182`：44 项浏览器检查通过，零运行时错误和控制台警告；覆盖两处 Manager 入口、容器深链、四种自定义范围/取消/校验、搜索提交/文本安全/完整范围下载、暂停/恢复/Ctrl+C/跟随/顶部底部、独立上一实例/初始化/临时容器、六列事件/刷新/空态和 1280px 布局。下载通过拦截 Blob 与 anchor 触发验证，没有写入真实下载目录；截图与结果见 `web/screenshots-pod-log-parity/`，人工查看集群、应用日志、事件及范围弹窗。
- 第十九轮生产构建重新通过 48 项资源 Manifest、38 项关键交互及 46 个路由/状态浏览器回归，均无运行时错误和控制台警告；另重新通过 48 项资源 Manifest 离线检查。范围弹窗单选项的裁切与横向溢出修正后，再次通过新增的 44 项完整浏览器检查，其他回归为该局部样式修正前的同轮证据。文档结构检查（54 Markdown、533 本地链接、79 HTTP operations、250 schema refs、36 SQL tables）与 `git diff --check` 通过。仍为本地前端与 Mock 证据，没有真实集群、日志服务或全量视觉验收。
- 第十八轮 `npm run build` 类型检查与生产构建通过；原有 npm 配置和约 1.315 MB 主 chunk 警告保留。`node scripts/check-resource-manifests.mjs`：48 项本地检查通过，覆盖所有资源 fixture 身份一致、整棵托管子树/同名业务字段/其他元数据/注释/多行/flow YAML、非法或多文档输入、集群范围身份、Mock 原文/托管字段保留、集群/UID/并发冲突、长文差异，以及校验竞态、错误、读回恢复、切换与销毁。
- 第十八轮 `node scripts/check-resource-manifest-parity.mjs http://127.0.0.1:5182`：48 项生产浏览器检查通过，零运行时错误和控制台警告；包括两处入口的编辑/分栏预览/继续编辑与重新校验/保存读回、隐藏完整子树、复制/下载/失败提示、Tab/Shift+Tab、beforeunload、详情及资源页签、路由/集群/环境切换和顶部刷新草稿保护、长短清单联动、1280px 内部滚动和布局。剪贴板及下载触发在浏览器内拦截，未写系统剪贴板；截图与结果见 `web/screenshots-resource-manifest-parity/`，人工查看集群分栏与 1280px 应用长清单页面。
- 第十八轮同一生产构建重新通过 38 项关键交互及 46 个路由/状态检查，浏览器均无运行时错误和控制台警告；资源动作 Mock 的扩缩容、集群隔离、Namespace 保存与失效 UID 检查通过。文档结构检查（54 Markdown、533 本地链接、79 HTTP operations、250 schema refs、36 SQL tables）与 `git diff --check` 通过。上述均为本地页面和 Mock 证据，没有真实后端、Kubernetes 写入或全量视觉验收。
- 第十七轮 `npm run build` 类型检查与生产构建通过，原有 npm 配置及约 1.315 MB 主 chunk 警告保留。新增 `node scripts/check-dockerfile-templates.mjs`：31 项离线状态/Mock 检查通过，覆盖目录/正文副本、缓存/重置基线、异步竞态、并发字段编辑、错误重试/返回、只读与销毁取消、旧配置/下架/空目录兼容、正文原文、覆盖和不可变构建/重试快照。
- 第十七轮 `node scripts/check-dockerfile-template-parity.mjs http://127.0.0.1:5182`：35 项生产浏览器检查通过，零运行时错误和控制台警告；覆盖工具栏与 300px 编辑器、语言/框架切换、缓存、条件重置、完整复制/失败提示、原生 Tab/Shift+Tab、长文滚动、模式路径保留、保存回读、继承/覆盖/删除、取消/继续/放弃、空白校验及 1280px 布局。剪贴板在浏览器内拦截，没有写系统剪贴板；截图与结果见 `web/screenshots-dockerfile-template-parity/`，人工查看模板、继承与覆盖页面。
- 第十七轮同一生产构建重新通过 42 项构建选项 Mock、30 项构建选项浏览器、35 项多仓库选材、30 项配置/历史、38 项关键交互及 46 个路由/状态浏览器检查，浏览器均无运行时错误与控制台警告。文档结构与 `git diff --check` 通过；以上没有验证真实模板服务、Git 写入或构建执行。
- 第十六轮 `npm run build` 类型检查与生产构建通过；原有 npm 配置及约 1.315 MB 主 chunk 警告保留。新增 `node scripts/check-build-options.mjs`：42 项数据/Mock 检查通过，覆盖空/多选/自定义平台、引用必填/重复/隔离、白名单字段、应用及覆盖保存、版本不变、历史与重试、Buildpacks 模式隔离和版本环境变量联动；没有真实构建或凭据验证。
- 第十六轮 `node scripts/check-build-options-parity.mjs http://127.0.0.1:5182`：30 项生产预览浏览器检查通过，零运行时错误和控制台警告。包含多平台创建/移除/清空与回读、确认返回、引用错误自动展开/重复修复、两类引用与来源、Buildpacks 语言/Builder/环境变量、覆盖保存/取消/删除/继承、选材摘要与构建历史、1280px 布局及长表单不移动导航/页签。截图与结果见 `web/screenshots-build-options-parity/`；人工查看多平台、引用表、Buildpacks 与覆盖页面。
- 第十六轮最终生产构建通过 43 项部署模板、44 项配置对比、46 个路由/状态、38 项关键交互、42 项 Git 事件和 30 项配置/历史浏览器回归，均无运行时错误和控制台警告；同轮较早构建还通过 35 项多仓库选材浏览器检查。另通过既有 31 项构建材料及 57 项 Git 事件/分支 Mock 检查。多仓库材料 Mock 脚本关闭不需要的 HMR，避免独立检查争用 WebSocket 端口。文档结构检查（54 Markdown、533 本地链接）与 `git diff --check` 通过。以上均为本地页面和 Mock 证据，没有真实构建、集群或凭据验收。
- 第十五轮 `npm run build` 类型检查和生产构建通过，继承的 npm 配置及约 1.315 MB 主 chunk 警告仍存在。`node scripts/check-git-sources.mjs`：57 项本地 Mock 检查通过，覆盖事件目录限制、过滤校验/结果、事件归属与引用/提交一致性、快照/重试、相同 SHA 的独立通知、增加仓库限制、正则分支版本冲突、多仓库原子更新及卸载后忽略过期响应。
- 第十五轮 `node scripts/check-git-source-parity.mjs http://127.0.0.1:5182`：42 项生产预览浏览器检查通过，零运行时错误和控制台警告。包含 Tag/PR 表单与草稿保护、深链编辑、过滤空态、接收视图和返回、Payload 展示/复制/失败提示、两种事件触发到源码历史、600px 分支弹窗的必填/正则/取消/保存/重开，以及 1280px 布局与弹窗内部无横向滚动。剪贴板通过拦截页面 `writeText` 验证，不依赖操作系统剪贴板。截图及结果见 `web/screenshots-git-source-parity/`；人工复查配置、事件列表、接收过滤详情和分支弹窗，最终截图已等待提示消息消失。
- 第十五轮最终生产构建重新通过 35 项多仓库选材、30 项配置/历史、38 项关键交互和 46 个路由/状态浏览器检查，均零运行时错误/控制台警告；同轮还通过既有 31 项构建材料 Mock 检查。文档结构检查（54 Markdown、533 本地链接）和 `git diff --check` 通过。以上仅为前端 Mock 与本地页面证据，没有连接远端 Git、接收真实 Webhook 或执行构建。
- 第十四轮 `npm run build` 类型检查与生产构建通过；既有 npm 配置和约 1.315 MB 主 chunk 警告保留。新增 `node scripts/check-application-overview.mjs`：39 项数据/Mock 检查通过，覆盖安全仓库链接、镜像 tag/digest、环境/发布/镜像/构建归属、空值排序、标签副本及兼容、字段/项目冲突原子校验、创建事实与说明原文/元数据。
- 新增 `node scripts/check-application-overview-parity.mjs http://127.0.0.1:5182`：49 项浏览器检查通过，覆盖描述/标签/说明/项目完整编辑、取消与草稿保护、项目路由与切换目录、Markdown 清理、排序/页签深链、镜像详情与发布历史链接、空环境入口，以及 1280px/1024px 布局。零运行时错误与控制台警告；截图和结果见 `web/screenshots-application-overview-parity/`，人工查看关于、标签抽屉和环境列表。刷新保护仅验证 `beforeunload` 取消状态。
- 同一第十四轮生产构建回归通过 48 项创建/克隆、38 项关键交互和 46 个路由/状态浏览器检查，另通过 46 项创建/克隆数据检查。仍为本地前端/Mock 证据，没有验证真实权限变更或 Kubernetes 标签传播。
- 第十三轮 `npm run build` 类型检查与生产构建通过；既有 npm 配置与约 1.314 MB 主 chunk 警告仍存在。新增 `node scripts/check-application-creation.mjs`：46 项数据/Mock 检查通过，覆盖名称/描述/标签、225 条分页来源、取消/重复分页、归档/失效来源、跨项目复制、配置与标签副本隔离和失败不产生半成品。
- 新增 `node scripts/check-application-creation-parity.mjs http://127.0.0.1:5182`：48 项浏览器检查通过，覆盖创建/克隆/镜像导航、名称冲突、标签回读、草稿关闭/路由/刷新事件、来源搜索/返回/预选、原生键盘 Enter 与 Escape、项目上下文和 1280px 布局，零运行时错误/控制台警告。截图与结果见 `web/screenshots-application-creation-parity/`，人工查看克隆卡片与小屏滚动。键盘测试使用 CDP 原生事件；刷新保护检查 `beforeunload` 取消状态，没有操作真实浏览器刷新确认框。
- 同一第十三轮生产构建重新通过 38 项关键交互、51 项配置数据编辑与 46 个路由/状态浏览器检查，均零运行时错误/控制台警告。以上仍为前端 Mock 验证，没有接入应用创建接口或真实部署。
- 第十二轮 `npm run build` 类型检查与生产构建通过，既有 npm 配置及约 1.314 MB 主 chunk 警告仍存在。新增 `node scripts/check-config-data.mjs`：33 项 YAML 数据与行状态检查；新增 `node scripts/check-config-data-parity.mjs http://127.0.0.1:5182`：51 项浏览器检查通过，零运行时错误/控制台警告。覆盖改名/删除/排序、空键/重复键修复、模式切换与离开保护、注释/多行保存回读、别名删除提示、文件表头、继承/Patch/合并预览、Secret 显隐/复制/保存/取消/试运行和 1280px 布局。剪贴板检查通过浏览器内拦截 `writeText` 验证完整或遮蔽内容及失败提示，没有写入操作系统剪贴板。截图与结果见 `web/screenshots-config-data-parity/`，人工查看 ConfigMap 表格与 Secret 遮蔽 YAML。
- 同一第十二轮生产构建重新通过 36 项配置条目/历史/Notes、44 项配置对比、43 项容器任务/阶段配置引用与 46 个路由/状态浏览器检查，均零运行时错误和控制台警告；另通过 18 项快照 Mock、38 项配置对比 Mock 检查。文档结构检查和 `git diff --check` 通过。仍为前端 Mock 与本地页面证据，没有接入后端或执行真实集群操作。
- 第十一轮 `npm run build` 类型检查与生产构建通过；既有 npm 用户配置和约 1.314 MB 主 chunk 警告仍存在。新增 `node scripts/check-history-logs.mjs`：30 项纯搜索/Mock 检查通过，覆盖特殊字符、Unicode/空行/原文保留、产物归属/digest、缺失/过期日志和非成功状态。
- `node scripts/check-history-log-parity.mjs http://127.0.0.1:5182`：43 项浏览器检查通过，零运行时错误与控制台警告；覆盖搜索和键盘循环、完整下载、折叠、展开/Tab 焦点循环/Escape/离开清理、手动滚动/跟随/刷新、实际重叠的记录切换、CI 源码深链、阶段页签/任务 URL 与后退、失效任务修复、自动刷新保留搜索及 1280px 布局。结果和截图见 `web/screenshots-history-log-parity/`，人工查看展开搜索和 1280px 阶段日志截图。
- 第十一轮生产构建重新通过 41 项阶段历史、30 项配置/构建历史、38 项关键交互和 46 个路由/状态浏览器检查，均无运行时错误和控制台警告；路由巡检新增构建日志工具、源码深链和过期日志三个状态。另重新通过 42 项阶段 Mock 检查。组件避开 `logs` 忽略规则迁到 `history` 目录后重建，再次执行新增日志检查与阶段历史、配置历史、路由回归。以上为本地页面与 Mock 验证，没有执行真实 CI/CD，也没有逐像素比对全部页面。
- 第十轮新增 `node scripts/check-config-comparison.mjs`：38 项 Mock 检查通过，覆盖版本目录/归属、基础继承与覆盖、快照缺失与隔离、Secret 额外字段不回显、超过 50 条历史及结构化差异判断；没有执行 Helm 或连接后端。
- 第十轮 `npm run build` 类型检查与生产构建通过。`node scripts/check-config-comparison-parity.mjs http://127.0.0.1:5182`：44 项浏览器检查通过，零运行时错误与控制台警告；覆盖独立入口、URL/直接打开/后退、历史下拉与交换、文件搜索/过滤/排序、GUI/YAML、Secret 边界、失效环境/版本/类型/条目修复、历史往返定位、草稿保护与 1280px 布局。结果及截图见 `web/screenshots-config-comparison-parity/`。
- 第十轮最终生产构建重新通过 43 项部署模板、43 个路由/状态（新增三种对比状态）和 41 项阶段历史浏览器检查；同轮较早构建还通过 36 项配置条目/历史/Notes 和 38 项关键交互检查。部署模板回归明确选择当前已保存基础配置后再验证深层合并，不沿用旧弹窗的默认比较环境假设。
- 第十轮人工查看独立工作区和 1280px 历史差异截图；文档结构检查与 `git diff --check` 通过。仍为本地 Mock 页面验证，没有完成全部页面逐像素比对。
- 第九轮 `npm run build` 类型检查与生产构建通过。`node scripts/check-stage-runs.mjs`：新增 42 项 Mock 检查通过，覆盖版本/镜像/应用/CI 归属、任务/引用/worker 检查、独立存储、并发拦截、取消重试、快照/副本隔离、目标变化、状态推进及阶段操作不创建发布。
- `node scripts/check-stage-run-parity.mjs http://127.0.0.1:5182`：新增 41 项浏览器检查全部通过，零运行时错误与控制台警告；覆盖独立节点及布局、专用镜像抽屉、多任务日志切换、下载/换行、阶段上下文与空态、取消/重试、配置修改后的历史快照、前后置隔离、自动刷新和 1280px 布局。结果和截图见 `web/screenshots-stage-run-parity/`。不是实际任务/容器/部署验收。
- 第九轮最终生产构建重新通过 43 项容器/阶段资源浏览器、38 项关键交互和 40 个路由/状态检查，均无浏览器运行时错误与控制台警告；另通过 26 项阶段设置、35 项容器/资源引用和 18 项配置快照 Mock 检查。同轮较早版本还通过 37 项阶段设置及 36 项配置条目/历史/Notes 浏览器检查；阶段设置脚本同时修正离开草稿时的目标路径为实际 `/trigger`，确认已进入 Build & Deploy 页面。
- 第九轮文档结构检查（54 Markdown、533 本地链接）与 `git diff --check` 通过；人工查看阶段画布、镜像选择和 1280px 历史/日志截图。没有进行全部页面逐像素比对。
- 第八轮 `npm run build` 的类型检查和生产构建通过。新增 `node scripts/check-deployment-stages.mjs` 的 26 项 Mock 检查覆盖兼容默认值、前后/主阶段独立性、环境隔离、触发/布尔值验证、worker 能力变化、失效设置保留/修复、读取隔离及版本冲突。
- `node scripts/check-deployment-stage-parity.mjs http://127.0.0.1:5182`：第八轮新增 37 项浏览器检查通过，覆盖 CD/CI 差异、侧栏顺序、前后/主阶段保存回读、关闭/路由/刷新事件草稿保护、禁用与 tooltip、注入旧配置后的修复路径、任务与设置一起保存和 1280px 布局。结果及截图见 `web/screenshots-deployment-stage-parity/`；仅本地 Mock 页面验证。
- 第八轮重新通过 35 项容器/资源引用 Mock、25 项任务 Mock、43 项容器/阶段资源浏览器、32 项任务浏览器、38 项关键交互和 40 个路由/状态检查。旧任务 Mock 脚本禁用不需要的 HMR，避免与运行中的 Vite 端口冲突。浏览器检查均无运行时错误或控制台警告。
- 第八轮文档结构检查（54 Markdown、533 本地链接）和 `git diff --check` 通过；人工查看 1280px 阶段设置及不可用旧选择修复截图。未做全部页面逐像素比对或真实任务执行验收。
- 第七轮生产构建、类型检查、文档结构检查与 `git diff --check` 通过。新增 `node scripts/check-task-execution.mjs` 的 35 项 Mock 检查通过，覆盖容器结构化配置、旧字段兼容、开关、路径/端口校验、嵌套隔离、资源作用域/去重/类型、删除与覆盖回落。
- `node scripts/check-task-execution-parity.mjs http://127.0.0.1:5182`：第七轮新增 43 项浏览器检查通过；覆盖容器命令/参数、脚本和目录挂载、逐行映射/产物、保存回读/取消/跨阶段移动、阶段配置搜索/多选/关闭/移除、环境隔离/失效引用和 1280px 布局。浏览器零运行时错误和控制台警告；结果和截图见 `web/screenshots-task-execution-parity/`。不是实际容器运行或 Secret 注入验收。
- 第七轮重新通过原有 25 项任务 Mock、32 项任务浏览器、40 个路由/状态和 38 项关键交互检查；最后收紧资源选择菜单关闭/浮层交互后，再次运行完整新增 43 项检查。前述原有回归为菜单调整前的同轮证据。
- `npm run build`：类型检查与生产构建通过。继承的 npm 用户配置警告和约 1.3 MB 主 JS chunk 警告仍存在。
- `node scripts/check-pipeline-tasks.mjs`：第六轮 25 项本地 Mock 检查通过；覆盖嵌套副本隔离、跨阶段依赖、顺序与删除后引用失效、类型化变量/日期、条件约束、插件版本与参数结构、读回隔离。不是脚本/插件执行验收。
- `node scripts/check-pipeline-task-parity.mjs http://127.0.0.1:5182`：第六轮新增 32 项浏览器检查通过；覆盖内嵌目录搜索/过滤/空态、插件版本与参数保存回读、变量引用与条件、排序/跨阶段移动/删除后依赖、Container 切换确认、关闭/路由/刷新事件草稿保护和 1280px 布局。单选/复选框通过图标与文字同行的几何检查，任务详情滚动不移动侧栏，浏览器零运行时错误和控制台警告。结果及截图见 `web/screenshots-pipeline-task-parity/`。
- 第六轮重新通过 40 个路由/状态、38 项关键交互、35 项多仓库页面检查和 31 项构建材料 Mock 检查；文档结构检查与 `git diff --check` 通过。单选/复选框最终样式修正后再次运行新增的完整任务检查，其他回归为该修正前的同轮证据。
- `node scripts/check-pipeline-material-parity.mjs http://127.0.0.1:5182`：第五轮新增 35 项浏览器检查在生产预览通过，零运行时错误和控制台警告；覆盖逐仓库代码源、正则/相对路径校验、覆盖保存/删除/独立性、逐源选择/搜索/刷新、分支切换、无匹配空态、触发后源码与构建配置快照、重试、引用删除保护、1280px 固定操作栏与触发方式单选项对齐。截图及结果见 `web/screenshots-pipeline-material-parity/`。
- `node scripts/check-build-materials.mjs`：31 项本地 Mock 检查通过；包含提交范围隔离、分支头一致、漏选/重复/串用/不匹配拒绝、配置与工作流版本冲突、快照独立副本、后续修改不污染历史、重试沿用、删除覆盖恢复继承，以及增删仓库同步流水线代码源。不是后端构建或真实 Git 验收。
- 第五轮补齐期间重新执行原有 40 个路由状态、38 项关键交互、30 项配置/历史和 36 项配置条目/历史/Notes 检查，均通过且无浏览器错误/警告；重试定位修复后再次通过新增交互和原有 30 项配置/历史检查，最终视觉修复后新增交互检查扩展为 35 项并全部通过。
- `node scripts/check-pages.mjs http://127.0.0.1:5182`：第四轮生产预览上 40 个路由/状态通过，零运行时错误和控制台警告；新增基础/环境 ConfigMaps/Secrets、继承与空态页面覆盖。
- `node scripts/check-devtron-parity.mjs http://127.0.0.1:5182`：生产预览上 38 项关键交互检查通过，零运行时错误/警告；包括资源变更读回、工作流任务保存、多 CI、Release Notes 与镜像备注。详细项目以脚本输出及 `web/screenshots-devtron-parity/results.json` 为准。
- `node scripts/check-configuration-parity.mjs http://127.0.0.1:5182`：30 项配置/历史交互检查；覆盖仓库新增/取消/校验/保存回读/删除保护、三种构建方式、构建参数、CI 历史切换、触发定位、取消重试及 1280px 保存栏和横向溢出。结果见 `web/screenshots-config-parity/results.json`；仍只是前端 Mock 验证。
- `node scripts/check-deployment-template-parity.mjs http://127.0.0.1:5182`：43 项部署模板检查在生产预览上通过，零运行时错误与控制台警告；覆盖 YAML/GUI 保存回读、只读继承、两种合并策略、基础值更新、空对象覆盖、删除/取消/离开确认、无效输入与 1280px 长 YAML 编辑器。结果见 `web/screenshots-deployment-template-parity/results.json`；仍只是前端 Mock 验证。原有 30 项配置、38 项交互与 34 项路由检查在本轮生产构建上重新通过。
- `node scripts/check-config-entry-parity.mjs http://127.0.0.1:5182`：第四轮新增 36 项浏览器交互检查，覆盖配置继承/两种覆盖、YAML 原文、无效输入、草稿保护、恢复继承、空 Patch、挂载/权限、已有资源引用、Secret 遮蔽、三类环境对比、历史快照、缺失快照、Markdown 清理与 1280px 布局。结果和截图见 `web/screenshots-config-entry-parity/`，零运行时错误与控制台警告。
- `node scripts/check-config-snapshots.mjs`：18 项本地 Mock 检查通过，包含作用域拒绝、名称锁定、重复键校验、快照独立副本、后续修改/删除不污染历史、晋级取目标配置、回滚沿用来源快照，以及 Secret 不持久化额外明文字段。不是后端或集群验收。
- `node scripts/check-resource-actions.mjs`：本地 Mock 扩缩容、集群隔离、Namespace 编辑与 UID 失效后禁止重建通过；未连接真实后端或集群。最后的视觉修复还定向复查了任务单选项排列与 Notes 关闭按钮。
- 页面截图：`web/screenshots-pages-parity/`；关键交互截图：`web/screenshots-devtron-parity/`。截图是本地 Mock 验证产物，不是远程 Devtron 或真实集群验收。
- 人工查看应用列表、Manager 菜单、工作流、资源列表和节点操作截图；1280px 代表性资源页面检查无根页面横向溢出。没有做全部页面逐像素差异评分。

## 仍需继续对齐

| 差异 | 后续开发要求 |
| --- | --- |
| 应用创建与概览 | 已有卡片选源、身份/结构标签编辑、分页来源、草稿保护、项目移动和配置导航；概览说明/环境排序、800px 源码/镜像抽屉、跨入口元信息已有页面实现。项目标签策略、企业版模板、权限目录、完整克隆语义、真实标签传播、企业概览区块和镜像标签治理仍待补齐 |
| Application Management 细分配置 | Git 多仓库、Webhook 过滤/选材/接收详情、构建覆盖与三种构建方式、平台多选/自定义确认、Secrets/SSH 引用、Buildpacks 语言/版本/Builder 联动、托管 Dockerfile 模板及部署配置已有前端实现；第三十四轮应用配置/试运行/历史 YAML 统一原生编辑器和双栏差异；第三十五轮扩展至 Dockerfile/Shell 与容器挂载脚本。完整 Provider/PR 策略、ESO/保护审批、真实 Secret/权限、实时模板/Builder 目录、其余上游工具栏、schema/补全及扩展版 BuildSecrets 的实际 UI 仍需核对，多平台执行尚未接入 |
| 流水线插件任务 | 已有内嵌目录、两个示例插件与版本参数、四种类型输入/输出、前序引用和 Trigger/Skip/Pass/Fail 表单；已有容器命令/挂载、CD 阶段配置引用及独立触发/执行环境；完整远程目录、插件创建/治理、File/运行时变量、虚拟环境差异及部分依赖清理交互仍待对齐 |
| 配置对比 | 已有独立路由、URL 两侧环境/版本/文件上下文、当前保存/当前部署/历史版本选择、文件导航搜索/排序/过滤和 GUI/YAML 差异；第三十六轮补缩略图/定位/折叠，第四十二轮补 Configuration/Manifest、单个 Output、Chart 默认值分组/独立版本及快照清单示例；第四十三轮补变量转换、解析值差异重算、URL 模式及历史独立解析快照。受保护草稿/已发布/审批版本、完整作用域/变量管理/敏感值、真实 Chart 目录历史/Helm 渲染与全部状态视觉仍有差异 |
| Helm release Notes | 已实现 Markdown 清理渲染与 50% 只读抽屉；真实 Helm 数据和完整格式截图验收仍待继续 |
| 运行状态与历史 | 已有共用日志工作区、页签/任务 URL、逐仓库源码/构建配置快照、关联 CI 历史、发布/阶段快照与取消重试；第二十一轮补共用提交/PR/Tag/分支链接、完整复制和路径排除选材，第四十一轮已补 ANSI/多节状态、虚拟列表/吸顶标题及屏幕外匹配。真实日志流/重连/归档、任务产物 ZIP、复杂阶段链、Provider/PR 策略与发布历史细节待对齐。当前共享源码组件未渲染文件 Diff，其他源码入口需先核对；既有缺失快照不能还原成真实历史 |
| 资源发现和表格 | 已有 32 类 Discovery fixture、跨 group 身份、结构化字段/CRD/动态附加列、节点 12 项字段/实际用量和列选择。第二十五轮补节点三类组合筛选及两处 Manager 的 Jump 搜索浮层。第二十六轮补普通资源/节点/事件的 URL 搜索排序分页、默认排序、Warning/Normal、深链/历史恢复、末页删除回退、当前页选择和固定分页布局。任意 GVR/服务端 Table/复杂 JSONPath、独立版本接口、Discovery verbs 与真实权限、完整字段和所有状态视觉仍需继续补齐 |
| 资源详情与动态页签 | 第二十七轮补共用页签栏、搜索/关闭菜单、键盘焦点、当前资源刷新/同步时间与最近访问回退；第二十八轮补 32px 页签/操作同排、Infrastructure 删除靠右/Application 隐藏删除、URL 页签与容器、清空存储后当前资源恢复和草稿保护历史导航。更多身份浮层/权限状态、完整编辑器与全部视觉状态仍需核对 |
| 资源 Manifest | 已有共用编辑/原位分栏/校验失效/保存读回、托管子树过滤、草稿保护、固定演示期望/实时只读比较和独立导出；第三十一/三十二轮统一原生 CodeMirror 单栏/双栏、对齐/高亮/查找替换/折叠/撤销重做/虚拟渲染，第三十三轮创建抽屉也复用原生编辑器并补空白直接应用、逐项结果/返回编辑/关闭刷新。第三十四轮完善共用查找命中折叠范围的揭示、上下文标签与历史隔离，第三十六轮补 30px 双栏缩略图、点击/拖动/键盘定位和标题/导出对齐；第三十七轮已补共用查找/替换栏；补全/GUI schema/锁定字段、真实期望来源/服务端归一化与所有状态视觉仍待对齐 |
| Pod／历史日志与事件 | 已有两处 Manager 的 Pod 日志/事件与第四十轮多 Pod 分析器；第四十一轮补构建/发布任务的多阶段事件、状态/有效耗时/平台、ANSI、可视行与吸顶标题、全部折叠/E、屏幕外搜索和滚动锚点。真实流/重连/归档、完整 grep 服务、运行时任务输出/文件、字体/复杂 Unicode 和全部视觉状态仍待补齐 |
| Pod 与集群终端 | 第二十二/二十三轮已有共用 Pod 终端、独立集群终端与节点 Debug Mode、四项 URL 选择、两行工具栏、Pod Events/Manifest/Review/重建、草稿保护和全屏；第三十九轮补共用 xterm/ANSI、光标编辑、完整多行历史/粘贴/续行、选择复制及尺寸重排。仍为字面 Mock；动态临时容器、可选文件下载、超时/并发服务状态、真实调试 Pod 生命周期、字体及所有状态视觉仍待对齐 |
| 集群资源写入 | 需要真实 dry-run/apply、resourceVersion 冲突、对象 UID、后台操作结果和 Kubernetes 权限验证；Mock 不能作为写入安全性证据 |
| 布局细节 | 流水线已补草稿关闭/路由/刷新事件保护和任务列表/详情独立滚动；中文文案、TDesign 与上游共享组件的行高/图标/校验提示仍可能有差异，应用创建/配置/历史页尚未逐状态完成截图验收 |

独立 Chart Store、Security Center、成本平台等不在此次两个 Manager 的指定范围。上述范围内的差异保留为待办，不代表用户取消或同意简化。
