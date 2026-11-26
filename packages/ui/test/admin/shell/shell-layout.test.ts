// The admin shell's layout and landmarks as the tour's checkers judge them (docs/research/layout-a11y-findings.md):
// only `<main>` scrolls, so nothing is ever under the navigation bar or the top app bar; every screen's content is in a
// landmark; a rail label wraps inside the rail under a reader's text spacing (WCAG 1.4.12).
import { axeRuleViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { AdminAuthStatePort, AdminPageElement } from '../../../src/admin/admin-port.js';
import type { HcmAccountMenu } from '../../../src/admin/shell/hcm-account-menu.js';
import { deepActiveElement } from '../../../src/components/focus.js';
import type { HcmAdminNav } from '../../../src/admin/shell/hcm-admin-nav.js';
import type { HcmAdminShell } from '../../../src/admin/shell/hcm-admin-shell.js';
import { adminState, cleanup, deep, deepAll, defineAll, DESTINATIONS, FakeAdminApp, mount, updated } from './fake-app.js';

const TALL_PAGE_TAG = 'hcm-test-tall-page';

/** A page taller than any window, with a button at its end (the last control a Tab round reaches). */
class TallPage extends HTMLElement implements AdminPageElement {
    app: AdminPageElement['app'] = null;
    state: AdminPageElement['state'] = null;

    connectedCallback(): void {
        if (this.childElementCount > 0) {
            return;
        }
        const filler = this.ownerDocument.createElement('div');
        filler.style.blockSize = '3000px';
        const end = this.ownerDocument.createElement('button');
        end.textContent = 'The end';
        this.append(filler, end);
    }
}

function defineTallPage(): void {
    if (customElements.get(TALL_PAGE_TAG) === undefined) {
        customElements.define(TALL_PAGE_TAG, TallPage);
    }
}

async function shellWithTallPage(width: number, overrides: Parameters<typeof adminState>[0] = {}): Promise<HcmAdminShell> {
    const app = new FakeAdminApp(adminState({ destinations: DESTINATIONS, ...overrides }));
    app.pages = { setup: TALL_PAGE_TAG };
    const element = await mount<HcmAdminShell>(html`<hcm-admin-shell .app=${app}></hcm-admin-shell>`, width);
    await updated(element);
    return element;
}

function rect(element: Element): DOMRect {
    return element.getBoundingClientRect();
}

/** The deepest element under a point, through the open shadow roots (what a tap there reaches). */
function deepHit(x: number, y: number): Element | null {
    let hit = document.elementFromPoint(x, y);
    while (hit?.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(x, y);
        if (inner === null || inner === hit) {
            break;
        }
        hit = inner;
    }
    return hit;
}

/** The page-level landmark rules of axe (the tour runs them with its best practices) on the whole test document. */
function landmarkViolations(): Promise<string[]> {
    return axeRuleViolations(document, [
        'region',
        'landmark-one-main',
        'landmark-no-duplicate-main',
        'landmark-main-is-top-level',
        'landmark-no-duplicate-banner',
        'landmark-banner-is-top-level',
        'landmark-unique',
    ]);
}

describe('<hcm-admin-shell> layout', () => {
    beforeAll(() => {
        defineAll();
        defineTallPage();
    });
    afterEach(cleanup);

    /** Whether a tap at the centre of `element` reaches it or a part of it (nothing is drawn over it there). */
    function onTop(element: HTMLElement): boolean {
        const box = rect(element);
        let node: Node | null = deepHit(box.x + box.width / 2, box.y + box.height / 2);
        while (node !== null && node !== element) {
            node = node instanceof ShadowRoot ? node.host : node.parentNode;
        }
        return node === element;
    }

    it('happyPath_onACompactWindowOnlyThePageScrollsAndTheFocusedControlStaysAboveTheBar', async () => {
        const element = await shellWithTallPage(360);
        const scroller = deep(element, '.scroller');
        const nav = deep(element, 'hcm-admin-nav');
        const end = deep(element, `${TALL_PAGE_TAG} button`);

        end.focus();
        await updated(element);

        expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
        expect(getComputedStyle(scroller).overflowY).toBe('auto');
        expect(rect(deep(element, 'main')).bottom).toBeLessThanOrEqual(rect(nav).top + 0.5);
        expect(rect(end).bottom).toBeLessThanOrEqual(rect(nav).top + 0.5);
        expect(onTop(end)).toBe(true);
        expect(rect(deep(element, 'hcm-snackbar')).height).toBe(0);
    });

    it('badPath_aMessageTakesItsOwnPlaceSoTheFocusedControlIsNeverUnderTheSnackbar', async () => {
        const element = await shellWithTallPage(360, { notice: { id: 1, key: 'adminShell.route.notFound' } });
        const snackbar = deep(deep(element, 'hcm-snackbar'), '.snackbar');
        const end = deep(element, `${TALL_PAGE_TAG} button`);

        end.focus();
        await updated(element);

        expect(snackbar.textContent).toContain('That page does not exist');
        expect(rect(end).bottom).toBeLessThanOrEqual(rect(snackbar).top + 0.5);
        expect(rect(snackbar).bottom).toBeLessThanOrEqual(rect(deep(element, 'hcm-admin-nav')).top + 0.5);
        expect(onTop(end)).toBe(true);
        expect(onTop(deep(snackbar, 'hcm-icon-button'))).toBe(true);
    });

    it('happyPath_theTopBarAndTheRailStayWhereTheyAreWhileThePageScrolls', async () => {
        const element = await shellWithTallPage(700);
        const scroller = deep(element, '.scroller');
        const topBar = deep(element, '.top-bar');
        const rail = deep(element, 'hcm-admin-nav') as HcmAdminNav;
        const before = { bar: rect(topBar).top, rail: rect(rail).top };

        scroller.scrollTop = scroller.scrollHeight;
        await updated(element);

        expect(rail.variant).toBe('rail');
        expect(scroller.scrollTop).toBeGreaterThan(0);
        expect(rect(topBar).top).toBe(before.bar);
        expect(rect(rail).top).toBe(before.rail);
        expect(rect(rail).height).toBe(rect(deep(element, '.frame')).height);
        expect(rect(scroller).top).toBeGreaterThanOrEqual(rect(topBar).bottom - 0.5);
    });

    it('badPath_theMoreSheetOfTheBarCoversTheWholeFrameNotJustTheBar', async () => {
        const element = await shellWithTallPage(360);
        const nav = deep(element, 'hcm-admin-nav') as HcmAdminNav;

        deep(nav, 'button.item').click();
        await updated(element);

        const sheet = deep(nav, 'hcm-sheet');
        expect(nav.moreOpen).toBe(true);
        expect(rect(sheet).height).toBe(rect(deep(element, '.frame')).height);
    });

    it('happyPath_theStartUpBannerThePageAndTheSnackbarAreInMain', async () => {
        const element = await shellWithTallPage(1300, {
            auth: 'bootstrap',
            mode: 'bootstrap',
            notice: { id: 1, key: 'adminShell.route.notFound' },
        });
        await updated(element);

        const main = deep(element, 'main');
        expect(deepAll(element, 'main')).toHaveLength(1);
        const parts = ['.banner', '.scroller', 'hcm-page-outlet', 'hcm-snackbar'];
        expect(parts.filter((part) => deep(element, part).closest('main') !== main)).toEqual([]);
        expect(await landmarkViolations()).toEqual([]);
    });

    it('happyPath_theOpenAccountMenuAddsNoSecondBanner', async () => {
        const element = await shellWithTallPage(1300);

        deep(deep(element, 'hcm-account-menu'), 'hcm-icon-button').click();
        await updated(element);

        expect(deep(deep(element, 'hcm-account-menu'), 'hcm-dialog').hasAttribute('open')).toBe(true);
        expect(await landmarkViolations()).toEqual([]);
    });

    it.each([
        'signedOut',
        'claimPending',
        'joinPending',
        'notAdmin',
        'backendDown',
        'starting',
    ] as const satisfies readonly AdminAuthStatePort[])('badPath_theScreenOf_%s_isTheOneMainOfThePage', async (auth) => {
        const element = await shellWithTallPage(360, { auth, notice: { id: 2, key: 'adminShell.route.notFound' } });

        expect(deepAll(element, 'main')).toHaveLength(1);
        expect(deep(element, 'hcm-snackbar').closest('main')).toBe(deep(element, 'main'));
        expect(await landmarkViolations()).toEqual([]);
    });

    it('badPath_beforeTheAppAnswersTheLoadingIndicatorIsInMain', async () => {
        const element = await mount<HcmAdminShell>(html`<hcm-admin-shell></hcm-admin-shell>`, 360);
        await updated(element);

        expect(deep(element, '.loading').closest('main')).toBe(deep(element, 'main'));
        expect(await landmarkViolations()).toEqual([]);
    });
});

/** WCAG 1.4.12's spacings, as the tour sets them in every shadow root. */
const TEXT_SPACING = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }';

describe('<hcm-admin-nav> under text spacing', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aLongRomanianLabelWrapsInsideTheCollapsedRail', async () => {
        const nav = await mount<HcmAdminNav>(
            html`<hcm-admin-nav variant="rail" current="setup" locale="ro" .destinations=${DESTINATIONS}></hcm-admin-nav>`,
        );
        await document.fonts.ready;
        const spacing = new CSSStyleSheet();
        spacing.replaceSync(TEXT_SPACING);
        const root = deep(nav, 'nav').getRootNode() as ShadowRoot;
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, spacing];
        await updated(nav);

        const bounds = rect(deep(nav, 'nav'));
        const admins = deepAll(nav, 'a.item').find((item) => item.getAttribute('href') === '#/admins');
        expect(admins?.textContent).toContain('Administratori');
        const outside = deepAll(nav, 'a.item').filter(
            (item) => rect(item).left < bounds.left - 0.5 || rect(item).right > bounds.right + 0.5,
        );
        expect(outside.map((item) => item.textContent.trim())).toEqual([]);
    });

    it('badPath_aFocusedItemAsWideAsTheRailKeepsItsWholeRingInside', async () => {
        const nav = await mount<HcmAdminNav>(
            html`<hcm-admin-nav variant="rail" current="setup" locale="ro" .destinations=${DESTINATIONS}></hcm-admin-nav>`,
        );
        deep(nav, 'a.item').focus();
        await userEvent.keyboard('{Tab}');
        await updated(nav);

        const focused = (deep(nav, 'nav').getRootNode() as ShadowRoot).activeElement as HTMLElement;
        expect(focused.matches(':focus-visible')).toBe(true);
        expect(Number.parseFloat(getComputedStyle(focused).outlineOffset)).toBeLessThan(0);
    });
});

describe('<hcm-admin-shell>: a phone turned with the account menu open', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('badPath_rotatingAPhoneWithTheAccountMenuOpenGivesTheNewButtonTheFocus', async () => {
        // The hardening review's follow-up (S-A29-BAD-ROTATE-MENU-OPEN): the menu moves between the top bar and the rail.
        const element = await shellWithTallPage(360);
        const host = element.parentElement;
        if (host === null) {
            throw new Error('the shell has no box');
        }
        const turn = async (width: number, height: number | null): Promise<void> => {
            host.style.inlineSize = `${String(width)}px`;
            element.style.minBlockSize = height === null ? '' : '0';
            element.style.blockSize = height === null ? '' : `${String(height)}px`;
            await new Promise((resolve) => requestAnimationFrame(resolve));
            await updated(element);
            await (deep(element, 'hcm-account-menu') as HcmAccountMenu).updateComplete;
        };
        const menu = (): HcmAccountMenu => deep(element, 'hcm-account-menu') as HcmAccountMenu;
        /** The shadow root of the element whose icon button has the focus (the account menu's, when it is its button). */
        const focusedButton = (): Node | null => {
            const root = deepActiveElement()?.getRootNode();
            return root instanceof ShadowRoot && root.host.localName === 'hcm-icon-button' ? root.host.getRootNode() : null;
        };

        for (const [width, height, where] of [
            [800, 360, 'nav'],
            [360, null, 'header'],
        ] as const) {
            const before = menu();
            deep(before, 'hcm-icon-button').click();
            await updated(element);
            expect(before.active).toBe(true);
            await turn(width, height);

            expect(menu()).not.toBe(before);
            expect(menu().closest(where === 'nav' ? 'hcm-admin-nav' : 'header')).not.toBeNull();
            await expect.poll(() => focusedButton()).toBe(menu().shadowRoot);
            expect(menu().open).toBe(false);
        }
    });

    it('badPath_aPhoneHeldSidewaysWithoutTheTopBarKeepsThePagesTitleAsItsHeading', async () => {
        // S-A29-BAD-LANDSCAPE-PHONE: axe's page-has-heading-one at 915 × 412, where the top bar gives way to the rail.
        const element = await shellWithTallPage(800);
        element.style.minBlockSize = '0';
        element.style.blockSize = '360px';
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await updated(element);

        const headings = deepAll(element, 'h1');
        expect(deepAll(element, 'header.top-bar')).toEqual([]);
        expect(headings.map((heading) => [heading.className, heading.textContent.trim()])).toEqual([['visually-hidden', 'Setup']]);
        expect(headings[0]?.closest('main')).not.toBeNull();
    });

    it('happyPath_aRenderWhileTheMenuStaysPutMovesNoFocus', async () => {
        const element = await shellWithTallPage(1300);
        const menu = deep(element, 'hcm-account-menu') as HcmAccountMenu;
        const end = deep(element, 'hcm-test-tall-page button') as HTMLButtonElement;
        end.focus();

        element.requestUpdate();
        await updated(element);

        expect(menu.active).toBe(false);
        expect(deepActiveElement()).toBe(end);
    });
});
