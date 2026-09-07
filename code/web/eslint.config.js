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
    files: ['src/App.tsx', 'src/pages/**/*.tsx', 'src/components/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['@base-ui/react', '@base-ui/react/*', '@radix-ui/*'], message: 'Use the shadcn components in @/components/ui.' }] }],
      'no-restricted-syntax': ['error',
        { selector: 'JSXOpeningElement[name.name=/^(button|input|textarea|select|option|dialog|details|summary|hr)$/]', message: 'Use the matching shadcn/ui component.' },
        { selector: 'CallExpression[callee.object.name=/^(window|globalThis)$/][callee.property.name=/^(alert|confirm|prompt)$/]', message: 'Use AlertDialog, Dialog or Sonner.' },
        { selector: 'JSXAttribute[name.name="role"][value.value=/^(dialog|alertdialog|tab|tablist|menu|menuitem|switch|checkbox|radio|combobox)$/]', message: 'Use a shadcn primitive for this interaction role.' },
      ],
    },
  },
  {
    files: ['src/components/ui/combobox.tsx'],
    rules: { 'react-refresh/only-export-components': ['error', { allowExportNames: ['useComboboxAnchor'] }] },
  },
  {
    files: ['src/components/workspace-ui.tsx'],
    rules: {
      'react-refresh/only-export-components': ['error', { allowExportNames: ['labels', 'date', 'number', 'duration', 'bytes'] }],
    },
  },
])
