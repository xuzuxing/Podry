<script setup lang="ts">
import type { Tone } from '@/utils/format'
import {
  auditResultMap,
  buildStatusMap,
  connectionMap,
  deployStatusMap,
  healthMap,
  logAvailabilityMap,
  roleMap,
  setupStatusMap,
} from '@/utils/format'
import type {
  BuildStatus,
  ConnectionStatus,
  DeployStatus,
  Health,
  LogAvailability,
  MemberRole,
  SetupStatus,
} from '@/types'

type Kind = 'health' | 'build' | 'deploy' | 'log' | 'connection' | 'setup' | 'role' | 'audit' | 'plain'

const props = withDefaults(
  defineProps<{
    kind?: Kind
    value: string
    text?: string
    dot?: boolean
  }>(),
  { kind: 'plain', text: '', dot: true },
)

function resolve(): { label: string; tone: Tone } {
  switch (props.kind) {
    case 'health':
      return healthMap[props.value as Health] ?? { label: props.value, tone: 'default' }
    case 'build':
      return buildStatusMap[props.value as BuildStatus] ?? { label: props.value, tone: 'default' }
    case 'deploy':
      return deployStatusMap[props.value as DeployStatus] ?? { label: props.value, tone: 'default' }
    case 'log':
      return logAvailabilityMap[props.value as LogAvailability] ?? { label: props.value, tone: 'default' }
    case 'connection':
      return connectionMap[props.value as ConnectionStatus] ?? { label: props.value, tone: 'default' }
    case 'setup':
      return setupStatusMap[props.value as SetupStatus] ?? { label: props.value, tone: 'default' }
    case 'role':
      return roleMap[props.value as MemberRole] ?? { label: props.value, tone: 'default' }
    case 'audit':
      return auditResultMap[props.value] ?? { label: props.value, tone: 'default' }
    default:
      return { label: props.text || props.value, tone: 'default' }
  }
}
</script>

<template>
  <span class="status" :class="`status--${resolve().tone}`">
    <i v-if="dot" class="status__dot" />
    {{ text || resolve().label }}
  </span>
</template>

<style scoped>
.status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 20px;
  border: 1px solid transparent;
  border-radius: 2px;
  white-space: nowrap;
}
.status__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
.status--success {
  color: #1f8f5f;
  background: #e8f8f0;
  border-color: #c4ecd9;
}
.status--warning {
  color: #b25c0f;
  background: #fff4e6;
  border-color: #ffd9ad;
}
.status--danger {
  color: #c33028;
  background: #fdeceb;
  border-color: #f8ccc9;
}
.status--primary {
  color: var(--tk-primary);
  background: var(--tk-primary-weak);
  border-color: #cddffb;
}
.status--default {
  color: var(--tk-text-2);
  background: #f2f4f8;
  border-color: var(--tk-border);
}
</style>
