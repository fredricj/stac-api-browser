import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/api/:apiId',
      name: 'api-browser',
      // Lazy — this route pulls in MapLibre, which dominates the bundle.
      // The catalog list should not pay for it.
      component: () => import('@/views/ApiBrowserView.vue'),
      props: true,
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: { name: 'home' },
    },
  ],
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition

    if (to.path === from.path) return false

    return { top: 0 }
  },
})

export default router
