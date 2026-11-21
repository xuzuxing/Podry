<script setup lang="ts">
import { computed } from 'vue'

import type { BuildStatus } from '@/types'

const props = withDefaults(defineProps<{ status: BuildStatus; size?: number }>(), { size: 14 })

const labels: Record<BuildStatus, string> = {
  queued: 'Queued',
  running: 'In progress',
  canceling: 'Canceling',
  succeeded: 'Succeeded',
  failed: 'Failed',
  canceled: 'Canceled',
  unknown: 'Unknown',
}

const label = computed(() => labels[props.status])
</script>

<template>
  <svg
    v-if="status === 'succeeded'"
    class="bsi"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    role="img"
    :aria-label="label"
  >
    <circle cx="8" cy="8" r="7" fill="#1dad70" />
    <path
      d="m4.7 8.2 2.15 2.15L11.4 5.8"
      fill="none"
      stroke="#fff"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>

  <svg
    v-else-if="status === 'failed'"
    class="bsi"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    role="img"
    :aria-label="label"
  >
    <circle cx="8" cy="8" r="7" fill="#f33e3e" />
    <path
      d="m5.7 5.7 4.6 4.6m0-4.6-4.6 4.6"
      fill="none"
      stroke="#fff"
      stroke-width="1.6"
      stroke-linecap="round"
    />
  </svg>

  <svg
    v-else-if="status === 'running' || status === 'queued' || status === 'canceling'"
    class="bsi bsi--spin"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    role="img"
    :aria-label="label"
  >
    <circle
      cx="8"
      cy="8"
      r="6.2"
      fill="none"
      stroke="#ff8300"
      stroke-width="2"
      stroke-linecap="round"
      stroke-dasharray="26 13"
    />
  </svg>

  <svg
    v-else
    class="bsi"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    role="img"
    :aria-label="label"
  >
    <circle cx="8" cy="8" r="7" fill="#9aa4b2" />
    <path d="M5.1 8h5.8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" />
  </svg>
</template>

<style scoped>
.bsi {
  display: block;
  flex: none;
}

.bsi--spin {
  animation: bsi-spin 0.9s linear infinite;
}

@keyframes bsi-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
