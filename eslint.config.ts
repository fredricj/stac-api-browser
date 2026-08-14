import { globalIgnores } from 'eslint/config'
import pluginVue from 'eslint-plugin-vue'
import {
  defineConfigWithVueTs,
  vueTsConfigs,
} from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },

  globalIgnores([
    '**/dist/**',
    '**/dist-ssr/**',
    '**/coverage/**',
    '**/node_modules/**',
    '**/playwright-report/**',
    '**/test-results/**',
  ]),

  pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommended,

  {
    name: 'app/rules',
    rules: {
      // Placeholder views and early-phase scaffolding legitimately declare
      // props they do not consume yet; keep the signal, drop the noise for
      // deliberately-unused args.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Single-word view names (HomeView is fine, but so is a future `Map`).
      'vue/multi-word-component-names': 'off',
    },
  },

  // Must come last: turns off every rule Prettier owns.
  skipFormatting,
)
