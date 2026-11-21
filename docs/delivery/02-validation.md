# V2.1 文档、参考实例与原型验证

日期：2026-11-19。本地修改范围仅 `docs/`，未改动现有 `web/` 或后端业务源码。远程按用户授权创建测试应用并保存配置、执行初始 CI；具体边界与本地模拟分别记录。

2026-11-20 补充：本报告下方保留首次观察时的 53 张截图和 Git 阻塞事实。本次只读重访新增 18 张截图，当前总计 **71 张（27 + 44）**，已观察到完整流水线已有构建和部署成功、1 个健康 Job 与 2 个已完成 Pod；本次没有触发远程构建、发布或资源变更。新增页面与范围见 [27–44 补拍记录](../references/devtron-onboarding/README.md) 和 [画廊新增部分](../references/devtron-onboarding/gallery.html#step-27)。画廊重建已核对 44 张 PNG 的尺寸与 SHA-256，本地文档检查已通过。

## 1. 真实实例观察

已使用用户授权账号登录指定 Devtron 部署，保留 **53 张 1440×1000 原始截图**：前轮 27 张见 [只读观察](../references/devtron-live/README.md)、[画廊](../references/devtron-live/gallery.html)、[索引](../references/devtron-live/manifest.json)；本轮新增 26 张见 [新应用实测](../references/devtron-onboarding/README.md)、[完整工作流画廊](../references/devtron-onboarding/gallery.html)、[变更及截图索引](../references/devtron-onboarding/manifest.json)。索引包含实际路由、界面状态、观察说明、文件 SHA-256 与尺寸。

实际执行：页面导航、展开菜单/分类、打开创建和配置表单、查看执行历史、资源 Manifest、事件和 Pod 日志。补查确认了应用内部资源页签仍保留应用头部、环境与状态区，不应直接跳到全局浏览器。

前轮只读没有触发保存/构建/发布；本轮创建 `podry-hello-world`（app #4，default 项目），保存 Git/Build/Base，先运行临时 CI #3 / build #3，结果 Succeeded。随后按用户纠正使用 **Build & Deploy from Source Code** 创建最终 `wf-4-lxij` #5（CI #4 → CD #3，default_cluster/default），移除本次创建的临时仅构建流程，保留唯一完整工作流。最终 CI 与 CD 都为 MANUAL。

最终 CI 查询 GitHub 提交出现 curl 28 连接超时，Start Build 禁用；其 CD 显示 No Image Available，没有发起第二次构建或真实应用发布。初始构建成功只证明旧 CI 的一次执行，不证明最终工作流成功。没有执行资源浏览器写入、应用部署、扩缩容、重启或远程终端；CI 自身创建的 worker 资源不属于纯只读访问。两次临时浏览器和认证配置均已清理，项目未保存登录凭据、认证头、Cookie 或 Token。

首次 REA 场景初始导航超时，已返回拥有进程清理完成；成功采集采用本机 Chrome CDP，不能写成 REA Evidence。部署的确切版本与 edition 未识别；截图是这个测试实例的观察结果。

## 2. 本地原型检查

执行入口：

```powershell
node docs/tools/build-reference-gallery.mjs
node docs/tools/build-onboarding-gallery.mjs
node docs/tools/build-openapi.mjs
node --check docs/prototype/prototype.js
node --check docs/tools/check-prototype.mjs
node docs/tools/check-docs.mjs
node docs/tools/check-prototype.mjs
```

Chrome Headless 通过 **36 项浏览器检查**，明细见 [prototype-check.json](prototype-check.json)。检查的是实际 DOM、点击、表单提交、Hash 路由与模拟状态，不是仅用字符串搜索源码。

- 64px 图标栏、密集应用表、搜索和 Filter。
- 创建大抽屉及成功进入配置；Git、Build Configuration 独立保存。
- 新应用 0/4 无环境/流水线；内嵌 Git Save/Next；构建路径越界拒绝；Build/Base Save & Next。
- Job 基础模板；3/4 空工作流；主模板 Build & Deploy from Source Code 的必填校验、取消不生成节点、一次创建 CI/Binding/CD。
- 创建成功后进入执行页；第一次无镜像；Git 失败禁用构建和 Retry；成功构建可以独立显示无历史日志。
- 完整本地 CI→产物→Deploy→Job Complete 路径；显式增加生产 CD、强制手动；保存后 Chart 类型锁定。
- 配置二级菜单、Workflow Editor、管线编辑抽屉与阶段切换。
- 基础配置聚焦布局、环境继承与启用覆盖。
- Select Material → 固定提交 → Start Build → 执行历史。
- Select Image → Review → 确认 → 发布历史；晋级、历史快照回滚。
- 未知结果保留目标占用、核对恢复；失败重试保留 attempt；取消等待退出。
- 应用内资源详情保留应用上下文；切换环境不显示旧资源；All resources 保留 Namespace 跳转。
- 集群资源打开全宽动态页签，返回 Kind 保留筛选，重复打开不重复建页签。
- 多资源页签、受控 Manifest 差异与漂移、日志操作、演示终端、扩缩容/重启、只读状态。
- YAML 创建抽屉、预览后模拟创建 ConfigMap；空数据与连接失败；切换集群清空资源上下文。
- 审计记录；1024px、390px 文档整体无横向溢出。
- 页面操作期间 **0 个 HTTP 请求，0 个 console warning/error，0 个未处理运行时异常**。

桌面截图使用 1440×1000，与参考实例一致。响应式截图使用 1024×768、390×844。浏览器检查未覆盖所有键盘/辅助技术、全部 Kind、高级配置字段或所有可能的历史路径。

## 3. 截图对照

| 场景 | 真实参考 | 当前本地原型 |
| --- | --- | --- |
| 应用列表 | [01](../references/devtron-live/01-application-list.png) | [列表](../prototype/screenshots/applications.png) |
| 创建应用 | [03](../references/devtron-live/03-create-application.png) | [创建抽屉](../prototype/screenshots/create-application.png) |
| 构建部署画布 | [05](../references/devtron-live/05-build-deploy.png) | [执行画布](../prototype/screenshots/workflow.png) |
| 配置画布 | [06](../references/devtron-live/06-workflow-editor.png) | [Workflow Editor](../prototype/screenshots/workflow-editor.png) |
| 部署模板 | [09](../references/devtron-live/09-base-configuration.png) | [聚焦配置](../prototype/screenshots/base-configuration.png) |
| 选择提交 | [10](../references/devtron-live/10-select-material.png) | [Material 抽屉](../prototype/screenshots/select-material.png) |
| 选择镜像 | [11](../references/devtron-live/11-select-image.png) | [Image 抽屉](../prototype/screenshots/select-image.png) |
| 构建历史 | [12](../references/devtron-live/12-build-history.png) | [历史分栏](../prototype/screenshots/build-history.png) |
| 发布历史 | [13](../references/devtron-live/13-deployment-history.png) | [发布分栏](../prototype/screenshots/deployment-history.png) |
| 集群入口 | [14](../references/devtron-live/14-resource-clusters.png) | [集群表格](../prototype/screenshots/clusters.png) |
| 集群资源列表 | [16](../references/devtron-live/16-resource-pods.png) | [Kind / Namespace](../prototype/screenshots/resources.png) |
| 集群资源详情 | [17](../references/devtron-live/17-resource-manifest.png) | [动态页签 / Manifest](../prototype/screenshots/resource-detail.png) |
| 创建资源 | [20](../references/devtron-live/20-create-resource.png) | [YAML 抽屉](../prototype/screenshots/create-resource.png) |
| 应用内资源日志 | [26](../references/devtron-live/26-app-resource-logs.png) | [保留应用上下文](../prototype/screenshots/app-resource-logs.png) |
| 应用内资源 Manifest | [27](../references/devtron-live/27-app-resource-manifest.png) | [应用资源页签](../prototype/screenshots/app-resource-manifest.png) |
| 首次 Git | [新增 02](../references/devtron-onboarding/02-git-empty.png) | [0/4 内嵌表单](../prototype/screenshots/onboarding-git.png) |
| 空工作流 | [新增 07](../references/devtron-onboarding/07-workflow-empty.png) | [3/4 空态](../prototype/screenshots/onboarding-workflow-empty.png) |
| 完整模板创建 | [新增 19](../references/devtron-onboarding/19-create-combined-workflow.png) | [CI + CD 一体表单](../prototype/screenshots/onboarding-create-combined.png) |
| 创建后引导 | [新增 22](../references/devtron-onboarding/22-deployment-created-next.png) | [节点与后续选择](../prototype/screenshots/onboarding-workflow-combined.png) |
| Git 网络失败 | [新增 25](../references/devtron-onboarding/25-material-unavailable.png) | [错误与禁止构建](../prototype/screenshots/onboarding-source-error.png) |
| 首次无镜像 | [新增 26](../references/devtron-onboarding/26-select-image-initial.png) | [禁用 Deploy](../prototype/screenshots/onboarding-no-images.png) |

视觉复核关注真实页面和原型的导航、分栏、抽屉、页签关系；未声称像素级一致。Podry 的三环境、一 CI 多 CD、额外发布确认和样例数据是显式产品差异。

## 4. 结构检查与边界

当前 OpenAPI 设计稿为 **76 个 HTTP 操作、87 个 Schema、226 个内部引用**；本轮新增 setup、原子 workflow-templates 和配套 DTO，补充分节保存、Chart/Job、日志可用性与 Clone 合同。SQL 仍为 **31 张表**，新增 chart_config、auto_deploy_allowed 字段；只做表名、引用和文档目录结构核对，未在 PostgreSQL 解析执行。静态工具不是完整 OpenAPI 标准验证器或 SQL 解析器。

未实现或验收 Podry 的真实认证、Git 查询、镜像构建推送、Helm 发布、Kubernetes 授权、真实日志流或终端协议。原型通过不等于后端实现完成，也不等于用户已认可交互。没有运行 Go 测试或现有 web 工程构建，因为这次没有修改业务源码，且工作区有并行修改。

V1 的原型和截图保留在 [archive-v1](../prototype/archive-v1/README.md)，原来的 19 项检查及上一轮 V2 的 26 项检查仅属于历史版，不能替代当前 V2.1 检查。当前交付仍处于 M0，M1–M5 按 [开发计划](01-plan-and-acceptance.md) 实施。
