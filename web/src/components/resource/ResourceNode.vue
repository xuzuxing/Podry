<script setup lang="ts">
import { computed, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'

import type { K8sResource } from '@/types'
import type { ResourceTabKey } from '@/stores/resourceTabs'
import { EVENT_KINDS, type TreeNode } from './hierarchy'

defineOptions({ name: 'ResourceNode' })

const props = defineProps<{ node: TreeNode; level: number }>()

const emit = defineEmits<{
  open: [resource: K8sResource, tab: ResourceTabKey]
  container: [pod: K8sResource, container: string]
  menu: [resource: K8sResource, action: 'vulnerabilities' | 'delete']
}>()

const expanded = ref(true)
const hasChildren = computed(() => props.node.children.length > 0 || props.node.containers.length > 0)

/** 子节点按 Kind 分组渲染（REPLICASET / POD 这样的分组标题） */
const childGroups = computed(() => {
  const groups = new Map<string, TreeNode[]>()
  for (const child of props.node.children) {
    const list = groups.get(child.kind) ?? []
    list.push(child)
    groups.set(child.kind, list)
  }
  return [...groups.entries()].map(([kind, nodes]) => ({ kind: kind.toUpperCase(), nodes }))
})

const isPod = computed(() => props.node.kind === 'Pod')
const showEvents = computed(() => EVENT_KINDS.includes(props.node.kind))
const indent = computed(() => `${props.level * 20}px`)

async function copyName(): Promise<void> {
  if (!navigator.clipboard) return
  try {
    await navigator.clipboard.writeText(props.node.name)
    MessagePlugin.success('已复制名称')
  } catch {
    MessagePlugin.error('复制失败')
  }
}

async function copyUrl(): Promise<void> {
  if (!props.node.url || !navigator.clipboard) return
  try {
    await navigator.clipboard.writeText(props.node.url)
    MessagePlugin.success('已复制访问地址')
  } catch {
    MessagePlugin.error('复制失败')
  }
}

function open(tab: ResourceTabKey): void {
  emit('open', props.node.resource, tab)
}
</script>

<template>
  <div class="rnode">
    <div class="rnode__row" :style="{ paddingLeft: indent }">
      <button
        v-if="hasChildren"
        type="button"
        class="rnode__caret"
        :class="{ 'rnode__caret--collapsed': !expanded }"
        @click="expanded = !expanded"
      >
        <t-icon name="caret-down" size="12px" />
      </button>
      <span v-else class="rnode__caret rnode__caret--empty" />

      <span class="rnode__main">
        <span class="rnode__name-line">
          <span class="rnode__name">{{ node.name }}</span>
          <button type="button" class="rnode__icon" title="复制名称" @click="copyName">
            <t-icon name="copy" size="13px" />
          </button>
          <button type="button" class="rnode__action" @click="open('manifest')">Manifest</button>
          <button v-if="showEvents && !isPod" type="button" class="rnode__action" @click="open('events')">Events</button>
          <template v-if="isPod">
            <button type="button" class="rnode__action" @click="open('logs')">Logs</button>
            <button type="button" class="rnode__action" @click="open('terminal')">Terminal</button>
            <button type="button" class="rnode__action" @click="open('events')">Events</button>
            <t-dropdown
              trigger="click"
              placement="bottom-right"
              :options="[
                { content: 'Check vulnerabilities', value: 'vulnerabilities' },
                { content: '删除 Pod', value: 'delete', theme: 'error' },
              ]"
              @click="(data: { value?: string }) => emit('menu', node.resource, data.value as 'vulnerabilities' | 'delete')"
            >
              <button type="button" class="rnode__more" title="更多操作">⋮</button>
            </t-dropdown>
          </template>
        </span>
        <span class="rnode__status" :class="node.healthy ? 'rnode__status--ok' : 'rnode__status--bad'">
          {{ node.status }}
        </span>
      </span>
      <span v-if="node.url" class="rnode__url">
        <span class="u-mono">{{ node.url }}</span>
        <button type="button" class="rnode__icon" title="复制地址" @click="copyUrl">
          <t-icon name="copy" size="13px" />
        </button>
      </span>
    </div>

    <template v-if="expanded">
      <div v-for="group in childGroups" :key="group.kind" class="rnode__group">
        <p class="rnode__group-title" :style="{ paddingLeft: `calc(${indent} + 20px)` }">{{ group.kind }}</p>
        <ResourceNode
          v-for="child in group.nodes"
          :key="child.key"
          :node="child"
          :level="level + 1"
          @open="(resource: K8sResource, tab: ResourceTabKey) => emit('open', resource, tab)"
          @container="(pod: K8sResource, container: string) => emit('container', pod, container)"
          @menu="(resource: K8sResource, action: 'vulnerabilities' | 'delete') => emit('menu', resource, action)"
        />
      </div>

      <div v-if="node.containers.length" class="rnode__group">
        <p class="rnode__group-title" :style="{ paddingLeft: `calc(${indent} + 20px)` }">CONTAINERS</p>
        <div
          v-for="container in node.containers"
          :key="container"
          class="rnode__row rnode__row--container"
          :style="{ paddingLeft: `calc(${indent} + 20px)` }"
        >
          <span class="rnode__caret rnode__caret--empty" />
          <span class="rnode__name">{{ container }}</span>
          <button type="button" class="rnode__action" @click="emit('container', node.resource, container)">
            Logs
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rnode {
  display: flex;
  flex-direction: column;
}
.rnode__row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 12px 6px 0;
  border-bottom: 1px solid var(--tk-border);
}
.rnode__row--container {
  border-bottom: 0;
}
.rnode__caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  padding: 0;
  color: var(--tk-text-2);
  background: none;
  border: 0;
  cursor: pointer;
}
.rnode__caret--collapsed {
  transform: rotate(-90deg);
}
.rnode__caret--empty {
  cursor: default;
}
.rnode__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.rnode__name-line {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.rnode__name {
  color: var(--tk-text);
}
.rnode__icon {
  padding: 0;
  color: var(--tk-text-3);
  background: none;
  border: 0;
  cursor: pointer;
  line-height: 0;
}
.rnode__action {
  padding: 0 6px;
  color: var(--tk-text-2);
  font-size: 11px;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: 3px;
  cursor: pointer;
}
.rnode__action:hover {
  color: var(--tk-primary);
  border-color: #b9d0f5;
}
.rnode__more {
  padding: 0 4px;
  color: var(--tk-text-3);
  font-size: 13px;
  line-height: 1;
  background: none;
  border: 0;
  cursor: pointer;
}
.rnode__status {
  font-size: 11px;
  text-transform: uppercase;
}
.rnode__status--ok {
  color: var(--tk-success);
}
.rnode__status--bad {
  color: var(--tk-danger);
}
.rnode__url {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  color: var(--tk-text-2);
  font-size: 12px;
}
.rnode__group {
  display: flex;
  flex-direction: column;
}
.rnode__group-title {
  margin: 8px 0 2px;
  color: var(--tk-text-3);
  font-size: 10px;
  letter-spacing: 0.4px;
}
</style>
