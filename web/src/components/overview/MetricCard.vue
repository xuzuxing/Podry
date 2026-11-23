<script setup lang="ts">
withDefaults(
  defineProps<{
    icon?: string
    title: string
    value: string | number
    hint?: string
    unit?: string
    tone?: string
    to?: { name: string } | null
  }>(),
  { icon: '', hint: '', unit: '', tone: 'blue', to: null },
)
</script>

<template>
  <component
    :is="to ? 'router-link' : 'div'"
    :to="to ?? undefined"
    class="ocode-card"
    :class="{ 'ocode-card--link': !!to }"
  >
    <span class="ocode-card__content">
      <t-tooltip :disabled="!hint" :content="hint" placement="top"><span class="ocode-card__title">{{ title }}</span></t-tooltip>
      <span class="ocode-card__number"><strong class="ocode-card__value">{{ value }}</strong><span v-if="unit" class="ocode-card__unit">{{ unit }}</span></span>
    </span>
    <span v-if="icon" class="ocode-card__art" :class="`ocode-card__art--${tone}`"><t-icon :name="icon" size="24px" /><t-icon v-if="to" name="jump" size="20px" class="ocode-card__arrow" /></span>
  </component>
</template>

<style scoped>
.ocode-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 90px;
  min-width: 0;
  padding: 16px;
  color: inherit;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: 8px;
}
.ocode-card--link:hover {
  border-color: #b9d0f5;
  box-shadow: 0 1px 4px rgba(0, 82, 217, 0.08);
}
.ocode-card__content {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.ocode-card__art{position:relative;display:flex;align-items:center;justify-content:center;width:40px;height:40px;flex:none;border-radius:10px;background:#edf5ff;color:#0066cc}
.ocode-card__art--green{background:#e9f7ef;color:#21925c}.ocode-card__art--purple{background:#f1edfc;color:#7953c5}.ocode-card__art--orange{background:#fff2e5;color:#d47b19}.ocode-card__art--teal{background:#e5f5f5;color:#168d8c}
.ocode-card__arrow{display:none;position:absolute;inset:10px}.ocode-card--link:hover .ocode-card__art>.t-icon:first-child{visibility:hidden}.ocode-card--link:hover .ocode-card__arrow{display:block}.ocode-card--link:focus-visible{outline:2px solid var(--tk-primary);outline-offset:3px}
.ocode-card__number{display:flex;align-items:baseline;gap:5px}.ocode-card__unit{font-size:16px;color:var(--tk-text)}
.ocode-card__title {
  min-width: 0;
  color: var(--tk-text);
  font-size: 13px;
  line-height:20px;
}
.ocode-card__value {
  color: #000a14;
  font-size: 24px;
  font-weight: 600;
  line-height: 36px;
  font-variant-numeric:tabular-nums;
}
</style>
