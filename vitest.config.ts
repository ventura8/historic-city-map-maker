import { existsSync } from 'node:fs';

import { playwright } from '@vitest/browser-playwright';
import { defineConfig, type TestProjectInlineConfiguration } from 'vitest/config';

/**
 * One Vitest run for every TypeScript test project, so coverage is merged into a single
 * report (reports/coverage/ts/lcov.info) with repo-relative paths for Sonar and the per-file gate.
 *
 * A suite is enabled only once its directory has a package.json (the repository root for the `tools` row). Adding a
 * package = adding a row here (docs/research/M0-handoff.md).
 */
interface Suite {
    /** Workspace directory; the suite runs only when `<dir>/package.json` exists. */
    readonly dir: string;
    readonly project: TestProjectInlineConfiguration;
    /**
     * Source files measured by coverage. Vitest 5 reports only files listed here, so every
     * product package must list its src/ explicitly or untested files silently vanish.
     */
    readonly coverage: readonly string[];
}

/**
 * Lit components need real custom elements, shadow DOM and accessibility trees: headless Chromium. A fresh object per
 * project: Vitest names each browser instance after its project, so two projects sharing one instance object clash.
 */
function chromium() {
    return {
        enabled: true,
        provider: playwright(),
        headless: true,
        screenshotFailures: false,
        instances: [{ browser: 'chromium' as const }],
    };
}

/**
 * What the browser projects import from node_modules, pre-bundled before the first test: on a cold Vite cache (every CI
 * run; `npm ci` deletes node_modules/.vite) a dependency discovered mid-run re-optimises and reloads the page, which
 * fails the test and can load Lit twice. A new Lit directive or browser-test dependency joins this list in the same change.
 * `@hcm/test-support > axe-core` is the test kit's own axe-core 4.14 (the root one is the 4.13 of @axe-core/playwright).
 */
const BROWSER_TEST_DEPS = [
    'lit',
    'lit/directive.js',
    'lit/directives/class-map.js',
    'lit/directives/keyed.js',
    'lit/directives/repeat.js',
    'zod',
    '@material/material-color-utilities',
    // The admin's drawing tools (DECISIONS-for-review.md §34g), imported lazily by loadTerraDraw in the ui project's tests.
    'terra-draw',
    'terra-draw-mapbox-gl-adapter',
    '@hcm/test-support > axe-core',
];

/**
 * The Node projects without module mocks share one module graph per worker instead of loading a fresh one for every
 * file (a fresh one costs a process start and the imports, firebase-admin's among them): on four CPUs the `vitest` gate
 * took about a third less time (docs/research/pipeline-baseline.md, the tests addendum). Checked with every file of a
 * project in one worker in shuffled orders, and with three and fifteen workers. Their tests restore what they change
 * (fake timers, stubbed globals, environment variables); Vitest restores mocks and `vi.setConfig` after each file, so a
 * setting a test needs belongs in its project (below), not in a helper module that only the first file of a worker
 * would evaluate. A `vi.mock` would leak into the next file of the worker: the one test that needs it, the composition
 * root's, is its own isolated project (`functions-deps`). `rules` and `tools` stay isolated: their time is in the
 * emulators and in child processes, not in loading modules.
 */
const SHARED_MODULE_GRAPH = { isolate: false } as const;

/**
 * The functions tests wait on the emulators, whose first answer on a fresh connection takes seconds while the whole stage
 * shares them: 60 s per test and hook for every file of both functions projects, as the rules world gives its files.
 * Two files that relied on Vitest's 5 s and 10 s defaults timed out under load (docs/LESSONS.md #51).
 */
const EMULATOR_TIMEOUTS = { testTimeout: 60_000, hookTimeout: 60_000 } as const;

/** The composition root's test replaces `google-auth-library` and `firebase-functions/logger` with `vi.mock`. */
const COMPOSITION_ROOT_TEST = 'functions/test/deps.test.ts';

const SUITES: readonly Suite[] = [
    {
        dir: 'packages/shared',
        project: {
            extends: true,
            test: { name: 'shared', ...SHARED_MODULE_GRAPH, environment: 'node', include: ['packages/shared/test/**/*.test.ts'] },
        },
        coverage: ['packages/shared/src/**/*.ts'],
    },
    {
        dir: 'packages/ui',
        project: {
            extends: true,
            // Pre-bundle what the browser tests import, so a cold cache (every CI run) never re-optimises and reloads a test.
            optimizeDeps: { include: BROWSER_TEST_DEPS },
            test: { name: 'ui', include: ['packages/ui/test/**/*.test.ts'], browser: chromium() },
        },
        coverage: ['packages/ui/src/**/*.ts'],
    },
    {
        dir: 'packages/engine',
        project: {
            extends: true,
            test: {
                name: 'engine',
                ...SHARED_MODULE_GRAPH,
                environment: 'node',
                include: ['packages/engine/test/**/*.test.ts'],
            },
        },
        coverage: ['packages/engine/src/**/*.ts'],
    },
    {
        dir: 'packages/admin',
        project: {
            extends: true,
            test: { name: 'admin', ...SHARED_MODULE_GRAPH, environment: 'node', include: ['packages/admin/test/**/*.test.ts'] },
        },
        coverage: ['packages/admin/src/**/*.ts'],
    },
    {
        dir: 'functions',
        project: {
            extends: true,
            test: {
                name: 'functions',
                ...SHARED_MODULE_GRAPH,
                ...EMULATOR_TIMEOUTS,
                environment: 'node',
                include: ['functions/test/**/*.test.ts'],
                exclude: [COMPOSITION_ROOT_TEST],
            },
        },
        coverage: ['functions/src/**/*.ts'],
    },
    {
        // A fresh module graph for the one functions test file with `vi.mock`; its coverage joins the `functions` scope.
        dir: 'functions',
        project: {
            extends: true,
            test: { name: 'functions-deps', ...EMULATOR_TIMEOUTS, environment: 'node', include: [COMPOSITION_ROOT_TEST] },
        },
        coverage: [],
    },
    {
        dir: 'firebase/rules-tests',
        // Rules are measured by the emulator's rule-coverage report (check_rules_coverage.py), not by v8.
        project: { extends: true, test: { name: 'rules', environment: 'node', include: ['firebase/rules-tests/test/**/*.test.ts'] } },
        coverage: [],
    },
    {
        // The e2e suite's own logic, unit-tested in Chromium (e2e/test/): how a split run takes its part of the queue
        // (e2e/split.ts) and the tour's layout and accessibility checkers, the in-page probes on synthetic DOM fixtures and
        // the pure rules they feed (e2e/support/). Sonar counts e2e/ as tests, so Vitest's per-file thresholds hold them.
        dir: 'e2e',
        project: {
            extends: true,
            optimizeDeps: { include: BROWSER_TEST_DEPS },
            test: { name: 'e2e-support', include: ['e2e/test/**/*.test.ts'], browser: chromium() },
        },
        coverage: [
            'e2e/split.ts',
            'e2e/support/page-script.ts',
            'e2e/support/dom-walk.ts',
            'e2e/support/colour.ts',
            'e2e/support/layout-probe.ts',
            'e2e/support/layout-rules.ts',
            'e2e/support/scroll-probe.ts',
            'e2e/support/blank-scroll-probe.ts',
            'e2e/support/a11y-probe.ts',
            'e2e/support/a11y-rules.ts',
            'e2e/support/live-regions.ts',
            'e2e/support/violations.ts',
            'e2e/support/emulator-pool.ts',
        ],
    },
    {
        // The Node tooling: JavaScript CLIs driven as child processes (their logic is TypeScript measured in its own package),
        // the static site build, which is product code: it writes the page, its CSP and the served manifest, and the release
        // scripts (scripts/release: every version, the released engine in cdn/engine/ and its integrity).
        dir: '.',
        project: {
            extends: true,
            test: {
                name: 'tools',
                environment: 'node',
                include: ['scripts/*/test/**/*.test.ts', 'packages/*/scripts/test/**/*.test.ts'],
                // These tests start Node processes and copy the 46 MB of legacy originals, next to every other project of the
                // run: 5 s per test (Vitest's default) is a wall-clock bet, not a behaviour.
                testTimeout: 30_000,
            },
        },
        coverage: ['scripts/site/src/**/*.ts', 'scripts/release/src/**/*.ts'],
    },
    {
        // M5 kit-cli: the `create-historic-city` CLI (docs/research/M5-interfaces.md §4.5), every command over the fakes of
        // its ports; its real ports run real child processes (`node`) and real files in temporary folders.
        dir: 'packages/create-historic-city',
        project: {
            extends: true,
            test: {
                name: 'create-historic-city',
                environment: 'node',
                include: ['packages/create-historic-city/test/**/*.test.ts'],
                testTimeout: 30_000,
            },
        },
        coverage: ['packages/create-historic-city/src/**/*.ts'],
    },
];

const present = SUITES.filter((suite) => existsSync(`${suite.dir}/package.json`));

export default defineConfig({
    test: {
        projects: present.map((suite) => suite.project),
        // The colour library's ES modules import without file extensions, which Node refuses, so Vite transforms it as it does
        // for the CLI's bundle, in every project (each extends this config). Set for `create-historic-city` alone, its six
        // files failed to import it whenever a worker had run `admin` files first (2026-11-13, DECISIONS-for-review.md §180h).
        server: { deps: { inline: ['@material/material-color-utilities'] } },
        reporters: ['default', ['junit', { outputFile: 'reports/junit/vitest.xml' }]],
        coverage: {
            provider: 'v8',
            reportsDirectory: 'reports/coverage/ts',
            reporter: ['text', 'lcov', 'json-summary'],
            include: present.flatMap((suite) => suite.coverage),
            exclude: ['**/*.d.ts'],
            // >=90% for EVERY file, all four metrics. Never lowered, never auto-updated (AGENTS rules).
            thresholds: { perFile: true, lines: 90, branches: 90, functions: 90, statements: 90 },
        },
    },
});
