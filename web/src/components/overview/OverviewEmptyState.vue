<script setup lang="ts">
withDefaults(defineProps<{ title: string; description?: string; icon?: string }>(), { description: '', icon: 'chart-bar' })
</script>

<template>
  <div class="overview-empty" role="status"><t-icon :name="icon" size="28px" /><strong>{{ title }}</strong><p v-if="description">{{ description }}</p><slot /></div>
</template>

<style scoped>
.overview-empty{display:flex;min-height:200px;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:28px;text-align:center;color:var(--tk-text-3)}
.overview-empty strong{font-size:14px;font-weight:600;color:var(--tk-text)}.overview-empty p{max-width:520px;margin:0;font-size:13px;line-height:20px}
</style>
