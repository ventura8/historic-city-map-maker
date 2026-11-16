import { expect, test } from '../support/test.js';
import { expectSiteJourneySound, SITE_STATES, type SiteStateId } from './site-states.js';
import { expectJourneySound, expectKitJourneySound, journey } from './states.js';

/**
 * The layout and accessibility tour (docs/research/design-review-testability.md §4.3; behaviours V14, V15 and V18; the
 * user's request of 2026-10-12): every screen and state of the viewer (e2e/tour/states.ts) on all 11 viewports, light
 * and dark, Romanian and English (44 projects: the nine of tier `tour` on every push, the other 35 of tier
 * `tour-matrix` in `all` and nightly, e2e/projects.ts). Each state runs the generic layout checker (occlusion, overlap,
 * edges, Mapbox's logo and attribution, text) and the generic accessibility checker (axe with best practices, target
 * sizes, one full Tab round, focus rings, non-text contrast in the page's scheme and in high contrast, landmarks,
 * announcements, text spacing, reflow at 320 px), then the i18n leak check, and Esc for a popup
 * (e2e/support/state-check.ts). The checks are soft: a failing run lists every violation of every state, each naming
 * its elements, with an outlined screenshot attached (e2e/support/report.ts). Every test carries the rows of the
 * checks every state passes (S-V15-HAPPY, S-V15-BAD-TEXT-SPACING, S-V15-BAD-REFLOW-320, S-V14-HAPPY-EVERY-STATE).
 */

test(
    'Home, the keyboard, the menu and its toasts',
    {
        tag: [
            '@S-V15-HAPPY',
            '@S-V15-BAD-TEXT-SPACING',
            '@S-V15-BAD-REFLOW-320',
            '@S-V14-HAPPY-EVERY-STATE',
            '@S-V18-HAPPY',
            '@S-V14-HAPPY-TOAST-ANNOUNCED',
        ],
    },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('home'));
    },
);

test(
    'A historical year, the timeline and the Layers panel',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE', '@S-V18-HAPPY-MODAL-STATES'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('year-layers'));
    },
);

test(
    'A photo at every height, shown on the map, its lightbox, and the photo list',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE', '@S-V18-HAPPY-MODAL-STATES'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('photo'));
    },
);

test(
    'A photo dated to the day, with its source',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V14-HAPPY-EVERY-STATE', '@S-V07-HAPPY-SOURCE-LINK'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('photo-source'));
    },
);

test(
    'A point of interest at every height, and About from top to end',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE', '@S-V18-HAPPY-MODAL-STATES'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('poi-about'));
    },
);

test(
    'Swipe compare: the divider at 50 % and at both edges, from the keyboard; the toggle of a compact window; the chooser',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('compare'));
    },
);

test(
    'The shortcuts, their help panel and a refused gamepad',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('input'));
    },
);

test(
    "The zoom buttons at the city's maximum and one level out",
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE', '@S-V52-HAPPY-TOUR'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('zoom'));
    },
);

test(
    'The year chip under a mouse and under a finger, in a city of many years',
    {
        tag: [
            '@S-V15-HAPPY',
            '@S-V15-BAD-TEXT-SPACING',
            '@S-V15-BAD-REFLOW-320',
            '@S-V14-HAPPY-EVERY-STATE',
            '@S-V04-HAPPY-YEAR-CHIP-TOUR',
        ],
    },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('timeline-chip'));
    },
);

test(
    'The opacity card of a year with several layers, and its bottom sheet on a narrow screen',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('timeline-opacity'));
    },
);

test(
    'The scroll hint of a timeline longer than its card, opened on the selected year',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE', '@S-V04-HAPPY-SCROLL-HINT'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('timeline-scroll'));
    },
);

test(
    'The compass on a turned map and north up again',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE', '@S-V64-HAPPY-TOUR'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('compass'));
    },
);

test(
    'A TV or a games console: the D-pad, the timeline and Layers at 1920 × 1080 with a coarse pointer',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE', '@S-V66-HAPPY-TOUR'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('tv'));
    },
);

test(
    "The timeline's pill on a phone and the menu of a year's dates",
    {
        tag: [
            '@S-V15-HAPPY',
            '@S-V15-BAD-TEXT-SPACING',
            '@S-V15-BAD-REFLOW-320',
            '@S-V14-HAPPY-EVERY-STATE',
            '@S-V67-HAPPY-TOUR',
            '@S-V68-HAPPY-TOUR',
        ],
    },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('timeline-dates'));
    },
);

test(
    "A photo's versions in its sheet and in the full-size view, zoomed in",
    {
        tag: [
            '@S-V15-HAPPY',
            '@S-V15-BAD-TEXT-SPACING',
            '@S-V15-BAD-REFLOW-320',
            '@S-V14-HAPPY-EVERY-STATE',
            '@S-V61-HAPPY-TOUR',
            '@S-V61-BAD-ZOOMED-TAB-ORDER',
        ],
    },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('photo-versions'));
    },
);

test(
    "The map's menu, open",
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE', '@S-V62-HAPPY-TOUR'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('map-menu'));
    },
);

test(
    'The FAB menu of a short landscape phone',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V14-HAPPY-EVERY-STATE', '@S-V15-BAD-SHORT-LANDSCAPE-MENU'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('short-landscape'));
    },
);

test(
    'The other theme chosen in Settings, the menu open',
    { tag: ['@S-V15-HAPPY', '@S-V14-HAPPY-EVERY-STATE', '@S-V12-HAPPY-ONLY-LIGHT'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('theme-menu'));
    },
);

test(
    "A city whose basemap is a custom style, without Standard's labels",
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('custom-basemap'));
    },
);

test(
    'Arabic, right to left: a photo, home and the language list',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE', '@S-V11-HAPPY-RTL-TOUR'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('rtl'));
    },
);

test(
    'Japanese: home and the Layers panel',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE', '@S-V11-HAPPY-CJK-TOUR'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('cjk'));
    },
);

test(
    'Disappeared streets: pinned in Layers, switched on, one street open',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V14-HAPPY-EVERY-STATE', '@S-V71-HAPPY-PINNED'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('lost-streets'));
    },
);

test(
    'Photos with no place yet, and the Contribute link',
    {
        tag: [
            '@S-V15-HAPPY',
            '@S-V15-BAD-TEXT-SPACING',
            '@S-V15-BAD-REFLOW-320',
            '@S-V14-HAPPY-EVERY-STATE',
            '@S-V40-HAPPY-GALLERY',
            '@S-V40-BAD-SUGGEST-SMALL-TARGET',
        ],
    },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('unplaced'));
    },
);

test(
    'Stories: the list and one story',
    {
        tag: [
            '@S-V15-HAPPY',
            '@S-V15-BAD-TEXT-SPACING',
            '@S-V15-BAD-REFLOW-320',
            '@S-V14-HAPPY-EVERY-STATE',
            '@S-V50-HAPPY-PHONE',
            '@S-V50-BAD-TEXT-SPACING-ALL-STORIES',
        ],
    },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('stories'));
    },
);

test(
    'Bucharest today: no layers yet and the consent banner',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('today'));
    },
);

test(
    'A toast',
    {
        tag: [
            '@S-V15-HAPPY',
            '@S-V15-BAD-TEXT-SPACING',
            '@S-V15-BAD-REFLOW-320',
            '@S-V14-HAPPY-EVERY-STATE',
            '@S-V14-HAPPY-TOAST-ANNOUNCED',
        ],
    },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('toast'));
    },
);

test(
    'A new version of the map is ready',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE', '@S-V72-HAPPY-SELF-UPDATE'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('update'));
    },
);

test(
    'Loading',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE'] },
    async ({ page, context, lang }) => {
        await expectJourneySound({ page, context, lang }, journey('loading'));
    },
);

for (const id of ['error-not-found', 'error-network', 'error-invalid', 'no-webgl']) {
    test(
        journey(id).title,
        { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE'] },
        async ({ page, context, lang, consoleErrors }) => {
            const errors = journey(id);
            await expectJourneySound({ page, context, lang }, errors);
            expect(
                consoleErrors.take().filter((error) => errors.consoleError?.test(error) !== true),
                'only the console errors the journey causes',
            ).toEqual([]);
        },
    );
}

test(
    'The starter kit with its engine refused: the bilingual note',
    { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE'] },
    async ({ page, consoleErrors }, testInfo) => {
        await expectKitJourneySound({ page }, testInfo);
        expect(
            consoleErrors.take().filter((error) => !error.includes('404')),
            'only the engine refused',
        ).toEqual([]);
    },
);

// M6 (docs/research/M6-interfaces.md §6.3): the Firebase Hosting site's own states (e2e/tour/site-states.ts).
for (const id of Object.keys(SITE_STATES) as SiteStateId[]) {
    test(
        SITE_STATES[id].title,
        { tag: ['@S-V15-HAPPY', '@S-V15-BAD-TEXT-SPACING', '@S-V15-BAD-REFLOW-320', '@S-V14-HAPPY-EVERY-STATE'] },
        async ({ page, context, lang, consoleErrors }) => {
            await expectSiteJourneySound({ page, context, lang }, id);
            expect(
                consoleErrors.take().filter((error) => !error.includes('404')),
                'only the not-found page’s own status',
            ).toEqual([]);
        },
    );
}
