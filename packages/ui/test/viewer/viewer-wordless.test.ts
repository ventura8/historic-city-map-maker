/** Unit tests for the engine's bilingual card when no language catalogue could be fetched (`viewer-wordless.ts`). */
import { html, render, type TemplateResult } from 'lit';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { reloadOf, statusOrCard } from '../../src/viewer/viewer-wordless.js';
import { defineKitDoubles } from './doubles.js';

interface BootView {
    readonly bootError: unknown;
    readonly state: { readonly status: string } | null;
    readonly locale: 'ro' | 'en' | 'ko';
}

function statusProbe(): TemplateResult {
    return html`<div class="status-probe">status</div>`;
}

function rendered(view: BootView, status: () => TemplateResult = statusProbe): HTMLElement {
    const host = document.createElement('div');
    document.body.append(host);
    render(statusOrCard(view, status), host);
    return host;
}

describe('statusOrCard', () => {
    beforeAll(() => {
        defineKitDoubles();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aHealthyBootKeepsTheStatusLayer', () => {
        const host = rendered({ bootError: null, state: { status: 'loading' }, locale: 'ko' });

        expect(host.querySelector('.status-probe')?.textContent).toBe('status');
        expect(host.querySelector('.catalogue-down')).toBeNull();
    });

    it('happyPath_aBootErrorWithTextsStillShowsTheStatusLayer', () => {
        const host = rendered({ bootError: { code: 'error.generic' }, state: null, locale: 'ro' });

        expect(host.querySelector('.status-probe')).not.toBeNull();
        expect(host.querySelector('.catalogue-down')).toBeNull();
    });

    it('happyPath_aStoreErrorWithTextsStillShowsTheStatusLayer', () => {
        const host = rendered({ bootError: null, state: { status: 'error' }, locale: 'en' });

        expect(host.querySelector('.status-probe')).not.toBeNull();
        expect(host.querySelector('.catalogue-down')).toBeNull();
    });

    it('badPath_aBootErrorWithoutTextsShowsTheBilingualCard', () => {
        const host = rendered({ bootError: { code: 'error.generic' }, state: { status: 'idle' }, locale: 'ko' });
        const card = host.querySelector('.catalogue-down');

        expect(host.querySelector('.status-probe')).toBeNull();
        expect(card?.getAttribute('role')).toBe('alert');
        expect(Array.from(card?.querySelectorAll('p') ?? []).map((line) => [line.lang, line.textContent])).toEqual([
            ['ro', 'Harta nu s-a putut încărca.'],
            ['en', 'The map could not be loaded.'],
        ]);
        const retry = host.querySelector('hcm-button') as HTMLElement & { variant: string; icon: string };
        expect([retry.variant, retry.icon]).toEqual(['tonal', 'refresh']);
        expect(retry.textContent).toContain('Reîncearcă');
        expect(retry.textContent).toContain('Retry');
    });

    it('badPath_aStoreErrorWithoutTextsShowsTheBilingualCard', () => {
        const host = rendered({ bootError: null, state: { status: 'error' }, locale: 'ko' });

        expect(host.querySelector('.catalogue-down')?.getAttribute('role')).toBe('alert');
        expect(host.querySelector('.status-probe')).toBeNull();
    });

    it('badPath_aNullStateWithoutBootErrorShowsTheStatusLayer', () => {
        const host = rendered({ bootError: null, state: null, locale: 'ko' });

        expect(host.querySelector('.status-probe')?.textContent).toBe('status');
        expect(host.querySelector('.catalogue-down')).toBeNull();
    });

    it('happyPath_retryReloadsThePage', () => {
        const reload = vi.fn();

        reloadOf({ reload })();

        expect(reload).toHaveBeenCalledOnce();
    });
});
