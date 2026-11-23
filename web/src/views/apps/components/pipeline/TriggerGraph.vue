<script setup lang="ts">
/**
 * 构建发布画布：按真实 Devtron Build & Deploy 页的 SVG 坐标与节点样式复刻。
 * 画布固定 1280 宽，节点为 200x126（来源 200x64），触发方式竖排在节点左侧，连线上带实心箭头。
 */
import { computed } from 'vue'
import type { DeploymentStageType } from '@/types'
import StageWorkflowNode from '@/components/application/StageWorkflowNode.vue'

import PipelineBuildIcon from './icons/PipelineBuildIcon.vue'
import PipelineCdIcon from './icons/PipelineCdIcon.vue'

export type TriggerTone = 'success' | 'danger' | 'warning' | 'neutral' | 'info'

export interface TriggerStatus {
  label: string
  tone: TriggerTone
  /** 是否展示 “/ Details” 链接（Not Triggered / Not Deployed 不展示） */
  details?: boolean
}

export interface TriggerSource {
  kind: 'git' | 'webhook'
  repo: string
  branch: string
}

export interface TriggerCiNode {
  id: string
  name: string
  trigger: 'MANUAL' | 'AUTO'
  status?: TriggerStatus
}

export interface TriggerCdNode {
  id: string
  bindingId: string
  environment: string
  strategy: string
  trigger: 'MANUAL' | 'AUTO'
  status?: TriggerStatus
  preStage?: TriggerStageNode
  postStage?: TriggerStageNode
}

export interface TriggerStageNode {
  stage: DeploymentStageType
  trigger: 'MANUAL' | 'AUTO'
  status?: TriggerStatus
}

export interface TriggerRow {
  key: string
  name: string
  source: TriggerSource
  ci: TriggerCiNode | null
  cds: TriggerCdNode[]
}

const props = defineProps<{ rows: TriggerRow[]; editable?: boolean }>()

const emit = defineEmits<{
  material: [ciId: string]
  image: [cdId: string]
  rollback: [cdId: string]
  details: [kind: 'ci' | 'cd', id: string]
  edit: [id: string]
  remove: [id: string]
  add: [upstreamId: string]
  stageImage: [pipelineId: string, stage: DeploymentStageType]
  stageDetails: [pipelineId: string, stage: DeploymentStageType]
}>()

const NODE_W = 200
const NODE_H_READONLY = 126
const SOURCE_H = 64
const GAP = 25
const X_SOURCE = 20
const X_CI = 280
const X_CD = 540
const Y = 24
const CANVAS_W = 1280

interface NodeBox {
  id: string
  x: number
  y: number
  w: number
  h: number
}

interface EdgePath {
  key: string
  line: string
  head: string
}

interface RowLayout {
  key: string
  name: string
  height: number
  source: NodeBox
  ci: (TriggerCiNode & NodeBox) | null
  cds: (TriggerCdNode & NodeBox)[]
  stages: (TriggerStageNode & NodeBox & {pipelineId: string})[]
  edges: EdgePath[]
  row: TriggerRow
}

/** 实心箭头：与 Devtron 的 svg 路径一致（尖端 5px、尾部 10px 缺口） */
function arrow(x: number, y: number): string {
  return `M${x - 5} ${y} L${x - 15} ${y - 10} L${x - 10} ${y} L${x - 15} ${y + 10} Z`
}

function layoutOf(row: TriggerRow): RowLayout {
  const NODE_H = props.editable ? 86 : NODE_H_READONLY
  const hasCi = Boolean(row.ci)
  const sourceY = hasCi ? Y : Y + (NODE_H - SOURCE_H) / 2
  const cdX = hasCi ? X_CD : X_CI
  const cdYs = row.cds.map((_, index) => Y + index * (NODE_H + GAP))
  const contentBottom = row.cds.length ? cdYs[cdYs.length - 1] + NODE_H : Y + (hasCi ? NODE_H : SOURCE_H)
  const height = Math.max(Y + NODE_H + Y, contentBottom + Y)

  const source: NodeBox = { id: 'source', x: X_SOURCE, y: sourceY, w: NODE_W, h: SOURCE_H }
  const ci: (TriggerCiNode & NodeBox) | null = row.ci
    ? { ...row.ci, id: row.ci.id, x: X_CI, y: Y, w: NODE_W, h: NODE_H }
    : null
  const cds = row.cds.map((cd, index) => ({ ...cd, x: cdX + (!props.editable && cd.preStage ? 260 : 0), y: cdYs[index], w: NODE_W, h: NODE_H }))
  const stages: RowLayout['stages'] = []
  if (!props.editable) cds.forEach(cd => {
    if (cd.preStage) stages.push({...cd.preStage, pipelineId:cd.id, id:`${cd.id}-pre`,x:cdX,y:cd.y,w:NODE_W,h:NODE_H})
    if (cd.postStage) stages.push({...cd.postStage, pipelineId:cd.id, id:`${cd.id}-post`,x:cd.x+260,y:cd.y,w:NODE_W,h:NODE_H})
  })

  const edges: EdgePath[] = []
  const sourceMid = sourceY + SOURCE_H / 2
  const ciMid = Y + NODE_H / 2

  if (ci) {
    const startX = X_SOURCE + NODE_W
    edges.push({
      key: `${row.key}-src-ci`,
      line: `M${startX} ${sourceMid} L${X_CI} ${sourceMid}`,
      head: arrow(X_CI, sourceMid),
    })
  }

  if (ci && cds.length) {
    const ciRight = X_CI + NODE_W
    if (cds.length === 1) {
      edges.push({
        key: `${row.key}-ci-cd0`,
        line: `M${ciRight} ${ciMid} L${cdX} ${ciMid}`,
        head: arrow(cdX, ciMid),
      })
    } else {
      const trunkX = ciRight + 30
      cds.forEach((cd, index) => {
        const y = cd.y + NODE_H / 2
        edges.push({
          key: `${row.key}-ci-cd${index}`,
          line: `M${ciRight} ${ciMid} H${trunkX} V${y} H${cdX}`,
          head: arrow(cdX, y),
        })
      })
    }
  } else if (!ci && cds.length) {
    const startX = X_SOURCE + NODE_W
    if (cds.length === 1) {
      edges.push({
        key: `${row.key}-src-cd0`,
        line: `M${startX} ${sourceMid} L${cdX} ${sourceMid}`,
        head: arrow(cdX, sourceMid),
      })
    } else {
      const trunkX = startX + 30
      cds.forEach((cd, index) => {
        const y = cd.y + NODE_H / 2
        edges.push({
          key: `${row.key}-src-cd${index}`,
          line: `M${startX} ${sourceMid} H${trunkX} V${y} H${cdX}`,
          head: arrow(cdX, y),
        })
      })
    }
  }

  // 主干连接到每条 CD 链的第一个节点，阶段连线只在运行画布展示。
  if (!props.editable) cds.forEach(cd => {
    if (cd.preStage) edges.push({key:`${cd.id}-pre-main`,line:`M${cdX+NODE_W} ${cd.y+NODE_H/2} H${cd.x}`,head:arrow(cd.x,cd.y+NODE_H/2)})
    if (cd.postStage) edges.push({key:`${cd.id}-main-post`,line:`M${cd.x+NODE_W} ${cd.y+NODE_H/2} H${cd.x+260}`,head:arrow(cd.x+260,cd.y+NODE_H/2)})
  })
  return { key: row.key, name: row.name, height, source, ci, cds, stages, edges, row }
}

const layouts = computed<RowLayout[]>(() => props.rows.map(layoutOf))

const toneColor: Record<TriggerTone, string> = {
  success: '#1dad70',
  danger: '#f33e3e',
  warning: '#ff8300',
  neutral: '#767d84',
  info: '#0066cc',
}

function statusColor(status: TriggerStatus): string {
  return toneColor[status.tone]
}

const strategyLabel: Record<string, string> = {
  rolling: '滚动更新',
  canary: '灰度',
  bluegreen: '蓝绿',
}

function strategyText(strategy: string): string {
  return strategyLabel[strategy] ?? strategy
}

function triggerText(trigger: 'MANUAL' | 'AUTO'): string {
  return trigger === 'AUTO' ? '自动' : '手动'
}

/** 工作流标题右侧的触发方式速览：构建/部署各多少条、自动与手动分布 */
function summaryOf(row: TriggerRow): string {
  const ci = row.ci ? `构建${triggerText(row.ci.trigger)}` : '无构建'
  if (!row.cds.length) return `${ci} · 无部署`
  const auto = row.cds.filter((cd) => cd.trigger === 'AUTO').length
  const manual = row.cds.length - auto
  const parts = [`部署 ${row.cds.length} 条`]
  if (auto) parts.push(`自动 ${auto}`)
  if (manual) parts.push(`手动 ${manual}`)
  return `${ci} · ${parts.join(' / ')}`
}

function triggerHintOf(row: TriggerRow, trigger: 'MANUAL' | 'AUTO'): string {
  const branch = row.source.branch ? `分支 ${row.source.branch}` : row.source.repo
  if (trigger === 'AUTO') return `自动触发：监听 ${branch} 的变更后自动执行`
  return `手动触发：由人工在构建发布页选择提交/镜像后执行`
}
</script>

<template>
  <div class="wfs">
    <section v-for="layout in layouts" :key="layout.key" class="wf">
      <header class="wf__head">
        <span data-testid="workflow-heading" class="wf__name">{{ layout.name }}</span>
        <span class="wf__meta">{{ summaryOf(layout.row) }}</span>
      </header>

      <div class="wf__well">
        <div class="wf__canvas" :style="{ height: `${layout.height}px` }">
          <svg class="wf__edges" :width="CANVAS_W" :height="layout.height" aria-hidden="true">
            <g v-for="edge in layout.edges" :key="edge.key">
              <path :d="edge.line" fill="transparent" stroke="#959ba1" stroke-width="2" />
              <path :d="edge.head" fill="#596168" />
            </g>
          </svg>

          <!-- 来源：Git 仓库 / 外部镜像 -->
          <div
            class="tnode tnode--static"
            :style="{
              left: `${layout.source.x}px`,
              top: `${layout.source.y}px`,
              width: `${layout.source.w}px`,
              height: `${layout.source.h}px`,
            }"
          >
            <svg
              v-if="layout.row.source.kind === 'git'"
              class="tnode__source-icon"
              width="20"
              height="20"
              viewBox="0 0 48 48"
            >
              <path
                fill="#F4511E"
                d="M42.2,22.1L25.9,5.8C25.4,5.3,24.7,5,24,5c0,0,0,0,0,0c-0.7,0-1.4,0.3-1.9,0.8l-3.5,3.5l4.1,4.1c0.4-0.2,0.8-0.3,1.3-0.3c1.7,0,3,1.3,3,3c0,0.5-0.1,0.9-0.3,1.3l4,4c0.4-0.2,0.8-0.3,1.3-0.3c1.7,0,3,1.3,3,3s-1.3,3-3,3c-1.7,0-3-1.3-3-3c0-0.5,0.1-0.9,0.3-1.3l-4-4c-0.1,0-0.2,0.1-0.3,0.1v10.4c1.2,0.4,2,1.5,2,2.8c0,1.7-1.3,3-3,3s-3-1.3-3-3c0-1.3,0.8-2.4,2-2.8V18.8c-1.2-0.4-2-1.5-2-2.8c0-0.5,0.1-0.9,0.3-1.3l-4.1-4.1L5.8,22.1C5.3,22.6,5,23.3,5,24c0,0.7,0.3,1.4,0.8,1.9l16.3,16.3c0,0,0,0,0,0c0.5,0.5,1.2,0.8,1.9,0.8s1.4-0.3,1.9-0.8l16.3-16.3c0.5-0.5,0.8-1.2,0.8-1.9C43,23.3,42.7,22.6,42.2,22.1z"
              />
            </svg>
            <svg v-else class="tnode__source-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M8.2 11.8a3.4 3.4 0 0 0 5.1.4l2-2a3.4 3.4 0 1 0-4.8-4.8L9.3 6.6m2.5 1.6a3.4 3.4 0 0 0-5.1-.4l-2 2a3.4 3.4 0 1 0 4.8 4.8l1.2-1.2"
                stroke="#596168"
                stroke-width="1.4"
                stroke-linecap="round"
              />
            </svg>
            <div class="tnode__source-main">
              <span class="tnode__repo">{{ layout.row.source.kind === 'git' ? `/${layout.row.source.repo}` : layout.row.source.repo }}</span>
              <span v-if="layout.row.source.branch" class="tnode__branch">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M4.25 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0v3.25m0-3.25h5.5a2 2 0 0 0 2-2V6.25m0 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"
                    stroke="#596168"
                    stroke-width="1.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span>{{ layout.row.source.branch }}</span>
                <svg class="tnode__info" width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="5.6" stroke="#b1b7bc" stroke-width="1.2" />
                  <path d="M8 7.4v3.2M8 5.1v.9" stroke="#b1b7bc" stroke-width="1.2" stroke-linecap="round" />
                </svg>
              </span>
            </div>
          </div>

          <!-- CI 节点 -->
          <div
            v-if="layout.ci"
            class="tnode"
            :class="{ 'tnode--clickable': editable || layout.ci.status?.details }"
            :style="{
              left: `${layout.ci.x}px`,
              top: `${layout.ci.y}px`,
              width: `${layout.ci.w}px`,
              height: `${layout.ci.h}px`,
            }"
            @click="editable ? emit('edit', layout.ci.id) : layout.ci.status?.details && emit('details', 'ci', layout.ci.id)"
          >
            <div class="tnode__trigger" :title="triggerHintOf(layout.row, layout.ci.trigger)">
              <span>{{ triggerText(layout.ci.trigger) }}</span>
            </div>
            <div class="tnode__title">
              <div class="tnode__title-text">
                <span class="tnode__kicker">构建</span>
                <div class="tnode__name" :title="layout.ci.name">{{ layout.ci.name }}</div>
              </div>
              <PipelineBuildIcon class="tnode__icon" />
            </div>
            <div v-if="layout.ci.status" class="tnode__status" :style="{ color: statusColor(layout.ci.status) }">
              <span>{{ layout.ci.status.label }}</span>
              <template v-if="layout.ci.status.details">
                <span class="tnode__slash">/</span>
                <a class="tnode__details" href="javascript:void(0)" @click.stop="emit('details', 'ci', layout.ci.id)">
                  详情
                </a>
              </template>
            </div>
            <div v-if="!editable" class="tnode__actions">
              <button class="tnode__btn" type="button" @click.stop="emit('material', layout.ci.id)">
                选择提交
              </button>
            </div>
            <div v-if="editable" class="tnode__ops">
              <button class="tnode__op" type="button" title="添加部署流水线" @click.stop="emit('add', layout.ci.id)">
                +
              </button>
              <button class="tnode__op" type="button" title="删除流水线" @click.stop="emit('remove', layout.ci.id)">
                <t-icon name="delete" size="14px" />
              </button>
            </div>
          </div>

          <!-- CD 节点 -->
          <StageWorkflowNode v-for="node in layout.stages" :key="node.id" :pipeline-id="node.pipelineId" :stage="node.stage" :trigger="node.trigger" :status="node.status" :x="node.x" :y="node.y" @image="(id,stage)=>emit('stageImage',id,stage)" @details="(id,stage)=>emit('stageDetails',id,stage)" />
          <div
            v-for="cd in layout.cds"
            :key="cd.id"
            class="tnode"
            :class="{ 'tnode--clickable': editable || cd.status?.details }"
            :style="{ left: `${cd.x}px`, top: `${cd.y}px`, width: `${cd.w}px`, height: `${cd.h}px` }"
            @click="editable ? emit('edit', cd.id) : cd.status?.details && emit('details', 'cd', cd.id)"
          >
            <div class="tnode__trigger" :title="triggerHintOf(layout.row, cd.trigger)">
              <span>{{ triggerText(cd.trigger) }}</span>
            </div>
            <div class="tnode__title">
              <div class="tnode__title-text">
                <span class="tnode__kicker">部署：{{ strategyText(cd.strategy) }}</span>
                <div class="tnode__name" :title="cd.environment">{{ cd.environment }}</div>
              </div>
              <PipelineCdIcon class="tnode__icon" />
            </div>
            <div v-if="cd.status" class="tnode__status tnode__status--cd" :style="{ color: statusColor(cd.status) }">
              <svg v-if="cd.status.tone === 'success'" class="tnode__status-icon" width="20" height="20" viewBox="0 0 24 24">
                <g fill="none" fill-rule="evenodd" transform="translate(2 2)">
                  <rect width="20" height="20" fill="#1DAD70" rx="10" />
                  <path stroke="#FFF" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 7L6 11 14 11" transform="rotate(-45 10 9)" />
                </g>
              </svg>
              <svg v-else-if="cd.status.tone === 'danger'" class="tnode__status-icon" width="20" height="20" viewBox="0 0 24 24">
                <path fill="#F33E3E" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                <path fill="#FFF" d="M12 13c.552 0 1-.448 1-1V8c0-.552-.448-1-1-1s-1 .448-1 1v4c0 .552.448 1 1 1zm0 4c.552 0 1-.448 1-1s-.448-1-1-1-1 .448-1 1 .448 1 1 1z" />
              </svg>
              <svg
                v-else-if="cd.status.tone === 'warning' || cd.status.tone === 'info'"
                class="tnode__status-icon tnode__status-icon--spin"
                width="20"
                height="20"
                viewBox="0 0 24 24"
              >
                <path fill="none" stroke="#FF8300" stroke-linecap="round" stroke-width="3" d="M12 4a8 8 0 1 1-8 8" />
              </svg>
              <svg v-else class="tnode__status-icon" width="20" height="20" viewBox="0 0 24 24">
                <rect width="20" height="20" x="2" y="2" fill="none" stroke="#767d84" rx="10" />
              </svg>
              <span>{{ cd.status.label }}</span>
              <template v-if="cd.status.details">
                <span class="tnode__slash">/</span>
                <a class="tnode__details" href="javascript:void(0)" @click.stop="emit('details', 'cd', cd.id)">详情</a>
              </template>
            </div>
            <div v-if="!editable" class="tnode__actions">
              <button
                class="tnode__rollback"
                type="button"
                title="回滚"
                :disabled="!cd.status?.details"
                @click.stop="emit('rollback', cd.id)"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M15.09 11.56 13.57 16.27l4.71 1.53" stroke="#596168" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M14.93 3a7.5 7.5 0 0 1 1.33 14.23l-3.01 1.26" stroke="#596168" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  <rect x="4" y="4.03" width="6.23" height="3.46" fill="#596168" stroke="#596168" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  <rect x="4" y="10.26" width="6.23" height="3.46" fill="#596168" stroke="#596168" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  <rect x="4" y="16.49" width="6.23" height="3.46" fill="#596168" stroke="#596168" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <button class="tnode__btn tnode__btn--cd" type="button" @click.stop="emit('image', cd.id)">
                选择镜像
              </button>
            </div>
            <div v-if="editable" class="tnode__ops">
              <button class="tnode__op" type="button" title="添加部署流水线" @click.stop="emit('add', layout.ci?.id ?? cd.id)">
                +
              </button>
              <button class="tnode__op" type="button" title="删除流水线" @click.stop="emit('remove', cd.id)">
                <t-icon name="delete" size="14px" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wfs {
  display: flex;
  flex-direction: column;
}
.wf {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
.wf:last-child {
  margin-bottom: 0;
}
.wf__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 20px;
}
.wf__name {
  color: #000a14;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}
.wf__meta {
  color: #767d84;
  font-size: 11px;
  line-height: 18px;
}
.wf__well {
  overflow: auto;
  background: #f7fafc;
  border: 1px solid #edf1f5;
  border-radius: 4px;
}
.wf__canvas {
  position: relative;
  width: 1280px;
}
.wf__edges {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}

/* ---- 节点 ---- */
.tnode {
  position: absolute;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 0 0 0 16px;
  background: #fff;
  border: 1px solid #d0d4d9;
  border-radius: 8px;
}
.tnode--clickable {
  cursor: pointer;
}
.tnode--clickable:hover {
  border-color: #b1b7bc;
}
.tnode--static {
  flex-direction: row;
  align-items: center;
  padding: 0 0 0 12px;
}
.tnode__source-icon {
  flex: none;
  margin-right: 12px;
}
.tnode__source-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin-right: 16px;
}
.tnode__repo {
  overflow: hidden;
  color: #000a14;
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tnode__branch {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #000a14;
  font-size: 12px;
  font-weight: 500;
  line-height: 20px;
}
.tnode__branch svg {
  flex: none;
}
.tnode__info {
  color: #b1b7bc;
}
.tnode__trigger {
  position: absolute;
  top: -1px;
  left: -1px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: calc(100% + 2px);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  background: #a5a7bf;
  border-radius: 8px 0 0 8px;
}
.tnode__trigger > span {
  display: block;
  line-height: 16.67px;
  white-space: nowrap;
  writing-mode: vertical-rl;
}
.tnode__title {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 12px 16px 0 12px;
}
.tnode__title-text {
  flex: 1;
  min-width: 0;
}
.tnode__kicker {
  display: block;
  color: #3b444c;
  font-size: 10px;
  font-weight: 400;
  line-height: 14px;
  text-transform: capitalize;
}
.tnode__name {
  overflow: hidden;
  color: #000a14;
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tnode__icon {
  flex: none;
}
.tnode__status {
  display: flex;
  align-items: center;
  min-height: 20px;
  margin: 6px 12px 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  text-transform: capitalize;
}
.tnode__status--cd {
  margin-bottom: 10px;
}
.tnode__status-icon {
  flex: none;
  margin-right: 4px;
}
.tnode__status-icon--spin {
  animation: tnode-spin 0.9s linear infinite;
}
@keyframes tnode-spin {
  to {
    transform: rotate(360deg);
  }
}
.tnode__slash {
  margin: 0 5px;
}
.tnode__details {
  color: #0066cc;
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  text-transform: capitalize;
}
.tnode__details:hover {
  text-decoration: underline;
}
.tnode__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 12px 12px;
}
.tnode__btn {
  box-sizing: border-box;
  width: 158px;
  height: 30px;
  padding: 1px 6px;
  color: #3b444c;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  background: #fff;
  border: 1px solid #d0d4d9;
  border-radius: 4px;
  cursor: pointer;
}
.tnode__btn--cd {
  width: 110px;
}
.tnode__btn:hover {
  background: #f7fafc;
  border-color: #b1b7bc;
}
.tnode__rollback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 30px;
  margin-right: 8px;
  padding: 1px 6px;
  background: #fff;
  border: 1px solid #d0d4d9;
  border-radius: 4px;
  cursor: pointer;
}
.tnode__rollback:hover:not(:disabled) {
  background: #f7fafc;
  border-color: #b1b7bc;
}
.tnode__rollback:disabled {
  cursor: default;
  opacity: 0.55;
}
.tnode__ops {
  position: absolute;
  top: 50%;
  right: -30px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transform: translateY(-50%);
}
.tnode__op {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: #3b444c;
  font-size: 14px;
  line-height: 1;
  background: #fff;
  border: 1px solid #d0d4d9;
  border-radius: 3px;
  cursor: pointer;
}
.tnode__op:hover {
  background: #f7fafc;
  border-color: #b1b7bc;
}
</style>
