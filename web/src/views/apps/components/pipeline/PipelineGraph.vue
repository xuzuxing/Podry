<script setup lang="ts">
export interface GraphStatus {
  tone: 'success' | 'danger' | 'info' | 'warning'
  label: string
}

export interface GraphSource {
  kicker: string
  value: string
  branch?: string
  icon: string
}

export interface GraphNode {
  id: string
  kind: 'ci' | 'cd'
  kicker: string
  title: string
  icon: string
  status?: GraphStatus
}

export interface GraphRow {
  key: string
  name: string
  source: GraphSource
  ci: GraphNode | null
  cds: GraphNode[]
}

defineProps<{
  rows: GraphRow[]
  showStatus?: boolean
  showActions?: boolean
  editable?: boolean
}>()

const emit = defineEmits<{
  material: [ciId: string]
  image: [cdId: string]
  edit: [id: string]
  details: [id: string]
  addPipeline: [rowKey: string, upstreamId: string]
  removePipeline: [id: string]
}>()
</script>

<template>
  <div class="wfg">
    <section v-for="row in rows" :key="row.key" class="wfg__row">
      <header class="wfg__head">
        <span class="wfg__name">{{ row.name }}</span>
        <button v-if="editable" type="button" class="wfg__kebab" title="更多">…</button>
      </header>

      <div class="wfg__well">
        <!-- 来源 -->
        <div class="wfg__source">
          <div class="wfg__source-main">
            <p class="wfg__kicker">{{ row.source.kicker }}</p>
            <p class="wfg__value" :title="row.source.value">{{ row.source.value }}</p>
            <p v-if="row.source.branch" class="wfg__branch">
              <t-icon name="git-branch" size="12px" />
              <span>{{ row.source.branch }}</span>
              <t-icon name="info-circle" size="12px" class="wfg__hint-icon" />
            </p>
          </div>
          <t-icon :name="row.source.icon" size="18px" class="wfg__source-icon" />
          <button
            v-if="editable && !row.ci"
            type="button"
            class="wfg__plus"
            title="添加流水线"
            @click="emit('addPipeline', row.key, '')"
          >
            +
          </button>
        </div>

        <span class="wfg__arrow" />

        <!-- CI -->
        <div v-if="row.ci" class="wfg__node">
          <span class="wfg__auto">AUTO</span>
          <div class="wfg__node-body">
            <p class="wfg__kicker">{{ row.ci.kicker }}</p>
            <p class="wfg__node-title" :title="row.ci.title">{{ row.ci.title }}</p>
            <p v-if="showStatus && row.ci.status" class="wfg__status">
              <t-icon
                :name="row.ci.status.tone === 'success' ? 'check-circle-filled' : 'error-circle-filled'"
                size="14px"
                :class="`wfg__status-icon wfg__status-icon--${row.ci.status.tone}`"
              />
              <span :class="`wfg__state--${row.ci.status.tone}`">{{ row.ci.status.label }}</span>
              <span class="wfg__slash">/</span>
              <button type="button" class="wfg__link" @click="emit('details', row.ci.id)">Details</button>
            </p>
            <div v-if="showActions" class="wfg__actions">
              <button type="button" class="wfg__square" title="流水线操作" @click="emit('edit', row.ci.id)">
                <t-icon name="ellipsis" size="14px" />
              </button>
              <t-button size="small" variant="outline" @click="emit('material', row.ci!.id)">
                Select Material
              </t-button>
            </div>
          </div>
          <t-icon :name="row.ci.icon" size="18px" class="wfg__node-icon" />
          <div v-if="editable" class="wfg__node-ops">
            <button
              type="button"
              class="wfg__node-op"
              title="添加部署流水线"
              @click="emit('addPipeline', row.key, row.ci.id)"
            >
              +
            </button>
            <button
              type="button"
              class="wfg__node-op"
              title="删除流水线"
              @click="emit('removePipeline', row.ci!.id)"
            >
              <t-icon name="delete" size="13px" />
            </button>
          </div>
        </div>

        <span v-if="row.ci && row.cds.length" class="wfg__arrow wfg__arrow--trunk" />

        <!-- CD 栈：一个构建之后串多个环境部署 -->
        <div v-if="row.cds.length" class="wfg__cds" :class="{ 'wfg__cds--solo': !row.ci }">
          <div v-for="cd in row.cds" :key="cd.id" class="wfg__node">
            <span class="wfg__auto">AUTO</span>
            <div class="wfg__node-body">
              <p class="wfg__kicker">{{ cd.kicker }}</p>
              <p class="wfg__node-title" :title="cd.title">{{ cd.title }}</p>
              <p v-if="showStatus && cd.status" class="wfg__status">
                <t-icon
                  :name="cd.status.tone === 'success' ? 'check-circle-filled' : 'error-circle-filled'"
                  size="14px"
                  :class="`wfg__status-icon wfg__status-icon--${cd.status.tone}`"
                />
                <span :class="`wfg__state--${cd.status.tone}`">{{ cd.status.label }}</span>
                <span class="wfg__slash">/</span>
                <button type="button" class="wfg__link" @click="emit('details', cd.id)">Details</button>
              </p>
              <div v-if="showActions" class="wfg__actions">
                <button type="button" class="wfg__square" title="流水线操作" @click="emit('edit', cd.id)">
                  <t-icon name="ellipsis" size="14px" />
                </button>
                <t-button size="small" variant="outline" @click="emit('image', cd.id)">Select Image</t-button>
              </div>
            </div>
            <t-icon :name="cd.icon" size="18px" class="wfg__node-icon" />
            <div v-if="editable" class="wfg__node-ops">
              <button
                type="button"
                class="wfg__node-op"
                title="添加部署流水线"
                @click="emit('addPipeline', row.key, row.ci ? row.ci.id : cd.id)"
              >
                +
              </button>
              <button type="button" class="wfg__node-op" title="删除流水线" @click="emit('removePipeline', cd.id)">
                <t-icon name="delete" size="13px" />
              </button>
            </div>
          </div>
        </div>

      </div>
    </section>
  </div>
</template>

<style scoped>
.wfg {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.wfg__row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wfg__head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wfg__name {
  color: var(--tk-text-2);
  font-size: 12px;
  font-weight: 600;
}
.wfg__kebab {
  padding: 0 4px;
  color: var(--tk-text-3);
  font-size: 14px;
  line-height: 1;
  background: none;
  border: 0;
  cursor: pointer;
}
.wfg__well {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: #f7f8fa;
  border: 1px solid #e8ebf0;
  border-radius: 4px;
}
.wfg__source {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  width: 208px;
  flex: none;
  padding: 10px 12px;
  background: var(--tk-surface);
  border: 1px solid #e5e8ee;
  border-radius: 4px;
}
.wfg__source-main {
  min-width: 0;
}
.wfg__kicker {
  margin: 0 0 3px;
  color: var(--tk-text-3);
  font-size: 10px;
  letter-spacing: 0.02em;
}
.wfg__value {
  margin: 0;
  color: var(--tk-text);
  font-family: var(--tk-mono);
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wfg__branch {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 4px 0 0;
  color: var(--tk-text-2);
  font-size: 11px;
}
.wfg__hint-icon {
  color: var(--tk-text-3);
}
.wfg__source-icon {
  color: #e8772e;
  flex: none;
}
.wfg__plus {
  position: absolute;
  right: -11px;
  top: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-top: -10px;
  color: var(--tk-text-2);
  font-size: 14px;
  line-height: 1;
  background: var(--tk-surface);
  border: 1px solid #d6dbe4;
  border-radius: 3px;
  cursor: pointer;
}
.wfg__arrow {
  position: relative;
  flex: none;
  width: 40px;
  height: 1px;
  background: #b7c0cd;
}
.wfg__arrow::after {
  content: '';
  position: absolute;
  right: 0;
  top: -4px;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 6px solid #b7c0cd;
}
.wfg__arrow--trunk {
  width: 46px;
}
.wfg__node {
  position: relative;
  display: flex;
  align-items: stretch;
  min-width: 300px;
  background: var(--tk-surface);
  border: 1px solid #e5e8ee;
  border-radius: 4px;
}
.wfg__auto {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  flex: none;
  padding: 8px 0;
  color: #6d5bd0;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.14em;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  background: #e6e3fa;
  border-radius: 4px 0 0 4px;
}
.wfg__node-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
  padding: 10px 12px;
}
.wfg__node-title {
  margin: 0;
  color: var(--tk-text);
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wfg__status {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 2px 0 0;
  font-size: 12px;
}
.wfg__status-icon--success {
  color: #2ba471;
}
.wfg__status-icon--danger {
  color: #d54941;
}
.wfg__status-icon--info {
  color: #0052d9;
}
.wfg__status-icon--warning {
  color: #e37318;
}
.wfg__state--success {
  color: #2ba471;
}
.wfg__state--danger {
  color: #d54941;
}
.wfg__state--info {
  color: #0052d9;
}
.wfg__state--warning {
  color: #e37318;
}
.wfg__slash {
  color: var(--tk-text-3);
}
.wfg__link {
  padding: 0;
  color: var(--tk-primary);
  font: inherit;
  font-size: 12px;
  background: none;
  border: 0;
  cursor: pointer;
}
.wfg__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.wfg__square {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--tk-text-2);
  background: var(--tk-surface);
  border: 1px solid #d6dbe4;
  border-radius: 3px;
  cursor: pointer;
}
.wfg__node-icon {
  flex: none;
  margin: 10px 12px 0 0;
}
.wfg__node-ops {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 6px 8px 0;
}
.wfg__node-op {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--tk-text-2);
  font-size: 13px;
  line-height: 1;
  background: var(--tk-surface);
  border: 1px solid #d6dbe4;
  border-radius: 3px;
  cursor: pointer;
}
.wfg__cds {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-left: 10px;
  border-left: 1px dashed #c9d3e0;
}
.wfg__cds--solo {
  padding-left: 0;
  border-left: 0;
}
</style>
