import { html, render } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeEvent, renderSheetFrame } from '../../src/viewer/sheet-frame.js';

function frame(mode: 'bottom' | 'side' | 'docked', open: boolean, onClose = vi.fn(), minimize?: boolean): HTMLElement {
    const host = document.createElement('div');
    document.body.append(host);
    const options = { mode, open, label: 'Straturi', closeLabel: 'Închide', handleLabel: 'Redimensionează panoul', onClose, minimize };
    render(renderSheetFrame(options, html`<p>conținut</p>`), host);
    return host;
}

describe('renderSheetFrame', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_modalModesUseTheKitSheet', () => {
        const host = frame('side', true);

        const sheet = host.querySelector('hcm-sheet') as
            (HTMLElement & { open: boolean; variant: string; label: string; closeLabel: string; handleLabel: string }) | null;
        expect(sheet?.open).toBe(true);
        expect(sheet?.variant).toBe('side');
        expect(sheet?.label).toBe('Straturi');
        expect(sheet?.closeLabel).toBe('Închide');
        expect(sheet?.handleLabel).toBe('Redimensionează panoul');
        expect(host.querySelector('[slot="header"]')?.textContent).toBe('Straturi');
        expect(host.textContent).toContain('conținut');
        expect(sheet?.hasAttribute('modal')).toBe(true);
    });

    it('badPath_aStandardSheetHasNoScrimOverTheMap', () => {
        // The Layers sheet (the owner, 2026-11-15): no dimming, the map stays usable beside it.
        const host = document.createElement('div');
        document.body.append(host);
        const options = {
            mode: 'bottom' as const,
            open: true,
            label: 'Straturi',
            closeLabel: 'Închide',
            handleLabel: 'Mută',
            onClose: vi.fn(),
        };
        render(renderSheetFrame({ ...options, standard: true }, html`<p>conținut</p>`), host);

        expect(host.querySelector('hcm-sheet')?.hasAttribute('modal')).toBe(false);
    });

    it('happyPath_dockedModeIsALabelledSectionWithAClose', () => {
        const onClose = vi.fn();
        const host = frame('docked', true, onClose);

        expect(host.querySelector('section')?.getAttribute('aria-label')).toBe('Straturi');
        host.querySelector('hcm-icon-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(onClose).toHaveBeenCalledTimes(1);
        const close = host.querySelector('hcm-icon-button') as (HTMLElement & { expanded?: boolean }) | null;
        expect([close?.getAttribute('icon'), close?.expanded]).toEqual(['close', undefined]);
    });

    it('happyPath_aDockedSheetThatMinimizesSaysItIsExpanded', () => {
        const host = frame('docked', true, vi.fn(), true);

        const close = host.querySelector('hcm-icon-button') as (HTMLElement & { expanded?: boolean }) | null;
        expect([close?.getAttribute('icon'), close?.expanded]).toEqual(['chevron_left', true]);
    });

    it('badPath_aDockedSheetThatDoesNotMinimizeSaysNothingOfExpanded', () => {
        const host = frame('docked', true, vi.fn(), false);

        const close = host.querySelector('hcm-icon-button') as (HTMLElement & { expanded?: boolean }) | null;
        expect([close?.getAttribute('icon'), close?.expanded]).toEqual(['close', undefined]);
    });

    it('badPath_aClosedDockedSheetRendersNothing', () => {
        const host = frame('docked', false);

        expect(host.querySelector('section')).toBeNull();
        expect(host.textContent.trim()).toBe('');
    });

    it('happyPath_closeEventStaysInsideTheViewer', () => {
        const event = closeEvent();

        expect(event.type).toBe('hcm-close');
        expect(event.bubbles).toBe(true);
        expect(event.composed).toBe(false);
    });
});
