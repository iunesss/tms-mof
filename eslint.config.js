import globals from 'globals';

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-constant-condition': 'error',
  'no-unreachable': 'error',
};

export default [
  { ignores: ['**/node_modules/**', 'dist/**', 'backend/public/**', 'backend/src/public/**'] },
  {
    files: ['src/**/*.js', 'vite.config.js', 'scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules,
  },
  {
    files: ['backend/src/**/*.js', 'backend/test/**/*.js', 'backend/scripts/**/*.js'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
    rules,
  },
];
