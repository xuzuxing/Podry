<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
    description?: string
    icon?: string
    compact?: boolean
  }>(),
  { title: '暂无数据', description: '', icon: 'file', compact: false },
)
</script>

<template>
  <div class="empty" :class="{ 'empty--compact': compact }">
    <t-icon :name="icon" size="22px" class="empty__icon" />
    <p class="empty__title">{{ title }}</p>
    <p v-if="description" class="empty__desc">{{ description }}</p>
    <div v-if="$slots.action" class="empty__action">
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 48px 16px;
  text-align: center;
}
.empty--compact {
  padding: 24px 12px;
}
.empty__icon {
  color: var(--tk-text-3);
}
.empty__title {
  margin: 4px 0 0;
  font-weight: 600;
}
.empty__desc {
  margin: 0;
  max-width: 420px;
  color: var(--tk-text-2);
}
.empty__action {
  margin-top: 8px;
}
</style>
