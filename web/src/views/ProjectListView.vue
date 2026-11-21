<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'

import { createProject, listApplications, listProjects, listTeams } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'

import type { Application, Project, Team } from '@/types'
import { fmtRelative } from '@/utils/format'

interface ProjectCard {
  id: string
  name: string
  teamName: string
  appCount: number
  unhealthyCount: number
  updatedAt: string | null
}

const loading = ref(true)
const error = ref('')

const projects = ref<Project[]>([])
const applications = ref<Application[]>([])
const teams = ref<Team[]>([])

const dialogVisible = ref(false)
const newProjectName = ref('')
const newProjectDescription = ref('')
const creating = ref(false)

const cards = computed<ProjectCard[]>(() =>
  projects.value.map((project) => {
    const apps = applications.value.filter((app) => app.projectId === project.id)
    const updatedAt = apps.reduce<string | null>(
      (latest, app) => (!latest || app.updatedAt > latest ? app.updatedAt : latest),
      null,
    )
    return {
      id: project.id,
      name: project.name,
      teamName: teams.value.find((team) => team.id === project.teamId)?.name ?? project.teamId,
      appCount: apps.length,
      unhealthyCount: apps.filter((app) => app.health === 'degraded').length,
      updatedAt,
    }
  }),
)

const totalApps = computed(() => applications.value.length)
const unhealthyApps = computed(() => applications.value.filter((app) => app.health === 'degraded').length)
const latestUpdatedAt = computed(() =>
  applications.value.reduce<string | null>(
    (latest, app) => (!latest || app.updatedAt > latest ? app.updatedAt : latest),
    null,
  ),
)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [projectItems, appPage, teamItems] = await Promise.all([
      listProjects(),
      listApplications({ page: 1, pageSize: 500 }),
      listTeams(),
    ])
    projects.value = projectItems
    applications.value = appPage.items
    teams.value = teamItems
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载项目失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})

function openCreate(): void {
  newProjectName.value = ''
  newProjectDescription.value = ''
  dialogVisible.value = true
}

function onProjectNameChange(value: string | number): void {
  newProjectName.value = String(value)
}

async function submitCreate(): Promise<void> {
  const name = newProjectName.value.trim()
  if (!name) {
    void MessagePlugin.warning('请输入项目名称')
    return
  }
  creating.value = true
  try {
    await createProject({
      name,
      teamId: teams.value[0]?.id ?? 't-1',
      description: newProjectDescription.value.trim(),
    })
    dialogVisible.value = false
    void MessagePlugin.success(`项目 ${name} 已创建`)
    await load()
  } catch (err) {
    void MessagePlugin.error(err instanceof Error ? err.message : '创建项目失败')
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="projects">
    <div class="tk-toolbar">
      <span class="u-muted">团队 → 项目 → 应用，项目是授权与资源边界</span>
      <span class="u-right u-flex u-gap-8">
        <t-button size="small" variant="text" :loading="loading" @click="load">
          <template #icon><t-icon name="refresh" /></template>
          刷新
        </t-button>
        <t-button theme="primary" size="small" @click="openCreate">
          <template #icon><t-icon name="add" /></template>
          新建项目
        </t-button>
      </span>
    </div>

    <div class="projects__metrics">
      <div class="tk-metric">
        <span class="tk-metric__value">{{ loading ? '—' : projects.length }}</span>
        <span class="tk-metric__label">项目数</span>
      </div>
      <div class="tk-metric">
        <span class="tk-metric__value">{{ loading ? '—' : totalApps }}</span>
        <span class="tk-metric__label">应用总数</span>
      </div>
      <div class="tk-metric">
        <span class="tk-metric__value" :class="{ 'projects__metric-warn': unhealthyApps > 0 }">
          {{ loading ? '—' : unhealthyApps }}
        </span>
        <span class="tk-metric__label">异常应用数</span>
      </div>
      <div class="tk-metric">
        <span class="tk-metric__value projects__metric-time">{{ fmtRelative(latestUpdatedAt) }}</span>
        <span class="tk-metric__label">最近更新</span>
      </div>
    </div>

    <section v-if="loading" class="tk-panel projects__state">
      <t-loading size="small" text="加载中…" />
    </section>

    <section v-else-if="error" class="tk-panel">
      <ErrorState :message="error" @retry="load" />
    </section>

    <section v-else-if="cards.length === 0" class="tk-panel">
      <EmptyState
        title="还没有项目"
        description="项目是应用与授权的边界，先创建一个项目，再在项目里添加应用。"
        icon="folder"
      >
        <template #action>
          <t-button theme="primary" size="small" @click="openCreate">新建项目</t-button>
        </template>
      </EmptyState>
    </section>

    <section v-else class="projects__grid">
      <router-link
        v-for="card in cards"
        :key="card.id"
        class="project-card tk-panel"
        :to="{ name: 'project-detail', params: { projectId: card.id } }"
      >
        <span class="project-card__head">
          <t-icon name="folder" size="15px" class="project-card__icon" />
          <span class="project-card__name u-ellipsis">{{ card.name }}</span>
          <t-icon name="chevron-right" size="14px" class="project-card__arrow" />
        </span>
        <span class="project-card__team u-muted">{{ card.teamName }}</span>
        <span class="project-card__stats">
          <span>应用 <strong>{{ card.appCount }}</strong></span>
          <span :class="{ 'project-card__warn': card.unhealthyCount > 0 }">
            异常 <strong>{{ card.unhealthyCount }}</strong>
          </span>
        </span>
        <span class="project-card__time u-dim">最近更新 {{ fmtRelative(card.updatedAt) }}</span>
      </router-link>
    </section>

    <t-dialog
      :visible="dialogVisible"
      header="新建项目"
      :width="480"
      :confirm-btn="creating ? '创建中…' : '确认创建'"
      cancel-btn="取消"
      @confirm="submitCreate"
      @close="dialogVisible = false"
      @cancel="dialogVisible = false"
    >
      <div class="projects__form">
        <label class="projects__field">
          <span>项目名称</span>
          <t-input :value="newProjectName" placeholder="例如：订单中心" @change="onProjectNameChange" />
        </label>
        <label class="projects__field">
          <span>项目描述（可选）</span>
          <t-textarea
            v-model="newProjectDescription"
            :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="说明这个项目负责的业务范围"
          />
        </label>
        <t-alert theme="info" message="项目会写入当前团队，可在项目卡片中继续创建应用。" />
      </div>
    </t-dialog>
  </div>
</template>

<style scoped>
.projects__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}
.projects__metric-warn {
  color: var(--tk-danger);
}
.projects__metric-time {
  font-size: 15px;
}
.projects__state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 56px 0;
}
.projects__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.project-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  color: var(--tk-text);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.project-card:hover {
  border-color: var(--tk-primary);
  box-shadow: 0 2px 8px rgba(0, 82, 217, 0.08);
}
.project-card__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-weight: 600;
}
.project-card__icon {
  color: var(--tk-text-2);
}
.project-card__name {
  min-width: 0;
}
.project-card__arrow {
  margin-left: auto;
  color: var(--tk-text-3);
}
.project-card:hover .project-card__arrow {
  color: var(--tk-primary);
}
.project-card__team {
  font-size: 11px;
}
.project-card__stats {
  display: flex;
  gap: 16px;
  padding-top: 6px;
  margin-top: 2px;
  border-top: 1px dashed var(--tk-border);
}
.project-card__stats strong {
  font-weight: 600;
}
.project-card__warn {
  color: var(--tk-danger);
}
.project-card__time {
  font-size: 11px;
}
.projects__form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.projects__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--tk-text-2);
}
</style>
