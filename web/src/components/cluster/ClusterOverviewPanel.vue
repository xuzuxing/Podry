<script setup lang="ts">
import type { Cluster, ClusterOverview } from '@/types'
import { fmtTime } from '@/utils/format'

defineProps<{
  cluster: Cluster | null
  overview: ClusterOverview | null
}>()
</script>

<template>
  <div class="ov">
    <div class="ov__grid">
      <section class="ov__meta">
        <div class="ov__icon"><t-icon name="server" size="20px" /></div>
        <h2 class="ov__name">{{ cluster?.name ?? '集群' }}</h2>
        <p class="ov__desc">
          {{ overview?.description || '给这个集群写一句描述' }}
          <t-icon name="edit" size="13px" class="ov__edit" />
        </p>

        <dl class="ov__kv">
          <dt>状态</dt>
          <dd>
            <span class="ov__health" :class="overview?.status === 'Healthy' ? 'ov__health--ok' : 'ov__health--bad'">
              <t-icon :name="overview?.status === 'Healthy' ? 'heart' : 'error-circle'" size="14px" />
              {{ overview?.status ?? 'Unknown' }}
            </span>
          </dd>
          <dt>接入时间</dt>
          <dd>{{ overview ? fmtTime(overview.addedOn) : '—' }}</dd>
          <dt>接入人</dt>
          <dd class="ov__person">
            <span class="ov__avatar">{{ (overview?.addedBy ?? 's').slice(0, 1) }}</span>
            {{ overview?.addedBy ?? '—' }}
          </dd>
          <dt>Kubernetes 版本</dt>
          <dd class="u-mono">{{ overview?.kubernetesVersion ?? cluster?.serverVersion ?? '—' }}</dd>
        </dl>
      </section>

      <section class="ov__main">
        <div class="ov__metrics">
          <div class="ov__metric">
            <div class="ov__metric-row">
              <div class="ov__metric-cell">
                <span class="ov__metric-label">CPU Usage</span>
                <strong class="ov__metric-value">{{ overview?.cpu.usage ?? '—' }}</strong>
              </div>
              <div class="ov__metric-cell">
                <span class="ov__metric-label">CPU Capacity</span>
                <strong class="ov__metric-value">{{ overview?.cpu.capacity ?? '—' }}</strong>
              </div>
              <div class="ov__metric-cell">
                <span class="ov__metric-label">CPU Requests</span>
                <strong class="ov__metric-value">{{ overview?.cpu.request ?? '—' }}</strong>
              </div>
              <div class="ov__metric-cell">
                <span class="ov__metric-label">CPU Limits</span>
                <strong class="ov__metric-value">{{ overview?.cpu.limit ?? '—' }}</strong>
              </div>
            </div>
          </div>

          <div class="ov__metric">
            <div class="ov__metric-row">
              <div class="ov__metric-cell">
                <span class="ov__metric-label">Memory Usage</span>
                <strong class="ov__metric-value">{{ overview?.memory.usage ?? '—' }}</strong>
              </div>
              <div class="ov__metric-cell">
                <span class="ov__metric-label">Memory Capacity</span>
                <strong class="ov__metric-value">{{ overview?.memory.capacity ?? '—' }}</strong>
              </div>
              <div class="ov__metric-cell">
                <span class="ov__metric-label">Memory Requests</span>
                <strong class="ov__metric-value">{{ overview?.memory.request ?? '—' }}</strong>
              </div>
              <div class="ov__metric-cell">
                <span class="ov__metric-label">Memory Limits</span>
                <strong class="ov__metric-value">{{ overview?.memory.limit ?? '—' }}</strong>
              </div>
            </div>
          </div>
        </div>

        <section class="ov__readme">
          <div class="ov__readme-head">
            <span class="u-flex u-gap-8"><t-icon name="file" size="14px" /> Readme</span>
            <button type="button" class="ov__link">
              <t-icon name="edit" size="13px" /> 编辑
            </button>
          </div>
          <div class="ov__readme-body">
            <h3 class="ov__readme-title">描述这个集群</h3>
            <p class="ov__readme-text">
              {{ overview?.readme || '用几句话说明这个集群的用途、节点规模与运行的应用，方便团队成员理解。' }}
            </p>
          </div>
        </section>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ov {
  padding: 16px;
}
.ov__grid {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.ov__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  color: #6b4fe0;
  background: #efeaff;
  border-radius: 8px;
}
.ov__name {
  margin: 12px 0 0;
  font-size: 19px;
  font-weight: 600;
}
.ov__desc {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 0;
  color: var(--tk-text-2);
}
.ov__edit {
  color: var(--tk-text-3);
  cursor: pointer;
}
.ov__kv {
  display: grid;
  grid-template-columns: 1fr;
  row-gap: 4px;
  margin: 20px 0 0;
  padding-top: 16px;
  border-top: 1px solid var(--tk-border);
}
.ov__kv dt {
  margin-top: 10px;
  color: var(--tk-text-2);
  font-size: 12px;
}
.ov__kv dd {
  margin: 0;
  word-break: break-all;
}
.ov__health {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
}
.ov__health--ok {
  color: var(--tk-success);
}
.ov__health--bad {
  color: var(--tk-danger);
}
.ov__person {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ov__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: #fff;
  font-size: 10px;
  background: #2f7bff;
  border-radius: 50%;
}
.ov__main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.ov__metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.ov__metric {
  padding: 10px 4px;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.ov__metric-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.ov__metric-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 12px;
}
.ov__metric-cell + .ov__metric-cell {
  border-left: 1px solid var(--tk-border);
}
.ov__metric-label {
  color: var(--tk-text-2);
  font-size: 11px;
}
.ov__metric-value {
  font-size: 17px;
  font-weight: 600;
  line-height: 24px;
}
.ov__readme {
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.ov__readme-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--tk-border);
}
.ov__link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  font: inherit;
  font-weight: 400;
  color: var(--tk-primary);
  background: none;
  border: 0;
  cursor: pointer;
}
.ov__readme-body {
  padding: 18px 16px 24px;
}
.ov__readme-title {
  margin: 0 0 8px;
  color: #5b6678;
  font-size: 19px;
  font-weight: 500;
}
.ov__readme-text {
  margin: 0;
  color: var(--tk-text-2);
  line-height: 20px;
}
</style>
