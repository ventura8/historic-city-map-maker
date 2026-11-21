/** What the CLI reads from the owner's tools' listings (docs/research/M5-interfaces.md §4.4). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    billingEnabled,
    commandLine,
    FIREBASE_TOOLS_VERSION,
    hasAccount,
    hasSite,
    hasWebApp,
    listedProject,
} from '../src/self-host/tools.js';
import { REPOSITORY } from './support.js';

const answer = (result: unknown): string => JSON.stringify({ status: 'success', result });

describe('the listings', () => {
    it('happyPath_whatTheListingsSay', () => {
        expect(hasAccount('Logged in as a@example.org\n')).toBe(true);
        expect(
            hasAccount('\nLogged in as a@example.org\n\nOther available accounts (switch with "firebase login:use")\n - b@example.org\n'),
        ).toBe(true);
        expect(listedProject(answer([{ projectId: 'p-12345', projectNumber: '123456789012' }]), 'p-12345')).toEqual({
            listed: true,
            number: '123456789012',
        });
        expect(hasWebApp(answer([{ appId: '1:1:web:1' }]))).toBe(true);
        expect(hasSite(answer({ sites: [{ name: 'projects/p-12345/sites/p-12345' }] }), 'p-12345')).toBe(true);
        expect(hasSite(answer([{ name: 'projects/123/sites/p-12345' }]), 'p-12345')).toBe(true);
        expect(billingEnabled(JSON.stringify({ billingEnabled: true }))).toBe(true);
    });

    it('badPath_whatTheyDoNotSayCountsAsNotThere', () => {
        // No account: firebase-tools 15.33.0 warns `No authorized accounts, run "firebase login"`. A JSON listing (what
        // `--json` would print, with the accounts' tokens) is never read as an account.
        expect(hasAccount('⚠  No authorized accounts, run "firebase login"\n')).toBe(false);
        expect(hasAccount(answer([{ user: { email: 'a@example.org' }, tokens: { refresh_token: 'x' } }]))).toBe(false);
        for (const stdout of ['', 'not json', '[]', answer(null), answer({})]) {
            expect(hasAccount(stdout)).toBe(false);
            expect(hasWebApp(stdout)).toBe(false);
            expect(hasSite(stdout, 'p-12345')).toBe(false);
            expect(listedProject(stdout, 'p-12345')).toEqual({ listed: false, number: null });
            expect(billingEnabled(stdout)).toBe(false);
        }
        expect(listedProject(answer([{ projectId: 'p-12345', projectNumber: 12 }]), 'p-12345')).toEqual({ listed: true, number: null });
        expect(listedProject(answer(['p-12345']), 'p-12345').listed).toBe(false);
        expect(hasSite(answer({ sites: [{ name: 'projects/p/sites/other' }, 'x'] }), 'p-12345')).toBe(false);
        expect(billingEnabled(JSON.stringify({ billingEnabled: 'true' }))).toBe(false);
        expect(billingEnabled('null')).toBe(false);
    });

    it('happyPath_commandLinesQuoteWhatHasASpace', () => {
        expect(commandLine('firebase', ['apps:create', 'WEB', 'Cluj admin'])).toBe('firebase apps:create WEB "Cluj admin"');
    });

    it('happyPath_thePrintedInstallCommandIsTheRepositorysPin', () => {
        const root = JSON.parse(readFileSync(join(REPOSITORY, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };

        expect(root.devDependencies['firebase-tools']).toBe(FIREBASE_TOOLS_VERSION);
    });
});
