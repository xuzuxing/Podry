import type { RouteRecordRaw } from 'vue-router'

import AppShell from '@/layouts/AppShell.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: '登录', public: true },
  },
  {
    path: '/',
    component: AppShell,
    children: [
      {
        path: '',
        name: 'projects',
        component: () => import('@/views/ProjectListView.vue'),
        meta: { title: '项目' },
      },
      {
        path: 'projects/:projectId',
        name: 'project-detail',
        component: () => import('@/views/ProjectDetailView.vue'),
        meta: { title: '项目详情', hidden: true, activeMenu: '/' },
      },
      {
        path: 'apps',
        name: 'apps',
        component: () => import('@/views/AppListView.vue'),
        meta: { title: '应用' },
      },
      {
        path: 'projects/:projectId/apps/:appId',
        component: () => import('@/views/apps/AppWorkspaceLayout.vue'),
        children: [
          { path: '', redirect: { name: 'app-overview' } },
          {
            path: 'overview',
            name: 'app-overview',
            component: () => import('@/views/apps/AppOverviewView.vue'),
            meta: { title: '应用概览' },
          },
          {
            path: 'trigger',
            name: 'app-trigger',
            component: () => import('@/views/apps/BuildDeployView.vue'),
            meta: { title: '构建发布' },
          },
          {
            path: 'builds',
            name: 'app-builds',
            component: () => import('@/views/apps/BuildHistoryView.vue'),
            meta: { title: '构建历史' },
          },
          {
            path: 'deployments',
            name: 'app-deployments',
            component: () => import('@/views/apps/DeploymentHistoryView.vue'),
            meta: { title: '发布历史' },
          },
          {
            path: 'metrics',
            name: 'app-metrics',
            component: () => import('@/views/apps/DeploymentMetricsView.vue'),
            meta: { title: '发布指标' },
          },
          {
            path: 'config',
            component: () => import('@/views/apps/config/ConfigLayout.vue'),
            children: [
              { path: '', redirect: { name: 'config-git' } },
              {
                path: 'git',
                name: 'config-git',
                component: () => import('@/views/apps/config/GitSection.vue'),
                meta: { title: 'Git 仓库' },
              },
              {
                path: 'build',
                name: 'config-build',
                component: () => import('@/views/apps/config/BuildSection.vue'),
                meta: { title: '构建配置' },
              },
              {
                path: 'base',
                name: 'config-base',
                redirect: { name: 'config-base-deployment' },
              },
              {
                path: 'base/deployment-template',
                name: 'config-base-deployment',
                component: () => import('@/views/apps/config/DeploymentTemplateSection.vue'),
                meta: { title: '部署模板' },
              },
              {
                path: 'base/configmaps',
                name: 'config-base-configmaps',
                component: () => import('@/views/apps/config/ConfigMapsSection.vue'),
                meta: { title: 'ConfigMaps' },
              },
              {
                path: 'base/secrets',
                name: 'config-base-secrets',
                component: () => import('@/views/apps/config/SecretsSection.vue'),
                meta: { title: 'Secrets' },
              },
              {
                path: 'workflow',
                name: 'config-workflow',
                component: () => import('@/views/apps/config/WorkflowSection.vue'),
                meta: { title: '工作流编辑器' },
              },
              {
                path: 'overrides',
                name: 'config-overrides',
                component: () => import('@/views/apps/config/OverridesLanding.vue'),
                meta: { title: '环境覆盖' },
              },
              {
                path: 'overrides/:envId/deployment-template',
                name: 'config-override-deployment',
                component: () => import('@/views/apps/config/DeploymentTemplateSection.vue'),
                meta: { title: '部署模板' },
              },
              {
                path: 'overrides/:envId/configmaps',
                name: 'config-override-configmaps',
                component: () => import('@/views/apps/config/ConfigMapsSection.vue'),
                meta: { title: 'ConfigMaps' },
              },
              {
                path: 'overrides/:envId/secrets',
                name: 'config-override-secrets',
                component: () => import('@/views/apps/config/SecretsSection.vue'),
                meta: { title: 'Secrets' },
              },
            ],
          },
          {
            path: 'resources',
            name: 'app-resources',
            component: () => import('@/views/apps/AppResourcesView.vue'),
            meta: { title: '运行资源' },
          },
        ],
      },
      {
        path: 'clusters',
        name: 'clusters',
        component: () => import('@/views/clusters/ClusterListView.vue'),
        meta: { title: '集群' },
      },
      {
        path: 'clusters/:clusterId',
        name: 'cluster-workspace',
        component: () => import('@/views/clusters/ClusterWorkspaceView.vue'),
        meta: { title: '集群工作区', hidden: true, activeMenu: '/clusters' },
      },
      {
        // 集群终端（P2 / EX-02、EX-03）：mock 会话 + 只读命令
        path: 'clusters/:clusterId/terminal',
        name: 'cluster-terminal',
        component: () => import('@/views/clusters/ClusterTerminalView.vue'),
        meta: { title: '集群终端', hidden: true, activeMenu: '/clusters' },
      },
      {
        // 节点详情是独立展示页（对齐 Devtron：.../resource-browser/:clusterId/node/detail/:nodeName/:tab）
        path: 'clusters/:clusterId/node/detail/:nodeName/:tab?',
        name: 'node-detail',
        component: () => import('@/views/clusters/NodeDetailView.vue'),
        meta: { title: '节点详情', hidden: true, activeMenu: '/clusters' },
      },
      {
        path: 'clusters/:clusterId/resources/:group/:resource/:namespace/:name/:tab',
        name: 'resource-detail',
        // 旧深链兼容：资源详情现在在工作区页签内打开
        redirect: (to) => ({
          name: 'cluster-workspace',
          params: { clusterId: String(to.params.clusterId ?? '') },
          query: {
            open: [to.params.group, to.params.resource, to.params.namespace, to.params.name]
              .map((part) => String(part ?? ''))
              .join(','),
          },
        }),
        meta: { title: '资源详情', hidden: true, activeMenu: '/clusters' },
      },
      {
        path: 'audit',
        name: 'audit',
        component: () => import('@/views/audit/AuditView.vue'),
        meta: { title: '操作记录' },
      },
      {
        path: 'settings',
        component: () => import('@/views/settings/SettingsLayout.vue'),
        children: [
          { path: '', redirect: { name: 'settings-members' } },
          {
            path: 'members',
            name: 'settings-members',
            component: () => import('@/views/settings/MembersView.vue'),
            meta: { title: '团队与成员' },
          },
          {
            path: 'clusters',
            name: 'settings-clusters',
            component: () => import('@/views/settings/ClustersView.vue'),
            meta: { title: '集群接入' },
          },
          {
            path: 'environments',
            name: 'settings-environments',
            component: () => import('@/views/settings/EnvironmentsView.vue'),
            meta: { title: '基础环境' },
          },
          {
            path: 'credentials',
            name: 'settings-credentials',
            component: () => import('@/views/settings/CredentialsView.vue'),
            meta: { title: '凭据' },
          },
          {
            path: 'registries',
            name: 'settings-registries',
            component: () => import('@/views/settings/RegistriesView.vue'),
            meta: { title: '镜像仓库' },
          },
        ],
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: '页面不存在', public: true },
  },
]

export default routes
