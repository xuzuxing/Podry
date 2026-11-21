<script setup lang="ts">
withDefaults(defineProps<{ message?: string; code?: string }>(), { message: '加载失败', code: '' })
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="err">
    <t-icon name="error-circle" size="20px" class="err__icon" />
    <p class="err__message">{{ message }}</p>
    <p v-if="code" class="err__code u-mono">{{ code }}</p>
    <t-button size="small" variant="outline" @click="emit('retry')">重试</t-button>
  </div>
</template>

<style scoped>
.err {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 32px 16px;
  text-align: center;
}
.err__icon {
  color: var(--tk-danger);
}
.err__message {
  margin: 0;
  font-weight: 600;
}
.err__code {
  margin: 0 0 4px;
  color: var(--tk-text-3);
}
</style>
