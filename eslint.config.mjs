/* eslint-env node */
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier/flat';
import globals from 'globals';

export default [
  // Global ignores (replaces .eslintignore)
  {
    ignores: [
      'dist/',
      'node_modules/',
      'src-tauri/',
      '.vite/',
      'src/i18n/locales/**',
      '**/*.min.js',
    ],
  },

  // Base: eslint:recommended (replaces `extends: ['eslint:recommended']`)
  js.configs.recommended,

  // @typescript-eslint recommended-type-checked + stylistic-type-checked
  // (replaces `extends: ['plugin:@typescript-eslint/recommended-type-checked',
  // 'plugin:@typescript-eslint/stylistic-type-checked']`). The flat-config
  // variants are arrays, so we spread them in. Each brings its own parser,
  // plugins, and rule set.
  ...tseslint.configs['flat/recommended-type-checked'],
  ...tseslint.configs['flat/stylistic-type-checked'],

  // Project-specific overrides: type-checking parserOptions, JSX, globals,
  // the react plugins, and the project-specific rules (verbatim from
  // .eslintrc.cjs).
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
        project: ['./tsconfig.json', './tsconfig.node.json'],
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // --- Project-specific rules (verbatim from .eslintrc.cjs) ---
      // Allow empty functions/methods/arrow functions — these are common as
      // default no-op callbacks, default props, and stub implementations in
      // React/TS code. Matches the standard escape hatch used widely.
      '@typescript-eslint/no-empty-function': [
        'error',
        { allow: ['arrowFunctions', 'functions', 'methods'] },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSAsExpression',
          message: 'Avoid `as` casts — narrow with types or guards instead.',
        },
      ],
    },
  },

  // Apply Prettier last so it disables all formatting-related rules
  // (replaces `extends: ['prettier']`).
  prettierConfig,
];
