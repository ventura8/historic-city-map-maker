import { axeViolations } from '@hcm/test-support/axe';
import { html, render } from 'lit';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { defineEditingElements, EDITING_TAGS } from '../../../src/admin/editing/define.js';
import type { HcmConfirmDialog } from '../../../src/admin/editing/hcm-confirm-dialog.js';
import type { HcmEmptyState } from '../../../src/admin/editing/hcm-empty-state.js';
import { splitsAt, type HcmListDetail, type PageChrome } from '../../../src/admin/editing/hcm-list-detail.js';
import { deepActiveElement } from '../../../src/components/focus.js';
import { installFonts } from '../../../src/fonts/font-faces.js';
import { applyTheme, clearTheme } from '../../../src/theme/apply.js';
import { BASELINE_THEME } from '../../../src/theme/baseline.js';
import { FakeArea } from './fake-area.js';

const hosts: HTMLElement[] = [];

/** A themed box of `width` × `height` CSS px holding the template; resolves its first element once rendered. */
async function inBox<T extends Element>(template: ReturnType<typeof html>, width: number, height = 800): Promise<T> {
    installFonts(document, '/packages/ui/fonts/');
    const host = document.createElement('div');
    host.style.inlineSize = `${String(width)}px`;
    host.style.blockSize = `${String(height)}px`;
    document.body.append(host);
    applyTheme(host, BASELINE_THEME, 'light', false);
    hosts.push(host);
    render(template, host);
    const element = host.firstElementChild as T;
    await settle(element);
    return element;
}

async function settle(element: Element): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await (element as Partial<{ updateComplete: Promise<unknown> }>).updateComplete;
    }
}

function pane(element: HcmListDetail, name: 'list' | 'detail'): HTMLElement {
    const found = element.shadowRoot?.querySelector<HTMLElement>(`.${name}`);
    if (found === null || found === undefined) {
        throw new Error(`no ${name} pane`);
    }
    return found;
}

function listDetail(detail: boolean, key = '') {
    return html`<hcm-list-detail
        ?detail=${detail}
        .detailKey=${key}
        list-label="Jobs"
        detail-label="Job details"
        back-label="Back"
        close-label="Close"
    >
        <div slot="list"><a href="#/jobs/a" id="opener">Job a</a></div>
        <div slot="detail">
            <h2 tabindex="-1" data-detail-heading>Job a</h2>
            <p>Running</p>
        </div>
    </hcm-list-detail>`;
}

describe('<hcm-list-detail>', () => {
    beforeAll(() => {
        defineEditingElements();
    });
    afterEach(() => {
        for (const host of hosts.splice(0)) {
            clearTheme(host);
        }
        document.body.replaceChildren();
    });

    it('happyPath_from840pxTheListAndTheDetailSitSideBySideWithNamedRegions', async () => {
        const element = await inBox<HcmListDetail>(listDetail(true, 'a'), 1000);

        expect(element.split).toBe(true);
        expect(element.hasAttribute('split')).toBe(true);
        expect([pane(element, 'list').hidden, pane(element, 'detail').hidden]).toEqual([false, false]);
        expect(pane(element, 'list').getAttribute('aria-label')).toBe('Jobs');
        expect(element.shadowRoot?.querySelector('hcm-button')).toBeNull();
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_belowOnePaneShowsAndAnOpenItemGetsBackOrCloseAndTheEditorChrome', async () => {
        const chrome: PageChrome[] = [];
        document.addEventListener('hcm-chrome', (event) => chrome.push((event as CustomEvent<{ chrome: PageChrome }>).detail.chrome));
        const medium = await inBox<HcmListDetail>(listDetail(true, 'a'), 700);
        const compact = await inBox<HcmListDetail>(listDetail(true, 'a'), 360);
        const backs: string[] = [];
        compact.addEventListener('hcm-back', () => backs.push('back'));

        expect([pane(medium, 'list').hidden, pane(medium, 'detail').hidden]).toEqual([true, false]);
        expect(medium.shadowRoot?.querySelector('hcm-button')?.textContent.trim()).toBe('Back');
        expect(compact.shadowRoot?.querySelector('hcm-button')?.textContent.trim()).toBe('Close');
        compact.shadowRoot?.querySelector<HTMLElement>('hcm-button')?.click();
        expect(backs).toEqual(['back']);
        expect(chrome).toEqual(['editor']);
        compact.detail = false;
        await settle(compact);
        expect(chrome).toEqual(['editor', 'default']);
        expect(pane(compact, 'detail').hidden).toBe(true);
    });

    it('happyPath_aLandscapePhonesSinglePaneIsAFullScreenEditorToo', async () => {
        const chrome: PageChrome[] = [];
        const element = await inBox<HcmListDetail>(listDetail(false), 700, 400);
        element.addEventListener('hcm-chrome', (event) => chrome.push((event as CustomEvent<{ chrome: PageChrome }>).detail.chrome));

        element.detail = true;
        await settle(element);
        element.remove();

        expect(chrome).toEqual(['editor', 'default']);
    });

    it('happyPath_openingAnItemFocusesItsHeadingAndClosingReturnsTheFocus', async () => {
        const element = await inBox<HcmListDetail>(listDetail(false), 1000);
        document.querySelector<HTMLElement>('#opener')?.focus();

        element.detailKey = 'a';
        element.detail = true;
        await settle(element);
        const focused = deepActiveElement(document)?.textContent;
        element.detailKey = '';
        element.detail = false;
        await settle(element);

        expect(focused).toBe('Job a');
        expect(deepActiveElement(document)?.id).toBe('opener');
    });

    it('badPath_escClosesTheDetailButNotFromInsideADialogNorWhenNothingIsOpen', async () => {
        const element = await inBox<HcmListDetail>(listDetail(true, 'a'), 700);
        const backs: string[] = [];
        element.addEventListener('hcm-back', () => backs.push('back'));
        const heading = document.querySelector<HTMLElement>('[data-detail-heading]');
        const dialog = document.createElement('dialog');
        heading?.parentElement?.append(dialog);

        heading?.focus();
        await userEvent.keyboard('{Escape}');
        dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
        element.detail = false;
        await settle(element);
        heading?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
        heading?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));

        expect(backs).toEqual(['back']);
    });

    it('happyPath_anItemStillLoadingGetsTheFocusOnceItsHeadingAppears', async () => {
        const element = await inBox<HcmListDetail>(
            html`<hcm-list-detail
                ><div slot="detail" id="late"><p>Loading…</p></div></hcm-list-detail
            >`,
            1000,
        );

        element.detailKey = 'job';
        element.detail = true;
        await settle(element);
        const before = deepActiveElement(document);
        const heading = Object.assign(document.createElement('h2'), { tabIndex: -1, textContent: 'USGS import' });
        heading.setAttribute('data-detail-heading', '');
        document.querySelector('#late')?.append(heading);
        await settle(element);
        const focused = deepActiveElement(document);
        document.querySelector('#late')?.append(document.createElement('p'));
        element.remove();

        expect(before).toBe(document.body);
        expect(focused).toBe(heading);
    });

    it('badPath_anItemWithoutAHeadingMovesNoFocus', async () => {
        const element = await inBox<HcmListDetail>(
            html`<hcm-list-detail detail-key="x" detail
                ><p slot="detail">no heading</p>
                <p slot="detail"><span>still none</span></p></hcm-list-detail
            >`,
            1000,
        );

        expect(deepActiveElement(document)).toBe(document.body);
        element.detailKey = 'y';
        await settle(element);
        expect(deepActiveElement(document)).toBe(document.body);
    });
});

describe('<hcm-confirm-dialog>', () => {
    beforeAll(() => {
        defineEditingElements();
    });
    afterEach(() => {
        document.body.replaceChildren();
    });

    async function confirmDialog(destructive: boolean): Promise<HcmConfirmDialog> {
        return inBox<HcmConfirmDialog>(
            html`<hcm-confirm-dialog
                ?destructive=${destructive}
                headline="Cancel this job?"
                body="It stops at its next step."
                confirm-label="Cancel job"
                cancel-label="Keep it running"
            ></hcm-confirm-dialog>`,
            800,
        );
    }

    it('happyPath_opensWithTheFocusOnCancelAndConfirms', async () => {
        const element = await confirmDialog(true);
        const events: string[] = [];
        element.addEventListener('hcm-confirm', () => events.push('confirm'));
        element.addEventListener('hcm-cancel', () => events.push('cancel'));

        element.open = true;
        await settle(element);
        const active = deepActiveElement(document);
        const focused = ((active?.getRootNode() as ShadowRoot | undefined)?.host ?? active)?.textContent.trim();
        const violations = await axeViolations(element);
        element.shadowRoot?.querySelector<HTMLElement>('.confirm')?.click();
        await settle(element);

        expect(focused).toBe('Keep it running');
        expect(violations).toEqual([]);
        expect(events).toEqual(['confirm']);
        expect(element.destructive).toBe(true);
    });

    it('badPath_cancelEscAndTheCloseButtonAllCancel', async () => {
        const element = await confirmDialog(false);
        const events: string[] = [];
        element.addEventListener('hcm-cancel', () => events.push('cancel'));
        element.addEventListener('hcm-confirm', () => events.push('confirm'));

        element.open = true;
        await settle(element);
        element.shadowRoot?.querySelector<HTMLElement>('.cancel')?.click();
        element.open = false;
        await settle(element);
        element.open = true;
        await settle(element);
        await userEvent.keyboard('{Escape}');

        expect(events).toEqual(['cancel', 'cancel']);
    });
});

describe('<hcm-empty-state>', () => {
    beforeAll(() => {
        defineEditingElements();
    });

    it('happyPath_anIconASentenceAndTheAction', async () => {
        const element = await inBox<HcmEmptyState>(
            html`<hcm-empty-state icon="history" text="No changes yet."><button>Act</button></hcm-empty-state>`,
            400,
        );

        expect(element.shadowRoot?.querySelector('p')?.textContent).toBe('No changes yet.');
        expect(element.querySelector('button')?.textContent).toBe('Act');
        expect(await axeViolations(element)).toEqual([]);
        expect(EDITING_TAGS).toEqual(['hcm-list-detail', 'hcm-confirm-dialog', 'hcm-empty-state', 'hcm-overflow-menu']);
        document.body.replaceChildren();
    });

    it('happyPath_aHintSaysWhereTheItemsComeFrom', async () => {
        const element = await inBox<HcmEmptyState>(
            html`<hcm-empty-state icon="pending_actions" text="No jobs yet." hint="Jobs start with an import."></hcm-empty-state>`,
            400,
        );

        const lines = [...(element.shadowRoot?.querySelectorAll('p') ?? [])].map((line) => line.textContent);
        expect(lines).toEqual(['No jobs yet.', 'Jobs start with an import.']);
        expect(await axeViolations(element)).toEqual([]);
        document.body.replaceChildren();
    });
});

describe('FakeArea', () => {
    it('badPath_onlyIntentNamesAnswerSoLitAndAwaitSeeAPlainObject', async () => {
        const area = new FakeArea<{ readonly n: number }, { ping(): string }>({ n: 1 }, { ping: 'pong' });
        const probes = area.intents as unknown as Record<string | symbol, unknown>;

        expect([probes['then'], probes['_$litDirective$'], probes[Symbol.iterator]]).toEqual([undefined, undefined, undefined]);
        await expect(Promise.resolve(area.intents)).resolves.toBe(area.intents);
        expect(area.intents.ping()).toBe('pong');
    });
});

describe('<hcm-list-detail> on a landscape phone', () => {
    beforeAll(() => {
        defineEditingElements();
    });
    afterEach(() => {
        for (const host of hosts.splice(0)) {
            clearTheme(host);
        }
        document.body.replaceChildren();
    });

    it('badPath_aLandscapePhoneWideEnoughForTwoPanesKeepsOnePane', async () => {
        const chrome: PageChrome[] = [];
        const element = await inBox<HcmListDetail>(listDetail(false), 900, 400);
        element.addEventListener('hcm-chrome', (event) => chrome.push((event as CustomEvent<{ chrome: PageChrome }>).detail.chrome));

        element.detail = true;
        await settle(element);

        expect(element.split).toBe(false);
        expect([pane(element, 'list').hidden, pane(element, 'detail').hidden]).toEqual([true, false]);
        expect(chrome).toEqual(['editor']);
        expect(splitsAt({ widthClass: 'expanded', heightClass: 'medium' })).toBe(true);
        expect(splitsAt({ widthClass: 'expanded', heightClass: 'compact' })).toBe(false);
        expect(splitsAt({ widthClass: 'large', heightClass: 'compact' }, 'large')).toBe(true);
        expect(splitsAt({ widthClass: 'expanded', heightClass: 'medium' }, 'large')).toBe(false);
    });
});
