# Vue 3 + TDesign 工程原型验证

日期：2026-11-20。交互基于已确认的 Devtron 参考，工程实现位于 `web/src/prototype/`。旧 HTML 原型及其 36 项检查保留，不能替代本报告。

> 历史验证记录：本报告证明此前 Vue 原型的本地 Mock 交互和构建检查，不证明当前迁移已实现，也不改变 [轻量化迁移方案](../migration/01-devtron-to-vue-plan.md) 对空 Vite + Vue 3 工程的基线假设。

## 中文研发交付台复验

根据用户“可以不一定要 Devtron、考虑本土化”的反馈，改为中文导航、常驻筛选、代码构建与环境发布工作台、简化创建和编辑。流程关系图保留在配置页，核心源码构建并部署链路不变。当前规范见 [中文团队适配](../prototype/04-localization.md) 和 [视觉约定](../prototype/brand-spec.md)。

- `npm run build:prototype` 与 `npm run build` 均重新通过。
- 独立构建产物上的 **27 项 Chrome 交互检查重新全部通过**；API 响应计数见 [机器报告](vue-prototype-check.json)，全部来自 MSW，浏览器 errors/warnings 均为空，无外部请求。
- 第一项断言包含：152px 中文侧栏、工作区头部 48px、新建按钮圆角 4px、背景色 `rgb(0,82,217)`。窄屏额外断言 1024px 工作区起点为 64px、390px 为 48px。
- 增补同一检查中的中文项目/状态筛选和居中创建弹窗断言，继续用原始 API 枚举验证发布、重试与回滚；不依赖翻译后的状态文本判断任务完成。
- 额外执行 **6 项反馈检查**：中文工作台与三个环境发布入口、配置节点悬停抬升与轻阴影、键盘 Tab 可见聚焦、点击名称打开及关闭编辑抽屉、系统减少动态效果时取消位移，以及浏览器无错误/警告；同时断言应用页签高度 36px。见 [vue-feedback-check.json](vue-feedback-check.json)。
- 修正抽屉样式选择器，使其命中 TDesign 实际的 content-wrapper；提高页签样式优先级，避免独立构建的延迟组件样式覆盖紧凑高度。
- 修正原检查的等待条件：Apply 后等待确认抽屉关闭及实际 Manifest 更新，避免把 Review 中的 Desired 文本当作写入完成；业务实现未改动。
- 截图等待临时提示消失、抽屉过渡完成；当前索引含 24 张业务与反馈截图，见 [当前 Vue 截图](../prototype/vue-screenshots/README.md)。人工查看中文应用列表、新建弹窗、构建发布工作台、流水线配置、编辑抽屉、资源与窄屏。
- 日志检查等待“归档不可用”响应返回，避免任务完成但日志请求仍在途时过早断言。

这是本地 Mock 交互复验，未进行真实 CI 构建、部署或集群写入。检查通过不代表用户已经认可视觉。

## 已执行

- 改动前原有 `web/` 工程构建通过，确认本机 Node/npm 与已安装依赖可用；本轮没有新增依赖或重写已有登录/首页代码。
- `npm run build:prototype`：Vue/TypeScript 检查与独立 Vite 构建通过，输出 `web/dist-prototype/prototype.html` 和静态资产。
- `npm run build`：普通产品入口构建通过，继续输出 `web/dist/index.html`。原型入口及其 Mock 不属于该入口依赖链。
- Vite 开发服务上额外验证 `/prototype.html` 能正常挂载 Vue/TDesign，并在样例应用展示一 CI、三条已有 Deploy，无浏览器异常；完整 27 项检查使用独立构建产物。
- 在独立构建产物上执行 `npm run check:prototype`，**27 项 Chrome/CDP 检查全部通过**，明细见 [vue-prototype-check.json](vue-prototype-check.json)。
- 同一独立产物上执行 `node scripts/check-prototype-feedback.mjs`，6 项反馈检查通过，分别覆盖环境发布列表和三条配置支线。
- 原型构建改用独立 `vite.prototype.config.ts`，只叠加入口和输出目录，保留当前工作区的产品配置；普通产品入口构建单独验证。
- 文档本地链接与 OpenAPI/SQL 结构检查通过；它不执行 SQL，也不是完整接口标准验证器。

## 浏览器覆盖

1. 原生 Vue 与 TDesign 表格、152px 中文导航、48px 工作区页头、主按钮主色/4px 圆角、应用搜索和常驻项目/状态筛选。
2. 创建应用、0/4 初态、空流水线和环境、直达 URL 前置锁。
3. Git 单独保存、hello-world Dockerfile/Context、越界拒绝、Job Base 保存。
4. 完整模板的环境校验和原子创建、一 CI 一 CD、无镜像禁用 Review。
5. Git 失败与过滤清空选择、重试取提交、完整 SHA 构建、无日志仍保留成功产物。
6. 固定 digest 的 Review、应用名确认、模拟 Job Complete / Pod Succeeded、应用内资源上下文。
7. 显式增加生产 CD；发布未知阻止重复提交，执行 Mock 核对后恢复。
8. 晋级/回滚复用历史 digest 与参数；构建失败重试保留原记录和输入，取消等待退出。
9. 资源全宽页签、Pod 日志/演示终端、多个资源页签、Manifest Review 与应用漂移。
10. 扩缩容/重启确认、只读按钮和伪造写请求拒绝、ConfigMap 创建 Review/Apply。
11. 空资源和连接错误区分、集群切换清空页签/Namespace、审计。
12. 1024px / 390px 文档整体不横向溢出；浏览器无异常和 warning，所有业务 API 响应由 MSW 返回，无外部请求。

截图在 [vue-screenshots](../prototype/vue-screenshots/)，与真实 Devtron 截图、旧 HTML 截图分别保存。日常操作见 [中文工作台](../prototype/vue-screenshots/delivery-workbench.png)，关系配置见 [流水线配置](../prototype/vue-screenshots/devtron-workflow.png)，资源变更见 [差异确认](../prototype/vue-screenshots/resource-diff.png)。这是结构与交互验证，不声称用户已认可视觉或完成完整辅助技术验收。

## 实现边界

所有业务执行均为当前页面内存中的 Mock，没有调用测试 Devtron，没有进行真实 Git 获取、构建推送、Helm 发布、资源写入或授权验收。本次不修改 Go 后端、不执行数据库迁移、不提交或推送 Git。本轮修改集中在独立原型外壳、展示组件、样式、检查脚本与 docs；保留已有产品入口和用户的并行修改。

工作区存在其他并行前端改动，本报告的生产构建结果仅证明当前工作区能构建，不将其他页面变化计入本次成果。普通产品包和独立原型包分别构建；构建产物不作为已上线或后端可用的证明。

DTO、演示接口、YAML 和终端限制详见 [工程说明](../prototype/02-vue-engineering.md)。
