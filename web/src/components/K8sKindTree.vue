<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import KindSearchPicker from './resource/KindSearchPicker.vue'
import type { KindSearchOption } from '@/utils/resourceFilters'

import type { ResourceType } from '@/types'
import { resourceTypeKey } from '@/utils/resourceListing'

interface KindNode {
  value: string
  label: string
  resource?: string
  group?: string
  searchText?: string
  count?: number
  children?: KindNode[]
}

const props = defineProps<{
  types: ResourceType[]
  active: string
  activeGroup?: string
  shortcutsDisabled?: boolean
  counts?: Record<string, number>
  /** 固定在最上方的非分类资源类型（Nodes / Events / Namespaces） */
  pinned?: Array<{ value: string; label: string; shortNames?: string[] }>
}>()
const emit = defineEmits<{ select: [resource: string, group: string] }>()

const CATEGORY_LABELS: Record<string, string> = {
  Workloads: '工作负载',
  Networking: '网络',
  'Config & Storage': '配置与存储',
  RBAC: 'RBAC',
  'Custom Resource': '自定义资源',
  Cluster: '集群',
  Other: '其他',
  Administration: '管理',
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
    value: resourceTypeKey({ group: '', resource: item.value }),
    label: item.label,
    resource: item.value,
    group: '',
    searchText: `${item.label} ${item.value} ${(item.shortNames ?? []).join(' ')}`.toLowerCase(),
  }))
  const order = ['Workloads', 'Config & Storage', 'Networking', 'RBAC', 'Administration', 'Other', 'Custom Resource']
  const rank = (category: string) => order.includes(category) ? order.indexOf(category) : order.length
  const categoryNodes: KindNode[] = [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([category, items]) => {
    const kinds = new Map<string, ResourceType[]>()
    for (const type of items) kinds.set(type.kind, [...(kinds.get(type.kind) ?? []), type])
    return {
      value: `category:${category}`, label: labelOf(category),
      children: [...kinds.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([kind, types]) => {
        const leaves = types.sort((a, b) => a.group.localeCompare(b.group)).map(type => ({
          value: resourceTypeKey(type), label: types.length > 1 ? type.group || type.kind : type.kind,
          resource: type.resource, group: type.group,
          searchText: `${type.kind} ${type.resource} ${type.group || 'core'} ${(type.shortNames ?? []).join(' ')}`.toLowerCase(),
          count: props.counts?.[resourceTypeKey(type)],
        }))
        return leaves.length === 1 ? leaves[0]! : { value: `kind:${category}:${kind}`, label: kind, children: leaves }
      }),
    }
  })
  return [...pinnedNodes, ...categoryNodes]
})

const keys = { value: 'value', label: 'label', children: 'children' }
const activeKey = computed(() => resourceTypeKey({ resource: props.active, group: props.activeGroup ?? props.types.find(type => type.resource === props.active)?.group ?? '' }))
const actived = computed(() => (props.active ? [activeKey.value] : []))

/** Jump to Kind uses a separate result popup; the resource tree remains visible. */
const searchOptions = computed<KindSearchOption[]>(() => [
  ...(props.pinned ?? []).map(item => ({ key: resourceTypeKey({group: '', resource: item.value}), label: item.label, description: '', resource: item.value, group: '', shortNames: item.shortNames })),
  ...props.types.map(type => ({ key: resourceTypeKey(type), label: type.kind, description: props.types.some(other => other.kind === type.kind && other.group !== type.group) ? type.group || 'core' : '', resource: type.resource, group: type.group, shortNames: type.shortNames })),
])
const expanded = ref<Array<string | number>>(['category:Workloads'])
watch([activeKey, treeData], ([active]) => {
  function expandAncestors(nodes: KindNode[]): boolean {
    return nodes.some(node => {
      if (node.value === active) return true
      if (node.children && expandAncestors(node.children)) {
        if (!expanded.value.includes(node.value)) expanded.value.push(node.value)
        return true
      }
      return false
    })
  }
  expandAncestors(treeData.value)
}, { immediate: true })
function handleActive(_value: unknown, context: unknown): void {
  const node = (context as { node?: { data?: KindNode } }).node?.data
  if (!node?.resource) return
  emit('select', node.resource, node.group ?? '')
}
</script>

<template>
  <aside class="kind-tree tk-panel">
    <div class="kind-tree__search"><KindSearchPicker :options="searchOptions" :shortcuts-disabled="shortcutsDisabled" @select="(resource, group) => emit('select', resource, group)" /></div>

    <t-tree
      :data="treeData"
      :keys="keys"
      :actived="actived"
      :expanded="expanded"
      :hover="true"
      :transition="false"
      line
      activable
      empty="没有可访问的资源类型"
      @active="handleActive"
      @expand="expanded = $event"
    >
      <template #label="{ node }">
        <span class="kind-node">
          <strong v-if="(node.data as KindNode).children" class="kind-node__label kind-node__label--group">
            {{ (node.data as KindNode).label }}
          </strong>
          <span v-else class="kind-node__label" :title="(node.data as KindNode).group || 'core'" :data-kind-key="(node.data as KindNode).value">{{ (node.data as KindNode).label }}</span>
          <span v-if="(node.data as KindNode).count !== undefined" class="kind-node__count">{{ (node.data as KindNode).count }}</span>
        </span>
      </template>
    </t-tree>
  </aside>
</template>

<style scoped>
.kind-tree {
  width: 250px;
  flex: none;
  padding: 6px 4px;
  overflow: auto;
  border: 0;
  border-right: 1px solid var(--tk-border);
  border-radius: 0;
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
  color: var(--tk-text);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: none;
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
  height: 32px;
  font-size: 13px;
  line-height: 32px;
}
:deep(.t-tree__item .t-tree__label) {
  height: 32px;
  line-height: 32px;
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
