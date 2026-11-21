<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
</script>

<template>
  <div class="not-found">
    <EmptyState title="页面不存在" description="检查地址或回到项目列表重新进入。" icon="error-circle">
      <template #action>
        <t-button theme="primary" variant="outline" @click="$router.push('/')">回到项目列表</t-button>
      </template>
    </EmptyState>
  </div>
</template>

<style scoped>
.not-found {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}
</style>
