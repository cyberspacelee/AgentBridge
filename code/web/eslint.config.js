import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['src/components/ui/button.tsx', 'src/components/ui/badge.tsx', 'src/components/ui/tabs.tsx'],
    rules: {
      'react-refresh/only-export-components': ['error', {
        allowConstantExport: true,
        allowExportNames: ['buttonVariants', 'badgeVariants', 'tabsListVariants'],
      }],
    },
  },
  {
    files: ['src/components/workspace-ui.tsx'],
    rules: {
      'react-refresh/only-export-components': ['error', { allowExportNames: ['labels', 'date', 'number', 'duration', 'bytes'] }],
    },
  },
])
