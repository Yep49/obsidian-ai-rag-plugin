import { defineConfig } from 'eslint/config';
import json from '@eslint/json';
import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';

const tsconfigRootDir = new URL('.', import.meta.url).pathname;
const manifestRuleOverrides = Object.fromEntries(
  Object.keys(obsidianmd.rules).map(ruleName => [`obsidianmd/${ruleName}`, 'off'])
);
manifestRuleOverrides['obsidianmd/validate-manifest'] = 'error';

export default defineConfig([
  {
    ignores: [
      'node_modules/**',
      'main.js'
    ]
  },
  {
    files: ['manifest.json'],
    language: 'json/json',
    plugins: {
      json
    }
  },
  ...obsidianmd.configs.recommended,
  {
    files: ['manifest.json'],
    rules: {
      'no-irregular-whitespace': 'off',
      ...manifestRuleOverrides
    }
  },
  {
    files: ['src/**/*.ts', '*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir
      }
    },
    rules: {
      'obsidianmd/ui/sentence-case': [
        'warn',
        {
          acronyms: ['AI', 'API', 'FAQ', 'LLM', 'RAG', 'URL'],
          brands: ['OpenAI', 'ZhipuAI', 'SiliconFlow', 'Wiki', 'Meta'],
          ignoreRegex: [
            '^https://',
            '^sk-',
            '^gpt-',
            '^BAAI/',
            '^_wiki$'
          ]
        }
      ]
    }
  }
]);
