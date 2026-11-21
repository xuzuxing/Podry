<script setup lang="ts">
import { computed, ref } from 'vue'

import type { ResourceType } from '@/types'

interface KindNode {
  value: string
  label: string
  resource?: string
  count?: number
  children?: KindNode[]
}

const props = defineProps<{
  types: ResourceType[]
  active: string
  counts?: Record<string, number>
  /** 固定在最上方的非分类资源类型（Nodes / Events / Namespaces） */
  pinned?: Array<{ value: string; label: string }>
}>()
const emit = defineEmits<{ select: [resource: string] }>()

const CATEGORY_LABELS: Record<string, string> = {
  Workloads: '工作负载',
  Networking: '网络',
  'Config & Storage': '配置与存储',
  RBAC: 'RBAC',
  'Custom Resource': '自定义资源',
  Cluster: '集群',
  Other: '其他',
  其他: '其他',
}

const labelOf = (category: string): string => CATEGORY_LABELS[category] ?? category

/** 按 discovery 的 category 分组；叶子节点是资源类型 */
const treeData = computed<KindNode[]>(() => {
  const groups = new Map<string, ResourceType[]>()
  for (const type of props.types) {
    const key = type.category || '其他'
    const list = groups.get(key) ?? []
    list.push(type)
    groups.set(key, list)
  }
  const pinnedNodes: KindNode[] = (props.pinned ?? []).map((item) => ({
    value: item.value,
    label: item.label,
    resource: item.value,
  }))
  const categoryNodes: KindNode[] = [...groups.entries()].map(([category, items]) => ({
    value: `category:${category}`,
    label: labelOf(category),
    children: items.map((type) => ({
      value: type.resource,
      label: type.kind,
      resource: type.resource,
      count: props.counts?.[type.resource],
    })),
  }))
  return [...pinnedNodes, ...categoryNodes]
})

const keys = { value: 'value', label: 'label', children: 'children' }
const actived = computed(() => (props.active ? [props.active] : []))

/** Jump to Kind：按 Kind 名称过滤树，命中时自动展开所属分组 */
const keyword = ref('')
const filteredTree = computed<KindNode[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return treeData.value
  const groups: KindNode[] = []
  for (const group of treeData.value) {
    if (!group.children) {
      if (group.label.toLowerCase().includes(kw)) groups.push(group)
      continue
    }
    const hits = group.children.filter(
      (child) => child.label.toLowerCase().includes(kw) || child.value.toLowerCase().includes(kw),
    )
    if (hits.length) groups.push({ ...group, children: hits })
  }
  return groups
})

function handleActive(_value: unknown, context: unknown): void {
  const node = (context as { node?: { data?: KindNode } }).node?.data
  if (!node?.resource) return
  emit('select', node.resource)
}
</script>

<template>
  <aside class="kind-tree tk-panel">
    <div class="kind-tree__search">
      <t-input v-model="keyword" size="small" clearable placeholder="Jump to Kind">
        <template #prefix-icon><t-icon name="search" /></template>
        <template #suffix><span class="kind-tree__kbd">K</span></template>
      </t-input>
    </div>

    <t-tree
      :data="filteredTree"
      :keys="keys"
      :actived="actived"
      :expand-all="true"
      :hover="true"
      :transition="false"
      line
      activable
      empty="没有可访问的资源类型"
      @active="handleActive"
    >
      <template #label="{ node }">
        <span class="kind-node">
          <strong v-if="(node.data as KindNode).children" class="kind-node__label kind-node__label--group">
            {{ (node.data as KindNode).label }}
          </strong>
          <span v-else class="kind-node__label">{{ (node.data as KindNode).label }}</span>
          <span v-if="(node.data as KindNode).count" class="kind-node__count">{{ (node.data as KindNode).count }}</span>
        </span>
      </template>
    </t-tree>
  </aside>
</template>

<style scoped>
.kind-tree {
  width: 224px;
  flex: none;
  padding: 6px 4px;
  overflow: auto;
}
.kind-tree__search {
  padding: 2px 6px 8px;
}
.kind-tree__kbd {
  padding: 0 4px;
  color: var(--tk-text-3);
  font-size: 10px;
  border: 1px solid var(--tk-border);
  border-radius: 2px;
}
.kind-node {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.kind-node__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.kind-node__label--group {
  color: var(--tk-text-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.kind-node__count {
  padding: 0 4px;
  color: var(--tk-text-3);
  font-size: 11px;
  background: #f2f4f8;
  border-radius: 2px;
}
:deep(.t-tree) {
  /* 收紧层级缩进：默认 40px 太宽，224px 侧栏放不下 */
  --td-comp-margin-xxl: 20px;
}
:deep(.t-tree__item) {
  height: 26px;
  font-size: 12px;
  line-height: 26px;
}
:deep(.t-tree__item .t-tree__label) {
  height: 26px;
  line-height: 26px;
  padding: 0 6px;
  border-radius: 2px;
}
:deep(.t-tree__item .t-icon) {
  font-size: 14px;
}
:deep(.t-tree__item .t-is-active) {
  color: var(--tk-primary);
  font-weight: 600;
}
:deep(.t-tree__label) {
  width: 100%;
}
</style>
