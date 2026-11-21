<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    description?: string
    back?: string
  }>(),
  { description: '', back: '' },
)
</script>

<template>
  <header class="page-header">
    <div class="page-header__main">
      <router-link v-if="back" :to="back" class="page-header__back">
        <t-icon name="chevron-left" /> 返回
      </router-link>
      <h1 class="page-header__title">{{ title }}</h1>
      <p v-if="description" class="page-header__desc">{{ description }}</p>
      <slot name="meta" />
    </div>
    <div class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.page-header__title {
  font-size: 16px;
  line-height: 24px;
}
.page-header__desc {
  margin: 2px 0 0;
  color: var(--tk-text-2);
}
.page-header__back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 4px;
  color: var(--tk-text-2);
}
.page-header__back:hover {
  color: var(--tk-primary);
}
.page-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
