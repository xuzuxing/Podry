<script setup lang="ts">
defineProps<{ visible: boolean; platforms: string[]; loading: boolean }>()
const emit = defineEmits<{ cancel: []; confirm: [] }>()
</script>

<template>
  <t-dialog :visible="visible" header="请确认构建目标平台有效" theme="warning" width="480px" :close-on-overlay-click="false" :close-on-esc-keydown="!loading" :close-btn="!loading" :confirm-btn="{ content: '确认保存', loading }" :cancel-btn="{ content: '返回修改', disabled: loading }" @confirm="emit('confirm')" @close="emit('cancel')" @cancel="emit('cancel')">
    <p>自定义目标平台：</p><ul class="build-platform-confirmation"><li v-for="platform in platforms" :key="platform">{{ platform }}</li></ul><p>无效或不受支持的目标平台会导致构建失败。</p>
  </t-dialog>
</template>

<style scoped>
.build-platform-confirmation{margin:12px 0;padding-left:20px;font:13px/24px Consolas,monospace;overflow-wrap:anywhere}
</style>
