<script setup lang="ts">
/**
 * Base / Environment Override 的 ConfigMaps 与 Secrets。
 * 对齐 Devtron：同一页面结构，空态插画 + Create 按钮；有数据时是名称/键/更新时间的列表。
 * Secret 只保存 key，不保存值，也不回显明文。
 */
import ConfigEntryWorkspace from '@/components/application/ConfigEntryWorkspace.vue'
defineProps<{ kind: 'configmaps' | 'secrets' }>()
</script>

<template><ConfigEntryWorkspace :kind="kind" /></template>
