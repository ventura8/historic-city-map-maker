/**
 * firebase.json and .firebaserc: the emulator layout every test tier relies on, and the admin's
 * Hosting security headers (docs/research/design-review-security-cost.md §1.8), which since M6 apply under `/admin/`
 * only: the public map at the root keeps its pages' own policy (docs/research/M6-interfaces.md §2.2). No emulator needed.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

interface Header {
    readonly key: string;
    readonly value: string;
}

interface FirebaseJson {
    readonly firestore: { readonly location: string; readonly rules: string; readonly indexes: string };
    readonly storage: { readonly rules: string };
    readonly functions: readonly { readonly source: string; readonly codebase: string; readonly runtime: string }[];
    readonly hosting: {
        readonly site: string;
        readonly public: string;
        readonly headers: readonly { readonly source?: string; readonly regex?: string; readonly headers: readonly Header[] }[];
    };
    readonly emulators: Readonly<Record<string, unknown>>;
}

function repoFile(path: string): string {
    return readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

const config = JSON.parse(repoFile('firebase.json')) as FirebaseJson;

/** The blocks whose glob names every path, and those of the admin's path (`/admin/**`). */
const EVERY_PATH = '**';
const ADMIN_PATHS = '/admin/**';

/** The headers of the blocks whose glob is one of `sources`. */
function headersOf(sources: readonly string[]): readonly Header[] {
    return config.hosting.headers.flatMap((block) => (block.source !== undefined && sources.includes(block.source) ? block.headers : []));
}

/** A header the admin's pages are sent (the catch-all's and the admin path's). */
function header(key: string): string {
    return headersOf([EVERY_PATH, ADMIN_PATHS]).find((entry) => entry.key === key)?.value ?? '';
}

function directive(name: string): string[] {
    const found = header('Content-Security-Policy')
        .split(';')
        .map((part) => part.trim().split(/\s+/))
        .find(([directiveName]) => directiveName === name);
    return found?.slice(1) ?? [];
}

describe('emulators', () => {
    it('happyPath_everyEmulatorListensOnLoopbackAtItsFixedPort', () => {
        expect(config.emulators).toMatchObject({
            singleProjectMode: true,
            auth: { host: '127.0.0.1', port: 9099 },
            firestore: { host: '127.0.0.1', port: 8080 },
            storage: { host: '127.0.0.1', port: 9199 },
            functions: { host: '127.0.0.1', port: 5001 },
            hosting: { host: '127.0.0.1', port: 5000 },
            pubsub: { host: '127.0.0.1', port: 8085 },
            tasks: { host: '127.0.0.1', port: 9499 },
            ui: { enabled: false },
        });
    });

    it('happyPath_theDefaultProjectIsTheMapsAndTheE2eAliasTheDemoProject', () => {
        expect(JSON.parse(repoFile('.firebaserc'))).toEqual({ projects: { default: 'bucurestiul-disparut', e2e: 'demo-hcm' } });
    });

    it('badPath_everyEmulatorRunNamesTheDemoProject', () => {
        // .firebaserc has a real default project: a run that named none would start the emulators for it.
        const scripts = Object.values((JSON.parse(repoFile('package.json')) as { scripts: Record<string, string> }).scripts);
        const runs = scripts.filter((script) => script.includes('firebase emulators:'));

        expect(runs.length).toBeGreaterThan(0);
        expect(runs.filter((script) => !script.includes('--project demo-hcm'))).toEqual([]);
    });
});

describe('deploy targets', () => {
    it('happyPath_rulesIndexesAndFunctionsPointAtTheirSources', () => {
        expect(config.firestore).toEqual({
            database: '(default)',
            location: 'nam5',
            rules: 'firebase/firestore.rules',
            indexes: 'firebase/firestore.indexes.json',
        });
        expect(config.storage.rules).toBe('firebase/storage.rules');
        expect(config.functions).toMatchObject([{ source: 'functions/dist', codebase: 'default', runtime: 'nodejs24' }]);
        // The Hosting tree `npm run build:hosting` assembles: the public map at the root, the admin under /admin/.
        expect(config.hosting).toMatchObject({ site: 'bucurestiul-disparut', public: 'dist/hosting' });
        expect(repoFile(config.firestore.rules)).toContain("rules_version = '2';");
    });
});

describe('the Firestore database', () => {
    it('badPath_aDeployNeverCreatesADatabaseElsewhere', () => {
        // The (default) database exists in nam5 since 2026-10-11 (DECISIONS §40a); a location can never change, and
        // firebase-tools creates a missing database in the named location, so the file names the one that exists.
        expect(config.firestore.location).toBe('nam5');
    });
});

describe('admin security headers', () => {
    it('happyPath_policiesFromTheSecurityReviewAreSent', () => {
        expect(header('Cross-Origin-Opener-Policy')).toBe('same-origin-allow-popups');
        expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
        expect(header('X-Content-Type-Options')).toBe('nosniff');
        expect(header('Content-Security-Policy-Report-Only')).toBe("require-trusted-types-for 'script'");
        expect(directive('frame-ancestors')).toEqual(["'none'"]);
        expect(directive('object-src')).toEqual(["'none'"]);
        expect(directive('base-uri')).toEqual(["'none'"]);
    });

    it.each(['script-src', 'style-src', 'default-src'])('badPath_%sNeverAllowsInlineOrEval', (name) => {
        const sources = directive(name);

        expect(sources).toContain("'self'");
        expect(sources.filter((source) => ["'unsafe-inline'", "'unsafe-eval'", '*', 'http:', 'https:'].includes(source))).toEqual([]);
    });

    it('happyPath_googleSignInMayFrameTheAuthDomainOnEitherHostingDomain', () => {
        expect(directive('frame-src')).toEqual(
            expect.arrayContaining([
                'https://bucurestiul-disparut.web.app',
                'https://bucurestiul-disparut.firebaseapp.com',
                'https://accounts.google.com',
            ]),
        );
    });

    it('badPath_theAdminsPolicyIsNeverSentToEveryPath', () => {
        // The viewer's pages carry their own policy (a meta tag of the site build); a second one on `**` would apply both.
        const everyPath = headersOf([EVERY_PATH]).map((entry) => entry.key);

        expect(everyPath).not.toContain('Content-Security-Policy');
        expect(everyPath).not.toContain('Content-Security-Policy-Report-Only');
        expect(everyPath).not.toContain('Cross-Origin-Opener-Policy');
        expect(headersOf([ADMIN_PATHS]).filter((entry) => entry.key === 'Content-Security-Policy')).toHaveLength(1);
    });

    it('badPath_mapboxGlLoadsOnlyFromItsVersionedCdnPath', () => {
        expect(directive('script-src').filter((source) => source.includes('mapbox'))).toEqual(['https://api.mapbox.com/mapbox-gl-js/']);
    });
});
