<script setup lang="ts">
import { computed } from 'vue'

import type { K8sResource } from '@/types'
import type { ResourceTabKey } from '@/stores/resourceTabs'
import { HEALTHY_STATUSES, parseContainers, serviceUrl, type TreeNode } from './hierarchy'
import ResourceNode from './ResourceNode.vue'

const props = defineProps<{
  resources: K8sResource[]
  /** 当前选中的资源类型，如 deployments / pods */
  kind: string
  group?: string
}>()

const emit = defineEmits<{
  open: [resource: K8sResource, tab: ResourceTabKey]
  container: [pod: K8sResource, container: string]
  menu: [resource: K8sResource, action: 'vulnerabilities' | 'delete']
}>()

function buildNode(resource: K8sResource, visited: Set<string>): TreeNode {
  const ownerKey = `${resource.kind}/${resource.ref.name}`
  const children = props.resources
    .filter((item) => item.ownerRefs.includes(ownerKey) && !visited.has(item.ref.uid))
    .map((item) => {
      visited.add(item.ref.uid)
      return buildNode(item, visited)
    })
  return {
    key: resource.ref.uid,
    kind: resource.kind,
    name: resource.ref.name,
    status: resource.status,
    healthy: HEALTHY_STATUSES.includes(resource.status),
    resource,
    children,
    containers: resource.kind === 'Pod' ? parseContainers(resource) : [],
    url: serviceUrl(resource),
  }
}

const roots = computed<TreeNode[]>(() => {
  const visited = new Set<string>()
  const ofKind = props.resources.filter((item) => item.ref.resource === props.kind && (props.group === undefined || item.ref.group === props.group))
  const source = props.kind ? ofKind : props.resources.filter((item) => item.ownerRefs.length === 0)
  return source.map((item) => {
    visited.add(item.ref.uid)
    return buildNode(item, visited)
  })
})
</script>

<template>
  <div class="hier">
    <ResourceNode
      v-for="node in roots"
      :key="node.key"
      :node="node"
      :level="0"
      @open="(resource: K8sResource, tab: ResourceTabKey) => emit('open', resource, tab)"
      @container="(pod: K8sResource, container: string) => emit('container', pod, container)"
      @menu="(resource: K8sResource, action: 'vulnerabilities' | 'delete') => emit('menu', resource, action)"
    />
  </div>
</template>

<style scoped>
.hier {
  display: flex;
  flex-direction: column;
}
</style>
