// ESLint flat config: the single place where lint rules are chosen or relaxed. Inline directive
// comments are disabled (linterOptions.noInlineConfig, --no-inline-config) and banned by
// scripts/ci/check_no_inline_suppressions.py; a relaxation goes here, scoped and with a why-comment.
import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import lit from 'eslint-plugin-lit';
import nounsanitized from 'eslint-plugin-no-unsanitized';
import playwright from 'eslint-plugin-playwright';
import sonarjs from 'eslint-plugin-sonarjs';
import wc from 'eslint-plugin-wc';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Product source: every workspace package, the Cloud Functions, the static site build (it writes the page, its CSP and the
 * served manifest) and the release scripts (they write every version, the released engine and its integrity).
 */
const PRODUCT = [
    'packages/*/src/**/*.ts',
    'functions/src/**/*.ts',
    'scripts/site/src/**/*.ts',
    'scripts/site/build-site.ts',
    'scripts/site/build-admin.ts',
    'scripts/release/src/**/*.ts',
    'scripts/release/*.ts',
];
/** Vitest suites and the test kit, the JavaScript CLIs' tests included (the `tools` project of vitest.config.ts). */
const TESTS = [
    'packages/*/test/**/*.ts',
    'packages/test-support/src/**/*.ts',
    'packages/*/scripts/test/**/*.ts',
    'functions/test/**/*.ts',
    'firebase/rules-tests/**/*.ts',
    'scripts/*/test/**/*.ts',
    'e2e/test/**/*.ts',
];
/** Playwright specs, fixtures, mock APIs and config (the @hcm/e2e workspace); its Vitest unit tests are TESTS above. */
const E2E = ['e2e/**/*.ts'];
const E2E_UNIT_TESTS = ['e2e/test/**/*.ts'];
const NODE_TOOLING = ['*.config.ts', 'packages/*/vite.config.ts', 'eslint.config.js', '.dependency-cruiser.cjs'];

/** XSS: data is never rendered as HTML (docs/research/design-review-security-cost.md §1.7). */
const HTML_SINKS = [
    { property: 'innerHTML', message: 'Render with Lit templates or textContent; data is never HTML (security review §1.7).' },
    { property: 'outerHTML', message: 'Render with Lit templates or textContent; data is never HTML (security review §1.7).' },
    { property: 'insertAdjacentHTML', message: 'Build DOM nodes instead; data is never HTML (security review §1.7).' },
    { property: 'setHTML', message: 'Mapbox popups use setDOMContent; data is never HTML (security review §1.7).' },
    { property: 'setHTMLUnsafe', message: 'Data is never HTML (security review §1.7).' },
    { object: 'document', property: 'write', message: 'document.write is banned (CSP, XSS).' },
    { object: 'document', property: 'writeln', message: 'document.writeln is banned (CSP, XSS).' },
];

const UNSAFE_LIT_DIRECTIVES = {
    patterns: [
        {
            group: ['lit/directives/unsafe-*', 'lit-html/directives/unsafe-*'],
            message: 'unsafeHTML/unsafeSVG/unsafeMathML render strings as markup; data is never HTML (security review §1.7).',
        },
        {
            group: ['lit/directives/style-map.js', 'lit-html/directives/style-map.js'],
            message:
                "styleMap writes a style attribute the city page's CSP refuses; use cssProperties (packages/ui/src/components/css-properties.ts).",
        },
    ],
};

const BANNED_SYNTAX = [
    {
        selector: 'Decorator',
        message: 'Decorators are banned: use `static properties` + customElements.define (their helpers show as uncovered branches).',
    },
    {
        selector: 'Identifier[name=/^unsafe(HTML|SVG|MathML)$/]',
        message: 'unsafeHTML/unsafeSVG/unsafeMathML render strings as markup; data is never HTML (security review §1.7).',
    },
    { selector: 'NewExpression[callee.name="Function"]', message: 'new Function is eval; banned (CSP, XSS).' },
    { selector: 'CallExpression[callee.name="Function"]', message: 'Function() is eval; banned (CSP, XSS).' },
];

/** Size and complexity limits for product code (complexity 5 = Radon A, the sibling repos' bar). */
const PRODUCT_LIMITS = {
    complexity: ['error', 5],
    'max-depth': ['error', 3],
    'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
    'max-params': ['error', 4],
    'sonarjs/cognitive-complexity': ['error', 10],
};

/**
 * Tests may be longer than product code, never more complex: a test file holds one behaviour's happy and bad rows
 * with their fixtures (600 lines), a test reads top to bottom as arrange / act / assert without helper indirection
 * (120 lines per function), and the fixtures Vitest and Playwright inject arrive as parameters (8).
 */
const TEST_LIMITS = {
    'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
    'max-params': ['error', 8],
};

export default defineConfig(
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/.tsbuild/**',
            'reports/**',
            'coverage/**',
            'playwright-report/**',
            'test-results/**',
            'seed/**',
            // Third-party code vendored only to patch an advisory (vendor/npm/braces/README.md); not ours to lint.
            'vendor/**',
            // The released engine (docs/research/M5-interfaces.md §2.3): the minified build a release commits for jsDelivr,
            // written by `npm run release:cdn` and held byte for byte to a fresh build by the release-cdn gate. Its sources
            // are linted in packages/; the bundle is no source.
            'cdn/engine/**',
            // Agents' worktrees (gitignored): whole copies of this repository; linting them made the last group ('.' of
            // scripts/ci/lint.sh) build every copy's TypeScript programs and run out of memory (DECISIONS §235).
            '.claude/worktrees/**',
        ],
    },
    {
        linterOptions: {
            noInlineConfig: true,
            reportUnusedDisableDirectives: 'error',
            reportUnusedInlineConfigs: 'error',
        },
    },
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    sonarjs.configs.recommended,
    nounsanitized.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            eqeqeq: ['error', 'always'],
            'no-console': 'error',
            'no-eval': 'error',
            'no-new-func': 'error',
            'no-var': 'error',
            'prefer-const': 'error',
            'no-restricted-properties': ['error', ...HTML_SINKS],
            'no-restricted-imports': ['error', UNSAFE_LIT_DIRECTIVES],
            'no-restricted-syntax': ['error', ...BANNED_SYNTAX],
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            '@typescript-eslint/consistent-type-imports': 'error',
            // Covered by @typescript-eslint/no-deprecated; AWS CDK rules have nothing to inspect here.
            // Together about a quarter of ESLint's rule time (docs/research/DECISIONS-for-review.md §31f).
            'sonarjs/deprecation': 'off',
            'sonarjs/aws-restricted-ip-admin-access': 'off',
        },
    },
    {
        files: PRODUCT,
        languageOptions: { globals: globals.browser },
        rules: PRODUCT_LIMITS,
    },
    {
        files: ['packages/ui/src/**/*.ts', 'packages/engine/src/**/*.ts', 'packages/admin/src/**/*.ts'],
        extends: [lit.configs['flat/recommended'], wc.configs['flat/recommended']],
    },
    {
        // Web push by FCM registration token (finding 50 of 2026-11-01; the user's approval of 2026-11-01,
        // DECISIONS-for-review.md §81d): firebase 13 marks `getToken` and `deleteToken` deprecated in favour of the
        // installation id, which FCM refused live. Only these two, only in the module that imports the messaging SDK; every
        // other deprecated API stays an error.
        files: ['packages/admin/src/firebase/messaging-sdk.ts'],
        rules: {
            '@typescript-eslint/no-deprecated': [
                'error',
                { allow: [{ from: 'package', package: '@firebase/messaging', name: ['getToken', 'deleteToken'] }] },
            ],
        },
    },
    {
        // The logging module is the one place allowed to write to the console: every other
        // module logs through createLogger() (packages/shared/src/log.ts).
        files: ['packages/shared/src/log.ts'],
        rules: { 'no-console': 'off' },
    },
    {
        files: TESTS,
        extends: [vitest.configs.recommended],
        languageOptions: { globals: { ...globals.browser, ...globals.node } },
        rules: {
            'vitest/no-focused-tests': 'error',
            'vitest/no-disabled-tests': 'error',
            'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expect.element'] }],
            ...TEST_LIMITS,
        },
    },
    {
        // The e2e suite must stay deterministic (design-review-testability.md §2): no sleeps, no focused or
        // skipped tests, no networkidle waits, no forced clicks, web-first assertions only.
        files: E2E,
        ignores: E2E_UNIT_TESTS,
        extends: [playwright.configs['flat/recommended']],
        languageOptions: { globals: globals.node },
        rules: {
            'playwright/no-wait-for-timeout': 'error',
            'playwright/no-focused-test': 'error',
            'playwright/no-skipped-test': ['error', { allowConditional: false }],
            'playwright/no-networkidle': 'error',
            'playwright/no-force-option': 'error',
            'playwright/prefer-web-first-assertions': 'error',
            // A spec's assertion helpers are named expect… (expectFocus, expectState), so a test that only calls them asserts.
            'playwright/expect-expect': ['error', { assertFunctionPatterns: ['^expect[A-Z]'] }],
            ...TEST_LIMITS,
        },
    },
    {
        // A city's config.js is a classic script that assigns window.HistoricCityMapConfig (docs/ENGINE_API.md); the e2e
        // world's fixture cities are city sites too (M5, DECISIONS-for-review.md §62d).
        files: ['sites/*/config.js', 'starter-kit/config.js', 'e2e/fixtures/sites/*/config.js'],
        languageOptions: { sourceType: 'script', globals: globals.browser },
    },
    {
        files: NODE_TOOLING,
        languageOptions: { globals: globals.node },
    },
    {
        // Plain JavaScript files here are tool configs (eslint, dependency-cruiser): they are not part of
        // any tsconfig project, so type-aware rules cannot run on them (typescript-eslint's documented setup).
        files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
        extends: [tseslint.configs.disableTypeChecked],
    },
    {
        // dependency-cruiser only reads CommonJS configs (`module.exports`).
        files: ['**/*.cjs'],
        languageOptions: { sourceType: 'commonjs' },
    },
    prettier,
);
