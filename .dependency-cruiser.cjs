// Architecture rules for the TypeScript workspaces, the e2e suite, the rules tests and the site build (`npm run
// lint:deps`). Layering, bottom-up: shared <- ui <- {engine, admin}; test-support is test-only; functions/ keeps its
// SDKs in adapters/ and its feature folders independent (M2-interfaces §1, §5); the create-historic-city CLI bundles only Node,
// @hcm/shared and the colour library (M5-interfaces §4.1).
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: 'no-circular',
            severity: 'error',
            comment: 'Cycles make modules impossible to test in isolation.',
            from: {},
            to: { circular: true },
        },
        {
            name: 'not-to-unresolvable',
            severity: 'error',
            comment: 'Every import must resolve (catches typos and missing dependencies).',
            from: {},
            to: { couldNotResolve: true },
        },
        {
            name: 'no-non-package-json',
            severity: 'error',
            comment: 'Product code may only import packages its package.json declares (no phantom dependencies).',
            from: { path: '^packages/[^/]+/src/' },
            to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
        },
        {
            name: 'src-not-to-dev-dependencies',
            severity: 'error',
            comment: 'Product code ships; devDependencies (test helpers, tooling) must not end up in a bundle.',
            from: { path: '^packages/[^/]+/src/', pathNot: '^packages/test-support/' },
            to: { dependencyTypes: ['npm-dev'] },
        },
        {
            name: 'src-not-to-tests',
            severity: 'error',
            comment: 'Product code never imports tests or the test-support package.',
            from: { path: '^packages/[^/]+/src/', pathNot: '^packages/test-support/' },
            to: { path: ['^packages/[^/]+/test/', '^packages/test-support/'] },
        },
        {
            name: 'shared-is-environment-neutral',
            severity: 'error',
            comment: 'shared runs in the browser, in Cloud Functions and in tests: no UI, no Lit, no Mapbox.',
            from: { path: '^packages/shared/' },
            to: { path: ['^packages/(ui|engine|admin|test-support)/', 'node_modules/(lit|lit-html|@lit|mapbox-gl)/'] },
        },
        {
            name: 'ui-below-apps',
            severity: 'error',
            comment: 'The component kit is shared by engine and admin, so it cannot depend on either.',
            from: { path: '^packages/ui/' },
            to: { path: '^packages/(engine|admin)/' },
        },
        {
            name: 'engine-and-admin-independent',
            severity: 'error',
            comment: 'The public engine never ships admin code, and the admin reuses engine pieces only via shared/ui.',
            from: { path: '^packages/(engine|admin)/' },
            to: { path: '^packages/(engine|admin)/', pathNot: '^packages/$1/' },
        },
        {
            name: 'only-the-map-adapter-imports-mapbox',
            severity: 'error',
            comment: 'Mapbox GL is reached only through ui/src/map/mapbox-adapter.ts (MapPort), so the core is testable with FakeMap.',
            from: { pathNot: '^packages/ui/src/map/mapbox-adapter\\.ts$' },
            to: { path: 'node_modules/mapbox-gl/' },
        },
        {
            name: 'only-the-draw-adapter-imports-terra-draw',
            severity: 'error',
            comment: 'Terra Draw is reached only through ui/src/map/draw/terra-draw-adapter.ts (MapDrawPort, M2c-interfaces §4).',
            from: { pathNot: '^packages/ui/src/map/draw/terra-draw-adapter\\.ts$' },
            to: { path: 'node_modules/terra-draw' },
        },
        {
            name: 'viewer-never-loads-the-draw-tools',
            severity: 'error',
            comment: 'The public viewer never ships the admin drawing tools.',
            from: { path: ['^packages/engine/', '^packages/ui/src/(viewer|components|layout|theme|fonts)/'] },
            to: { path: ['^packages/ui/src/map/draw/', 'node_modules/terra-draw'] },
        },
        {
            name: 'engine-firebase-only-in-telemetry',
            severity: 'error',
            comment: 'The public viewer loads no Firebase SDK, except the consent-gated telemetry (PLAN.md Addendum 2).',
            from: { path: '^packages/engine/', pathNot: '^packages/engine/src/telemetry/' },
            to: { path: 'node_modules/(firebase|@firebase)/' },
        },
        {
            name: 'engine-telemetry-only-app-and-analytics',
            severity: 'error',
            comment:
                'Telemetry may load firebase/app and firebase/analytics, nothing else (Performance Monitoring left the viewer: DECISIONS-for-review.md §18a, §21a).',
            from: { path: '^packages/engine/src/telemetry/' },
            to: { path: 'node_modules/(firebase|@firebase)/', pathNot: 'node_modules/firebase/(app|analytics)/' },
        },
        {
            name: 'web-vitals-only-in-the-consented-chunks',
            severity: 'error',
            comment:
                "Google's web-vitals is fetched only after consent: only the lazy field chunks import it (DECISIONS-for-review.md §76).",
            from: {
                path: '^(packages|functions|e2e|scripts)/',
                pathNot: '^packages/(engine/src/telemetry|admin/src/firebase)/field-sdk\\.ts$',
            },
            to: { path: 'node_modules/web-vitals/' },
        },
        {
            name: 'no-firebase-data-sdk-in-public-code',
            severity: 'error',
            comment: 'engine and shared (bundled into the viewer) never load Firestore, Auth, Storage or Realtime Database.',
            from: { path: '^packages/(engine|shared)/' },
            to: { path: 'node_modules/(firebase/(firestore|auth|storage|database)|@firebase/(firestore|auth|storage|database))' },
        },
        {
            name: 'functions-sdks-only-in-adapters',
            severity: 'error',
            comment:
                'Handlers and the callable plumbing reach Firestore, Auth, Google APIs and sharp only through functions/src/ports (adapters and the composition root import the SDKs), so every handler is tested with fakes.',
            from: { path: '^functions/src/', pathNot: ['^functions/src/adapters/', '^functions/src/deps\\.ts$'] },
            to: { path: 'node_modules/(firebase-admin|google-auth-library|sharp)/' },
        },
        {
            name: 'functions-feature-folders-independent',
            severity: 'error',
            comment:
                'A feature folder reaches another only through ports/, api/ and @hcm/shared (M2-interfaces §1, §5), so the three workstreams never edit or break each other.',
            // `layers` (M2c) and `imagery` (M3, docs/research/M3-interfaces.md §9) joined the list (DECISIONS-for-review.md §46c);
            // `assist` and `notify` (M4, docs/research/M4-interfaces.md §6.1) too (DECISIONS-for-review.md §54a); `cities` (M5,
            // docs/research/M5-interfaces.md §6.2) too (DECISIONS-for-review.md §62d).
            from: { path: '^functions/src/(admin|history|telemetry|setup|photos|publish|ops|layers|imagery|assist|notify|cities)/' },
            to: {
                path: '^functions/src/(admin|history|telemetry|setup|photos|publish|ops|layers|imagery|assist|notify|cities)/',
                pathNot: '^functions/src/$1/',
            },
        },
        {
            name: 'admin-firebase-sdk-only-in-adapters',
            severity: 'error',
            comment:
                'The admin logic is tested in Node with fakes of its ports: only its Firebase adapters and its entry import the Firebase JS SDK (M2b-interfaces §1.7); the Google REST clients use fetch.',
            from: { path: '^packages/admin/src/', pathNot: ['^packages/admin/src/firebase/', '^packages/admin/src/index\\.ts$'] },
            to: { path: 'node_modules/(firebase|@firebase)/' },
        },
        {
            name: 'admin-logic-without-lit',
            severity: 'error',
            comment:
                'Admin elements live in packages/ui/src/admin; packages/admin is logic only (its entry registers the elements through @hcm/ui/admin).',
            from: { path: '^packages/admin/src/' },
            to: { path: 'node_modules/(lit|lit-html|@lit)/' },
        },
        {
            name: 'viewer-never-loads-admin-elements',
            severity: 'error',
            comment:
                'The engine and the viewer elements never import the admin elements, so no admin code or text reaches the public bundle.',
            from: { path: ['^packages/engine/', '^packages/ui/src/(viewer|components|layout|theme|fonts)/'] },
            to: { path: '^packages/ui/src/admin/' },
        },
        {
            name: 'create-historic-city-bundles-only-what-it-needs',
            severity: 'error',
            comment:
                'The CLI is one bundled file without a runtime dependency (M5-interfaces §4.1): its source imports Node built-ins, @hcm/shared and the colour library of @hcm/ui/dynamic-color only (DECISIONS-for-review.md §61).',
            from: { path: '^packages/create-historic-city/src/' },
            to: {
                dependencyTypesNot: ['core'],
                pathNot: [
                    '^packages/create-historic-city/(src/|package\\.json$)',
                    '^packages/shared/src/',
                    '^packages/ui/src/theme/dynamic-color\\.ts$',
                ],
            },
        },
    ],
    options: {
        doNotFollow: { path: 'node_modules' },
        exclude: { path: ['(^|/)\\.tsbuild/', '(^|/)dist/'] },
        tsPreCompilationDeps: true,
        tsConfig: { fileName: 'tsconfig.json' },
        enhancedResolveOptions: {
            exportsFields: ['exports'],
            conditionNames: ['import', 'require', 'node', 'default', 'types'],
            mainFields: ['module', 'main', 'types', 'typings'],
        },
        reporterOptions: {
            text: { highlightFocused: true },
        },
    },
};
