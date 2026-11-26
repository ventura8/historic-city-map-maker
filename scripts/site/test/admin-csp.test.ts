import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    adminContentSecurityPolicy,
    adminCspDirectives,
    authDomains,
    e2eContentSecurityPolicy,
    formatPolicy,
    parsePolicy,
    UPGRADE_INSECURE_REQUESTS,
} from '../src/admin/csp.js';
import { CSP_HEADER, hostingHeaders, parseHostingConfig } from '../src/admin/hosting.js';
import { ROOT } from './support.js';

/** The real project (`.firebaserc` → `projects.default`), whose auth domains the committed policy names. */
function defaultProject(): string {
    const firebaserc = JSON.parse(readFileSync(join(ROOT, '.firebaserc'), 'utf8')) as { projects: { default: string } };
    return firebaserc.projects.default;
}

/** The admin's policy as `firebase.json` sends it: on `/admin/**` since M6 (the public map at the root has its own). */
function committedPolicy(): string {
    const hosting = parseHostingConfig(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
    return String(hostingHeaders(hosting, '/admin/')[CSP_HEADER]);
}

function sources(policy: string, name: string): readonly string[] {
    return parsePolicy(policy).find(([directive]) => directive === name)?.[1] ?? [];
}

describe('adminContentSecurityPolicy', () => {
    it('happyPath_firebaseJsonSendsExactlyThisPolicy', () => {
        expect(committedPolicy()).toBe(adminContentSecurityPolicy(defaultProject()));
    });

    it('happyPath_allowsTheFirebaseAuthPopupGoogleApisAndRecaptcha', () => {
        const policy = adminContentSecurityPolicy('demo-hcm');

        expect(sources(policy, 'script-src')).toEqual(
            expect.arrayContaining(['https://apis.google.com', 'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/']),
        );
        expect(sources(policy, 'frame-src')).toEqual(
            expect.arrayContaining([...authDomains('demo-hcm'), 'https://accounts.google.com', 'https://recaptcha.google.com/recaptcha/']),
        );
        expect(sources(policy, 'connect-src')).toEqual(
            expect.arrayContaining(['https://*.googleapis.com', 'https://*.cloudfunctions.net', 'https://*.run.app']),
        );
    });

    it('badPath_noInlineCodeNoEvalAndNoFraming', () => {
        const policy = adminContentSecurityPolicy('demo-hcm');

        expect(policy).not.toContain("'unsafe-inline'");
        expect(policy).not.toContain("'unsafe-eval'");
        expect(sources(policy, 'frame-ancestors')).toEqual(["'none'"]);
        expect(sources(policy, 'object-src')).toEqual(["'none'"]);
        expect(adminCspDirectives('demo-hcm').at(-1)).toEqual([UPGRADE_INSECURE_REQUESTS, []]);
    });
});

describe('parsePolicy and formatPolicy', () => {
    it('happyPath_roundTripsAPolicy', () => {
        const policy = adminContentSecurityPolicy('demo-hcm');

        expect(formatPolicy(parsePolicy(policy))).toBe(policy);
    });

    it('badPath_blankPartsAreDroppedAndRepeatedSourcesJoinOnce', () => {
        expect(parsePolicy(" default-src 'self' ;; ;img-src a a ")).toEqual([
            ['default-src', ["'self'"]],
            ['img-src', ['a', 'a']],
        ]);
        expect(formatPolicy([['img-src', ['a', 'a', 'b']]])).toBe('img-src a b');
    });
});

describe('e2eContentSecurityPolicy', () => {
    const E2E_ORIGINS = ['http://127.0.0.1:9099', 'http://127.0.0.1:5001'];

    it('happyPath_dropsTheUpgradeAndAddsTheEmulatorsToConnectSrcOnly', () => {
        const production = committedPolicy();
        const e2e = e2eContentSecurityPolicy(production, E2E_ORIGINS);
        const before = new Map(parsePolicy(production));
        const after = new Map(parsePolicy(e2e));

        expect([...before.keys()].filter((name) => !after.has(name))).toEqual([UPGRADE_INSECURE_REQUESTS]);
        expect(after.get('connect-src')).toEqual([...(before.get('connect-src') ?? []), ...E2E_ORIGINS]);
        const unchanged = [...after.keys()].filter((name) => name !== 'connect-src');
        expect(unchanged.map((name) => after.get(name))).toEqual(unchanged.map((name) => before.get(name)));
    });

    it('badPath_anOriginAlreadyAllowedIsNotRepeated', () => {
        const policy = "connect-src 'self' http://127.0.0.1:9099";

        expect(e2eContentSecurityPolicy(policy, ['http://127.0.0.1:9099'])).toBe(policy);
    });
});
