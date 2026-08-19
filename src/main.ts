import { createApp } from 'vue'
import { createPinia } from 'pinia'

import '@/assets/styles/tokens.css'
import '@/assets/styles/base.css'

// Imported for its side effect: applies the remembered theme to <html>
// before Vue mounts, so the app never flashes the wrong one on load.
import '@/theme'

import App from '@/App.vue'
import router from '@/router'
import i18n from '@/i18n'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(i18n)

app.mount('#app')
