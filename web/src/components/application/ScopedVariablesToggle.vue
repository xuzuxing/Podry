<script setup lang="ts">
defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <t-tooltip :content="modelValue ? 'Hide variables value' : 'Show variables value'">
    <t-button class="scoped-variables-toggle" :class="{ 'is-active': modelValue }" variant="text" shape="square" size="small" :aria-label="modelValue ? 'Hide variables value' : 'Show variables value'" :aria-pressed="modelValue" @click="emit('update:modelValue', !modelValue)">
      <span aria-hidden="true">{x}</span>
    </t-button>
  </t-tooltip>
</template>

<style scoped>
.scoped-variables-toggle{flex:none;color:#596168}.scoped-variables-toggle.is-active{background:#eaf2fd;color:#0066cc}.scoped-variables-toggle span{font:600 13px var(--tk-mono)}
</style>
