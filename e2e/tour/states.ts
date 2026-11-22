import type { Locale, ViewerLocale } from '@hcm/shared';
import { expect, type BrowserContext, type Page, type Route } from '@playwright/test';

import { IMAGERY_STATES } from '../admin/specs/imagery/states.js';
import { ADMIN_SECTION_STATES } from './admin-sections.js';
import { COMPARE_STATES, openComparing } from './compare-states.js';
import { UNPLACED_JOURNEY, unplacedStates } from './unplaced-states.js';
import { STORY_JOURNEY, storyStates } from './story-states.js';
import { INPUT_JOURNEYS, INPUT_STATES } from './input-states.js';
import { CJK_JOURNEY, LANGUAGE_STATES, RTL_JOURNEY } from './language-states.js';
import { AERIAL_PHOTO_JOURNEY, AERIAL_PHOTO_STATES } from './aerial-photo-states.js';
import { LOST_STREETS_JOURNEY, LOST_STREETS_STATES } from './lost-streets-states.js';
import { WIKIPEDIA_JOURNEY, WIKIPEDIA_STATES } from './wikipedia-states.js';
import { MAP_LABEL_JOURNEY, MAP_LABEL_STATES } from './map-labels-states.js';
import { ERROR_STATES, expectErrorCard } from './error-states.js';
import { MY_LOCATION_STATES } from './my-location-states.js';
import { ZOOM_JOURNEY, ZOOM_STATES } from './zoom-states.js';
import { COMPASS_JOURNEY, COMPASS_STATES } from './compass-states.js';
import { TIMELINE_JOURNEY, TIMELINE_STATES } from './timeline-states.js';
import { TIMELINE_CHIP_JOURNEY, TIMELINE_CHIP_STATES, TIMELINE_SCROLL_JOURNEY } from './timeline-chip-states.js';
import { TIMELINE_OPACITY_JOURNEY, TIMELINE_OPACITY_STATES } from './timeline-opacity-states.js';
import { PHOTO_VERSION_JOURNEY, PHOTO_VERSION_STATES } from './photo-version-states.js';
import { MAP_MENU_JOURNEY, MAP_MENU_STATES } from './map-menu-states.js';
import { PHOTO_SOURCE_JOURNEY, PHOTO_SOURCE_STATES } from './photo-source-states.js';
import { SETTINGS_STATES, SHORT_LANDSCAPE_JOURNEY, THEME_MENU_JOURNEY } from './settings-states.js';
import { UPDATE_JOURNEY, UPDATE_STATES } from './update-states.js';
import { hasBottomSheets, scrollToEnd, toDetent } from './sheets.js';
import { notFound, withoutWebGl } from './faults.js';
import { OPS_STATES } from '../admin/specs/ops/states.js';
import { POIS_STATES } from '../admin/specs/pois/states.js';
import { SITE_ORIGIN } from '../fixtures/world.js';
import { siteManifestData } from '../fixtures/manifest.js';
import { settleAnimations } from '../support/layout.js';
import { recordLiveRegions } from '../support/live-regions.js';
import { mapIdle } from '../support/map.js';
import { sitePath } from '../support/site.js';
import { expectStateSound, type StateVisit } from '../support/state-check.js';
import {
    BUCHAREST_MANIFEST,
    callController,
    chooseMenuItem,
    holdToast,
    menuButton,
    openLayers,
    openPhotoOptions,
    openViewer,
    serveManifest,
    sheetsDock,
    t,
    viewer,
    waitForEngineEvent,
} from '../support/viewer.js';

/**
 * The state inventory of the layout and accessibility tour (the user's request of 2026-10-12: "we should have tests
 * for overlapping elements!!! also for accessibility!!"): every screen and state of the viewer, each with how the tour
 * reaches it, and every state of the admin with the spec that reaches it. Every visit runs the generic layout checker
 * and the generic accessibility checker (e2e/support/state-check.ts → `expectStateSound`) at the project's viewport,
 * scheme and language: the viewer's on all 11 viewports (e2e/tour/viewer.tour.ts, tiers `tour` and `tour-matrix`); the
 * admin editors' too, each journey in a city of its own (e2e/tour/admin-*.tour.ts, DECISIONS-for-review.md §34c); the
 * admin's singleton screens (Setup, Admins, Crash reports, Home, the sign-in, the claim, a revoked session), which
 * need the admin tier's lock, at its five projects (e2e/admin/specs/). A state that does not exist at a window size (a
 * bottom sheet's heights on anything but a phone held upright, the Layers item of a menu whose panel is always docked)
 * is left out there by `exists`, never skipped. The landscape variants are the `c915l` projects; swipe compare (V06,
 * M4) has its states in e2e/tour/compare-states.ts and its journey `compare` here.
 */

/** What a state's steps drive and read. */
export interface TourContext {
    readonly page: Page;
    readonly context: BrowserContext;
    readonly lang: Locale;
}

interface ViewerState {
    readonly id: string;
    /** What the visitor sees, for the inventory's table (docs/TESTING.md → *The tour's states*). */
    readonly title: string;
    /** Drives the page into the state from the journey's previous one. */
    readonly enter: (tour: TourContext) => Promise<void>;
    /** Whether the state exists at this window size (all by default). */
    readonly exists?: (page: Page) => boolean;
    /** What a live region announces on the way in. */
    readonly announcements?: (lang: Locale) => readonly string[];
    /** Esc closes the state's popup (the focus goes back to the control of this name); only where it is a popup. */
    readonly escape?: (tour: TourContext) => { readonly opener: string | null } | null;
    /** The language the page shows (a state may switch it, or open the viewer in a language of its own). */
    readonly shows?: (lang: Locale) => ViewerLocale;
}

/**
 * Sheets are modal below 760 px and on a phone held landscape (compact height: modal side sheets); wider they dock in a
 * pane (packages/ui/src/viewer/layout.ts, `sheetsDock`).
 */
function sheetsAreModal(page: Page): boolean {
    return !sheetsDock(page.viewportSize());
}

/** Esc closes a modal sheet; a docked pane is no popup. */
function sheetEscape(opener: (lang: Locale) => string | null): NonNullable<ViewerState['escape']> {
    return ({ page, lang }) => (sheetsAreModal(page) ? { opener: opener(lang) } : null);
}

const fromMenu = (lang: Locale): string => t(lang, 'action.menu');

/** The text of a catalogue entry up to the placeholder `varying` (an announcement whose number varies). */
function leadOf(lang: Locale, key: Parameters<typeof t>[1], params: Readonly<Record<string, string>>, varying: string): string {
    return t(lang, key, { ...params, [varying]: '\u0000' }).split('\u0000')[0] ?? '';
}

/** The photo the photo states open, and a view near it. */
const PHOTO = 'strandul-opereta-1976';
const PHOTO_TITLE = 'Ștrandul Operetă';
/** The fixture's point of interest. */
const POI = 'fixture-cladire';

/** Every state of the viewer the tour visits, by id. */
const VIEWER_STATES = {
    ...INPUT_STATES,
    ...MY_LOCATION_STATES,
    ...ZOOM_STATES,
    ...COMPASS_STATES,
    ...TIMELINE_STATES,
    ...TIMELINE_CHIP_STATES,
    ...TIMELINE_OPACITY_STATES,
    ...PHOTO_VERSION_STATES,
    ...MAP_MENU_STATES,
    ...SETTINGS_STATES,
    ...UPDATE_STATES,
    'skip-link': {
        title: 'The first Tab: the skip link shows over the map with a focus ring',
        enter: async ({ page, lang }) => {
            await page.keyboard.press('Tab');
            await expect(page.getByRole('button', { name: t(lang, 'viewer.skipToTimeline') })).toBeFocused();
        },
    },
    home: {
        title: 'Home: the map, the timeline, the menu button, the legal line',
        enter: async ({ page }) => {
            await page.evaluate(() => {
                (document.activeElement as HTMLElement | null)?.blur();
            });
        },
    },
    'menu-open': {
        title: 'The FAB menu open',
        enter: async ({ page, lang }) => {
            await menuButton(page, lang).click();
            await expect(page.getByRole('menu', { name: t(lang, 'action.menu') })).toBeVisible();
        },
        escape: ({ lang }) => ({ opener: t(lang, 'action.menu') }),
    },
    'share-toast': {
        title: 'Share: the "link copied" toast',
        enter: async ({ page, context, lang }) => {
            await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE_ORIGIN });
            await chooseMenuItem(page, lang, t(lang, 'action.share'));
            await holdToast(page, t(lang, 'share.copied'));
        },
        announcements: (lang) => [t(lang, 'share.copied')],
    },
    'locate-toast': {
        title: 'Show my location without permission: the "access refused" toast',
        enter: async ({ page, lang }) => {
            await chooseMenuItem(page, lang, t(lang, 'action.locate'));
            await holdToast(page, t(lang, 'error.geolocate.denied'));
        },
        announcements: (lang) => [t(lang, 'error.geolocate.denied')],
    },
    ...unplacedStates(sheetEscape),
    ...storyStates(sheetEscape),
    'near-year-photos': {
        title: 'The photos near the year, from the chip',
        enter: async ({ page, lang }) => {
            await page.getByRole('button', { name: t(lang, 'photos.nearYear', { year: '1966' }) }).click();
            await expect(viewer(page).locator('.photos-sheet hcm-photo-list').getByRole('status')).toBeVisible();
        },
        escape: sheetEscape((lang) => t(lang, 'photos.nearYear', { year: '1966' })),
    },
    layers: {
        title: 'The Layers panel (a bottom sheet at half height, a side sheet or a pane), no scrim: the map beside it stays usable',
        enter: async ({ page, lang }) => {
            await openLayers(page, lang);
            await mapIdle(page);
        },
    },
    'layers-opacity': {
        title: 'An overlay made more transparent by the keyboard: its new opacity is announced',
        enter: async ({ page, lang }) => {
            await openPhotoOptions(page, lang);
            const slider = page.getByRole('slider', { name: t(lang, 'layers.opacity', { name: t(lang, 'layers.photos') }), exact: true });
            await slider.focus();
            await slider.press('ArrowLeft');
        },
        announcements: (lang) => [leadOf(lang, 'layers.opacityChanged', { name: t(lang, 'layers.photos') }, 'percent')],
        // No escape check: the Layers sheet is a standard sheet, no popup (2026-11-15); its Esc is S-V15-HAPPY-IPHONE-LAYERS'.
    },
    'layers-peek': {
        title: 'The Layers sheet at its lowest height',
        enter: ({ page, lang }) => toDetent(page, lang, 'peek'),
        exists: hasBottomSheets,
    },
    'layers-full': {
        title: "The Layers sheet at full height, Mapbox's logo and credits in the strip of map above it",
        enter: ({ page, lang }) => toDetent(page, lang, 'full'),
        exists: hasBottomSheets,
    },
    photo: {
        title: "A photo's sheet",
        enter: async ({ page }) => {
            await expect(page.getByRole('heading', { name: PHOTO_TITLE })).toBeVisible();
        },
    },
    'photo-map-year': {
        title: "A photo's sheet after its chip of a near layer year: the map of 1980 behind it, the sheet still open",
        enter: async ({ page, lang }) => {
            await page.getByRole('button', { name: t(lang, 'photo.mapOf', { year: '1980' }), exact: true }).click();
            // The timeline may sit behind a modal sheet (inert): the hash says the map moved to 1980.
            await page.waitForFunction(() => location.hash.includes('layers=e2e-1980'));
            await page.getByRole('heading', { name: PHOTO_TITLE }).waitFor();
        },
    },
    'photo-peek': {
        title: "A photo's sheet at its lowest height",
        enter: ({ page, lang }) => toDetent(page, lang, 'peek'),
        exists: hasBottomSheets,
    },
    'photo-full': {
        title: "A photo's sheet at full height",
        enter: ({ page, lang }) => toDetent(page, lang, 'full'),
        exists: hasBottomSheets,
    },
    lightbox: {
        title: 'The lightbox over everything, the map and its credits included',
        enter: async ({ page, lang }) => {
            await page.getByRole('button', { name: t(lang, 'photo.openLightbox') }).click();
            await expect(page.getByRole('dialog', { name: t(lang, 'lightbox.label') })).toBeVisible();
        },
        escape: ({ lang }) => ({ opener: t(lang, 'photo.openLightbox') }),
    },
    'photo-list': {
        title: 'The list of every photo, from the menu',
        enter: async ({ page, lang }) => {
            await callController(page, 'openPhoto', null);
            await chooseMenuItem(page, lang, t(lang, 'photos.list'));
            await expect(viewer(page).locator('.photos-sheet hcm-photo-list').getByRole('status')).toBeVisible();
        },
        escape: sheetEscape(fromMenu),
    },
    'photo-from-list': {
        title: 'A photo opened from the list, with Back to the list (V75)',
        enter: async ({ page, lang }) => {
            // The list state's Esc check closed the list: it opens again from the menu.
            await chooseMenuItem(page, lang, t(lang, 'photos.list'));
            await viewer(page).locator('.photos-sheet hcm-photo-list').getByRole('button').first().click();
            await expect(page.getByRole('button', { name: t(lang, 'photo.backToList') })).toBeVisible();
        },
    },
    poi: {
        title: "A point of interest's sheet",
        enter: async ({ page, lang }) => {
            await callController(page, 'openPoi', POI);
            const name = lang === 'ro' ? 'Clădire demolată (fixture)' : 'Demolished building (fixture)';
            await expect(page.getByRole('heading', { name })).toBeVisible();
        },
    },
    'poi-peek': {
        title: "A point of interest's sheet at its lowest height",
        enter: ({ page, lang }) => toDetent(page, lang, 'peek'),
        exists: hasBottomSheets,
    },
    'poi-full': {
        title: "A point of interest's sheet at full height",
        enter: ({ page, lang }) => toDetent(page, lang, 'full'),
        exists: hasBottomSheets,
    },
    about: {
        title: 'About, at its top (full screen on a phone)',
        enter: async ({ page, lang }) => {
            await callController(page, 'openPoi', null);
            await chooseMenuItem(page, lang, t(lang, 'about.title'));
            await expect(page.getByRole('dialog', { name: t(lang, 'about.title') })).toBeVisible();
        },
    },
    'about-end': {
        title: 'About scrolled to its end: the accessibility statement, privacy and the map attribution',
        enter: async ({ page }) => {
            await scrollToEnd(viewer(page).locator('hcm-about-dialog'));
        },
        escape: ({ lang }) => ({ opener: t(lang, 'action.menu') }),
    },
    consent: {
        title: 'A city with analytics before the visitor answers: the consent banner (and no layers: the timeline note)',
        enter: async ({ page, lang }) => {
            await expect(page.getByRole('button', { name: t(lang, 'consent.accept'), exact: true })).toBeVisible();
            await expect(page.getByText(t(lang, 'timeline.empty'), { exact: true })).toBeVisible();
        },
    },
    toast: {
        title: 'A link to a photo that does not exist: the toast',
        enter: async ({ page, lang }) => {
            await holdToast(page, t(lang, 'error.unknownPhoto'));
        },
        announcements: (lang) => [t(lang, 'error.unknownPhoto')],
    },
    loading: {
        title: 'Loading: the skeleton while the manifest is on its way',
        enter: async ({ page, lang }) => {
            await expect(page.getByRole('status').filter({ hasText: t(lang, 'viewer.loading') })).toBeVisible();
        },
    },
    'error-invalid': {
        title: 'The error card: the manifest is invalid',
        enter: ({ page, lang }) => expectErrorCard(page, leadOf(lang, 'error.manifest.invalid', {}, 'count')),
    },
    // Swipe compare (M4, V06): the second map behind its divider, the toggle of a compact window, the chooser.
    ...COMPARE_STATES,
    ...MAP_LABEL_STATES,
    ...ERROR_STATES,
    ...LOST_STREETS_STATES,
    ...WIKIPEDIA_STATES,
    ...AERIAL_PHOTO_STATES,
    ...PHOTO_SOURCE_STATES,
    // The language list, Arabic right to left and Japanese (V11).
    ...LANGUAGE_STATES,
} as const satisfies Record<string, Omit<ViewerState, 'id'>>;

type ViewerStateId = keyof typeof VIEWER_STATES;

/** A state of the inventory with its id. */
function viewerState(id: ViewerStateId): ViewerState {
    return { id: `viewer.${id}`, ...(VIEWER_STATES[id] as Omit<ViewerState, 'id'>) };
}

/** What one tour test visits: how it boots, what it checks once booted, and its states in order. */
export interface Journey {
    /** The key of its scenario tags in e2e/tour/viewer.tour.ts (where the registry's gate reads them). */
    readonly id: string;
    readonly title: string;
    readonly boot: (tour: TourContext) => Promise<void>;
    /** Checks of the booted page beyond the states' (the landmarks, Mapbox's own controls). */
    readonly booted?: (tour: TourContext) => Promise<void>;
    readonly states: readonly ViewerStateId[];
}

/** One entry of an ARIA snapshot template, quoted as YAML (a name may hold `: `). */
function entry(role: string, name: string): string {
    return `- '${role} ${JSON.stringify(name).replaceAll("'", "''")}'`;
}

const CITY = (siteManifestData()['city'] as { name: Record<Locale, string> }).name;

/** The frame's landmarks and controls in order (a partial ARIA snapshot), with or without the timeline. */
async function expectFrame({ page, lang }: TourContext, withTimeline: boolean): Promise<void> {
    const entries = [
        entry('region', t(lang, 'viewer.mapLabel', { city: CITY[lang] })),
        ...(withTimeline ? [entry('slider', t(lang, 'timeline.label'))] : []),
        entry('button', t(lang, 'action.menu')),
    ];
    await expect(viewer(page)).toMatchAriaSnapshot(entries.join('\n'));
}

/** On the map itself, Mapbox's own logo and attribution (on a phone the collapsed attribution is its toggle button). */
async function expectMapboxControls({ page }: TourContext): Promise<void> {
    const compact = (page.viewportSize()?.width ?? 0) < 600;
    for (const selector of [
        '.mapboxgl-ctrl-bottom-left a.mapboxgl-ctrl-logo',
        compact ? '.mapboxgl-ctrl-attrib-button' : '.mapboxgl-ctrl-attrib-inner',
    ]) {
        await expect(viewer(page).locator(selector)).toBeVisible();
    }
}

/** Opens the viewer with its manifest request held until the test ends: the skeleton stays for the checks. */
async function openWithManifestHeld({ page, lang }: TourContext): Promise<void> {
    const held: Route[] = [];
    await page.route(BUCHAREST_MANIFEST, (route) => {
        held.push(route);
    });
    await page.goto(sitePath('bucharest', { lang }));
    await expect.poll(() => held.length).toBe(1);
}

/** The viewer's journeys: together they visit every state of `VIEWER_STATES`. */
const VIEWER_JOURNEYS: readonly Journey[] = [
    {
        title: 'Home, the keyboard, the menu and its toasts',
        id: 'home',
        boot: ({ page, lang }) => openViewer(page, { lang }),
        booted: async (tour) => {
            await expectFrame(tour, true);
            await expectMapboxControls(tour);
        },
        states: [
            'skip-link',
            'home',
            'menu-open',
            'share-toast',
            'locate-toast',
            'my-location',
            'settings',
            'settings-install',
            'language',
        ],
    },
    {
        title: 'A historical year, the timeline and the Layers panel',
        id: 'year-layers',
        boot: ({ page, lang }) => openViewer(page, { lang, hash: '15/44.42700/26.08530&layers=e2e-1966' }),
        states: [
            'year',
            'near-year-photos',
            'timeline-step',
            'layers',
            'layers-map-labels',
            'layers-peek',
            'layers-full',
            'layers-opacity',
            'layers-minimized',
        ],
    },
    MAP_LABEL_JOURNEY,
    LOST_STREETS_JOURNEY,
    WIKIPEDIA_JOURNEY,
    AERIAL_PHOTO_JOURNEY,
    PHOTO_SOURCE_JOURNEY,
    RTL_JOURNEY,
    CJK_JOURNEY,
    {
        title: 'A photo at every height, shown on the map, its lightbox, and the photo list',
        id: 'photo',
        boot: ({ page, lang }) => openViewer(page, { lang, hash: `18/44.42955/26.09560&photo=${PHOTO}` }),
        states: ['photo', 'photo-map-year', 'photo-located', 'photo-peek', 'photo-full', 'lightbox', 'photo-list', 'photo-from-list'],
    },
    {
        title: 'A point of interest at every height, and About from top to end',
        id: 'poi-about',
        boot: ({ page, lang }) => openViewer(page, { lang, hash: '16/44.42680/26.08720' }),
        states: ['poi', 'poi-peek', 'poi-full', 'about', 'about-end'],
    },
    ...INPUT_JOURNEYS,
    ZOOM_JOURNEY,
    COMPASS_JOURNEY,
    TIMELINE_JOURNEY,
    TIMELINE_CHIP_JOURNEY,
    TIMELINE_OPACITY_JOURNEY,
    TIMELINE_SCROLL_JOURNEY,
    PHOTO_VERSION_JOURNEY,
    MAP_MENU_JOURNEY,
    THEME_MENU_JOURNEY,
    SHORT_LANDSCAPE_JOURNEY,
    {
        title: 'Swipe compare: the divider at 50 % and at both edges, from the keyboard; the toggle of a compact window; the chooser',
        id: 'compare',
        boot: openComparing,
        states: ['compare-swipe', 'compare-toggle', 'compare-keyboard', 'compare-swipe-edge', 'compare-swipe-edge-end', 'compare-menu'],
    },
    {
        title: 'Bucharest today: no layers yet and the consent banner',
        id: 'today',
        boot: async ({ page, lang }) => {
            await serveManifest(page, siteManifestData({ layers: false, analytics: true }));
            await openViewer(page, { lang });
        },
        booted: (tour) => expectFrame(tour, false),
        states: ['consent'],
    },
    UNPLACED_JOURNEY,
    STORY_JOURNEY,
    {
        title: 'A toast',
        id: 'toast',
        boot: async ({ page, lang }) => {
            await page.goto(sitePath('bucharest', { lang, hash: '15/44.37000/25.97000&photo=no-such-photo' }));
            await waitForEngineEvent(page, 'hcm-ready');
        },
        states: ['toast'],
    },
    UPDATE_JOURNEY,
    { title: 'Loading', id: 'loading', boot: openWithManifestHeld, states: ['loading'] },
];

/** The error journeys: each boots the viewer into one error (the console errors they cause are claimed by the test). */
const ERROR_JOURNEYS: readonly (Journey & { readonly consoleError: RegExp })[] = [
    {
        title: 'The error card: manifest not found',
        id: 'error-not-found',
        consoleError: /404/,
        boot: async ({ page, lang }) => {
            await page.route(BUCHAREST_MANIFEST, notFound);
            await page.goto(sitePath('bucharest', { lang }));
        },
        states: ['error-not-found'],
    },
    {
        title: 'The error card: the network failed',
        id: 'error-network',
        consoleError: /ERR_FAILED|net::/,
        boot: async ({ page, lang }) => {
            await page.route(BUCHAREST_MANIFEST, (route) => route.abort('failed'));
            await page.goto(sitePath('bucharest', { lang }));
        },
        states: ['error-network'],
    },
    {
        title: 'The error card: an invalid manifest',
        id: 'error-invalid',
        consoleError: /manifest|invalid/i,
        boot: async ({ page, lang }) => {
            const broken = siteManifestData();
            (broken['city'] as Record<string, unknown>)['zoom'] = 99;
            await serveManifest(page, broken);
            await page.goto(sitePath('bucharest', { lang }));
        },
        states: ['error-invalid'],
    },
    {
        title: 'No WebGL: the photo list instead of the map',
        id: 'no-webgl',
        consoleError: /WebGL|webgl/,
        boot: async ({ page, context, lang }) => {
            await context.addInitScript(withoutWebGl);
            await page.goto(sitePath('bucharest', { lang }));
        },
        states: ['no-webgl'],
    },
];

/** Every journey, by id: together they visit every state of `VIEWER_STATES` (checked as this module loads, below). */
const JOURNEYS: ReadonlyMap<string, Journey & { readonly consoleError?: RegExp }> = new Map(
    [...VIEWER_JOURNEYS, ...ERROR_JOURNEYS].map((entry) => [entry.id, entry]),
);

/** The states of the inventory that no journey visits: a tour that loads with one fails before it starts. */
function unvisitedStates(): ViewerStateId[] {
    const visited = new Set([...JOURNEYS.values()].flatMap((entry) => entry.states));
    return (Object.keys(VIEWER_STATES) as ViewerStateId[]).filter((id) => !visited.has(id));
}

const UNVISITED = unvisitedStates();
if (UNVISITED.length > 0) {
    throw new Error(`the tour's journeys never visit ${UNVISITED.join(', ')} (e2e/tour/states.ts)`);
}

/** The journey `id` (a tour test names it; an unknown id is a mistake in the tour file). */
export function journey(id: string): Journey & { readonly consoleError?: RegExp } {
    const found = JOURNEYS.get(id);
    if (found === undefined) {
        throw new Error(`no tour journey ${id}`);
    }
    return found;
}

/**
 * Boots the journey and visits its states in order, each through `expectStateSound` (the states that do not exist at
 * this window size are passed over); the checks are soft, so every state is reported.
 */
export async function expectJourneySound(tour: TourContext, journey: Journey): Promise<void> {
    await tour.context.addInitScript(recordLiveRegions);
    await journey.boot(tour);
    await journey.booted?.(tour);
    for (const id of journey.states) {
        const state = viewerState(id);
        if (state.exists?.(tour.page) !== false) {
            // The last state's Esc may still be closing a sheet (its frame stays inert until it is gone).
            await settleAnimations(tour.page);
            await state.enter(tour);
            await expectStateSound(tour.page, visitOf(state, tour));
        }
    }
}

/** The visit of `state` as e2e/support/state-check.ts runs it, for the page as the journey left it. */
function visitOf(state: ViewerState, tour: TourContext): StateVisit {
    const escape = state.escape?.(tour) ?? undefined;
    return {
        id: state.id,
        title: state.title,
        lang: state.shows?.(tour.lang) ?? tour.lang,
        announcements: state.announcements?.(tour.lang) ?? [],
        ...(escape === undefined ? {} : { escape }),
    };
}

/** The photos section's visits (tour/admin-photos.tour.ts). */
const PHOTOS_TOUR = 'tour/admin-photos.tour.ts';

/** The admin's states: each is visited by the spec named, which calls `expectStateSound` with the id `admin.<key>`. */
const ADMIN_STATES = {
    'sign-in': { title: 'Signed out: the sign-in panel and its consent note (start-up mode)', visit: 'journey.spec.ts, step 1' },
    'billing-no-account': { title: 'Setup, billing: no billing account yet, with the deep link', visit: 'journey.spec.ts, step 2' },
    'provision-partial': { title: 'Setup, provisioning: the doctor with a failed item and Retry', visit: 'journey.spec.ts, step 3' },
    'deploy-waiting': {
        title: 'Setup, Install the server in start-up mode: the button, the cost, watching',
        visit: 'journey.spec.ts, step 4',
    },
    'mapbox-open': { title: 'Setup, Mapbox: the token box (normal mode, every destination)', visit: 'journey.spec.ts, step 4' },
    'mapbox-trial': { title: 'Setup, Mapbox: a demo account refused, with the alert', visit: 'journey.spec.ts, step 5' },
    // M28 (docs/research/M28-sources.md): the app's platform in one card, and the map's sources.
    'setup-platform': { title: "Setup, the app's platform: five sections with their state and steps", visit: 'journey.spec.ts, step 5b' },
    'setup-sources': { title: "Setup, the map's sources: switches, accounts and the month's estimate", visit: 'journey.spec.ts, step 5b' },
    'usgs-countdown': { title: 'Setup, USGS: the paste box and the 60 s countdown', visit: 'journey.spec.ts, step 10' },
    'usgs-pending': { title: "Setup, USGS: waiting for USGS's approval", visit: 'journey.spec.ts, step 10' },
    analytics: { title: 'Setup, analytics: detected, the stream setting and the crash reports', visit: 'journey.spec.ts, step 7' },
    'import-done': { title: 'Setup, the legacy import: done', visit: 'journey.spec.ts, step 8' },
    claim: { title: 'The claim panel: the map has no owner yet', visit: 'smoke.spec.ts, the owner' },
    'setup-billing': { title: 'Setup after the claim, open at billing (normal mode)', visit: 'smoke.spec.ts, the owner' },
    'account-menu': { title: 'The account menu (a dialog): language, theme, analytics, sign out', visit: 'smoke.spec.ts, the owner' },
    'account-menu-install': {
        title: "The account menu once the browser offers the install: App with Install app, and Device accent's note offering it",
        visit: 'shell/app.spec.ts, S-A185-HAPPY-INSTALLABLE',
    },
    'unknown-route': { title: 'An unknown address: Setup with the "page not found" snackbar', visit: 'smoke.spec.ts, the owner' },
    blocked: { title: 'A stranger: the "not an admin" panel', visit: 'smoke.spec.ts, the stranger' },
    'setup-self-test': {
        title: "Setup after Check again: the server's checks, a failing one with its reason and its step",
        visit: 'steps/status.spec.ts',
    },
    'mapbox-rotate-confirm': { title: 'Setup, Mapbox: "Replace the visitors\' token?" (a dialog)', visit: 'steps/mapbox.spec.ts' },
    // The M2c editors (docs/research/M2c-interfaces.md §11.2, §12.2): one marked section per area, ids '<area>.<state>';
    // a workstream appends inside its own section only and never moves the markers.
    // [section common] owner: ops-screens (the editing kit: the unsaved guard, the conflict banner, offline, the map's states)
    'session-revoked': {
        title: 'The access removed while editing: the page and its draft under the banner, with Sign out (§35e)',
        visit: 'specs/flows/revoke.spec.ts',
    },
    'page-failed': {
        title: 'A page whose chunk did not load: why, and Try again (DECISIONS-for-review.md §34b)',
        visit: 'tour/admin-jobs.tour.ts',
    },
    'editing.conflict': {
        title: 'A change saved meanwhile by another admin: the banner names them, when, and the fields (§42c)',
        visit: 'specs/pois/conflict.spec.ts',
    },
    // [end common]
    // [section photos] owner: photos
    'photos.empty': { title: 'Photos: none yet, with Add photos and the drop zone', visit: PHOTOS_TOUR },
    'photos.upload-refused': { title: 'Photos: a file refused before upload, with its reason', visit: PHOTOS_TOUR },
    'photos.list': {
        title: 'Photos: the list with its filters, search and rows (processing, refused, rights to check)',
        visit: PHOTOS_TOUR,
    },
    'photos.bulk': { title: 'Photos: four selected, the bulk actions', visit: PHOTOS_TOUR },
    'photos.bulk-more': { title: "Photos: the selection's other actions (a dialog)", visit: PHOTOS_TOUR },
    'photos.report': { title: 'Photos: the photos a bulk Publish skipped, each with its reason (a dialog)', visit: PHOTOS_TOUR },
    'photos.editor': { title: "Photos: a photo's editor (beside the list from 840 px, full screen on a phone)", visit: PHOTOS_TOUR },
    'photos.set-fields': { title: 'Photos: author, source and licence for the selection (a dialog)', visit: PHOTOS_TOUR },
    'photos.editor-invalid': { title: 'Photos: the editor with a field to correct, Save off and its reason', visit: PHOTOS_TOUR },
    'photos.editor-date': { title: 'Photos: a date to the day, Month and Day shown, and Source', visit: PHOTOS_TOUR },
    'photos.editor-impossible-date': { title: 'Photos: a day that month does not have, Save off', visit: PHOTOS_TOUR },
    'photos.delete-confirm': { title: 'Photos: the delete confirmation (a dialog)', visit: PHOTOS_TOUR },
    'photos.deleted-undo': { title: 'Photos: the photo deleted, the snackbar offering Undo', visit: PHOTOS_TOUR },
    // [end photos]
    // [section pois] owner: pois
    ...POIS_STATES,
    // [end pois]
    // [section layers] owner: layers-settings
    'layers.empty': { title: 'Layers: none yet, with Link a layer', visit: 'tour/admin-layers.tour.ts' },
    'layers.list': { title: 'Layers: the list, top first, with Move up/down', visit: 'tour/admin-layers.tour.ts' },
    'layers.link': { title: 'Layers: link an existing layer (a dialog)', visit: 'tour/admin-layers.tour.ts' },
    'layers.link-refused': { title: "Layers: another account's tileset refused", visit: 'tour/admin-layers.tour.ts' },
    'layers.editor': { title: "Layers: a layer's editor with its map", visit: 'tour/admin-layers.tour.ts' },
    'layers.adjusting': { title: 'Layers: image adjustments moved, levels met', visit: 'tour/admin-layers.tour.ts' },
    'layers.delete-confirm': { title: 'Layers: "Delete the layer?" (a dialog)', visit: 'tour/admin-layers.tour.ts' },
    // [end layers]
    // [section settings] owner: layers-settings
    'settings.sections': { title: 'Settings: the sections, none open', visit: 'tour/admin-settings.tour.ts' },
    'settings.area': { title: "Settings: the city's bounds and start view, the map with the bounds", visit: 'tour/admin-settings.tour.ts' },
    'settings.area-drawing': {
        title: 'Settings: the area drawn on the map, its first corner clicked',
        visit: 'tour/admin-settings.tour.ts',
    },
    'settings.area-invalid': { title: 'Settings: bounds of no width, Save off', visit: 'tour/admin-settings.tour.ts' },
    'settings.area-refused': { title: 'Settings: bounds refused, what they leave out', visit: 'tour/admin-settings.tour.ts' },
    'settings.texts-link-refused': { title: 'Settings: a non-https link in About', visit: 'tour/admin-settings.tour.ts' },
    'settings.theme': { title: 'Settings: seed colour, presets, basemap', visit: 'tour/admin-settings.tour.ts' },
    'settings.theme-preview': { title: 'Settings: a seed colour previewed', visit: 'tour/admin-settings.tour.ts' },
    'settings.categories': { title: 'Settings: the place categories', visit: 'tour/admin-settings.tour.ts' },
    'settings.category-editor': { title: 'Settings: a category, its icon not bundled', visit: 'tour/admin-settings.tour.ts' },
    'settings.category-low-contrast': { title: 'Settings: an unreadable colour, a tone offered', visit: 'tour/admin-settings.tour.ts' },
    'settings.category-delete-move': { title: 'Settings: delete a category in use (a dialog)', visit: 'tour/admin-settings.tour.ts' },
    'settings.categories-limit': { title: 'Settings: fifty categories, Add off', visit: 'tour/admin-settings.tour.ts' },
    'settings.overlays': { title: 'Settings: the default opacities', visit: 'tour/admin-settings.tour.ts' },
    // [end settings]
    // [section ops] owner: ops-screens (admins, history, jobs, crash reports)
    ...OPS_STATES,
    // [end ops]
    // M3 (docs/research/M3-interfaces.md §10.9, §12.2): the Imagery area, the georeferencer, the layer geometry tools and
    // the imagery settings, ids 'imagery.<state>', 'georef.<state>', 'layers.<state>', 'settings.<state>'; e2e-fakes
    // appends here as each state's journey lands.
    // [section imagery] owner: e2e-fakes (with admin-imagery's screens)
    ...IMAGERY_STATES,
    // [end imagery]
    // M4 and M5 (docs/research/M4-interfaces.md §7.3, docs/research/M5-interfaces.md §7.3): the sections of the M4 and M5
    // workstreams, each a spread from a file of its own, are in ./admin-sections.ts (this file was at its 600-line limit).
    ...ADMIN_SECTION_STATES,
} as const;

export type AdminStateId = keyof typeof ADMIN_STATES;

// M5 kit-cli (docs/research/M5-interfaces.md §7.3): the starter kit's template, ids 'kit.<state>' (`KIT_STATES` of
// ./kit-states.ts), with the journey that visits them over the page the site server serves at /kit/
// (e2e/tour/viewer.tour.ts runs it at every tour project).
// [section kit] owner: kit-cli
export { expectKitJourneySound } from './kit-states.js';
// [end kit]

/** The visit of an admin state, in the project's language. */
export function adminVisit(id: AdminStateId, lang: ViewerLocale, extra: Partial<StateVisit> = {}): StateVisit {
    return { id: `admin.${id}`, title: ADMIN_STATES[id].title, lang, ...extra };
}
