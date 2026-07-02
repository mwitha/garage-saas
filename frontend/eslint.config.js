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
    rules: {
      // Intentional `as any` casts work around @hookform/resolvers v5 + Zod v4 type mismatch
      '@typescript-eslint/no-explicit-any': 'warn',
      // Schemas are exported alongside components intentionally; Fast Refresh still works
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Controlled-component state sync inside effects is acceptable in this codebase
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
])
