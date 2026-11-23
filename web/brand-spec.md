# Podry Web 参考资产与设计基线

日期：2026-11-23。

- 品牌：保留 Podry。现有 favicon 位于 `public/favicon.svg`。
- 布局与交互来源：`D:/workspace/devtron-dashboard`，提交 `ecea7af01c628e0b60720e53fe969e204cdbe8ef`；实例截图位于 `docs/references/devtron-live/` 和 `devtron-onboarding/`。
- 背景：外框改用纯色 `#17191e`，展开的二级菜单使用纯黑 `#000`；菜单悬停和选中使用半透明白色区分。历史资产 `src/assets/devtron-bg.webp` 保留但不再用于外框与菜单，复制自 Devtron `src/assets/img/devtron-bg.webp`，未修改。上游仓库采用 Apache License 2.0，许可证副本随 `public/licenses/devtron-dashboard-LICENSE.txt` 分发；当前上游根目录未发现 NOTICE 文件。
- 组件：Vue 3 + TDesign，自行重写，没有复制 React 组件和全局样式。
- 颜色：主操作 `#0066cc`，正文 `#000a14`；具体变量见 `src/styles/base.less`。
- 外框：64px 图标轨道、224px 子菜单、48px 页头、白色工作区。
- 字体：沿用系统字体栈，代码和 Manifest 使用等宽字体；没有复制字体文件。
- 图标：主要来自 TDesign；Podry 标识与现有流水线图标沿用工程资产。
