<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'

import { listMembers, listTeams } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import type { Member, MemberRole, Team } from '@/types'
import { roleMap } from '@/utils/format'

const teams = ref<Team[]>([])
const members = ref<Member[]>([])
const teamId = ref('')
const loading = ref(false)
const error = ref('')

const inviteVisible = ref(false)
const inviteEmail = ref('')
const inviteRole = ref<MemberRole>('developer')

const removeVisible = ref(false)
const removeTarget = ref<Member | null>(null)

const columns = [
  { colKey: 'name', title: '姓名', width: 120 },
  { colKey: 'email', title: '邮箱', width: 220 },
  { colKey: 'role', title: '角色', width: 120 },
  { colKey: 'actions', title: '操作', width: 80 },
]

const roleOptions = (Object.keys(roleMap) as MemberRole[]).map((role) => ({ label: roleMap[role].label, value: role }))
const teamOptions = computed(() => teams.value.map((team) => ({ label: team.name, value: team.id })))
const activeTeam = computed(() => teams.value.find((team) => team.id === teamId.value) ?? null)

const rows = computed(() =>
  members.value.map((member) => ({
    id: member.userId,
    userId: member.userId,
    name: member.name,
    email: member.email,
    role: member.role,
  })),
)

const roleSummary = computed(() =>
  (Object.keys(roleMap) as MemberRole[]).map((role) => ({
    role,
    label: roleMap[role].label,
    count: members.value.filter((member) => member.role === role).length,
  })),
)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [teamList, memberList] = await Promise.all([listTeams(), listMembers()])
    teams.value = teamList
    members.value = memberList
    if (!teamList.some((team) => team.id === teamId.value)) {
      teamId.value = teamList[0]?.id ?? ''
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '团队成员加载失败'
  } finally {
    loading.value = false
  }
}

function openInvite(): void {
  inviteEmail.value = ''
  inviteRole.value = 'developer'
  inviteVisible.value = true
}

function confirmInvite(): void {
  const email = inviteEmail.value.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    MessagePlugin.warning('请输入有效邮箱')
    return
  }
  MessagePlugin.info(`静态演示：将调用 POST /teams/${teamId.value}/invitations（邀请 ${email} 为${roleMap[inviteRole.value].label}）`)
  inviteVisible.value = false
}

function askRemove(row: { userId: string; name: string; email: string }): void {
  const found = members.value.find((member) => member.userId === row.userId) ?? null
  removeTarget.value = found
  removeVisible.value = true
}

function confirmRemove(): void {
  if (!removeTarget.value) return
  MessagePlugin.info(`静态演示：将调用 DELETE /members/${removeTarget.value.userId}`)
  removeVisible.value = false
  removeTarget.value = null
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="members">
    <PageHeader title="团队与成员" description="团队用于归属展示；成员角色决定配置、构建与发布的可用动作。" />

    <ErrorState v-if="error" :message="error" @retry="load" />

    <t-loading v-else :loading="loading">
      <div class="members__bar">
        <span class="u-muted">团队</span>
        <t-select v-model="teamId" :options="teamOptions" class="members__team-select" />
        <span class="u-dim">切换团队只影响下方信息卡；当前 mock 的成员接口返回工作空间全部成员。</span>
        <div class="u-right">
          <t-button theme="primary" size="small" @click="openInvite">
            <template #icon>
              <t-icon name="add" />
            </template>
            邀请成员
          </t-button>
        </div>
      </div>

      <div v-if="activeTeam" class="tk-panel members__card">
        <div class="tk-panel__head">
          <span>{{ activeTeam.name }}</span>
          <t-tag size="small" variant="light">{{ rows.length }} 名成员</t-tag>
        </div>
        <dl class="tk-kv tk-panel__body">
          <dt>团队 ID</dt>
          <dd class="u-mono">{{ activeTeam.id }}</dd>
          <dt>成员数</dt>
          <dd>{{ rows.length }} 人</dd>
          <dt>角色分布</dt>
          <dd>
            <div class="u-wrap">
              <t-tag v-for="item in roleSummary" :key="item.role" size="small" variant="light" :theme="item.count ? 'primary' : 'default'">
                {{ item.label }} {{ item.count }}
              </t-tag>
            </div>
          </dd>
          <dt>权限边界</dt>
          <dd class="u-muted">生产环境发布仍需二次确认；拒绝与待核对记录只读。</dd>
        </dl>
      </div>

      <t-table row-key="id" :data="rows" :columns="columns" size="small" hover>
        <template #name="{ row }">{{ row.name }}</template>
        <template #email="{ row }">
          <span class="u-mono">{{ row.email }}</span>
        </template>
        <template #role="{ row }">
          <StatusTag kind="role" :value="row.role" />
        </template>
        <template #actions="{ row }">
          <t-button size="small" variant="text" @click="askRemove(row)">移除</t-button>
        </template>
        <template #empty>
          <EmptyState title="团队还没有成员" description="邀请已有账户加入团队后即可分配角色。" icon="user" compact />
        </template>
      </t-table>
    </t-loading>

    <t-dialog v-model:visible="inviteVisible" header="邀请成员" width="440px" confirm-btn="发送邀请" @confirm="confirmInvite">
      <label class="members__field">
        <span>邮箱</span>
        <t-input v-model="inviteEmail" placeholder="name@company.dev" />
      </label>
      <label class="members__field">
        <span>角色</span>
        <t-select v-model="inviteRole" :options="roleOptions" />
      </label>
      <p class="members__hint">邀请只关联已有账户，不会创建新账户，也不会真正发送邮件。</p>
    </t-dialog>

    <t-dialog v-model:visible="removeVisible" header="移除成员" theme="warning" width="440px" confirm-btn="确认移除" @confirm="confirmRemove">
      <p class="members__hint members__hint--plain">
        确定移除 {{ removeTarget?.name }}（{{ removeTarget?.email }}）？移除后该成员将失去当前工作空间的访问权限。
      </p>
    </t-dialog>
  </div>
</template>

<style scoped>
.members__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.members__team-select {
  width: 180px;
}
.members__card {
  margin-bottom: 12px;
}
.members__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  color: var(--tk-text-2);
}
.members__hint {
  margin: 0;
  color: var(--tk-text-3);
  font-size: 11px;
  line-height: 16px;
}
.members__hint--plain {
  color: var(--tk-text-2);
  font-size: 12px;
  line-height: 18px;
}
</style>
