<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/common/AppHeader.vue'
import ToastHost from '@/components/common/ToastHost.vue'

const { t } = useI18n()
</script>

<template>
  <a class="skip-link" href="#main">{{ t('app.skipToContent') }}</a>
  <AppHeader />
  <main id="main" class="app-main">
    <RouterView />
  </main>
  <ToastHost />
</template>

<style scoped>
.app-main {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
