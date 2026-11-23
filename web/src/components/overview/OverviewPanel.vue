<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <section class="overview-panel">
    <header class="overview-panel__header"><h3>{{ title }}</h3><div class="overview-panel__actions"><slot name="actions" /></div></header>
    <slot name="tabs" />
    <slot />
    <footer v-if="$slots.footer" class="overview-panel__footer"><slot name="footer" /></footer>
  </section>
</template>

<style scoped>
.overview-panel{min-width:0;overflow:hidden;border:1px solid var(--tk-border);border-radius:8px;background:#fff}
.overview-panel__header{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:49px;padding:10px 16px;border-bottom:1px solid var(--tk-border)}
.overview-panel__header h3{font-size:14px;line-height:21px;font-weight:600;color:#001b36}
.overview-panel__actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.overview-panel__footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;border-top:1px solid var(--tk-border);color:var(--tk-text-2);font-size:12px}
</style>
