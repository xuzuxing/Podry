<script setup lang="ts">
withDefaults(defineProps<{ keyword: string; placeholder?: string }>(), { placeholder: '按名称搜索' })
const emit = defineEmits<{ 'update:keyword': [value: string] }>()
</script>

<template>
  <div class="filter-bar">
    <t-input
      :value="keyword"
      :placeholder="placeholder"
      clearable
      class="filter-bar__input"
      @change="(value: string) => emit('update:keyword', value)"
    >
      <template #prefix-icon>
        <t-icon name="search" />
      </template>
    </t-input>
    <slot name="extra" />
    <div class="u-right u-flex u-gap-8">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-bottom: none;
  border-radius: var(--tk-radius) var(--tk-radius) 0 0;
}
.filter-bar__input {
  width: 240px;
}
</style>
