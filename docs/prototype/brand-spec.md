# Vue 工程原型视觉与交互约定

2026-11-20：当前开发使用 [Vue 3 + TDesign 工程版](02-vue-engineering.md)，继续沿用本页的 Devtron 交互基线。下文的双击离线、无 API、终端命令等说明属于旧 HTML 原型；工程版通过 HTTP + MSW，演示终端支持 help / clear / status，具体运行与边界以工程说明为准。

业务参考来自登录用户测试实例后的 [27 张只读截图](../references/devtron-live/gallery.html) 与 [44 张新应用截图](../references/devtron-onboarding/gallery.html)（2026-11-19 首次 26 张、2026-11-20 补拍 18 张构建、发布与资源页面）。2026-11-20 根据用户最新反馈适配中文研发团队：中文导航、常驻筛选、构建与环境发布工作台、简化弹窗与编辑抽屉；详见 [本土化说明](04-localization.md)。不再逐页复刻 Devtron 布局。CloudBase 仅保留配色参考，实测值见 [CloudBase 样式与映射](../references/cloudbase/README.md)。产品继续使用 Podry 名称与独立实现。

## 设计取值

| 项目 | 取值与用途 |
| --- | --- |
| 场景 | 桌面工程控制台，近距离阅读，高密度表格和代码 |
| 全局导航 | 152px 深海军蓝中文导航；1120px 及以下折叠为 64px 图标栏，720px 以下为 48px；选中底色、左侧蓝标记及 Tooltip |
| 主工作区 | 外缘 8px、白底 9px 圆角；工作区头部 48px、应用页签 36px、常规内边距 20px |
| 二级导航 | 配置 200px；历史列表 270px；资源树 220px，窄视口按工程样式缩小 |
| 临时操作 | 新建应用使用 560px 居中弹窗；流水线编辑 560px、创建 720px 抽屉；镜像选择/差异对照使用较宽抽屉，均受视口限制；浮层 12px 圆角 |
| 常规文字 | 系统字体 / PingFang SC / Helvetica / Microsoft YaHei，主体及表格 13px、行高 20px，辅助文字 11–12px，一级标题 16px |
| 代码 | Consolas / monospace，12–13px；资源 Manifest 和日志使用深色工作区 |
| 主要色 | `#0052d9` 操作；hover `#266fe8`；active `#0034b5`；浅色强调 `#e3ecff`；配置导航选中 `#eaf2ff` |
| 中性色 | 白底；辅助底色 `#f7f8fb`；工作流画布 `#f7f9fc`；边框 `#e6e9ef`；主/次/辅助文字 `#252f43` / `#5b6678` / `#7b8798` |
| 状态 | 绿色成功、红色失败、黄色未知；同时保留文字，避免只靠颜色 |
| 间距与形状 | 8/12/16/20/24/32px；常规控件高 32px，节点按钮 28px；控件 4px、内部面板 6px、节点 8px、浮层 12px |
| 阴影 | 常规面板细边框；节点 hover/focus 使用蓝灰轻阴影，抽屉采用侧向阴影 |
| 动效 | 页面进入 180ms；悬停/聚焦 160–180ms；按钮按下 1px、节点轻抬 2px；运行图标 1.6s 呼吸；尊重 prefers-reduced-motion |
| 品牌 | 独立 P 字母 SVG 与 P 头像；通用图标复用现有工程出口 |

本表为当前 Vue 工程版视觉；旧离线 HTML 保留历史版本。Devtron 提供业务参考，当前页面按中文团队的日常路径调整。布局和反馈在本地浏览器检查，审美认可由用户实际体验判断。

## 工作流节点与反馈

日常“构建发布”使用 DeliveryWorkbench：左侧 300px 展示代码仓库、分支、最近构建和构建按钮，右侧逐行展示部署环境、集群、命名空间、最近发布状态和发布按钮。窄屏改为上下排列。状态来自 Store，组件只发出构建/发布事件。

“应用配置 → 流水线配置”保留 WorkflowNode 关系图：源代码节点宽 200px、构建/部署节点宽 208px、最小高 112px；阶段与手动侧条使用中文，一 CI 连接多个环境使用共享主干和支线。点击名称或齿轮打开简化编辑抽屉。键盘聚焦有可见轮廓，环境行与节点保留悬停反馈。未知结果显示“结果待核对”，生产发布保留名称确认。

最新效果见 [构建发布工作台](vue-screenshots/delivery-workbench.png)、[流水线配置](vue-screenshots/devtron-workflow.png)、[编辑抽屉](vue-screenshots/pipeline-edit.png) 与 [截图索引](vue-screenshots/README.md)。反馈检查脚本为 `web/scripts/check-prototype-feedback.mjs`，结果见 [机器报告](../delivery/vue-feedback-check.json)。状态、环境显示名与 24 小时时间集中在 `utils/display.ts`；接口枚举、资源名、Kind、digest 和 YAML 保留原值。

## 资产与证据

| 类型 | 位置 | 说明 |
| --- | --- | --- |
| 真实截图 | [devtron-live](../references/devtron-live/README.md) | 登录后的现场页面，用于项目内设计对照 |
| 机器索引 | [manifest.json](../references/devtron-live/manifest.json) | 参考路由、截图、交互状态、观察限制 |
| 截图画廊 | [gallery.html](../references/devtron-live/gallery.html) | 浏览原始截图与逐项观察 |
| 新应用实测 | [onboarding](../references/devtron-onboarding/README.md) | 新建应用、Build & Deploy 模板、真实写入和执行边界 |
| 本地原型截图 | [screenshots](screenshots/) | 自动化生成的模拟页面，与真实截图分目录保存 |
| 旧版 | [archive-v1](archive-v1/README.md) | 保留首轮原型，已被 V2 交互规格替代 |

所有图片均通过本地相对路径引用。离线原型没有远程字体、CDN、图片请求、遥测、真实登录或 API 请求；只有明确点击对照链接才离开当前页面。

## 体验路径

直接打开 [index.html](index.html)。推荐依次体验：

1. Create → Custom app → Git Save/Next → Build Save & Next → Base 模板 Save & Next → New Workflow → Build & Deploy from Source Code → 同时生成 Build 和 Deploy；hello-world 选 Job 模板。详见[完整步骤](../references/devtron-onboarding/README.md)。
2. checkout-api → Configurations → Workflow Editor → 点击 CI/CD 编辑按钮。
3. Build & Deploy → Select Material → 选提交 → Start Build → Build History。
4. Build & Deploy → Select Image → 选镜像 → Review → Confirm Deploy → Deployment History。
5. 全局 Resource Browser → 集群 → Workloads / Pod → Namespace → 资源名称 → Manifest / Events / Logs / Terminal。
6. 返回 Kind 页签再打开另一个资源，观察页签保留、关闭和去重；使用 Demo 面板体验只读与异常场景。

## 受控差异

样例名称、镜像地址、资源版本和状态均为合成数据。原型保留英文 Devtron 页面名称以便对照，说明和业务约束使用中文。首版不扩展 Chart 商店、独立 Job 工作流平台、CronJob 调度、指标产品、复杂工作流；应用部署支持一次性 Job 类型。不把现场未执行的终端、发布或资源写入当作已验证交互。

GUI/YAML 目前仅演示部分字段；创建资源仅支持一个 ConfigMap；Vue 终端仅支持 help / clear / status（旧 HTML 为 help/pwd/ls/date/clear）；流水线前后置阶段显示范围说明。这些边界在面板内直接说明。

桌面为主要验收尺寸。1024px 保持 64px 图标导航；390px 使用 48px 导航，保留工作区与表格内滚动，不把手机完成复杂集群操作作为本期承诺。刷新和 Demo 重置会恢复样例，未做跨刷新状态持久化。
