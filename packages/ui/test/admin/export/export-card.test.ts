/**
 * Settings → Export the city (`packages/ui/src/admin/export/`, M5 §5.6; behaviour A53): the card in each of its states
 * (loading, an error, never published, an editor, nothing yet, under way, ready, failed, expired), its two inputs
 * (Export, Download; three with the scans), the lazy chunk's Loading and Try again, and the section in the settings page.
 */
import { translateAdminContent, translateApiError, type Locale } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { render } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { exportCard, failureReason, sizeText, type ExportCardContext } from '../../../src/admin/export/export-card.js';
import type { ExportIntentsPort, ExportRecordPort, ExportSectionPort } from '../../../src/admin/export/export-port.js';
import { EXPORT_CARD_CHUNK, lazyExportCard, saveFrom, type ExportCardChunk } from '../../../src/admin/export/lazy-card.js';
import { chunkLoader } from '../../../src/admin/imagery/orders/lazy-card.js';
import type { SettingsIntentsPort, SettingsViewState } from '../../../src/admin/settings/settings-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { page, settingsState } from '../layers/fixtures.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';

const READY: ExportRecordPort = {
    id: 'x-20261102-1',
    state: 'ready',
    rasters: false,
    bytes: 12_400_000,
    sha256: 'ab12cd34'.repeat(8),
    counts: { photos: 45, restrictedPhotos: 2, layers: 3, rasters: 0, pois: 4 },
    expiresAt: '2026-11-09T10:00:00.000Z',
    error: null,
};

function sectionOf(overrides: Partial<ExportSectionPort> = {}): ExportSectionPort {
    return {
        status: 'ready',
        failure: null,
        owner: true,
        published: true,
        latest: null,
        scans: { count: 0, bytes: 0 },
        includeScans: false,
        starting: false,
        downloading: false,
        ...overrides,
    };
}

interface Drawn {
    readonly root: HTMLElement;
    readonly calls: string[];
    readonly saved: { readonly url: string; readonly fileName: string }[];
}

function draw(view: ExportSectionPort, options: { readonly locale?: Locale; readonly readOnly?: boolean } = {}): Drawn {
    const calls: string[] = [];
    const saved: { url: string; fileName: string }[] = [];
    const intents: ExportIntentsPort = {
        setExportScans: (on) => calls.push(`setExportScans ${String(on)}`),
        startExport: () => {
            calls.push('startExport');
            return Promise.resolve();
        },
        downloadExport: () => {
            calls.push('downloadExport');
            return Promise.resolve(
                view.latest?.state === 'ready'
                    ? { url: 'https://storage.googleapis.com/b/x.zip?sig', fileName: 'oras-2026-11-02.zip' }
                    : null,
            );
        },
        retryExport: () => calls.push('retryExport'),
    };
    const context: ExportCardContext = {
        locale: options.locale ?? 'en',
        view,
        intents,
        readOnly: options.readOnly === true,
        save: (target) => saved.push(target),
    };
    const root = document.createElement('div');
    document.body.append(root);
    render(exportCard(context), root);
    return { root, calls, saved };
}

function text(root: Element): string {
    return deepText(root).replace(/\s+/g, ' ');
}

function buttons(root: Element): string[] {
    return deepAll(root, 'hcm-button').map((button) => button.textContent.trim());
}

async function click(button: Element): Promise<void> {
    await updated(button);
    deep(button, 'button').click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
}

describe('the export card', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theOwnerExportsInOneClick', async () => {
        const { root, calls } = draw(sectionOf());

        expect(text(root)).toContain('A .zip with everything the city needs');
        expect(buttons(root)).toEqual(['Export']);
        expect(deepAll(root, 'hcm-switch')).toEqual([]);
        await click(deep(root, 'hcm-button'));

        expect(calls).toEqual(['startExport']);
        // docs/LESSONS.md 255: the buttons go while the export is under way; the focus stays in the card.
        expect(document.activeElement).toBe(deep(root, 'h2[data-detail-heading]'));
        expect(await axeViolations(root)).toEqual([]);
    });

    it('happyPath_withUsgsScansTheSwitchNamesTheirSize', async () => {
        const { root, calls } = draw(sectionOf({ scans: { count: 2, bytes: 2_500_000 } }), { locale: 'ro' });

        expect(text(root)).toContain('Include scanările USGS (2,5 MB)');
        deep(root, 'hcm-switch').dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: true } }));
        expect(calls).toEqual(['setExportScans true']);
        expect(buttons(root)).toEqual(['Exportă']);
        expect(await axeViolations(root)).toEqual([]);
    });

    it.each(['queued', 'building'] as const)('happyPath_anExport_%s_showsItsProgressAndNoAction', (state) => {
        const { root } = draw(sectionOf({ latest: { ...READY, state, bytes: null, sha256: null, counts: null, expiresAt: null } }));

        // One live region, there from the start, says it (an inserted, already filled status is often not announced).
        expect(deep(root, `[data-state="${state}"]`).getAttribute('role')).toBeNull();
        expect(deep(root, '[data-export-live]').textContent).toBe(translateAdminContent('en', `adminContent.export.${state}`));
        expect(deepAll(root, 'hcm-loading-indicator')).toHaveLength(1);
        expect(text(root)).toContain(translateAdminContent('en', `adminContent.export.${state}`));
        expect(buttons(root)).toEqual([]);
    });

    it('happyPath_aReadyExportSaysWhatItHoldsAndDownloads', async () => {
        const { root, calls, saved } = draw(sectionOf({ latest: READY }));

        expect(text(root)).toContain('The archive is ready: 12.4 MB; photos: 45, layers: 3.');
        expect(deep(root, '[data-export-live]').textContent).toBe('The archive is ready: 12.4 MB; photos: 45, layers: 3.');
        expect(text(root)).toContain('It can be downloaded until');
        expect(deep(root, '[data-field="sha256"] code').textContent).toBe(READY.sha256);
        expect(text(root)).toContain('2 photos are licensed for this map only: RIGHTS.md names them.');
        expect(buttons(root)).toEqual(['Download', 'Export']);
        expect(deepAll(root, 'hcm-button').map((button) => button.getAttribute('variant'))).toEqual(['filled', 'tonal']);
        await click(deep(root, 'hcm-button'));
        await Promise.resolve();

        expect(calls).toEqual(['downloadExport']);
        expect(saved).toEqual([{ url: 'https://storage.googleapis.com/b/x.zip?sig', fileName: 'oras-2026-11-02.zip' }]);
        expect(await axeViolations(root)).toEqual([]);
    });

    it('happyPath_oneRestrictedPhotoInRomanian_andAReadyExportWithoutItsFields', () => {
        const { root } = draw(
            sectionOf({ latest: { ...READY, counts: { ...READY.counts, restrictedPhotos: 1 } as ExportRecordPort['counts'] } }),
            {
                locale: 'ro',
            },
        );
        expect(text(root)).toContain('Arhiva e gata: 12,4 MB; fotografii: 45, straturi: 3.');
        expect(text(root)).toContain('1 fotografie are permisiune doar pentru această hartă: RIGHTS.md o numește.');

        const bare = draw(sectionOf({ latest: { ...READY, bytes: null, sha256: null, counts: null, expiresAt: null } }));
        expect(text(bare.root)).toContain('The archive is ready: 0 byte; photos: 0, layers: 0.');
        expect(deepAll(bare.root, '[data-field]')).toEqual([]);
    });

    it('badPath_aFailedExportSaysWhyAndOffersExportAgain', async () => {
        const failed: ExportRecordPort = {
            ...READY,
            state: 'failed',
            error: { code: 'apiError.export.tooLarge', params: { size: '2400000000', max: '2000000000' } },
        };
        const { root, calls } = draw(sectionOf({ latest: failed }));

        expect(deep(root, '[data-state="failed"]').getAttribute('role')).toBe('alert');
        expect(deep(root, '[data-export-live]').textContent).toBe('');
        expect(text(root)).toContain('The export would be 2.4 GB, over the 2 GB limit.');
        expect(buttons(root)).toEqual(['Export again']);
        await click(deep(root, 'hcm-button'));
        expect(calls).toEqual(['startExport']);
        expect(await axeViolations(root)).toEqual([]);
    });

    it('badPath_aFailedExportWithoutItsCodeStillOffersExportAgain', () => {
        const { root } = draw(sectionOf({ latest: { ...READY, state: 'failed', error: null } }));

        expect(text(root)).toContain('The export failed:');
    });

    it('badPath_anExpiredExportOffersExportAgain', () => {
        const { root } = draw(sectionOf({ latest: { ...READY, state: 'expired' } }));

        expect(text(root)).toContain('The export has expired and was deleted.');
        expect(deep(root, '[data-export-live]').textContent).toBe('The export has expired and was deleted.');
        expect(buttons(root)).toEqual(['Export again']);
        expect(deep(root, 'hcm-button').getAttribute('variant')).toBe('filled');
    });

    it('badPath_aCityNeverPublishedSaysToPublishFirst', () => {
        const { root } = draw(sectionOf({ published: false }));

        expect(text(root)).toContain('Publish the city before you export it.');
        expect(deep(root, '[data-export-live]').textContent).toBe('');
        expect(buttons(root)).toEqual([]);
    });

    it('badPath_anEditorSeesTheExportReadOnly', () => {
        const { root } = draw(sectionOf({ owner: false, latest: READY }));

        expect(text(root)).toContain('Only the city’s owners can export it.');
        expect(text(root)).toContain('The archive is ready');
        expect(buttons(root)).toEqual([]);
    });

    it('badPath_aRevokedPageDisablesEveryAction', () => {
        const { root } = draw(sectionOf({ latest: READY, scans: { count: 1, bytes: 10 } }), { readOnly: true });

        expect(deepAll(root, 'hcm-button').map((button) => button.hasAttribute('disabled'))).toEqual([true, true]);
        expect(deep(root, 'hcm-switch').hasAttribute('disabled')).toBe(true);
    });

    it('badPath_loadingThenAnErrorWithTryAgain', async () => {
        expect(deepAll(draw(sectionOf({ status: 'loading' })).root, 'hcm-loading-indicator')).toHaveLength(1);

        const { root, calls } = draw(sectionOf({ status: 'error', failure: { kind: 'failed', code: 'permission-denied' } }));
        await click(deep(root, 'hcm-button'));

        expect(calls).toEqual(['retryExport']);
    });
});

describe('the export card’s texts', () => {
    it.each([
        ['en', 512, '512 byte'],
        ['en', 12_400, '12.4 kB'],
        ['ro', 2_500_000_000, '2,5 GB'],
    ] as const)('happyPath_sizeText_%s_%d', (locale, bytes, shown) => {
        expect(sizeText(locale, bytes)).toBe(shown);
    });

    it('badPath_aFailureWithoutItsSizesStillReads', () => {
        expect(failureReason('en', { code: 'apiError.export.tooLarge', params: {} })).toBe(
            translateApiError('en', 'apiError.export.tooLarge', { size: '0 byte', max: '2 GB' }),
        );
        expect(failureReason('en', { code: 'apiError.export.busy', params: {} })).toBe(translateApiError('en', 'apiError.export.busy'));
    });
});

describe('the export card’s chunk', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_loadingUntilTheChunkIsIn_thenTheCard', async () => {
        let refreshes = 0;
        const chunk = chunkLoader<ExportCardChunk>(async () => import('../../../src/admin/export/export-card.js'));
        const root = document.createElement('div');
        document.body.append(root);
        const context = { locale: 'en' as const, view: sectionOf(), intents: null, readOnly: false, refresh: () => (refreshes += 1) };

        render(lazyExportCard(context, chunk), root);
        expect(deepAll(root, 'hcm-loading-indicator')).toHaveLength(1);
        await chunk.load();
        render(lazyExportCard(context, chunk), root);

        expect(refreshes).toBe(1);
        expect(buttons(root)).toEqual(['Export']);
    });

    it('badPath_aFailedFetchSaysSoWithTryAgain', async () => {
        let fetches = 0;
        let refreshes = 0;
        const chunk = chunkLoader<ExportCardChunk>(() => {
            fetches += 1;
            return Promise.reject(new Error('offline'));
        });
        const root = document.createElement('div');
        document.body.append(root);
        const context = { locale: 'en' as const, view: sectionOf(), intents: null, readOnly: false, refresh: () => (refreshes += 1) };

        render(lazyExportCard(context, chunk), root);
        await chunk.load().catch(() => undefined);
        render(lazyExportCard(context, chunk), root);
        expect(deepAll(root, '[role="alert"]')).toHaveLength(1);
        await click(deep(root, 'hcm-button'));

        expect(fetches).toBe(2);
        expect(refreshes).toBeGreaterThanOrEqual(2);
    });

    it('happyPath_savingFollowsALinkToTheAddressAndDropsIt', () => {
        const clicked: string[] = [];
        const link = Object.assign(document.createElement('a'), {});
        link.addEventListener('click', (event) => {
            event.preventDefault();
            clicked.push(`${link.href} ${link.download} ${link.rel}`);
        });
        const scope = { document: { createElement: () => link, body: document.body } as unknown as Document };

        saveFrom(scope)({ url: 'https://storage.googleapis.com/b/x.zip?sig', fileName: 'oras-2026-11-02.zip' });

        expect(clicked).toEqual(['https://storage.googleapis.com/b/x.zip?sig oras-2026-11-02.zip noopener']);
        expect(link.isConnected).toBe(false);
    });
});

describe('<hcm-settings-page> export', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theSectionShowsTheCardOnceItsChunkIsIn', async () => {
        const settings = new FakeArea<SettingsViewState, SettingsIntentsPort>(
            settingsState({ section: 'export', export: sectionOf({ latest: READY }) }),
        );
        const { element } = await page('settings', settings, { params: ['export'] });

        await EXPORT_CARD_CHUNK.load();
        await updated(element);

        expect(deepText(element)).toContain('Export the city');
        // M28: the map's sources row comes after the export's.
        expect(deepAll(element, 'a.section-row').some((row) => row.textContent.includes('A .zip with everything the city needs'))).toBe(
            true,
        );
        expect(deepAll(element, '[slot="detail"] hcm-button').map((button) => button.textContent.trim())).toEqual(['Download', 'Export']);
        expect(await axeViolations(element)).toEqual([]);
    });
});
