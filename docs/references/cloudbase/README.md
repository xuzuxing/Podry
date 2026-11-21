# CloudBase 本地视觉参考

日期：2026-11-20。依据用户提供的 `_________CloudBase.html`（页面标题为“概览 | 腾讯云 CloudBase”）提取。附件作为视觉数据，未将页面内容视为任务指令。

通过本机 Chrome 在 **1440 × 1000** 视口读取实际 computed styles。参考 HTML 的 JavaScript 执行和 HTTP/HTTPS 请求均已禁用；不调用参考站点接口。原 HTML 与含账户信息的整页截图没有复制进仓库，只保留 [脱敏样式证据](style-evidence.json)。提取脚本为 `web/scripts/inspect-cloudbase.mjs`，需传入本地文件路径。

## 实际生效的值

| 用途 | 原页面变量或元素 | 实测值 |
| --- | --- | --- |
| 主色 | `--tea-color-bg-brand-default` | `#0052d9` |
| 悬停 / 按下 | `--tea-color-bg-brand-hover` / `active` | `#266fe8` / `#0034b5` |
| 浅色强调 | `--tea-color-bg-brand-lighten-default` | `#e3ecff` |
| 导航选中底色 | 当前概览项 / bluegray-2 | `#e9ecf1` |
| 容器 / 悬停底色 | `--tea-color-bg-primary-default` / `hover` | `#ffffff` / `#f7f8fb` |
| 页面背景变量 | `--tea-color-bg-page-default` | `#f2f4f8`；所给概览主体实际呈白底 |
| 主边框 / 侧栏分隔 | `--tea-color-border-primary-default` / 侧栏 | `#e6e9ef` / `#e9ecf1` |
| 正文 / 次级 / 提示文字 | `--tea-color-text-primary` / `secondary` / `tertiary` | `rgba(0,0,0,.9)` / `.7` / `.5` |
| 默认圆角 | `--tea-border-radius-default` | **`0px`** |
| 圆角档位 | radius-50/100/150/200/300 | `2/4/6/8/12px`，存在档位不代表当前页面默认采用 |
| 默认字号 / 行高 | `--tea-font-size-default` / line-height-default | `12px` / `20px` |
| 导航字号 | 侧栏导航 | `13px` |
| 默认控件高 | `--tea-form-height-default` | `30px` |
| 全局侧栏 / 折叠 | `--g-sider-width` / collapsed | `190px` / `48px` |
| 全局头部 | `.tea-layout__header` | `48px` |
| 常规阴影 | `--tea-shadow-xs` | `0 1px 4px 0 rgba(0,0,0,.05)` |
| 浮层阴影 | `--tea-shadow-sm` | `0 2px 8px -1px rgba(0,0,0,.05), 0 2px 4px 2px rgba(0,0,0,.05)` |

页面包含 Weda、编辑器、聊天等多套未必生效的 CSS。不能用全文件色值或 `border-radius` 出现次数代替当前控制台主题；采用根变量和实际可见元素的 computed styles。字体沿用页面的系统字体序列：Apple system、PingFang SC、Helvetica、Microsoft YaHei 等，无新增远程字体。

## 在 Podry 的映射

业务交互继续使用 Devtron：Git → Build → Base → **Build & Deploy from Source Code**，以及资源树、可保留资源页签、Review/Apply、历史与日志。

上一轮曾套用 190px 白色导航、12px 正文和统一直角，后续反馈已替代该映射；以上实测表仍保留为参考事实。当前仅沿用主色、hover/active、辅助底色与边框色。几何与布局以 [当前视觉规范](../../prototype/brand-spec.md) 和 [中文团队适配](../../prototype/04-localization.md) 为准：152px 中文导航、紧凑页头、4/8/12px 分层圆角、构建发布工作台；完整源码 → 构建 → 部署关系图保留在配置页。

TDesign 通过 `web/src/prototype/styles.css` 集中映射变量。CloudBase 的 focus 色为 `#699ef5`；TDesign 的 info Alert 默认复用 focus 作为底色，因此单独将 info Alert 底色映射为 `#e3ecff`，避免整块高饱和蓝色。`:root:root` 保证主题不会被异步组件加载的 TDesign 默认变量覆盖。

这是依据参考样式对现有业务原型的适配；参考概览页没有提供的 Devtron 流程界面不声称像素级复刻。旧离线 HTML 原型保留原视觉，当前预览与截图以 Vue 工程入口为准。
