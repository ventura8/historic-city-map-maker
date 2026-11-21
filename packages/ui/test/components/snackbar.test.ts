import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { ANNOUNCE_DELAY_MS, defineHcmSnackbar, type HcmSnackbar } from '../../src/components/snackbar.js';
import { cleanup, deepFocus, fixture, recordEvents, ringContrast, shadowPart } from '../helpers.js';

defineHcmSnackbar();

function snackbar(timeoutMs = 6000, actionLabel = 'Reîncearcă'): Promise<HcmSnackbar> {
    return fixture<HcmSnackbar>(
        html`<hcm-snackbar
            message="Straturile nu s-au încărcat"
            action-label=${actionLabel}
            close-label="Închide"
            timeout-ms=${timeoutMs}
        ></hcm-snackbar>`,
    );
}

describe('<hcm-snackbar>', () => {
    afterEach(() => {
        vi.useRealTimers();
        cleanup();
    });

    it('happyPath_showsTheMessageInAPoliteLiveRegion', async () => {
        vi.useFakeTimers();
        const element = await snackbar();
        const status = shadowPart(element, '[role="status"]');
        expect(shadowPart(element, '.snackbar').textContent).toContain('Straturile nu s-au încărcat');
        // Empty when the snackbar appears, filled a moment later: a region added together with its text is not announced.
        expect(status.textContent).toBe('');

        vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
        await element.updateComplete;

        expect(status.textContent).toBe('Straturile nu s-au încărcat');
        expect(status.getAttribute('aria-live')).toBe('polite');
        vi.useRealTimers();
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_stackedPutsTheActionAndCloseUnderTheMessageInANarrowBox', async () => {
        const element = await snackbar(0, 'Reîncărcați');
        element.style.width = '240px';
        element.stacked = true;
        await element.updateComplete;
        const message = shadowPart(element, '.message').getBoundingClientRect();
        const action = shadowPart(element, '.action').getBoundingClientRect();
        const box = shadowPart(element, '.snackbar').getBoundingClientRect();

        expect(element.hasAttribute('stacked')).toBe(true);
        expect(action.top).toBeGreaterThanOrEqual(message.bottom - 1);
        expect(action.right).toBeLessThanOrEqual(box.right);
    });

    it('badPath_aSnackbarClosedBeforeItsAnnouncementIsNotAnnounced', async () => {
        vi.useFakeTimers();
        const element = await snackbar(0, '');

        shadowPart(element, 'hcm-icon-button').click();
        vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
        await element.updateComplete;

        expect(shadowPart(element, '[role="status"]').textContent).toBe('');
        element.remove();
    });

    it('happyPath_theActionFiresAndDismisses', async () => {
        const element = await snackbar();
        const actions = recordEvents(element, 'hcm-action');
        const dismissals = recordEvents(element, 'hcm-dismiss');

        await userEvent.click(page.getByRole('button', { name: 'Reîncearcă' }));
        await element.updateComplete;

        expect(actions).toHaveLength(1);
        expect(dismissals).toEqual([{ reason: 'action' }]);
        expect(element.shadowRoot?.querySelector('.snackbar')).toBeNull();
    });

    it('happyPath_closeDismissesAndANewMessageShowsItAgain', async () => {
        const element = await snackbar(0, '');
        const dismissals = recordEvents(element, 'hcm-dismiss');

        await userEvent.click(page.getByRole('button', { name: 'Închide' }));
        await element.updateComplete;
        element.message = 'Link copiat';
        await element.updateComplete;

        expect(dismissals).toEqual([{ reason: 'close' }]);
        expect(element.shadowRoot?.querySelector('.action')).toBeNull();
        await expect.element(page.getByRole('status')).toHaveTextContent('Link copiat');
        expect(shadowPart(element, '.snackbar').textContent).toContain('Link copiat');
    });

    it('happyPath_itTimesOutButPausesWhileHoveredOrFocused', async () => {
        vi.useFakeTimers();
        const element = await snackbar(6000);
        const dismissals = recordEvents(element, 'hcm-dismiss');
        const box = shadowPart(element, '.snackbar');

        vi.advanceTimersByTime(5000);
        box.dispatchEvent(new PointerEvent('pointerenter'));
        vi.advanceTimersByTime(10_000);
        expect(dismissals).toEqual([]);
        box.dispatchEvent(new PointerEvent('pointerleave'));
        box.dispatchEvent(new FocusEvent('focusin'));
        vi.advanceTimersByTime(10_000);
        expect(dismissals).toEqual([]);
        box.dispatchEvent(new FocusEvent('focusout'));
        vi.advanceTimersByTime(6000);

        expect(dismissals).toEqual([{ reason: 'timeout' }]);
    });

    it('happyPath_theFocusRingStandsOutOnTheInverseSurface', async () => {
        // The tour measured the toast's Close ring at 1.62:1: the secondary ring on the inverse surface (3:1 needed).
        const element = await snackbar(0, '');

        await userEvent.tab();

        const focused = deepFocus();
        expect(focused?.getAttribute('aria-label')).toBe('Închide');
        const surface = getComputedStyle(shadowPart(element, '.snackbar')).backgroundColor;
        expect(ringContrast(focused, surface)).toBeGreaterThanOrEqual(3);
    });

    it('badPath_zeroTimeoutAndAnEmptyMessageNeverStartATimer', async () => {
        vi.useFakeTimers();
        const persistent = await snackbar(0);
        const empty = await fixture<HcmSnackbar>(html`<hcm-snackbar close-label="Închide"></hcm-snackbar>`);
        const dismissals = [...recordEvents(persistent, 'hcm-dismiss'), ...recordEvents(empty, 'hcm-dismiss')];

        vi.advanceTimersByTime(60_000);

        expect(dismissals).toEqual([]);
        expect(empty.shadowRoot?.querySelector('.snackbar')).toBeNull();
        persistent.remove();
    });
});
