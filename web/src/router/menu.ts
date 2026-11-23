export interface MenuItem {
  title: string
  icon: string
  path?: string
  group?: string
  children?: MenuItem[]
}

/** 全局菜单与 docs/product/04-function-tree.md 的一级节点一致 */
export const menu: MenuItem[] = [
  {
    title: '工作台',
    icon: 'dashboard',
    children: [
      { title: '项目', icon: 'folder', path: '/projects' },
      { title: '应用', icon: 'app', path: '/apps' },
    ],
  },
  { title: '集群资源', icon: 'server', path: '/clusters' },
  { title: '操作记录', icon: 'history', path: '/audit' },
  { title: '全局设置', icon: 'setting', path: '/settings' },
]

/** 平台设置内部子导航（由 SettingsLayout 渲染，不重复出现在全局侧栏） */
export const settingsNav: MenuItem[] = [
  { title: '团队与成员', icon: 'usergroup', path: '/settings/members', group: '访问控制' },
  { title: '集群接入', icon: 'cloud', path: '/settings/clusters', group: '基础设施' },
  { title: '基础环境', icon: 'layers', path: '/settings/environments', group: '基础设施' },
  { title: '凭据', icon: 'key', path: '/settings/credentials', group: '凭据与仓库' },
  { title: '镜像仓库', icon: 'component', path: '/settings/registries', group: '凭据与仓库' },
]

/** 应用工作台页签（顺序对齐 Devtron：Overview → App Details → Build & Deploy → 两类 History → Configurations） */
export const appTabs = [
  { title: '概览', name: 'app-overview' },
  { title: '运行详情', name: 'app-resources' },
  { title: '构建发布', name: 'app-trigger' },
  { title: '构建历史', name: 'app-builds' },
  { title: '发布历史', name: 'app-deployments' },
  { title: '发布指标', name: 'app-metrics' },
  { title: '配置', name: 'config-git', icon: 'setting' },
]

/** 配置区聚焦导航 */
export const configSections = [
  { title: 'Git 源', name: 'config-git', key: 'git' },
  { title: '构建配置', name: 'config-build', key: 'build' },
  { title: '基础部署配置', name: 'config-base', key: 'base' },
  { title: '工作流', name: 'config-workflow', key: 'workflow' },
  { title: '环境覆盖', name: 'config-overrides', key: 'overrides' },
]
