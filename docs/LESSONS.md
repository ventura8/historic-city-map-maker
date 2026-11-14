# Lessons

The defects that shaped the rules of this repository: what went wrong, which tier or report found it, and the rule it left behind. Each lesson is also a rule in `AGENTS.md` or a skill; this file is the *why*. Keeping the stories here keeps `AGENTS.md` within its byte budget.

Tooling quirks that are not product defects (an image setting, a linter's behaviour) belong in `.agent/skills/quality/pipeline_skill.md` → *Local tooling quirks* instead.

## How to add a lesson

Append a numbered entry to *Lessons from this repository* in the task that finds the defect:

1. **One-line title of what the user saw.**
   - Seen: what happened, on which surface (viewer, admin, function, pipeline), viewport, browser or data.
   - Found by: the tier, analyser or crash report that caught it, and why every tier below it was green.
   - Fix and pin: the fix, and the scenario id in `e2e/scenarios.json` (or the unit test) that now pins it.
   - **The lesson, in bold, general enough to outlive the code.**

## Lessons from this repository

1. **A legacy photo would have shown its source link twice.**
   - Seen: in the first run of the legacy migration (M1), a photo whose `source` was only an anchor (`<a href=…>Flickr</a>`) got the description "Flickr" next to the Flickr link.
   - Found by: reading `seed/bucharest/manifest.static.json` after the run; every unit test passed because none had a source made only of a link.
   - Fix and pin: `legacyHtmlToText` reports `linkOnly`, and such a source adds its link but no text (`happyPath_sourceAnchorBecomesALink`, `happyPath_htmlBecomesTextAndLinks`).
   - **Review the real output of a data migration, not only its unit tests, and pin each surprise with a test.**
2. **A missing enum field would have been reported as "value not allowed" instead of "required".**
   - Seen: the Firestore photo schema test expected `validation.required` for a photo without `processing`, and got `validation.value`.
   - Found by: `packages/shared/test/schemas/firestore.test.ts`; zod 4 reports a missing enum or literal as `invalid_value`, not `invalid_type`.
   - Fix and pin: `validate` asks zod for the input (`reportInput: true`) and maps any issue whose input is `undefined` to `validation.required` (`badPath_a photo without processing state`, `happyPath_missingVersusWrongType`).
   - **Decide "missing" from the input the validator saw, not from the name of its error code.**
3. **Text with a lone `<` would have lost words in migrated descriptions.**
   - Seen: `a < b and 3 <> 4` came out as `a 4`: the HTML scanner accepted `< b` as a `<b>` tag.
   - Found by: `badPath_unterminatedMarkupIsText` in `packages/shared/test/migration/html.test.ts`.
   - Fix and pin: as in HTML, a tag name must follow `<` or `</` directly; anything else is text.
   - **A hand-written parser follows the format's own tokenizing rule, not a forgiving guess.**
4. **A slider, a progress bar and a colour swatch broke the city page's Content Security Policy.**
   - Seen: the built Bucharest site logged "Applying inline style violates the following Content Security Policy directive" six times at 1440 px and eighteen at 360 px (M1 integration).
   - Found by: the viewer smoke S-V16-HAPPY, whose console guard fails on any console error; every kit unit test passed, because Vitest's page has no CSP. Engine-ui had already met the same problem in its own elements and written `cssProperties`, but the kit's slider, progress and overlay swatch still used Lit's `styleMap`, whose first render writes a `style` attribute.
   - Fix and pin: the directive moved into the kit (`packages/ui/src/components/css-properties.ts`, now also removing a property that a later render drops) and replaced every `styleMap`; `S-V16-HAPPY` and the new row `S-V16-BAD-INLINE-STYLE`; an ESLint ban is proposed (`docs/research/DECISIONS-for-review.md` §15a).
   - **A fix found in one workstream is a rule for all of them: write it into the skill the same day, and test the built page under its real CSP.**
5. **The engine shipped without its fonts.**
   - Seen: three 404s for `engine/fonts/*.woff2` on the built site; the text fell back to system fonts and the icons, drawn from a ligature font, would have shown as words without the `block` display.
   - Found by: the viewer smoke's console guard; the kit's font test loads the files from `packages/ui/fonts/`, where they exist.
   - Fix and pin: `npm run build --workspace @hcm/engine` copies them to `dist/fonts/` (`fonts:copy`), and the site build copies all of `dist/` (S-V16-HAPPY, S-V12-BAD-FONTS-BLOCKED).
   - **A package that loads files at run time ships them in its own build output; test the built artefact, not the source tree.**
6. **Every point of interest was drawn as a plain white dot.**
   - Seen: in the M1 review screenshots, POI markers showed a dot instead of their category glyph.
   - Found by: looking at the screenshots; the unit tests used a fake font loader that accepted any family name, and the adapter asked for `Material Symbols Rounded` while the kit registers `HCM Material Symbols Rounded`.
   - Fix and pin: the sprite uses `ICON_FONT_FAMILY` of `@hcm/ui` (`packages/ui/src/map/icons.ts`); `happyPath_aPoiIconIsItsMaterialSymbolGlyph` pins the name.
   - **A name two packages must agree on is imported from its owner, never typed twice.**
7. **The open menu lay under the consent banner, and a modal sheet under the floating timeline.**
   - Seen: engine-ui's viewer with the real kit: the FAB menu's items were covered by the consent banner; the kit's modal sheet (z-index 2) slid under the timeline dock.
   - Found by: `packages/ui/test/viewer/kit-integration.test.ts` (the first) and temporary screenshots (the second); the viewer's unit tests use kit doubles, which have no stacking.
   - Fix and pin: the menu dock sits above the banner and the snackbar, the viewer sets `--hcm-sheet-z-index` above its floating controls (`packages/ui/src/viewer/viewer-styles.ts`).
   - **Stacking is a property of the assembled page: test the viewer with the real kit, not only with doubles.**
8. **A Romanian label wrapped on a wide screen and pushed the About dialog sideways on a phone.**
   - Seen: in the second M1 review capture, About's theme choice showed "Ca / sistemul" on two lines inside a 40 px segment at 1440 px, and at 360 px the three segments with icons were wider than the full-screen dialog, which scrolled sideways.
   - Found by: looking at the screenshots of all four viewports; the kit's unit tests used short labels ("Sistem", "Luminos") and the viewer's tests use kit doubles, which have no layout.
   - Fix and pin: `hcm-segmented-button` segments take their content width (`flex: 1 1 auto` instead of an equal share of 0), stay inside their container and wrap a long label in a taller segment; the full-screen About drops the theme icons. `happyPath_aWideContainerKeepsEveryLabelOnOneLine` and `badPath_aNarrowContainerWrapsALongLabelInsteadOfScrollingSideways` measure it (both fail on the old styles); planned row `S-V15-BAD-LONG-LABELS`.
   - **Test layout with the real catalogue's longest strings, not short sample labels: Romanian is the long language here.**
9. **Accepting analytics sent nothing: Performance Monitoring took GA4 down with it.**
   - Seen: after "Accept" the viewer loaded the Firebase SDK, initialised GA4, then logged `analytics failed to load … performance/FB not default`; no event ever reached GA4 (M1 e2e).
   - Found by: `S-V19-HAPPY` against the GA4 stand-in of the mock APIs (`e2e/mock-apis/gtag.ts`); the unit tests used a fake SDK, whose `initializePerformance` accepts any app, and the viewer named its Firebase app (`hcm-viewer`), which the real Performance Monitoring refuses.
   - Fix and pin: the viewer's app is the default Firebase app unless the page already has one (then Performance Monitoring stays off, with a log line), and a Performance Monitoring failure never stops analytics (`badPath_aPerformanceMonitoringFailureNeverStopsAnalytics`, `badPath_aPageWithItsOwnDefaultAppKeepsItAndRunsAnalyticsWithoutPerformance`, `S-V19-*`).
   - **Run a third-party SDK for real at least once, behind a mock of its network; a fake SDK only proves your own calls.**
10. **An invalid manifest said "there are problems" but not which.**
    - Seen: an unclosed POI ring, a crossed brightness range or a bad theme seed showed only "Datele hărții sunt nevalide (1 probleme)." (with a plural that is wrong for one).
    - Found by: `S-V24-BAD-INVALID-POI`, `S-V25-BAD-OUT-OF-RANGE` and `S-V12-BAD-INVALID-SEED`, whose rows ask for the issue path and its localized message; the first issue only reached the non-localized `hcm-error` detail.
    - Fix and pin: the error carries `issuePath` and `issueCode`, the card shows `path: message` in the visitor's language, and the count reads "probleme găsite: N" (`badPath_anInvalidManifestNamesItsFirstIssueInTheVisitorsLanguage`, `badPath_anInvalidManifestCountsItsIssuesAndNamesTheFirst`).
    - **An error a city owner must fix names the field and the rule, in the page's language.**
11. **`#…&opacity=` from an old link faded the hidden layers too.**
    - Seen: `#…&layers=e2e-1966&opacity=-2.5` rewrote the hash with `op=e2e-1966:0,e2e-1980:0`; the 1980 layer, not shown, came back at 0 % when chosen later.
    - Found by: `S-V05-BAD-HASH-OUT-OF-RANGE`; the overlay model's unit test asserted the old behaviour ("every raster"), against `docs/ENGINE_API.md` ("the visible historical layers").
    - Fix and pin: `withHashOpacity` applies `opacity` to the visible rasters only (`badPath_opacityLeavesHiddenRastersAtTheirOwnOpacity`).
    - **When the code, its test and the public contract disagree, the contract wins: write the test from the contract.**
12. **Closing a sheet opened from the menu left the focus nowhere.**
    - Seen: after Esc or a drag that closed the Layers sheet, the keyboard focus was on `<body>`, not on the menu button.
    - Found by: `S-V15-BAD-SHEET-DRAG-CLOSE` and `S-V14-HAPPY`; the viewer remembered the focused element when the store changed, which was the menu item that vanished with the menu a moment later.
    - Fix and pin: the FAB menu closes and focuses its button before it announces the choice (`badPath_theFabHasTheFocusWhenTheChoiceIsAnnounced`).
    - **Move the focus before you announce an action: whoever reacts records where it is.**
13. **A configuration error card mixed Romanian and English.**
    - Seen: `?lang=en` with an invalid `config.js` showed "config.js este nevalid: colour: The field is not known.".
    - Found by: `S-V17-BAD-INVALID-CONFIG` in the English project; the card took the element's language (none, so Romanian) and the detail the configuration's.
    - Fix and pin: a boot error card speaks the address's language first, then the configuration's (`badPath_theAddressLanguageWinsForAConfigurationErrorCard`).
    - **Resolve the language once, by the documented order, and use that one result for every text of a screen.**
14. **Every city page reported a CSP violation on load.**
    - Seen: a `securitypolicyviolation` for `script-src` from `engine.mjs` on every page view, with nothing in the console.
    - Found by: `S-V16-BAD-INLINE-STYLE`, which records violation events and not only console errors: zod 4 probes `Function('')` to compile faster parsers.
    - Fix and pin: `z.config({ jitless: true })` in `packages/shared/src/schemas/primitives.ts` (`badPath_schemasNeverProbeEvalUnderACsp`).
    - **Listen for CSP violation events in the e2e tier: a caught violation never reaches the console, but it still reaches a report endpoint.**
15. **The tour found six layout and contrast defects no other tier could see.**
    - Seen: the snackbar was drawn above the top edge of the map; the "photos near this year" chip covered the menu button at 320 px; on a 915 × 412 landscape phone the top menu items were off screen; the timeline thumb (40 px) and the opacity slider handles (4 px) were under the 48 px touch target, as were the links of a POI's link list; the lightbox title, position and arrows were unreadable on its dark scrim in the dark theme (and the arrows in the light one); Mapbox's own labels ("Map", "Toggle attribution", "Mapbox homepage") were English on Romanian pages.
    - Found by: `e2e/tour/viewer.tour.ts` (`S-V15-HAPPY`, `S-V18-HAPPY`) on 11 viewports × 2 themes × 2 languages; the kit and viewer unit tests run in one box without the page's real layout, theme and Mapbox controls.
    - Fix and pin: the toast flows in its top dock; the chip sits one row above the menu on compact; a short window's menu continues in a second column (`--hcm-fab-menu-max-block-size`); the thumb and handles have 48 px touch targets and list links are 48 px tall; the lightbox header and error sit on a surface and its arrows are tonal; Mapbox gets the viewer's translations (`map.title`, `map.toggleAttribution`, `map.logo`). Unit tests: `badPath_theToastAndTheShortWindowMenuStayInsideTheViewer`, `badPath_theThumbTouchTargetIsAtLeast48Pixels`, `badPath_theThinHandleStillHasA48PixelTouchTarget`, `happyPath_everyFloatingControlIsNamedForTheLayoutCheck`.
    - **Check the assembled page at every viewport, theme and language: layout, contrast and translation defects live between components.**
16. **A link opened right after a change lost its photo.**
    - Seen: switching to English and then opening `#…&photo=strandul-opereta-1976` in the same tab within 300 ms showed no photo: the hash write the language change had scheduled replaced the new address before its `hashchange` reached the store.
    - Found by: a run of `S-V11-HAPPY` on c360 dark (the test meant to reload and only changed the hash); every unit test wrote the hash with nobody else touching the address.
    - Fix and pin: the hash writer remembers the hash it last wrote or adopted and never overwrites one the address gained since (the `hashchange` wins and is adopted before it is applied): `badPath_aHashTheVisitorChangedMeanwhileIsNotOverwritten`, `happyPath_syncAdoptsTheAddressBeforeItIsApplied`.
    - **A debounced write to shared state must check that nobody else wrote in between.**
17. **The tour's invariants passed while a photo was cropped and a button jumped.**
    - Seen: on a 915 × 412 landscape phone the lightbox cropped the photo top and bottom, and the viewer showed through its 92 % scrim (the photo sheet's own copy of the photo, the menu button); opening the menu there moved its button about 300 px, from the leading edge to the middle, because the wrapped two-column menu lined up on the inline end; with no historical layers, the "layers are coming" note sat under the photos and places like a footnote; the boot skeleton's linear progress bar had no width of its own in its centred grid, so only a static shimmer showed; without WebGL the last photo of the list stayed under the menu button.
    - Found by: the UX review's screenshots of every screen at the 11 viewports (M1); the tour checks overlap, overflow, clipping of text and touch targets, none of which a cropped image, a translucent scrim or a moved control breaks.
    - Fix and pin: the lightbox stage's track is `minmax(0, 1fr)` and its scrim opaque (`happyPath_aLandscapePhotoOnAShortWindowIsFittedOnAnOpaqueScrim`, `S-V08-BAD-SHORT-WINDOW`); the FAB menu lines up on the side `--hcm-fab-menu-align` names, `flex-start` in the leading-edge dock (`badPath_aWrappedMenuAlignedToTheStartKeepsItsFabInPlace`, `badPath_theShortWindowMenuOpensWithoutMovingItsButton`, `S-V15-BAD-COMPACT-LANDSCAPE`); the note leads the layers panel (`badPath_noHistoricalLayersSaysTheyAreComing`); the skeleton shows the kit's loading indicator (`badPath_whileLoadingAVisibleIndicatorTurns`, `S-V01-BAD-SLOW-STORAGE`); the fallback list ends with room for the button (`badPath_withoutWebGlTheLastPhotoScrollsClearOfTheMenuButton`, `S-V02-BAD-NO-WEBGL`).
    - **Look at the screenshots too: automated layout invariants catch collisions, not a cropped photo or a control that moves under the finger.**
18. **A layer's attribution could have put a link on the map.**
    - Seen: a manifest attribution `<a href="https://…">USGS</a>` became a live link in the map's attribution, and `<b>` or `Arhiva <Națională>` lost their characters; the Layers panel (Lit) showed the same text literally.
    - Found by: the a11y and security review of M1, reading Mapbox GL 3.32's attribution control: it parses every source `attribution` as HTML, keeps `<a href>` (http, https, mailto) and writes the result with `innerHTML`. The schema allows any plain text there, and no unit or e2e test fed it markup.
    - Fix and pin: the engine escapes `&`, `<` and `>` before handing the attribution to Mapbox (`attributionText` in `packages/ui/src/map/rasters.ts`; `badPath_markupInTheAttributionReachesMapboxAsEscapedText`, `S-V03-BAD-ATTRIBUTION-MARKUP-IS-TEXT`).
    - **A third-party API that takes "text" may render HTML: read what it does with the string before passing data to it.**
19. **Keyboard users lost the lightbox at its last photo, and Shift+Tab left the modals.**
    - Seen: pressing the lightbox's Next button (Enter) onto the last photo disabled it while it had the focus; Chromium moved the focus to `<body>`, so Esc and the arrow keys stopped working. Shift+Tab right after a modal sheet or the lightbox opened (they focus their container) left the modal for the page behind it, and the lightbox did not trap Tab at all.
    - Found by: the a11y and security review of M1; the e2e drove the arrows with the arrow keys (the focus stays on the dialog) and opened the sheets with Tab already inside them.
    - Fix and pin: the arrow about to be disabled hands the focus to the dialog first; the lightbox traps Tab; `trapTab` treats a focused container as the start of the trap (`badPath_theArrowThatGetsDisabledHandsTheFocusToTheDialog`, `badPath_shiftTabOnTheFocusedContainerWrapsToTheLastInsteadOfLeaving`, `S-V08-BAD-FOCUS-AT-LAST-PHOTO`, `S-V14-BAD-MODAL-TAB-WRAP`).
    - **Never disable or remove the control that has the focus without moving the focus first; test modals from the focus they really open with.**
20. **Toasts were shown but not announced.**
    - Seen: the snackbar's polite live region was created together with its text, one snackbar per toast, so screen readers had no change to announce ("Link copied", "Location unavailable", a tile outage); its announcement also included the Close button.
    - Found by: the a11y and security review of M1; the unit test checked the region in isolation, where the message arrives after the region exists.
    - Fix and pin: the snackbar's visually hidden live region is in the page empty and gets the message alone `ANNOUNCE_DELAY_MS` later (`happyPath_showsTheMessageInAPoliteLiveRegion`, `badPath_aSnackbarClosedBeforeItsAnnouncementIsNotAnnounced`; `S-V14-HAPPY-TOAST-ANNOUNCED` is planned). The tour's clipped-text check skips screen-reader-only text.
    - **A live region must exist, empty, before the text it announces: test the region as the app creates it, not as a component test mounts it.**
21. **Points of interest stayed plain discs until the visitor moved the map.**
    - Seen: in the M1 final-gate screenshots (1280 × 800, dark, no historical layers) two POIs showed their category disc without a glyph; the same screen in the other captures had them.
    - Found by: looking at the 216 final screenshots; the e2e and unit tiers were green, because the icon font always arrived before the map settled there, and `FakeMapboxMap.updateImage` stands for a map that redraws by itself. Mapbox GL 3.32's `updateImage` only swaps the image's pixels: an idle map draws them at its next frame, which nothing asks for.
    - Fix and pin: `ensureIcon` (`packages/ui/src/map/icons.ts`) calls `triggerRepaint()` after `updateImage` (`badPath_aDrawingThatLandsOnAnIdleMapAsksForAFrame`); `S-V24-BAD-ICON-FONT-LATE` holds the icon font until the map is idle, then sees the glyph appear without any interaction (it failed on the old build in two projects).
    - **A third-party update that arrives after the view settled must ask for a frame: test it by delaying the input until the view is idle, not only by running fast.**
22. **The second photo of a point of interest sat 4 px lower than the first.**
    - Seen: in the final screenshots at every viewport, the POI sheet's photo thumbnails did not share one top edge.
    - Found by: the screenshots; the thumbnails are a grid with an 8 px `gap`, and the shared `detailStyles` also gave every `li + li` of a detail sheet a 4 px top margin, which a grid adds on top of the gap. The POI detail's unit tests used kit doubles and checked the thumbnails' count, not their layout.
    - Fix and pin: `.details .thumbs li + li` resets the margin (`packages/ui/src/viewer/hcm-poi-detail.ts`; `badPath_photoThumbnailsShareOneTopEdgeInsteadOfTakingTheListGap`, which failed with 262 against 258 px).
    - **A shared spacing rule written for a stacked list does not belong in a grid: scope it, and measure edges where items must line up.**
23. **Opening a sheet, the lightbox or About covered the Mapbox logo and attribution.**
    - Seen: on phones the Layers, photo and POI bottom sheets, on medium screens the side sheets, and everywhere the lightbox and About lay over Mapbox's own logo and attribution in the map's bottom corners, which Mapbox's terms require to stay visible (`docs/research/design-review-security-cost.md` §5).
    - Found by: the M1 UX review's screenshots (`docs/research/M0-handoff.md` §10m); the tour checked the logo and the attribution on the home screen only, and its overlap check never looked under a modal surface. Building the fix, the unit harness found that a page's own `display` on `<hcm-map-viewer>` beats the element's `:host` rule, so a layout grid on the host fell apart.
    - Fix and pin: while a modal surface covers the map the viewer hides Mapbox's bottom controls and mirrors the logo and the attribution it reads from Mapbox's control (`attribution.ts`, `hcm-map-attribution.ts`, `viewer-legal.ts` in `packages/ui/src/viewer/`): in a legal bar, the last row of an inner grid (`.viewer`, not the host) below the modal layer, so sheets, scrims and the lightbox end above it; at the foot of About, which is in the top layer. The tour now checks every state: one visible logo and one attribution, nothing on top of them, and overlaps among the controls a visitor can use (`badPath_nothingCoversTheMapSoNoMirror`, `happyPath_aModalSheetEndsAboveTheLegalBarWhichMirrorsTheMapsAttribution`, `S-V18-HAPPY-MODAL-STATES`, `S-V18-BAD-FULL-SHEET`).
    - **A legal or safety control must be checked in every state, not on the home screen; and never put a layout on `:host` that a page's style on the element can undo.**
24. **After "My location", Performance Monitoring could send the visitor's position to Google.**
    - Seen: after consent, every Performance Monitoring batch carried `location.href` up to the first `?`, that is the viewer's whole hash, which holds the map view and, after *My location*, the visitor's position (`docs/research/DECISIONS-for-review.md` §18a); the SDK has no setting to leave the hash out.
    - Found by: the a11y and security review of M1, reading the Performance Monitoring module of the Firebase SDK; the GA4 stand-in of the e2e only echoed the page location the viewer configured, so a viewer that stopped setting it would still have passed.
    - Fix and pin: the public viewer loads only firebase/app and firebase/analytics on its own named app; GA4 gets `page_location` and `page_path` without the hash on its configuration and `page_location` on every event, with Google signals and ad personalisation off (`happyPath_consentLoadsTheSdkOnceInConsentModeAndSendsEventsWithoutTheHash`, `happyPath_theFirebaseChunkHasOnlyAppAndAnalytics`). The stand-in now falls back to `location.href` like gtag.js (`S-V19-BAD-HASH-NEVER-SENT`).
    - **A stand-in for a third-party script must fail the way the real one does when the app forgets a setting, or the test proves nothing.**
25. **Withdrawing consent left GA4's cookies in the browser.**
    - Seen: after *Accept*, gtag.js wrote `_ga` and `_ga_<container>` for two years; withdrawing in About switched collection off but kept them, while the privacy notice promises no cookies without consent (§18c).
    - Found by: the a11y and security review of M1; nothing in the e2e world wrote a cookie.
    - Fix and pin: a withdrawal (granted, then denied) expires every `_ga` and `_ga_*` cookie host-only, for each parent domain and every path prefix of the page, at once and again after the SDK stopped; GA4 starts with the consent as it is when its chunk arrives, so a withdrawal during the load never grants it; a first *Decline* touches no cookie, since an embedding page may run its own GA4 (`packages/engine/src/telemetry/cookies.ts`; `happyPath_everyGa4CookieIsExpiredHostOnlyForEachParentDomainAndEveryPathOfThePage`, `badPath_anEventQueuedBeforeAWithdrawalIsDroppedAndGa4NeverStartsGranted`, `S-V19-HAPPY-COOKIES-EXPIRED`, `S-V19-BAD-DECLINE-KEEPS-PAGE-COOKIES`).
    - **Turning collection off is not removing what was collected: a withdrawal undoes what consent allowed.**
26. **The error card spoke to developers and shouted its Retry.**
    - Seen: a visitor read "Harta nu a fost găsită: manifestul lipsește." or "WebGL indisponibil", and a filled primary Retry dominated the card.
    - Found by: the M1 UX review; the unit and e2e tests compared the card with the catalogue, whatever the catalogue said.
    - Fix and pin: visitor errors in plain Romanian and English (keys unchanged; `error.config.*` still speak to the city owner), Retry is a filled tonal button with the refresh icon on the error container (`badPath_noVisitorErrorSpeaksJargonInEitherLanguage`, `happyPath_anM3ErrorContainerWithAFilledTonalRetry`, `S-V01-HAPPY-ERROR-CARD`, `S-V01-BAD-PLAIN-WORDS`).
    - **A test that only compares the screen with the catalogue cannot catch bad copy: give visitor texts their own check.**
27. **On extra-large screens the focused skip link covered the Layers heading.**
    - Seen: at 1600 px and wider the first Tab showed "Sari la cronologie" at the viewer's top-left corner, over the heading of the docked Layers pane.
    - Found by: the M1 UX review; the skip-link test looked at the focus order, not at what the focused link covers, and only the tour's home state (no pane open) was measured.
    - Fix and pin: with a docked leading pane the link starts at the map pane (`happyPath_onExtraLargeItShowsOverTheMapNotOverTheLayersHeading`, `S-V14-HAPPY-SKIP-LINK-CLEAR`, `S-V14-BAD-SKIP-LINK-THREE-PANES`).
    - **A control that appears only on focus needs its own layout check while focused.**
28. **The photo list's dates were too small to read on a phone.**
    - Seen: the date under each photo title was body-small (12 px).
    - Found by: the M1 UX review; no test looked at type sizes.
    - Fix and pin: M3 list typography, the title body-large and the date body-medium (14 px) supporting text that wraps (`happyPath_theDateIsBodyMediumSupportingTextUnderABodyLargeTitle`, `S-V07-HAPPY-LIST-DATES`, `S-V07-BAD-LIST-NO-DATE`).
    - **Supporting text a visitor must read is body-medium at least.**
29. **Every photo an admin saved with all its fields was refused.**
    - Seen: the first M2 rules denied every photo create that filled every field, although each check passed on its own.
    - Found by: the rules tests (`firebase/rules-tests/test/photos.test.ts`); the emulator's `firestore-debug.log` named the cause: Firestore denies a request whose rules evaluate more than 1000 expressions, and every reference to a function argument evaluates the argument again, so a check costs about ten.
    - Fix and pin: cheap checks (a text is one bounded pattern such as `[\s\S]{1,200}`, an optional field is checked against a neutral default, the whole document once per write); the heaviest legitimate writes, a photo with every field and five links and every editable field of a city at once, stay near 650 of 1000 (`firebase/rules-tests/test/limits.test.ts` fails when one goes over).
    - **A rules file has a cost budget like a bundle: test the heaviest legitimate write against it, not only each rule.**
30. **The edit history could not be listed newest first.**
    - Seen: the contract listed a document's history by id, descending; the Firestore emulator refuses it (`FAILED_PRECONDITION: Firestore does not support descending key scans`), so the query could never be tested and the admin's panel would have failed under the emulators.
    - Found by: the documents adapter test on the emulator (`functions/test/adapters/documents.test.ts`); the in-memory fake answered the query happily.
    - Fix and pin: history is listed by `updatedAt` descending; the revert's echo is skipped by matching any listed `revert` entry with the same time stamp; the fake document store refuses `__name__` descending as the emulator does (CR-M2-9).
    - **A fake must refuse what the real service refuses, or it certifies queries production cannot run.**
31. **A crash report from the city site lost its line number.**
    - Seen: `redactText` removes a URL's query, and with it the `:line:col` that follows a script URL in a stack frame, so Cloud Error Reporting could not tell crashes in the same file apart.
    - Found by: the endpoint's event tests (`functions/test/telemetry/error-event.test.ts`).
    - Fix and pin: the report location is parsed from the frame before the text is redacted; the redacted stack is what is stored.
    - **Extract the structure you need before you scrub a text; scrubbing first destroys more than the secret.**
32. **HEIC photos could not be converted on the server as planned.**
    - Seen: the security review assumed sharp converts HEIC; its prebuilt libvips decodes AVIF only (`sharp.format.heif.input.fileSuffix` is `['.avif']`), so an iPhone photo would have failed as "unreadable".
    - Found by: fn-content's upload tests on real sharp with generated images (`functions/test/photos/upload.test.ts`).
    - Fix and pin: `photos.onUpload` recognises HEIC and HEIF by their magic numbers and fails the photo with `apiError.photo.heicUnsupported`, which tells the admin how to export a JPEG (`S-A08-BAD-HEIC`; `docs/research/DECISIONS-for-review.md` §20b).
    - **Check a codec claim against the binary you ship, not against the library's feature list.**
33. **A pending USGS approval would have turned into "USGS is not responding" overnight.**
    - Seen: `setup.saveUsgs` read a login refused with `AUTH_UNAUTHORIZED` (no M2M access yet) as `pending`, while `ops.tick`'s health check, a second implementation of the same record, fell back to `unavailable` with `apiError.usgs.unavailable`.
    - Found by: the integration review that wired both into one deploy; each family's tests were green against its own reading.
    - Fix and pin: both map it to `pending` with the new reason `apiError.usgs.accessPending` and check again six hours later (`badPath_aLoginRefusedForMissingM2mAccessStaysPending` in `functions/test/ops/services.test.ts`, `badPath_anAccountWithoutM2mAccessIsPendingToo` in `functions/test/setup/save-usgs.test.ts`, `S-A03-BAD-USGS-STILL-PENDING`).
    - **Two writers of one record need one table of what each upstream answer means, or a test that runs both.**
34. **The deploy artifact would have crashed at its first cold start.**
    - Seen: `functions/build.mjs` bundled the workspace packages but left their own npm dependencies external, so `functions/dist/index.js` imported `zod`, which `functions/dist/package.json` does not install.
    - Found by: the integrator, checking the bare imports of the built bundle against its manifest; every test ran from source, where the workspace's `node_modules` has zod.
    - Fix and pin: the build bundles everything except the functions' own pinned dependencies, then fails when a bare import is neither a Node built-in nor pinned, and loads the bundle to check every export's deploy manifest; the Functions emulator loads the same `functions/dist/` with all 32 functions.
    - **Test the artifact you deploy, not only the source it was built from.**
35. **The legacy import would have dropped Ferdinand without a word.**
    - Seen: the first end-to-end import (M2b) reported "All 45 photos are on the map." with 44 photo documents: the old site gave Bateriilor and Ferdinand the same id, and the import's "already imported under another id" check by `legacyId` counted Ferdinand as done.
    - Found by: the e2e journey counting the photo documents in the emulator; the import's unit tests used unique ids.
    - Fix and pin: a `legacyId` that more than one bundled record carries identifies nothing; those records match by document id only (`badPath_twoRecordsSharingALegacyIdAreBothImported`, `S-A28-HAPPY`).
    - **Never assume the legacy data's ids are unique: count what a migration wrote, not what it reported.**
36. **A quick click on the billing card asked Google for the wrong permission.**
    - Seen: in start-up mode the billing button was clickable while the card was still asking Service Usage whether the billing APIs were on; a click in that window asked Google for `cloud-billing`, and the step then tried to enable the APIs with a token that cannot.
    - Found by: the e2e journey, whose click came faster than a human's; the flow's unit tests awaited the detection first.
    - Fix and pin: the card is busy (its button disabled) while the detection runs (`happyPath_enabledApisKeepTheBillingScope`).
    - **A button whose meaning depends on a detection waits for that detection.**
37. **The open card jumped to another step while the admin was reading it.**
    - Seen: after a reload, the admin opened the analytics card; seconds later the page switched to the legacy import, because the Setup Assistant's start opened "the first incomplete step" once its slow checks (the import's detection reads 45 documents) finished.
    - Found by: the e2e journey, which opened the card before the checks ended.
    - Fix and pin: the start opens a step only when the admin has not opened one meanwhile (`badPath_aCardOpenedWhileTheFirstChecksRunStaysOpen`).
    - **An automatic navigation that ends after an await must not override what the user chose during it.**
38. **The analytics card hid the Google permission note before its last Google window.**
    - Seen: once the measurement id was found the card turned green and the note disappeared, but the GA4 stream setting still opened Google's window.
    - Found by: the e2e journey's check of the note before every popup (`S-A27-HAPPY-UNVERIFIED-NOTICE`).
    - Fix and pin: the note follows the card's next popup (`scope`), not the card's state; sign-in and the claim, whose popups belong to the shell's panels, name no scope (`happyPath_aDoneStepWhoseNextActionAsksGoogleKeepsItsNote`).
    - **Show a consent explanation next to every action that opens a consent, whatever the step's status.**
39. **The USGS username disappeared when the window changed size.**
    - Seen: a capture at another window size re-created the USGS card (one column versus list and detail), and the pasted token was refused with "Fill in the username first."; a rotated tablet would do the same.
    - Found by: the review-screenshot run of the e2e journey.
    - Fix and pin: the username and the expiry date live in the Setup Assistant's state (`draftUsgs`), never the token (`happyPath_theTypedFieldsSurviveTheCardBeingMadeAgain`).
    - **Form state that must survive a layout change lives in the state, not in the element.**
40. **A saved USGS token was "missing" a second later in the e2e world.**
    - Seen: `setup.saveUsgs` stored the token, then `setup.selfTest` found no secret: the Functions emulator runs every function in its own worker process, and the emulator's in-memory secret store is per process.
    - Found by: the e2e journey; every functions test ran one handler in one process.
    - Fix and pin: in the emulator with fakes the secrets live in the fake Secret Manager of the mock APIs (`happyPath_theEmulatorWithTheFakesKeepsSecretsInTheFakeSecretManager`).
    - **State the deployed system keeps in a shared service must not live in process memory in its local stand-in.**
41. **The emulator never rebuilt the manifest after the import.**
    - Seen: the manifest stayed at the version built before the 45 photos: the Cloud Tasks emulator dispatches a task at once, whatever its delay, and keeps refusing its id, so every later request of the same one-minute window was dropped.
    - Found by: the e2e journey polling `manifests/bucharest` for 45 photos.
    - Fix and pin: in the Functions emulator manifest tasks carry no id, so each request is a build of its own (`happyPath_unnamedTasksDropTheirIdButKeepTheDelay`); deployed, the named window stays.
    - **When an emulator ignores a timing guarantee a design relies on, adapt the composition for the emulator, not the design.**
42. **The admin's harness page could not reach the emulators.**
    - Seen: a page answered by a Playwright route has no address space, so Chromium's Local Network Access refused its requests to the loopback emulators.
    - Found by: the first admin harness specs (M2b).
    - Fix and pin: the harness page is served by the e2e admin server on the admin's own origin (`/__harness`, `S-A00-HAPPY-SIGNED-IN-PERSONA`).
    - **Serve a test page from the origin whose network rights it needs.**
43. **A fake made a phantom project of the real one.**
    - Seen: the fake Resource Manager knew a project first named by its number as a different project, so Service Usage refused billed APIs on a project whose billing was linked.
    - Found by: the provisioner's tests against the fakes (M2b).
    - Fix and pin: `demo-hcm` is known by id and number from the start (`packages/test-support/src/fakes/project.ts`).
    - **A fake keyed by two identifiers must make them one record.**
44. **Polling a long-running operation created the service account twice.**
    - Seen: the transport resent the start call's method, query and body to the operation's URL, so IAM's create was POSTed again.
    - Found by: the provisioner's write counts ("a second run writes nothing").
    - Fix and pin: an operation is polled with a bare GET of its name (`packages/admin/test/google/transport.test.ts`).
    - **Poll an operation by its name only; never replay the call that started it.**
45. **The Setup page logged "ResizeObserver loop completed with undelivered notifications".**
    - Seen: the page measured its own window class and changed its layout from the observer's callback, which resized the element it observed.
    - Found by: the console guard of the setup page's browser tests (M2b).
    - Fix and pin: the page follows only the width class and applies a change on the next animation frame (`packages/ui/test/admin/setup/hcm-setup-page.test.ts`).
    - **Never change an observed element's size from its own ResizeObserver callback.**
46. **The sign-in flow evaluated the same user twice.**
    - Seen: Firebase announced the popup's user to `onAuthStateChanged` before `signInWithPopup` resolved, so the listener and the click's own flow both decided for the same uid.
    - Found by: the auth controller's tests (M2b).
    - Fix and pin: the controller evaluates each uid once and lets the click's flow continue (`packages/admin/test/auth/controller.test.ts`).
    - **An auth listener and the flow that triggered it must agree on who decides.**
47. **The first real owner claim would have been refused.**
    - Seen: `admin.claim` accepted only tokens issued to an OAuth client listed in `HCM_OAUTH_CLIENT_IDS`, a deploy-time value nothing sets yet, so on the real project every claim would have answered `apiError.claim.tokenMismatch`; the e2e world set the variable and hid it.
    - Found by: the integration review of the M2b journey against the production composition (`DECISIONS-for-review.md` §22a, CR-M2b-2).
    - Fix and pin: without the variable the claim reads the project's Google sign-in client from Identity Toolkit (`happyPath_withoutConfiguredClientsTheGoogleSignInClientIsAsked`), and the e2e emulators no longer set it, so the journey's claim takes the production path (`S-A26-HAPPY`).
    - **Configure the test world like production; every value a test sets for convenience is a path production never takes.**
48. **One of the 45 legacy photos was sometimes refused as a duplicate.**
    - Seen: the old site placed one file (`Al Orascu vazuta din Mihai Voda, partea din dreapta.jpg`) at two spots; the import uploads it for both records, and `photos.onUpload` refused the second as a duplicate of the first, but only when the first had finished processing before the second was checked, so the journey failed now and then.
    - Found by: the full e2e stage, where load changed the order of the import's three parallel uploads.
    - Fix and pin: two photos that both carry a `legacyId` are never each other's duplicate (`happyPath_twoLegacyPhotosOfOneImageAreBothProcessed`); a new upload of a legacy image still is (`badPath_aNewPhotoOfALegacyImageIsStillADuplicate`).
    - **A check that depends on which of two parallel jobs finishes first is a race: decide by data, never by order.**
49. **An admin test failed before it started: the Firestore emulator refused to be emptied.**
    - Seen: `S-A00-BAD-SCOPE-UNTICKED` failed in its `adminWorld` fixture with `Firestore reset: 409 ... Transaction lock timeout` (ABORTED), once in three full e2e runs; the test itself never ran.
    - Found by: the `e2e` stage of `PIPELINE_STAGE=all` on 2026-10-12, with every tier in one run.
    - Fix and pin: a background function of the previous admin test (a trigger, a manifest task) can still hold a document lock when the next test starts, and the emulator's delete-all waits for it, then answers 409; `EmulatorWorld.reset` (`e2e/admin/support/emulators.ts`) tries the Firestore reset up to three times on a 409 and fails on anything else.
    - **A fixture that resets shared emulators must expect work the previous test started to still be finishing.**
50. **The tour's toast state failed on a busy machine: the toast had closed before the test looked.**
    - Seen: `A toast` (`S-V15-HAPPY`) at 3840 × 2160 found no `error.unknownPhoto` status in 15 s, once in four full e2e runs.
    - Found by: the `e2e` stage of `PIPELINE_STAGE=all` on 2026-10-12, in a run that took a third longer than the others.
    - Fix and pin: the toast shows when the manifest is applied and closes itself 6 s later, but the test first waited for `hcm-ready`, which needs the 4K map to settle; it now focuses the toast's close button at once (the M3 snackbar keeps itself open while it holds the focus, as for a keyboard visitor reading it), then waits for the map (`e2e/tour/viewer.tour.ts`). A first fix hovered the toast instead and failed under a load average above 40: a hover waits for two stable animation frames, which a 4K SwiftShader page did not produce before the 6 s ran out; a focus needs none.
    - **A test of anything that times itself out must hold it open before waiting for something slower.**
51. **Two functions test files failed when the machine was busy, while every other emulator test passed.**
    - Seen: `functions/test/deps.test.ts` (two `createDeps` tests at 5 s) and the `beforeAll` of `functions/test/adapters/firestore.test.ts` (10 s) timed out in a `tests` run at a load average of 69, with four agents' pipelines on the laptop, and the first test again in a fresh clone of the unchanged branch at a load average of 6 (cold caches); the same tests take 0.1 to 3.3 s on a warm, idle machine.
    - Found by: measuring the `vitest` gate for the pipeline optimisation (`docs/research/pipeline-baseline.md`, the tests addendum); every earlier run was on a quieter machine, where the first request of a fresh emulator connection (a secret read asks Firestore for `setup/status` first) stayed under Vitest's defaults.
    - Fix and pin: both functions Vitest projects now give every test and hook 60 s (`EMULATOR_TIMEOUTS` in `vitest.config.ts`), which also replaces the per-file `vi.setConfig` of `functions/test/admin/world.ts` and `functions/test/publish/on-write.test.ts` (in a module graph shared across files, a helper's `vi.setConfig` would apply to the first file of a worker only); the rule is in `.agent/skills/quality/testing_strategy_skill.md`.
    - **A test that waits on a shared emulator gets the emulator's timeout, not the default: a default that holds on an idle machine is a bet on the load.**
52. **A fresh copy of the tree failed `static` after one `tests` run: Hypothesis's cache files were not ignored.**
    - Seen: on 2026-10-17, `static` in a scratch copy of the working tree (a `git clone` plus an rsync of the uncommitted files, the way `scripts/ci/e2e-split.sh` and the session's NUC helper copy a tree) failed `editorconfig` on eleven `.hypothesis/constants/*` files that the `pipeline-pytest` gate of the `tests` run before had written; the same sequence in the original checkout passed.
    - Found by: the integrator's measurement of `static` on a 4-CPU container, the first run of `static` after `tests` in a copied tree (the Measure agent had run `static` first everywhere).
    - Fix and pin: Hypothesis writes `.hypothesis/.gitignore` (`*`) only when it creates the folder itself; rsync's `--filter=':- .gitignore'` reads that file and copies the folder empty, without it, so in the copy Hypothesis found the folder, wrote no `.gitignore`, and its cache files were untracked. The root `.gitignore` now names `.hypothesis/`, so the folder is ignored however it came to exist; the quirk is in `.agent/skills/quality/pipeline_skill.md` → *Local tooling quirks*.
    - **A tool's folder that ignores itself from inside needs a root ignore entry too: copies, clean-ups and other tools do not keep a self-written `.gitignore`.**
53. **The tour passed while the FAB touched the timeline and an open menu blocked it on phones.**
    - Seen: the user, on 2026-10-12: "in the phone screens the menu button sometimes overlaps with other elements". The tour compared only the boxes an app marked `data-layout-check`, on the home state only, and treated the open menu as one box.
    - Found by: the generic checkers of 2026-10-17 (`assertLayoutSound` on every state): at 360 × 800 the FAB ends on the timeline's top edge (0 px apart), the open `hcm-fab-menu` host covers the timeline's thumb where no item is drawn, and the toasts' dock covers it too (`docs/research/layout-a11y-findings.md`).
    - Fix and pin: the checks run on every state of `e2e/tour/states.ts` (`S-V15-HAPPY`, `S-V14-HAPPY-EVERY-STATE`); the product fixes follow in their own task.
    - **A layout check that only looks at what the app marked, in the states the test happened to open, proves nothing about the others: probe every control of every state from the page itself.**
54. **The admin journey failed once on the USGS countdown: it showed 54 s where the test wanted 55.**
    - Seen: on 2026-10-17, `admin-m768-ro`'s journey read "Lipește tokenul în 54 s" after jumping the page's clock by 5 s from 60, in a split run where this half of the admin tier ran beside the laptop's functional tests.
    - Found by: the first split run with the admin tier divided between the machines (`DECISIONS-for-review.md` §33a); the busier machine took more than a second between the two reads.
    - Fix and pin: the journey keeps `page.clock` running (the Firebase SDK needs its timers), so the countdown also moves in real time; the spec now asserts the jump took at least five seconds off and the 60 s window is still open (`S-A07-HAPPY-COUNTDOWN`).
    - **On a clock that keeps running, assert a range: the exact second a spec reads depends on how busy the machine is.**
55. **The Tab walk saw only the first control of the viewer: the rest moved inside one shadow root.**
    - Seen: the first version of the tour's focus check recorded `focusin` on the document and reported every control after the skip link as never reached.
    - Found by: debugging the checker on `tour-c360-light-ro` (pressing Tab and reading the deep active element showed the focus did move).
    - Fix and pin: a focus event whose target and related target retarget to the same host stops at that host's shadow root, so a move between two controls of `hcm-map-viewer` never reaches the document; the walk now reads the deep active element after every press (`recordFocus`, `e2e/test/a11y-probe.test.ts`).
    - **Listen for focus where it moves, or read where it is: a document listener misses every move inside one shadow root.**
56. **A sheet on a phone held sideways was taken for a docked pane.**
    - Seen: in the tour's journeys the photos-near-the-year sheet at 915 × 412 was never closed with Esc, so the next state found the frame inert and its timeline unfocusable.
    - Found by: the tour on `tour-c915l-light-ro`.
    - Fix and pin: `isDocked` (`e2e/support/viewer.ts`) decides by width alone (840 px and up), but a compact height (under 480 px) makes the viewer's sheets modal side sheets at any width (`packages/ui/src/viewer/layout.ts`); the tour uses `sheetsAreModal` (`e2e/tour/states.ts`), which follows the layout's own rule. `isDocked` serves the functional projects, none of which is a landscape phone.
    - **A test helper that classifies the layout must follow the layout's own rule, every axis of it, not the one axis the first viewports needed.**
57. **The menu button sat on the timeline on phones: its offset was computed from a height the timeline had by accident.**
    - Seen: the user's report of 2026-10-12; the generic checker measured the FAB 0 px from the timeline's top edge at 320, 360 and 412 px, the timeline 2 px from Mapbox's collapsed attribution, and the chip on the timeline at 768 px (`docs/research/layout-a11y-findings.md`).
    - Found by: the tour's gap check (8 px between floating touch targets on compact and medium).
    - Fix and pin: the viewer stacks its floating controls with named sizes and M3's 8 px gap (`--hcm-map-chrome` 42 px for Mapbox's collapsed attribution plus the gap, `--hcm-timeline-block`, `--hcm-fab-size`, `--hcm-dock-gap` in `packages/ui/src/viewer/viewer-styles.ts`). The timeline was 100 px tall only because the browser's 1em margin of its `ol` collapsed through the track (so a page with larger text made it taller still); the margin is gone and the timeline is the 84 px its padding says. With the FAB moved up first, the open menu's first item left a 568 px phone, which the designed height gives back. Pinned by `packages/ui/test/viewer/kit-integration.test.ts` (the distances on a phone and a tablet, the smallest phone's open menu) and `hcm-timeline.test.ts` (the height at a 24 px font).
    - **A stack of floating controls built on another component's height needs that height to be a contract: name it, make the component hold it whatever the page's font, and measure the gaps in a test.**
58. **The open FAB menu and the toast dock took taps where they drew nothing.**
    - Seen: the tour at 768 and 1024 px: the open menu's host, as wide as its widest item, covered the timeline's thumb beside the FAB; on a phone held sideways the toasts' full-width dock covered the vertical timeline.
    - Found by: the occlusion check (five sampled points per control, a deep `elementFromPoint`).
    - Fix and pin: `hcm-fab-menu`'s host takes no pointer, only the FAB and the items do; the viewer's menu and toast docks take none either (the snackbar's surface does), and on a short phone the top docks end before the vertical timeline. Pinned by `fab-menu.test.ts` and `kit-integration.test.ts` (hit tests beside the FAB and beside the toast).
    - **A popup or a dock is a box around what it draws: give the box `pointer-events: none` and the drawn parts `auto`, or it blocks whatever lies under its empty corners.**
59. **The docked photo list could not scroll: a wrapper without a height broke the sheet's `block-size: 100%`.**
    - Seen: the tour from 1024 px up: the photos below the fold were cut off by the trailing pane, which hides its overflow (and, focused by Tab, scrolled the pane so its title left the top).
    - Found by: the edge check (cut off by an ancestor that hides its overflow and does not scroll).
    - Fix and pin: the photo list's wrapper (`.photos-sheet`) is `display: contents`, as the other sheets' hosts, so the docked sheet is as tall as the pane and its body scrolls (`hcm-map-viewer-layout.test.ts`).
    - **A percentage height needs a definite height on every box above it: one auto-height wrapper passes `auto` down and the content simply grows.**
60. **A focus ring of one colour failed on three surfaces, and Mapbox's labels kept the first language.**
    - Seen: the tour: the secondary ring measured 1.62:1 on the snackbar's inverse surface, 2.38:1 on the error container and 1.71:1 on Mapbox's white attribution in the dark scheme; after a language switch the page kept "Map", "Mapbox homepage" and the attribution toggle's name in English.
    - Found by: the Tab round's ring contrast and the i18n leak check of the `language` state.
    - Fix and pin: `focusRing` reads `--hcm-focus-ring-color`, which the snackbar (inverse primary) and the error card (on-error-container) set; the viewer gives Mapbox's attribution a `light-dark()` ring of primary and inverse primary. `MapPort.setLocale` rewrites Mapbox's UI strings, which Mapbox writes only when its controls are created (`S-V11-BAD-MAPBOX-LABELS`; `snackbar.test.ts`, `kit-integration.test.ts`, `mapbox-adapter.test.ts`).
    - **A ring that contrasts with the page's surface is not enough: every coloured surface a control sits on needs its own ring colour, and a third-party control's text needs a way back in after a language switch.**
61. **The map's canvas was wider than its box after a pane opened, on big screens and busy machines.**
    - Seen: the tour at 2560 and 3840 px (and 1280 px at a load average of 75): with a POI's pane docked, the canvas kept the map's old width and was cut off by the map's box.
    - Found by: the edge check, which probed before the browser had rendered a frame since the pane opened.
    - Fix and pin: the Mapbox adapter resizes the map inside the container's ResizeObserver callback (after layout, before paint, at most once a frame) instead of scheduling it for the next frame (`mapbox-adapter.test.ts`); the tour's `settleAnimations` (`e2e/support/layout.ts`) also waits two rendered frames after the animations stop, so what a frame triggers has happened before the probe.
    - **A ResizeObserver already runs once a frame: do the work in its callback, and let a layout probe wait for a rendered frame, not only for the animations to end.**
62. **On a phone the admin's bottom bar and its snackbar hid what the keyboard had just focused.**
    - Seen: the tour's first admin run (`docs/research/layout-a11y-findings.md`): at 360 × 800 a focused Setup header, link, field, switch and **Check again** ended under the sticky navigation bar (WCAG 2.4.11), axe found two Setup headers half under it (`target-size`), at 1440 px the account button scrolled away with the top bar, and once the bar was fixed the "page not found" snackbar covered the focused header instead. The bar's More sheet covered only the bar: the kit's sheet fills its positioned container, and the sticky bar was it.
    - Found by: the generic checkers on every admin state (behaviour A31): the Tab round's *focus obscured*, axe's `target-size`, the occlusion samples.
    - Fix and pin: the shell is an app shell: the frame is as tall as the window, the bars and the rail keep their own grid rows, only the page scrolls (`.scroller` in `<main>`), and the snackbar is docked below it (no room while empty); `packages/ui/test/admin/shell/shell-layout.test.ts` focuses the last control of a tall page at 360 px and checks it lies above the bar and the snackbar and is hit at its centre, that the top bar and the rail stay put while the page scrolls, and that the More sheet is as tall as the frame (`DECISIONS-for-review.md` §33f).
    - **A bar pinned over a scrolling page hides whatever scrolls under it, the focused control included: give the bars their own rows and let only the content scroll, and dock a message where it takes its own room.**
63. **A date field lost its focus ring on its calendar button, and the Setup page checked in mid-change.**
    - Seen: the USGS expiry field showed no ring on one of the stops Tab makes inside it; the unknown address's Setup page (smoke, 360 px) had every card closed for seconds, then opened billing in the middle of the Tab round and moved Mapbox's header off screen; the snackbar's 8 s timer ended mid-round and Tab "never reached" its Close.
    - Found by: the Tab round on the admin's states; a pointed unit test (`hcm-setup-usgs.test.ts`) Tabs through the field: on the calendar button the input matches only `:focus-within`, never `:focus` or `:focus-visible`.
    - Fix and pin: the fields' ring is `:focus-visible, :focus-within`; the Setup controller opens the step to resume at as soon as `setup.status` answers, and the legacy import's detection (it reads every photo) decides only when the import is that step (`controller.test.ts`); the smoke waits for the open card and an enabled **Check again**, and points at the snackbar (its timer waits while it is pointed at) before the checkers run.
    - **A native control can hold the focus inside its own shadow, where only `:focus-within` reaches it; and a state check needs a settled state: wait for what opens on its own, and hold what closes on its own.**
64. **Every kit button took taps only on what it drew: its 48 px touch target was cut to the 40 px button.**
    - Seen: the admin agent measured in Chromium that a tap 2 px outside the 40 px icon button (and 3 px below `hcm-button`, the chip, a segment) missed it (LA-6 of `docs/research/layout-a11y-findings.md`): the state layer's `.interactive { overflow: hidden }` (0,1,0) beat the components' own `button { overflow: visible }` (0,0,1), so the `touch-target` `::after` was clipped. Once the ring was hit-tested, the tour also found the bottom sheet's 24 px drag handle cut to 36 px by the sheet (its ring rose past the sheet's top edge) on every phone, and a two-letter segment ("Nu") 46 px wide whose ring then stuck out of a narrow container.
    - Found by: a pointed measurement, not the tour: the target-size check read the pseudo-element's computed 48 px, which stays 48 px however much of it is clipped.
    - Fix and pin: `touchTarget` sets `overflow: visible` on `.interactive.touch-target` (`packages/ui/test/components/touch-target.test.ts` hit-tests the ring of the icon button, button, chip and segment, and fails on the old style); the handle is a 48 × 48 button at the sheet's top (`sheet.test.ts`), a segment at least 48 px wide (`segmented-button.test.ts`); the checker's `targetSizeOf` hit-tests each side of the ring and counts it as far as a pointer reaches the control, a side off screen or scrolled out of its list counting as computed (`e2e/test/layout-probe.test.ts`).
    - **A computed size is not a hit area: measure a touch target by where a pointer lands, and check that nothing clips the part of it that lies outside the control.**
65. **The open menu's last item lay on the timeline's thumb on a tablet, and the tour let it.**
    - Seen: the visual audit's screenshot of the open menu at 768 × 1024: the FAB sits beside the timeline there, the items (wider than the FAB) end 8 px above the FAB, so "Despre" covered the top of the "Azi" thumb; the thumb's hit-tested target came out 44 px.
    - Found by: looking at the contact sheets. The tour passed because the open menu was sanctioned to cover any chrome (`under: '*'`), the stacking the user's report of 2026-10-12 was about.
    - Fix and pin: at medium and up the viewer sets `--hcm-fab-menu-gap` so the items end 8 px above the timeline (`kit-integration.test.ts`); the sanction is narrowed to the map's content and the two top docks the menu is designed to grow over on a short phone (`SANCTIONED_STACKINGS`, `e2e/test/layout-rules.test.ts`).
    - **A sanction is a hole in the check: scope it to what the design needs, and look at the screenshots of every state the hole covers.**
66. **A theme choice ran past its dialog's edge on phones, and every check passed because the dialog could scroll sideways.**
    - Seen: the visual audit's screenshot of the admin's account menu at 360 × 800: "Întunecată", the third segment of the theme choice, was cut by the dialog's edge; the viewer's About did the same at 320 px (12 px, 54 px with WCAG 1.4.12's text spacing). Three single words cannot wrap, and the kit's dialog content is `overflow: auto`, so it scrolled sideways.
    - Found by: looking at the contact sheets. The edge check accepts content a scroll container brings into view, and the page-scroll check looked at the page only.
    - Fix and pin: `hcm-segmented-button` stacks its segments one 48 px row each while they do not fit side by side and goes back once its host is as wide as they need (`segmented-button.test.ts`, the rows' hit-tested targets included); the layout checker's new `sideways-scroll` check reports any box but the page that scrolls sideways, naming what sticks out (`e2e/test/layout-probe.test.ts`, `layout-rules.test.ts`).
    - **A box that scrolls on one axis scrolls on both: a reflow check must look inside every scroller, not only at the page.**
67. **The admin was never checked in the dark scheme.**
    - Seen: the visual audit captured every admin state in light and dark; the admin's projects (c360, m768, l1440 in Romanian, l1440 in English) all ran in light, so axe's contrast, the focus rings and the non-text contrast of the admin's dark scheme had never been measured.
    - Found by: the audit's list of what each tier covers, not by a failure: the dark project passed on its first run.
    - Fix and pin: the project `admin-l1440-dark` runs the admin's specs and every state check in the dark scheme (part 1 of the split, on the NUC).
    - **Every scheme the product ships is a project of the checkers: a colour that is never rendered in a test is never checked.**
68. **The map's keyboard focus was invisible: its ring was drawn outside a box that hides its overflow.**
    - Seen: after the visual audit showed the bottom sheet's drag handle with a ring cut by the sheet's top edge, the new ring check found the same on every tour project for the map canvas (the viewer's shared ring, 2 px outside the canvas, which fills Mapbox's `overflow: hidden` box, so none of it was drawn) and for the links of Mapbox's full attribution in the box's corner (their ring's lower edge).
    - Found by: the screenshots first, then the Tab round's ring check, which until then only asked whether an outline was set and how it contrasted, never whether it was drawn.
    - Fix and pin: the canvas's ring is inset (`outline-offset: -3px`), the attribution's links take an offset-free ring with 3 px of padding around them, the handle a round ring inside its box (`kit-integration.test.ts`, `sheet.test.ts`); the probe's `ringCutterOf` reports a ring cut by an ancestor (`e2e/test/a11y-probe.test.ts`).
    - **A style that is set is not a style that is drawn: check that nothing clips the focus indicator, the way a pointer check hit-tests a target.**
69. **Tab reached only the first drawing tool of the places editor.**
    - Seen: admin, `#/pois/<id>`, every admin project: the kit's one-stop toolbar (`hcm-toolbar`) sets `tabindex` on its slotted icon-button hosts (0 on the active one, -1 on the rest); a host with `tabindex=-1` hides its shadow button from Tab, so Select and Add at centre were reachable only with the arrow keys, and the active host, a focusable element without a name of its own, counted as a stop Tab never reached.
    - Found by: the Tab round of `expectStateSound` at the state `pois.new-place` (e2e admin tier); the ui tests clicked the tools and axe has no rule for a focusable host without a name inside a toolbar.
    - Fix and pin: the tools are a named group (`role="group"`), each its own Tab stop, 8 px apart so their 48 px rings do not overlap (`S-A32-BAD-NO-MAP-TOKEN`, `packages/ui/test/admin/map/map-elements.test.ts`).
    - **A roving tabindex on custom-element hosts governs the hosts, not the controls in their shadow trees: keep every control its own Tab stop unless the focus pattern sets the controls' own `tabindex`.**
70. **The places list repeated four target and contrast faults the photos page had already fixed.**
    - Seen: admin, `#/pois`, at 360 and 768 px: native check boxes (their drawing reaches 1:1 against the surface), Import GeoJSON as a label around a 1 x 1 visually hidden file input (no border, and its focus hidden under other content), filter chips whose wrapped rows were 8 px apart (their 48 px rings overlapping), a 43 px wide History link, and, with text spacing at 360 px, the import dialog's Import ring over the bottom of the category select at the edge of the scrolling content.
    - Found by: the generic checkers at the admin projects (non-text contrast, focus obscured, target size, occlusion); the ui tests and axe passed.
    - Fix and pin: M3 check boxes with a `touch-target` ring, a kit button opening a `hidden` input, chip rows 16 px apart, `min-inline-size: 48px` on the link, the refusals listed after the select (`pois.list`, `pois.import-preview`, `S-A34-BAD-INVALID-FEATURES`); the dialog's action ring and the link width are reported to the kit's owners (CR-M2c-23).
    - **A new area starts from the patterns of the areas the checkers already passed: a native control or a visually hidden input brings back a fault that was fixed elsewhere.**
71. **A draft that had been touched kept another admin's stale values in the fields it did not change.**
    - Seen: admin, the photo editor: after a remote save, a draft with one edited field still held the old values of every other field, so the next Save would have written them back and undone the other admin's change.
    - Found by: `packages/admin/test/photos/draft.test.ts` (the photos workstream, CR-M2c-19).
    - Fix and pin: the draft rebases on every snapshot: the fields it does not change take the remote values, the overlapping ones raise the conflict choice.
    - **A draft is a set of changed fields over the latest snapshot, never a copy of the document taken when the editor opened.**
72. **A recording `Proxy` handed to a Lit property binding broke the render.**
    - Seen: ui tests of the photos and places pages: `nextDirectiveConstructor is not a constructor` once a page passed its intents to a child element.
    - Found by: the browser tests of the photos and places pages (CR-M2c-21).
    - Fix and pin: the fakes answer only intent names: `undefined` for `_$`-prefixed names and `then` (`packages/ui/test/admin/editing/fake-area.ts`, `kit.test.ts`).
    - **Lit probes a bound value for `_$litDirective$`: a test double that answers every property is a directive to Lit.**
73. **The kit's slider stayed where the key put it after the store refused the value.**
    - Seen: admin, the layer editor: the black level pressed past the white level stopped in the store, but the slider showed the refused position.
    - Found by: a ui test and the keyboard spec `S-A35-BAD-KEYBOARD-LIMITS` (CR-M2c-30).
    - Fix and pin: the binding is `live()`, and the announcement says the kept value (`packages/ui/test/admin/layers/layers-page.test.ts`).
    - **A control that moves itself must be bound with `live()` when the store may refuse the move: Lit compares with what it last rendered, not with what the control shows.**
74. **Dependency-cruiser's `no-circular` counts type-only imports.**
    - Seen: the content port importing an area's port which imported the umbrella port back for its shared types.
    - Found by: the `dependency-cruiser` gate (CR-M2c-26).
    - Fix and pin: the shared types live in a base file (`packages/ui/src/admin/area-port.ts`) that both import.
    - **Shared types go below both of their users, never in the file that aggregates them.**
75. **A text field that commits on `change` left Save disabled until the admin left the field, and a disabled button takes no click.**
    - Seen: admin, `#/pois`, a new point: the Romanian title typed, then a click on Save did nothing: the draft still had an empty title (the field reported it on `change` only), so Save stayed disabled, and a click on a disabled button does not take the focus, so `change` never fired.
    - Found by: the admin-to-viewer journey `S-A41-HAPPY-PLACE` and the revoke journey (`e2e/admin/specs/flows/`); the places spec had pressed Tab after every field.
    - Fix and pin: the place editor's titles, descriptions and links commit on `input` (`packages/ui/test/admin/pois/poi-editor.test.ts` types with `input` events); years still commit on `change`, since half a number is not a year (`DECISIONS-for-review.md` §35d).
    - **A spec that presses Tab after every field hides the click a person makes straight after typing: type, then click Save, as a person does.**
76. **The built Bucharest site refuses every manifest the backend builds.**
    - Seen: the viewer served the manifest the admin's save published: "cityId din config.js (bucuresti) nu corespunde hărții (bucharest)". The site's `config.js` and the legacy manifest name `bucuresti`; the project's city (`infra/project.json`), the admin and every built manifest name `bucharest`.
    - Found by: the first admin-to-viewer journey (`e2e/admin/specs/flows/publish.spec.ts`); each side was tested only against its own fixtures.
    - Fix and pin: the journeys serve the site a `config.js` naming the project's city; aligning the site is the user's decision (`DECISIONS-for-review.md` §35b).
    - **Test the hand-over between two apps with the real output of one as the input of the other: two fixtures that each pass prove nothing about the join.**
77. **A collection-group rule opened every `history` folder in the database to admins.**
    - Seen: `match /{path=**}/history/{entry}` (History's recent changes) let an admin read `setup/status/history/h1`, a path the contract does not name.
    - Found by: the rules matrix's default-deny test (`firebase/rules-tests/test/identity.test.ts`) in the integration's `tests` run.
    - Fix and pin: `get` requires the path to start with `cities`; `list` stays open to admins, because a condition on the path cannot hold for a collection-group query (the emulator then denies the whole query; `history.test.ts`).
    - **A recursive wildcard matches everywhere: narrow what a rule can narrow, and write down what a query rule cannot.**
78. **A new server-owned field needs a value in the rules tests' complete document, or its deny tests prove nothing.**
    - Seen: `replacement` joined `photoDocSchema`; the generated tests "a client cannot change or remove it" read `removed: allow` (the fixture had no such field to remove) and the create test sent `undefined`.
    - Found by: `firebase/rules-tests/test/client-writes.test.ts` and `documents.test.ts` in the integration's `tests` run.
    - Fix and pin: `photoDoc` in `firebase/rules-tests/test/support/documents.ts` carries `replacement`.
    - **The schema and the rules tests' fixture change together: a field the fixture lacks is a field no rule test exercises.**
79. **A revoked admin's open draft disappears with the page.**
    - Seen: admin, two browsers: the owner removed an admin whose place editor held a change; the admin's Save was refused, then the shell asked `admin.session` again and replaced the page with "This Google account does not administer this map", the draft with it.
    - Found by: `S-A02-BAD-REVOKE` (`e2e/admin/specs/flows/revoke.spec.ts`), which raced it at first: on some projects the title was read before the panel came.
    - Fix and pin: the spec asserts the refusal, that nothing is written and the panel; keeping the draft visible is `S-A20-BAD-REVOKED-WHILE-EDITING` (planned, `DECISIONS-for-review.md` §35e).
    - **Assert the state a race ends in, never one it passes through.**
80. **Playwright's `--project` takes every following word as a project name.**
    - Seen: `npx playwright test --project admin-l1440-ro admin/specs/flows` answered `Project(s) "admin/specs/flows" not found`.
    - Found by: running one spec folder during the integration.
    - Fix and pin: the file filter goes first: `npx playwright test admin/specs/flows --project admin-l1440-ro` (`docs/TESTING.md`).
    - **Put positional filters before variadic options.**
81. **Without a map, every editor's map box stayed an empty block above the form.**
    - Seen: the review screenshots of 2026-10-18, every admin editor at 360 × 800 and 768 × 1024: the box kept its 45vh (or 240 px) with only "The map appears once Mapbox is set up." at its top, pushing the editor's heading half a screen down.
    - Found by: looking at the contact sheets (`reports/screenshots/m2c/sheets/`); no checker measures empty space.
    - Fix and pin: `hcm-admin-map` sets `no-map` on its host while it only says why there is no map, and the pages size `[no-map]` to its note (`packages/ui/test/admin/map/map-elements.test.ts`, `packages/ui/test/admin/photos/photos-page.test.ts` measure the box against its note).
    - **A box sized for its content in one state needs its size in every other state: look at the screenshot of each.**
82. **On a wide pane the layer editor put the Romanian description beside the two names.**
    - Seen: `#/layers/<id>` at 1600 and 2560 px: the texts' auto-fit grid made three columns, so the Romanian and English fields no longer faced each other.
    - Found by: the contact sheet of `layers.editor` at 2560 × 1440.
    - Fix and pin: the localized pairs take at least half the row each (`.fields.pairs`); `packages/ui/test/admin/layers/layers-page.test.ts` checks the columns at 800, 1600 and 2560 px.
    - **A grid of paired fields fixes its column count; `auto-fit` is for fields that do not belong together.**
83. **"Configurare" broke after its tenth letter on the phone's navigation bar.**
    - Seen: every admin page at 360 px once the bar held four destinations and More: 72 px per item minus 4 px of padding each side left 64 px for a 65 px word, and `overflow-wrap: anywhere` put its last "e" on a line of its own.
    - Found by: the contact sheets; the text check looks for cut and overlapping text, not a word broken across lines.
    - Fix and pin: the bar's items have no inline padding; `packages/ui/test/admin/shell/nav-and-menu.test.ts` loads the kit's font ("HCM Roboto Flex") and fails on any word of a bar label split over two lines (a range per word; Lit's comment marker means every text node is read, not the first child).
    - **Measure text in the font the product draws it with: a fallback font is narrower, and the test passes for nothing.**
84. **A chosen row filled with the secondary container left its own fields at 1.27:1 in high contrast.**
    - Seen: the places editor's list of positions, the chosen position, in the light high-contrast scheme: the fields' borders and the row's icons against `secondary-container` (#554f64).
    - Found by: the non-text contrast check, only once the map box stopped pushing the list below the window (lesson 81): a state's checks see what is in the window.
    - Fix and pin: the chosen row is ringed (an inset 2 px `secondary` ring), not filled (`pois.editor` in the tour inventory).
    - **Never fill the background of a container whose controls are measured against the surface; and remember that a state's checks cover only what is scrolled into view.**
85. **The deployed admin logged a CORS error before its server existed.**
    - Seen: the live admin of 2026-10-17, a Hosting-only deploy of a new map: before sign-in the console said the fetch of `…cloudfunctions.net/admin-session` was blocked by CORS, then `net::ERR_FAILED`.
    - Found by: the user, in the browser's console; the e2e journey hid the server and claimed that error as expected.
    - Fix and pin: a new map's first deploy says it has no server (`HCM_ADMIN_START_UP=1`, `runtime.json` → `startUp`), and the admin then calls nothing of the server until Google lists every function `ACTIVE` (step d). Tried first in Chromium: a `no-cors` fetch only trades the CORS error for "Failed to load resource: the server responded with a status of 404": every answer of 400 or more is logged, whatever the mode (`S-A25-HAPPY` asserts no request and no console error; `S-A25-BAD-NO-START-UP-DEPLOY` keeps the probe's path).
    - **A request whose expected answer is an error always shows in the console: ask something that knows instead of probing what is not there.**
86. **A start-up page reloaded after its server came kept the admin in start-up mode.**
    - Seen: the owner's journey, after the claim: the reload to see USGS's approval opened the start-up sign-in again (the routed `runtime.json` still said `startUp`), as a functions-only deploy would leave the start-up page in place.
    - Found by: `e2e/admin/specs/journey.spec.ts` at the five admin projects, the first run with the start-up runtime.
    - Fix and pin: a browser that has had the server's answer (`hcm:admin:serverSeen`) probes despite `startUp` (`packages/admin/test/auth/controller.test.ts`, the journey).
    - **A deploy-time flag goes stale the moment the world changes: let what the browser has seen since outrank it.**
87. **The admin's boot log and crash reports said `release: dev`.**
    - Seen: the live admin's console, 2026-10-17: `admin booting { release: 'dev' }`; every crash report of the admin would have been filed under `dev`.
    - Found by: reading the live console; the `runtime.json` writer of §23b had never been built, and the fallback hid it.
    - Fix and pin: the admin's site build writes `runtime.json` with `<version>+<short commit>` (`scripts/site/test/admin-runtime.test.ts`, `admin-build.test.ts`).
    - **A value a report needs is written by the build that ships the code, not left to a deploy step that does not exist yet.**
88. **Turning a phone with the account menu open dropped the focus on the page.**
    - Seen: the admin at 360 × 800 with the account dialog open, turned to 800 × 360: the menu moved from the top bar to the rail's foot, the old one went with its dialog, and the focus fell to the body.
    - Found by: the hardening review's follow-up; the tour checks each state at one viewport, so nothing turned a page mid-state.
    - Fix and pin: the shell gives the new menu's button the focus when the one in use was replaced (`S-A29-BAD-ROTATE-MENU-OPEN`; `packages/ui/test/admin/shell/shell-layout.test.ts`).
    - **When a layout change re-creates a component, the focus it held must be handed to its successor: turn the device with the focus inside the part that moves.**
89. **A toast left from the previous state went in the middle of the next state's checks.**
    - Seen: the tour at 3840 × 2160, dark, on the NUC: `viewer.language` reported "Tab never reaches Close" for the toast the `locate-toast` state had held open; switching the language re-worded it, its timer started again, and it went during the Tab round.
    - Found by: the tour's generic checkers in a split run on the slower machine (the state passed on the laptop).
    - Fix and pin: the `language` state closes a leftover toast before it switches (`dismissToast`, `e2e/support/viewer.ts`).
    - **A state's checks need a settled page: close or hold whatever times out, never let a timer race the checks.**
90. **With the admin's map on screen, a dialog's scrim covered Mapbox's logo and attribution.**
    - Seen: the photos page with its map at 1440 × 900, the Set fields, delete and publish report dialogs open: the legal line under the scrim.
    - Found by: the generic layout checker's legal rule, once the admin's e2e had its mocked Mapbox (CR-M2c-7) and the map drew.
    - Fix and pin: the kit's modal registry (`packages/ui/src/components/modal-registry.ts`): an open modal dialog marks the admin map `covered`, which hides its canvas and controls until the dialog closes (`modal-registry.test.ts`, `dialog.test.ts`, `map-elements.test.ts`).
    - **A third party's legal line must stay visible or go with what it labels: hide the map under a modal instead of dimming it.**
91. **Publishing a batch of photos took one input more than its budget.**
    - Seen: `S-A10-HAPPY`, "select all and publish": Select all showed only after a first row was ticked.
    - Found by: the input budget of the content flows (`CONTENT_INPUT_BUDGETS`), counted by `InputFlow`.
    - Fix and pin: Select all shows whenever the list has rows (`photos-page.test.ts`).
    - **Count the inputs of a flow from the first screen: a control that appears only after another input costs that input.**
92. **A photo's pin could not be placed with a pointer.**
    - Seen: the photo editor with its map: in Select mode a click did nothing, and the click tools have no drag (Terra Draw waits for §34g).
    - Found by: `S-A09-HAPPY` driving the map with clicks (WCAG 2.5.7, a single-pointer alternative to dragging).
    - Fix and pin: in Select mode a click moves the selected point; the photo's editor selects its pin (`click-draw-adapter.test.ts`, `photos/map.test.ts`).
    - **Every drag needs a click-only alternative; a selected point should go where the pointer says.**
93. **A photo dropped before the city was read was created at 0, 0 and refused as "not an admin".**
    - Seen: `S-A37` specs uploading right after the page opened, with no remembered pin: the photo document at (0, 0), refused by the rules, which the page showed as a missing admin right.
    - Found by: the replace and upload specs in a fresh city of the content world.
    - Fix and pin: the upload queue waits for a pin (the last one, else the city's centre) before it creates the document (`upload-queue.test.ts` badPath_aFileDroppedBeforeTheCityIsReadWaitsForItsCentre).
    - **A default that depends on loaded data must wait for that data, never fall back to zero.**
94. **The shell wore the project's city theme in another city.**
    - Seen: a content world's city (`?city=`) in the admin: the colours of `project.cities[0]`.
    - Found by: the content specs' review screenshots.
    - Fix and pin: the shell's theme follows the edited city (`mount.test.ts`).
    - **Derive the theme from the same city the editors edit.**
95. **An import file chosen right after the places page opened was planned against no categories.**
    - Seen: `S-A34-BAD-MARKUP-IS-TEXT`, flaky 3 of 4: every feature "unknown category", an existing id counted as new.
    - Found by: the import spec choosing its file at once.
    - Fix and pin: the importer plans its preview again when the places or the categories change (`importer.test.ts`).
    - **A preview computed from live lists must be recomputed when they arrive.**
96. **The list of positions kept a coordinate the map had refused.**
    - Seen: a position typed outside the city: the field kept the refused value while the shape kept its old position.
    - Found by: `S-A32-BAD-OUTSIDE-CITY`.
    - Fix and pin: a refused value puts the field back at the shape's position (`map-elements.test.ts`).
    - **A field must show what was stored, not what was refused.**
97. **A new place's toolbar said Select while the map was drawing.**
    - Seen: Add place, Area: the Select tool pressed (and its hint about dragging) while each click added a position.
    - Found by: the drawing spec reading the pressed tool.
    - Fix and pin: the tools follow the drawing session; a finished point selects (`poi-editor.test.ts`).
    - **A toolbar is a view of the mode, never its own state.**
98. **Importing over the limit did not say the numbers.**
    - Seen: "the file would pass 5000 places", without how many there are and how many the file adds; a failed count read as too many.
    - Found by: `S-A34-BAD-TOO-MANY` ("with the numbers").
    - Fix and pin: the refusal names the city's count, the file's and the limit; a count that failed is a failure (`importer.test.ts`, `pois-page.test.ts`).
    - **A limit refused should name the limit and both sides of the sum.**
99. **A place's address opened directly on a phone went Back to the previous site.**
    - Seen: `#/pois/gara` opened from a link: the browser's Back left the admin.
    - Found by: `S-A29-BAD-DEEP-LINK-COMPACT`.
    - Fix and pin: the navigation puts the list under an item opened directly (`navigation.test.ts`).
    - **An item reached by its address needs its list under it in the history.**
100. **A phone held sideways had no page heading.**
    - Seen: 915 × 412, the rail and no top bar: axe's `page-has-heading-one`.
    - Found by: `S-A29-BAD-LANDSCAPE-PHONE` through the generic checkers.
    - Fix and pin: a visually hidden h1 in the main region when the top bar is not shown (`shell-layout.test.ts`).
    - **Every layout of a page keeps its heading; hiding a bar must not hide the page's name.**
101. **The places list did not preview the open draft.**
    - Seen: a title changed in the editor, the list beside it still showed the old one.
    - Found by: `S-A38-HAPPY` (M2c-interfaces §5.2).
    - Fix and pin: the list shows the open draft (`pois-page.test.ts`).
    - **What the contract says is previewed must be checked where it is previewed.**
102. **A place added before the city's categories were listed lost its remembered category.**
    - Seen: Add place right after the page opened: the select showed the first category, the draft had none and was invalid.
    - Found by: `S-A30-BAD-STICKY-FIELDS`, flaky 1 of 3.
    - Fix and pin: a new place without a category gets the remembered one (else the first) once the categories arrive or when it opens (`pois.test.ts`).
    - **A remembered choice must be applied when its options arrive, not only when the form opens.**
103. **A refused Mapbox or USGS save left the chip as it was, although the server recorded why.**
    - Seen: a revoked Mapbox token: the alert said so, the chip stayed "To do".
    - Found by: `S-A06-BAD-REVOKED`.
    - Fix and pin: after a refused save the card reads `setup.status` again (`credentials.test.ts`).
    - **When the server records a failure, show its record, not a guess of it.**
104. **A provisioning item's own reason vanished once the run was recorded.**
    - Seen: an organisation policy blocking the public bucket: "Needs attention" and no reason in normal mode.
    - Found by: `S-A04-BAD-ORG-POLICY`.
    - Fix and pin: an item keeps the reason the page knows when the record has none for the same state (`records.test.ts`); `setup.recordCloud` keeps API error codes only.
    - **When a store keeps less than the page knows, merge rather than replace.**
105. **A Google token that expired mid-provisioning offered only a Retry that could not work.**
    - Seen: the item said "Continue to renew it", the card showed Retry, which ran again with the dead token.
    - Found by: `S-A04-BAD-TOKEN-EXPIRED-MID-RUN`; the unit test's fake provisioner threw, the real one stops and resolves.
    - Fix and pin: a run that stopped on a 401 drops the token and offers Continue (`provision.test.ts`).
    - **A fake must fail the way the real thing fails; read the real one's contract before writing the fake's.**
106. **The start-up steps' results were lost when the page reloaded before the server came.**
    - Seen: after the claim, billing and provisioning back to "To do": the bootstrap record in `sessionStorage` had been overwritten by the claim card's first change, before the Setup controller read it.
    - Found by: `S-A26-BAD-TOKEN-GONE`.
    - Fix and pin: the record is mirrored only once it was read (`context.test.ts`, `controller.test.ts`).
    - **A store mirrored on every change must be read before the first write.**
107. **On a landscape phone the editors flapped between one pane and two.**
    - Seen: 915 × 412: the full-screen editor hid the rail, which widened the page past 840 px, which split it and brought the rail back; the Tab round missed what the flap left inert.
    - Found by: the admin tour (§34c) at `tour-c915l`, its first run.
    - Fix and pin: the list and detail never split at a compact height (`splitsAt`, `kit.test.ts`).
    - **A layout decision that changes what it measures needs a rule that does not depend on its own result.**
108. **A map scrolled to a strip had its own attribution counted as covering it.**
    - Seen: the layer editor at 915 × 412, scrolled: a sample of the canvas hit Mapbox's attribution.
    - Found by: the admin tour's scroll sweep at `tour-c915l`.
    - Fix and pin: the layout probe counts a map's own controls over its canvas as the map (`ownMapControl`, `layout-probe.test.ts`); the legal rule still checks them.
    - **A checker's rule must know what a component draws over itself by design.**
109. **In WebKit the admin stayed at "Loading…" behind a gapi stand-in that never answered.**
    - Seen: the first `admin-webkit-l1440-ro` run: Firebase Auth fetches Google's gapi loader as soon as it starts on Safari; the firewall refused it, and a first stand-in (an empty script) left Firebase waiting for its callback, holding the admin's start.
    - Found by: the Firefox and WebKit projects of the editors' forms (CR-M2c-7's follow-up).
    - Fix and pin: the fake upstreams answer `apis.google.com/js/api.js` with a loader that calls its callback without `gapi.load`, which Firebase handles as an unreachable loader (`google-apis.ts`, `upstream-google.test.ts`). The CSP messages WebKit logs for Playwright's own inspector styles and for the report-only Trusted Types header are expected only in the WebKit projects, each with its reason (`engineConsoleErrors`); the header is for the user (`DECISIONS-for-review.md` §37g).
    - **A stand-in must fail the way the real service fails, quickly: one that never answers holds whatever waits for it.**
110. **A long-lived emulator turned green journeys red.**
    - Seen: the History and drawing journeys failed in every project of a per-push tour, even alone, after hours of runs against one Functions emulator: its trigger queue was minutes behind (about three trigger runs a second, 25,000 runs), so a history entry or a manifest build came after the test's wait.
    - Found by: the admin tour's runs in the long-lived dev container; a fresh emulator passed the same run (126 of 127).
    - Fix and pin: none in the product; the pipeline starts its emulators per run, and the waits on the Functions emulator share `FUNCTIONS_TIMEOUT_MS` (120 s) for a full parallel run.
    - **Before blaming the code, look at how far behind the shared service is; restart a long-lived emulator before believing a wave of timeouts.**
111. **"Add at centre" placed a new place nowhere when it was clicked before the city's view was read.**
    - Seen: `flows/publish.spec.ts` at `admin-c360-ro` on the NUC: the place's list of positions stayed empty after the click; the map had no centre yet to give.
    - Found by: the split quality run, under the load of every worker.
    - Fix and pin: the drawing toolbar's "Add at centre" is off until the places page knows the city's view (`canAddCentre`, `centreKnown`; `map-elements.test.ts`, `pois-page.test.ts`).
    - **A control that needs data must be off until the data is there; a busy machine clicks before a person would.**
112. **Every admin page checked Google Analytics while the Setup's analytics card was the next step.**
    - Seen: `photos/publish.spec.ts` on the Photos page logged `setup-analyticsConfig` 400 ("not enabled") at start: the Setup Assistant runs on every page of an admin session, and opening its next step, analytics, ran the card's check and listed the crash groups.
    - Found by: the console guard, when a locked Setup test had left the project's `setup/status` at that step.
    - Fix and pin: the analytics card checks only while the Setup page shows (`setPageShown`, `controller.test.ts`, `module.test.ts`).
    - **A step's check belongs to its card on screen, not to a state machine that runs behind every page.**
113. **Tests without the lock read what the locked tests reset.**
    - Seen: the Admins page of a locked test lacked its owner (the list is the oldest 100 by `createdAt`, and the content worlds' admins were older and never removed); a content test of a removed admin saw the claim screen, because a locked test's reset had emptied `setup/owner` for a moment.
    - Found by: the split quality run (five admin projects, sixteen workers).
    - Fix and pin: a content world's admin joins after the personas (`JOINED`) and leaves at teardown (`ContentWorld.retire`); the removed-admin test moved to the locked `flows/revoke.spec.ts`.
    - **A lock-free test may touch only its own world: any answer that depends on a project-wide document belongs under the lock.**
114. **The first click of a new line or area vanished when its category arrived.**
    - Seen: the drawing tour at `tour-x3840-dark-ro` and `tour-c360-light-en`: four clicks gave an area of the last three corners, two clicks no line; the first click's dot showed, then went.
    - Found by: the admin tour under the split run's load, read from the trace (the positions kept were clicks two to four).
    - Fix and pin: the places map sets the drawing tools again for a shape not drawn yet only when they are in another mode; applying the same place again (its colour, once the categories arrive) no longer empties a started sketch (`map-session.ts`, `map-session.test.ts`).
    - **Re-applying the same state must be a no-op: a setter that also resets loses whatever the user started meanwhile.**
115. **A state was checked before the map its editor had just opened existed.**
    - Seen: `admin.photos.editor` at `tour-c360-light-ro`: "0 visible map attributions"; the wait for loaded maps saw no map yet and passed at once.
    - Found by: the admin tour, opening a photo from the compact list.
    - Fix and pin: the state check also waits while an admin map box is still creating its map (`status` `loading`, `mapsLoadedInPage` in `e2e/support/state-check.ts`).
    - **A wait for "every map loaded" passes on no map at all: wait for what is about to exist, too.**
116. **A locked test's reset deleted every content world's public photo files.**
    - Seen: `photos/publish.spec.ts` (unpublish) at `admin-c360-ro`: no public file of a photo just processed; the Undo of a delete could not restore a photo whose files were gone.
    - Found by: the targeted rerun of the split run's failures, beside the locked specs.
    - Fix and pin: the reset reads a Storage path's city where `STORAGE_PATHS` puts it (second in `photos/<city>/…` and `cities/<city>/…`, third in `uploads/photos/<city>/…` and `originals/photos/<city>/…`); it took the photo's id for the city of a public derivative (`storageKeptByReset`, `e2e/admin/support/emulators.ts`).
    - **A rule that keeps other tests' data must be checked against every path family it meets, not the first one written.**
117. **A new photo was refused as "changed by someone else" by its own first write.**
    - Seen: `photos/interrupted.spec.ts` at `admin-c360-ro` and `photos/upload.spec.ts` at `admin-l1440-dark` on the NUC: the photo document's create was answered 409 `ALREADY_EXISTS` although the document holding its data dated from that very commit; Firestore's SDK ran the transaction again, which found the document and reported a conflict, so the upload never started.
    - Found by: the split quality run, read from the trace's commit bodies.
    - Fix and pin: a create that finds a document holding exactly its data, stamped by the same admin, takes it as its own landed attempt (`#ownCreate`, `packages/admin/src/firebase/content.ts`, `content.test.ts`); any other document stays a conflict. The 409 Chromium logs for such a commit is expected in the admin projects with its reason (`FIRESTORE_COMMIT_RETRIED`, `e2e/admin/support/test.ts`, which also expects the 400 of a commit refused because a trigger wrote the document since the transaction's read).
    - **A transaction may run again after a commit whose answer was lost: its check must accept its own earlier write.**
118. **Saving a photo opened as soon as it was processed said another admin had changed it.**
    - Seen: `photos/publish.spec.ts` (publish on the first Save) at `admin-c360-ro`: "Someone else changed: published"; the upload queue had just written its suggestions (the place, the title) in a transaction, which the editor's listener had not delivered yet, so the Save's version check found a newer version and every changed field was named.
    - Found by: the targeted rerun of the photo specs beside the locked chain, read from the trace's commits.
    - Fix and pin: a Save refused for a newer version waits for that version, still saving (at most `REFUSED_WAIT_MS`); once it is the base, a change of other fields has merged in and the Save goes again, so its outcome is the second write's and what follows a Save (the remembered fields, "Saved") follows it; a change of the same fields is the conflict (`#decideRefusal`, `packages/admin/src/photos/draft.ts`, `draft.test.ts`). A first version retried in the background was found by `editing/sticky.spec.ts`: the Save said the conflict and the fields were not remembered.
    - **A version check is about the document; a conflict is about fields: decide it with the newer version in hand.**
119. **A test failed before it began: the Auth emulator dropped the sign-in of its content world.**
    - Seen: `photos/upload.spec.ts` at `admin-c360-ro`, a repeat of the photo specs beside the locked chain: `signInWithIdp` failed with `socket hang up (ECONNRESET)` while the fixture prepared the world.
    - Found by: the targeted rerun with `--repeat-each=2`.
    - Fix and pin: the emulator helpers send a request again when the emulator drops the connection, at most twice (`resending`, `e2e/admin/support/resend.ts`); every request they send is idempotent.
    - **A shared local service under load drops connections: the test's own plumbing must survive a reset; the product's requests are still checked as they are.**
120. **An admin of a deployed map was shown the start-up mode when the server's first answer was slow.**
    - Seen: `editing/drafts.spec.ts` (two tests) and `editing/sticky.spec.ts` at `admin-l1440-ro` in a split run: the places editor never came; the page asked to "confirm again with Google" to continue the setup. The one anonymous probe of `admin-session` had timed out after 10 s on a busy Functions emulator, which the shell took for "no server" for the whole visit.
    - Found by: the split quality run, from the failures' page snapshots.
    - Fix and pin: a probe that timed out is sent again, up to three in all (`PROBE_ATTEMPTS`, `packages/admin/src/auth/controller.ts`, `controller.test.ts`); a missing or unreachable server is still decided by the first answer (M2b-interfaces §1.4).
    - **A timeout is not an answer: a decision that sends a person somewhere else needs one, or a second try.**
121. **Undo of a photo's delete said "use History" although the delete's entry was there.**
    - Seen: `photos/publish.spec.ts` (Undo) at `admin-c360-ro` on the NUC, twice: the photo's history held the delete stamped `09:57:03Z` and the publish before it stamped `09:57:03.215Z`; Undo takes the newest entry by its stamp and found the update.
    - Found by: the split quality runs, from the history entries the test's own reads recorded in its trace.
    - Fix and pin: a delete's entry is stamped at the event's time but never before the version it deleted (a millisecond after it), since the Firestore emulator's event times have whole seconds (`deletedAt`, `functions/src/history/record.ts`, `record.test.ts`; M2-interfaces §2.2).
    - **An order built from two clocks needs a rule for when they disagree: a delete cannot come before what it deleted.**
122. **Leaving a settings section right after Save asked about changes already stored.**
    - Seen: the tour's settings journey at `tour-x2560-light-ro` (`tour-matrix`) and `editing/sticky.spec.ts`: Save, then another section at once: the unsaved guard's question, because a section's draft counted its changes as unsaved until the snapshot of its own write came back.
    - Found by: the split `all` run's tour matrix.
    - Fix and pin: the editing kit's draft is not unsaved right after a successful Save until the next edit (`#written`, `packages/admin/src/layers/draft.ts`, `draft.test.ts`), as the places' draft already was; the specs wait for the page's own "Saved" before they leave.
    - **A guard must ask about what the person would lose, not about what the page has not heard back yet.**
123. **The settings' round colour presets counted as covered at 320 × 568.**
    - Seen: `admin.settings.theme` in every `tour-c320-*` project (`tour-matrix`): the detail pane cut the presets row to its top 8 px, and two of the five points the occlusion check sampled in that strip lay outside the round buttons, where the hit is their own row.
    - Found by: the split `all` run's tour matrix, the first with the admin's journeys at every viewport.
    - Fix and pin: the checker samples a control only inside its own shape, its box without the corners its rounded border cuts off (`withinShape`, `e2e/support/dom-walk.ts`; `layout-probe.test.ts`); a control another element covers still fails. Nothing was allowlisted.
    - **A probe that samples a box must know the shape it stands for: a circle is not its bounding square.**
124. **The admin's Romanian put a number before a noun: "Ștergi 1 locuri?", "Au revenit 1 câmpuri", "Importă cele 45 fotografii", "De 1 ori".**
    - Seen: the M2d review screenshots (`reports/screenshots/m2d/`, the history's revert snackbar and the jobs, crashes and import cards) and the unit tests that pinned the wrong text (`Point, 1 positions`, `1 items`); Romanian needs "un loc", "2 locuri" and "45 de fotografii", English "1 place".
    - Found by: reading the contact sheets; the i18n gate checks keys and placeholders, not grammar.
    - Fix and pin: every admin count says "Noun: {count}" or "the selected nouns ({count})" (`admin-pois`, `admin-ops`, `admin-setup`, `admin-shell` catalogues; `pois-page.test.ts`, `history-page.test.ts`, `hcm-setup-analytics.test.ts`, `crashes-home.test.ts`, `i18n-admin.test.ts`); the same pass made "(opțional)" agree with feminine labels ("Descriere (română, opțională)"), the who of "Modificat de {who}" "tine" and "server" (`editor-chrome.test.ts`), deletes say "restaura din Istoric" as the History button does, the three editors' conflict buttons the same words, a layer's tiles "dale" everywhere, and the photos' empty state names the button instead of a drop a phone cannot make.
    - **A count goes after a colon or in parentheses unless the catalogue has plural forms; a test that pins "1 positions" pins a bug.**
125. **History showed a year as "1,980" and a geometry as "Point" or "LineString".**
    - Seen: the history's "Ce s-a schimbat" values (`describeValue`), pinned so by `history-page.test.ts`.
    - Found by: the M2d UX review of the history screens.
    - Fix and pin: years (`year`, `yearStart`, `yearEnd`) are formatted without grouping and a geometry's type uses the place editor's shape names ("Linie, poziții: 3") (`packages/ui/src/admin/history/describe.ts`, `history-page.test.ts`).
    - **A number that names something (a year, an id) is not a quantity: format it without a thousands separator.**
126. **A category's swatch sat inside its name, which then broke over two lines on a phone with its opacity under the swatch.**
    - Seen: `admin.settings.categories` and `categories-limit` at every viewport in the M2d review screenshots ("Categoria" / "01" beside a 40 px circle at 360 × 800).
    - Found by: the contact sheets; the tour's checkers passed it (nothing overlapped or was cut).
    - Fix and pin: a reorder row's `lead` is the row's first grid column beside both lines (`.row[data-lead]`, `packages/ui/src/admin/layers/reorder.ts`, `layers-styles.ts`; `categories.test.ts` measures the swatch left of the name and centred on both lines).
    - **A leading icon is a column of the list item, never an inline glyph in its title.**
127. **The settings repeated one bounds problem under all four edges, and told the admin to draw a rectangle on a map the page does not have.**
    - Seen: `admin.settings.area-invalid` in the M2d review screenshots: the same sentence four times at 360 × 800; the help text above them said "Desenează un dreptunghi pe hartă" while the settings page has no map yet (§37e).
    - Found by: the contact sheets.
    - Fix and pin: a problem of the bounds as a whole is said once below the four edges, each edge `aria-invalid` and described by it, an edge's own problem still at that edge (`issueShownAt`, `packages/ui/src/admin/layers/form-parts.ts`, `settings/area-section.ts`; `settings-page.test.ts`); the help says to type the four edges.
    - **A rule that spans fields is said once, where the fields are, and every field it names points to it; help text describes the screen that exists.**
128. **The timeline spec read the 1966 markers before the year's filter was drawn.**
    - Seen: `S-V04-HAPPY` at `fn-m768-ro` on the NUC in the final split `all` run of 2026-10-18: at the 1966 stop the map still drew today's eleven markers, among them `gara-obor` and `parcul-ferdinand-1930`.
    - Found by: the split `all` run; every other project passed it. The spec polled until the markers contained the 1960 photo, which today's markers already did, then read them once.
    - Fix and pin: one poll for the whole filtered set, the 1960 photo present and nothing outside 1956–1976 (`e2e/specs/viewer/timeline.spec.ts`).
    - **Poll for the state you assert, never for a part of it that the previous state already had.**
129. **The Setup cards' copy buttons stood at a different place in every row.**
    - Seen: `admin.deploy-waiting` in the M2 final screenshots (`reports/screenshots/m2-final/`), every viewport: the four repository variables' copy buttons zigzagged, each midway between its value and the row's end; the Mapbox scopes and the USGS request rows the same.
    - Found by: reading the contact sheets; nothing overlapped, so no checker could see it.
    - Fix and pin: a copy row's text takes the free space and the button with its "Copied." status follows it (`.copy-row > :first-child`, `packages/ui/src/admin/setup/setup-styles.ts`; `badPath_theCopyButtonsLineUpWhateverTheValuesLength` in `hcm-setup-credentials.test.ts` measures values of different lengths at 1000 px, where the old rule fails).
    - **`justify-content: space-between` over three items puts the middle one midway: give the text the free space instead, and test with values of different lengths.**
130. **The places editor put Save before Discard changes, the other editors after it.**
    - Seen: the M2 final screenshots, `admin.pois.editor` beside `admin.layers.editor` and the settings: Save, then Discard in places; Discard, then Save in layers and settings.
    - Found by: the contact sheets; each editor's tests checked its own buttons, never the order across editors.
    - Fix and pin: the places editor's head reads Discard changes, then Save at the trailing end (`packages/ui/src/admin/pois/hcm-poi-editor.ts`; `poi-editor.test.ts` pins the order).
    - **The same two actions keep the same order in every editor; Material puts the confirming one last.**
131. **The silent-refresh spec left the place editor while its Save was still on its way.**
    - Seen: `S-A20-HAPPY` at `admin-c360-ro` on the NUC in the final split `all` run of 2026-10-18: the address of the places list was held back and the editor stayed, saved.
    - Found by: the split `all` run; the spec waited for the write in Firestore (the emulator's REST API), which can hold it before the page has its answer, and a draft still saving holds a new address back (lesson 122).
    - Fix and pin: the spec waits for the page's own "Saved" before it leaves (`e2e/admin/specs/shell/shell.spec.ts`), as `editing/sticky.spec.ts` does.
    - **What the server holds is not what the page knows: leave a page only once the page says so.**
132. **Terra Draw's selection marks moved the photo's pin back over a place typed in its fields.**
    - Seen: `S-A09-BAD-PIN-OUTSIDE-CITY` at `admin-c360-ro` and `-l1440-ro`, the first run with Terra Draw (DECISIONS-for-review.md §41b): a longitude typed beyond the city went back to `26.1` before the field could say why.
    - Found by: the admin tier; the click tools passed it. A debug log of Terra Draw's events showed a `change` of type `update` with `{target: 'properties'}` (the pin's selection mark, as the port removed it) and the port's own updates with `{origin: 'api'}`; the port reported both as drags, and the photo editor took the pin's old place as the admin's.
    - Fix and pin: the adapter reports only geometry changes that do not come from itself (`packages/ui/src/map/draw/terra-draw-adapter.ts`; `terra-draw-editing.test.ts`: a reload and a click-move emit no echo, a properties change none).
    - **A library's change events include its own bookkeeping and your own API calls: report only what the user did.**
133. **A vertex drag released over the map's zoom button never ended.**
    - Seen: `S-A32-HAPPY-VERTEX-EDIT` at `admin-c360-ro`: the corner moved on the map but the list of positions kept the old one; the release point, 30 px east of the north-east corner, lay on the zoom-out button in the map's corner.
    - Found by: the admin tier at the phone's size; Terra Draw ends a drag only on a `pointerup` whose target is the map's canvas.
    - Fix and pin: the spec drags the corner into the map (`e2e/admin/specs/pois/dragging.spec.ts`), and its comment says why.
    - **A drag on a map ends where the map is: aim a release at the map, never at the controls over it.**
134. **A spec polled for five saved positions, which the seeded area already had.**
    - Seen: `S-A32-HAPPY-VERTEX-EDIT` at `admin-l1440-ro`: the poll passed at once, before Save had written, and the next assertion read the seed.
    - Found by: the failure screenshot (the editor still said "Saving…").
    - Fix and pin: the spec polls for the moved corner itself (lesson 128's rule again).
    - **Poll for the change, not for a shape the old value shares.**
135. **The Deleted filter of History was checked while its list still offered "Show more".**
    - Seen: `admin.history.deleted` at `tour-x3840-light-ro` on the NUC in the split `e2e` run of 2026-10-18: "Tab never reaches „Arată mai multe”"; twelve runs on the laptop passed.
    - Found by: the split run under load; the state was checked as soon as its Restore button showed, while the list behind the new filter could still answer from the cache with a further page, whose button then went.
    - Fix and pin: the tour waits until the filtered list offers no further page before the check (`e2e/tour/admin-history.tour.ts`).
    - **Check a state once everything it shows has settled, not once the one thing you need appeared.**
136. **The settings page rendered the admin map its chunk never defined.**
    - Seen: `S-A19-HAPPY`, `S-A36-HAPPY` and `S-A36-BAD-DISCARD` at `admin-l1440-ro`: "the admin map is created" never held; the area and overlays sections showed an empty box above the form.
    - Found by: the failure screenshot (the box had its size, nothing inside); the unit tests had passed because the ui test bundle defines every element.
    - Fix and pin: `defineSettingsElements` defines `<hcm-admin-map>`; `packages/ui/test/admin/editing/areas.test.ts` checks every chunk that shows the map defines it (DECISIONS-for-review.md §42a).
    - **A lazy chunk defines every element it renders; a test that loads all elements at once cannot see a missing one.**
137. **A conflict spec rewrote the document it had read back from the emulator.**
    - Seen: `S-A38-BAD-CONFLICT` at `admin-l1440-ro`: no conflict banner; the places list said there was no place at all.
    - Found by: the failure screenshot; the emulator's read gives timestamps and nested values in its own form, which the place schema refuses, so the list dropped the document and the editor heard no remote change.
    - Fix and pin: the other admin's save goes through the spec's own seed helper (`e2e/admin/specs/pois/conflict.spec.ts`).
    - **Write a document in its schema's shape; never round-trip one through a reader that changes its types.**
138. **A spec looked for an overflow menu's actions inside its `dialog` role.**
    - Seen: `S-A33-HAPPY-BULK`, `S-A10-HAPPY-RIGHTS-REVIEW` and `S-A38-BAD-DELETED-WHILE-EDITING` at `admin-l1440-ro`: the action button was never found, the dialog was open and named.
    - Found by: a diagnostic run listing the dialog's buttons: only Close. The actions are slotted into `hcm-dialog`, so they are children of the host element, not of the native `<dialog>` in its shadow root, which a locator scopes to.
    - Fix and pin: `menuDialog` and `chooseInMenu` (`e2e/admin/support/menu.ts`) look inside the open `hcm-dialog` host; the photos and places tours use them.
    - **Scope a locator to the element that holds slotted content, not to the shadow element that renders it.**
139. **The places' conflict banner put its text beside its two buttons.**
    - Seen: `admin.editing.conflict` at `admin-c360-ro` in the split `quality` run: Keep mine 76 px wide, covered by Take theirs, its touch target 44 px.
    - Found by: the generic layout and accessibility checkers on the new state (until then no spec checked the banner at a phone's width).
    - Fix and pin: the banner stacks its text above the actions (`.alert-body` of the editing kit), as the layers' banner did; the state runs at every admin project.
    - **On a phone, a banner's actions go under its text, never beside it.**
140. **A spec clicked "the confirm button of the confirmation dialog" on a page with two.**
    - Seen: `S-A06-HAPPY-ROTATE` at `admin-steps-l1440-en`: strict mode found Discard changes (the unsaved guard's) and Replace.
    - Found by: the split run; the laptop's single run had passed by the order the elements happened to come in.
    - Fix and pin: the spec takes the confirm button of the dialog it opened, by its name (`e2e/admin/steps/mapbox.spec.ts`).
    - **Locate an action inside the dialog it belongs to, by its name, never by a class every dialog shares.**

141. **An opened photo or place stayed off its editor's map.**
    - Seen: the 2026-10-18 review screenshots of `admin.photos.editor` at 360×800 to 1440×900: the open photo's pin was below the map's box, because the map opened at the city's starting view (here the bounds' centre) and nothing moved it; the photos area had a `focusPhoto` intent no element called, and the places map had none.
    - Found by: the review screenshots (`HCM_STATE_SCREENSHOTS`, docs/TESTING.md → *Review screenshots*); no checker can see that the edited item is outside the map.
    - Fix and pin: the photos map session's `reveal` and the places map's `#reveal` centre the map on the opened item once (its zoom kept, no animation; a new place, with nothing drawn, and an edit of the open item move nothing) (`packages/admin/src/photos/map.ts`, `packages/admin/src/pois/map-session.ts`); `S-A09-HAPPY-OPEN-IN-VIEW` (`e2e/tour/admin-photos.tour.ts`), `S-A32-HAPPY-OPEN-IN-VIEW` and `S-A32-BAD-NEW-PLACE-KEEPS-VIEW` (`e2e/admin/specs/pois/in-view.spec.ts`), and unit tests in `packages/admin/test/photos/map.test.ts` and `packages/admin/test/pois/map-session.test.ts`.
    - **An editor with a map brings the item it opens into view; an intent no element calls is a missing behaviour, not a finished one.**

142. **The dashboard's tiles in one row had different heights.**
    - Seen: `admin.home.dashboard` at every size: in "Waiting for you", the tile whose label wraps to two lines was taller than its neighbours.
    - Found by: the review screenshots; the grid stretched each list item to the row's height, but the link inside it, the visible tile, kept its own height.
    - Fix and pin: the list item is a flex box and the tile grows to fill it (`packages/ui/src/admin/home/hcm-home-page.ts`); the M2e review's contact sheets of the dashboard show the rows even.
    - **In a grid of cards, stretch the visible card, not only the grid item that holds it.**

143. **A portrait phone laid the places editor over the "Set up Mapbox" note.**
    - Seen: `admin.pois.editor` without a map token at the `tour-c320-*` projects (320 × 568): "Configurează Mapbox" covered by Save and Discard changes.
    - Found by: the tour matrix in the split `all`; the per-push projects (360 px and up) never measured a compact height there.
    - Fix and pin: the box without a map no longer shrinks (`:host([no-map]) { flex: none }`, `packages/ui/src/admin/map/hcm-admin-map.ts`), and the map-beside-the-form layout of a compact height needs a medium width (`packages/ui/src/admin/editing/wide-layout.ts`); `S-A32-BAD-NO-MAP-TOKEN` at `tour-c320-*`.
    - **A height class measured on the page area is compact on a portrait phone too while its bar shows; a layout meant for a landscape phone also asks for its width.**

144. **The legal-line rule asked for a logo on a 4 px strip of map.**
    - Seen: `admin.settings.area-refused` at `tour-m768-*`, the settings pane scrolled to its end: "0 visible Mapbox logos instead of exactly one", the map's last 4.6 px at the pane's top and its controls 6 to 10 px above its foot.
    - Found by: the scroll sweep of the tour matrix.
    - Fix and pin: `showsItsFoot` also asks that the visible strip be taller than the band under the lowest legal control (`legalGap`, `e2e/support/layout-probe.ts`; `e2e/test/layout-probe.test.ts`); one pixel of a control on screen and the rule applies (`docs/research/DECISIONS-for-review.md` §43b).
    - **Make a checker exact where it is wrong, with a unit test of both sides of the edge; never quiet it with an allowlist.**

145. **History's Deleted filter offered "Show more" for good in the shared emulators.**
    - Seen: `S-A23-HAPPY-RESTORE-DELETED` at `tour-x3840-*-en` on the NUC: the spec of lesson 135 waited 15 s for "Show more" to go.
    - Found by: the tour matrix; the recent-changes query reads every city's `history` and the page leaves the others' entries out (CR-M2c-14), so a page full of other tests' deletions has more to show.
    - Fix and pin: the tour waits for the server's answer (no "Reconnecting…" status) and lets "Show more" be (`e2e/tour/admin-history.tour.ts`).
    - **In shared emulators, wait for the state's own signal of having settled, not for a value other tests can change.**

146. **Offline, the places editor turned Save off: the place's category read as unknown.**
    - Seen: `S-A38-BAD-OFFLINE` at `admin-l1440-dark`, then at `admin-l1440-en` with Save already on before going offline, on the NUC: "Reconnecting…", the place's row "Unknown category", "Cannot save: the value refers to an item that does not exist", and the click on Save waited out the test.
    - Found by: the split `all` on a loaded machine; a categories listener answered from the cache offline with no category (Firestore's memory cache keeps nothing for a listener attached again), and the draft's check took that list as the city's.
    - Fix and pin: the draft checks the category only against a list the server answered (`#context` in `packages/admin/src/pois/pois.ts`; `badPath_offlineAnEmptyCachedListOfCategoriesDoesNotTurnSaveOff` in `packages/admin/test/pois/pois.test.ts`); the spec also waits for Save to be on before `setOffline(true)` (`e2e/admin/specs/editing/drafts.spec.ts`).
    - **A list answered from the cache is not the truth about what exists: never refuse an edit on it.**

147. **"Configurare" broke over two lines on a 320 px navigation bar.**
    - Seen: the failure screenshots of the tour matrix at `tour-c320-*`: "Configurar" and "e" (lesson 83 fixed 360 px).
    - Found by: a person looking at the screenshots; the label test measured 360 px only.
    - Fix and pin: the bar's labels follow their item's width below about 70 px (`font-size: min(label-medium, 17cqi)`, `packages/ui/src/admin/shell/hcm-admin-nav.ts`); `packages/ui/test/admin/shell/nav-and-menu.test.ts` measures 360 and 320 px.
    - **Measure a label at the narrowest window the tour visits.**

148. **A spec changed the address while its category's save was still settling.**
    - Seen: `S-A39-BAD-LOW-CONTRAST-COLOUR` at `tour-x2560-light-ro` on the NUC: "Discard your changes?" stood over the next category's Delete for the rest of the test.
    - Found by: the second split `all`; the spec waited for the saved colour in the emulator, which the write reaches before the editor hears back, and the snackbar it also waited for was the first save's.
    - Fix and pin: the spec waits for the editor's own "Saved" status before it goes to another address (`e2e/tour/admin-settings.tour.ts`).
    - **A document in the database is not the page having saved it: wait for what the page says.**

149. **Other tests' cities pushed this city's own History rows off the page during the Tab round.**
    - Seen: `admin.history.recent` at `tour-x3840-dark-ro-admin` on the NUC: "Tab never reaches "Orașul w-… Creat de server …"": the test's own city's creation entry was among the targets, then gone from the list before the Tab round reached it, and "Show more" was offered.
    - Found by: the split `all`'s tour matrix; the recent-changes query read the newest 50 entries of every city's `history` and the page left the others' out (CR-M2c-14), so the shared emulators' other tests, writing entries at the same instants, decided which of this city's entries made the page, and changed it while the checkers ran.
    - Fix and pin: every history entry names its city (`cityId`, written by the history triggers and `history.revert`; `historyEntryDocSchema`), the query asks `cityId ==` the city first (`recentQuery`, `packages/admin/src/history/entries.ts`) with collection-group indexes that start with it (`firebase/firestore.indexes.json`, `firebase/rules-tests/test/indexes.test.ts`), and the rules test checks that only the city's entries answer (`firebase/rules-tests/test/history.test.ts`); the tour writes a newer deletion of another city and asserts it is never listed and that the city's few entries offer no "Show more" (`S-A23-BAD-OTHER-CITY`), and waits for the city's own creation entry before its checkers. Lesson 145's tolerance went.
    - **Filter a shared collection on the server by what the page owns; a page that drops other owners' rows still lets them decide its limit.**

150. **Every GeoTIFF upload was refused, whatever was in it.**
    - Seen: in the e2e admin tier (2026-10-23), each Upload ended as a failed `geotiff-import` job with `apiError.invalidRequest`, no version, and the file deleted.
    - Found by: the S-A14 specs of e2e-fakes; the functions tests built the object's metadata from what the upload dialog writes, while Storage (the emulator as production) adds the SDK's own `firebaseStorageDownloadTokens`, which the strict `rasterUploadMetadataSchema` refused (CR-M3-32).
    - Fix and pin: `imagery.onRasterUpload` validates only the dialog's three keys (`uploadMetadataOf`, `functions/src/imagery/on-raster-upload.ts`), with a functions test that carries the token; `S-A14-HAPPY`, `S-A14-BAD-NOT-GEOREFERENCED`, `S-A14-BAD-LARGE-RESUMABLE`.
    - **Validate what you own out of a map that others also write: a strict schema over a shared document refuses their keys, and the fakes that build it from your own writer never show it.**

151. **Leaving the georeferencer threw an uncaught error and reported a crash.**
    - Seen: Save in the georeferencer (or any navigation away) logged `Cannot read properties of undefined (reading 'removeEventListener')`, which the crash reporter then posted.
    - Found by: the e2e console guard (CR-M3-34); the factory's unit tests destroyed a handle whose fake map had nothing to remove, and every M2c editor that draws had left its tools before its page went.
    - Fix and pin: the admin map's handle detaches its drawing tools synchronously, while the map still has its canvas, then removes the map; tools still loading are detached when they arrive (`packages/admin/src/map/factory.ts`, `packages/admin/test/map/factory.test.ts`); `S-A16-HAPPY`, `S-A12-BAD-AUTOGCP-FAILS`.
    - **Tear down in the reverse order of setting up, and synchronously: a promise's `then` runs after the thing it needs is gone.**

152. **An import the policy approved, but this month's Mapbox budget stopped, offered no way out.**
    - Seen: the version said "Does not fit this month's Mapbox budget: choose how to go on" and showed no choice.
    - Found by: e2e-fakes' over-budget spec (CR-M3-33): the version page drew the approval card for `awaiting_approval` only, and a version the policy approved is `approved` with the guard's verdict `over`; the unit tests had only reached the card through a manual Approve.
    - Fix and pin: the page shows the card for an approved version whose guard stopped it (`awaitsDecision`, `packages/ui/src/admin/imagery/version-detail.ts`); `S-A42-BAD-OVER-BUDGET`, `S-A14-BAD-REPLACE-OVER-GUARD`.
    - **A state that says "choose" must draw its choices however it was reached: test every way into a waiting state, the automatic one too.**

153. **A refused upload's message read "problems found: {count}".**
    - Seen: the version page of an upload with a bad year.
    - Found by: the e2e placeholder guard (CR-M3-35 f); the trigger recorded the code `apiError.invalidRequest` without the parameter its text names.
    - Fix and pin: the trigger records a refusal's parameters on the job (`{ count }`, the schema's issues, or 1 for a missing year); `functions/test/imagery/upload.test.ts`.
    - **An error code whose text has a placeholder is incomplete without its parameters: store them where the code is written.**

154. **The georeferencer's radios and checkboxes could not be seen in high contrast, and its table scrolled sideways.**
    - Seen: at every admin project the native 20 px inputs' borders reached 1:1, a selected row's checkbox and Delete 2:1 in light high contrast, the targets were 20 px on phones and tablets, and the pairs' table scrolled sideways below 840 px.
    - Found by: the generic checkers at the georeferencer's states (CR-M3-35 i); the unit tests ran axe, which does not measure non-text contrast or targets.
    - Fix and pin: the inputs are drawn like the kit's (a 2 px border, a 48 px `::after` target, `class="touch-target"`); a selected row hands its own on-container colours to its controls; the table fits its box: the origin goes under the pair's name, and a container query drops the pixel and place columns under 560 px (`packages/ui/src/admin/georef/`); `S-A16-*`.
    - **In a selected row every control takes the row's on-container colours (high-contrast containers are dark), and a data table must fit the narrowest box it is shown in.**

155. **Importing a free scene took two clicks where the contract promised one.**
    - Seen: open the scene, then Import; the list's cards had no Import (`docs/research/M3-interfaces.md` §10.2).
    - Found by: the e2e input budget (CR-M3-35 d), which e2e-fakes had set to the screen's two clicks rather than the contract's one.
    - Fix and pin: each free scene's card has its own Import, named after the scene; `importScene` is one input again (`S-A12-HAPPY`, `S-A12-HAPPY-AUTO-PUBLISHED`).
    - **When a screen and its input budget disagree, fix the screen; a budget raised to match a screen measures nothing.**

156. **A 40 px button's touch target was 44 px wherever the page put something right under it.**
    - Seen: the detail pane's Close and Back to list on the Imagery area (its map starts the pane), each target year's Remove in Settings, the filter chips' wrapped rows.
    - Found by: the generic checkers' target sizes on compact and medium windows (CR-M3-35 e, j); the M2c areas had padding under their Back row by chance.
    - Fix and pin: `hcm-list-detail` keeps 4 px under its Back row, each target year's row is 48 px, the filters' rows are 16 px apart (lesson 83's chips).
    - **A 40 px control's 48 px target needs 4 px clear on every side from whatever a page puts next to it: make the container keep it, not each page.**

157. **The layer editor's map attribution read as one block of text.**
    - Seen: an imagery layer's attribution ("USGS EarthExplorer", then © Mapbox © OpenStreetMap) left Mapbox's links distinguishable by colour only (axe `link-in-text-block`, serious).
    - Found by: the generic checkers at the layer editor with an imagery layer (CR-M3-35 l); the M2c layers had no attribution of their own.
    - Fix and pin: the admin map underlines the attribution's links (`packages/ui/src/admin/map/hcm-admin-map.ts`); `S-A16-HAPPY-CROP`.
    - **Links that run into text need a cue besides colour, inside a third-party control too.**

158. **A layer could be deleted while its new image was being made.**
    - Seen: `layers.delete` looked for busy jobs by `params.layerId`, which M2's jobs carry and M3's raster jobs do not (they name the layer at the top level).
    - Found by: fn-imagery's review (CR-M3-24).
    - Fix and pin: the check asks both fields and refuses a layer with a `pendingVersion` (`functions/src/layers/delete.ts`, `functions/test/layers/delete.test.ts`).
    - **When a new kind of record names its subject in a new place, every query that guards that subject must learn the new place.**

159. **The admin's tab title stayed Romanian while its screens followed an English browser.**
    - Seen: on the deployed admin (2026-10-23), "Administrarea hărții" in the tab of an English page.
    - Found by: a person; the tour checks `lang` through axe but never the title, which the static page sets once.
    - Fix and pin: the shell sets `document.title` (the app's name in the admin's language) with `<html lang>` (`packages/ui/src/admin/shell/hcm-admin-shell.ts`); `S-A21-HAPPY-DOCUMENT-TITLE`, `S-A21-BAD-UNSUPPORTED-LANGUAGE`.
    - **What a language switch changes includes what the browser shows outside the page: the title and the `lang` attribute.**

160. **The stitch matched the wrong place, and a later step read a stale step record.**
    - Seen: on the synthetic frames, a 256 px template over a 300 px segment overlap matched off by a strip; `extract` read the `steps.fetch` of the job it was started with.
    - Found by: the pipeline's integration tests on the synthetic scenes with a known transform (CR-M3-20).
    - Fix and pin: the template is narrower than the overlap, and every step re-reads the job before it starts (`pipeline/src/hcm_pipeline/steps/`); `S-P01-HAPPY`, `S-P01-BAD-SIGTERM-RESUME`.
    - **A resumable step reads the state it resumes from at its own start, never from the run that launched it.**

161. **A city's imagery settings passed the rules' expression limit only at their largest.**
    - Seen: a city write with 20 target years, checked element by element inside the city validator, was refused while every smaller one passed.
    - Found by: `firebase/rules-tests/test/limits.test.ts` at the limits (CR-M3-25): the 1000-expression budget counts each use of a function argument again.
    - Fix and pin: the `imagery` settings are written alone, in a write that changes nothing else but the stamp (CR-M3-23), and validated there; the Settings section saves on its own.
    - **Test a security rule at its largest legal document: expression budgets fail only at the edge.**

162. **The e2e world's own runs leaked between tests.**
    - Seen: a run held and then cancelled stayed in the held set (the next Release counted two); a stand-in run without its version left its job `starting`, using one of the server's two running slots (`RUNNING_JOBS_MAX` counts every city); a content world's USGS wait set in the past let another spec's `imagery.tick` start runs in it.
    - Found by: e2e-fakes while building the imagery world (CR-M3-36).
    - Fix and pin: cancelled runs leave the held set, a run without its version fails its job as the pipeline does, seeded waits end in 2100 (`e2e/admin/support/imagery-runner.ts`, `imagery-run.ts`); `S-A00-*-IMAGERY-*`.
    - **A fake that counts shared capacity must release it on every way a run ends, as the real thing does.**

163. **A map scrolled to its last few pixels was said to hide its Mapbox logo.**
    - Seen: `admin.imagery.version-usgs-wait + text spacing` at the three large admin projects: "0 visible Mapbox logos instead of exactly one". The Tab round had left the version's pane scrolled to its end, with 1 to 10 px of the Imagery map's foot showing: Mapbox's attribution sits on the foot, its logo 10 px above it.
    - Found by: the generic checkers (CR-M3-35 k). Lesson 144's rule owed both controls as soon as the strip passed the band under the *lowest* one, which on the admin map (the attribution on the foot) is any strip at all.
    - Fix and pin: the probe asks about each control on its own (`legal.owes` in `e2e/support/layout-probe.ts`): a strip owes the controls it reaches, and two of a kind are still one too many; `e2e/test/layout-probe.test.ts`, `layout-rules.test.ts`; `S-A12-BAD-USGS-MAINTENANCE`.
    - **A rule about what must be visible owes each thing only where it could be seen: measure the reach per element, not per group.**

164. **The real pipeline's first run under the admin tier reached the real USGS delivery host.**
    - Seen: the first `S-P01-HAPPY-ADMIN` run (2026-10-24) logged in to the fake M2M but then fetched the signed address the fake had issued, `https://dds.cr.usgs.gov/e2e/download/…`, from inside the quality container, and the real host answered 404. (One GET of a made-up path with a fake signature: no credential, no data.)
    - Found by: the admin tier's real-pipeline spec; the pipeline's own tests serve their deliveries on loopback, and the e2e fakes signed theirs on the real host, which only the browser's firewall and the Functions emulator's forward had kept away from the internet so far. A Python process has neither.
    - Fix and pin: the fake signs its addresses on a configurable origin, the e2e mock APIs' loopback forward (`delivery.origin`, `e2e/mock-apis/main.ts`); and the pipeline is sealed under the emulators: every service root must be on loopback (`config_problems`) and every address from data must be this machine's by name, never resolved (`check_emulated_url`, the delivery client's hook, the STAC assets); `pipeline/tests/unit/test_urlguard.py`, `test_config.py`, `test_run_command.py`, `test_steps_edges.py`.
    - **A test process outside the browser has no firewall: seal it in its own code (loopback only under the emulators), and make every fake hand out addresses on the machine.**

165. **The real pipeline's documents and the shared fakes disagreed where only a real run meets them.**
    - Seen: under the admin tier the pipeline logged in as `e2e-user` with the token `e2e-ok`, which the shared USGS fake does not know (its users are `e2e-ok` with `e2e-usgs-app-token-ok`); then a version waiting for points carried `error.params.pairs` as a number, which the admin refused to read (`invalid-document`: error parameters are texts); then a published job kept its `tiles` step `running`.
    - Found by: `S-P01-HAPPY-ADMIN`; each side's tests used its own fakes (the pipeline's loopback M2M accepted `e2e-ok`; the golden version waiting for points has no error), and fn-imagery's publish test asserted the job's status, not its steps.
    - Fix and pin: `EmulatorSecrets` answers the shared fakes' user and token of the scenario; the pipeline writes `{ pairs: "<n>" }`; finalize marks a running `tiles` step done (`functions/test/imagery/publish.test.ts`).
    - **Run each side against the other's fakes once before calling a contract kept: golden documents prove the shapes you thought of, not the ones a real run writes.**

166. **The tick's monthly harvest searched USGS for every city that had never been harvested, every five minutes.**
    - Seen: `S-A12-BAD-USGS-MAINTENANCE` timed out on `imagery.tick` (the e2e helper's 60 s) late in the quality run of 2026-10-24: the emulators held 79 cities by then (the content worlds, kept by the reset), and the tick harvested each, three datasets and the browse copies apiece. In production the same rule would search every 5 minutes for a city whose area holds no frame, since "never harvested" is read off the newest scene.
    - Found by: the split quality run; the unit test `happyPath_aCityNeverHarvestedIsHarvested` had written the rule down as intended.
    - Fix and pin: the tick repeats only a harvest older than `HARVEST_EVERY_DAYS`; a city never harvested waits for its first visit (CR-M3-44, `tick.test.ts`); the e2e tick waits `FUNCTIONS_TIMEOUT_MS`.
    - **A periodic job keyed on "the newest record is old or missing" runs forever when the answer is legitimately empty: key it on something the job itself writes, or leave the empty case to the user's visit.**

167. **The content worlds' seeded running jobs filled the project's two pipeline places.**
    - Seen: at `admin-c360-ro` on the NUC every import after `S-A18-BAD-STREAM-DROP` and the jobs tour stayed "Waiting for other jobs to finish" (cancel, retry, maintenance, the georeferencer's degenerate pairs, crop, replace, the guard), each failing after two minutes; on this machine the same specs passed, the content specs having run in another order.
    - Found by: the split quality run; the dispatcher counted every city's `starting` and `running` jobs, and those specs seed a `running` job without a lease in a content world the reset keeps.
    - Fix and pin: the cap counts the jobs holding an execution, `starting` or `running` with its lease held; a lapsed lease is a lost run the tick recovers (CR-M3-45, `dispatch.test.ts` `happyPath_aRunWhoseLeaseLapsedHoldsNoCapacity`).
    - **Every project-wide counter is shared state between test worlds that never reset: count what really holds the resource (a live lease), so a world's seeded display state cannot take another's place.**

168. **A navigation label that is a prefix of another's matched both.**
    - Seen: `S-A35-BAD-DISCARD` failed at every project in 2 s: `getByRole('link', { name: 'Istoric' })` matched "Imagini istorice" too, once M3 added the Imagery entry; the crop's notice text matched the snackbar and its live region.
    - Found by: the quality run after the integration of the imagery area.
    - Fix and pin: `exact: true` on the History link; the notice asserted on `hcm-snackbar`.
    - **Name a navigation link with `exact: true`, and a notice by its component: a new entry or an announcer copy turns a substring match into two.**

169. **Retired content worlds still counted against the project's Mapbox tileset limit.**
    - Seen: run on this machine alone (2026-10-24), `S-A16-HAPPY-CROP`, `S-A14-HAPPY-REPLACE-SOURCE`, `S-A16-HAPPY-REGEOREF-LAYER` and `S-A42-BAD-OVER-BUDGET` at `admin-c360-ro` stopped at Approved with "Mapbox already holds 24 tilesets": the guard counts every city's layers carrying `mapbox.tilesetId`, and 72 of them were in the cities of content worlds whose tests had ended (the settings world seeds a published layer).
    - Found by: the quality stage without the NUC: one emulator held twice the worlds of a split run.
    - Fix and pin: a content world retires its city's document at teardown with its `admins` document (`ContentWorld.retire`), so every walk over `cities` (the tileset limit, the running cap, the tick) sees only the worlds still running; what lies below stays for the reports.
    - **A test world that outlives its test is still part of every aggregate the product computes: end it when the test ends, not when the run does.**

170. **The stand-in runner's own bookkeeping lagged behind what the page showed.**
    - Seen: `S-A16-HAPPY-REGEOREF-LAYER` at `admin-l1440-en-imagery` (the M3 screenshot run on the NUC): `imagery.release()` answered 0, the re-georeference run still dispatching while the spec had already checked the layer's pending version; `S-A12-BAD-RETRY` at `admin-l1440-dark` (the split run): `imagery.runs()` still listed the second run `running`, the page already showing Awaiting approval from the run's last write.
    - Found by: the screenshot run, whose resizing slowed the page side, and the split quality run.
    - Fix and pin: the specs poll `release()` until it lets one run go (`layer-geometry.spec.ts`, `published.spec.ts`) and poll `runs()` until both runs ended (`import.spec.ts`).
    - **A fake's record of its own work is one more eventually consistent view: poll it like the page, never read it once after the page moved.**

171. **A publish could reach Mapbox twice while the compute-unit guard counted it once.**
    - Seen: `imagery.publish`'s start task never asked whether its publish had already reached Mapbox: a job `mts_processing` with its version `publishing` passed the guard as "go on", so a redelivered start task, or the tick's recovery of an upload slower than 20 minutes, uploaded the COG again (replacing the source an MTS job was reading) and published again. The unit test `happyPath_aRetriedStartGoesOnFromWhereItIs` expected exactly that.
    - Found by: the M3 security and cost review (2026-10-24), reading the code against the contract (§7.3: "a retry with a matching source goes straight to finalize"); every test that made a second start had asserted the second publish.
    - Fix and pin: a start with an MTS job recorded polls it; the upload is skipped when this publish uploaded the same file (`steps.upload.sha256`); the publish call is marked (`steps.publish: running`) in a transaction before it, and a retry that finds the mark without a job id lists the tileset's jobs (`MapboxTilesets.listJobs`) and follows the one Mapbox started; the tick names its recovery after the job's last write (`stale-<ms>`), so a job that stays stale is queued once (CR-M3-47; `S-A42-BAD-DUPLICATE-PUBLISH`, `publish.test.ts`, `tick.test.ts`).
    - **Before a paid call, write down in a transaction that you are about to make it; after a retry, look for what the call left before calling again. "Already reserved" is not "not sent yet".**
172. **A publish that never got its Mapbox job looped for good, and nothing could stop it.**
    - Seen: a Mapbox timeout or a missing COG is retried by Cloud Tasks, and a failed attempt wrote nothing on the job, so its stamp stayed old and every tick queued another start (`retry-<now>`, five deliveries each): 12 an hour, each streaming the COG again, while Cancel on `mts_processing` only logged a line, Reject refused it, the budget guard did not reach the publisher and the reservation stayed held all month. `imagery.retry` after a publish failure was unlimited too (the publisher never counted).
    - Found by: the M3 security and cost review; no test made a start fail more than once.
    - Fix and pin: every start counts `publishAttempts` in a transaction and the job fails `apiError.imagery.attemptsExhausted` past `PUBLISH_MAX_ATTEMPTS` (6), freeing its reservation; `imagery.retry` refuses a publish out of attempts; a red budget guard holds the publish before anything reaches Mapbox and the tick queues it again once green; Cancel ends a publish that has not asked Mapbox yet (`S-A42-BAD-PUBLISH-ATTEMPTS`, `S-A12-BAD-CANCEL-BEFORE-MAPBOX`, `S-A12-BAD-GUARD-PAUSED`).
    - **Every retry loop needs a counter written on each attempt, and every recovery a task id that stays the same while nothing changed: an attempt that writes nothing looks new to every recovery, forever.**
173. **A layer's deletion job could destroy a newer version that took the deleted layer's id.**
    - Seen: `reserveLayerId` left out existing layers and unfinished versions but not queued `layer-delete` jobs, so during the 7-day grace an import of another frame of the same pass (same label, same id), a re-import of the scene or a re-upload of the same file name got the deleted layer's id; when the deletion fell due it deleted the deterministic tileset, its source and the whole `rasters/{city}/{layer}/` prefix, the newer version's scan and COG included.
    - Found by: the M3 security and cost review; the layer-delete tests never had a version of the same id.
    - Fix and pin: a queued deletion's layer id stays taken; a due deletion waits while an unfinished version holds the id, and deletes only the files of the versions made before the deletion (`S-A33-BAD-ID-REUSED`, `layer-delete.test.ts`, `import.test.ts`).
    - **A deferred clean-up keyed by a name keeps the name reserved until it runs, and checks again when it runs that nothing new answers to that name.**
174. **The tileset cap could be passed by two first publishes at once, and missed deleted layers' tilesets.**
    - Seen: the guard counted only layers with `mapbox.tilesetId`, read outside its transaction; a first version's layer is created at finalize, so publishes under way and the tilesets of deleted layers still in their grace were invisible, and two first publishes on the 1st of the month (every deferred publish at once) each saw 23 and both passed.
    - Found by: the M3 security and cost review.
    - Fix and pin: the count adds the queued deletions that name a tileset and the versions `publishing` for a layer without one, and, read in the guard's own transaction on the month's counter, the reservations marked `newTileset` (`S-A42-BAD-RACING-TILESETS`).
    - **A cap counts what will exist as well as what exists (work in flight, things waiting to be deleted), and reads the part that can race in the same transaction as the decision.**
175. **The monthly harvest still ran every five minutes for a city whose harvest wrote nothing.**
    - Seen: CR-M3-44 had stopped the tick for cities never harvested, but for a city harvested once, "due" was still read off the newest scene's `harvestedAt`: when every dataset failed (M2M access withdrawn, maintenance), every record was refused or the area moved, nothing got a new `harvestedAt` and each tick logged in and searched three datasets again, 288 times a day; revoked credentials meant a refused login every five minutes. The page said "USGS found no scene over the city's area" when no dataset had answered.
    - Found by: the M3 security and cost review and the minimum-input review, both from the code.
    - Fix and pin: every attempt is recorded in `ops/harvest-{city}` (outcome, failures, `nextAt`): a month after a harvest that answered, an hour after a failure, doubled after each further one; a search no dataset answered fails `apiError.usgs.unavailable` (or `maintenance`) with Try again; a refused login marks the USGS card, which stops the tick (`S-A11-BAD-HARVEST-BACKOFF`, `S-A11-BAD-USGS-UNAVAILABLE`).
    - **Key a periodic job on a record the job writes on every attempt, success or failure, and back off after a failure; lesson 166 fixed the case that never ran, not the one that ran and wrote nothing.**
176. **The two-runs cap could be passed by dispatchers racing for the last place.**
    - Seen: `busyExecutions` ran a query before the transaction that moves a job to `starting`, so up to five trigger instances and the tick could each see one place free and each start a Cloud Run execution (possibly on 8 vCPU machines).
    - Found by: the M3 security and cost review; the fake document store runs transactions as they come, so no unit test could see the race.
    - Fix and pin: the transaction reads and writes `ops/dispatch`, one slot per job holding an execution, each slot's job read again (a slot of a run that ended, or of a city that is gone, is dropped); the test queues the transactions as Firestore does (`S-A12-BAD-RACING-DISPATCH`, `dispatch.test.ts` `serialiseTransactions`).
    - **A count read outside the transaction that acts on it is advice, not a guard: keep a document both read and written in that transaction, and make a test fake serialise transactions where the real database would.**
177. **Cancel, Reject, re-georeference and Replace acted on what they had read before their transaction.**
    - Seen: a Reject or Cancel that read `awaiting_approval` could commit after the guard moved the job to `mts_processing`, releasing the reservation and marking the version rejected while Mapbox published it; `replaceBase` could cancel a base the guard had just taken, and two Replace uploads could both pass the busy check. Re-georeferencing a first import awaiting approval cancelled its job, and the dispatcher's release then freed its scene while the new version kept the layer id (Find offered Import again).
    - Found by: the two M3 reviews; `save-gcps.test.ts` never ran the trigger after the save.
    - Fix and pin: `endWork` takes the job and version it accepts (`accept`), checked in its transaction; the re-georeference reads the base and the layer again in its transaction; the upload reads the layer before writing its pending version; the release spares a scene whose layer id another unfinished version holds (`S-A12-BAD-CANCEL-BEFORE-MAPBOX`, `S-A14-BAD-REPLACE-RACE`, `S-A16-BAD-REGEOREF-KEEPS-SCENE`, which runs the trigger).
    - **Check every precondition again inside the transaction that acts on it, and run the triggers a write sets off in the test of that write.**
178. **"I uploaded it" found the layer's own MTS tileset and published its old tiles.**
    - Seen: `imagery.studioDone` matched a tileset by the layer's name or id, which is exactly what the layer's MTS tileset is called: a Replace, a re-georeference or a crop over budget that chose Studio was "published" with no upload at all, and the earlier version superseded.
    - Found by: the M3 security and cost review.
    - Fix and pin: the layer's current tileset is never the upload, and neither is one Mapbox says it created before the choice (`S-A42-BAD-STUDIO-NOT-UPLOADED`; the HTTP fake now reports when it created a tileset).
    - **When finding "the thing the user just made", leave out what existed before the request and what is already in use.**
179. **A budget pause had no way out, and the publish failures only offered Try again.**
    - Seen: once the 5 USD alert turned `ops/guard` red, Import, Retry, Save points and Crop were refused for good ("Processing is paused…") with no screen to turn it back on; a source too large for Mapbox, a revoked token or a missing scope failed the version with Retry forever (each retry streaming the COG again), the scope message showed a literal `{scopes}`, an upload the server refused offered a Retry that started a run for a deleted file, and a failed version stayed in "Waiting for you" for good.
    - Found by: the minimum-input review (2026-10-24), counting what an admin can do from each screen.
    - Fix and pin: `imagery.resumeGuard` and the Imagery and Jobs banner with the spend and Resume processing (behaviour A43, `S-A43-*`); a file too large goes back with the free Studio way (`S-A42-BAD-SOURCE-TOO-LARGE`); `jobRetryable` and `imagery.retry` agree on what a retry cannot cure, with Setup's Mapbox step, Upload another file or Dismiss instead (`S-A12-BAD-NOT-RETRYABLE`, `S-A12-BAD-FAILED-DISMISSED`).
    - **Every error the product shows names its way out, and a state an admin cannot leave from the screen is a defect, not an edge case.**
180. **The georeferencer by keyboard could not place a second pair.**
    - Seen: a pair added with Add at the centres became the selected one, the arrow keys then moved it instead of panning, and no key let it go (Esc only dropped a half pair, the table's pair button only selected): a keyboard user could not reach the next place. `S-A16-HAPPY-KEYBOARD` placed one pair. On a phone, Add at the centres with the Map pane showing read the hidden scan pane's zero size and made a pair at NaN.
    - Found by: the minimum-input review.
    - Fix and pin: a keyboard pair is not selected, Esc lets the selected pair go, the pair button toggles, a hidden scan pane keeps its last view and half a pair opens the other pane; the spec now places two pairs, chooses, moves, lets go and deletes by keyboard (`S-A16-HAPPY-KEYBOARD`).
    - **A keyboard path is proved only when it does the task twice in a row: the first pair works with any selection rule.**
181. **The georeferencer's pairs table scrolled sideways on a phone once six pairs were a kilometre off.**
    - Seen: at 320 px, and at 360 px and 768 px under a reader's text spacing, the residual table of six pairs in Romanian reached 12 to 68 px past its box in the unit test's measure (the e2e checker's `sideways-scroll` on `georef.pairs` at `admin-c360-ro` and `admin-m768-ro`). Every cell was kept on one line, and the narrow table's 4 px cell padding (CR-M3-35 i) sat in a container query written before the cells' own rule of the same specificity, so it never applied: only the hidden pixel and place columns had kept the phone's table in its box, with four pairs of small residuals.
    - Found by: the e2e tier at `admin-c360-ro` and `admin-m768-ro`, once `S-A16-HAPPY-KEYBOARD` placed two pairs by keyboard (CR-M3-47); the unit tests never measured the table, and the e2e had only ever drawn it with residuals of a few metres.
    - Fix and pin: the container query follows the cells' rule, and a cell wraps when the table would not fit otherwise (a place over two lines after its comma, "Perechea" over its number, "m" under a long residual) (`packages/ui/test/admin/georef/residual-fit.test.ts`, which measures the table at 320 px, and at 360 px and 672 px with the checker's text-spacing sheet; `S-A16-HAPPY-KEYBOARD`).
    - **A responsive rule placed before a base rule of the same specificity is dead code that looks applied: put overrides after what they override, and test a layout with the longest data it can hold, not the fixture's.**
182. **A layer's credit in the admin map's attribution read white on white in the dark scheme.**
    - Seen: Mapbox draws its attribution on a half-white box in every scheme and colours only its links (`mapbox-gl.css`); an imagery layer's credit is plain text, so it inherited the admin's text colour, light in the dark scheme (axe color-contrast on `.mapboxgl-ctrl-attrib-inner` in `admin.layers.crop-refused`, `crop-drawn` and `pending-version` at `admin-l1440-dark-imagery`).
    - Found by: the `tour-matrix` stage's first full run with the M3 imagery projects (CR-M3-47's `all`); the publishes that draw a credited layer run per push only at `admin-c360-ro` and `admin-l1440-ro`, both light (DECISIONS-for-review.md §49k), and the editors' own dark states draw layers without a credit.
    - Fix and pin: the admin map gives `.mapboxgl-ctrl-attrib-inner` the links' colour (`packages/ui/test/admin/map/attribution-colour.test.ts`; `S-A16-HAPPY-CROP`, `S-A14-HAPPY-REPLACE-SOURCE` at `admin-l1440-dark-imagery`).
    - **A third-party control that colours only part of its content leaves the rest to inherit the page's scheme: pin the whole control's colours, and when a tier moves to a nightly matrix, check which scheme still runs per push.**
183. **A footprints poll failed the Imagery filters test in under a second while the admin map was still opening.**
    - Seen: `S-A11-HAPPY-FILTERS` at `admin-m768-ro` failed at 0.8 s with Mapbox's "Style is not done loading": the e2e helper that reads a GeoJSON source of the admin map called `getStyle()`, which throws until the style has loaded, and `expect.poll` does not ask again after its callback throws.
    - Found by: the second full `all` of 2026-10-24 on the NUC (CR-M3-47); every earlier run had reached the poll after the style loaded.
    - Fix and pin: `sourceFeaturesInPage` (`e2e/admin/support/map.ts`) reads no features while the style is loading, so the poll reads "not yet" and asks again (`S-A11-HAPPY-FILTERS`, and every photo cone, marker and overlay probe that shares it).
    - **A probe that a poll calls answers "not yet" while the page is still getting there; one that throws turns a wait into a race.**
184. **A notification pushed while its admin opened it came back unread.**
    - Seen: the fan-out wrote the inbox item, pushed it, then wrote the item again as delivered with `pushedAt`; an admin who opened it while FCM was answering had their `read: true` replaced by the delivered copy.
    - Found by: writing the inbox's e2e (`S-A46-HAPPY`), which opens an item seconds after it arrives.
    - Fix and pin: the fan-out records `pushedAt` on the item as it is now, in a transaction, and leaves a pruned item alone (`functions/test/notify/fan-out.test.ts`, `badPath_anItemOpenedOrPrunedWhilePushingStaysAsTheAdminLeftIt`).
    - **A server write that adds a field to a document a person also writes must read it first: writing back the copy it started with undoes what they did meanwhile.**
185. **`getToken` was deprecated in the installed Firebase SDK, and with it the token the contract named.**
    - Seen: `firebase@13`'s messaging marks `getToken` deprecated in favour of `register` and `onRegistered` (the Firebase installation ID); ESLint's `no-deprecated` refused the registrar, and no suppression is allowed.
    - Found by: the lint gate on the first build of the push registrar.
    - Fix and pin: the admin registers the installation ID and the functions send to it as `message.fid`, as firebase-admin 14.5's `FidMessage` does; the fake FCM refuses a message without a `fid` (`packages/admin/test/firebase/messaging.test.ts`, `functions/test/adapters/fcm.test.ts`; DECISIONS-for-review.md §54c, CR-M4-24).
    - **Read the installed SDK's own types before following a contract written from older docs: a deprecation on the client usually changes what the server must send too.**
186. **A photo seeded without a title never opened in its editor.**
    - Seen: the first title-suggestion spec seeded a photo whose Romanian title was empty, to get suggestions on its own; the editor said "Could not read (invalid-document)", since a stored photo always has a title.
    - Found by: the first admin-tier run of `S-A09-HAPPY-TITLE-SUGGESTION`.
    - Fix and pin: the spec seeds the title a file name gives and clears it in the editor, as an admin does before choosing a suggestion (`e2e/admin/specs/assists/title.spec.ts`).
    - **Seed only what the product itself can store; a state the product reaches only while editing is reached by editing.**
187. **A history entry of the previous test appeared below a photo of the next one.**
    - Seen: two specs used the same photo id; the history trigger of the first test's Save ran after the admin tier's reset, so "nothing written" found an entry the refused test never made.
    - Found by: `S-A09-BAD-AI-UNAVAILABLE` at `admin-l1440-ro`.
    - Fix and pin: each test of `e2e/admin/specs/assists/drafts.spec.ts` has its own photo id, and "nothing written" is the document as seeded and the 503 the page logged.
    - **The emulators' triggers outlive the test that caused them: a locked test's reset does not stop a trigger already queued, so give each test ids of its own.**
188. **Headless Chromium refuses notifications before anyone asks, and reads a hidden count with a space before its comma.**
    - Seen: the inbox showed "The browser refused notifications" in every e2e test that did not grant them, and the Notifications item's name was `Notificări , 1 necitite` (a positioned, visually hidden span is a block, so Chromium joins it with a space).
    - Found by: the first admin-tier run of `S-A46-HAPPY`.
    - Fix and pin: the push specs grant the permission (Playwright) or deny it (`Browser.setPermission` with the page's `browserContextId`), and the badge's name is matched with an optional space (`e2e/admin/specs/notify/`).
    - **A browser's defaults and its accessible-name joins are part of what a spec observes: set the permission a test depends on, and match names the way the browser computes them.**
189. **OpenStreetMap's licence link under the title suggestions was a 24 px target on a tablet.**
    - Seen: at `admin-m768-ro` the generic checker's scroll sweep found `osm.org/copyright` 112 × 24 px, under M3's 48 × 48 on a medium window; the unit test had only asked for WCAG's 24 px.
    - Found by: `S-A09-HAPPY-TITLE-SUGGESTION`'s state `assist.suggestions` at the admin tier's five projects; the same spec at `admin-c360-ro` also showed that a place 1.3 km from the photo is off a phone's map at the editor's zoom.
    - Fix and pin: the link is 48 px tall (`packages/ui/src/admin/assist/assist-parts.ts`), and the title specs start their photo 500 m from the place they click (`e2e/admin/specs/assists/world.ts`).
    - **A link inside running text is still a touch target: size it for the smallest window the checker runs, and pick the points a spec clicks so they are on the smallest map.**
190. **M3's daily cap of raster jobs never counted a job outside the unit tests.**
    - Seen: `rasterJobsToday` asks for jobs with `createdAt >= <start of day>`; the Firestore adapter passed the `TimestampLike` operand to the Admin SDK as a plain `{seconds, nanoseconds}` map, and Firestore compares a range only within one type, so the emulator found 0 of 1 matching jobs. The unit tests used the in-memory fake, which compares timestamps.
    - Found by: the orders workstream's throwaway emulator probe while it built the daily order watch (CR-M4-11); every tier was green because no emulator test filtered on a timestamp.
    - Fix and pin: `buildQuery` converts every operand as it converts a stored value (`toFirestoreValue`); `functions/test/adapters/documents.test.ts` `happyPath_aTimestampOperandMatchesStoredTimestampsInARangeAndInAList` runs on the emulator.
    - **A fake that is more forgiving than the real store hides a whole class of query bugs: every adapter's filter needs one test against the emulator with each operand type it accepts.**
191. **The monthly USGS harvest erased every order an admin had marked.**
    - Seen: the harvest rebuilt each scene from a fixed list of fields to keep (status, note, layer id, creation); M4's `order` and `eeDatasetId` were not on it, so the next harvest dropped them.
    - Found by: the orders workstream's functions tests of a harvest after a mark (M4, CR-M4-12).
    - Fix and pin: `functions/src/imagery/harvest.ts` keeps the order and the dataset id (`functions/test/imagery/orders-edits.test.ts`).
    - **A rewrite that copies a keep-list of fields silently drops every field added later: merge into the stored document, or test the list against the schema's fields.**
192. **The engine's third-party notices lost `lit` once swipe compare shipped.**
    - Seen: the `notices` gate failed with "lit@3.3.3: bundled but not in THIRD_PARTY_NOTICES.txt": Vite's library build starts one build per format, the notices plugin cleared its list at each `buildStart`, and the file written last held only the ES build's packages, while the IIFE (which inlines the compare chunk) carried `lit/index.js`.
    - Found by: the `build` stage after the compare workstream's chunk (CR-M4-19).
    - Fix and pin: the plugin gathers across the formats of one `vite build` and never clears (`scripts/site/src/notices.ts`, `scripts/site/test/notices.test.ts`); `[notices] OK` lists 13 engine packages.
    - **A build plugin that keeps state must know how many builds one command runs: Vite's library mode calls `buildStart` once per format.**
193. **Swipe compare's lazy chunk made the engine load a 44.6 KB chunk at once.**
    - Seen: with Vite's library default (`preserveEntrySignatures: 'strict'`), what `compare-<hash>.js` shared with the entry moved into a third chunk, `map-sync-<hash>.js`, which `engine.mjs` imported on every page.
    - Found by: the compare workstream reading the build's output before the budget gate (DECISIONS-for-review.md §55c).
    - Fix and pin: `preserveEntrySignatures: 'allow-extension'` in `packages/engine/vite.config.ts`; `ENGINE_CHUNK_BUDGETS` fails any engine chunk without a budget.
    - **A lazy chunk is only lazy if the entry stays whole: read the build's chunk list whenever a dynamic import is added.**
194. **The automatic georeferencing's OpenStreetMap channel matched the ground, not the roads.**
    - Seen: Canny's edges of the synthetic scan followed the ground's texture as much as the roads; the OSM channel was 155 m off at the median.
    - Found by: the autogcp workstream's pipeline tests on the synthetic world drawn through an exact affine map (`pipeline/tests/integration/test_autogcp.py`, P03).
    - Fix and pin: the scan side is the white and black top-hat of the CLAHE'd pre-warped scan (lines up to 150 m wide) against OSM's proximity field: 13 m off (CR-M4-18).
    - **Pick a matcher's features for what the reference draws: a line map is matched with line features, never with every edge of the image.**
195. **The buy flow pushed the Imagery area's chunk over its budget by 0.2 KB.**
    - Seen: the `build` stage's `bundle-budget` failed on `imagery` (18.2 KB of 18) once the order card, Work's orders and the chips joined M3's screens.
    - Found by: the build stage of the M4 integrator.
    - Fix and pin: the order card, which only a scene to buy or with an order shows, is a chunk of its own fetched on first need (`packages/ui/src/admin/imagery/orders/lazy-card.ts`, `order-card` 2 KB; `imagery` 17.6 KB), with Loading, a failed fetch's Try again and the page's re-render pinned by `packages/ui/test/admin/imagery/lazy-card.test.ts` (DECISIONS-for-review.md §56b).
    - **When a feature spends a chunk's headroom, split off what only some visits need instead of raising the budget.**
196. **A journey spec that seeded the scenes never saw the ranking it waited for.**
    - Seen: the cross-app automation spec seeded the harvested scenes and then imported through `importFromList`, whose `awaitHarvest` waits for the page's own ranked search; seeded scenes are ranked otherwise, and the poll timed out.
    - Found by: the first run of `S-A48-HAPPY` at `admin-l1440-ro`.
    - Fix and pin: the happy journey lets the page harvest and seeds only the bought scene's preview afterwards; the bad path, which never imports from the list, seeds the scenes (`e2e/admin/specs/imagery/automation.spec.ts`).
    - **A helper that waits for a server flow needs that flow: seed what a spec skips, never what its helpers wait for.**
197. **A spec that opened the paid Corona frame failed at teardown on a 503.**
    - Seen: the fake browse host never serves `DS1105-1071DF076` (it is `S-A11-BAD-BROWSE-UNAVAILABLE`'s scene), so a spec opening that scene logged the 503 console error the fixtures fail on.
    - Found by: the orders workstream's first `orders.spec.ts` runs.
    - Fix and pin: every spec that opens that scene seeds its preview in our bucket first (`ImageryWorld.seedBrowse`; orders and automation specs, the local stack's seed).
    - **A fake's bad-path fixture is shared state: a new spec that reuses its id inherits its failure.**
198. **Swipe compare's chooser ran past the map's edge at 320 px.**
    - Seen: a native `<select>` keeps the width of its widest option unless it may shrink; with the tour's text spacing at 320 px the compare bar's chooser ended past the map's edge.
    - Found by: the tour's layout checker on `viewer.compare-menu` (V06).
    - Fix and pin: `min-inline-size: 0` on the chooser (`packages/ui/src/viewer/compare/compare-styles.ts`), the tour state at every viewer viewport.
    - **Native form controls size themselves from their content: give each one in a flexible row a minimum it may shrink to.**
199. **The divider's handle sat on the map's centre, which the occlusion check reads as the map's own.**
    - Seen: the generic checker samples a map canvas at its centre; a handle there made the map look covered in every compare state.
    - Found by: the tour's occlusion check on `viewer.compare-swipe` (CR-M4-16 (b)).
    - Fix and pin: the handle sits below the centre and, on a phone held landscape, ends before the vertical timeline (`packages/ui/src/viewer/compare/hcm-compare.ts`).
    - **No control may sit at a map's centre: that point is the map's, for the checker and for the visitor.**
200. **Focus was lost after Accept in the georeferencer's suggestions.**
    - Seen: accepting or rejecting a suggestion re-rendered the list; without keys Lit reused the rows in place, so the focus stayed on a row that now showed the next suggestion's buttons, or fell to the page.
    - Found by: the autogcp workstream's keyboard test (`S-A44-HAPPY-KEYBOARD`).
    - Fix and pin: the rows are a keyed `repeat` and the next row takes the focus (`packages/ui/src/admin/georef/suggestions-panel.ts`).
    - **A list whose rows leave on a keypress needs keyed rows, or the focus follows the position instead of the item.**
201. **The title-suggestion spec counted a Nominatim request it never made.**
    - Seen: in the split `quality` run `S-A09-HAPPY-TITLE-SUGGESTION` found two server requests to Nominatim where it expected one: its own cell and the city's centre, asked by a content spec drawing a place at the map's centre beside it (a point drawn asks for titles by itself, and every city's request lands in the server's one world).
    - Found by: the M4 integrator's split `quality` run, at `admin-c360-ro` and `admin-l1440-ro`; the assists specs had passed alone, with no content spec running beside them.
    - Fix and pin: the spec counts the requests of its own cell, and during the cool-down it checks that no request of anyone's reached Nominatim (`e2e/admin/specs/assists/title.spec.ts`).
    - **A locked spec owns the project's singletons, not the server's fakes: count only what names the test's own data, or what nobody can add while it runs.**
202. **The Setup steps' self-test spec still counted nine checks after M4 added the tenth.**
    - Seen: `S-A03-BAD-SELFTEST-FAILURE` found 10 `[data-check]` rows where it expected 9: assists-notify had added the `ai` check (Vertex AI's free `countTokens`) to `SELF_TEST_CHECKS`, and its own runs never included the `admin-steps-l1440-en` project.
    - Found by: the M4 integrator's split `quality` run, on the NUC's part of the admin tier.
    - Fix and pin: the spec counts `SELF_TEST_CHECKS.length` (`e2e/admin/steps/status.spec.ts`).
    - **Count a list from the constant that defines it; and a change to a shared list runs every project whose specs read it, the Setup steps' included.**
203. **A translation draft asked for one photo filled the next photo's title.**
    - Seen: English draft on photo A, then photo B opened before Vertex AI answered (up to 20 s): A's translation and the model's note landed in B's draft, and B's Save would have published it. The place and layer editors had the same gap.
    - Found by: both M4 reviews (2026-10-24); the unit tests reset only the title suggestions mid-flight, and every e2e draft waited for its answer on the same item.
    - Fix and pin: the assist session counts the open item and drops a draft answered for another (`badPath_aDraftAnsweredAfterAnotherItemOpenedIsDropped`, `badPath_aDraftThatArrivesAfterAnotherPhotoOpenedLandsNowhere`).
    - **An answer that lands in "whatever is open now" must carry what it was asked for: guard every await that writes into shared editor state, not only the first one written.**
204. **Every notification read up to 250 items of every admin's inbox.**
    - Seen: `notify.onEvent` pruned each inbox by reading its newest 250 items to delete those past 200: once inboxes were full, about 200 reads per admin per event, a quarter of Firestore's free reads at three admins and twenty events a day, while the contract promised "a few documents".
    - Found by: the M4 security and cost review; the fan-out test seeded a full inbox once and checked only what was left.
    - Fix and pin: `DocumentStore.count` (an aggregation) first, then only the oldest items over the limit are read (`happyPath_anInboxUnderItsLimitIsCountedAndNeverRead`, and the read query asserted in the full-inbox test).
    - **A cost claim in a contract is a test: assert the reads a handler makes, not only the documents it leaves.**
205. **A browser kept showing an admin's notifications after sign-out, after removal, and for the next admin.**
    - Seen: sign-out cleared only session keys; the push device id in `localStorage` named no admin, so another admin saw push on for someone else's registration, and their Off unregistered nothing; `admins.revoke` left the removed admin's devices, inbox and settings, so a re-invited account got its old browsers back; an Off that failed offline still said off.
    - Found by: both M4 reviews; every push test signed in one admin on one browser.
    - Fix and pin: the record is `{uid, deviceId}` (`push-device.ts`), sign-out unregisters and forgets it, `notify.registerDevice` takes the browser from every other admin, revoke deletes the three collections, a failed Off keeps push on and says why (`S-A47-BAD-SHARED-BROWSER`; `push-device.test.ts`, `inbox.test.ts`, `controller.test.ts`).
    - **Anything a browser remembers for an account names that account, and leaving the account (sign-out, removal) undoes what it registered elsewhere.**
206. **A model's draft could add a link the public viewer would render.**
    - Seen: a description's draft keeps Markdown links (the prompt asks the model to), and nothing compared them with the source's: text pasted into the source could ask for `[More](https://…)` and a 5,000-character draft saved without a careful read would publish it.
    - Found by: the M4 security review; the markup tests covered HTML and control characters, which the viewer never renders anyway, not the one markup it does.
    - Fix and pin: `draftKeepsLinks` refuses a draft with a link address the source lacks (`apiError.assist.linksChanged`; `S-A45-BAD-LINKS-CHANGED`, the fake Vertex AI's `injected` outcome).
    - **Sanitise model output against what the renderer turns into behaviour (links here), and check it against the input, not only for shape.**
207. **Title suggestions had no daily limit, and a lost task left the editor waiting for ever.**
    - Seen: any cell in the city's reach was queued on a cache miss, so a scripted session walking 11 m cells kept Nominatim at one request a second indefinitely (the bulk use its policy forbids); a cell claimed whose task was never queued answered `queued` and the editor's "Looking for titles…" never ended.
    - Found by: both M4 reviews; the queue tests covered the cache, the cool-down and the rate, never volume or a refused enqueue.
    - Fix and pin: `GEOCODE_DAILY_CAP` counted in `ops/assist` within the claim's transaction, a refused enqueue deletes its cell, and the editor stops listening after `GEOCODE_QUEUED_MINUTES` (`S-A45-BAD-DAILY-CAP`; `badPath_aQueuedCellNoAnswerReachesEndsTheWaitSoSuggestATitleWorksAgain`).
    - **A free third-party service's policy is a cap the code enforces, and every wait on a background job has an end the user sees.**
208. **Swipe compare paid a new map load each time the window crossed 600 px.**
    - Seen: a phone turned between portrait and landscape, or a window dragged across 600 px, destroyed the second map and created a new billed one at each crossing; the chooser also offered the main side's own layer.
    - Found by: the M4 cost review; the counter tests checked that no map leaked, not how many loads a session paid.
    - Fix and pin: a compact window hides the second map for `COMPARE_PARK_MS` and a wider one reuses it (`badPath_aCompactWindowHidesTheSecondMapAWiderOneReusesItAndAMinuteDestroysIt`, `S-V06-BAD-COMPACT-WIDTH`); `compareChoices` leaves out the main side's layers.
    - **For a billed resource, test the count of creations across a session's ordinary motions, not only that each creation is destroyed.**
209. **An uploaded photo never got its title suggestions by itself.**
    - Seen: suggestions came by themselves only for an empty Romanian title, but every upload starts titled after its file (`IMG 0412`), so a real upload always needed Suggest a title first; the e2e met the one-input budget only because it cleared the title, an input it did not count.
    - Found by: the M4 minimum-input review; the spec seeded its photo instead of uploading one.
    - Fix and pin: a title nobody chose (empty, a camera's naming, the file's title) asks by itself (`photoUntitled`); the spec starts from a real upload (`S-A09-HAPPY-TITLE-SUGGESTION`).
    - **Measure an input budget from the state a real user reaches (an upload, not a seed), and count every step the test takes to get there.**
210. **The orders' screens counted what the admin could not clear and promised checks that could not run.**
    - Seen: Work counted an expired order (no Take the mark back on its card) and a sent reminder (nothing to click to say "I paid"); before USGS approved downloads the card said "checked daily" while the watch skipped it; the refusal of a frame scanned meanwhile vanished with its card; the card's times were UTC, the inbox's local.
    - Found by: the M4 minimum-input review; the UI tests asserted each state alone, never which action leaves it.
    - Fix and pin: Take the mark back on the expired card, reminders out of the count, the approval note and its Setup link, the refusal outside the card, local times (`S-A13-BAD-SCANNED-WHILE-MARKING`, `S-A13-BAD-WAITS-FOR-APPROVAL`, `S-A13-BAD-NEVER-DELIVERED`).
    - **Every "needs you" count needs an action on screen that clears it, and every promise a card makes ("checked daily") needs the condition that keeps it.**
211. **The automatic georeference was measured in its middle only.**
    - Seen: the tests asserted the median distance from the truth (3.7, 2.8 and 9.9 m) while the largest, at a corner outside the matched pairs where `poly2` extrapolates, was 14.1, 11.7 and 23.4 m; enough confident pairs in a line were reported as "too few".
    - Found by: the M4 minimum-input review, recording the largest error the helper already computed and discarded.
    - Fix and pin: the tests assert the largest distance too (`EDGE_ERROR_M`); a degenerate fit waits with `apiError.imagery.noSpread` (`S-P03-BAD-NO-SPREAD`); the approval-policy guard is proposed (`DECISIONS-for-review.md` §57d).
    - **A tolerance claimed for a map is for its whole extent: assert the worst point, and keep the reason a fit failed apart from its count.**
212. **The suggestions' distances were stale, and Accept all dropped the keyboard.**
    - Seen: each suggestion showed the matcher's stored residual as "from the current fit", which never changed as pairs were accepted (and read "No fit" on a version waiting for points even with a live fit); after Accept all the focused button vanished with the list and the focus fell to the page.
    - Found by: the M4 minimum-input review; the panel tests passed fixed residuals, and the keyboard spec decided rows one by one.
    - Fix and pin: `offsetM` from `distanceFromFit` on every refit, and Accept all focuses the panel's heading (`S-A44-HAPPY`; `happyPath_eachSuggestionsDistanceIsFromThePagesCurrentFitAndFollowsIt`).
    - **A number labelled "current" is computed from the page's state, never read from a stored snapshot; and every action that removes its own control moves the focus somewhere named.**
213. **A translation draft could replace what the admin had typed.**
    - Seen: English draft was offered whenever the Romanian side had text, so with both filled it replaced the admin's English, and only Discard (which drops every other edit too) brought it back.
    - Found by: the M4 minimum-input review.
    - Fix and pin: a draft is offered only for an empty side, its note stays once it filled it (`draftTarget`, `badPath_textTheAdminTypedInBothLanguagesIsNeverOfferedADraft`, `S-A09-HAPPY-TRANSLATE-DRAFT`).
    - **An assist fills what is empty; replacing the user's own text needs their explicit say.**
214. **Small gaps in the notifications: points needed reached no device, "imported" said too much, and "1 devices".**
    - Seen: `layer.needsPoints` was not pushed by default, so a bought scan whose automatic points failed reached only the inbox; "The scan of X is imported" also went out for a version waiting for points; the test notification said "1 devices" and the Romanian badge "1 necitite".
    - Found by: the M4 minimum-input review.
    - Fix and pin: `layer.needsPoints` pushed by default, `order.imported` worded for a version published or waiting, `pluralOf` in `@hcm/shared` with one, few and other forms, the Romanian badge "necitite: 3" (`notifications.test.ts`, `inbox.test.ts`, `nav-badge.test.ts`).
    - **A text with a count has its plural forms in both languages from the start, and a default that hides a stalled automation is a bug, not a preference.**
215. **The functions' account could run any Vertex AI job to make a translation draft.**
    - Seen: Provision granted `fn-admin@` `roles/aiplatform.user`, which also allows billable custom jobs and endpoint deploys, while the drafts and the self-test only call `generateContent` and `countTokens`.
    - Found by: the M4 security review; the role table's test checked that the role was there, not what else it allowed.
    - Fix and pin: Provision's `iam` item makes the custom role `hcmVertexDrafts` (`aiplatform.endpoints.predict`) before binding it (`the custom role of the translation drafts (M4)` in `packages/admin/test/provision/items.test.ts`).
    - **Grant the permission a call needs, not the predefined role that contains it: a cost guard on one call is no guard on the others the role opens.**
216. **In the dark scheme the focus ring of Confirm the place could not be seen, and a refused I ordered it dropped the keyboard.**
    - Seen: the title-suggestion spec, rewritten to start from a real upload (lesson 209), reached the photo editor's "check the place" banner for the first time in a tour state: at `admin-l1440-dark` the Tab round's contrast check found the ring of **Confirmă locul** (the kit's secondary) under 3:1 against the banner's tertiary container. On the scene page, the order card of a frame scanned while it was being marked disappeared with the button just clicked and the focus fell to the page's body; the refusal then shown inline above Import made the page just tall enough that, scrolled to its end at `admin-m768-ro`, the map's attribution was a 6 px sliver under the app bar (a 14 px link 11 px from the account button).
    - Found by: the 2026-10-24 review fixes' split `all` run (`admin-l1440-dark`, `admin-m768-ro`, both in `tour-matrix`); every earlier state seeded its photos (no banner) and every per-push project passed.
    - Fix and pin: the photo editor's `.banner` sets `--hcm-focus-ring-color` to its container's own colour, as the alerts on the error container do; a refused mark moves the keyboard to the scene's heading (`ImageryContext.focusDetail`; `badPath_aRefusedMarkLeavesTheKeyboardOnTheScenesHeading`), and the frame scanned meanwhile says why in the snackbar, the reviewer's other option, so the page keeps its free-scene layout (`S-A13-BAD-SCANNED-WHILE-MARKING`).
    - **Every coloured container that holds a control sets the ring's colour for itself; and a state reached the way a user reaches it (a real upload, a real refusal) finds what seeded states hide.**
217. **The jobs tour's running and waiting jobs were run under it by another test's tick.**
    - Seen: `tour/admin-jobs.tour.ts` at `tour-c360-light-ro` and `tour-x1920-light-ro` lost its seeded running import mid-test: the progress bar vanished, then the Cancel dialog's button kept re-rendering until the test timed out; the job read "failed: the layer version does not exist (e2e stand-in)". A later run at `tour-x1920-dark-en` found its job "waiting for its date" done: the date, 2026-10-24 09:00, had passed on the wall clock the server uses.
    - Found by: the 2026-10-24 review fixes' split `all` run on the NUC, whose admin and tour projects ran beside the imagery specs; the same test passed at every other viewport.
    - Fix and pin: `imagery.tick` (which the orders and automation specs run, over every city) took the seeded job, which had no lease, for a lost execution, ran it again, and the stand-in runner failed it for its missing version; and it dispatched the waiting job once its date came. `seedJob` gives a seeded running job a lease held far ahead (`e2e/admin/support/ops.ts`), as a live pipeline's heartbeat would, and the waiting job's date is in 2100.
    - **A seeded record must be complete enough for every background process that may meet it (a lease, a heartbeat), not only for the page the test looks at; shared emulators run other tests' schedulers, on the wall clock, so a "later" date is far later.**
218. **The revoke-while-editing spec hung: removing the admin's inbox told its page before its Save.**
    - Seen: `S-A20-BAD-REVOKED-WHILE-EDITING` at `admin-c360-ro` timed out clicking Save: the page was already read-only under the "access removed" banner, so Save stayed disabled. `admins.revoke` (since the 2026-10-24 review, lesson 205) deleted the removed admin's inbox after their `admins/{uid}`; the unread badge listens to that inbox, so when the inbox held an item (another test's event fanned out to every admin), the deletion reached the open page as a denied listener before the Save the spec makes.
    - Found by: the review fixes' third split `all` run; two earlier runs passed, their admin's inbox empty at the time.
    - Fix and pin: the notifications go first, while the account is still an admin's (`functions/src/admin/revoke.ts`): the open page sees its inbox emptied, and the removed admin's next write is refused by the rules as the scenario says.
    - **A cleanup that writes under a revoked account reaches its open listeners: order it so they see what they are still allowed to see, and test the scenario with the shared world's background traffic, not only an idle one.**
219. **The built engine could not be committed as it was: two of its lines end in a space and a tab, and its stylesheet has no final newline.**
    - Seen: M5's release folder `cdn/engine/` (the engine build jsDelivr serves from a tag) failed `editorconfig` on a scratch copy: `engine.css` without a final newline, and line 58 of `engine.iife.js` and 114 of `engine.mjs` with trailing whitespace. The whitespace is lit-html's `[ \t\n\f\r]`, which the minifier writes as a template literal whose `\n` became a real line break; it belongs to the string. A first order of `release.json`'s files by `localeCompare` would also have put `THIRD_PARTY_NOTICES.txt` where the machine's locale says.
    - Found by: the release workstream's measurement of every static gate on a scratch copy of the folder before anything was committed (`docs/research/M5-interfaces.md` §2.3); no gate reads build output, which `dist/` keeps out of the tree.
    - Fix and pin: the release transform ends every text file with a newline and lists files in code-point order (`releasedBytes` and `releasedFiles` in `scripts/release/test/cdn.test.ts`); the trailing whitespace stays as it is, and the one-line EditorConfig exception for `cdn/engine/*.{js,mjs}` waits for the user (`docs/research/DECISIONS-for-review.md` §59c).
    - **Committed build output is data: measure every gate on it before the commit that adds it, never "fix" whitespace inside minified code, and keep locale out of anything compared byte for byte.**
220. **The admin's theme watched the city twice, then forever.**
    - Seen: in M5's multi-city shell, a synchronous store (the unit tests' fake, and the emulator's cached snapshot) answered inside `CityTheme`'s `watch` call; the answer found no watch started yet and started a second one, whose answer did the same.
    - Found by: the multi-city workstream's unit tests of the mount (`packages/admin/test/app/mount.test.ts`); every earlier store answered on a later turn.
    - Fix and pin: the watch is marked started before it is called (CR-M5-24 (1)).
    - **Mark a subscription as started before you subscribe: a source may answer inside the call.**
221. **A role dialog the user saw was "hidden" to the test.**
    - Seen: `hcm-dialog`'s host element has no box while its native `<dialog>` is open in the top layer, so `toBeVisible()` on the host failed with the dialog on screen (Admins → the role question).
    - Found by: `S-A51-HAPPY-ROLE` at the admin projects.
    - Fix and pin: the spec asserts the dialog through its role (`getByRole('dialog')`), as a user's assistive technology finds it.
    - **Assert a modal by its role, never by its custom element's host: the top layer has no layout box under the host.**
222. **"Discard" for another city's address asked a second time, and brought the old city back.**
    - Seen: an unsaved edit, then the city menu's other city, then Discard: the navigation guard restored the old address before the page load, and `beforeunload` asked again.
    - Found by: `S-A49-BAD-UNSAVED`.
    - Fix and pin: once the admin discards, the app stops counting the discarded edit while the other city opens (CR-M5-24 (3)).
    - **A guard that asked and was answered must stand down for the navigation it allowed.**
223. **The New city drag spanned a hundredth of the area the spec expected.**
    - Seen: a 240 px drag at zoom 13 was computed with 256 px tiles; Mapbox's zoom levels are 512 px tiles, so N px at zoom z span N·360/(512·2^z) degrees.
    - Found by: `S-A50-HAPPY`, whose rectangle came out too small for `CITY_SPAN_LIMITS`.
    - Fix and pin: the spec's comment and its sizes use 512 px tiles (CR-M5-24 (4)).
    - **Mapbox GL's zoom is in 512 px tiles: convert pixels to degrees with 512, not the 256 of raster tile schemes.**
224. **An overlay for the New city rectangle hid the map from the checkers and broke the admin's CSP.**
    - Seen: a transparent layer over the map to catch the drag made the map's zoom buttons "occluded" and its focus "obscured" for the layout checker; positioning it with an inline `style` was refused by the admin's Content Security Policy.
    - Found by: `S-A50-HAPPY`'s `expectStateSound` and the console guard.
    - Fix and pin: the gesture listens on the element Mapbox draws into, in the capture phase; nothing covers the map (CR-M5-24 (5)).
    - **Draw on a map through its own element's events, never through a layer on top of it.**
225. **The bundled city's owner could not invite anyone before Setup wrote the city.**
    - Seen: `admin.session` listed a member's cities from their documents, and the bundled city has none until Setup's `setup.createCity`, so its owner had no city to invite into.
    - Found by: `S-A02-HAPPY-INVITE-AND-CANCEL` after the memberships landed.
    - Fix and pin: the session lists a member's city by its id while it has no document (CR-M5-22 (2), CR-M5-24 (6)).
    - **A membership is the source of truth for access; a document's existence is not.**
226. **The city menu's buttons lost their 48 px targets.**
    - Seen: 40 px buttons in a scrolling list, packed edge to edge, failed the target-size check at the list's ends and between rows (`cities.switcher-menu`).
    - Found by: the tour's target-size checker at the admin projects.
    - Fix and pin: 8 px between them and 4 px inside the list's edges (CR-M5-24 (7)).
    - **A 40 px control keeps a 48 px target only with 8 px around it, including inside a scroller's padding.**
227. **A page opened from the disk could not be reached by the e2e at all.**
    - Seen: `S-V28-BAD-FILE-URL` (an export opened by double-click) was blocked by the e2e firewall, which refuses every address that is not a mocked host, `file://` included.
    - Found by: the export workstream's first run of the spec.
    - Fix and pin: the spec answers `file://` itself from the unpacked folder (`page.route(/^file:\/\//, …)`); Chromium's own refusal of a `file://` fetch, the point of the test, still happens before any route.
    - **A firewall in the test harness covers every scheme: a spec that needs one opens it explicitly, and says why.**
228. **The tour inventory could not take another section.**
    - Seen: `e2e/tour/states.ts` reached the 600-line limit of a test file, so any section's spread failed `max-lines`.
    - Found by: ESLint on the export workstream's first state.
    - Fix and pin: the M4 and M5 sections moved with their markers into `e2e/tour/admin-sections.ts` (CR-M5-15).
    - **An inventory that every workstream appends to is split by section before it fills, not by the one who hits the limit.**
229. **A click on a Material button reached nothing.**
    - Seen: `hcm-button` renders its inner `<button>` on its first update, after the element is in the page; the export card's spec clicked before it existed.
    - Found by: the export workstream's admin spec at `admin-c360-ro`.
    - Fix and pin: the spec waits for the button by its role before clicking (`e2e/admin/specs/export/export.spec.ts`).
    - **Wait for a custom element's control by its role: its host exists before its shadow content.**
230. **A locked test's reset deleted a content world's export while it downloaded.**
    - Seen: `S-A53-HAPPY` downloaded "No such object." when a locked spec reset the emulators during its build: the reset reads `exports/<city>/<id>.zip`'s second segment as the city only for the prefixes it knows, and `exports` was not one, so it read the zip's name as the city and deleted the object.
    - Found by: a whole admin-tier run at `admin-l1440-ro` (the multi-city workstream, 2026-10-25); alone the spec passed.
    - Fix and pin: `exports` joins `CITY_FIRST` in `e2e/admin/support/emulators.ts` (CR-M5-25).
    - **Every new storage prefix joins the reset's table in the change that adds it (lesson 116 again).**
231. **A city made in the admin could never become public.**
    - Seen: New city made the city unpublished and its done screen said "publish it from Settings when it is ready", but no screen wrote `cities/{city}.published`: the city could get no public manifest, so no public site and no export (`apiError.export.noManifest`). Each workstream's own specs seeded `published: true` and passed.
    - Found by: the M5 integrator's cross-app journey, the first test to take a city from New city to its public site.
    - Fix and pin: Settings → Publishing (one switch and Save; `S-A54-HAPPY`, `S-A54-BAD-UNPUBLISHED`; `docs/research/DECISIONS-for-review.md` §63a).
    - **A flow is done when a test walks it from its first screen to what the visitor sees, with nothing seeded in between.**
232. **A version bump would have downloaded every npm package, the browsers and the emulators again.**
    - Seen: the quality image's npm layer depended on the lockfile's and the manifests' bytes, so the CLI's workspace link and the release's version bump (versions only) re-ran `npm ci` from the registry, the Playwright browser install and the Firebase emulator download.
    - Found by: the kit-cli workstream, which left the lockfile unchanged for that reason (§61d), so a fresh `npm ci` stopped with `Missing: create-historic-city@0.0.0 from lock file`.
    - Fix and pin: the image's `manifests` stage writes the workspaces' versions as 0.0.0 and drops a workspace without registry dependencies; checked by building that stage alone and comparing its output byte for byte with the baked one (§63b).
    - **A cache layer should depend on what it caches: normalise the inputs that cannot change its output, and prove the cache hit before the build that would miss it.**
233. **A photo seeded for a new city vanished from its manifest.**
    - Seen: the journey's photo of Turda was skipped by the manifest build with `validation.outsideCity`: the seeding helper's default location is Bucharest's.
    - Found by: `S-A54-HAPPY`'s first run, whose manifest record named the skipped photo.
    - Fix and pin: the spec places the photo inside the rectangle it gave New city (`IN_TURDA`).
    - **A seeded world for a second city must put its content inside that city: defaults belong to the first one.**
234. **A count of one read as a plural, and a limit an owner sets can be one.**
    - Seen: the export card said "1 fotografii, 0 straturi" and "1 photos"; the daily limits of imagery jobs and exports, which M5 lets the project's owner set per city down to 1, said "deja 1 exporturi" and "1 exports … were already made"; the city's compute-unit message put `{estimate}` before its noun the same way.
    - Found by: the M5 integrator's visual audit of the review screenshots (`reports/screenshots/m5/`), which the checkers pass: the text is contrasted, in place and in the right language.
    - Fix and pin: each message puts the number after a label or in brackets ("fotografii: 1, straturi: 0", "au atins limita zilnică (1)"), in both languages; `packages/ui/test/admin/export/export-card.test.ts` asserts the Romanian and English summaries. The same review made Export tonal beside a ready export's Download, the card's one filled button.
    - **Lesson 124 again: a count before a noun needs plural forms, and "it is always more than one" stops holding once a person can set the number.**
235. **An offline build said nothing about the cache.**
    - Seen: to prove the NUC's quality image would build without downloads before a split run, `docker build --network=none` ran the apt layer again from its cache mounts and failed at the CI tools' venv, though the split's own build minutes later found every layer `CACHED`; on this machine, where a normal build was fully cached, the offline build re-ran the apt layer too.
    - Found by: the M5 integrator's check of the NUC before `PIPELINE_STAGE=quality bash scripts/ci/e2e-split.sh` (2026-10-25).
    - Fix and pin: the check is the split's own build log (`[nuc] #… CACHED` for the apt, venv and npm layers, the run stopped if one starts) and the NUC's cache records (`docker buildx du --builder default --verbose`, their last use); `.agent/skills/quality/pipeline_skill.md` → *Local tooling quirks*.
    - **BuildKit keys a `RUN` step on its network mode: a build with another network mode is another build, so it cannot tell whether the real one is cached.**
236. **A route did not drop the connection already open.**
    - Seen: `S-A18-BAD-STREAM-DROP` at `admin-l1440-en` on the NUC: "Reconnecting…" never showed within 60 s; the trace's first aborted listen request came 45 s after the route was installed, because Firestore's WebChannel long poll, opened before the route, stayed open, and a route reaches only the requests that start after it. It passed at the other four admin projects of the same run.
    - Found by: the M5 integrator's split `quality` run (2026-10-25), on the loaded NUC.
    - Fix and pin: the spec also takes the browser offline (`page.context().setOffline(true)`) until the page says it is reconnecting, which fails the open request too, then goes online with the route still cutting the channel, so the line written meanwhile arrives only after `unroute` (`e2e/admin/specs/ops/stream.spec.ts`; 15 of 15 at the five admin projects, 3 to 8 s each, against 9 to 14 s before).
    - **To cut a connection, cut the request already open too: a long poll or a stream outlives a route that starts after it.**
237. **The self-host CLI read the owner's Google tokens to learn whether they were signed in.**
    - Seen: `self-host`'s sign-in step ran `firebase login:list --json`, whose answer in firebase-tools 15.33.0 is every signed-in account with its OAuth refresh and access tokens (`auth.getAllAccounts()` printed by `--json`); the CLI kept them in memory, one log of a parse failure away from printing them, against its own rule of never reading a credential.
    - Found by: the M5 security review (finding 1), reading firebase-tools' `login-list.js` and `command.js`.
    - Fix and pin: the probe is `firebase login:list` as plain text (`Logged in as …`); the fakes answer `--json` with tokens, and the unit and e2e tests assert the CLI never runs it and nothing it captured holds them (`packages/create-historic-city/test/self-host.test.ts`, `S-V29-HAPPY-SELF-HOST`).
    - **Check what a `--json` flag really prints before reading it: a listing of accounts can be a listing of their secrets.**
238. **A guide's `npx create-historic-city@1` would run whatever owned the name that day.**
    - Seen: the READMEs, `docs/SELF_HOST.md` and the CLI's own messages told readers to run `npx create-historic-city@1` (a major line), and the npm publish came after the merge that makes those guides public; the name was not yet ours.
    - Found by: the M5 security review (finding 5).
    - Fix and pin: every guide names the exact release (`@1.0.0`), the CLI prints its own (`NPX_COMMAND`), `release:bump` rewrites `PINNED_DOCS` and `release-check` refuses a tag whose guides name another version (`scripts/release/test/versions.test.ts`, `scripts/ci/tests/test_check_release.py`); the release order now checks and publishes the name before the merge (`docs/research/M5-status.md` §3).
    - **A command a guide prints is code its readers run: pin it exactly, and own the name before the guide is public.**
239. **`self-host` walked an owner onto Blaze toward a setup that could not finish.**
    - Seen: the admin refuses the `project.json` `self-host` writes (no `github`, CR-M5-7), so Setup's Provision never runs; step 8 still opened billing, waited for Blaze and deployed functions whose service accounts only Provision creates, leaving the owner on Blaze without the 5 USD budget the step's own text promised; the scaffold advertised the command after every run.
    - Found by: the M5 UX review (finding 1).
    - Fix and pin: `self-host` and `deploy` refuse without `--experimental` (nothing runs; a dry run needs no flag), say what does not work yet when given it, the scaffold no longer advertises them and the guides say so (`S-V29-BAD-NOT-AVAILABLE`).
    - **A command that cannot finish should refuse at its first step, not after the payment step.**
240. **Every failure of `firebase projects:create` was taken for Google's terms.**
    - Seen: project ids are unique across Google, so a taken id is the usual failure; the CLI said to accept the terms, opened the console, retried the same id and stopped with only an exit status.
    - Found by: the M5 UX review (finding 14).
    - Fix and pin: firebase's own message stays on the owner's terminal, the CLI names another id (`otherProjectId`: `cluj-harta-2`) and opens the console for the terms only after a yes (`S-V29-BAD-PROJECT-TAKEN`).
    - **When a tool's failure has several causes, show its own message and offer the way out of the likeliest one.**
241. **A city editor's basemap address could add directives to the export's Content Security Policy.**
    - Seen: a WHATWG URL allows `;` and `'` in a host, so `new URL('https://a.com;connect-src/x').origin` is `https://a.com;connect-src`; the export page wrote that origin into `connect-src` (escaped as an attribute, but splitting the policy), and the rules' `httpsUrl()` and `isHttpsUrl` accept such a host.
    - Found by: the M5 security review (finding 7), checked in Node.
    - Fix and pin: `isCspOrigin` (CSP's host-source grammar) filters the export's origins and `contentSecurityPolicy` throws on any other; the manifest schema and the rules (`httpsHostUrl()`) refuse such a style; the export's policy names no telemetry host (`S-A53-BAD-STYLE-HOST`).
    - **An origin parsed from a URL is not a CSP source: check it against the grammar it is written into.**
242. **`create-historic-city upgrade` dropped the sources a page had added to its policy.**
    - Seen: `upgrade` refilled the page with the engine alone, so the tile and photo hosts the kit's README tells an owner to add (and an export's own origins) left `img-src` and `connect-src`; after the "easiest" upgrade the historical layers were blocked.
    - Found by: the M5 UX review (finding 4).
    - Fix and pin: `policyExtras(readKitPolicy(page))` carries every origin the page added and its telemetry's presence into the new policy (`packages/create-historic-city/test/upgrade-doctor.test.ts`; `theme` does the same).
    - **A rewrite that owns part of a file must read back what the rest of the file says.**
243. **Two owners could leave a city without one, and no account could repair it.**
    - Seen: the last-owner check counted owners outside any transaction; `admins.setRole` and `admins.revoke` read the target, then wrote the whole document; `revokeAdmin` had no last-owner check; the project's owner could be removed from a city, and nothing but the Firestore console could then reach it.
    - Found by: the M5 security review (finding 3).
    - Fix and pin: `changeCityRole` reads the caller, the target and every owner of the city through one transaction before it writes, and the project's owner stays an owner of every city they belong to (`apiError.city.projectOwnerStays`); the emulator tests run two owners against each other at once (`S-A51-BAD-ROLE-RACE`, `S-A51-BAD-PROJECT-OWNER-STAYS`).
    - **An invariant over several documents needs every one of them read in the transaction that could break it.**
244. **An editor of one city could publish another city's imagery.**
    - Seen: `layers.link` only compared a tileset's owner with the project's Mapbox account, which every city shares; the pipeline names tilesets `<user>.hcm-<city>-<layer>`, and the layer ids follow from public USGS metadata.
    - Found by: the M5 security review (finding 2).
    - Fix and pin: a pipeline tileset is linkable only by a layer of the same city that records it (`apiError.layers.otherCityTileset`, `S-A15-BAD-OTHER-CITY-TILESET`); the remaining limit, every city's public token reading every tileset of the account, is recorded in `docs/ARCHITECTURE.md`.
    - **When cities share an account, "the account owns it" is not "this city owns it".**
245. **A pending invitation from before M5 would grant every city, a later one too.**
    - Seen: an invitation without `cities` joined its account to every current city at its first session, a city made after the invitation included, and `admins.list` and `revokeInvite` could not see it.
    - Found by: the M5 security review (finding 4).
    - Fix and pin: the `memberships` tick step and `cities.create` (before it writes) give such an invitation the cities of now, as an editor of each (`S-A51-HAPPY-LEGACY-INVITE`).
    - **A migration of grants must convert the pending ones too, before anything can widen what they mean.**
246. **Anyone with an export's address could download it all day, on the project's egress.**
    - Seen: `export.download` signed a 15-minute address of a zip up to 2 GB on every call, even while the budget guard was red.
    - Found by: the M5 security review (finding 6).
    - Fix and pin: at most `EXPORT_LIMITS.downloadsPerDay` (10) signings per export a UTC day, counted in a transaction on its record, none while the guard is red, and the count logged (`S-A53-BAD-DOWNLOAD-LIMIT`).
    - **A signed address is a cost the project pays per use: count its signings and stop them when the budget says so.**
247. **The CLI's package could ship an e2e admin, or none.**
    - Seen: no gated stage built `dist/self-host/`, the CLI's own vite build empties `dist/`, and `buildSelfHostBundle` copied `packages/admin/dist`, which the e2e build (`vite --mode e2e`, with the OAuth stand-in) writes too.
    - Found by: the M5 security review (finding 8).
    - Fix and pin: `build:self-host` builds the admin and the functions for production first, the bundle refuses an admin carrying the stand-in's `/__oauth/authorize`, and the `release` stage's `self-host-bundle` gate assembles it between `vite-build` and `release-pack` (`packages/create-historic-city/test/bundle.test.ts`, `scripts/ci/tests/test_pipeline_stages.py`).
    - **A build that publishes must make its inputs itself, or check that they are the right build.**
248. **Every visitor read maintainer instructions while the map loaded.**
    - Seen: the kit's note ("check the version and the integrity in index.html") showed on every load until the engine ran, not only when it failed.
    - Found by: the M5 UX review (finding 16).
    - Fix and pin: the note first says only that the map is loading; the troubleshooting (`.hcm-note-late`) shows after 4 s through the engine's stylesheet, and the e2e finishes the animations from outside instead of waiting (`S-V27-BAD-INTEGRITY`, the tour state `kit.loading-note`).
    - **A fallback message shown on every load is read by everyone: say the neutral part first and the fix only when it is due.**
249. **ARIA set on a custom button's host named nothing.**
    - Seen: the city menu set `aria-haspopup` and `aria-current` on `hcm-button`'s host, but focus goes to its inner button; the tests asserted the host attribute, so a screen reader heard neither the popup nor the current city.
    - Found by: the M5 UX review (finding 10).
    - Fix and pin: `hcm-button` takes `popup`, `current` and `label` as properties for its inner button (as `pressed` already was); the switcher is named "City: …" and the tests read the inner button (`packages/ui/test/components/button.test.ts`, `S-A49-HAPPY`).
    - **Lesson 229 again: test the element that has the focus, never the host around it.**
250. **On a phone the open city was named nowhere.**
    - Seen: compact windows showed only the page's name; the city list sat inside the account menu, so an admin of two cities could edit the wrong one, and that list never refreshed.
    - Found by: the M5 UX review (finding 8), from the 360 px switcher screenshots.
    - Fix and pin: a phone's top bar, a sideways phone's heading and the tab's title end with a middle dot and the open city's name for an admin of two cities or more (`cityTitle`); opening the account menu asks for the cities again.
    - **What a layout drops at a small size must still be said somewhere the person looks.**
251. **A city just made could be missing from the city menu for a minute.**
    - Seen: opening the menu to reach New city refreshed the cities, and a second opening within 60 s was throttled.
    - Found by: the M5 UX review (finding 17).
    - Fix and pin: Create calls `refreshCities(true)`, which skips the minute (`S-A50-HAPPY`).
    - **A throttle must give way to the action that made its data stale.**
252. **New city took three inputs only for a city already on screen.**
    - Seen: the map opened on the current city (or Europe), drawing mode blocked panning, and the budget test dragged over the current city's own view; drawing Cluj from Bucharest took six to ten inputs.
    - Found by: the M5 UX review (finding 3).
    - Fix and pin: `cities.locate` (one Nominatim search under the title suggestions' cool-down) finds the named city once typing rests; its rectangle is drawn, named and the map flies there, never over one the admin drew; the budget is two inputs, measured from Bucharest's view (`S-A50-HAPPY`, `S-A50-HAPPY-DRAWN`, `S-A50-BAD-NOT-FOUND`).
    - **Measure an input budget from where a person really starts, not from where the test happens to be.**
253. **A pinch on the New city map drew a rectangle between two fingers.**
    - Seen: the gesture ignored `pointerId`, so the second finger overwrote the press and lifting the first drew from one finger to the other; `touchstart` was always stopped, so pinch-zoom was dead while drawing.
    - Found by: the M5 UX review (finding 5).
    - Fix and pin: only the primary pointer draws, a second one cancels the drag, two-finger touches reach the map, and a dashed band shows the rectangle under way and the first click's corner (`packages/ui/test/admin/cities/area-gesture.test.ts`).
    - **A pointer gesture must follow one pointer by its id; every other pointer is someone else's gesture.**
254. **Typing the rectangle's edges judged an impossible rectangle at each edge.**
    - Seen: each edge before the fourth made a rectangle with zeros, and an alert told a keyboard user to drag on the map, up to three times; clearing one edge cleared all four.
    - Found by: the M5 UX review (finding 12).
    - Fix and pin: the edges stay a draft until all four are numbers (`area-edges.ts`), clearing one keeps the others, and the keyboard path has its own messages (`S-A50-BAD-EDGES-PARTIAL`).
    - **A form built from several fields should be judged when it is whole.**
255. **The focus fell to the page when New city and Export replaced their buttons.**
    - Seen: Create the city replaced the form and Export removed both buttons while the export ran; each `role="status"` was inserted already filled, which screen readers often skip.
    - Found by: the M5 UX review (finding 11).
    - Fix and pin: one live region per page, there from the start, says what happened; the done screen's heading takes the focus, and Export moves it to the card's heading before its button goes (`S-A50-HAPPY`, `S-A53-HAPPY`).
    - **When an action removes the control that had the focus, decide where the focus goes, and announce from a region that was already there.**
256. **The city budget showed limits that did not apply, and saving one imposed five.**
    - Seen: a city without limits (Bucharest) showed the new-city defaults as its limits, "used X of Y" used them as Y, and saving one field saved all five defaults with it.
    - Found by: the M5 UX review (finding 7).
    - Fix and pin: such a city says the project's caps alone hold it and shows empty fields; a field left empty saves at its maximum (`MAX_CITY_LIMITS`), so the limit typed is the only one set (`S-A52-HAPPY`).
    - **A form for optional limits must not show defaults as if they were in force, nor save them as a side effect.**
257. **An admin of two cities never reached the dashboard from an empty address.**
    - Seen: the full split run's Setup journey at three `tour-matrix` projects reloaded an empty address after Setup was complete and stayed on Setup; the owner administered two cities there (lesson 258), and an empty address was rewritten to `#/setup` as soon as it opened, before Setup's readiness was known, so its answer no longer found an empty address to send to the dashboard.
    - Found by: `bash scripts/ci/e2e-split.sh` (stage `all`), the M5 fixer's first full run.
    - Fix and pin: an empty address stays empty unless the page it opens names a city (a city page of an admin of two cities or more); Setup keeps it empty until readiness decides (`S-A49-HAPPY-FIRST-SCREEN`, `S-A49-BAD-FIRST-SCREEN-INCOMPLETE`).
    - **A rule that waits for an asynchronous answer must not destroy the input it waits on: rewrite the address only once the page it names is final.**
258. **The project's new owner was given every city of the project, other tests' cities included.**
    - Seen: `admin.claim` wrote the owner's `admins/{uid}` without `cities`, the mark of a document from before M5, so the next `admin.session` migrated it with every city that existed; in the e2e, the cities of the content worlds running beside the Setup journey, which then administered two cities (lesson 257).
    - Found by: the same run, from the city menu of the failure's snapshot naming a content world's city.
    - Fix and pin: the claim writes `cities: {}` for a new document and keeps an existing admin's own; `setup.createCity` then makes the owner the bundled city's owner (`functions/test/admin/claim.test.ts`).
    - **A missing field that means "migrate me" must never be written by the new code: write the new shape explicitly, even when it is empty.**
259. **The local stack's export Download, and any link followed in it, would have reached the real Google and USGS.**
    - Seen: the stack's shim forwards a page's requests and what its elements load, and leaves every `<a href>` alone; the export's **Download** is an `<a download>` the page clicks itself, pointed at a signed address on `storage.googleapis.com`, so in a person's browser it would have left the machine (the e2e tiers answer it with a Playwright route, which the stack has not). The manual plan also said the stack's firewall blocks **Comandă în EarthExplorer**; no firewall stands between a person and a link they follow.
    - Found by: the M4/M5 walk of `docs/MANUAL_TEST_PLAN.md`, a headless probe of the export through the stack that printed the download's address.
    - Fix and pin: the shim forwards an anchor with `download` when the page clicks it (`e2e/stack/browser.ts`), never a link a person follows; the stack's check gained "a file the page saves itself stays on the machine" (`e2e/stack/check.ts`); the plan says LOCAL links open the real site, so check their address instead.
    - **A stand-in for a firewall covers what the page does by itself, and the docs say exactly where it stops: test the claim the way a person would use it before writing it down.**
260. **The Cloud Scheduler jobs of `ops.tick` and `imagery.tick` were never made: their account was firebase-tools' shorthand.**
    - Seen: on the real project the 61 functions deployed, but both scheduled functions had no Cloud Scheduler job: the job create answered 400 `INVALID_ARGUMENT`. `runAs` returned `fn-admin@`, which Cloud Functions expands, and firebase-tools 15.33.0 copied it unexpanded into the job's `oidcToken.serviceAccountEmail`.
    - Found by: the user's live manual test of 2026-10-25 (`docs/research/manual-test-2026-10-25.md`, finding 11); no test could see it, as every test only compared the option with what `runAs` returned.
    - Fix and pin: `runAs` and the global default name `<account>@<project>.iam.gserviceaccount.com`, the project read from `GCLOUD_PROJECT` (else `GOOGLE_CLOUD_PROJECT`; neither is a refusal); `functions/test/deploy-shape.test.ts` builds each scheduled function's job with firebase-tools' own `jobFromEndpoint` and pins the full address (`S-A55-HAPPY-SCHEDULER-ACCOUNT`, `S-A55-BAD-NO-PROJECT`).
    - **Test a deploy option where it is used, not where it is made: run the deploy tool's own code over the manifest.**
261. **The legacy import stopped at 0 of 45 photos: the events never reached the server.**
    - Seen: the uploads reached Storage, but `photos.onUpload` never ran: Eventarc delivers an event with the function's own account (`fn-events@`), which had no `roles/run.invoker` ("lacks run.routes.invoke"); Cloud Scheduler's OIDC calls as `fn-admin@` would have met the same refusal. Each stuck photo then waited ten minutes before it was listed.
    - Found by: the live manual test of 2026-10-25 (finding 17); the emulators skip IAM, so no e2e or rules test could see it. The role was granted by hand with the user's yes.
    - Fix and pin: Prepare the project grants `roles/run.invoker` to `fn-events@` and `fn-admin@` (`S-A04-HAPPY-INSTALLER-ACCOUNT`); the self-test's `events` check sends a nonce through `ops/probe` to `ops.onProbe` and back, the real-data probe on the owner's Check again (`S-A03-HAPPY-EVENTS-REACH`, `S-A03-BAD-EVENTS-REFUSED`); the import sends a photo still `pending` after two minutes to `photos.reprocess` once, then lists it as not received with the step that fixes it (`S-A28-HAPPY-STUCK-REPROCESSED`, `S-A28-BAD-STUCK-AGAIN`).
    - **What the emulators skip (IAM, service agents, propagation) needs a check that runs on the real project, and the flow that depends on it must not wait blindly for it.**
262. **Prepare the project failed right after Google said it had switched an API on.**
    - Seen: "Service accounts" failed with `SERVICE_DISABLED` for `iam.googleapis.com` seconds after "Google services enabled" was done: an API that `services:batchEnable` reports on keeps refusing for a few minutes, and its dependants waited for a click on Retry what failed.
    - Found by: the live manual test of 2026-10-25 (finding 4); the fakes enabled an API at once.
    - Fix and pin: the transport waits out a `SERVICE_DISABLED` of an API Service Usage reports on (10, 20, 40, 60 and 60 s on the injected clock), the item saying it waits, then names it `apiError.cloud.apiPropagation`; the fake's scenarios `service-usage.propagation` and `propagationSlow` play the delay (`S-A04-HAPPY-API-PROPAGATION`, `S-A04-BAD-API-STILL-DISABLED`).
    - **A fake that answers at once hides every delay of the real service: give it the delays the real one is known to have.**
263. **The Vertex AI check said only "Something went wrong on the server".**
    - Seen: Translation drafts (Vertex AI) failed on the real project with `apiError.internal`, and the log said `{check, code}` only; Vertex AI's metrics showed no request, so nothing told the cause. From the code: any answer the check did not map (a 404, 400, 401 or 409) became `apiError.internal`, and Google's status and reason were dropped.
    - Found by: the live manual test of 2026-10-25 (finding 20).
    - Fix and pin: `UpstreamError` keeps Google's `error.status` and the first `ErrorInfo` reason (names only, never the message), the self-test logs them with the service, failure and HTTP status, a 404 names the model (`apiError.assist.modelUnavailable`, the drafts button too) and any other refusal Google's reason (`apiError.cloud.refused`) (`S-A45-BAD-MODEL-UNAVAILABLE`, `S-A45-BAD-UPSTREAM-LOGGED`).
    - **A check exists to say why: an unmapped failure must name the upstream's own reason, never fall back to "internal".**
264. **The first functions deploy failed for the event triggers until Eventarc's service agent had its role.**
    - Seen: 14 Eventarc-triggered functions failed with "Permission denied while using the Eventarc Service Agent" on the first deploy and deployed on a second run: the deploy itself created the agent, minutes before the triggers needed its role.
    - Found by: the live manual test of 2026-10-25 (finding 12).
    - Fix and pin: Prepare the project generates the Eventarc and Pub/Sub service identities before its role table (`S-A04-HAPPY-INSTALLER-ACCOUNT`; a refusal is named on the permissions' row, `S-A04-BAD-IDENTITY-REFUSED`), so they have propagated before the server is installed; the in-app installer's build retries the known first-deploy races (`docs/research/M6-interfaces.md` §1.5).
    - **Create what a later step waits for as early as possible, so its propagation is over by the time it is needed.**
265. **Retry what failed on Prepare the project lost to the run it retried.**
    - Seen: in an admin session, Retry what failed provisioned every item, and the card then showed 13 of 16 again, "Service accounts" to do without a reason: the card re-enabled the button before the first run's `setup.recordCloud` had answered, the retry recorded first, and the older record, applied last, replaced the items.
    - Found by: the e2e `S-A04-BAD-API-STILL-DISABLED`, failing about one run in two once the Functions emulator's first `recordCloud` was slow (a cold worker); the unit tests answered the record at once.
    - Fix and pin: the card stays busy until the run is recorded (`packages/admin/test/setup/provision.test.ts`, `badPath_retryWaitsUntilTheRunIsRecorded`; `S-A04-BAD-API-STILL-DISABLED`).
    - **A step is done when what it writes has landed: enable the next click only after the last write of the previous one has answered.**
266. **A click on an install card waited minutes for its next look.**
    - Seen: after Install the server, the card stayed "Waiting for Google Cloud Build" while the fake build had started and stopped: the card's watch had been running before the click, in a back-off of up to four intervals after looks that failed before the project was prepared.
    - Found by: the e2e `S-A55-BAD-BUILD-FAILED` and `S-A55-HAPPY-RETRIED`; the unit tests started each flow fresh.
    - Fix and pin: a click restarts the card's watch (`installWith`, `packages/admin/src/install/install-flow.ts`); the specs also wait for the build the browser submitted before they move it on (a scenario applied before the POST finds no build).
    - **A user's action resets whatever back-off the background polling built up before it.**
267. **Update the map did nothing for a target Setup had recorded behind.**
    - Seen: on a claimed map whose pipeline `setup/status` recorded `updateAvailable`, the pipeline card offered Update the map and the click asked no consent and submitted nothing.
    - Found by: the e2e `S-A56-HAPPY-UPDATE`; the unit test reached the button through a look, never through a record.
    - Fix and pin: Update the map reads which targets are behind from what the cards show, recorded states included (`packages/admin/src/setup/install.ts`; `happyPath_aTargetRecordedBehindIsUpdatedBeforeItsCardLooked`).
    - **An action must decide from the same state its button was rendered from.**
268. **Two records of one card, sent a second apart, landed in the wrong order.**
    - Seen: `setup/status.install` kept `retrying` after the card had shown `failed`: each state change sends `setup.recordCloud` without waiting for the previous one, and the later call answered first.
    - Found by: the tour's settle check in `e2e/admin/specs/install/states.spec.ts` at `admin-m768-ro`.
    - Fix and pin: the server keeps a stored target record checked later than the reported one (`functions/src/setup/record-install.ts`; `badPath_aReportOlderThanTheStoredRecordOfItsTargetIsDropped`).
    - **A record of "the last known state" carries its own time and the writer refuses an older one.**
269. **"Installed: {release}, {date}." stopped matching the spec's pattern after Prettier wrapped the template.**
    - Seen: the paragraph's text gained the template's line break and indentation, so `getByText(/^Installed: .+, .+\.$/)` found nothing although the line was on screen.
    - Found by: the e2e `S-A55-HAPPY`.
    - Fix and pin: the text is computed before the template, which interpolates it alone (`installedLine`, `packages/ui/src/admin/setup/install-status.ts`).
    - **Interpolate a sentence as one value inside its element; a template long enough to wrap adds whitespace the page shows.**
270. **One install test broke the reset of every test after it.**
    - Seen: every test after `S-A57-HAPPY` failed in its fixture with `Firestore reset: 409 ... Transaction lock timeout`; a minute's wait made it pass. The test had written `manifests/bucharest` without its stamp while the publish trigger of the seeded city was still requesting a build: the trigger's transaction read a record its schema refuses, failed, and was retried, holding the document each time.
    - Found by: the e2e `admin/steps/install/site.spec.ts`, run alone (the full run's order had hidden it); bisected by ending the test earlier and earlier.
    - Fix and pin: `seedPublishedMap` (`e2e/admin/support/install.ts`) waits for the seeded city's own build to end, then writes the published record with the publisher's stamp; the install specs also end only when no `setup.recordCloud` of the page is under way (`trackRecords`, `recordsSettled`), and the cards send their records one after another (`packages/admin/src/setup/install.ts`).
    - **Seed a record exactly as its writer leaves it, and only once the writer is done: a half-valid record makes the system's own retries hold it.**

271. **The busy indicator covered the status chip's label, and no checker saw it (finding 6 of 2026-10-25).**
    - Seen: live, while Prepare the project worked, the M3 loading indicator was drawn over its step's chip ("To do") in the list and in the card's header, hiding the text.
    - Found by: the user's manual test; the tour had passed the busy state at every viewport, because the occlusion check samples a text's centre and the overlap check looks at floating chrome only, so an indicator spilling 10 px over a label's edge passed both.
    - Fix and pin: the indicator replaces the chip's icon and label while the step is busy (setup-ux, S-A31-HAPPY-BUSY-CHIP); the tour's new `graphic-overlap` check (`e2e/support/layout-rules.ts`) fails a visible graphic over a text by more than 1 px at every state, with unit tests of both sides. A page helper of the checkers may reference only browser globals and the other helpers: a module constant is undefined in the page.
    - **A checker that samples points proves what it samples: a defect between the points needs a check of its own shape.**

272. **The Setup page's fix links showed the browser's own focus ring, which only the phone's tour project failed.**
    - Seen: the tour state `setup.checks-optional-off` failed its focus-ring contrast at `admin-c360-ro` only (2.16:1): Android's default ring is orange; the desktop's near-black one passes, so the other projects could not see it.
    - Found by: the e2e tour at the compact project (setup-ux, `DECISIONS-for-review.md` §70k).
    - Fix and pin: `hcm-setup-page` takes the kit's `focusRing` in its styles; a unit test pins the ring's style and colour.
    - **An element that renders its own links needs the kit's focus ring in its styles; a browser default differs per platform, so a desktop pass proves nothing.**

273. **Publish the map stayed off after the photos were published, because the card could no longer look.**
    - Seen: in the whole-Setup journey the site card said "The map has nothing to show yet" for ten minutes after the 45 photos and the manifest were published; the button stayed off, so the owner had no way on but Check again (one more input and consent).
    - Found by: the e2e `admin/specs/journey.spec.ts` (S-A30-HAPPY-NO-TERMINAL), the first test that publishes the map in the same tab as the import. The site specs seed the published city before the page opens, so their first look already saw it.
    - Cause: the blocker was observed while Prepare the project's token lived; the analytics consent then replaced the tab's token (the newest one is kept), so the card's watch stopped (`liveAccess` null) with the stale blocker on screen.
    - Fix and pin: `InstallerPort.localBlocker` re-checks the one blocker of the admin's own data (the first city's manifest, from Firestore) once an idle interval with no Google token, until it lifts (`install-flow.ts`, unit tests both ways); the click then asks Google's consent once, as §4.2 allows.
    - **A watch that needs a token must not freeze a reason that needs none: re-check what the app can read itself.**

274. **Setup said it was done before the server and the public map were installed.**
    - Seen: the journey's header read "Setup is done; USGS is left for later…" while Publish the map was still to do.
    - Found by: the same journey (its error context); the contract asked for it (M6 §4.1, CR-M6-13 (1)), and the shared `setupDone` had it, but the admin's own `ready` still counted billing, Provision and Mapbox only.
    - Fix and pin: `refreshDerived` (`packages/admin/src/setup/state.ts`) adds the install part: the server and the site installed, a target nothing has looked at or recorded (a map from before M6) not holding it back, as `setupDone` reads a status without `install`; `state.test.ts` pins both.
    - **Two readers of one rule (the server's `setupDone`, the admin's `ready`) drift unless a test asks both the same question.**

275. **Home's trial reminder test saw an update tile it did not ask for, or no reminder at all.**
    - Seen: the split `quality` failed S-A60-HAPPY and S-A60-BAD-EXISTING-ACCOUNT on the NUC; locally the list read `["installUpdate", "trial"]` once and `[]` the next time.
    - Found by: the integrator's split run (the setup-ux workstream had run the spec before the installer's Home tile and its records landed).
    - Cause: the billing step's Google token let the server card look at the seeded functions, which name no release, so it recorded an update, which Home's tile showed beside the trial; and the helper read Home's list once, before the live `setup/status` and the cards' records had all arrived.
    - Fix and pin: the spec's `expectReminders` polls the list until it is the expected one and leaves out Home's installation tile (A55's behaviour); "It is a paid account" waits for the trial reminder alone to go.
    - **A list that follows live data is asserted with a poll, and a spec counts only the items of its own behaviour.**

276. **The public map could read the owner's sign-in, because M6 put both on one origin.**
    - Seen: the admin's `getAuth` kept the owner's Firebase refresh token in IndexedDB (`firebaseLocalStorageDb`), which belongs to the whole origin; since M6 the viewer's pages (`/`, `/<city>/`) share it with `/admin/`, so any script there could act as the owner.
    - Found by: the M6 security-cost review (finding 1); no test looked at where the sign-in is kept, and the per-path CSP covers `/admin/**` only.
    - Fix and pin: Auth is created with `browserSessionPersistence` (the tab's `sessionStorage`; `DECISIONS-for-review.md` §73a, one sign-in per tab); the e2e tier signs a persona in through an admin-path init script, and S-A58-BAD-VIEWER-READS-NO-SIGN-IN opens the viewer in the same context and finds no user in `localStorage`, `sessionStorage` or IndexedDB.
    - **Moving two apps onto one origin merges their storage: a path is no boundary for IndexedDB, `localStorage` or cookies, so decide what each keeps before the move.**

277. **A newer server missing one function looked "not installed", so an older admin would have replaced it.**
    - Seen: `serverInstalled` dropped the installed release whenever the deployed set was incomplete, the state became `notInstalled`, which allows a submit; the build's `--force` deletes the functions the older source lacks.
    - Found by: the M6 security-cost review (finding 2).
    - Fix and pin: the observation keeps the newest release any part names (`InstalledInfo.newest`) and `deriveInstallState` refuses on it before looking at completeness (S-A55-BAD-DOWNGRADE-INCOMPLETE, `model.test.ts`).
    - **A guard against a downgrade reads the newest thing deployed, whatever else is missing; "incomplete" must never mean "nothing there".**

278. **A token minted before its record could fail was never recorded, and each tick minted another.**
    - Seen: `ops.tick` minted the viewer token at Mapbox, then wrote it in a transaction the city's schema checks; an origin the schema refuses failed the write and left a live token behind, every 15 minutes.
    - Found by: the M6 security-cost review (finding 3).
    - Fix and pin: the origins are checked at build and at run time against the schema's own pattern, and a failed write deletes the minted token (S-A06-BAD-ORIGINS-REFUSED, S-A06-BAD-UNRECORDED-TOKEN-DELETED).
    - **An outside resource created before a local write needs its undo on that write's failure, and the input the write will check should be checked before the creation.**

279. **The public install bundle packed whatever was in `functions/dist`.**
    - Seen: `server.tgz` copied the whole folder, dotfiles included; firebase-tools leaves `*.local` out of a deploy, the bundle did not, and it is served to anyone.
    - Found by: the M6 security-cost review (finding 5); latent (nothing writes such a file there today).
    - Fix and pin: an allowlist of the functions' build files; anything else fails `build:install` (`install-bundle.test.ts`, `.secret.local` and `.env.local` among the cases).
    - **What is published is an allowlist; a tool's own exclusions protect only that tool's output.**

280. **The live map had no way to its update: the step's Done chip hid the button, and a partial server read as not installed.**
    - Seen: in an admin session step (d) is always done, and the server card offered Install or Try again only while it was not, so a stopped update had nothing to click; the live server (61 of 69 functions, no release) was `notInstalled`, so neither Update the map nor Home's tile appeared, and the owner steps of `M6-status.md` §3 could not be followed.
    - Found by: the M6 min-input review (finding 1); every spec started either from a fresh project or from a complete server.
    - Fix and pin: the card's button follows the install's state; a partial target is `updateAvailable` (S-A55-HAPPY-PRE-M6-UPGRADE, S-A55-BAD-UPDATE-FAILED-ADMIN, the fake's `cloud-functions.preM6`).
    - **Seed the world the live project is in, not only a fresh one and a finished one: an upgrade from the last release is a scenario of its own.**

281. **Retry what failed re-ran only the item a pre-M6 record lacked, so the installer's account was never made.**
    - Seen: the live record had 15 items ok and the 16th never reported; the rerun touched that one alone, step (c) turned green, and the install cards' blocker sent the owner back to a step with no button.
    - Found by: the M6 min-input review (finding 2).
    - Fix and pin: an item never reported (`missing` with no reason) makes the rerun take every item (`provision.ts`, S-A04-BAD-PRE-M6-RECORD).
    - **When a release adds an item that changes what the old items mean, a record from before it is stale as a whole.**

282. **A look on step (d) put the claim back to waiting in an admin session, and the tour's screenshot showed it.**
    - Seen: the deploy probe set d2 to `pending` after every successful look, closing steps (e) to (i) until a reload; `reports/screenshots/m6/admin.setup.install-update/` showed d2 "Waiting" on a claimed map, and every checker passed.
    - Found by: the M6 min-input review (finding 4), from the screenshot.
    - Fix and pin: the claim follows the server in start-up mode only (`deploy.ts`); the tour state checks the claim's chip (`specs/install/states.spec.ts`), and S-A55-HAPPY-PRE-M6-UPGRADE checks it through an update.
    - **The layout checkers judge how a state looks, not whether it is right: a state's spec asserts the facts the screenshot shows.**

283. **Every update, and one Cloud Build 503, made Setup look not done.**
    - Seen: the cards recorded every state change (`queued`, `working`, `unavailable`), while `setupDone` and the admin's `ready` accepted only the installed states, so the dashboard-first rule sent the owner to Setup for the length of an update.
    - Found by: the M6 min-input review (finding 5).
    - Fix and pin: a target is installed while a release of it is recorded, whatever its build does, in both readers of the rule; `unavailable` is never recorded (`setup-done.test.ts`, `state.test.ts`, `install.test.ts`, S-A55-HAPPY-DONE-WHILE-UPDATING).
    - **A state that says what is running is not a state that says what is installed: a "done" rule reads the latter.**

284. **A signed-out spec stayed signed in once the e2e sign-in moved from the storage state to an init script.**
    - Seen: S-A20-BAD-SIGNED-OUT-DEEP-LINK failed at every admin project of the split `all`: its `test.use({ storageState: { cookies: [], origins: [] } })` no longer cleared anything, since the persona's session now comes from `context.addInitScript` (lesson 276).
    - Found by: the fixer's split `all` run; the admin tier's own specs passed, the content specs' signed-out describe did not.
    - Fix and pin: the content fixtures take an option `signedIn` (default true), and the signed-out describe sets it to false; no spec overrides `storageState` any more.
    - **When a fixture changes how a state is made, every override of the old mechanism silently stops overriding: grep for them in the same change.**

285. **A privacy check of `sessionStorage` failed once Firebase Auth's session moved into it.**
    - Seen: S-A25-BAD-RELOAD-KEEPS-STEPS asserted that the tab's whole `sessionStorage` held no e-mail address; since §73a it also holds Firebase Auth's signed-in user (its e-mail and refresh token, kept in the tab on purpose).
    - Found by: the fixer's split `all` run (on the NUC).
    - Fix and pin: the check reads the app's own `hcm:` entries for the bootstrap record's promise, and pins that the only other entries are Firebase's (`firebase:*`, the user's key among them) and that no Google token (`ya29.`) is anywhere.
    - **A check over a whole storage asserts what the app writes, plus an explicit list of what libraries may write beside it.**

286. **Home's update tile opened step (d), and Setup then moved on to the next step under the spec.**
    - Seen: S-A55-HAPPY-UPDATE failed as the first test of a fresh run (twice), passed later in the same run: the card was open, then the pipeline's was.
    - Found by: the fixer's targeted reruns of `e2e/admin/steps/install/update.spec.ts`.
    - Cause: the link opens (d) before `setup/status` arrives; when it does, (d) turns done while open and hands over to the first step not done (`withStep`), as Setup does after any step.
    - Fix and pin: the spec opens the card again until it shows the update (`toPass` around `setup.show`), as `SetupPage.visit` already waits for Setup to settle.
    - **A card opened by a link may be handed over once the record arrives: a spec waits for what it needs on the card, re-opening it, never for the first open.**

287. **A split run's emulator logs failed the next run's secret scan.**
    - Seen: the fixer's second split `all` failed `static/gitleaks` with 3,200 findings, all in `firebase-debug.log` at the root: the Firebase CLI's log of the previous run's emulators, which Playwright stopped, so they never removed it; it holds the Auth emulator's test tokens.
    - Found by: the fixer's runs (the first run's `static` came before any emulator, the second after one).
    - Fix and pin: the stray gitignored logs were deleted before the next run; `.gitleaks.toml`'s scope allowlist names them since 2026-11-01 (`DECISIONS-for-review.md` §73l, the user's decision); `gitleaks-history` still scans every committed path.
    - **A gitignored file is still in a directory scan's scope: whatever a run leaves behind, the next run's `static` reads.**

288. **A bump left the old hoisted copy of a peer in the lockfile, and two copies of one library stopped meeting.**
    - Seen: after the dependency update of 2026-10-31, `tsc` failed in `e2e/` (two `Page` types: `playwright-core` 1.64.0 hoisted for `@axe-core/playwright`'s peer, 1.64.1 nested under `playwright`), and every rules test failed with `Service firestore is not available` (`@firebase/app` 0.16.3 hoisted, 0.16.4 nested under `firebase` 13.1.0 and `@firebase/app-compat`, so Firestore registered on one app and the compat layer asked the other).
    - Found by: `static/tsc` and `tests/vitest` (project `rules`).
    - Cause: a peer that accepts any version (`>= 1.0.0`, `0.x`) keeps its lockfile entry; npm nests the bumped package's own copy instead of moving the hoisted one.
    - Fix and pin: `npm update playwright-core` and `npm update @firebase/app` in the pinned Node image, which leave one copy each; `pipeline_skill.md` → *Local tooling quirks*.
    - **After a bump, `npm ls <its core package>` must show one version: a library that registers itself (Firebase components, Playwright's types) breaks when two copies load.**

289. **typescript-eslint 8.72 reports a test double of `Pick<Document, ...>` and `dns.lookup`'s `verbatim` as deprecated.**
    - Seen: `no-deprecated` on `packages/engine/test/mount-support.ts` (`createElement`, `querySelector`: `Pick<Document, ...>` carries the DOM's deprecated overloads for legacy tag names) and on `functions/src/adapters/remote-files.ts` (`verbatim`, which Node replaced with `order`).
    - Found by: `static/eslint` after the bump from 8.71.1.
    - Fix and pin: `MountEnvironment.document` is a two-method port with the one signature `mount` uses (`createElement(tagName: typeof VIEWER_TAG): HcmMapViewer`), and the resolver asks for `order: 'verbatim'`.
    - **A port names the signatures it calls, not a `Pick` of a DOM type: the DOM's overloads come with it.**

290. **Two functions tests disagreed on the default bucket, and the first file to load the functions won.**
    - Seen: `functions/test/index.test.ts` (the unit test of the deployed triggers) expected `demo-hcm-private.firebasestorage.app` and received `demo-hcm.firebasestorage.app` in two of three `tests` runs of 2026-10-31.
    - Found by: `tests/vitest` (project `functions`, one shared module graph per worker).
    - Cause: `deploy-shape.test.ts` (M6) also loads `src/index.ts`, with `demo-hcm.firebasestorage.app` in `FIREBASE_CONFIG`; the shared graph evaluates `index.ts` once and firebase-functions caches the first configuration it reads (`firebaseConfig()`), so the value depended on which file ran first.
    - Fix and pin: every test that loads `src/index.ts` sets the same bucket; the assertion still tells it from the `GCLOUD_PROJECT` fallback (`<project>.appspot.com`).
    - **In a shared module graph a module-level value is fixed by the first file that loads the module: tests that load it must agree on every input it reads at load time.**

291. **The e2e mock kept serving Mapbox GL JS 3.32.0 after the bump to 3.34.1, and almost every browser test failed.**
    - Seen: 2,300 failures in the split `all` of 2026-10-31 (`console errors or uncaught page errors`: 404 for `https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js` and `.css`; then `the page receives hcm-ready` and `the admin map is created`).
    - Found by: the e2e and tour-matrix tiers; `static`, `tests` and `build` were green.
    - Cause: `e2e/mock-apis/router.ts` matched the library path with a regular expression that spelled the version escaped (`v3\.32\.0`), so the bump's search for `3.32.0` missed it.
    - Fix and pin: the route is built from the version in the installed `mapbox-gl/package.json`, so the mock always serves the pinned devDependency; a package.json without a release stops the mock at start.
    - **A version that must follow a pin is read from the pin, never repeated, and a search for a version also looks for its escaped spelling.**

292. **The install bundle's `tools/` lock could not be installed by `npm ci`: its `package.json` lacked the root `overrides`.**
    - Seen: `npm ci --offline` of the generated `tools/` folder stopped with `ENOTCACHED` for `@opentelemetry/core` (2026-10-31); npm re-resolves every dependency whose locked version lies outside its dependant's range, and the overridden `@opentelemetry/core`, `basic-ftp`, `glob` and `uuid` all do. Online, the re-resolved tree would not match the lock.
    - Found by: vendoring `minimatch` (§74f), whose link the folder had to follow; no test installed the folder, and the unit tests only read the lock's paths.
    - Cause: `tools-lock.ts` cut the tree out of the root lockfile, which npm had resolved under the root `overrides`, but wrote a `tools/package.json` with `firebase-tools` alone.
    - Fix and pin: `tools/package.json` carries the root `overrides` (a `$name` only when `tools/` has that dependency) and the `file:` link of each vendored copy the tree reaches, whose folder the bundle carries; `install-tools-lock.test.ts` asserts both on the repository's own lockfile.
    - **A lock cut out of another installs only with the manifest that produced it (its `overrides` and links): check such a lock with `npm ci`, not by reading its paths.**

293. **The `/admin` → `/admin/` redirect matched its own destination in the Hosting emulator.**
    - Seen: `GET /admin/` answered `301 Location: /admin/` in the Hosting emulator on 2026-10-31 (a redirect loop), while the repository's own Hosting model served the admin.
    - Found by: the minimatch vendoring check, which ran superstatic over the built tree.
    - Cause: a redirect `source` is a glob, and superstatic's glob matching lets `/admin` match `/admin/` as well.
    - Fix and pin: the rule is `"regex": "^/admin$"` in `firebase.json`; `admin-hosting.test.ts` asserts that `/admin/` and the admin's routes never redirect.
    - **A redirect to the same path with a slash added is written as an anchored regex, never as a glob.**

294. **axe-core 4.14 reported targets and text under a scrolling pane's hidden content as obscured, and 46 tour and admin tests failed.**
    - Seen: after the dependency update of 2026-10-31 (`@axe-core/playwright` 4.13.0 → 4.14.0, which brings `axe-core` 4.14.0), the split `all` failed 46 Playwright tests on `target-size` and `color-contrast`: the Mapbox logo at the foot of About "partially obscured" by the language button scrolled out of sight above it, the account and city buttons of the admin's top bar, the places list's search and rows, the Settings sections' links, a layer's opacity slider, and text read against the colours of content scrolled under the bar. Nothing on the page had moved.
    - Found by: the tour's and the admin specs' generic accessibility checker (`assertAccessible`, the scroll sweep); `static`, `tests` and `build` were green, and the component tests' axe never scrolls a slotted pane.
    - Cause: axe-core 4.14.0 rewrote `findScrollRegionParent` to walk the DOM parents (`parentElement || parentNode`) instead of starting from the flattened tree's cached parent. Slotted content's DOM parent is the shadow host, not the slot, so the walk never meets the scrolling element inside the shadow root: the content lands in the page's grid unclipped, and every neighbour of its hidden part counts as covered. A ten-line page (a slotted button scrolled half out of an `overflow: auto` pane in a shadow root, a button under the pane) fails `target-size` on 4.14.0 and passes on 4.13.0; the same pane without a slot passes on both (4.14.0 is the latest release of both packages on 2026-10-31).
    - Fix and pin: `@axe-core/playwright` is held at 4.13.0 (its `axe-core ~4.13.0`) with a `HELD` entry in `scripts/ci/check_dependency_updates.py` and `docs/CI_PIPELINE.md` → *Held dependencies*; the lockfile's three axe entries are those of before the update, and `npm install --package-lock-only --offline` in the pinned Node image leaves it unchanged. The assertions stay as they were; the rows S-V15-HAPPY, S-A35-BAD-KEYBOARD-LIMITS, S-A32-BAD-NO-MAP-TOKEN, S-A34-HAPPY-ROUND-TRIP, S-A19-BAD-ZERO-AREA-BOUNDS, S-A02-BAD-REVOKE and S-A13-BAD-SCANNED-WHILE-MARKING pass again. `@hcm/test-support` keeps its own `axe-core` 4.14.0.
    - **A checker's upgrade that fails many states at once, with nothing on the page changed, is diffed against the old checker on a minimal page before any product code or assertion moves: a false positive is held back, never suppressed.**

295. **The account menu's theme choice ran past the dialog's edge for a frame each time the menu updated.**
    - Seen: `admin/specs/smoke.spec.ts` at `admin-c360-ro` failed now and then on `admin.account-menu` (the theme segments side by side, "Întunecată" 20 px past the 312 px dialog, which scrolled sideways) and on its text-spacing variant (62 px): once in the split `all` of 2026-10-31 and once in three runs of the test alone, before and after that day's dependency update.
    - Found by: the generic layout checker's `sideways-scroll` (lesson 66), when its measurement landed in the one frame after an update of the menu; `segmented-button.test.ts` never handed the same labels over again.
    - Cause: `hcm-account-menu` builds the theme and language options in `render` (`themeOptions(locale)`), so every update of the menu, such as the cities that opening it asks for again, gave `hcm-segmented-button` a new array; `updated` treated any new `options` as new labels, set `stacked` to false and stacked the segments again only on the next animation frame.
    - Fix and pin: the segments are measured side by side again only when what they draw changes (value, label, icon; `segmentsOf` in `packages/ui/src/components/segmented-button.ts`); `badPath_theSameLabelsInANewArrayKeepTheStackWithoutAFrameSideBySide` fails on the old element, and the smoke test that checks the account menu (S-A31-HAPPY) passed five runs of five at `admin-c360-ro`.
    - **A component that re-measures when a property changes compares what the property draws, never the object's identity: parents rebuild arrays on every render.**

296. **An old admin address typed on the open start-up root stayed there; a fresh load forwarded it.**
    - Seen: live on 2026-10-31 (finding 25 of `docs/research/manual-test-2026-10-25.md`), `/#/setup` typed while `/` (the start-up page) was open did not reach `/admin/#/setup`.
    - Found by: the user's live walk. The unit tests and S-A58-HAPPY-OLD-LINK only loaded the address fresh (`page.goto` to another document), where the script runs.
    - Cause: `admin-redirect.js` read `location.hash` once, when the page loaded; a hash typed into the address bar of an open page fires `hashchange` and loads nothing.
    - Fix and pin: `forwardOldAdminAddress` also listens to `hashchange` (`scripts/site/src/hosting/admin-redirect.ts`); S-A58-HAPPY-OLD-LINK-HASH-CHANGE and S-A58-BAD-VIEWER-HASH-CHANGE type the hash on the open start-up root, and `hosting-pages.test.ts` fires the event.
    - **Anything a page does with its address it also does on `hashchange`: a hash typed into an open page loads nothing.**

297. **The M6 admin read the steps an older server had recorded as "To do".**
    - Seen: live on 2026-10-31 (finding 27), the admin `1.0.0+18977f0` against the 61 functions of `90b31be`: Setup read 3 of 11, with the claim, Mapbox, USGS, Analytics and the old photos "To do", all Done (USGS Waiting) in the old admin against the same server.
    - Found by: the user's live walk. Every e2e world pairs the admin with the server of the same commit (the emulators run the tree's functions), and S-A55-HAPPY-PRE-M6-UPGRADE fakes only the Cloud Functions list of an older server, not its answers.
    - Cause: `admin.session`'s response schema gained M5's required `cities` and `projectOwner`, which a pre-M5 server does not send; the adapter turned the parse failure into `internal`, which the probe reads as "no server", so the admin stayed in start-up mode and never asked `setup.status`. In start-up mode step d waited for the 69 functions of the M6 registry, so the 61 never led to the probe and the claim that had ended start-up mode by itself in October; and a step no check had seen read "To do".
    - Fix and pin: a pre-M5 session parses (no city, not the project's owner); an answer the admin cannot parse is `apiError.serverOutdated`, which proves a server; a browser that had seen the server probes it at start, as before, and reads its answer; a step the older server cannot say reads **Update the server to check** (`adminSetup.state.unknown`). Rows S-A03-HAPPY-OLDER-SERVER and S-A03-BAD-OLDER-SERVER-STATUS answer the emulated server's calls in the older shapes (`answerAsOlderServer`), with unit tests in `adapters.test.ts`, `auth/controller.test.ts`, `setup/deploy.test.ts`, `setup/state.test.ts` and `setup/controller.test.ts`.
    - **A new required field in a response breaks every older server: add fields as optional or defaulted, tell "answered in an older shape" from "did not answer", and test the admin against the previous release's answers, not only its own.**

298. **The installer stopped at firebase-tools' own permission check, which no fake modelled.**
    - Seen: live on 2026-10-31 (finding 28), the first in-app install of the server stopped at its `functions` step: "Missing permissions required for functions deploy. You must have permission iam.serviceAccounts.ActAs on service account <project>@appspot.gserviceaccount.com".
    - Found by: the user's live walk. The fake Cloud Build plays each build without running a step, so nothing of what `firebase-tools` checks before it deploys was ever exercised; §1.2 of `M6-interfaces.md` listed only the roles the deploy's API calls need.
    - Cause: `firebase-tools` 15.34.2 runs, before a deploy, checks of its own whose permissions are not those of the deploy's calls. The full list, read from `lib/commands/deploy.js`, `lib/requirePermissions.js`, `lib/deploy/index.js` (`TARGET_PERMISSIONS`), `lib/deploy/functions/{checkIam,deploy,prepare,triggerRegionHelper}.js` and `services/{storage,firestore}.js`, against `hcm-installer@`:
      - `requirePermissions`, every target: `firebase.projects.get` (Firebase Viewer); functions: `cloudfunctions.functions.{list,create,get,update,delete}`, `cloudfunctions.operations.get` (Cloud Functions Developer); firestore: `datastore.indexes.{list,create,update,delete}` (Datastore Index Admin); storage: `firebaserules.{releases.create,rulesets.create,releases.update}` (Firebase Rules Admin); hosting: `firebasehosting.sites.update` (Firebase Hosting Admin). Advisory: the function catches its own refusal and only logs it, but the deploy's calls need the same permissions.
      - `checkServiceAccountIam`, any functions target, fatal: `iam.serviceAccounts.actAs` on `<project>@appspot.gserviceaccount.com` when the account exists. **Missing: the live failure.**
      - `checkHttpIam`, a deploy that creates an HTTPS function, fatal: `cloudfunctions.functions.setIamPolicy` on the project, which Cloud Functions Developer lacks. **Missing: the next failure on a fresh project, or on the live one once M6 adds an HTTPS function.**
      - `ensureTriggerRegions`, every functions deploy with event triggers: Firestore's database metadata (`datastore.databases.getMetadata`) and each Storage trigger's bucket (`storage.buckets.get`; fatal: "Can't find the storage bucket region"). **Not granted by name in any of the installer's roles: added.**
      - `ensureApiEnabled` (functions and hosting): `serviceusage.services.get` (Service Usage Consumer); enabling only if an API is off, which Provision prevents.
      - `generateServiceIdentity` for Pub/Sub and Eventarc, every deploy with gen 2 functions, fatal: UNVERIFIED which permission Google checks (the installer holds Service Usage Consumer); if the next install stops there, the log names it and the narrowest role holding it joins §1.2.
      - `ensureServiceAgentRoles`, the first deploy of an event type: `resourcemanager.projects.getIamPolicy` (`hcmInstaller`), and `setIamPolicy` only if a binding is missing, which Provision binds first; `storage.getServiceAccount` and the compute default account's lookup (which falls back to its usual name).
      - Hosting: `requireHostingSite` (`firebasehosting.sites.get`, Firebase Hosting Admin).
    - Fix and pin: Provision grants `roles/iam.serviceAccountUser` on the App Engine default account only (S-A04-HAPPY-APPENGINE-ACTAS; none when the account is absent, S-A04-BAD-NO-APPENGINE-ACCOUNT), `hcmInstaller` gains `cloudfunctions.functions.setIamPolicy`, `datastore.databases.getMetadata` and `storage.buckets.get`; the IAM fake models the account and its policy, and the fake Cloud Build's server build stops at `functions` with `firebase-tools`' lines without the grant; the server's card offers step c's Retry what failed, which reruns the `iam` item only, then Try again (S-A55-BAD-NO-ACTAS). `DECISIONS-for-review.md` §75a, §75b (the account's Editor role).
    - **When a tool runs in the user's cloud, its own preconditions are part of the contract: read what it checks before it acts, list each check's permission against the account's roles, and make the fake enforce the checks.**

299. **A synthetic `visibilitychange` that does not bubble never reached the viewer's page-hide flush.**
    - Seen: 2026-10-31, writing `S-V19-BAD-ERROR-FLOOD-CAPPED` (`DECISIONS-for-review.md` §76): the second `map_errors` event, the count sent when the page is hidden, never came in one run of two.
    - Found by: the e2e spec itself (the first run passed by chance: its tile errors spanned the 30 s interval).
    - Cause: the test hid the page with `document.dispatchEvent(new Event('visibilitychange'))`; an `Event` does not bubble by default, while the browser fires `visibilitychange` with `bubbles: true`, so a listener on the window (telemetry's flush, `packages/engine/src/telemetry/telemetry.ts`) heard nothing; web-vitals, listening on the document, did.
    - Fix and pin: `hidePage` of `e2e/support/ga4.ts` overrides `document.visibilityState` and fires the event with `bubbles: true`, as the browser does; `telemetry.test.ts` flushes on a `visibilitychange` at the window.
    - **A test that fires a browser event fires it as the browser does: the same target, `bubbles` and `cancelable`, or a listener on another target is never tested.**

300. **The installer's functions step could not load the functions: the fakes trusted the laptop's module resolution.**
    - Seen: live on 2026-10-31 (finding 30), the admin `1.0.0+60fe650`: past the actAs check, `firebase deploy --only functions` in the server build printed "Couldn't find firebase-functions package in your source code. Have you run 'npm install'?", "Loading and analyzing source code for codebase default to determine what to deploy", then "Error: An unexpected error has occurred.".
    - Found by: the user's live walk. The fake Cloud Build runs no step, and every real deploy so far ran from a checkout.
    - Cause: before it deploys, `firebase-tools` resolves `firebase-functions` from the functions' source folder and runs its binary, which loads `index.js` to discover the functions (`lib/deploy/functions/prepare.js` `loadCodebases`, `runtimes/node`). `server.tgz` carries `functions/dist` with its `package.json` and deploy lock but no `node_modules`. In a checkout Node finds the packages in the repository's `node_modules` above `functions/dist`, and `functions/build.mjs` checks the bundle loads from there too, so every laptop deploy and every check passed. Reproduced offline: the tool's own `Delegate.discoverBuild` over a copy of `functions/dist` in a folder with no `node_modules` above it fails with "Cannot find module 'firebase-functions'", and finds the 69 endpoints once the packages are in the folder.
    - Fix and pin: the server build's step `packages` (`npm ci --omit=dev --ignore-scripts --no-audit --no-fund` in `server/functions/dist`, before `rules` and `functions`; `INSTALL_STEPS`, `build-spec.ts`, golden `server.json`); the fake Cloud Build stops a server definition without it at `functions` with those lines (S-A55-BAD-NO-FUNCTIONS-PACKAGES; S-A55-HAPPY asserts the step; `functions/test/support/upstream-cloudbuild.test.ts` pins the fake). The rest of the builds audited: the step scripts are one bundle with only Node built-ins external, run from a folder with no `node_modules` by `install-steps-bundle.test.ts`; the `fetch` program uses Node built-ins and `tar`; the rules and Hosting deploys load no code of ours; the pipeline's image builds from its own context (`M6-interfaces.md` §1.4.1, addendum).
    - **A tool run outside the checkout resolves packages only from what was shipped: run each shipped artifact in a folder with no `node_modules` above it (or model the tool's loading in the fake), never trust what the repository's own `node_modules` provides.**

301. **The installer's functions were all refused by the Cloud Functions API: the fakes did not model its own actAs check on the build account.**
    - Seen: live on 2026-10-31 (finding 33, Cloud Build f92cec75), past `firebase-tools`' own checks, the source upload and the Pub/Sub and Eventarc identities: every function create and update answered "HTTP Error: 403, Caller is missing permission 'iam.serviceaccounts.actAs' on service account `projects/-/serviceAccounts/<number>-compute@developer.gserviceaccount.com`. Grant the role 'roles/iam.serviceAccountUser' to the caller on the service account …", then "failed to create function …".
    - Found by: the user's live walk. Lesson 298 listed what `firebase-tools` checks before it deploys; the API the tool then calls has a check of its own, and no fake modelled it.
    - Cause: Cloud Functions gen 2 builds each function with Cloud Build as a build service account; `firebase-tools` names none (`lib/gcp/cloudfunctionsv2.js` sends no `buildConfig.serviceAccount`), so Google uses the Compute Engine default account, and the API requires the caller to hold `iam.serviceAccounts.actAs` on it. `hcm-installer@` held it on the runtime accounts and, since §75a, on the App Engine default account only. Also: the card looked for the permission in the failed step's last 20 lines only, and the 403s come before one summary line per function.
    - Fix and pin: Provision's `iam` item grants the installer `roles/iam.serviceAccountUser` on that account's own policy, gives the account `roles/cloudbuild.builds.builder` on the project, then removes its `roles/editor` (`DECISIONS-for-review.md` §75g; S-A04-HAPPY-COMPUTE-BUILD-ACCOUNT, S-A04-BAD-COMPUTE-EDITOR-REFUSED); the IAM fake models the account and its policy (`iam.noComputeAccount`, `iam.computeActAsMissing`); the fake Cloud Build's server build stops at `functions` with the API's 403 for every registry function and `firebase-tools`' summary, after the App Engine and discovery checks, in the order the deploy meets them; the card reads every line of the stopped step for a permission step c grants (S-A55-BAD-NO-COMPUTE-ACTAS).
    - **A tool's preconditions include those of every API it calls on the user's behalf: for each resource the tool creates, ask which identity Google uses for it (here the build account) and which permission the caller needs on that identity, and make the fake enforce it; look for a refusal in the whole step's log, not in its tail.**

302. **Step (d) waited for a Provision item only the optional imagery pipeline needs.**
    - Seen: live on 2026-10-31 (finding 31): step (c)'s pipeline repository `hcm` (the `artifact-registry` item) not done kept Install the server waiting, though every item the server needs was done.
    - Found by: the user's live walk.
    - Cause: step (d)'s availability, the install cards' looks and the deployment's watch all read step (c)'s state, the worst of its 16 items; and the `iam` item waited for `artifact-registry`, since the role table bound the installer's writer role on the repository.
    - Fix and pin: `serverPrepared` (`packages/admin/src/setup/state.ts`): (c) done, or every item but `PIPELINE_ONLY_ITEMS` (`artifact-registry`) done; the writer role on `hcm` moved into the `artifact-registry` item, which `iam` no longer waits for (S-A55-HAPPY-PIPELINE-ITEM-FAILED, S-A55-BAD-SERVER-ITEM-FAILED). Setup is done only with (c) done, as before.
    - **A step waits for what it needs, not for the step before it as a whole: when an optional part joins a required step, say which of its items each later step needs.**

303. **A tab left open across a redeploy ran the old admin and sent its install build to a bundle that no longer existed.**
    - Seen: live on 2026-10-31 (finding 29): after a Hosting redeploy, an open admin tab's server build stopped at `fetch` with "manifest.json is not the one the admin read".
    - Found by: the user's live walk. Every test loads the page once, so the release it runs is always the one Hosting serves.
    - Cause: a single-page app keeps the hashed chunks it loaded; the admin read its release (`runtime.json`) once, at boot, and its install bundle (`install/<release>/`) once a session, while a redeploy replaces both.
    - Fix and pin: `watchRelease` (`packages/admin/src/app/release-watch.ts`) reads `runtime.json` again when the tab becomes visible, every five minutes while visible and before every install build; a newer release puts up the shell's Reload banner and the installer refuses with `apiError.install.adminOutdated` (`DECISIONS-for-review.md` §75i; S-A61-HAPPY, S-A61-BAD-INSTALL-REFUSED).
    - **A page that acts on files deployed with it checks, before it acts, that they are still the deployed ones: a long-lived tab outlives its release.**

304. **Setup read "To do" (0 of 11) on every step until the server's record answered.**
    - Seen: live on 2026-10-31 (finding 32): several seconds after each reload with every chip To do.
    - Found by: the user's live walk. The e2e waits for the settled page (`SetupPage.visit`), so no test looked at the moment before.
    - Cause: a fresh Setup state starts every step `missing`, the state of a step checked and not done; "not checked yet" had no state of its own.
    - Fix and pin: `firstCheck` per step and the derived `loading` (`packages/admin/src/setup/state.ts`, the controller's `withChecksAnswered`): Checking… on the chip, "Checking every step…" over an indeterminate ring in the header (`DECISIONS-for-review.md` §75j; S-A03-HAPPY-CHECKING-AFTER-RELOAD, S-A03-BAD-CHECKING-STATUS-FAILS; tour `setup.loading`).
    - **"Unknown yet" is a state of its own: never let a default stand for an answer, and give the moment before the first answer a test and a tour state.**

305. **Re-check of step (c) could show it worse than it was, and could not record that it was.**
    - Seen: live on 2026-11-01 (finding 34): Check again on step (c) in a tab whose Google permission had expired turned it To do although the server's record said done; and (`DECISIONS-for-review.md` §75b) a doctor's `missing` was never recorded, so the record turned a regressed item back to Done.
    - Found by: the user's live walk, and the §75b agent reading `provisionRequest`.
    - Cause: the record was built from the card's items, dropping every `missing` one to skip the never-reported ones; and an item Google refused with 401 was shown and recorded as `invalid`, a fact about the token taken for one about the item.
    - Fix and pin: a run records exactly what it reported, `missing` included, never a 401; Re-check without a token changes nothing and says when step (c) was last checked (`DECISIONS-for-review.md` §75k; S-A04-BAD-RECHECK-NO-TOKEN, S-A04-HAPPY-RECHECK-RECORDS-MISSING).
    - **Record what a check observed, in both directions, and only that: track the reports of the run itself instead of filtering the screen's state, and never let a refused credential stand for the resource's state.**

306. **A city with no place category could not hold a place, and its editor said only "The value does not have the required format."**
    - Seen: live on 2026-11-01 (finding 35): Add place in the migrated Bucharest showed an empty Category select and a Save note in the schema's words.
    - Found by: the user's live walk. Every e2e world seeds its categories, so no test ever opened the place editor of a city without any.
    - Cause: neither `cities.create` nor `setup.createCity` made a category, the legacy data has none, and the editor rendered the city's categories as a select whatever their number, with the draft's empty id refused by `idSchema` (`validation.format`).
    - Fix and pin: the starter categories of `@hcm/shared` written with every new city (`functions/src/api/starter-categories.ts`), and the editor's no-categories field with **Add the starter categories** and **Add a category** (`packages/ui/src/admin/pois/poi-fields.ts`, `packages/admin/src/pois/starter.ts`; S-A39-HAPPY-STARTER-CATEGORIES, S-A39-BAD-NO-CATEGORIES, S-A39-HAPPY-ADD-STARTER, tour `pois.no-categories`).
    - **Every choice a form needs has a state for "there is nothing to choose yet", with the way to make the first one; and a test world that seeds everything hides that state: give it a world that seeds nothing.**

307. **A place's line almost disappeared on the satellite map.**
    - Seen: live on 2026-11-01 (finding 36): the public map on Mapbox Standard Satellite.
    - Found by: the user's live walk. The e2e basemap is a light solid colour, on which a 3 px line in a dark category colour reads well.
    - Cause: the POI layers drew lines and area outlines as one thin stroke in the category colour, which the 3:1 rule for the white glyph keeps dark, the tone of most of a satellite photo.
    - Fix and pin: a white casing under every line and outline, wider strokes by zoom, a 35 % fill (`packages/ui/src/map/pois.ts`); pixel probes over a dark ground served in place of the e2e basemap's (S-V24-HAPPY-LINE-CASING, S-V24-BAD-CASING-AT-ZERO-OPACITY).
    - **Probe what is drawn on every kind of ground it is drawn on: a test basemap of one light colour cannot see a contrast problem of a satellite photo.**

308. **A required field said the schema's generic words, and Save named only the first problem.**
    - Seen: live on 2026-11-01 (finding 37): an empty Romanian title read "The value is too small or too short." at the field and above Save.
    - Found by: the user's live walk. The tests asserted that a field was marked invalid and that Save said "Cannot save", never what it said.
    - Cause: the editors turned every issue into `translate(issue.code)`, the words of the viewer's manifest validation, which know the code and not the field.
    - Fix and pin: `packages/ui/src/admin/editing/issue-text.ts` (a required field's own words, the note listing every field), used by the places, photos, layers and settings editors (S-A38-BAD-REQUIRED-FIELD-NAMED, S-A38-HAPPY-REQUIRED-FIELD-FIXED).
    - **A form's message says what to do in that field; assert the words, not only `aria-invalid`.**

309. **History named a created document by its id.**
    - Seen: live on 2026-11-01 (finding 38): "Place W1DLFHuhMZpHW6UzReWl" beside "AreaOne".
    - Found by: the user's live walk. The tour's places were seeded with readable ids ("gara"), so "Place gara" looked like a name.
    - Cause: a row's name came from the entry's `previous`, which a creation does not have.
    - Fix and pin: `CreatedNames` (`packages/admin/src/history/names.ts`): the next entry's version, else the document now, read once (S-A23-HAPPY-CREATED-NAMED, S-A23-BAD-CREATED-GONE-UNNAMED).
    - **Seed the ids the product makes (random ones), or a test cannot tell an id shown by mistake from a name.**

310. **A newer build of the same version was never offered as an update.**
    - Seen: live on 2026-11-01 (finding 39): after the Hosting redeploy of the admin `1.0.0+457201e`, Setup (d) said "Installed: 1.0.0+9e2e6b5" and offered nothing.
    - Found by: the user's live walk. Every e2e release differed in its version (`0.9.0+e2e0000`, `99.0.0+e2e9999` against `1.0.0+e2e0001`), and the records the specs seeded were written for the admin under test, so neither a same-version build nor a record of another admin was ever read.
    - Cause: a release had no order beyond its semver, whose build metadata has no precedence (a different commit counted as "older", which also let an older admin replace a newer build of its version), and the cards showed a recorded state (`installed`, relative to the admin that wrote it) as it was.
    - Fix and pin: the build time beside every release, the order "higher version, else later build time" (`compareRelease` of `@hcm/shared`), and a recorded state read again against this admin (`recordedState`, `packages/admin/src/install/model.ts`; S-A55-HAPPY-UPDATE-SAME-VERSION, S-A55-BAD-DOWNGRADE-SAME-VERSION, S-A55-HAPPY-SAME-BUILD).
    - **A version that is not bumped for every build needs another order that follows the build; and a stored comparison ("installed", "behind") is relative to who compared: store the facts (release, time), derive the comparison where it is shown.**

311. **An install card with nothing to do showed Google's consent box with no button.**
    - Seen: live on 2026-11-01 (finding 40): card (d), installed, no update.
    - Found by: the user's live walk. The consent-note tests covered a card with a button and the live-token case, never a card in daily use with nothing to do.
    - Cause: the note's rule was the step's scope (every install card's is `cloudPlatform`) and a live token, not what the card's body offered.
    - Fix and pin: `installCardAsks` (`packages/ui/src/admin/setup/install-status.ts`), read by the page's `noteParams` (S-A55-BAD-NOTE-NOTHING-TO-DO, tour `setup.install-nothing-to-do`).
    - **An explanation of a dialog belongs to the button that opens it: derive it from the buttons shown, not from the screen's general permission.**

312. **An untouched new place asked "Discard your changes?" when left.**
    - Seen: live on 2026-11-01 (finding 42): Places → Add place, nothing typed or drawn, then another page.
    - Found by: the user's live walk. The unsaved-guard specs edited a stored place; the one spec that left a new place
      (`e2e/admin/specs/pois/in-view.spec.ts`) clicked Discard in the question, so the question was taken for intended.
    - Cause: `PoiDraft.unsaved` was true for any new place, and the category the page filled in once the categories were
      listed went through `edit`, like the admin's own change.
    - Fix and pin: a new place is unsaved once it differs from its start; a default filled in later is `prefill`, which
      moves the start too (`packages/admin/src/pois/draft.ts`; S-A38-HAPPY-NEW-UNTOUCHED, S-A38-BAD-NEW-TYPED-ASKS).
    - **"Unsaved" is a difference from what the admin saw first, not a state ("new"); a value the program fills in is part
      of that start, not an edit.**

313. **The pipeline card offered a button whose click could only be refused.**
    - Seen: live on 2026-11-01 (finding 43): step d3, Install the pipeline, with a bundle that names no Docker builder.
    - Found by: the user's live walk. The specs that met `apiError.install.notAvailable` looked at Google first (the
      blocker of a look); none opened Setup on a record of the pipeline, which keeps the state and not the blocker.
    - Cause: whether the bundle can install the pipeline was known only from a look with a token, while a recorded
      "looked at, not installed" was enough for the card to offer its button.
    - Fix and pin: the cards read the bundle once without a token (`InstallerPort.localBlocker('pipeline')`) and keep the
      answer apart from any record (`pipelineOff` of the install slice); the card then shows the reason and no button
      (S-A56-BAD-NOT-AVAILABLE; tour `setup.pipeline-not-available`).
    - **A capability fixed by the build (what the bundle can install) is read from the build, not from the last state a
      card recorded.**

314. **A one-instance Pub/Sub function made a Crashes group out of every burst.**
    - Seen: live from 2026-10-26 to 2026-10-29 (finding 45): `ops-onbudget`, Cloud Run 429 "no available instance".
    - Found by: the Crashes page in production. The functions' tests checked the instance caps against a maximum, never a
      minimum for a function that receives bursts.
    - Cause: `maxInstances: 1` on a push-delivered function: deliveries that came while the instance was starting were
      refused; Pub/Sub delivered them again, so nothing was lost, but each refusal was an error.
    - Fix and pin: three instances of 80 concurrent requests, no minimum (`BUDGET_SCALING`, `functions/src/ops/budget.ts`;
      S-A43-HAPPY-BUDGET-BURST), the transaction keeping a repeat idempotent (S-A43-BAD-BUDGET-BURST-ONCE).
    - **A cap of one instance on an event-delivered function turns every burst into errors; leave room for a burst and make
      the handler idempotent instead.**

315. **"This browser could not be registered for notifications" said nothing of which step failed.**
    - Seen: live on 2026-11-01 (finding 46): Notifications on this device after Chrome's prompt.
    - Found by: the user's live walk. The specs' stand-in of the FCM SDK always succeeded, and the server's refusal had no
      code beyond `apiError.notify.deviceInvalid`.
    - Cause: the registrar swallowed every error into one message, and the server dropped FCM's code.
    - Fix and pin: a reason line with the SDK's or FCM's code, the code and the redacted text in the log
      (`packages/admin/src/inbox/push-failure.ts`; S-A47-BAD-SDK-CODE, S-A47-BAD-FCM-REFUSED-REASON,
      S-A47-BAD-FCM-REASON-NAMED).
    - **A failure that crosses an SDK keeps the SDK's own code to the screen and the log: it is what tells the next live
      try what to look at.**

316. **The FCM SDK handed out a registration made with another worker.**
    - Seen: live on 2026-11-01 (finding 46): a second click made no request to FCM at all.
    - Found by: reading `@firebase/messaging` 0.13.3 offline after the live walk.
    - Cause: `register()` trusts its IndexedDB record (the installation id and when it was registered) for seven days,
      without the worker or the push subscription it was made with; the admin's move to `/admin/` retired the root's
      worker and its subscription, and a registration FCM forgot is never made again within the week.
    - Fix and pin: the record is forgotten after the root's worker is retired and when FCM refuses the registration, and
      the browser registers once more (S-A47-HAPPY-RENEWED). Since §81d (finding 50) the browser registers a token with
      `getToken`, whose record keeps the subscription it was made for, so the admin's own module that cleared the record was
      removed; `reset` deletes the refused token instead.
    - **An SDK's cache keyed on less than what its result depends on goes stale silently: clear it whenever the part it
      does not key on changes.**
317. **Leaving the originals out of the release would not have shrunk a publish's transfer.**
    - Seen: §73k's first reading, "Hosting releases leave out `/admin/legacy/`", while applying the user's decision of
      2026-11-01.
    - Found by: tracing what a publish downloads: the site build's `fetch` takes `hosting.tgz` (50.7 MB, 45 MB of it the
      originals) from the admin's own Hosting, and that download is the transfer the card counts; deleting the folder
      after the download would have saved nothing of it.
    - Fix and pin: the originals travel in their own `legacy.tgz` (the manifest's optional `files.legacy`), which a site
      build fetches and unpacks only while step (h)'s import is not complete (`build-spec.test.ts`,
      `cloud-build-installer.test.ts`, `fetch-script.test.ts`, `install-bundle.test.ts`; S-A57-HAPPY-PUBLISH-WITHOUT-ORIGINALS,
      S-A57-BAD-ORIGINALS-UNTIL-IMPORTED); `hosting.tgz`'s budget went from 80,000 to 12,000 KB.
    - **A cost is cut where it is measured: find the request that moves the bytes before deciding what to leave out.**
318. **A module-level cache in the functions outlives a test file.**
    - Seen: the drafts' model choice (§67g, `functions/src/api/vertex-models.ts`) is kept in the module for ten minutes;
      a test that falls back to the second model leaves it kept for the next test, which then asks the second model first.
    - Found by: writing S-A45-HAPPY-FALLBACK-MODEL: the `functions` project shares one module graph per worker
      (`isolate: false`, `vitest.config.ts`), so the next file of the worker would have met the same choice.
    - Fix and pin: `forgetModelChoice()` before and after each test of the files that make a choice
      (`self-test.test.ts`, `translate.test.ts`); the e2e tier never makes a fallback choice (only the all-404 scenario,
      which forgets it), so the emulators' functions keep the first model.
    - **State a module keeps between calls is shared by every test of a worker that does not isolate: each test that
      changes it puts it back.**
319. **A build step's refusal said "HTTP 429" and nothing else.**
    - Seen: live on 2026-11-01 (finding 47): the pipeline build's `jobs` step stopped at Run Admin v2's 429; quota or
      request rate could not be told apart, so the cause stayed unknown.
    - Found by: the user's live install. The step tests checked that a refusal stops the step, never what it prints.
    - Cause: `GoogleCallError` kept the method, address and status only; Google's error body (`error.status`, `ErrorInfo`
      with `quota_metric` and `quota_limit`, `QuotaFailure`) was never read.
    - Fix and pin: the body's essentials, redacted, on the error line; a request rate waited out with backoff and jitter, a
      quota named and not tried again (`scripts/site/src/install/steps/google-error.ts`, `run-jobs.ts`;
      `install-run-jobs-refusals.test.ts`, S-A56-HAPPY-JOBS-RATE-LIMITED, S-A56-BAD-JOBS-QUOTA).
    - **A failure that runs where nobody can attach a debugger prints the server's own reason, redacted: the status code
      alone is not a diagnosis.**
320. **A request the browser never sent was reported as Google's outage.**
    - Seen: live on 2026-11-01 (finding 48): a Pi-hole answered `::` for `analyticsadmin.googleapis.com`; step (g) said
      "The service is unavailable right now".
    - Found by: the user's console (a failed CORS preflight) and the Pi-hole log.
    - Cause: the admin's Google transport mapped a `fetch` that threw (no HTTP answer at all) to the same failure as a 503.
    - Fix and pin: a failure without an answer keeps the host, and the message names it and the blockers that cause it
      (`adminShell.network.blocked`; `packages/admin/src/google/transport.ts`, `failure.ts`; S-A22-BAD-REPORTS-BLOCKED-HOST).
    - **"No answer" and "an answer that says unavailable" are different failures with different fixes: keep them apart up
      to the message.**
321. **A card kept the failure of an attempt the next one had already replaced.**
    - Seen: live on 2026-11-01 (finding 49): step (g)'s red "unavailable" stayed under "14 created".
    - Found by: the user's live walk. The specs checked each failure and each success, never a success after a failure.
    - Cause: a step's `error` was set by a failure and cleared only by a check that answered; an action that succeeded
      wrote its own result beside it.
    - Fix and pin: an input starts a new attempt and clears its card's failure (`withCount`,
      `packages/admin/src/setup/state.ts`; S-A22-HAPPY-REPORTS-UNBLOCKED, S-A22-BAD-REPORTS-NEW-FAILURE-ONLY).
    - **A failure belongs to its attempt: clear it where the next attempt starts, not where some later success happens to
      write.**
322. **A dry run right after a registration refused a registration that had just been made.**
    - Seen: live on 2026-11-01 (finding 50): FCM's `validate_only` send answered `UNREGISTERED` for the installation id the
      browser had just registered, twice, so push never turned on.
    - Found by: the user's live walk after §79e (the reason line named `fcm/UNREGISTERED`).
    - Cause: UNVERIFIED (the FCM SDK's FID record was gone after the retry); the server treated the dry run as the verdict.
    - Fix and pin: an `UNREGISTERED` dry run of a fresh registration is recorded with a warning and the first real send
      decides; each device records its kind (`token` or `fid`) and is addressed as it says, and the browser registers an FCM
      registration token (`getToken`) (`functions/src/notify/devices.ts`, `functions/src/adapters/fcm.ts`,
      `packages/admin/src/firebase/messaging.ts`; S-A47-HAPPY-DRY-RUN-UNREGISTERED, S-A47-HAPPY-TOKEN, S-A47-HAPPY-LEGACY-FID).
    - **A pre-check that can be wrong in the window right after the thing it checks was made must not block it: record it
      and let the real use decide.**
323. **Footprints that each cover the whole city hid the map under their stacked fills, then under their crossing lines.**
    - Seen: live on 2026-11-01 (finding 51): the imagery map was a flat blue field; after a first fix to outlines, dozens of
      crossing edges (Corona and KH-9 footprints are long strips over the whole region).
    - Found by: the user's live look at Find after the first real harvest, then at the outline fix zoomed out.
    - Cause: every listed result drew its footprint; fills compose (n frames cover 1 − 0.79ⁿ), and outlines of strips
      cross everywhere.
    - Fix and pin: the city's boundary and the open scene's footprint alone, at the city's view
      (`packages/admin/src/imagery/imagery-map.ts`; pixel probes in `e2e/admin/specs/imagery/rows.spec.ts`,
      S-A11-BAD-FOOTPRINTS-STACKED, S-A11-HAPPY-FOOTPRINT-SELECTED).
    - **Draw on a map what the person picked, not every candidate: a list is the place for many results, the map for one.**
324. **A list showed only the images some other step happened to have made.**
    - Seen: live on 2026-11-01 (finding 52): one browse thumbnail among dozens of results.
    - Found by: the user's live look; the cause read from the code.
    - Cause: the rows only loaded copies the harvest's prefetch (20 best-ranked, at the end of a long callable) or an opened
      scene had made; a missing copy and a failed one looked the same.
    - Fix and pin: the rows ask for their own copies, a few at a time, and a failed one says so
      (`packages/admin/src/imagery/browse.ts`; S-A11-HAPPY-ROW-PREVIEWS, S-A11-BAD-ROW-PREVIEW-UNAVAILABLE).
    - **A view that depends on a cache must fill it itself (bounded), and say "unavailable" apart from "not yet".**
325. **Rows built from a few fields read identical when the data has twins.**
    - Seen: live on 2026-11-01 (finding 53): three "KH-4A Corona · Jun 18, 1964" rows (a pass's forward and aft frames).
    - Found by: the user's live look.
    - Cause: the row's title was the camera and the day only; a fake catalogue with one frame a day never showed it.
    - Fix and pin: the id, camera and frame on every row (`packages/ui/src/admin/imagery/scene-list.ts`;
      S-A11-HAPPY-TWINS-TOLD-APART, S-A11-BAD-TWINS-ALONE).
    - **Give every list row its unique key in short form, and give the fakes twins: real catalogues have them.**
326. **A tab's count meant "needs you" while the tab listed everything.**
    - Seen: live on 2026-11-01 (finding 54): "Work (0)" while an import ran in Work.
    - Found by: the user's live import.
    - Cause: the count was of versions waiting for the admin and expired orders; the label promised what Work lists.
    - Fix and pin: the count is the rows Work lists, live (`packages/ui/src/admin/imagery/hcm-imagery-page.ts`;
      S-A12-HAPPY-WORK-COUNT, S-A12-BAD-WORK-COUNT-ENDED).
    - **A count next to a tab counts that tab's rows; a "needs you" count belongs on its own label.**
327. **A long transfer reported progress per 64 MiB written and nothing a person could read.**
    - Seen: live on 2026-11-01 (finding 55): a KH-9 download looked stuck for minutes.
    - Found by: the user's live import.
    - Cause: the fetch moved the step's share only per chunk written and the heartbeat wrote it once a minute; no bytes
      were recorded.
    - Fix and pin: `ctx.report_bytes` (`pipeline/src/hcm_pipeline/jobs.py`) writes the bytes received of the total every
      5 s, shown on the step line (S-A12-HAPPY-DOWNLOAD-BYTES, S-A12-BAD-DOWNLOAD-SIZE-UNKNOWN; `pipeline/tests/unit/test_steps_fetch.py`).
    - **Any step that can take minutes shows a number that moves: bytes, items or seconds, throttled, never a still bar.**
328. **A network-bound phase ran on the largest machine.**
    - Seen: live on 2026-11-01 (finding 56): 8 vCPU / 32 GiB at ~3 % CPU for 30+ minutes while USGS sent 2–3 MB/s.
    - Found by: the user's Cloud Run metrics.
    - Cause: one job definition per run, sized for the heaviest step (KH-9 panoramic warps), ran the download too.
    - Fix and pin: the download phase on `raster-fetch` (1 vCPU / 4 GiB), then the processing dispatched to `std`/`xl`
      (`functions/src/imagery/dispatch.ts`, `pipeline/src/hcm_pipeline/runner.py`; S-A12-HAPPY-DISPATCH-PHASES,
      S-A12-BAD-PHASE-OUT-OF-MEMORY, S-P01-HAPPY-PHASES, S-P01-BAD-PHASE-ESCALATED).
    - **Size a job per phase: I/O-bound work on the smallest machine, the memory-bound steps on the large one.**
329. **A step joined a frame of tens of gigapixels in memory.**
    - Seen: live on 2026-11-01 (finding 57): `stitch` of a KH-9 panoramic frame killed (signal 9) at 32 GiB.
    - Found by: the user's first real KH-9 import and its Cloud Run log.
    - Cause: every segment read whole, the joined frame and its border crop as arrays, the segments staged in the scratch
      folder, which Cloud Run keeps in memory; the synthetic scenes were megapixels, so no test saw it.
    - Fix and pin: segments read by windows and shrunk copies, two staged at a time, the frame described (`frame.json`) and
      previewed, never joined; `locate` reads the city's window from the covering segments
      (`pipeline/src/hcm_pipeline/frames.py`; S-P01-HAPPY-BOUNDED-MEMORY with a tracemalloc bound, S-P01-BAD-CROP-ACROSS-SEGMENTS).
    - **A raster step reads windows: never an array of the whole input, and a test bounds the memory of a frame larger than it.**
330. **A run killed by the system stayed "Running" for its lease's ten minutes.**
    - Seen: live on 2026-11-01 (finding 58): "Joining the scan's parts · Running" minutes after signal 9.
    - Found by: the user's look at the version page beside the Cloud Run log.
    - Cause: the tick asked Cloud Run only once the lease lapsed; a kill writes nothing, so nothing said the run was gone.
    - Fix and pin: a heartbeat three beats late asks Cloud Run at the next tick; out of memory offers Try again
      (`functions/src/imagery/tick-jobs.ts`; S-A12-HAPPY-DEAD-EXECUTION-NOTICED, S-A12-BAD-HEARTBEAT-LATE-RUNNING,
      S-A12-HAPPY-OUT-OF-MEMORY-RETRY).
    - **A missing heartbeat is the signal: check the worker's real state at the first missed beats, not at the lease's end.**
331. **A bundle measured with a bare `vite build` read 0.7 KB under the budget gate's figure.**
    - Seen: 2026-11-02, while making room for findings 51–58 in the admin's 620 KB total.
    - Found by: the `build` stage's bundle gate, after an ad-hoc measurement said there was room.
    - Cause: the gate sums every script of `packages/admin/dist`, and the admin site build adds the push worker
      `firebase-messaging-sw.js` (0.7 KB gzip), which `vite build` alone does not write.
    - Fix and pin: measure with the `build` stage (or add the worker) before counting the room (`DECISIONS-for-review.md` §82g).
    - **Measure a budget the way its gate does: the same files, the same build, the same sum.**
332. **The pipeline wrote a layer version its own contract refused, and the admin could only say "could not be read".**
    - Seen: live on 2026-11-02 (finding 62): the KH-9 version page read "invalid-document" and Work showed 0.
    - Found by: the user's live import.
    - Cause: `MAX_SCAN_PIXELS` was declared in the pipeline's contract and never checked, so a 300 000-pixel crop was
      recorded; the golden documents were written by hand, so nothing compared what the writers produce with the
      schemas; the admin logged nothing about which field failed.
    - Fix and pin: `within_limits` in `steps/locate.py`; `test_written_documents.py` records every document the real
      runner writes along ten paths and holds it to `contracts/written-documents.json`, which the shared test parses;
      the admin's store logs the failing fields (S-P01-HAPPY-WRITTEN-CONTRACT; `packages/admin/test/firebase/content.test.ts`).
    - **A cross-language contract checks what the real writers produce, not hand-written examples; a declared limit is
      enforced where the value is made.**
333. **A failure's numeric parameter would have made the job and its version unreadable, and a test asserted it.**
    - Seen: 2026-11-02, while tracing finding 62 (not live yet).
    - Found by: reading every `StepFailedError` call against `apiErrorParamsSchema` (texts only).
    - Cause: `{bytes}`, `{count}` and `{min}` were passed as numbers and written as they came; the runner's test pinned
      `{"min": 6}`.
    - Fix and pin: `StepFailedError` writes every parameter as text (S-P01-BAD-WRITTEN-PARAMS; `test_runner.py`, the
      size-mismatch path of `test_written_documents.py`).
    - **Convert at the boundary: a writer turns values into the schema's types itself, whatever its callers pass.**
334. **A corner guess no better than chance was cropped.**
    - Seen: live on 2026-11-02 (finding 63): "rotation 270 degrees, correlation 0.03" on a KH-9 strip, then 0 of 128
      tiles matched.
    - Found by: the user's live import's log.
    - Cause: the best of eight assignments was kept with no floor; a quarter turn of a strip stretches the pixels by its
      aspect squared, and a guess a few hundred metres off correlates about 0.01 at 60 m, so the best was noise.
    - Fix and pin: square-pixel assignments only, a floor of 0.2, a search around the window widened by half, then
      `apiError.imagery.cityNotFound` (S-P01-HAPPY-KH9-STRIP, S-P01-BAD-CITY-NOT-FOUND; `pipeline/tests/unit/test_corners.py`).
    - **A best-of-N choice needs a floor and a plausibility filter; "the best" of candidates that all fail is a failure.**
335. **A callable answered a document's timestamps in a shape its own schema refused.**
    - Seen: 2026-11-02, M7's `worker.step` `get` (not live: found while building the local worker).
    - Found by: the worker's documents going through the shared schemas on the pipeline's side.
    - Cause: a document read with the Admin SDK holds `Timestamp` instances, and a callable's answer is encoded field by
      field, so a `Timestamp` reaches the caller as `{_seconds, _nanoseconds}`, not the `{seconds, nanoseconds}` every
      reader of the wire expects.
    - Fix and pin: `toWire` (`functions/src/worker/fields.ts`) turns every timestamp, at any depth, into plain
      `{seconds, nanoseconds}` before the answer and before a merge is validated
      (`functions/test/worker/step.test.ts`: `happyPath_theJobIsReadWithPlainTimestampsAndItsUpdateTime`).
    - **A callable's answer is JSON: convert SDK objects into the wire's shape yourself, never rely on how the SDK encodes a class.**
336. **A fallback would have queued a Cloud Tasks task under a name its first path had already used.**
    - Seen: 2026-11-02, M7's Uploads API path (not live).
    - Found by: writing the fallback's tests (`functions/test/imagery/publish-uploads.test.ts`).
    - Cause: the publish's tasks are named `<city>-<job>-<reason>` so a redelivery never queues twice; the Uploads path's
      polls used `poll-<n>`, and an MTS publish started after a fallback while polling began again at the same `n`.
    - Fix and pin: a fallback during the polls starts MTS at the next poll number; one before any poll keeps the task's
      (`afterUploads` in `functions/src/imagery/publish.ts`; `badPath_anUploadThatEndsInAnErrorFallsBackToMtsOnce`).
    - **Deterministic task names are ids for the queue's whole life: a second path that reuses the first one's names is refused.**
337. **The admin's bundle carried the schemas of five callables it never calls.**
    - Seen: 2026-11-02, M7's build: the admin in all 627.8 KB of its 620 KB budget.
    - Found by: the `bundle-budget` gate, then a search of `admin-core` for the worker's strings (`download-options`,
      `ifUpdateTime`).
    - Cause: the admin validates every answer with the one registry table, `CALLABLES`, so every row's request and response
      schemas were in its entry, the local worker's included; zod's builders are calls the bundler keeps.
    - Fix and pin: `ADMIN_CALLABLES` (every callable but the worker's) and `CALLABLE_NAMES` (the names the deployment
      check waits for), with the worker's rows and schemas in `packages/shared/src/api/worker-calls.ts` and the whole table
      in `callables.ts`, which the admin never imports: 0.6 KB less (627.8 → 627.2 KB) (`packages/shared/test/api/registry.test.ts`). The
      deployment count of the admin's test went from 69 to 75 with it (`packages/admin/test/google/clients.test.ts`).
    - **What a bundle imports for one part of a table it carries whole: split a shared registry by its consumers.**
338. **A persona's ID token was refused where the page's own token is accepted.**
    - Seen: 2026-11-02, the first run of `e2e/admin/specs/imagery/worker-run.spec.ts`: `worker.hello` answered
      `apiError.notAdmin`.
    - Found by: S-A62-HAPPY-WORKER-RUN.
    - Cause: the admin fixtures sign the personas in before the world gives them their claims; the admin page refreshes
      its token, a process handed the first token does not.
    - Fix and pin: the spec signs the owner in again (`EmulatorWorld.signIn`) just before it hands the tokens to the
      worker's page.
    - **A token carries the claims of the moment it was minted: hand a process one minted after the claims it needs.**
339. **A logging test that expected exactly one line saw another thread's.**
    - Seen: 2026-11-02, `pipeline/tests/unit/test_log.py` failing now and then in a whole pipeline run.
    - Found by: the M7 runs of the pipeline suite.
    - Cause: the tests read every line of the configured handler, and a daemon thread an earlier test left running (a
      worker's local page, a fake server) could log through it meanwhile.
    - Fix and pin: the tests read only their own logger's lines (`read_entries(stream, logger)`).
    - **A test that counts shared output filters it to what the test wrote.**
340. **A notification kind added to the shared list was refused by the rules, and with it every save of the defaults.**
    - Seen: 2026-11-02, the split `all` of M7 (`d7fe0c9`): S-A47-HAPPY failed at every admin project; saving the push
      settings answered 403 on `documents:commit` and `pushKinds` kept `job.failed`.
    - Found by: S-A47-HAPPY (`e2e/admin/specs/notify/push.spec.ts`), the console guard's 403.
    - Cause: M7 added `job.needsOk` to `NOTIFICATION_KINDS` (pushed by default), but `validPushKinds` in
      `firebase/firestore.rules` spells the kinds out (rules cannot import `@hcm/shared`) and allowed at most 10; the
      admin's settings always carry the defaults, so every save held a kind the rules did not know.
    - Fix and pin: the rules list gains `job.needsOk` and allows 11; `firebase/rules-tests/test/notify.test.ts` saves every
      kind of `NOTIFICATION_KINDS` alone, all of them, `DEFAULT_PUSH_KINDS` and the defaults without `job.failed` (a kind
      added to the shared list without the rules fails it), and keeps `job.needsOk` beside an unknown kind refused.
    - **A list the rules repeat from a shared constant is pinned by a rules test that writes every value of the constant.**
341. **A browse copy of the test before landed on the next test's scene.**
    - Seen: 2026-11-02, the split `all` of M7: S-A11-BAD-BROWSE-UNAVAILABLE at `admin-m768-ro` once; after Try again the
      scene's page showed the image (no 503 followed the click) instead of "unavailable".
    - Found by: the trace: the retry made no call, so the scene's document said `copied` and the copy existed.
    - Cause: the admin tests share one city (`PROJECT_CITY`) and the `usgs-browse/` copies (kept by every reset), and
      the Functions emulator finishes a callable whose page closed. The test before ("Filters narrow the results", under
      a second) left its harvest's browse prefetch and its rows' `imagery.browse` calls (finding 52's rows ask for every
      missing copy) running; one of them fetched before this test failed the browse host and recorded `copied` on this
      test's freshly harvested scene after its own copy had failed. A cross-test leak, not a product race.
    - Fix and pin: the admin fixtures' `page` ends a test only once its page's `imagery.search` and `imagery.browse` calls
      have answered (`e2e/admin/support/server-calls.ts`, `SceneWriters`; at most 120 s), so their writes land in the
      test that made them.
    - **A server call outlives the page that made it: a test over shared server state ends once its calls have answered.**
342. **The local worker's first stop signal after a job was lost.**
    - Seen: 2026-11-02, S-A62-HAPPY-WORKER-RUN: the first SIGTERM or Ctrl-C after a run did not stop the worker within
      30 s in three of five runs, a second one did at once (`DECISIONS-for-review.md` §83j); in the split `all` the spec
      read the job `running` while its version already awaited approval, and its stop came in the same moment.
    - Found by: `pipeline/tests/integration/test_worker_stop.py`, which holds a worker process at a chosen moment and
      sends one signal: on the old code it timed out at every attempt right after the run's last checkpoint, and while
      the job was claimed (the whole job then ran).
    - Cause: the runner replaces the loop's handler for the whole run (`sigterm_raises`), and its handler only raised
      the run's flag; after the last checkpoint (`_finish`'s write, its log line, both network calls) nothing read the
      flag again, the run ended `DONE` and the loop went on claiming with its own handler back. A signal while the claim
      was under way set the loop's flag, which the run never read. Both handlers also took a lock (`RunFlags._lock`,
      `Event.set`), which a handler running between two bytecodes of the main thread could find held by that thread.
    - Fix and pin: the runner's handler calls `RunFlags.interrupt` (one assignment, no lock) and the Python handler it
      replaced (never Python's own Ctrl-C handler); the loop's handler sets a flag only and its waits look at it every
      0.25 s; the run asks the loop at every checkpoint (`RunSettings.asked_to_stop`), so a stop asked before the first
      step requeues the job with no step started (`_requeue` without a step). `test_worker_stop.py` (five times at the
      run's tail, once each during the claim, a step and the idle wait, SIGTERM and SIGINT) expects exit 0 within 10 s;
      S-A62-HAPPY-WORKER-RUN expects one Ctrl-C to end the worker with `exit 0`, and polls the job's status, which the
      run writes after the version's.
    - **A signal handler takes no lock and loses nothing: it sets a flag, tells the handler it replaced, and every wait
      looks at the flag.**
343. **Publish the map, opened while the claim still loaded, turned into the Mapbox card under the owner's click.**
    - Seen: 2026-11-02, split `all` on 61fd1e8, `admin-l1440-dark-journey`, `journey.spec.ts` "Publishing the map hours
      after Prepare the project…" (S-A30-BAD-TOKEN-EXPIRED): the spec opened Publish the map, read its text, and its
      Publish button was never there; the failure's screenshot showed the Mapbox card open and still "To do", though the
      spec had recorded Mapbox done after the claim had answered.
    - Found by: the tour matrix on the loaded NUC only; the four other journey projects passed, because there the switch to
      normal mode had finished before the spec opened the card.
    - Cause: after the claim, `setMode('normal')` reads the server's record, then runs the legacy import's detection (it
      reads every photo), then opened the step to resume at unconditionally. A card the admin opened during that load was
      replaced by the first step not done in the record it had read before (Mapbox). `start` had kept such a card since
      finding 32; the mode switch had not.
    - Fix and pin: the controller counts the cards opened (`intents.open`, from a click or the address) and the switch
      opens the step to resume at only when none was opened while it loaded (`packages/admin/src/setup/controller.ts`,
      `badPath_aCardOpenedWhileTheSwitchLoadsStaysOpen`).
    - **Every load that ends by choosing what shows must yield to what the person chose while it ran, on each path that
      loads, not only the first.**
344. **A 48 px touch target at the viewport's foot read as 46 px.**
    - Seen: 2026-11-02, split `all` on 61fd1e8, `tour-c412-light-en` and `tour-c412-dark-en`,
      `admin.photos.editor-invalid` scrolled to 638 px: the English draft button's ring ended 0.25 px past the viewport,
      and the target-size rule reported a 133x46 target under M3's 48 x 48. The button and its ring were intact.
    - Found by: the scroll sweep at the one position (of the English editor's height after #37's field texts) that put a
      ring's last tested point in the viewport's last half pixel; Romanian and the other sizes never stopped there.
    - Cause: `pointReaches` counted a point as on screen by its fractional coordinates (914.75 < 915), and the hit test
      rounds the point to the pixel (915, off screen), where it hits nothing; the side's reach then stopped 2 px short.
    - Fix and pin: `pointReaches` decides on screen and scrolled away at the rounded pixel the hit test uses
      (`e2e/support/layout-probe.ts`; `happyPath_aRingInTheViewportsLastHalfPixelCountsAsOffScreen_badPath_theRowAboveIsHitTested`
      in `e2e/test/layout-probe.test.ts`, which read 48x46 on the old code).
    - **A probe that hit-tests a fractional point must judge that point where the hit test does: at its rounded pixel.**

345. **An update installed a release whose Provision items had changed, and nothing applied them.**
    - Seen: 2026-11-02, live, after Update the map installed M7: the pipeline's image would not pull without a login
      (the repository's public read was new in M7) and `usgs-raw/` kept its 30 days; the owner fixed both from step c by
      hand (finding 65).
    - Found by: the owner, starting the local worker.
    - Cause: Provision ran only from step c, and `setup/status` recorded each item `ok` under the definition of the
      release that ran it; no record said which definitions a newer admin had changed.
    - Fix and pin: the item set is versioned (`PROVISION_SET_VERSION`, `PROVISION_CHANGED_IN`), the version a run reached
      is recorded, and Update the map runs the items changed since (`DECISIONS-for-review.md` §85a;
      S-A04-HAPPY-UPDATE-PROVISION, S-A04-BAD-UPDATE-PROVISION).
    - **A release that changes what a Provision item creates bumps the item set's version and marks the item; an "ok" of
      an older release is not an "ok" of this one.**
346. **A Docker bind mount needed a `chmod 777` on the host.**
    - Seen: 2026-11-02, live: the worker's container (user 10001) could not write `~/hcm-worker` until the owner ran
      `mkdir -m 777` (finding 66).
    - Cause: a bind mount keeps the host folder's owner; the image's user is not the host's.
    - Fix and pin: a named volume (`-v hcm-worker:/work`), which Docker initialises from the image's `/work`, created
      owned by 10001 in `pipeline/Dockerfile` (§85b; S-A62-HAPPY-PANEL).
    - **A container that writes a work folder gets a named volume initialised from a folder the image owns, never a host
      folder the user must prepare.**
347. **The worker's Google sign-in never finished on `localhost`, and the page said nothing.**
    - Seen: 2026-11-02, live, Chrome: the popup completed, the page stayed "Not signed in" with no error (finding 69).
    - Cause: **UNVERIFIED**; the Firebase SDK's calls from `localhost` carry the browser key Provision restricts to the
      Hosting origins (the page also sent no Referer), or the auth iframe's storage is partitioned off a non-Firebase
      origin; the popup's promise never settled, and nothing bounded it.
    - Fix and pin: pairing makes the page's sign-in unnecessary; the fallback gives up after 90 s with a message
      (§85f; S-P04-BAD-POPUP-TIMEOUT); the worker's own calls to Google's token services name the Hosting origin as
      `Referer` (§85c).
    - **A promise that waits on another window or another origin gets a timeout and a message; a page served from
      `localhost` cannot use a browser key restricted to the project's origins.**
348. **The worker's page went blank when the SDK could not load.**
    - Seen: 2026-11-02, while writing the timeout's e2e test: the page's module awaited both SDK imports at its top, so a
      blocked `www.gstatic.com` stopped it before it showed the worker's state.
    - Fix and pin: the imports are one `Promise.all` whose failure leaves the SDK unset; the state is shown regardless
      (§85f).
    - **A page whose main job is to show a state loads its optional third-party code after, and apart from, that state.**
349. **A pairing code must not outlive its use, nor say which way it failed.**
    - Seen: 2026-11-02, designing `worker.pair` (finding 67), the one callable without a sign-in.
    - Decision and pin: 130 random bits, 10 minutes, one use in a transaction, stored only as a hash prefix, one answer
      (`apiError.worker.pairCode`) for unknown, used, expired and revoked, attempts limited per city before the code is
      read (§85c; S-A62-BAD-PAIR-REUSED, S-A62-BAD-PAIR-EXPIRED).
    - **A credential exchanged without a sign-in is single-use, short-lived, hashed at rest, rate-limited and refused
      with one answer.**
350. **A record the update sent to the server it was replacing was refused, so the update was offered again forever.**
    - Seen: 2026-11-02 live (finding 71): Update the map installed the server and pipeline of `b8b4a26` and ran Provision's
      two changed items, yet the server card kept offering the update "also brings these project settings up to date". The
      items had run (they were `ok`); their `setup.recordCloud` naming `setVersion` went to the server being replaced,
      whose strict request schema did not know the field and refused the whole record.
    - Found by: the owner's live update; every tier ran the admin against a server of its own release.
    - Fix and pin: an update that installs the server records Provision's result once that build has settled
      (`recordAfter`, §86d; S-A55-HAPPY-UPDATE-WITH-PROVISION, `packages/admin/test/setup/{install,provision}.test.ts`).
    - **A client that upgrades its server writes the server's new fields only after the new server is in place.**
351. **A view nobody had looked at yet replaced the one the card showed.**
    - Seen: 2026-11-02 live (finding 59): the server card said "Not installed" for a moment after Update the map. The click
      set its flow busy, and the flow's first view, never looked at ("Not installed"), replaced the recorded target until
      the look answered.
    - Found by: the owner's eye; the specs looked after the look had answered.
    - Fix and pin: a view without `checkedAt` keeps the shown target and takes only `busy`, `error` and `blocker` (§86e;
      S-A55-BAD-UPDATE-DURING-BUILD, `packages/admin/test/setup/install.test.ts`).
    - **A placeholder state never overwrites a known one: merge the intent (busy) into what is shown.**
352. **A library's unused feature can be most of its weight: zod's JSON Schema conversion was 18 KB of the admin.**
    - Seen: 2026-11-02, finding 72 needed 2 KB and the admin had 0.8 KB left of 630. zod 4's classic schemas import the JSON
      Schema processors for `toJSONSchema()`, Standard Schema's `jsonSchema` and derived getters, reachable from every
      schema's constructor, so no tree shaking removes them, though the admin calls none.
    - Found by: the bundle budget, then a one-off count of the source map's bytes per module (§86h).
    - Fix and pin: the admin's build resolves those two imports of zod's classic schemas to a stand-in that throws
      (`packages/admin/src/vendor/zod-json-schema-unsupported.ts`, unit-tested to name every function zod imports): 5.7 KB
      gzip less; the e2e admin is built with it.
    - **Before raising a budget, weigh the bundle by module: a dependency's eagerly reachable but unused code is a
      stand-in away.**
353. **A job failed by something other than its run kept a step "Running" and printed its code as its message.**
    - Seen: 2026-11-02 live (findings 60, 61): a run killed for its memory on the largest machine; `imagery.tick` failed the
      job with `message` = the code, and the step it died in stayed `running`.
    - Found by: the owner, on the version page.
    - Fix and pin: the page reads a failed job's `running` step as failed and drops a message that is only a code (§86f;
      S-A12-BAD-LOST-RUN-STEP).
    - **A screen derives what an interrupted writer could not finish writing.**
354. **The installed pipeline image was read from the last line of a log that lags the build, once, and cached.**
    - Seen: 2026-11-03 live (finding 74): after Update the map to `1.0.0+bf74d17`, the build pushed the new image and its
      `jobs` step put the new digest on the Cloud Run jobs, but `worker.image` answered the previous release's digest
      beside the new release name. The starter's supervisor pulled the old image, whose worker refused `--supervised
      --image` ("unrecognized arguments") and was started again in a loop.
    - Root cause: the admin took the digest only from the build log's `image` event, the `jobs` step's last line, and read
      the log once when it first saw the build end (the summary of an ended build is cached). Cloud Logging lags a build's
      status by seconds, so that read had no `image` event; the view kept the earlier record's digest, and the state change
      to installed was recorded with the new release (from the jobs' label) beside the old digest. Later looks recorded
      nothing (the state did not change).
    - Found by: the owner's computer, which ran the old image; every tier read a log that was complete when the build ended.
    - Fix and pin: the digest is what the job `raster-pipeline` runs, read with its release label: by the admin on every
      look (`InstalledInfo.image`, recorded again when it changes) and by `worker.image`, `worker.hello`, `worker.claim`
      and `worker.pairCode` on the server (Run Admin `jobs.get`, kept a minute; the record only when the job cannot be
      read), and a release is never paired with another digest (§87a–§87b; S-A62-HAPPY-STARTER-IMAGE-UPDATE,
      S-A62-BAD-STARTER-IMAGE-STALE, `packages/admin/test/install/install-flow.test.ts`). The supervisor backs off when an
      image refuses its arguments (§87c; S-A62-BAD-STARTER-OLD-IMAGE).
    - **Read what is installed from the thing installed, not from a log of how it got there; a log is late and partial.**
355. **A file the page made and "clicked" after an `await` never reached the owner's Downloads.**
    - Seen: 2026-11-03 live (finding 73): **Use this computer** saved nothing in Chrome on Linux: no `hcm-worker.sh`, no
      `.crdownload`. The page fetched the template, filled it, and saved it through a Blob URL and a synthetic click after
      the `await`. Cause **UNVERIFIED** (Chrome's download bubble was not inspected): a `.sh` is a type Chrome lets through
      only for a download the user started from a known site, and a Blob behind a click after an `await` is neither.
    - Found by: the owner; Playwright's downloads accept any file a page saves.
    - Fix and pin: the file is an ordinary download the owner's click starts, a link to the server's `worker.starter` that
      answers with `Content-Disposition: attachment`; the panel then says the browser may ask to keep it, where it is and,
      on Linux, the exact line to run it with Copy (§87d–§87e; S-A62-HAPPY-STARTER, S-A62-BAD-STARTER-TEMPLATE).
    - **A download a person must keep comes from a URL their click opens, answered by a server as an attachment, and the
      page says what the browser may ask next.**
356. **A stand-in run of a test that ended wrote a partial job into the next test's world.**
    - Seen: 2026-11-03, the admin tier's imagery specs: `[e2e-imagery-runner] the e2e runner failed` with a job whose
      `type` and `status` were missing, after every S-A13-HAPPY; the tests passed.
    - Cause: the next test's reset deleted the job while the stand-in (`e2e/admin/support/imagery-run.ts`) still played
      its steps; its next write was a Firestore `PATCH` with a field mask and no precondition, which creates a missing
      document, so the next test's world gained a job of a few fields, and the run's next read failed the job's schema.
    - Found by: reading the web server's log of a targeted run (a passing run's error lines are findings too).
    - Fix and pin: the stand-in writes a job or a version only with `currentDocument.exists=true` and treats a job that is
      gone (`DocumentGone`) as the end of its run, cancelled, logged at info; a log line is still created.
    - **A write from a process a test started must not create what the next test's reset deleted: write with an exists
      precondition, and end the process when its subject is gone.**
357. **A seeded running job with an old last write was taken for a dead run by another test's tick.**
    - Seen: 2026-11-03, the split `all` on the NUC: the Jobs tour (`e2e/tour/admin-jobs.tour.ts`) at x3840 and l1440
      found no **Stopping…** after Cancel, and the job's page said "the layer version does not exist (e2e stand-in)".
    - Cause: finding 58 made `imagery.tick` ask Cloud Run about a running job whose last write is a few heartbeats old,
      whatever its lease (`heartbeatLate`); `seedJob` gave the seeded running job the lease of lesson 217 far ahead but its
      `updatedAt` on the test's own day, so a tick any other test ran over every city found it late, found no execution,
      queued it again, and the stand-in failed it for its missing version.
    - Found by: the slow machine of the split run, where ticks of other specs overlapped the tour; it passed here.
    - Fix and pin: `seedJob` writes a running job's `updatedAt` at its lease's end too (`e2e/admin/support/ops.ts`).
    - **A new rule that reads a field of every document in a shared world must be checked against every seed of that
      field: a seed made safe for the old rule is not safe for the new one.**
358. **A segment of a snow-covered KH-9 frame was joined 46 % inside its neighbour.**
    - Seen: 2026-11-03 live (finding 76): `locate` correlated 0.09 on the 1972 frame; `frame.json` put segment `d` 17,246
      px inside `c` (other overlaps 1,400 to 3,100 px).
    - Cause: the coarse match searched the whole left segment for an 8 px wide strip of the right one (the frame shrunk 48
      times), and a snowy frame's repeating valleys matched better far from the edge.
    - Found by: reading the placements of `frame.json` and rendering `frame-preview.tif` on the owner's computer; the
      synthetic frames were blurred noise, which matches in one place only.
    - Fix and pin: the search is bounded to the overlap USGS can leave (the left segment's last 35 %), with a test whose
      exact copy of the strip sits deeper than that (S-P01-BAD-STITCH-DECOY).
    - **A search that may find a wrong place must be bounded by what the physics allows, and a synthetic image must
      repeat itself the way real ones do.**
359. **A retry after an update kept the results of the pipeline it was meant to replace.**
    - Seen: 2026-11-03 live (finding 78): with the stitch fixed and installed, **Run it again** re-ran `locate` on the frame
      the old pipeline had joined; `imagery.retry` reopened only the failed step.
    - Cause: resuming from the first unfinished step assumes a finished step's result is still what the code would produce;
      an in-app update breaks that between a failure and its retry.
    - Found by: reading the job's steps after the click, before spending another run; no test retried across a release.
    - Fix and pin: a pipeline retry keeps only what is costly or gone and runs every later step again; automatic resumes
      (a lost run, the small job's hand-over) still continue where they stopped (S-A12-HAPPY-RETRY-REDOES,
      S-A12-BAD-RETRY-KEEPS-CROP).
    - **A checkpoint is only valid for the code that wrote it: when the owner asks for another try, redo what is cheap.**
360. **A limit that dropped data in silence hid the real bug behind three plausible ones.**
    - Seen: 2026-11-05 (findings 83, 84): `cityNotFound` on a KH-9 frame survived two stitch fixes. The delivery held 14 segments;
      `extract` kept 8 (`MAX_SEGMENTS`, sized for Corona's 4), so the frame ended at the edge of the city.
    - Cause: a guard written as "stop reading here" instead of "refuse this archive"; nothing compared the segments kept
      with the members offered, and the frame's length was never compared with its corners.
    - Found by: listing the archive after the picture ended mid-terrain with no film border; every earlier look read the
      pipeline's own output, which was consistent with itself.
    - Fix and pin: past the limit the job fails (S-P01-BAD-TOO-MANY-SEGMENTS), and the limit fits what USGS delivers
      (S-P01-HAPPY-ALL-SEGMENTS). A synthetic scene of 2 or 4 segments could never have shown it.
    - **A safety limit must fail loudly, never truncate; and when a result is wrong, look at the input before tuning the step.**
361. **A homography through a panoramic frame's corners cannot hold the frame, and a threshold cannot find its true place.**
    - Seen: 2026-11-06, rehearsing `locate` offline on the real 1972 KH-9 frame before spending a live run: the corner homography
      had the scale wrong 1.5 to 2 times at the city (6.65 km RMS at 17 hand-read landmarks); the frame's true place scored 0.126
      against the least correlation of 0.2, and the search walked 27.5 km away from a start at the truth.
    - Cause: on a panoramic camera the film position follows the scan angle and the ground its tangent, so four corners do not
      give one projective map; the search correlated the blank area around the frame; the preview picked single pixels of film grain.
    - Found by: 17 landmarks read by hand against Sentinel-2, then asking each step of the guess what it does at the known truth
      instead of tuning thresholds on the failure's own numbers; every synthetic scene was a homography, so none could show it.
    - Fix and pin: a panoramic forward model with the camera's half angle, a local homography fitted from it, a masked correlation
      of gradients whose peak's ratio and z accept a guess, an averaged preview (S-P01-HAPPY-PANORAMIC-LOCATE,
      S-P01-HAPPY-AVERAGED-PREVIEW); a guess nothing confirms goes on to the admin's points instead of failing the job
      (S-P01-BAD-WEAK-GUESS-TO-POINTS, S-P01-BAD-CITY-OFF-FRAME). The rule's constants are calibrated on one frame.
    - **Rehearse on the real input with its known answer before a live run: a model of the sensor beats a threshold on its symptom.**
362. **Try again could never heal a document repaired after it failed its schema.**
    - Seen: 2026-11-06, the first run of S-A11-HAPPY-ROUTED-SCENE-RETRY: a scene repaired on the server stayed "invalid-document" through every Try again.
    - Cause: a listener's first answer can be the browser's cached copy; a schema failure ends the listener, so the broken cached copy failed the read before the server could answer, each time.
    - Found by: a test that was first written off as timing, then given retries, which still failed: the retries proved it was no race.
    - Fix and pin: a cached copy that fails its schema waits for the server's answer; only the server's copy fails the read (`packages/admin/src/firebase/content.ts`, `content.test.ts`).
    - **A failure that ends a listener must come from the source of truth, never from its cache.**
363. **A link added inside a list row was a 19 px target on a phone.**
    - Seen: 2026-11-06, the first phone run of S-A66-BAD-PAID-FRAME: "1 more would need ordering" on a date's row, 312 x 19 px at 360 wide; the frame page's link to its join was built the same way.
    - Cause: the join card's links were bare `<a>`s; only the kit's `a.external` gives a link the 48 px height of a compact window. The card's unit tests read the `href`, never a size.
    - Found by: the tour's `expectStateSound` on `imagery.date-rows`, scrolled through the list: at a laptop's width the check passed.
    - Fix and pin: both links use `a.external` (`packages/ui/src/admin/imagery/join/join-card.ts`); the states `imagery.date-rows` and `imagery.join-holds` check them at the phone width.
    - **A new link in a card is checked at the compact width by a state of the tour, not by its unit test.**
364. **"Add a frame" took the old join for the frame.**
    - Seen: 2026-11-06, a functions test of "add a frame" on a published layer: with a published frame the join becomes that layer's newest version, so "not ended, or published, newest" answered the join itself.
    - Cause: the contract's rule for finding a scene's part asked only for the newest live version of the layer; a join on the same layer is such a version, though it is no frame.
    - Found by: `functions/test/imagery/join.test.ts` (S-A65-HAPPY-ADD-FRAME).
    - Fix and pin: `isUsablePart` (`functions/src/imagery/join-parts.ts`) leaves out a join not published yet; `docs/research/M8-join-interfaces.md` §15.
    - **When a new kind of version shares a layer with the old ones, every "newest version of this layer" reads it too: check each such query.**
365. **A search narrower than the failure it must report turned "too far" into "unmeasured".**
    - Seen: 2026-11-06, the pipeline's S-P05-BAD-TOO-FAR: the design searched seams within 400 m and failed them above 300 m; a pair 500 m apart found no peak at all.
    - Cause: tiles outside the search fail like tiles on flat land, so the seam read `measured:false` and would have rendered double streets, instead of `joinSeamTooFar` with the way to fix it.
    - Found by: the row's pair, built with a known offset.
    - Fix and pin: `COARSE_SEARCH_M` 600 (`pipeline/src/hcm_pipeline/join/measure.py`), and a peak on the search's edge is refused; `docs/research/M8-join-interfaces.md` §13.
    - **A measurement's range must exceed the largest case it has to name; out of range is not the same answer as no signal.**
366. **Nodes built on GDAL's forward polynomial moved a whole frame, and the figure read at the nodes never saw it.**
    - Seen: 2026-11-06, the M8 review's probe: a pixel-coded panoramic frame warped through its own points and through its nodes differed by a median of 36 to 70 m past the taper at 25 to 40 degrees off nadir, with `maxShiftM` reading 1 m; thin-plate parts lost GCP-scale detail too (S-P05-HAPPY-OFF-NADIR).
    - Cause: a warp runs from the output to the scan, on a reverse polynomial GDAL fits apart from the forward one; the nodes paired a pixel with its forward image, and `largest_move_m` compared them with that same forward image. A spline through a grid also cannot hold the detail of a spline through its points.
    - Found by: a real `gdal.Warp` of a raster whose values are its own coordinates; every P05 frame was an exact affine scan, where forward and reverse agree.
    - Fix and pin: a node is a place and the pixel the reverse transform reads there; a thin-plate part keeps its own points as nodes; the sparse grid went from 5 km to 2 km; the largest move compares what the two warps read, between the nodes too (`join/correction.py`, `join/warping.py`, `tests/integration/test_join_warp_parity.py`).
    - **Test a transform through the operation that uses it, on the geometry it is for: an affine fixture hides every difference between a fit and its inverse.**
367. **A version's id does not say where its scan lies.**
    - Seen: 2026-11-06, the M8 review: a frame whose points were fixed could not join on a worker (`apiError.worker.refused`), and 30 days after its base ended the sweep took the scan of a frame still awaiting approval or published.
    - Cause: a re-georeference copies `scan` from its base and never the file, while the allow-list derived the path from the version's id and the sweep looked only at the ended version's own state.
    - Found by: reading `fieldsOf` against `inputsOf` and `sweepEnded`; every test seeded a scan in its own folder.
    - Fix and pin: `worker.urls` reads the input versions' `scan.path`; the sweep keeps a folder whose scan another version still reads; a layer's deletion also takes a joined frame's scan folder (S-A65-HAPPY-NEW-POINTS-SCAN).
    - **What a document names and what its id implies can differ: read the field, and when deleting, ask who else names the path.**
368. **A failed join "frees its frames", and four doors stayed open on that freedom.**
    - Seen: 2026-11-06, the M8 review: Retry revived a join over frames a newer join had taken or a publish had moved; a worker could claim the retried join before the dispatcher looked; Cancel ended a frame under a running join; a frame of a join that ended auto-published alone.
    - Cause: "holds" was asked only of a live join, and only by approve, reject, regeoref, crop and delete. A retry brings a join back without asking its frames; a frame imported for a join has no estimate when the join ends, so the policy met it fresh.
    - Found by: walking each path that changes a frame or a join against the invariant "no half a city", not against the list of refusals.
    - Fix and pin: `partsReady` also asks `partOf`, the retry goes through it and restores the `parts` wait; `cancelJob` withdraws the request on a held frame; a frame any join named never auto-approves, nor do its new points; the transaction refuses a frame the policy moved meanwhile (S-A65-BAD-RETRY-STALE, S-A65-BAD-CANCEL-HELD, S-A65-BAD-ENDED-NOT-AUTO).
    - **State an invariant over the whole state machine and walk every transition; a list of guarded callables only ever covers the ones someone thought of.**
369. **A box was read as an outline, and an e2e row hid the offer it was named after.**
    - Seen: 2026-11-06, the M8 review: `output.bounds` holds nodata, so a tilted frame read 97 % against a true 51 %, and the date could lose its row and the frame its offer; S-A65-HAPPY-ADD-FRAME passed on a plan row the spec wrote itself, which the server would never write.
    - Cause: the plan took the rendered box for the frame; the spec's frames were axis-aligned, where a box is an outline; the stand-in's plan had no way to offer a frame beyond the estimate.
    - Found by: running the real `planDate` on the spec's geometry and on F039's corners.
    - Fix and pin: a rendered frame covers its outline inside its box; rows name their `spareFrames`, which the short join offers, and the spec reads the server's own row; the 30-row cap keeps dates with work (`packages/shared/src/imagery/join.ts`).
    - **A spec that edits the server's output to reach a state is testing its edit: reach the state from what the server really writes.**

370. **A figure the pipeline measured was over 100, and every reader would have refused the document.**
    - Seen: 2026-11-06, the M9 server+admin workstream: three written documents held `coveragePct: 100.04` (`output` and `join`), past the shared schemas' 100, on a job whose frame held the whole city. `worker.step` validates every write, so a local run would have failed at `export`.
    - Cause: M9 divided a share of whole pixels by the city's fractional span in `coverage_pct` (`pipeline/src/hcm_pipeline/steps/merge.py`), and the schemas that bound it had not landed when the goldens were regenerated, so nothing held the figure to its range.
    - Found by: `packages/shared/test/schemas/pipeline-contract.test.ts`, the first time the written goldens met the new schema.
    - Fix and pin: the figure stops at 100 (`test_bad_path_whole_pixels_over_a_fractional_span_stop_at_the_whole_city`).
    - **A value's range belongs to its schema: land the schema with the writer, or the goldens prove only that the writer agrees with itself.**

371. **A frame that would not align was the camera model's fault, not the imagery's.**
    - Seen: 2026-11-06, the 1982 frame D3C1217-200510A001 refused every search: 3 of 196 tiles agreed under the full panoramic sweep.
    - Cause: its film is half as long as a full frame's: KH-9 swept 60 degrees, not 120, and off the nadir; the model assumed a full, centred sweep.
    - Found by: looking at the film's aspect and the widths of its ends on the ground, before touching a gate.
    - Fix and pin: `SensorSpec.full_aspect`, `PanoramicCamera.sweep_deg`; 922 of 1,192 tiles now agree, on this one frame only (`docs/research/M9-calibration.md` §14; `pipeline/tests/unit/test_panoramic.py`).
    - **When a search refuses a real frame, look at the frame before changing a gate.**

372. **A cross-validation of RANSAC's own inliers flattered the error by half.**
    - Seen: 2026-11-06, the M9 probes: 11 to 12 m from a 5-fold over the inliers, where tiles held out before RANSAC gave a median of 10 to 17 m and an RMSE of 15 to 33 m. Live F007 had passed the policy on leave-one-out over its own pairs.
    - Cause: the inliers are already those a 25 m threshold kept, and pairs checked against each other share the fit they are meant to test.
    - Found by: setting cells aside before the RANSAC (`docs/research/M9-calibration.md` §0).
    - Fix and pin: `calibrate/pairs.py` holds out every fifth cell before fitting, `checkpointKind` says what a figure measures, and only `held-out` approves on its own (S-A17-BAD-LEAVE-ONE-OUT). Most frames will now wait for one click, and the threshold stays.
    - **A figure that decides anything must be held out before the step that could flatter it.**

373. **Better maps made the best join wait for a click.**
    - Seen: 2026-11-07, `S-P05-HAPPY-ADMIN` on M9's maps: two frames met at 0.34 m, the correction could not improve that, so it was refused as "did not help", and the policy reads a refused seam as not closed.
    - Cause: `applied: false` meant both "the correction made it worse" and "there was nothing to correct".
    - Found by: the real pipeline's e2e row, not the stand-in's, which scripts its seams.
    - Fix and pin: a refused correction on a seam at or under `SEAM_ALREADY_CLOSED_M` (2 m) reads as closed (S-P05-HAPPY-ALREADY-CLOSED); at 12 m it stays refused.
    - **A flag that a policy reads must not stand for two different things.**

374. **A map 800 m wrong passed every gate, and so did a city a third of which lay 357 m off.**
    - Seen: 2026-11-07, review of M9, reproduced on synthetic worlds: a lattice of fields with the map three periods off (841 of 958 tiles, 14.3 m cross-validated, checkpoint 14.5 m, auto-publish); a film with its east 30 % displaced (933 of 933 tiles, 2.2 m). No real frame has shown either.
    - Cause: `measure` narrows its search round by round, and a tile that wants to go further has no peak and leaves `tried`. Every gate then counts the survivors, so the tiles that know better are never heard.
    - Found by: asking what a gate cannot see, not whether it passed: the wrong proposals rehearsed before were all kilometres off.
    - Fix and pin: `calibrate/rival.py` adds the score maps of tiles searching ±1,500 m around the final map; real frames stand at 3.6 to 4.3 sigmas of noise, those two at over 37 (`test_calibrate_rival.py`, S-P06-BAD-REPEATING-PATTERN, S-P06-BAD-DISPLACED-PART).
    - **A gate over survivors says nothing of what did not survive: look once more with the search open.**

375. **A figure that left out the checks that disagreed, and a word that did not mean what the policy read.**
    - Seen: 2026-11-07, review of M9: a frame the proof refused could publish itself through the matcher (`checkpointKind: 'held-out'`, on pairs its own RANSAC had filtered); ten hand points with three disabled after reading their residuals did too; a check over 100 m left the figure and no reader counted it.
    - Cause: `held-out` was derived from `enabled: false` alone, whoever disabled the pair and whatever filtered it first.
    - Found by: tracing each path that reaches `applyApprovalPolicy` rather than the one the rule was written for.
    - Fix and pin: the policy asks for `method: 'auto'`, a proof on record, no check dropped and tiles that span the frame (S-A17-BAD-NOT-PROVED, -HAND-POINTS, -CHECKS-DROPPED, -UNMEASURED-AREA). `S-P01-HAPPY-ADMIN` now takes one click.
    - **What a figure means depends on the path that made it: a policy reads the path too.**

376. **A budget and a bar set on one sensor could not both hold on another.**
    - Seen: 2026-11-07, review of M9: `VOTE_TILE_BUDGET // warps` gave a KH-4 or KH-7 frame 60 tiles a warp, while `VOTE_MIN_AGREE` stayed 8: on real KH-9 frames given that budget, not one warp in twelve reached it.
    - Cause: the bar was measured at 180 tiles a warp on KH-9 alone, one scale; merging only combines proposals that already passed it.
    - Found by: running the real frames at the budget the other sensors get, instead of reading the rates.
    - Fix and pin: `VOTE_WARP_MIN_TILES` (S-P06-BAD-MANY-WARPS). The same review found the same shape elsewhere: `REACH_MARGIN` scaled with the window where the error is in ground metres, and `_frame_pixel_m` assumed an east-west strip.
    - **A count that divides and a bar that does not are one constant in two places: change the sensor, and test them together.**

377. **"Any place on Earth" had never left Bucharest's longitude, or its overlap of orbits.**
    - Seen: 2026-11-07, review of M9: a frame over longitude 180 spanned the whole world in Mercator and failed `cityNotFound`; at low latitude a window across two orbit tracks had no single date, or got a reference with a 27 % hole because a tile's box held it and its footprint did not; a frame fitted with 6 or 7 pairs wrote `crossValidatedM: Infinity`, which no reader accepts.
    - Cause: everything was rehearsed on one city; none of these can happen there often enough to be seen.
    - Found by: the real functions on a frame at Suva, and a sweep of the live catalog at latitudes 5, 8, 14 and 44.4.
    - Fix and pin: S-P01-HAPPY-ANTIMERIDIAN, S-P01-BAD-FOOTPRINT-HOLE, S-P01-HAPPY-TWO-DATES, S-P06-BAD-FEW-PAIRS-FIGURE. Real frames far from Bucharest are still owed (M9 §14).
    - **A claim about the whole Earth needs a test at its edges, not a bigger table at one place.**

378. **A label that fell through, and a rectangle that was a parallelogram.**
    - Seen: 2026-11-07, the first real frames of other cameras: DS09065A089MC039 was read as a 2.75 m KH-4A where it is a 140 m KH-5 Argon; the 1966 KH-7 strip got no vote at any scale, though a proof started by hand held it at 519 of 678 tiles.
    - Cause: `sensorOf` has a fallback for a camera field it cannot read, and nothing said so; the corner homography took the metadata's rectangle for the film, 10 degrees off in shear, where a 64-cell tile cannot follow, and the range marked UNVERIFIED was the wrong dimension, not only the wrong number.
    - Found by: looking at the previews and reading the frame by eye before tuning anything, then the proof from a hand start, then the true affine under the votes: each step said which layer was at fault.
    - Fix and pin: the id names the camera (S-A11-HAPPY-CAMERA-FROM-ID), `SearchRange.shears_deg` (S-P06-HAPPY-SHEARED-STRIP, S-P06-BAD-SHEAR-FALSE), a frame no proof holds is refused (S-P06-BAD-COARSE-FILM). M9 §14.
    - **Before widening a search, find out on a real frame which dimension it is missing.**

379. **Code that runs under another Python, formatted for this one.**
    - Seen: 2026-11-07, the first run of the local matcher's sidecar on its real image: `SyntaxError: multiple exception types must be parenthesized`, on a line whose tests were green.
    - Cause: the repository's ruff target is Python 3.14, where `except A, B:` is legal and ruff writes it so; the sidecar's image runs 3.12. mypy, ruff, the tests and coverage all ran under 3.14. An unquoted annotation naming its own class would have failed the same way.
    - Found by: running the real container once, with a real request, though no gate needs it (`docs/research/M10-local-ai.md` *What ran on real hardware*). That run also gave the only real figures on VRAM and idle memory.
    - Fix and pin: the two exception types are a named tuple; `Self`; `test_matcher_box.py` parses each sidecar file with `feature_version=(3, 12)` and checks annotations in definition order (S-P07-HAPPY-GPU).
    - **What runs under another interpreter gets a test of that interpreter's grammar, and one real run: fakes do not parse your source for you.**
380. **A second scale for the votes took the matcher's only start away from it.**
    - Seen: 2026-11-07, the first run of the whole local AI on a real frame (F006, the Fetești window): the sidecar on the graphics card, four requests, 190 s, no proposal, `how: none`, where gate R1 had proved it.
    - Cause: `_ranked_starts` took "the sensor's scale nearest 1". When KH-9-pan's scales became `(1.0, 0.94)` for the short films, that scale moved from R1's 0.94 to 1.0, and a full sweep's film at 1.0 is 4 to 9 % too large: the same search finds nothing there. Every test ran with a fake matcher, and the real-hardware check of the sidecar replayed R1's prepared requests, so neither saw the start.
    - Found by: rehearsing the starter's loop, `warp_start` and `find_frame` end to end on real film (`docs/research/M10-local-ai.md` *The whole chain on a real frame*).
    - Fix and pin: the request starts each orientation at each of the sensor's scales, the model's own first; the processor keeps two orientations, at each scale (`test_matcher_chain.py`, `test_local_matcher.py`, S-P07-HAPPY-GPU, S-P07-HAPPY-CPU-FALLBACK).
    - **A measured result holds for the inputs it measured: when a setting changes under it, run the measurement again through the path that builds those inputs, not a replay of the old ones.**
381. **A pull at every start, for an image already on the computer.**
    - Seen: 2026-11-07, the same rehearsal: the starter said "first use: about 10 GB to fetch" with the image present, and it says so again at every start of its loop. Reading why: `ai_pull` runs `docker pull` at each start, so a computer offline, or Docker Hub refusing, would have stood the sidecar aside (`why: pull`) with a working image in Docker's store.
    - Found by: reading the real starter's log. The failing case itself, offline with the image present, did not run for real.
    - Fix and pin: `docker image inspect` first; an image already here is used as it is, with no pull and no disk check (`functions/test/worker/starter.test.ts`, S-P07-HAPPY-GPU; the `.bat` the same, text only).
    - **A step meant for the first use asks whether it is the first use.**
382. **A line copied from the shell starter stopped every Windows worker.**
    - Seen: 2026-11-07, review of the local AI's starter files: `$word = "printf '{\"state\"...` in `hcm-worker.bat`. A backslash escapes nothing in PowerShell, so the string ended at the first quote, and `[scriptblock]::Create` refused the whole file: no install, no supervisor, no removal. Under it, `probe gpu ""`: Windows PowerShell 5.1 drops an empty argument to a native command, so the probe exited 78 and every working card read as no card.
    - Cause: the line and the call were carried over from `hcm-worker.sh`, where both are right. The test counted brackets: the quality image has no PowerShell, and M10 had written down "text assertions only".
    - Found by: a review running the real parser (`pwsh`, `Parser::ParseFile`) on the part after `#PS-BEGIN`, and `$PSNativeCommandArgumentPassing = 'Legacy'` for what 5.1 does to arguments.
    - Fix and pin: the quotes in octal, a word for the empty reason; `functions/test/worker/starter-windows.test.ts`, a reader of the file's strings, and no empty or quoted argument to `docker` (S-P07-HAPPY-WINDOWS-STARTER, S-P07-BAD-WINDOWS-STARTER).
    - **A file a gate cannot run still gets a gate that reads its grammar: "text assertions only" means the worst bug in it is a typo nobody will see. And a shell's quoting does not cross to another shell by copying a line.**
383. **A supervisor that waited on what it supervised.**
    - Seen: 2026-11-07, the same review: `ai_run` ran the sidecar in the foreground of the loop meant to watch `/state`. A healthy sidecar never ends, so a new `pins.json` image went unseen until a reboot while the new code ran under the old Python, a processor sidecar was never probed again, a hung one was never removed, and each frame then waited its 30 minutes. A run that ended left `wanted` true, so a sidecar that exited was started again for nobody.
    - Found by: reading the blocking call; a stand-in of `docker` with a sidecar that holds confirmed that `/state` was not polled until it ended. Every test had a sidecar that ended at once.
    - Fix and pin: the sidecar beside the loop and only while wanted, `wanted` false however a run ends, `Patience` across runs, SIGTERM handled by the sidecar's PID 1 (S-P07-HAPPY-SIDECAR-WHILE-WANTED, S-P07-BAD-SIDECAR-HUNG).
    - **Whatever is meant to notice a change must not be blocked on the thing that changes. And a fake that ends at once cannot show that a real one never does.**
384. **"Never a failed job", held by two `except` lines.**
    - Seen: 2026-11-07, the same review. `propose` caught its own two errors only: a full disk, a volume that refuses, `cv2.error`, an answer of `{"device": []}` (unhashable in `value in frozenset`) or a number of 400 digits (`OverflowError`) failed the whole job. One lost request also threw away the proposals already answered, and a child's own word, `tampered`, was overwritten by its exit code and read as "a bad answer".
    - Found by: injecting those inputs into the real code; `chain`, `gdal_step` and `locate` had no catch either, so `runner.py` ended the job with `INTERNAL`. The tests covered every failure anybody had named.
    - Fix and pin: anything but the run's own stop stands aside, with its class in the log; lost requests cost themselves; validation asks a value's type before it asks a set (S-P07-BAD-LOCAL-FAULT, S-P07-BAD-LOST-REQUEST, S-P07-BAD-NO-ANSWER, S-P07-BAD-TAMPERED-FILE).
    - **A promise of the form "every failure ends here" lives at one boundary that lets through only what must pass, not in a list of failures somebody thought of.**
385. **A proof over more ground than the city spoke for all of the city.**
    - Seen: 2026-11-07, the same review: a proposal proved over a 30 km box records `measuredPct` from the spread over that box, so tiles agreeing in one corner of a small town read as 85, past the 70 that lets a version publish itself. Then `how: matcher` kept the proof's "Measured error 18.8 m" on the card for a fit whose own error was 60 m.
    - Cause: widening the proving ground (M10) moved what the figure's denominator meant, and the figure kept its name. No gate moved, so every gate's test stayed green.
    - Found by: following `measuredPct` from `proof._spread` to `approval.ts`; a simulated corner of a town confirmed it (S-P07-BAD-WIDE-SPREAD, S-P07-BAD-MATCHER-FIGURES). A real frame in that state was not observed.
    - Fix and pin: the window's own figure for a wide proof; figures of another map no longer recorded for this fit, so the card has none to show.
    - **When a measurement's ground changes, follow every reader of its result: a figure is true only of what it was measured over.**
386. **Two switches in a row, each with the other's touch target.**
    - Seen: 2026-11-07, the Map labels group's first draft on a 360 px window: "Numele străzilor" kept only 52 x 40 of its 48 px touch target, because the next switch's reached over it. The overlay list never met this: a slider stands between its switches.
    - Cause: a row of 40 px under a target of 48 px; the switch's `::after` is wider than its button by design, so neighbours must leave room for it.
    - Found by: the tour's target-size check while scrolling through the sheet (`expectStateSound`, `viewer.layers-full`), which a unit test and the functional spec both passed.
    - Fix and pin: 48 px rows in `hcm-layer-panel`; the tour's `layers-map-labels` state.
    - **A control's touch target is a claim on the space around it: stack two and the row height is the target's, not the control's.**
387. **A 64 px thumbnail that cost 288 MB of pixels a row.**
    - Seen: 2026-11-07, live: the Imagery list froze the tab and Chrome's screenshots timed out. USGS's browse copies reach 37,440 x 1,920 px, and each row was an `<img>` of the file.
    - Cause: the CSS size says how large an image is shown, not how large it is decoded; the e2e fixture is 120 x 90 px, and it never tested that.
    - Found by: the owner's live use.
    - Fix and pin: `createImageBitmap`'s resize, one at a time, a small JPEG (`packages/admin/src/imagery/pictures.ts`); `pictures.test.ts` pins what the decoder is asked for, `@S-A11-HAPPY-HUGE-THUMBNAIL` a 20,000 px strip in Chromium.
    - **A fixture sized for convenience hides every cost that grows with size: test an image as large as the real source.**
388. **A wait with no way back but to pay again.**
    - Seen: 2026-11-07: a frame parked at `needs_gcps` under an older pipeline could not use the newer one. Retry takes failed jobs only, so the owner had to cancel and import again, which spent a daily import and a download.
    - Cause: Retry was designed for failures. A pipeline update changes what a waiting state means, and nothing reopened one.
    - Found by: the owner's live use.
    - Fix and pin: `imagery.locateAgain` (S-A69-*).
    - **Every state that waits for a person needs a way to run again without starting over: the pipeline may have learned what it was waiting to be told.**
389. **A removal test's real `pkill` shot the supervisor of the test file beside it.**
    - Seen: 2026-11-07: one `tests` stage failed `S-A62-BAD-STARTER-OLD-IMAGE` after 219 ms with the supervisor's log cut short by its last round; the file alone, and both files together, passed every time on an idle machine.
    - Cause: `happyPath_theRemovalTakesEveryImageItNotedAndNoOther` ran the uninstall file with stand-ins for `docker` only, so its `pkill -f "hcm-worker.sh run"` was the image's real one, and it matches any process of the container by command line: the supervisor `starter.test.ts` was running at that moment in another Vitest worker.
    - Found by: the failure's 219 ms ruled out the 20 s timeout; a loop of that `pkill` beside `starter.test.ts` gave the same cut-short log. The natural overlap itself was seen once only, in the loaded stage, and did not come back in 25 runs of the two files together.
    - Fix and pin: a `pkill` stand-in that logs in that test, which now also asserts the call (`functions/test/worker/starter-sidecar.test.ts`).
    - **A stand-in for every command that reaches outside the test's folder: `pkill -f` is global, and test files run side by side.**
390. **"No alert" asserted while the picture was still on its way.**
    - Seen: 2026-11-07: `S-A11-HAPPY-ROUTED-SCENE-RETRY` failed 4 runs of 16 on a console 503 from `imagery-browse` at the test's end, and passed the others.
    - Cause: the test opened the paid twin, whose browse image USGS never serves. After Try again the page asks for its copy, so the 503 and its alert always come, and the test's last line, no alert, held only if it ran first.
    - Found by: a targeted run, then `--repeat-each 8`.
    - Fix and pin: a frame whose browse image is served, the same one as `S-A11-HAPPY-BROWSE-RETRY-ROUTED`; the picture must be visible before the alert is counted (`e2e/admin/specs/imagery/search.spec.ts`).
    - **An absence proves nothing until the thing that could still bring it has settled: wait for the outcome first, then assert what is not there.**
391. **Six ways a review of one day's work found the same two shapes of bug.**
    - Seen: 2026-11-07, code review of the labels, Locate again and huge-preview work. The labels: a link's choice equal to the assumed default read as "no choice" on a style with its own default, so the viewer dropped a link it had written itself. Locate again: its last attempt left a frame whose saved points then failed the job for good; it searched an older pipeline's `frame.json`; moved to the other place it downloaded up to 8.7 GB under a log saying "no new download". The preview: the map's full-size decode ran beside the one-at-a-time queue, once per feed write; a failed one looked like success, and a stale opening blocked the next.
    - Cause: an equality used as a flag (shown equal to the default means nobody chose), and a claim about where things are kept in a sentence, not in a record (the queue "one at a time" held for two of three callers; "keeps both there" held for jobs that never moved).
    - Found by: review, each reproduced by a scratch test before the fix.
    - Fix and pin: `MapLabelsState.pinned` with a fixture style that really defaults a label off (S-V31-*-STYLE-DEFAULT); `saveGcps` leaves the points a run (S-A16-HAPPY-POINTS-AFTER-ATTEMPTS); `JobDoc.filesOn` (S-A69-BAD-FILES-ELSEWHERE); `PicturePort.decode` takes its turn and `#browsing` asks once (S-A11-HAPPY-HUGE-THUMBNAIL, S-A11-BAD-PREVIEW-UNAVAILABLE).
    - **A value equal to its default says nothing about who chose it, and "kept there" is true only of what recorded it: store the choice and the place, do not infer them.**

392. **A test read a title out of an accessible name by guessing how it was spaced.**
    - Seen: 2026-11-07, `@S-V14-HAPPY` in `e2e/specs/viewer/keyboard.spec.ts` failed on a clean tree: the photo opened, but the test looked for a heading named "title date".
    - Cause: the row button's accessible name joins the title and the date with one space, and the test split it on two spaces or a line break, so it found no boundary.
    - Found by: a targeted run while the map labels were built, then reproduced on a clean export.
    - Fix and pin: the test reads the focused row's own `.title` and asks for that heading exactly.
    - **A name composed for a screen reader is not a data format: read the part from the element that holds it.**

393. **A new pipeline step named like a publish step.**
    - Cause: the M12 design called its step `tiles`, the name `PUBLISH_STEPS` already gives MTS at work. `job.steps` is one map, so the pipeline's record and the publisher's would have overwritten each other, and `pipeline_steps_of` would have listed the step for every job.
    - Found by: reading `JOB_STEPS` before writing the step. Fix and pin: the step is `pyramid` (`pipeline/tests/contracts/enums.json`, S-P08-HAPPY-FROM-WARP).
    - **A step's name is a key in a map two writers share: look it up in both lists first.**

394. **A tile with no alpha band is not a tile without alpha.**
    - Cause: a test asked every WebP tile for four bands; GDAL's WebP writer leaves the alpha out of a tile with nothing transparent in it, so a tile in the middle of a frame reads as three. It shows opaque, which is right.
    - Found by: S-P08-HAPPY-FROM-WARP. Fix and pin: the test checks the size there, and the tile with transparent pixels in S-P08-HAPPY-OLD-VERSION.
    - **Assert what a tile shows, not how its encoder chose to store it.**

395. **A helper script in a scratchpad several agents share ran in another agent's worktree.**
    - Cause: the session's scratchpad is shared by parallel subagents. A short `q.sh` that held `cd <repo>` was overwritten by another agent's `q.sh`, so `prettier --write`, `tsc -b` and Vitest ran in `hcm-wt/roles`, and the errors there looked like this tree's.
    - Found by: `tsc -b --verbose` naming the other worktree. Fix: a folder of the task's own under the scratchpad, read back before use. Prettier reformats only; no content of that worktree was otherwise written, but its author should know.
    - **Before trusting a script in a shared scratchpad, make its name yours; an impossible error may be someone else's tree.**

396. **A step the admin has no word for shows its code.**
    - Cause: `pyramid` joined `JOB_STEPS` without a name in `STEP_NAMES`; `stepNameText` falls back to the raw name, on purpose, so nothing failed and a version's page said "pyramid".
    - Found by: reading the page while building M12's view. Fix: `adminContent.jobs.stepName.pyramid` in both languages.
    - **A new step needs its name in the same task: the fallback is for steps from the future, and hides one from today.**

397. **A preview paler than what it previews.**
    - Cause: the version's map started at 80 %, from when it showed a rough picture over the basemap; a published layer starts at 100 %. A colour probe at the page's first opacity found the blend.
    - Found by: S-A74-HAPPY-SEES-IMAGE. Fix: 100 %, and the probe expects the tiles' own colour.
    - **"What you approve" includes how it is shown: compare the preview's defaults with the published layer's.**

398. **A translated label is no regular expression.**
    - Cause: a spec built its Work tab's name with `new RegExp(text with '\\d+')`; the label holds parentheses, so the pattern named nothing and the test waited out its whole timeout, which then stopped the rest of the run.
    - Found by: `@S-A75-HAPPY-THUMBS`. Fix: the label with its known count, as `import.spec.ts` does.
    - **Match a catalogue's text with the catalogue's text, not a pattern built from it.**

399. **A test's archive served whole by the local stack.**
    - Cause: the stack's site and forward read an object of the Storage emulator without the request's `Range`, so every read of a layer's own archive came back as the whole file (200). The viewer's reader refuses that, as it must, and the published layer failed on the stack with its toast; the e2e tiers serve archives through their own routes, so no test saw it.
    - Found by: the end-to-end rehearsal of 2026-11-07 (a real KH-9 frame, `docs/research/M12-own-tiles.md` → *Rehearsal*). Fix and pin: `e2e/stack/servers.ts` passes `Range` along; `dev-stack.sh check` reads the published archive's first bytes and wants a 206.
    - **A dev server in front of storage is part of the format: forward the headers the format is built on.**

400. **A button below the map moved the map out of sight.**
    - Cause: Actual pixels sits under the version's map in the detail column; at 1440×900 the owner scrolls to it, so the map zoomed above the fold and nothing seemed to happen. See the image already scrolled to the map; Actual pixels did not.
    - Found by: the rehearsal's screenshots, taken after each click. Fix and pin: Actual pixels brings the map into view first (`image-view.ts`, `approval-map.test.ts`, the own-tiles spec's `toBeInViewport`).
    - **Screenshot the viewport after a click, not the element: a change off screen is no change to the owner.**

401. **A layer on its own tiles was called linked, and told its tileset stayed at Mapbox.**
    - Cause: "linked" was read as "no `mapbox` block"; an M12 layer has none, as its tiles are in the project's bucket. The list tagged it Linked and the delete dialog said the linked tileset stays in the Mapbox account, while the job deletes its archives.
    - Found by: the rehearsal's layer delete. Fix and pin: linked needs no `mapbox` and no `currentVersion`; an own-tiles layer's dialog says its tiles in the public bucket go after the grace (`model.test.ts`, `layers-page.test.ts`).
    - **When a new kind of thing loses a field, check every place that read the field's absence as a meaning.**

402. **pytest ended halfway with exit 0, so the `tests` stage hid three failures.**
    - Cause: `test_matcher_serve.py`'s refusal test called the real `main()`, which installs the sidecar's SIGTERM handler, `os._exit(0)`, and never put it back. Later, the runner's signal test raised SIGTERM; `sigterm_raises` chains to the handler it replaced, so pytest left at once with exit 0. The gate read "passed", the XML coverage report was never written, and the three join and worker tests that M12's default path had broken were reported only as an `F` in the log.
    - Found by: the per-file coverage gate, which named the new pipeline files as missing from a stale `pipeline.xml`. Fix and pin: the test patches `signal.signal`; `pipeline/tests/conftest.py`'s autouse `signals_restored` fails any test that leaves SIGTERM's or SIGINT's handler changed and puts it back.
    - **A test that installs a process-wide handler restores it; a run whose output stops mid-file did not pass, whatever its exit code says.**

403. **Two job steps read alike in Romanian, and the real pipeline's spec found two rows.**
    - Cause: M12's `pyramid` step was named "Pregătirea dalelor pentru hartă", which contains `export`'s "Pregătirea dalelor"; `stepRow` (`e2e/admin/specs/imagery/world.ts`) filters the steps by their name, so it matched both and strict mode failed `S-P01-HAPPY-ADMIN`. English already said "Making the map tiles".
    - Found by: the targeted Playwright run of the imagery specs at `admin-l1440-ro`. Fix and pin: the Romanian is "Realizarea dalelor hărții"; `packages/shared/test/i18n-admin.test.ts` fails when one step name contains another, in either language.
    - **A new label beside old ones is checked against them, not only translated: a name that contains another confuses the owner and every lookup by text.**

404. **The test of a version whose tiles are gone failed one run in two with a 403 in the console.**
    - Cause: `S-A74-BAD-REFUSED` deleted the private archive while the version's open map was still reading it by range, then reloaded. A read the deletion overtook got the Storage emulator's 403 before the reload, and the console check caught it; the owner's case (the archive gone before the page opens) never sees it.
    - Found by: the targeted rerun of `own-tiles.spec.ts` with `--repeat-each 3` at `admin-c360-ro` and `admin-m768-ro` (3 of 6). Fix and pin: the spec leaves the page (`about:blank`) before deleting and opens the same address after.
    - Then, on compact windows, the test's end waited 120 s for an `imagery-search` its navigation had cut off: the page's `SceneWriters` never heard a finish for it. Its message now lists the calls still open, and `SceneWriters.settledOn(page)` lets a test that leaves or reloads its page wait for them first (8 of 8 after).
    - **Take a resource away from a page only when the page is not using it, and let its calls answer before navigating, unless the race is the behaviour under test.**

405. **A publish that stopped after its copy left an unpublished image public.**
    - Cause: `publish-own.ts` took its public copy back only when `finalizeVersion` returned false. A finalize that threw, or a run killed after the copy, left `tiles/C/L/V.pmtiles` world-readable; Reject and the dismissal of a failed version deleted only private files, and a first version has no layer whose deletion would empty the folder.
    - Found by: the review of M12 of 2026-11-08 (read, not run). Fix and pin: the copy is taken back when the publish stops (attempts out, finalize threw) unless the version is published with it; `deleteVersionTiles` deletes the public copy of a version never published on Reject and dismissal (`S-A70-BAD-FINALIZE-THROWS`, `S-A70-BAD-LEFT-COPY`, `S-A70-BAD-ATTEMPTS`, `functions/test/imagery/own-tiles.test.ts`).
    - **A step that makes something public is undone on every way out, a throw included, and whatever ends the record also ends what the record never got to name.**

406. **A path a worker wrote was trusted by the server that copies, signs and deletes it.**
    - Cause: `worker.step` let a run write any `output.tiles.path` (`pathSchema` is any string); `worker.urls` checked folders, but `publishOwn`, `imagery.previewUrl` and the rejection's clean-up acted on the stored path, so a worker of one city could publish, preview or delete another's private object.
    - Found by: the review of M12 of 2026-11-08. Fix and pin: `isOwnTiles` (shared) holds tiles to the version's own `tiles.pmtiles` and `thumb.webp`; `worker.step` refuses any other path and a side job's change to the rest of the output; the consumers answer `tilesGone` and the clean-up deletes the fixed names (`S-A70-BAD-FOREIGN-TILES`, `S-P08-BAD-FOREIGN-TILES`).
    - **An allow-list on signing is bypassed by any document that names an object: check the name again where it is used, or derive it.**

407. **The cost card counted one copy of a layer stored twice.**
    - Cause: publishing was a `copy`, and nothing deleted a published version's private archive, so every live layer stored about 179 MB twice while the card and the free tier's count said once.
    - Found by: the review of M12 of 2026-11-08. Fix and pin: publishing deletes the private archive (the thumbnail stays), `imagery.previewUrl` signs a published version's public copy, and the card says publishing *moves* the tiles (`S-A70-HAPPY-STORED-ONCE`, `S-A70-HAPPY-PREVIEW-PUBLISHED`).
    - **A number shown about money is checked against every place the bytes are, not the one the design drew.**

408. **"Try again in a few minutes" for tiles that were gone for good.**
    - Cause: `imagery.previewUrl` gave one refusal, `tilesMissing` ("made on their own"), for tiles not made yet and for tiles a sweep had deleted, and its alert always offered Try again. `S-A74-BAD-REFUSED` checked only that the key's words showed.
    - Found by: the review of M12 of 2026-11-08. Fix and pin: `apiError.imagery.tilesGone` for recorded tiles that are gone, with no Try again (`S-A70-BAD-PREVIEW-NO-TILES`, `S-A74-BAD-REFUSED`).
    - **One refusal per cause the owner can act on differently; a test of a refusal checks its words fit the cause, not only that they show.**

409. **"Being made on its own" for detail nothing would make.**
    - Cause: the page showed one note for every version without tiles, rejected ones forced in, though the sweep makes tiles only for waiting versions of a city on its own bucket, and a failed tiles job waits for a Retry the version's page does not show.
    - Found by: the review of M12 of 2026-11-08. Fix and pin: `smallKey` (`image-view.ts`) says on their way (and that the Jobs page has the Retry), never coming, or deleted, from the version's state and the city's setting (`S-A74-BAD-NEVER-COMING`).
    - **A promise on screen names the process that keeps it; where that process never runs, the promise goes.**

410. **An address's hour running out read as a broken image.**
    - Cause: every tile failure showed `tilesFailed`, though the address is signed for an hour and its comment named expiry as the usual cause; the page never read when its hour ended.
    - Found by: the review of M12 of 2026-11-08. Fix and pin: `VersionImage` counts the hour from the answer by the page's clock and, past it, asks for a new address on its own, once; within it a failure still says so (`S-A74-BAD-HOUR-OVER`: the admin's unit test and the own-tiles spec, which moves only the page's clock).
    - **A credential with a lifetime is renewed by what holds it; an error the code expects is not shown as one it does not.**

411. **A select driven by the `selected` attribute kept the admin's pick after the model changed.**
    - Seen: 2026-11-07, code review of the photo's date: March saved, May picked, Discard: draft and document said March, Month said May, with Save off, so the next save kept March while the screen said May. The licence select shared the helper.
    - Cause: an option the user has picked is dirty, and a dirty option ignores its `selected` attribute; Lit only moved attributes.
    - Found by: review, reproduced with the real `selectField` and Lit in Chromium before the fix.
    - Fix and pin: `.selected=${live(...)}` on each option (`packages/ui/test/admin/photos/editor-fields.test.ts`, S-A09-BAD-DISCARD-MONTH).
    - **A form control's state after user input is a property: bind the property, live, and test a model change after a pick.**

412. **Moving a fixture to a new rule turned five refusal rows into tests of that rule.**
    - Seen: 2026-11-07, code review: `newPhoto` gained `month` and `day`, so the rows about years in `firebase/rules-tests/test/photos.test.ts` were denied by `validPhotoDate`, and removing the year checks from `validPhoto` left them green.
    - Cause: a bad row merges into a full fixture and only asks for `deny`, so it says nothing about which clause refused.
    - Found by: review, then a mutation of the rules: the rows only fail on the mutated rules since the fix.
    - Fix and pin: the rows drop the month and the day (`YEARS_ONLY`); the update block gained year and date rows.
    - **A deny row proves its clause only if every other clause would allow: after changing a fixture, mutate the rule a row names.**

413. **A strict reader makes an optional field breaking for whichever reader is live.**
    - Seen: 2026-11-07, code review: a new function publishes `source` while an older viewer may still be on Hosting, and that viewer's strict schema refuses the whole manifest. The contract had only considered the v1.0.0 tag.
    - Cause: "additive" was checked from the new reader's side only; `firebase deploy` runs functions before hosting.
    - Found by: review, by reading the code; no deployment was run.
    - Fix and pin: documented, not yet enforced (`docs/research/photo-date-source.md` §3): Hosting first. Update the map holds it by construction; the CI job's split waits for the owner's yes.
    - **Before adding a field to a strict format, name the order writers and readers deploy in, and what a rollback of one of them does.**

414. **A hint in a loose paragraph and a catch-all reason both left out what the admin needed.**
    - Seen: 2026-11-07, code review: the notes under "date as written" and the source's name were tied to no input, and a bulk source that was not https reported only "it has a value that is not valid", though its scenario promised the reason.
    - Cause: the field kit's `hint` and the schema's issue path were at hand and unused; the e2e test asserted the generic text it got.
    - Found by: review.
    - Fix and pin: `hint` and `sharedHint` (`aria-describedby`, `toHaveAccessibleDescription` in S-A09-HAPPY-DATE-PRECISION); `adminContent.photos.reason.sourceUrl` from the issue's path.
    - **A test of "says why" must fail on a reason that would fit any field.**

415. **A status read when the trigger ran decided what a rule allowed when the upload began.**
    - Seen: 2026-11-07, security review of M13. An uploader's upload that finished after approval went public and replaced an approved picture, and a photo refused before processing got a public address, because `photos.onUpload` asked only "is it pending now?".
    - Cause: the Storage rule and the trigger look at the same status at two different moments, and nothing tied them together; `refused` also read as "not held".
    - Found by: review, each reproduced with a probe against `processPhotoUpload`.
    - Fix and pin: the trigger decides from who uploaded (the path's uid, a reviewer now) and the status as it stands, and a decision made while it runs wins (S-A90-BAD-LATE-UPLOAD, S-A90-BAD-REFUSED-NO-ADDRESS).
    - **A gate checked at the start of a slow step must be checked again at its end: a rule's answer is about the moment it ran.**
416. **An approval named the item and not the version the reviewer read.**
    - Seen: 2026-11-07, security review. The uploader could rewrite the text or the file up to the click, and the click published whatever stood then; the card showed only the title and the thumbnail.
    - Cause: the callable took an id and read the current document, and the card did not show what it published.
    - Found by: review.
    - Fix and pin: `review.decide` sends `seenAt`, compared inside the transaction, and the card shows the description and links (S-A90-BAD-CHANGED-SINCE).
    - **A decision about content must name the version it read, and the screen must show what the decision publishes.**
417. **A create rule's check was missing from the update rule of the same document.**
    - Seen: 2026-11-07, review. `aimedOnlyIfPlaced` was on the schema and the create rule, so an update wrote a document the server's schema refused, and every callable's `transaction.get` then threw on it.
    - Found by: an emulator probe of the direction the matrix did not test.
    - Fix and pin: the update rule asks the same, in both directions of the matrix (S-A94-BAD-AIMED-UNPLACED).
    - **Each cross-field refine of a schema needs its rule on create and on update, or a client can make a document the server cannot read.**
418. **A proposal checked alone, then merged onto a photo, and a revert that guessed its entry.**
    - Seen: 2026-11-07, review. A valid correction could never be approved (a year past the stored range failed the merged schema as an internal error), a date-only contest carried the form's seeded place and moved a photo back, an approved date text dropped the English one, and one-click Revert picked the reviewer's newest history entry, so it could undo a title edit or the wrong suggestion.
    - Cause: three things reasoned about a proposal away from the document it lands on, and Revert inferred which write it meant instead of recording it.
    - Found by: review, with probes.
    - Fix and pin: `functions/src/photos/suggest-apply.ts` keeps what changes, merges a date as a whole and records `undo` on the decision; `revert` restores exactly those fields while they still stand (S-A93-HAPPY-ONLY-CHANGED, S-A93-HAPPY-YEAR-RANGE, S-A93-HAPPY-DATE-LANGUAGE, S-A93-HAPPY-REVERT, S-A93-BAD-REVERT-STALE).
    - **Validate a change against what it lands on, and let an undo carry its own record: the newest entry by the same person is a guess.**
419. **Screens that could only be refused, and a block with no way back.**
    - Seen: 2026-11-07, review. An uploader's photo picker asked for every photo, their Undo read a history they may not read, a removed member was told they were approved, the gallery dropped the licence CC BY asks for, a suggestion on a city not public yet was accepted while the Contribute page said not found, and Block had no question, no list and no opposite.
    - Cause: each path was built from the happy role, and the rules matrix proved the data, not the offer on screen.
    - Found by: review.
    - Fix and pin: S-A90-HAPPY-UPLOADER-PICKER, S-A90-BAD-NO-UNDO, S-A92-HAPPY-ASK-AGAIN, S-V40-HAPPY-RIGHTS, S-A93-BAD-NOT-PUBLIC-CITY, S-A93-HAPPY-UNBLOCK.
    - **For each role, walk what the screen offers against what the rules allow, and give every lasting action a way back that a person can find.**

420. **A button pressed on a pad's first frame looked like a missing feature.**
    - Seen: 2026-11-07, `@S-V37-HAPPY-BUTTONS` failed on one project only: Start opened no menu.
    - Cause: the gamepad's loop counts what is held on its first frame as already held, so a press from before the page saw the pad fires nothing. The test pressed right after the toast, which shows before that frame.
    - Found by: the same spec on a second project, on a loaded machine.
    - Fix and pin: the spec waits a frame after the toast (`connectedPad`); the behaviour stays, and `edge_aButtonHeldBeforeTheLoopFiresNothing` pins it.
    - **A loop that starts by sampling has a frame in which nothing can happen: wait for it, never sleep.**
421. **Text checked through the native `<dialog>` found nothing.**
    - Seen: 2026-11-07, `getByRole('dialog').getByRole('switch')` and `toContainText` on About and the help panel failed with the content on screen.
    - Cause: the kit's `<dialog>` is in the shadow root of `<hcm-dialog>` and the content is slotted, so it is no DOM descendant of the dialog.
    - Found by: the first run of `e2e/specs/viewer/input.spec.ts`.
    - Fix and pin: the spec reads the host, `hcm-about-dialog`.
    - **Slotted content is a child of the host: look for it there.**
422. **The Layers key closed the photo it was meant to sit beside.**
    - Seen: 2026-11-07, review of the input branch: on an extra-large window `l` and Y called `openSheet('layers')`, which clears the selection, though the panel is always on screen there.
    - Also seen: the focus never reached the docked panel at all. `tabbableElements(host)` reads the host's light children, and the unit test's assertion accepted `document.body`.
    - Found by: reading the code; the unit test even asserted `sheet === 'layers'` and started with no photo open. The second defect by the new e2e row's first run.
    - Fix and pin: the command does nothing to the store where the panel is docked, and the focus goes into the panel's shadow root (`badPath_onAnExtraLargeWindowItKeepsThePhotoThatIsOpen`, `happyPath_onAnExtraLargeWindowItGoesToTheDockedPanel`, `S-V36-BAD-DOCKED-KEEPS-PHOTO`).
    - **Test a command from the state it can destroy, not from the empty one.**
423. **`click()` opened a menu under a modal, through `inert`.**
    - Seen: 2026-11-07, review: the pad's Start clicked the FAB behind the lightbox or the help panel, then B closed that hidden menu and nothing visible happened.
    - Found by: reading the code, then `HTMLElement.click()` on an inert element in the image's Chromium.
    - Fix and pin: Start asks `isInert` first, and an open menu takes no command (`badPath_startUnderAModalLeavesTheMenuClosedAndBClosesTheModal`, `S-V37-BAD-START-UNDER-MODAL`).
    - **`inert` stops the user, not a script: code that clicks for the user asks first.**
424. **A statement told visitors to write to people it could not name.**
    - Seen: 2026-11-07, review: "write to the people named above" in About, with no address, and nobody named on a city with no credits.
    - Found by: reading the sentence on the bare city; its test checked another paragraph.
    - Fix and pin: a link to the engine's issue tracker, on every city (`badPath_aCityWithNoCreditsStillHasAWayToReportAProblem`, `S-V39-BAD-BARE-CITY`).
    - **A way to report must work with an empty manifest: follow the instruction as the visitor would.**
425. **The night basemap dimmed the owner's colours, and no test could see it.**
    - Seen: 2026-11-07, review: following the theme made `night` the default on a dark page, and fill, line and circle layers default to an emissive strength of 0, so POIs and cones went dark beside bright icons.
    - Found by: reading mapbox-gl's style spec; the e2e world draws no Standard lighting. Not seen on a real map.
    - Fix and pin: `*-emissive-strength: 1` on those layers (`happyPath_sevenLayersInTheCategoryColourWithAWhiteCasingUnderLinesAndOutlines`, `S-V38-HAPPY` reads it from the mounted map).
    - **Changing a default widens who meets its old edge cases: look again at what the old default hid.**
426. **A scenario's title promised buttons its test never pressed.**
    - Seen: 2026-11-07, review: `S-V37-HAPPY-BUTTONS` named Layers and photos, while Y, LB, RB, A, the left trigger and the right stick were declared and unused; only unit tests with a fake surface drove them.
    - Found by: searching the spec for each constant.
    - Fix and pin: the spec presses them all through the mounted viewer; `S-V37-HAPPY-ACTIVATE` is new.
    - **An unused constant in a spec is a claim nobody tests: every name in a row's title gets an assertion.**
427. **The pad's focus ring lived in only one of the paths that move the focus.**
    - Seen: 2026-11-07, review: after a mouse click, Y and Start focused a control with no ring, because only the D-pad drew it and Chromium's `:focus-visible` stays off then.
    - Found by: reading the doc against the code; the spec's helper asks `:focus-visible`, so it could not have measured this.
    - Fix and pin: from the pad's first press each frame rings what has the focus (`happyPath_aFocusACommandMovedGetsTheRingToo`, `S-V37-HAPPY-RING`).
    - **Attach a guarantee to the state it describes, not to one code path that reaches it.**
428. **A chunk at its budget failed on nothing but a hash.**
    - Seen: 2026-11-07, the IIFE stood at exactly 125,000 bytes and the Imagery chunk at 17,999 before these fixes; the Imagery chunk then read 18,001 after a change to a catalogue it does not hold.
    - Cause: a chunk's import lines name its neighbours' content hashes, and those hash letters compress differently, by a few bytes each build. A shared helper for one repeated string also cost more than the repeats (31 bytes more): gzip already had them.
    - Found by: `check_bundle_budget.py` after each try, measured in bytes, not in the report's rounded KB.
    - Fix and pin: shorter texts and less code in the entry, and a declaration order in `imagery-styles.ts` that repeats its neighbour's run; no budget moved.
    - **At a budget's edge, measure each idea in gzip bytes before believing it, and leave a margin wider than the hash noise.**

429. **A list of what to show is not the list of what exists: the start page's own project dropped a step from `state.order`, and a rebuild over `order` lost its record.**
    - Seen: 2026-11-07, `@S-A76-HAPPY-LIVE`: Setup hid the old photos' step for a project of the owner's own, and the next status answer rebuilt `steps` from `order`, so a reader of `steps.legacyImport` threw.
    - Found by: the journey from the start page to a live map, on the bytes the page released.
    - Fix and pin: the rebuild walks every step (`SETUP_STEPS`); `order` only says what shows.
430. **Wait for what a scenario finishes before finishing it: `cloud-build.finish` before the build exists finishes nothing.**
    - Seen: 2026-11-07, `@S-A76-HAPPY-LIVE`: the build was queued after the scenario ran, so the card waited for ever and the claim never came.
    - Fix and pin: the spec polls `submittedBuilds` first, as the Setup journey does.
431. **`isGoogleFailure(error)` with no kinds is always false: naming kinds is what it checks.**
    - Seen: 2026-11-07, on the start page: every refusal read as an unknown failure until `instanceof GoogleApiError` replaced it.
    - Fix and pin: `packages/admin/test/start/failure.test.ts`.
432. **A fake that answers what the code hopes for hides the bug it was written to catch: Google says 403, not 404, for a project you cannot see.**
    - Seen: 2026-11-07, review of the start page: `ensureProject` created only after a 404, the fake's fresh world answered 404, and every S-A76 row passed while a real new owner would be told to accept the terms for ever.
    - Cause: the read's absent answer came from an assumption, and the fake was written from the same assumption. AIP-193 says 403 "regardless of whether or not it exists".
    - Found by: review, reading Google's rule against the fake.
    - Fix and pin: for a new project a 403 reads as not yet this account's and the create decides (`packages/admin/test/start/deploy.test.ts`); the fake answers 403 and refuses a display name outside Google's characters.
    - **When a fake models an error path, write it from the provider's documented rule, not from what the client expects.**
433. **A list of files to fill in beside a tree that marks them drifts: the site build replaced the token in two files, and the tree held it in more.**
    - Seen: 2026-11-07, `hosting.tgz`: `public/city/index.html` kept `__HCM_PROJECT_ID__` in its policy after Publish the map, and a stub tarball with exactly the two listed files kept the test green.
    - The first fix, replacing the token wherever it appears, was wrong too: the real self-host build showed the admin's own chunk holds the token, as the text `fetch` looks for, and rewriting it would break the next publish.
    - Fix and pin: the generic `hosting.tgz` lists the tree's own marks in `templates.json`, `fetch` reads that, and `@S-A76-HAPPY-ROOT` runs it over the real bundle.
    - **Test an adoption on the real artefact: a stub holds what the code already handles. Run the real build once before trusting a search over it.**
434. **Removing a flag says the road is open; only following the road proves it.**
    - Seen: 2026-11-07, `self-host` lost `--experimental` (CR-M5-7), but its bundle had neither the install bundle nor the city page, so Setup's Install and Publish the map said "reload the admin" for ever.
    - Fix and pin: the bundle's `hosting/` is the start site's release tree (`packages/create-historic-city/test/bundle.test.ts`, `@S-V29-HAPPY-SELF-HOST`).
    - **A step that deploys something must be followed to who reads it next.**
435. **A resume that repeats the first click must ask what changed since: a tab left open released the start-up tree over a published map.**
    - Seen: 2026-11-07, review: the plan stayed in the tab until Done, and an expired token at Check again went back through the whole deploy, which looked at everything but the live release.
    - Fix and pin: the plan is marked `released`, and the deploy reads the live channel first (`@S-A76-BAD-RELEASE-AGAIN`).
    - **"Idempotent" needs a look at the one step that overwrites.**
436. **A scenario row is a claim: "byte for byte" over a comparison of paths, and a sentence a mechanical edit left half deleted, both read as green.**
    - Seen: 2026-11-07, review of S-A76-HAPPY, S-A76-HAPPY-LIVE and S-V29-HAPPY-SELF-HOST.
    - Fix and pin: the spec compares every byte and digest with the manifest (`expectManifestReleased`); the rows now say what is run and what is not.
    - **Read the row beside its test after an edit to either.**
437. **`page.goto` to the address already open with only a hash does not load the page, so state that a load should reset stays.**
    - Seen: 2026-11-07, `@S-A76-BAD-NEW-CITY-AGAIN` looked for an empty form on the done screen.
    - Fix and pin: `page.reload()`.
438. **In the quality image a git worktree's `.git` points outside the mount, so `scripts/ci/e2e_build.py` exits 1 there.**
    - Seen: 2026-11-07, on the track's worktree: its stamp asks git for the inputs. `npm run build:site:e2e` is the build itself and works.
    - Fix and pin: run the build directly in a worktree.

439. **A saving made in one bundle was missing from the other that ships the same library, and a namespace import kept a library whole.**
    - Seen: 2026-11-08, merging four tracks: the engine's IIFE at 127.8 of 125 KB, `engine.mjs` at 100.2 of 100 and the admin at 654.6 of 650.
    - Cause: zod's JSON Schema conversion (lesson 352) was stood in for the admin only, so the engine still carried it; and `loadTerraDraw` took
      `import('terra-draw')` as a namespace inside `Promise.all`, so the bundler kept every mode of Terra Draw, though the admin builds five.
    - Found by: the bundle budget, then the bytes of each source map's modules.
    - Fix and pin: `scripts/site/src/zod-stand-ins.ts` serves both builds (`scripts/site/test/zod-stand-ins.test.ts`): the IIFE 122.1, `engine.mjs` 94.6;
      each dynamic import destructured where it is awaited: the `terra-draw` chunk 35.7 KB instead of 47.7, the admin 642.6 (DECISIONS-for-review.md §100).
    - **A saving on a shared dependency is applied to every bundle that ships it; a dynamic import read as a namespace keeps all of a library.**

440. **Two tracks reached the merge with gates their own trees failed.**
    - Seen: 2026-11-08, after merging photos, roles, input and the start page: Prettier, ESLint, knip, a pytest, the shared API test and per-file coverage failed in files the merge left exactly as the start track had them, and coverage in two files of the roles track.
    - Cause: not in the tracks' records (lesson 438: the start track's worktree could not run its e2e build). These gates read the files the merge left unchanged, so the tracks' own full runs would have failed them too.
    - Found by: `static` and `tests` on the merged tree (DECISIONS-for-review.md §100f). Fix: each finding fixed in its file; no gate relaxed.
    - **A track is merged after its own `static` and `tests` are green, not only the specs it touched.**

441. **A snackbar's text asserted with `getByText` failed in strict mode once its live region caught up.**
    - Seen: 2026-11-08, the merged tracks' specs on the NUC (627 of 628 passed): `roles.spec.ts`'s moderator test at `admin-m768-ro` found "Rolul tău nu include acea pagină." twice, in the snackbar and in its polite live region.
    - Cause: the live region gets the message `ANNOUNCE_DELAY_MS` after the snackbar shows (lesson 20's fix), so a page slow to reach the assertion sees both; the other projects asserted before the announcement.
    - Found by: the targeted Playwright run of the four tracks' specs. Fix: the assertion takes the text that is not in a live region (`:not([aria-live])`), as `smoke.spec.ts` already does.
    - **A snackbar's message is asserted without its live region; the live region is asserted on its own when the announcement is the point.**

442. **A new catalogue key took a name the join card already used, and long texts split their entries.**
    - Seen: 2026-11-08, the improvements track (`docs/research/M18-improvements.md`): `adminContent.imagery.join.waiting` was added for Join when it ends while the join card already had it ("Waiting for its frames"); and four new texts over 140 columns were wrapped by Prettier onto a second line, which the admin catalogues' section scan does not read as an entry (1471 keys of 1472).
    - Cause: a key chosen without a search of the catalogue; texts written as sentences, not to the line's width.
    - Found by: `tsc` and the i18n gate (the duplicate), `packages/shared/test/i18n-admin.test.ts` (the count). Fix: `join.waitingFree`; every text shortened to one line in both languages.
    - **Search the catalogue for a key before adding it, and keep each entry, key and text, within 140 columns.**

443. **The M18 improvements' review (2026-11-08) found six gaps that their tests passed.**
    - Seen: 2026-11-08, a review of `b09468a` on `track/improve`.
    - Cause: each test checked what the change was meant to do and no state around it. The self-reload asked only the unsaved guard, which reports edits, not uploads in flight. What needs you read a missing count as zero. The tick's Locate again did not check whether an editor was placing points on the frame, and it compared digests from two sources that can disagree (the Cloud Run job and the `setup/status` record). A failed crop's Locate again reset its attempts each time. The waiting frame's Delete cancelled the job, so the version read Cancelled, and its scenario row named stages no test covered.
    - Found by: the review. Fix: the stores' `busy()` (an upload) holds the reload; unknown counts keep their tile with a dash or an ellipsis, and a count the role may not read is not asked; the georeferencer's `placingPoints` mark holds the tick for two hours; only the job's image counts; a failed crop counts its runs; the waiting frame's Delete is `imagery.reject`, and the guard offers Delete too. Each fix has a test that failed before it.
    - **An automatic action (a reload, a re-run) checks every kind of work under way, not only the one guard that already exists. Null means unknown, never zero. A comparison uses one source of truth. A free re-run is capped when it brings no new input. A scenario row names only what a test asserts.**
444. **A new lazy area that imports the editing kit can push `editor-shared` over its budget without adding a line to it.**
    - Seen: 2026-11-08, `track/stories`: `editor-shared` at 13,001 bytes of 13,000 after the stories area joined; none of its modules had changed.
    - Cause: the shared chunk's export list and minified names change with every new importer, and a chunk at its limit has no room for that.
    - Found by: the `bundle-budget` gate on the NUC. Fix: a module only two areas share (`packages/ui/src/viewer/markdown.ts`) moved to the `editor-texts` group, which had room (DECISIONS §102b).
    - **Measure every chunk after adding an area, also the shared ones its imports touch; move a small shared module to a group with room rather than raise a row.**

445. **An uploader's create through the admin reads the new id first, and the M13 read rule denies a document that does not exist.**
    - Seen: 2026-11-08, `track/stories`, `S-A100-BAD-UPLOADER-WAITS`: New story as an uploader answered 403 on `batchGet`; nothing was created.
    - Cause: `ContentStore.create` is a transaction that reads the path before it sets it, and `ownItem(resource.data)` errors on a missing document, which denies the read.
    - Found by: the admin e2e spec on the emulators (the rules matrix seeded every document it read). Fix: the stories rule lets an uploader read an id with no document (`resource == null`), with its row in `firebase/rules-tests/test/stories.test.ts`.
    - **For review: places and photos have the same read rule, so an uploader's own create through the admin likely fails the same way; their rules want the same `resource == null` clause and an e2e create as an uploader.**

446. **A review door that checks only `pending` and `seenAt` approves a story with no text.**
    - Seen: 2026-11-08, the review of `track/stories`: New story writes the title alone with `reviewStatus: 'pending'`, so a moderator could approve it at once; the builder never lists a story without a body, and an approved story is no longer the uploader's to write or delete.
    - Cause: `decideText` treated a story as a place, and `storyIssues` guards only the editor's own Published switch, not `review.decide`.
    - Found by: review. Fix: an approval of a story without `body` answers `apiError.review.storyEmpty` and nothing moves; refusing it stays open (S-A100-BAD-REVIEW-EMPTY).
    - **Every check the editor makes before publishing is made again at the review door, which publishes too.**

447. **The stories editor offered every role New story, Delete and Versions; the rules and the routes refused them.**
    - Seen: 2026-11-08, the review of `track/stories`: a moderator's New story and Delete were denied by the rules, and Versions led moderators and uploaders to `#/history`, a route `LIMITED_ROUTES` does not open for them.
    - Cause: the page read only `reviewer`, not the city role, while the photos and places pages hide or disable by role.
    - Found by: review. Fix: the area carries `role`; the page hides New story and Delete for a moderator, Delete for an uploader's approved story, and Versions for both (S-A100-BAD-ROLE-ACTIONS). A moderator's story revert from the UI waits for `#/history` to open to moderators.
    - **A control a role's rules or routes refuse is not shown to that role: derive each from the same matrix, and test it per role.**

448. **A hash applied in steps let `story=` overwrite the `layers=` before it.**
    - Seen: 2026-11-08, the review of `track/stories`: a story shared after the visitor moved the timeline reopened at the story's year, not the shared layers.
    - Cause: `withHashStory` ran after `withHashLayers` and called `withStory`, which moves the timeline (`withYear`).
    - Found by: review. Fix: with `layers=` in the hash, the story opens with the link's layers and their year (S-V50-BAD-TIMELINE-LINK-LAYERS, also in Playwright); opening a story moving the timeline now has its own e2e row (S-V50-HAPPY-TIMELINE).
    - **A link reproduces the sender's view: when two hash keys set the same state, the explicit one wins, and a test decodes a link with both.**
449. **A helper shared by a lazy chunk and the chunk it loads made Rolldown emit a runtime chunk with no budget.**
    - Seen: 2026-11-08, track/recal's build: `rolldown-runtime-<hash>.js` (0.2 KB) appeared beside `recalibrate-card`, and the budget gate failed on a chunk without a row.
    - Cause: `recalibratable.ts` was imported statically by both `lazy-recalibrate.ts` (in `approval-map`) and `recalibrate-card.ts` (its own chunk), so the second chunk imported from the first and Rolldown hoisted its namespace helper into a chunk of its own.
    - Found by: the bundle budget. Fix: the loader decides and passes the answer (`recalibrateCard(..., offered)`); the lazy chunk imports nothing from the chunk that loads it.
    - **A lazy chunk imports nothing from the chunk that loads it: the loader passes what it decided.**
450. **A refine of a version that was itself waiting could have replaced a published layer with a worse fit, unasked.**
    - Seen: 2026-11-08, review of track/recal: Approve trusted the recalibration's own verdict, measured against its `basedOn`; a Refine of a waiting Save compared with that Save, read `better`, and replaced the published version without `acceptWorse`.
    - Found by: code review; every test refined the published version itself, where `basedOn` and the published version are one.
    - Fix and pin: figures count only against the layer's published version (`againstCurrent`, in the policy and in Approve's transaction); `recalibrate-guards.test.ts` (S-A89-BAD-WORSE-NEEDS-CHOICE).
    - **A comparison guards a replacement only when it is measured against the thing being replaced: check what the "before" names.**
451. **A local worker could have cancelled another layer's waiting version through a field it was allowed to write whole.**
    - Seen: 2026-11-08, review of track/recal: `WORKER_VERSION_FIELDS` listed `recalibration`, so a worker could write `recalibration.replaces`, which the server's policy obeyed with no check that it was the version's own base.
    - Found by: code review; the allow-list checks top-level names only, and no test wrote a server-owned sub-field.
    - Fix and pin: `worker.step` refuses a change to the server's part (`route`, `replaces`, `points`), and the policy replaces only the own `basedOn` on the same layer; `step.test.ts`, `recalibrate-guards.test.ts`.
    - **A field shared by the server and the worker is split by sub-field in the allow-list, and the server never acts on a pointer the worker could write.**
452. **A guard that moved out of a transaction let two clicks start two competing versions.**
    - Seen: 2026-11-08, review of track/recal: Refine on a waiting version wrote no document the layer guard read, so only the busy query (outside the transaction) stood between two starts; a publish then cleared any pending mark, not only its own.
    - Found by: code review; the tests started refines one after another, where the query sees the first.
    - Fix and pin: the waiting version records `refining`, read in the start's transaction; a publish clears only its own mark (`recalibrate-guards.test.ts`, `publish.test.ts`; S-A89-BAD-BUSY, S-A89-BAD-DECLINE-KEEPS-WAITING).
    - **When a write stops touching the document a guard reads, give the guard another document to read in the same transaction; a test of a race stales the query on purpose.**
453. **Two error messages told the owner something false: a join's advice could not be followed, and "too few checks" read as "the image did not match".**
    - Seen: 2026-11-08, review of track/recal: `joinRecalibrate` said to refine each frame (a published join's frames are `joined`, refused), and a refine with too few checks to compare ended `refineRefused`.
    - Found by: code review; the tests checked the codes, not what the words promise.
    - Fix and pin: the join's words promise no route; a new code `refineUnmeasured` (`recalibrate-guards.test.ts`, `test_recalibrate.py`).
    - **An error's words are a contract too: each refusal says the true reason, and advice names only a path a test walks.**
454. **Two tracks reached the merge with gates their own trees failed again, and a count's arithmetic moved with the registry.**
    - Seen: 2026-11-08, the merge of track/improve, track/stories and track/recal: recal's two buttons used `auto_fix_high`, a glyph the icon subset does not hold (the `fonts` gate), and its Romanian `apiError.imagery.refineUnmeasured` took two lines (the `i18n` gate); the merged registry of 93 functions made the fake's "a third of them deployed" 31, not 30; `packages/shared/src/index.ts` crossed 400 lines with the three tracks' exports.
    - Cause: the track ran its own `tests` and `build` but not its `static` stage after its last strings; the deployment test hard-coded a third of the count it was written for.
    - Found by: the `static` and `tests` stages on the NUC after the merges. Fix: `tune` (bundled), one-line Romanian, the expected third recomputed, two export pairs joined.
    - **A track runs `static` after its last edit, strings included; a test that derives a number from a registry's size states the derivation, so the next merge recomputes it instead of guessing.**
455. **A version's page kept reading its private archive after Approve published it, and the publish had deleted that archive.**
    - Seen: 2026-11-08, the targeted Playwright run after the merge of the three tracks: `join-wait.spec.ts` at `admin-c360-ro` failed on a console 404 for the frame's `tiles.pmtiles`, read from the version page after Approve and before the test left it.
    - Cause: M16 drew a published version from its public archive, but `VersionImage` redrew only when the version or its file changed (`<version>@<file>`); a version published while open kept the signed address of the private archive, which `publish-own.ts` deletes once published, so the next tile the map wanted was a 404.
    - Fix and pin: the drawn key holds the public address too, so the page moves to the public archive as the published state arrives (`version-image.test.ts`, *a version published while its page is open*).
    - **A cache key holds everything the drawing reads: when a state change moves where the data lives, the key must change with it.**

456. **A hold-out against a noisy reference hid the largest error in the map.**
    - Seen: 2026-11-07, `docs/research/M9-calibration.md` §14 *The measuring stick*: poly3 had been cut for "about 1 m" read on tiles against Sentinel-2, while film against film it takes the 52 pairs from 10.8 to 6.5 m and the one same-pass pair from 13.1 to 3.4 m.
    - Cause: a tile against Sentinel-2 carries 10 to 14 m of noise and the term repeats across frames, so a smooth 8 to 11 m misfit barely moves that figure; the saved figures, on the strongest tiles, hid it from another side.
    - Found by: warping the frames onto one grid and matching them with each other, a ruler no fit saw, checked first on a known injected field.
    - Fix and pin: no product change yet; `tools/acc-ruler.py` on the NUC, a copy in `reports/calib/accuracy/`.
    - **Before a gain is called small, ask whether the ruler can see it: prove the ruler on a known error, and read the error on something the fit did not use.**
457. **Noise put into a reference moved a figure that noise taken out barely moved.**
    - Seen: 2026-11-07, `docs/research/M9-calibration.md` §14 *Reference variants*: removing the error local to a place took the film ruler's 52 pairs from 6.51 to 6.38 m, yet noise at 0.25 of the image's spread took them to 7.67 m and the same pass from 3.24 to 9.95 m.
    - Cause: the two act differently. Tiles that pass are averaged over, so their noise matters little; noise in the image stops tiles passing the gate, and a cubic on few tiles runs away.
    - Found by: both directions on the same ruler, with a control that reproduced the earlier reading.
    - Fix and pin: no product change; `tools/acc-references-noise.py`, `acc-references-simex.py`, `acc-references.py` on the NUC, copies in `reports/calib/accuracy/references/`.
    - **Bound what a better input could buy before fetching it, and read a stand-in in both directions: a stand-in is a bound, never a before and after.**

458. **The map every figure measured was not the map the layer showed.**
    - Seen: 2026-11-07, `docs/research/M9-calibration.md` §14 *Frames together, a rigid stitch, and the join*: GDAL's reverse polynomial of the saved points lay 8.5 to 13.2 m RMS from the fit on five of eleven frames, and a real warp of F003 read 10.0 m against its own fit.
    - Cause: `warp` and `align` hand GDAL points with `-order 2`, and GDAL fits place to pixel separately from the pixel-to-place fit that `checkpointRmseM`, the proof and the ruler all read. A poly2 has no poly2 inverse.
    - Found by: the same transformer the product builds, read against the fit's exact inverse, then a real warp at maxzoom read on the film ruler.
    - Fix and pin: no product change; `tools/acc-joins.py rev`, `acc-joins-export.py`, `acc-joins-cost.py warp` on the NUC, copies in `reports/calib/accuracy/joins/`. A cubic exported as 17 x 17 `tps` points reads 0.39 m, and as `-order 3` 0.80 m.
    - **Measure what the published layer shows, through the transformer that renders it, not the fit it was made from.**
459. **A matcher's own figure fell nine metres; the map moved less than half of one.**
    - Seen: 2026-11-08, `docs/research/M9-calibration.md` §14 *Matching variants on the ruler*: gradient orientation halved a tile's noise against film (12.0 to 7.4 m) and its own blocked figure (21.7 to 12.3 m); the film ruler moved 6.45 to 6.01 m, and larger tiles, strong tiles only or weights by peak lowered the own figure while the ruler got worse.
    - Cause: a variant's own held-out tiles share its matcher, so a smoother or stricter matcher scores itself better; the map already averages thousands of tiles, so tile noise is a small part of its error.
    - Found by: every variant gated on a wrong-place null to the same false-accept share, then read on the film ruler, on fixed Sentinel-2 tiles and on its own tiles side by side.
    - Fix and pin: no product change; `tools/acc-matching.py`, `acc-matching-score.py` on the NUC, copies in `reports/calib/accuracy/matching/`.
    - **Never judge a matcher by its own tiles; a gate set by a peak value is a different gate at another tile size: set it on a null.**
460. **A guard of "at least as many" was a coin flip, and the fix alone read worse than the bug.**
    - Seen: 2026-11-08, `docs/research/M15-calibration-accuracy.md` *As built*: the KH-9 pan camera fell back to the poly2 of ~100 pairs whenever it kept fewer tiles within 25 m than the polynomial's RANSAC; 9 of 500 fold fits did, by one to five tiles, read 20 to 30 m, and took the film ruler from 8.14 to 9.79 m. Separately, rendering the poly2 fit faithfully (`-tps` through a lattice) read 14.64 to 16.03 m, as GDAL's reverse polynomial happened to sit nearer the truth on panoramic frames.
    - Cause: two counts of the same order, each maximised its own way, differ by noise when both models hold; and a model that is wrong everywhere can be beaten by another wrong one by accident.
    - Found by: the ruler's per-fold figures against the product's camera read directly (`tools/m15b-product.py diag`, `diag3` on the NUC), not the summary line.
    - Fix and pin: `CAMERA_MIN_KEPT_SHARE` 0.9, from the counts (0.989 at worst when the camera converged, none or under a third when it failed: `test_calibrate_camera.py`); the lattice stays, as the camera reaches the layer through it.
    - **A fallback guard compares against a margin set from how the healthy case varies; and judge a fix by the configuration it enables, saying plainly what it costs alone.**
461. **The georeferencer refitted a camera's map with a polynomial and showed that as the version.**
    - Seen: 2026-11-08, review of M15 steps 1 and 2: a KH-9 pan version's page showed the camera's figures (fitted on every tile, published through `georef.lattice`), while its georeferencer refitted the stored pairs with `fitTransform` and showed other errors, other residuals, another warning and a preview of a map that is never published.
    - Cause: the screen was written when the pairs were the whole map; the lattice made the stored figures and the published map something the pairs alone cannot rebuild, and the screen kept refitting on load.
    - Found by: the review reading `georef.ts` `#loaded` and `#refit` against the lattice's contract.
    - Fix and pin: unedited, the page shows the version's stored figures and residuals and previews the lattice through a thin-plate spline, as the warp renders it; once edited, the refit and a note that Save replaces the version's map (`fit-view.ts` `ownFitOf`, `shownFit`; `georef-published.test.ts`, `S-A16-HAPPY-VERSION-FIGURES`, `S-A16-BAD-EDIT-REFITS`).
    - **When the stored result stops being a function of what a screen edits, the screen shows the stored result until the user edits, and says when it no longer does.**
462. **Two mirrored cameras held the same tiles; the one kept was decided by a tile or a hundredth of a metre.**
    - Seen: 2026-11-08, review of M15: A001 got worse at the edges beyond its tiles. Each KH-9 pan frame has two cameras mirrored about the nadir that hold the same tiles within a tile or two (A001: 700 and 698); one needs a second-order term of 0.3 to 1.2 km, the other 4.3 to 8.7 km, and the product kept whichever held a tile more or came out 0.02 m closer: the bent one for A001, F022 and F049. They agree within 0.1 to 0.7 m RMS at the lattice's nodes over the tiles and part by 2 to 5.6 m RMS (23 m at worst) at the nodes beyond them.
    - Cause: variable projection lets the second-order term absorb a wrong scan-angle sign over the tiles; the score (most tiles, then the least squared error) cannot tell them apart.
    - Found by: listing every start's camera with its kept count, error, scan angle and second-order size (`tools/m15d-mirror.py` on the NUC).
    - Fix and pin: both signs are followed, and of the cameras within 1 % of the most tiles the plainest is kept (`camera.py` `plainest`; `S-P06-HAPPY-CAMERA-PLAINEST-MIRROR`, `S-P06-BAD-CAMERA-PLAINEST-ONLY-AMONG-EQUALS`). On the film ruler it is neutral (8.14 to 8.13 m, 12.65 to 12.50 m on 8 km blocks), and A001's edge is not what it fixed: the bend carried on its tangent beyond the tiles made the edges far worse (8 km blocks 12.65 to 21.51 m), so it was not built.
    - **Before restricting a model where no data reaches, check whether its near-equal solutions differ there; and measure the restriction, as a cut that sounds safe can cost more than the freedom it removes.**
463. **The pipeline's tests stopped three quarters through, with code 0, and the gate said passed.**
    - Seen: 2026-11-08, the `tests` stage of the M15 review: `pipeline-pytest` printed its dots to `test_runner.py` and then nothing, "passed", and the coverage gate failed for want of `reports/coverage/pipeline.xml`; the commit before it did the same.
    - Cause: `test_matcher_serve.py` calls the local AI sidecar's `main`, which installs its real SIGTERM handler (`os._exit(0)`) and never gives it back; `test_runner.py` later raises SIGTERM inside `sigterm_raises`, which chains to the handler it replaced, and the pytest process ended there with code 0: the last 23 % of 1,142 tests never ran.
    - Found by: the coverage gate's missing report, then the same run on the commit before (`git worktree` on the NUC), then the handler chain read in `runner.py`.
    - Fix and pin: `pipeline/tests/conftest.py` `stop_signals_restored` gives SIGTERM and SIGINT their handlers back after every test.
    - **A test that installs a process-wide handler gives it back; a suite whose tail went missing is a failure even when its exit code is 0: read the count.**
464. **The least cloudy Sentinel-2 date could move a whole city 12 m, and no ruler of ours would have seen it.**
    - Seen: 2026-11-07 and 2026-11-08, M15 *The reference guard*: three dates of tile 35TMK sit rigidly 9.8 to 13.0 m south of the others; in today's cloud order over Bucharest 2024-10-26 is second, so a cloud value a little different would have shifted every frame by 10 m. The film ruler compares frames with each other and cannot see a shift they share.
    - Cause: `stac.py` took one scene by cloud alone, with nothing to compare it with. While building the guard, two more: a plain median of five is pulled 2 to 3 m by two shifted dates, enough to keep a third at 8.7 m; the candidate list looped on an item whose date could not be read, as it was "apart" from every date, its own included; and a cached verdict of `"chosen": true` passed as set 1, since a bool is an int.
    - Found by: 115 scenes of the tile read against one another (`acc-open-refs.md`), then the product's own guard on real scenes with the shifted dates forced in (`~/hcm-calib/tools/guard/`), and the candidate test with a malformed date.
    - Fix and pin: `agreement.py`: up to 5 covering sets 30 days apart, each placed against the median of the others, re-centred after every rejection at 7.5 m, the least cloudy that agrees kept and recorded (`reference.s2Check`); the chosen items always leave the list, a stored `chosen` must be an int and no bool (`S-P06-HAPPY-REFERENCE-AGREEMENT`, `S-P06-BAD-REFERENCE-SHIFTED-DATE`, `S-P06-HAPPY-REFERENCE-ANY-LATITUDE`, `S-P06-BAD-REFERENCE-TOO-FEW`, `S-P06-BAD-REFERENCE-UNREADABLE`).
    - **An input every result shares is checked against its own kind, not against the results; prove the check with the bad inputs forced in, and say how many bad ones it survives.**
465. **One frame published wrong made every frame held with it look wrong.**
    - Seen: 2026-11-08, M15 *Joint solve*, the first test of a partner published 20 m off among three: every partner's ties sat over 6 m from the map of the frame and the other two, so all three were left out and the frame was fitted alone.
    - Cause: each partner was judged against a map the wrong one still pulled; with three partners of equal weight, the wrong one moves the others' maps by about half its error.
    - Found by: `test_bad_path_a_partner_published_wrong_is_left_out_and_named` (`pipeline/tests/unit/test_calibrate_joint.py`), written before the code was trusted.
    - Fix and pin: `calibrate/joint.py` `_trimmed`: the furthest partner beyond `DISAGREE_M` is left out alone, and the rest are measured again until none is (`S-P06-BAD-JOINT-PARTNER-DISAGREES`; the integration test moves a real accepted frame's image 20 m and reads it back at 20 m, left out).
    - **A leave-one-out check is itself contaminated by the other outliers it keeps: remove the worst one at a time and measure again, as the reference guard re-centres its median (401).**
466. **A map sampled on the warp's lattice lost more terrain than it corrected.**
    - Seen: 2026-11-08, M15 *Terrain*: A001's map over the Copernicus DEM, sampled on 17 x 17 nodes and rendered through `-tps` as every other lattice is, lay 11.3 m RMS from the map itself (Pitești 18.3 m), where leaving the relief uncorrected cost 6.4 m after a second-order fit.
    - Cause: the relief is a field of 900 m features; nodes 1.2 to 1.5 km apart sample it sparsely and the thin-plate spline between them invents what lies between (33 x 33: 3.6 m, 49 x 49: 2.0 m).
    - Found by: the exploration harness, before any product code (`tools/m15f-explore.py` on the NUC: the map against its own lattice render at the tiles).
    - Fix and pin: the map renders through an RPC with the surface model, which GDAL evaluates per place at its height, and which holds it within 0.002 m (`georef/rpc.py`, `steps/warp.py`; `S-P06-HAPPY-TERRAIN`, `test_terrain_job.py`).
    - **Before storing a map as samples, render the samples and compare them with the map at the scale of its finest term; a term finer than the samples needs a representation the renderer evaluates itself.**
467. **A frame's stored map was not the map its layer showed, and three readers showed the stored one.**
    - Seen: 2026-11-08, the review of M15 *Terrain*: a frame over terrain stored its lattice from the flat map (the camera before the relief), while its layer rendered the ground map through its RPC. The georeferencer previewed the lattice beside figures of the ground map, a join (M8) rendered its parts through it, and the warp fell back to it without the surface: 7.6 to 14.6 m RMS (25 to 42 m at most) from the layer on the real frames, worse on Sentinel-2 than the flat fit it replaced.
    - Cause: the lattice was kept as "what a lattice can hold", and each reader of a georef kept reading the lattice; nothing compared what each of them shows with what the layer shows.
    - Found by: the adversarial review, through the product's own `layer()` with the RPC step bypassed (`~/hcm-calib/adv/lattice.py`).
    - Fix and pin: the frame carries the heights under its scan (`georef.terrain.heights`), so every reader reads one map through one function: the warp, a join and the next frame's ties through `steps/warp.py` `attached` (a join's part over terrain read onto the level's grid first, its nodes placed there), the georeferencer through `terrainTransform` (`@hcm/shared`), held to GDAL's pixels by `pipeline/tests/contracts/terrain-map.json`; the lattice samples the ground map. On the real frames the preview lies within 8 µm of GDAL's map, a join's part within a millimetre of its layer, and the stored figures within 0.03 m of the layer's own (`S-A16-HAPPY-TERRAIN-PREVIEW`, `S-P05-HAPPY-TERRAIN-PART`; `test_terrain_readers.py`).
    - **When a map gets a second representation, list every reader of the first and prove each shows the published one; a reader that cannot evaluate the map needs the map's own data, not a sample of it.**
468. **A surface tile that could not be read became ground at 0 m, with no word, for 90 days.**
    - Seen: 2026-11-08, the review of M15 *Terrain*: Bucharest needs two GLO-30 tiles; without one the heights went from 51–126 m to 0–115 m and A001's correction collapsed (relief 6.0 → 0.85 m, its map 5.9 m RMS from the right one), still credited, still rendered through the RPC; the broken surface was cached by window, so every later frame of the city read it.
    - Cause: `_readable` dropped any tile it could not open, `INIT_DEST=0` filled the hole, and the only warning was for no tile at all.
    - Found by: the adversarial review (`~/hcm-calib/adv/demtile.py`, the product's `write_surface` without E025).
    - Fix and pin: every tile the window touches must open, else there is no surface (and nothing cached): the frame is fitted flat with a warning (`surface.py`; `test_bad_path_a_tile_that_cannot_be_read_gives_no_surface_rather_than_ground_at_0_m`, `S-P06-BAD-TERRAIN-UNAVAILABLE`).
    - **A partial input that reads as valid data is worse than none: refuse it whole, and never cache what was assembled from fewer parts than asked for.**
469. **A frame scaled to no correction was still credited and rendered as corrected.**
    - Seen: 2026-11-08, the review of M15 *Terrain*: `terrain_of` checked the relief before scaling it by what the tiles show, so a frame whose tiles showed none (scale 0) kept `georef.terrain`, the DEM's credit and the RPC render, 2 to 3 times slower (A001: 429 s against 152 s), for nothing.
    - Cause: the threshold was applied to the geometry's prediction, not to the correction actually applied.
    - Found by: the adversarial review (F003 over the broken surface stored `reliefM` 0.0 with `terrain` present).
    - Fix and pin: the relief is checked once scaled (it is linear in the tan): under `RELIEF_MIN_M` the frame is fitted flat, the record equal to the flat fit's (`test_bad_path_a_frame_whose_tiles_show_no_parallax_is_not_corrected`, `S-P06-BAD-TERRAIN-NEGLIGIBLE`).
    - **Gate a correction on what it will actually change, after every scale and clip, not on what the model first predicted.**
470. **A refine seeded from the map the layer shows failed on a frame over terrain with "cannot convert float NaN to integer".**
    - Seen: 2026-11-08, at the merge of the accuracy track (M15) into the recalibration (M16): Refine started its tile search from the current version's rendered map, GDAL's RPC over the heights under the scan; the search box is the city window's corners taken back to the film, which lie past the heights, so the RPC answered NaN and `film_box` raised.
    - Found by: the new pipeline test `test_happy_path_a_current_map_over_terrain_is_measured_as_it_renders` on its first run; every older test fitted flat, where the thin-plate spline reaches anywhere.
    - Fix and pin: the rendered map is the ruler (`before`, the rough points' corrections), the pairs' own fit is the seed (`start_of`), and a place GDAL cannot reach is NaN rather than a number (S-P19-HAPPY-CURRENT-AS-RENDERED).
    - **A map that is exact where it is defined is not a map of everywhere: measure with it, but seed a search that reaches past its domain with one that is defined there.**
471. **The georeferencer's preview of a frame over terrain was missing at the tablet and the laptop, and stayed missing.**
    - Seen: 2026-11-08, at the merge of the accuracy track (M15) into the recalibration (M16): `S-A16-HAPPY-TERRAIN-PREVIEW` failed at `admin-m768-ro`, `admin-l1440-ro`, `admin-l1440-dark` and `admin-l1440-en` (no `hcm-picture-warped` source after 15 s) and passed at `admin-c360-ro`; it failed the same way on the accuracy branch alone, so the merge did not cause it.
    - Cause: the pictures (the reference and the warped preview) are put on the map when their decode ends, and `PictureOverlays.show` drops a picture while the map is not there yet; nothing drew them again once the map came, so a page whose scan decoded before its map was ready showed no preview until the pairs changed.
    - Found by: the targeted Playwright run before the merge's commit; a probe of the page's state showed the scan ready, the preview on, the fit present and the map ready with no picture source.
    - Fix and pin: `GeorefPictures.mapStatus` shows the reference and draws the preview again once the map's status is `ready` (`georef-pictures.test.ts` → `happyPath_picturesDecodedBeforeTheMapGoOnItOnceItIsReady`, `S-A16-HAPPY-TERRAIN-PREVIEW`).
    - **Whatever is drawn onto something created asynchronously must be drawn again when it arrives: two independent loads have no order.**
472. **The live map lacked twelve old photos the old site shows (Ansamblu Gara de Nord, Strada Gradinarilor, …).**
    - Seen: 2026-11-08, by the owner on the live map: `https://bucurestiuldisparut.github.io/photos/ansamblul-gara-de-nord-in-constructie.JPG` and `strada gradinarilor.jpeg` were on the old site, not on the new map.
    - Cause: `seed/bucharest/` was taken from a copy of the old site (`ventura8/bucurestiuldisparut.github.io`) that had 11 of the 23 photo files the owner's account added after its fork (2022-12-27 to 2023-07-29), not from the live site.
    - Found by: the owner; no tier compared the seed with its live source, and every test pinned the 45 as the whole truth.
    - Fix and pin: the 12 in `seed/bucharest-2023/` (`docs/research/M5-interfaces.md` §12), bundled after the 45; Setup's import offers the missing ones in one click (S-A28-HAPPY-ADDITIONS).
    - **A migration names the live source it was taken from and is diffed against it, file by file and feature by feature, before it is called complete.**
473. **Importing the old photos again would have brought back a photo the owner deleted and republished one they unpublished.**
    - Seen: 2026-11-08, designing the import of the 2023 additions into a project that already had the 45: the import created any record without a document and published any processed, unpublished photo, which was right only for its own interrupted run.
    - Found by: review of what a second import does to an owner's edits; the tests only ever ran the import on photos nobody had touched.
    - Fix and pin: the import reads each photo's `history` (kept after a delete): a delete or an unpublish stamped with a person's uid counts as done and is never undone (`legacy-import.test.ts`, `legacy-photos.test.ts`; S-A28-BAD-OWNER-EDITS-KEPT). The first version counted any entry, and the e2e world's reset, whose deletes the triggers record after it, made the next tests' imports skip photos (the emulator stamps its admin's deletes `fake-auth-id@gmail.com`, a production function its service account's e-mail): only a person's uid counts. The emulator stamps every delete with that one fake account, so the person's delete is pinned in unit tests and the e2e row checks that a photo the server removed is imported again.
    - **An idempotent import must be idempotent against the owner's later edits too, not only against itself: it tells "never done" from "undone on purpose" by a record that outlives the document.**
474. **Parc Ferdinand had no direction on the new map though the old site shows one.**
    - Seen: 2026-11-08, by the owner: `parcul-ferdinand-1930` without a direction; the old site has its cone.
    - Cause: the old site moved that photo's point and gave it a cone on 2022-12-27, after the copy `seed/bucharest/` was taken; the 2023 additions were chosen by file name, so a photo already in the seed was never compared with the live data again. The cone matching was fragile too: it linked a cone to the point with the *identical* `photo` URL, while the old site wrote URLs on two hosts and with spaces or `%20`.
    - Found by: the owner; the additions' diff compared which files existed, not what the old site said of the photos we had.
    - Fix and pin: every one of the 57 compared with the live data (`scripts/seed/legacy-corrections.mjs`, `deriveLegacyCorrections`, `corrections.test.ts`): one correction in `seed/bucharest-2023/corrections.json`, applied by the bundle, the static site and Setup's import only where the owner never aimed or moved the photo (S-A28-HAPPY-DIRECTIONS, S-A28-BAD-OWNER-DIRECTION-KEPT); cones match their point by the decoded NFC file name (`legacyPhotoKey`, `legacy-photos.test.ts`).
    - **Diff a migration against its live source field by field, not only file by file: a record you already have can have changed too.**
475. **The test that keeps the owner's direction failed after the test that adds the old site's, on a cold run.**
    - Seen: 2026-11-08, the targeted Playwright run after the merge of track/oldphotos: `S-A28-BAD-OWNER-DIRECTION-KEPT` at `admin-steps-l1440-en` found no *Add the old site's directions (1)* when it ran right after `S-A28-HAPPY-DIRECTIONS` (1 in 3 with `--repeat-each 3`, the first).
    - Cause: the import's aim is stamped with the owner's uid, so the history trigger records it as a person's change of `bearing`; the happy test ended before the Functions emulator wrote that entry, the entry landed after the next test's reset, and the next test's import read Parc Ferdinand as aimed by its owner.
    - Found by: the merge's targeted run; the track's own runs were warm and the trigger won the race.
    - Fix and pin: the happy test waits for the trigger's entry before it ends (`legacy-additions.spec.ts`), as the bad test already waited for its own.
    - **A test that writes through a trigger waits for the trigger's write before it ends; a late write outlives the next test's reset and becomes that test's state.**
476. **The blue dot took the engine's IIFE 17 bytes over its 125 KB budget on the first build.**
    - Seen: 2026-11-08, track/improve2: the IIFE measured 125,017 bytes gzip with the my-location layer, the watch, the menu switch and two strings (124,019 before).
    - Found by: measuring the engine on the NUC before writing the tests, as the task asked (the `bundle-budget` gate would have said it at the `build` stage).
    - Then the `build` stage failed it again at 125,086: the gate measures with Python's gzip, about 90 bytes more than the `gzip -9` command the first measurement used.
    - Fix: no budget raised; the store's equality check, a paint property the flat dot did not need, one CSS rule for the switch's on state in both colour modes and short announcements brought it to 124,996 (DECISIONS-for-review.md §113a).
    - **Measure the engine's gzip size right after the first working version of a viewer feature, before tests and docs, and with the gate's own measure (`gzip.compress(data, 9)` in Python), not the `gzip` command: a full budget changes the design, not the last commit.**
477. **Two rows left `planned` as unreachable were reachable by holding the network.**
    - Seen: 2026-11-08, track/improve2: S-A61-BAD-UPLOAD-HOLDS-RELOAD ("no upload it can hold open across a deploy") and S-A40-BAD-COUNT-UNREAD-SHOWN ("cannot make one count fail").
    - Found by: reading what the admin sends: an upload is one request to the Storage emulator, a Home count one `runAggregationQuery` request to the Firestore emulator; Playwright's route holds either (never answered) or fails it, at the network, an external boundary.
    - Two traps on the way: `page.unroute` let the held requests go before the test could fail them (`Route is already handled`), so one handler with a mode holds, answers or drops; and a request dropped in a test's last line logs its console error after the test's own check, so the test polls `takeMatching` for it.
    - **Before marking a row unreachable, list the requests the behaviour makes: a held or failed request is usually the missing state. Switch one route handler's mode instead of unrouting held requests.**
478. **A store test counted a hash write that load had scheduled, not the action under test.**
    - Seen: 2026-11-08, track/improve2: `happyPath_theVisitorsPositionReachesTheMapAndNothingElse` found one hash written after `setMyLocation` under fake timers; the write was the boot's view, scheduled before the snapshot.
    - Fix: run the pending timers before taking the "before" counts (`store.test.ts`).
    - **Under fake timers, flush what the setup scheduled before snapshotting the counts an assertion compares against.**
479. **A privacy test searched for the wrong coordinates: the camera's view after Show my location is the position.**
    - Seen: 2026-11-08, track/improve2 review: S-V10-BAD-PAGE-HIDDEN looked for the second position (MOVED) in requests and storage, which the camera never visits; the first one went into the URL hash (`#16/44.4301/26.1003`) and every shared link. `store-located-view.test.ts` failed first on the hash.
    - Fix: `store.flyTo` holds the hash's view until the visitor moves the camera (DECISIONS-for-review.md §113f); S-V10-BAD-POSITION-NOT-IN-LINK checks the address and the copied link for the first position.
    - **A "kept nowhere" test searches every place a value can reach (the address and what Share sends included) for each value the feature handled, the one the camera went to first.**
480. **Opening Layers while Show my location was still flying put the visitor's position in the address.**
    - Seen: 2026-11-08, the targeted Playwright run after the merge of track/improve2: S-V19-BAD-HASH-NEVER-SENT at `fn-l1440-ro` found `#16/44.4301/26.09809&layers=…` in the hash (1 run in 4 to 5; the position was 44.4301/26.1003).
    - Cause: Mapbox's `flyTo` ends at the centre point it started from; the Layers pane narrowed the map mid-flight, so the flight ended half the lost width west of the position, and its own `moveend` reported a view other than the one flown to, which `store.setView` read as the visitor moving the camera and dropped the hash's held view (DECISIONS-for-review.md §114b).
    - Found by: the merge's targeted run; the track's runs had opened the pane after the flight ended, where a resize keeps the centre and the view still matched.
    - Fix and pin: the store holds the hash's view through the flight's own `moveend` wherever it ends, then while the view stays the same (`store-located-view.test.ts`, *a pane opened mid-flight*; S-V19-BAD-HASH-NEVER-SENT).
    - **A rule that reads "the visitor moved the camera" from where the camera ended up is wrong whenever anything else can move it; mark the move your own code started, and let only the next one count as the visitor's.**
481. **After the release that grew the legacy bundle to 57 photos, Setup's step h said "All the photos are on the map (45)".**
    - Seen: 2026-11-08, live, after deploying 1.0.0+567a5d6: step h was done with 45 and its first run imported against the 45; only a refetch past the browser's cache showed the 12 additions.
    - Cause: Hosting answered `/admin/legacy/**` with `public, max-age=86400` (CR-M2b-5, chosen for the 46 MB of originals), a rule after the `no-cache` one for JSON, so `photos.json`, `corrections.json` and `city.json` were cached a day under names a release never changes; the owner's browser kept the release before's bundle.
    - Found by: the owner, live; every tier ran on a cold browser, and the header test pinned the day as right.
    - Fix and pin: the admin reads every bundle file with `cache: 'no-cache'` (`bundleJson`, `BUNDLE_READ`), which also refuses a copy cached under the old header, and Hosting answers `/admin/legacy/*/*.json` `no-cache` (the originals keep a day): `bundle-fresh.test.ts`, `admin-hosting.test.ts`, S-A28-HAPPY-BUNDLE-FRESH, S-A28-BAD-STALE-BUNDLE-REFUSED (the e2e Hosting tree's file rewritten between two reads of one browser).
    - **A file a release changes under the same name is never cached past a revalidation: cache by content-addressed name, or revalidate; and the reader asks for revalidation too, since a header fixes only the copies cached after it.**
482. **Right after Setup opened, steps d and d3 said "Installing" with every step "next", then "An update is ready".**
    - Seen: 2026-11-08, live, after deploying 1.0.0+567a5d6: a visitor could think an install was running and wait.
    - Cause: `setup/status.install` kept the server's and the pipeline's builds as `working` from the owner's last visit; the cards show a record until their first look, and showed a recorded build at work as running, with steps that only a look fills in.
    - Found by: the owner, live; the e2e seeded records only in settled states.
    - Fix and pin: a view from a record carries `recorded`; a recorded build at work shows when it was last seen, no steps (`install-records.test.ts`, `install-recorded.test.ts`; S-A55-HAPPY-RECORDED-BUILD-CHECKED, S-A55-BAD-RECORDED-BUILD-NOT-RUNNING; tour state `setup.install-last-seen`). Its first version said "Checking the installation…" with nothing looking and let Update the map show beside it: lesson 483.
    - **A record of something in motion is a past observation, not a state: show it as last seen and as being checked, never as running now.**
483. **The fix of lesson 482 said "Checking the installation…" when nothing was checking, and let Update the map race the server's build again.**
    - Seen: 2026-11-08, the review of 6858f8a (not shipped).
    - Cause: the card said "Checking…" for every recorded build at work, but with no Google token the watch stops at once (`#lookWithoutToken`), and after a failed read the card kept the record's view (`#shown` took only `busy`, `error`, `blocker`), so "Checking…" stayed for good; and `building()` no longer counted a recorded build at work, so Update the map showed beside it, skipped that target, and Provision's record could go in before the server's build settled (finding 71's race).
    - Found by: the review; the unit fixtures set `recorded` without asking whether a look ran.
    - Fix and pin: the flow reports `looking` while a look runs; the card says "Checking the installation…" only then, else "Last seen installing on {date}. Check again to see now."; `#shown` takes `looking` and a failed read's `unavailable` (over a record at work it keeps the record: lesson 486); a view from a record is never recorded again; a recorded build at work hides Update the map until a look settles it (`install-recorded.test.ts`, `install.test.ts`, `install-flow.test.ts`; S-A55-HAPPY-RECORDED-BUILD-CHECKED with Cloud Build's answer held, S-A55-BAD-RECORDED-BUILD-NOT-RUNNING with a failed look).
    - **A status line names what is happening now: "checking" needs a check under way; and a guard relaxed for display must still hold for the action it protected.**
484. **The e2e pair for the stale legacy bundle passed without the admin's `no-cache` read.**
    - Seen: 2026-11-08, the review of 6858f8a.
    - Cause: the e2e Hosting already answered the bundle `no-cache`, and every admin test's context has the firewall's `context.route('**/*')`, which turns Chromium's HTTP cache off: no copy was ever cached, so nothing tested the admin's read.
    - Found by: the review, reverting the read in thought; the spec's own comment said a route would turn the cache off but missed the fixture's.
    - Fix and pin: the e2e Hosting serves `/admin/legacy/**` with the old `public, max-age=86400` to a browser with its test-only cookie `hcm-e2e-cache=day` (`e2e/mock-apis/admin-server.ts`); S-A28-BAD-STALE-BUNDLE-REFUSED runs in a browser context of its own, no route (only loopback resolves; every address asked is checked), reads the release before under that header, then the new one: it fails when `bundleJson` drops `cache: 'no-cache'`. Its first run on the NUC found the spec reading the Hosting tree from `e2e/` (Playwright's workers' directory) while the e2e Hosting serves it from the repository's root: the spec resolves it from `import.meta.dirname`.
    - **A cache test needs a cache: check that nothing in the harness turns it off (any Playwright route does), and prove the test fails without the fix.**
485. **Right after Update the map, step d said "Waiting for Google Cloud Build" and "Running for 3 min." at once.**
    - Seen: 2026-11-08, live.
    - Cause: the card counted from the build's `createTime`, on Google's clock, to its last look, on the browser's: any difference between the two clocks showed as minutes at work, and a queued build was said to be running.
    - Found by: the owner, live; every tier ran the fake Cloud Build and the page on the same clock.
    - Fix and pin: the flow sets `runningSince` when a look first sees the build at work, on the browser's clock, less what Google's own clock says it had worked by then (`elapsedOnGoogle`: its latest step time after `startTime`); null while queued; the card counts from it (`install-flow.test.ts`, `model.test.ts`, `install-cards.test.ts`; S-A55-HAPPY-RUNNING-TIME, S-A55-BAD-RUNNING-TIME-QUEUED with the page's clock three minutes ahead of the fake's).
    - **Never subtract a time on one machine's clock from a time on another's: measure a duration on one clock.**
486. **The fixes of lessons 483 and 485 still let one failed read race the server's build, and said "Running for 0 min." for a 9-minute build.**
    - Seen: 2026-11-08, the review of the stale fixes (not shipped).
    - Cause: a read Google could not answer turned the card `unavailable`, which is no running state: `#settledServer` took it for a settled server and let Provision's record go to the old one mid-build (no second click needed), `#siteDue` dropped the site's republish, and `building()` offered Update the map again beside the build. And `runningSince` was now less `elapsedOnGoogle`, which only reaches the latest step time: a build first seen at work 9 minutes in, its one long step started 40 s in, counted 40 s.
    - Found by: the review, following one failed poll through every reader of the state; the unit fixtures never failed a read while a build ran, nor first saw one partway through a step.
    - Fix and pin: a failed read keeps a target at work at work, with the error (`#fail`; `#shown` over a record at work); the server settles only on a look that saw it neither running, nor clicked, nor `unavailable` (`settled`); `workStartOnBrowser` takes Google's `startTime`, never before the tab last saw the build queued nor after now less `elapsedOnGoogle` (`install-flow.test.ts`, `install.test.ts`, `model.test.ts`, `install-recorded.test.ts`; S-A55-BAD-UPDATE-DURING-BUILD with a failed read mid-build, S-A55-BAD-RECORDED-BUILD-NOT-RUNNING).
    - **An error state is not an outcome: a read that failed says nothing of the thing read, so keep what was last known and let only a real answer settle a wait. And a lower bound is not an estimate.**
487. **The browser queued every tile of an archive behind the one before it.**
    - Seen: 2026-11-08, the first own-tiles layer on the live map: 30 tiles of one PMTiles archive finished half a second apart, the last after 10 s, though each read took 0.3 to 0.5 s.
    - Cause: Chrome lets one cacheable request of an address run at a time (its HTTP cache lock), whatever the Range; every tile read used the archive's one address.
    - Found by: the owner's eyes on the live map, then a measure in the page: 16 reads in 6.2 s at one address, 0.86 s with no cache, 0.78 s with an address per range.
    - Fix and pin: `rangeRequest` gives each range its own address (`?range=`), still cached; a signed address, whose query is signed, skips the cache instead. Tests in `pmtiles-source.test.ts`.
    - **Measure parallel reads on the real browser and host: a fake fetch cannot show a browser's own queue.**
488. **The blue dot came with a ring of blue dots: a circle layer drew one at every vertex of the accuracy circle.**
    - Seen: 2026-11-08, the owner on 1.0.0+d1aa25f: "a lot of blue dots around the centre one".
    - Cause: `hcm-my-location-dot` (a `circle` layer) had no filter over a source that also holds the accuracy circle's Polygon (25 points) and the heading cone; Mapbox draws a circle layer at every vertex of a polygon. The unit tests checked the features and the layers' paint, never which features each layer draws; S-V10-HAPPY read the first rendered dot feature and the blue pixels at the centre only.
    - Fix and pin: the dot layer's filter `['==', ['geometry-type'], 'Point']` (`packages/ui/src/map/my-location.ts`); `my-location.test.ts` (failed first on the missing filter) and S-V10-BAD-ONE-DOT-ONLY, which counts the dot layer's rendered features (one Point) and finds no solid blue at the circle's edge.
    - **When one GeoJSON source feeds layers of different types, filter every point-like layer (`circle`, `symbol`) by geometry type, and test what each layer renders (its rendered features, a pixel where the wrong thing would be), not only the source's features.**
489. **The engine carried zod's English messages, which it never shows, while its IIFE was 53 bytes under budget.**
    - Seen: 2026-11-08, track/locate: the photo sheet's Show on map needed about 440 bytes gzip in an IIFE at 124,947 of 125,000.
    - Found by: weighing the IIFE by source file from its source map (`zod/v4/locales/en.js`, 2.7 KB minified) and reading where an issue's text goes: the viewer shows its `validation.*` code, never zod's sentence (`packages/shared/src/schemas/validation.ts`). §100a had kept the messages in the engine, §93 had taken them out of the admin for the same reason.
    - Fix: the engine's build resolves them to the admin's empty stand-in too (`packages/engine/vite.config.ts`, DECISIONS-for-review.md §120a): 1,010 bytes; no budget raised, no feature cut.
    - **A stand-in one build makes for a reason that holds in the other build belongs in both; when a budget is full, weigh the bundle by source file before cutting the feature.**
490. **Show on map's ring would have vanished after a second press mid-flight, landed half under the sheet or the compare divider, and gone to the wrong side on a right-to-left page.**
    - Seen: 2026-11-08, track/locate, in review before the merge: (a) a second press while the camera still flew (or while it glided after a swipe) arrived with no ring, and under reduced motion the ring went before it was painted; (b) reduced motion switched on after the map loaded put the place at the map's centre, under the top edge of the compact bottom sheet; (c) in swipe compare the ring was only on the main map, half of it hidden under the second map; (d) a host page with `dir="rtl"` puts the side sheet on the left, and the offset sent the place further left, under it.
    - Found by: a code review reading Mapbox GL 3.34.1's own source: `flyTo` and `easeTo` start with `stop()`, which fires the stopped move's `moveend` at once, and a flight that is not `essential` becomes a `jumpTo` without the offset when Mapbox reads `prefers-reduced-motion` itself on each call. Every tier was green: the `FakeMap` never fires `moveend` from `flyTo`, the reduced-motion project runs at l1440 where the sheet is docked, no spec compared with the ring, and the viewer ships no right-to-left language.
    - Fix and pin: the store ignores the `moveend`s fired while Show on map starts the camera and counts the flight's own only when it flew; the engine reads reduced motion when the button is pressed and passes `animate` itself, which the adapter makes `essential`; the ring is the state's `photoMark`, drawn by `MapSync` on every map; the offset is worked out from the sheet's box and the map's (`badPath_aSecondShowOnMapDuringTheFlightKeepsTheRingWhereTheFlightLands`, `badPath_reducedMotionTurnedOnAfterTheMapLoadedJumpsBesideTheSheetAndKeepsTheRing`, `happyPath_theRingIsOnBothSidesOfTheDivider`, `badPath_aSideSheetOnTheLeftOfARightToLeftPageSendsThePlaceToItsRight`, `badPath_anExplicitAnimateWinsOverTheMountsReducedMotionAndMapboxsOwn`, `S-V51-BAD-INTERRUPTED`).
    - **A fake map must fire what the real one fires synchronously; and anything drawn on "the map" belongs in the state that every map of the view follows, not in a call to one map.**
491. **The Buy this scan card told the owner to use a basket the page it opened does not have.**
    - Seen: 2026-11-08, the owner's first real order (D3C1216-100235F038): the guide said to add the scene to the EarthExplorer basket from the search results and open Item Basket, but Order in EarthExplorer opens the scene's Full Display page, which has Login and an Order button at its bottom and no basket; the order page then asks for 7 Micron and Submit Product Selections, and payment is by card on pay.gov (35 USD).
    - Found by: the owner, live. The steps came from USGS's help pages, written for the search results; the contract marked where the control sits UNVERIFIED, and every test asserted our own strings, so no tier could see the gap.
    - Fix and pin: the four steps rewritten from the live order (ro and en: sign in, Order, 7 Micron with Submit Product Selections, USGS's form and pay.gov); `orders.test.ts` and S-A13-HAPPY assert them (`M4-interfaces.md` §1 *Buy flow guide*, DECISIONS-for-review.md §121).
    - **A guide for a third-party site is written from the page our link opens, walked once by a person, not from the provider's help pages; until then it stays marked UNVERIFIED in the card's own contract.**
492. **Four tracks each within the engine's IIFE budget went 22 bytes over it together.**
    - Seen: 2026-11-08, the merge of track/tilespeed, track/onedot, track/locate and track/ordersteps: `bundle-budget` measured `engine.iife.js` at 125,022 of 125,000 bytes gzip.
    - Cause: each track measured its own IIFE against the main branch it started from; tilespeed's range addresses (about 107 bytes) were measured on f2f917b, before locate and onedot spent the room zod's messages had freed.
    - Found by: the `build` stage on the NUC after the four merges. Fix: trims with no behaviour change (DECISIONS-for-review.md §122): the range request carries its own `Range` header, the signed-address test is `address.includes('Signature=')`, the camera passes an offset-free view as is, and the dot's filter reuses `geometryIs` from `pois.ts`; 124,971 bytes.
    - **A track near a budget measures again on the branch it merges into; the integrator measures after every merge, not only after the last.**
493. **One older version that failed its schema made a same-date frame, and its join, fail in georef.**
    - Seen: live 2026-11-08 16:42 UTC on 1.0.0+d1aa25f: the import of D3C1216-100235A039 (1980-07-16, part of a join) located and proved, then `georef` (`aligning.held_frames`) read every version `worker.step` listed and one read answered `apiError.internal`; the job failed, and with it the join.
    - Cause, proved by tests that failed first: `worker.step` listed the city's versions from the query's valid **and invalid** documents, and its `get` validated with `layerVersionDocSchema`, so a stored version that fails the schema threw `InvalidDocumentError`, which a callable answers as `apiError.internal` (`step.test.ts`, *S-A62-BAD-HELD-UNREADABLE*); the pipeline caught a `WorkerApiError` on the list (`_listed`) but not on each read, so one unreadable partner failed the frame (`test_steps_aligning.py`, `test_worker_run.py`, *S-P06-BAD-JOINT-UNREADABLE*: the red run raised the live trace's `WorkerApiError: apiError.internal` from `worker/api.py`).
    - Which field: not read from the live document (no cloud access in the task). The pipeline's current writers are not it: every one of the 545 version writes of the 193 integration tests, lattices, terrain and alignments included, passes `layerVersionDocSchema` (a probe of the track, not kept; the only refusals were documents the tests seed half-made, and the malformed-heights case on purpose). The city keeps a known invalid version: the KH-9 import of 2026-11-02 (finding 62, lesson 332), written on Cloud Run straight to Firestore with a scan side and corner pixels over `MAX_SCAN_PIXELS`, which `scanSchema` and `pixelSchema` refuse; no schema has narrowed since (every change to the version schemas from M3 to M16 widened them), so an older shape that passed then passes now. Not a schema to loosen: that document is wrong, not old; it is ended work no screen shows (Work drops it). Migration: the owner deletes or repairs it (a cloud change, ask first); the server's warning *worker skipped an invalid version* now names its path and failing fields, so the next run confirms which.
    - Fix and pin: the server lists only the versions that pass the schema, and a `held` read of one that fails answers `{data: null}` with that warning (the job's own documents still fail loudly; the log lines' list unchanged); `held_frames` leaves out any version whose read raises `WorkerApiError`, with one warning line naming them, and fits with the others or alone.
    - **A loop over documents someone else wrote treats each unreadable one as absent, on both sides of the wire: one bad neighbour never fails the run that only wanted to look at it. Catch per item, not only around the list.**
494. **The fix of lesson 493 caught one partner's read, but not its file, and the owner never learnt of the versions the server left out.**
    - Seen: 2026-11-08, the review of 0421875 (track/heldfix), before any release.
    - Cause, proved by tests that failed first: after the read, `_kept` looked the partner's `align.tif` up (`objects.stat`, through `worker.urls` on a local worker) with nothing caught, so a refusal (`WorkerApiError`), a store failure (`ObjectStoreError`) or a layer id off the path pattern (`PathError`) failed `georef`; `partner_ties` ran inside `gdal_step`, which turns any `RuntimeError` (the file deleted between its look-up and its download, a refused URL, a file GDAL cannot read) into `processingFailed` and failed the import; the server dropped the invalid versions from its list without telling the run, so the owner's job log said nothing; and an issue of the whole document logged an empty field (`test_steps_aligning.py`, `test_worker_documents.py`, `test_worker_run.py`, `test_joint_job.py`, `step.test.ts`; `S-P06-BAD-JOINT-UNREADABLE`, `S-A62-BAD-HELD-UNREADABLE`).
    - Fix and pin: `PARTNER_FAILURES` (`RuntimeError`, `PathError`) caught around each partner's look-up, staging, read and measure; that partner alone is left out with one line naming it (never the error, which may carry a signed URL), after `ctx.checkpoint()`, and `RunStoppedError` (a lost lease, a revoked computer) is none of them, so it still stops the run. The list answers `{ids, skipped}`; `ApiDocumentStore.skipped` (the `SkipsInvalid` port) reads it, an older server's answer as 0, and the job log says *N of the city's frames could not be read and were left out*. The server names `(document)` for an issue at the root.
    - **"Catch per item" means every step that touches the item: list, read, look-up, download, decode, measure. Find each call that takes the neighbour's id or path, and give it the same catch; a wrapper that turns every error into a failed step is the opposite of per item.**

495. **The fix of lesson 494 caught the store's errors, but the stores let the network's and Firestore's own errors through.**
    - Seen: 2026-11-08, the review of a6750294 (track/heldfix), before any release.
    - Cause, proved by tests that failed first: `PARTNER_FAILURES` (`RuntimeError`, `PathError`) assumed every store failure is an `ObjectStoreError`, but `SignedObjectStore.download_file` and `GcsObjectStore.stat` / `download_file` let httpx's `ConnectError` and `ReadError` (an `Exception`, no `RuntimeError`) escape, and `FirestoreStore.get` / `list_ids` google.api_core's `DeadlineExceeded`; one partner cut midway failed the whole import as `internal` with no frame named, and the bytes read so far stayed in the scratch, unknown to `ctx.staged` (`test_objects.py`, `test_worker_objects.py`, `test_store.py`, `test_steps_aligning.py`, `test_worker_run.py`; `S-P06-BAD-JOINT-UNREADABLE`).
    - Fix and pin: `objects.transported` maps `httpx.HTTPError` to `ObjectStoreError` naming its kind (never the address: a signed URL's query is a credential) in both stores' look-up and download, and removes a download it cut short; `FirestoreStore.get` and `list_ids` raise `DocumentStoreError` (a `RuntimeError`) for `GoogleAPIError`, and `_listed` catches it as the worker's refusal (the frame is fitted alone). Callers keep catching the port's own types; `RunStoppedError` still stops the run.
    - **A port's error contract covers its transport too: an adapter maps its client library's exceptions (httpx, google.api_core) to the port's error at the boundary, or every caller's "catch the store's error" is a hole. Test each adapter with the transport failing, not only with an error status.**
496. **A tile the archive leaves out drew an earlier tile of another place: Mapbox GL reuses a texture for a `null` tile and uploads nothing to it.**
    - Seen: 2026-11-08, the owner's screenshot of the live 1980 layer (one KH-9 frame over Bucharest's north half) at z13.59: south of the frame's edge, instead of the basemap, a grid of square grey pictures at the wrong scale and place.
    - Cause: `pmtiles-source.ts` answered a hole with `null`. Mapbox GL 3.34.1's `CustomSource.loadTile` turns `null` into `{width, height, data: null}`; `Tile.setTexture` takes a texture from the painter's pool (`getTileTexture`, shared by every raster source and keyed only by size, refilled by `saveTileTexture` whenever a tile leaves a cache), and `Texture.update` uploads pixels only when `data` is set, so the recycled texture kept the earlier tile's picture. Every layer with holes inside its bounds showed it (twelve of thirteen live layers, 40 of 100 z13 tiles for 1980). The reader's Hilbert ids were checked against the reference implementation (no mismatch) and were not at fault.
    - Found by: the owner, live. The tests had missed it: the hole scenario (S-V32-HAPPY-HOLE) opened the map at the hole, when the pool is still empty and a fresh texture is blank; the bug needs tiles to have left Mapbox GL's cache first.
    - Fix and pin: a hole is one shared, transparent 256 px `ImageData`, whose upload overwrites whatever the texture held; still no request (`pmtiles-source.test.ts`, S-V32-BAD-STALE-HOLE); `e2e/specs/viewer/partial-frame.spec.ts` walks eighteen views inside a partial frame, more than the cache keeps, then probes past it (failed with the frame's colour before the fix).
    - **A library's "nothing here" answer is only as good as its least-travelled path: read what it does with it, and test the path after its caches have turned over, not only on a fresh page.**
497. **The black band along a frame's edge was the film's own rim under an opaque alpha.**
    - Seen: the same screenshot: an opaque black band along the 1980 frame's diagonal edge. Its z13 tile 4689/2965: 3 to 5 rows at grey 0 to 3 with alpha 255 above the alpha's cut, then about 6 rows fading in.
    - Cause: `stitch.py`'s border crop keeps a skewed or fading film edge (it keeps a row whose mean passes 0.35 of the median), and the warp's alpha covers the whole scan footprint, so the tiles drew the rim as image (M12's rehearsal had measured it, `M12-own-tiles.md`, and nothing cut it).
    - Fix and pin: `tiles/rim.py` cuts it from the tiles' alpha, not from the crop (moving the crop would shift the scan's pixels under the saved points): the dark pixels the transparent outside reaches through dark pixels only, at most 250 Mercator metres in, found on a preview and drawn bilinear (`test_pyramid_rim.py`, S-P08-HAPPY-RIM-CUT, S-P08-BAD-RIM-LIMITS). Published archives keep their band until their layer is rendered again.
    - **A mask that marks "where the scan is" is not one that marks "where the picture is"; the difference is the film's own border, and it needs a test with a rim in it.**
498. **A 256 px raster source draws its tiles one zoom deeper than the camera's zoom.**
    - Seen: 2026-11-08, writing S-V32-HAPPY-PARTIAL-FRAME: the frame's edge was a z17 row at the camera's z16, not the z16 row the test computed, so the "inside" probe read the basemap.
    - Cause: Mapbox GL's world tile is 512 px; a `tileSize: 256` source covers the view with tiles of zoom + 1.
    - Fix: the spec computes the edge from the tile zoom (`TILE_ZOOMS`), and its archive holds z16 and z17 for camera zooms 15 and 16.
    - **When a probe depends on which tiles are drawn, derive the tile zoom from the source's tile size, not from the camera's zoom.**
499. **The rim cut by a fixed grey left the fade as a dark band, and its VRT pixel function hid every overview.**
    - Seen: 2026-11-08, a review of 2358145 against the live 1980 tile 13/4689/2965: above where a grey-24 cut would end, 3 to 6 z13 rows (about 55 to 115 m) fading in at grey 29 to 70; and the view's alpha, a `VRTDerivedRasterBand` with `PixelFunctionType=min` over a rescaled mask, gave the view no overviews at all, so the thumbnail read the full-size frame through the pixel function.
    - Cause: the film's edge is a ramp, not a step: only its first rows are black; and GDAL exposes a VRT's implicit overviews only when every band's sources are plain sources with overviews of their own.
    - Fix and pin: `tiles/rim.py` cuts a band from the alpha's edge in two passes, the black core and then the fade while darker than 65 % of the scene's own median, at most 150 ground metres in; the trimmed alpha is written once as `rgba-alpha.tif` with the source's overview levels (`test_pyramid_rim.py`: a 100 m fade leaves nothing under 60 % of the scene near the edge, a dark river behind a bright bank is kept, the live tile's crop `pipeline/tests/fixtures/rim-1980-z13-4689-2965.png` ends on a median grey of 79, not 63, and the view over a COG has its overviews on all four bands; S-P08-HAPPY-RIM-FADE).
    - **Measure an edge artefact against the picture's own level, along its whole ramp, and keep every derived band out of a view that something reads at a coarse scale.**
500. **The rim's fade, defined only as "darker than 65 % of the scene", took any dark ground touching the rim, and its band was a third shallower across a 45 degree edge.**
    - Seen: 2026-11-08, a review of c5766ba: a lake, a park or a shadow at grey 30 to 70 (scene 120) touching the black core was cut the whole band (measured 155 m); the band and the growth took side steps only, so perpendicular to a 45 degree edge they ended about 106 m in and a 200 m fade kept grey 54 there.
    - Cause: a dark pixel is not a fade pixel; a fade is a ramp that rises outward, a lake is flat. And `n` side steps reach `n / sqrt(2)` pixels across a diagonal edge.
    - Fix and pin: `tiles/rim.py` measures the band with a Euclidean distance transform (`edge_distance`) and grows the fade only where the dark pixels' profile still rises (`rising`: the mean grey of a pixel's distance shell over a 7 px window beats the shell two pixels nearer by `2 x RIM_RISE` and the next one nearer, or the next one farther beats it, so a grain's dip inside a fade is crossed), plus the fade's last dark pixel before the scene; a flat patch at grey 30, 50 or 70 loses at most two preview pixels past the core at 0, 18 and 45 degrees (12 px of a 60 m patch before), grain of 12 grey at most six; fades of 50 to 200 m at those angles keep nothing under 65 % of the scene within 150 m and are never cut past 150 m and a pixel; the live 1980 crop still ends on a median grey of 79 (`test_rim_profile.py`, S-P08-BAD-RIM-DARK-PATCH, S-P08-HAPPY-RIM-ANGLES).
    - **A threshold says how dark a pixel is, not what it is: an artefact with a shape (a ramp from the edge) is found by its shape, and a distance on a raster is Euclidean unless the test says it may not be.**
501. **The "photos near this year" chip floated beside the timeline, aligned to nothing, and no checker could see it.**
    - Seen: 2026-11-08, the owner's screenshot at 1568 × 711 with the Layers pane docked: the chip 72 px in from the map's edge, the timeline card centred about 300 px further in.
    - Cause: from 600 px the chip's inset was `gutter + 72px` from the map pane, the card's was the same but capped at 640 px and centred; they matched only while the map was narrower than 832 px. Held sideways the chip stood beside the menu button on the leading edge, the vertical timeline on the trailing one.
    - Found by: the owner; the tour's overlap, occlusion and gap checkers pass a control that touches nothing, and the unit tests only asserted the 8 px gaps.
    - Fix and pin: the chip takes the card's leading edge, `max(var(--hcm-gutter) + 72px, 50% - 320px)` (50 % of the same containing block), and docks beside the vertical card on a landscape phone (`kit-integration.test.ts`, S-V04-HAPPY-CHIP-ON-TIMELINE, S-V04-BAD-CHIP-NEVER-ALONE). CSS only: 17 bytes of the engine's gzip.
    - **A control that belongs to another must be tested for alignment to it (a shared edge), not only for the gaps around it: the layout checkers find overlaps, never a control aligned to nothing.**
502. **The selected year's pill hid its neighbours' labels, and no checker could tell.**
    - Seen: 2026-11-08, the owner's phone at about 360 px with twelve stops: the pill "1980" covered 1979 and 1982.
    - Cause: the 64 × 40 px pill sat over the rail from 4 to 44 px and the labels began at 38 px, 33 px apart: any neighbour nearer than half the pill plus half a label lay under it. The hidden label of the selected stop made it look deliberate.
    - Found by: the owner; the tour's occlusion check samples a text's centre against other *chrome*, and the pill and the labels are one element's shadow parts.
    - Fix and pin: lying, the labels are a row below the pill (20 px under the ticks); standing (phones held upright, the owner's other request that day), the years are the ruler in the pill's own lane, which the phone's height spaces wider than the pill (`kit-timeline-layout.test.ts` and S-V04-BAD-PILL-HIDES-NO-LABEL measure every label against the pill at every selected year, at 320 × 568, 375 × 812 and 915 × 412).
    - **A thumb that carries its value must be measured against the labels of the same control at every value: the layout checkers look between controls, never inside one.**
503. **Right to left, the timeline's stops and thumb sat a whole width beside their places.**
    - Seen: 2026-11-08, the review shots at 768 px with `dir="rtl"`: the 1966 tick 24 px inside the rail's end, the thumb beyond it.
    - Cause: `inset-inline-start: X%` with `transform: translateX(-50%)` centres only left to right: right to left the start is the right edge, and moving the box left by half its width moves it away from its place, not onto it. The pointer's share of the track was measured from the left edge too.
    - Found by: the review shots, then a unit test that compares the thumb's centre with its tick's; the tour runs no right-to-left locale.
    - Fix and pin: `--hcm-x` is -50 %, or 50 % under `:host(:dir(rtl))`, in every centring transform; `trackRatio` measures from the right edge right to left, and Left and Right step the way they point (`hcm-timeline.test.ts`, *rightToLeft…*).
    - **A transform is physical: wherever a box is placed with a logical inset and centred with a translate, the translate must flip with the direction.**
504. **On a 568 × 320 phone held sideways the chip sat on the map's centre and the open menu covered it.**
    - Seen: 2026-11-08, the review of track/yearchip at 568 × 320 (narrow and short, not a tour viewport): the generic checker's occlusion of the map at its centre point (284, 160) in every variant, and with the menu open "Distribuie" and "Despre" over the chip.
    - Cause: the lying card kept a free 72 px column on both sides although the menu button is only on the leading one, so the chip, 8 px above the card's trailing end, ended 88 px from the edge and crossed the middle of a 568 px map; the open menu, three columns of two at that height, ended 8 px above the card, the chip's own row.
    - Found by: the review's renders of every state at eight sizes; the unit tests and the tour measured 915 × 412 only among short windows.
    - Fix and pin: on a short window the card takes the trailing column too and the chip its trailing edge (`max(var(--hcm-gutter), 50% - 356px)`, ending at the gutter on a narrow one), and the menu's items end above the chip's row, kept free when no chip shows so the menu does not move (`kit-timeline-layout.test.ts`, *onANarrowShortPhone…* and the menu test at 568 × 320; S-V04-BAD-NARROW-SHORT-CHIP).
    - **A layout that changes with the window's height must be tested at the narrow and short corner too (568 × 320), not only at the short and wide one: the controls the width squeezes are the ones that meet.**
505. **Twenty-two years squeezed 17 px apart: the timeline never scrolled, so the pill hid its neighbours again.**
    - Seen: 2026-11-08, the review rendered a city of twenty-two stops: at 320 × 568 the pill covered a neighbour's label at every selected year, at 568 × 320 and 768 × 1024 the labels ran into one row.
    - Cause: the stops were shares of a card of fixed size, so more years only brought them closer; lesson 502's guarantee held for the owner's twelve stops only.
    - Found by: the review; every test used the owner's twelve stops.
    - Fix and pin: the track is at least 30 px per gap long (`--hcm-gaps`, set by the element) and the card scrolls (no scroll bar), the selected stop snapping into view (`scroll-snap-align: center`, not while a drag is on, which would move the track under the finger); `hcm-timeline.test.ts` (*many years*) and S-V04-BAD-MANY-YEARS-SCROLL at 320 × 568, 568 × 320 and 768 × 1024. The 157 bytes of gzip came from the CSS minifier (quotes of an attribute selector's identifier value, spaces inside parentheses, leading zeros: 50 bytes) and shorter CSS.
    - **A control laid out in shares of its box must be tested with more items than the fixture's: a guarantee measured on one city's data holds for that city only.**
506. **The zoom buttons took the engine's IIFE 385 bytes over its 125 KB budget on the first build.**
    - Seen: 2026-11-08, track/zoom: 125,385 bytes gzip with the two buttons, `zoomBy`, two texts per language and the group's styles (124,947 before, 53 left).
    - Found by: measuring the engine on the NUC the gate's way (`gzip.compress(data, 9, mtime=0)`) right after the first working version, as lesson 476 says.
    - Fix: no budget raised and no feature trimmed; the source map's bytes per file pointed at `packages/ui/src/theme/baseline.ts` (9.1 KB minified), whose 212 written-out token names gzip still paid for one by one. Splicing a compact form into the built IIFE measured 595 bytes before any source was edited; the source change saved 628 (DECISIONS-for-review.md §128b), leaving 34 once the tour's fixes were in.
    - **Before cutting a feature to fit a budget, rank the bundle's bytes per source file from its source map and look for data written out in full; measure each candidate by editing the built file, which costs seconds, then change the source.**
507. **The tour found the open menu over the zoom buttons, and the soft-disabled icon below 3:1.**
    - Seen: 2026-11-08, track/zoom, the viewer tour at `tour-x3840-*`: `viewer.menu-open` reported the menu's popup overlapping `div.dock.zoom`, and `viewer.zoom-at-limit` the dimmed Zoom in's icon at 2.06:1 (light) and 2.61:1 (high contrast). The unit tests passed: the kit doubles have no size and no colour.
    - Fix: the group is hidden while the menu is open; the contrast probe treats `aria-disabled="true"` as it treated `:disabled` (WCAG 1.4.11's inactive components; DECISIONS-for-review.md §128e). The same run's `aria-disabled="false"` expectations failed against the real kit, which leaves the attribute out when not soft-disabled: the specs now assert `not.toHaveAttribute('aria-disabled', 'true')`.
    - **A new floating control is checked against every popup that opens over its corner (the menu's open state included), and a new disabled look against the contrast probe, in the tour before the specs: the doubles of the unit tests cannot see either.**
508. **Zoom out stayed enabled where Mapbox would not zoom out any further.**
    - Seen: 2026-11-08, track/zoom, S-V52-BAD-ZOOM-AT-LIMIT at all five functional projects: a hash at `city.minZoom` (10) opened with Zoom out enabled: Mapbox had clamped the camera to where the city's `maxBounds` just cover the map (10.6 to 11.6 by window size), so `view.zoom` never reached 10.
    - Fix: Zoom out's limit is the higher of `minZoom` and that cover zoom, computed from the map container's box (DECISIONS-for-review.md §128f; `coverZoom` in `viewer-zoom.ts`, unit-tested against the measured values).
    - **A zoom range in the manifest is not the zoom range of the map: `maxBounds` raises the minimum with the window's size. A control that disables itself at a limit computes the limit the map applies.**
509. **A soft-disabled Zoom out still moved the map, and looked enabled in forced colours.**
    - Seen: 2026-11-08, the review of track/zoom: at 1440 x 900 with `#10/...` a click on the soft-disabled Zoom out flew to 10, Mapbox clamped it back after 22 to 26 `move` events and the address dropped the typed view; under `forcedColors: 'active'` the soft-disabled and the enabled button both computed `rgb(0, 0, 0)`, and the hover layer showed. The bad path passed: it compared the hash's zoom with the one after load, which Mapbox's clamp had already rewritten, and never counted moves or emulated forced colours.
    - Fix: the zoom group binds no click listener at a limit; `soft-disabled` gets `GrayText` in forced colours, no state layer and the default cursor (DECISIONS-for-review.md §128g). The spec now counts the maps' `move` events, compares the whole hash and the camera, and compares the two buttons' colours in forced colours; the unit tests force-click a soft-disabled button and read the forced-colours rule.
    - **An `aria-disabled` control ignores its press where the limit is known (the UI), not where a narrower limit is (the store), and gets every look a native disabled control gets for free: forced colours, the state layer, the cursor. Its bad path asserts no side effect at all (moves, the full address), not the one number it was about.**
510. **Restoring the minimized Layers pane left the focus on the page's body.**
    - Seen: 2026-11-08, track/settings, the first run of `hcm-layer-panel-minimize.test.ts`: after the rail's button restored the pane, `deepActiveElement()` was `body`.
    - Cause: the panel moved the focus in its own `updated()`, but its close button (`<hcm-icon-button>`) renders its inner `<button>` in its own first update, which runs after the parent's `updated()`: there was nothing tabbable yet, and the rail's button that had the focus was gone.
    - Found by: the Vitest that asserts the focus after minimize and after restore (the tour's Tab round would have caught it at 1920, 2560 and 3840 px only).
    - Fix and pin: the focus moves on `this.updateComplete.then(...)`, after the child's first render; the test asserts the close button's inner button has the focus.
    - **A focus move into a part that has just been rendered waits for that part's own render: a Lit parent's `updated()` runs before its new children have drawn anything. And 674 characters of CSS fallbacks weighed only 123 bytes gzip: measure a saving on the built bundle, never by its characters.**
511. **The minimized Layers pane came back open after the window left the extra-large layout, and its "Close" only minimized.**
    - Seen: 2026-11-09, the review of track/settings at 1920 × 1080: minimized, narrowed to 1200 px and widened again, the pane was open; its close button was named Închide / Close with no `aria-expanded`, though it never closed anything.
    - Cause: the state was the panel element's own (`minimized`), and the layout renders the leading pane only at extra-large, so leaving it destroyed the element and the state with it; the sheet frame's docked button was always the close.
    - Found by: review (a scripted Playwright walk at extra-large widths); no test left the layout and came back, and every test looked the button up by the name it had.
    - Fix and pin: the store keeps it (`layersHidden`, `setLayersHidden`, from the panel's `hcm-layers-minimize`; for the session, not in the hash) and the viewer binds `minimized` to it; the button is **Restrânge straturile** / **Collapse layers** with a chevron and `aria-expanded="true"` (`renderSheetFrame`'s `minimize`, the icon button's `expanded`). S-V03-BAD-MINIMIZE-SURVIVES-RESIZE, `hcm-map-viewer-minimize.test.ts`, `store-layers-hidden.test.ts`.
    - **State that must outlive a layout change lives in the store, never in an element the layout renders conditionally; and a control is named for what it does, with the ARIA state that says it.**
512. **Without its token fallbacks the viewer lost its focus rings under a city theme that does not set every token.**
    - Seen: 2026-11-09, track/settings' `tests` stage: `kit-integration.test.ts` found no focus ring on Mapbox's attribution toggle, and the lightbox scrim and the photo list's date of standalone element tests had no theme values.
    - Cause: the fallbacks went (DECISIONS-for-review.md §129c) on the proof that the baseline theme sets every token, but the viewer applied a city's theme instead of the baseline, and a manifest's token map may hold 1 to 200 names: the test city sets three, so `--md-sys-color-secondary` was unset and the ring's `outline` shorthand was invalid, which draws none.
    - Found by: the `tests` stage (the builder's run and again here).
    - Fix and pin: `withViewerBaseline` lays the city's tokens over the viewer's baseline, scheme by scheme (`viewer-baseline.test.ts`; the partial test theme now passes the ring checks); a standalone element test applies `VIEWER_BASELINE` itself, as the viewer would.
    - **Before dropping a fallback, prove the value is set on every path that reaches it: here the proof covered the baseline, not a city's theme.**
513. **A Playwright check of the photo sheet beside the minimized pane never saw it, though it was on screen.**
    - Seen: 2026-11-09, track/settings, `layers-minimize.spec.ts` (S-V03-BAD-MINIMIZE-KEEPS-VALUES) at `fn-l1440-ro`: `toBeVisible()` on `.pane.trailing hcm-photo-sheet` timed out with the sheet in the screenshot.
    - Cause: the sheet's host is `display: contents`, which has no box; Playwright looks for a visible child among the host's light-DOM children only, and the sheet draws everything in its shadow root.
    - Found by: the targeted Playwright run before the commit (the spec had not run since it was written).
    - Fix and pin: the spec asserts the sheet's heading (`photoHeading`), as `input.spec.ts` does.
    - **Assert what the visitor sees inside a `display: contents` element (a heading, a control), never the host itself.**
514. **A public visitor who clicked Contribute on the map saw the admin's sign-in: "Map administration", "Sign in with the Google account that administers the map."**
    - Seen: 2026-11-08, the owner on the live map (`/admin/#/contribute/bucharest`, signed out).
    - Cause: M13 made `#/contribute/<city>` a page of the admin app and made an account of no role a visitor once signed in (`contributing`), but the signed-out gate before it had one screen for every address: the admin's sign-in panel. Every Contribute test signed the stranger in first (`persona: 'stranger'`), so no test ever looked at that address signed out.
    - Found by: the owner, live.
    - Fix and pin: the address's welcome in the state (`packages/admin/src/app/welcome.ts`); `<hcm-sign-in>` shows a contributor's welcome on it in the map's language (the map's link now carries `?lang=` and the city's `name`), the tab says Contribute, Back to the map opens the city's map; the admin's sign-in stays on every other address (`welcome.test.ts`, `contribute-welcome.test.ts`, `e2e/admin/specs/roles/welcome.spec.ts`; S-A92-HAPPY-WELCOME, S-A92-HAPPY-WELCOME-SIGN-IN, S-A92-BAD-NO-ADMIN-SIGN-IN, S-A92-BAD-ADMIN-ROUTE).
    - **A page meant for the public reached through an app's gate must be tested signed out too: walk every public entry point as a stranger who has not signed in yet, and assert the gate's words are the visitor's, not the staff's.**
515. **The Contribute page welcomed a signed-out visitor, but every other state of it still spoke to an admin.**
    - Seen: 2026-11-09, a review of 81281098 (track/contribute).
    - Cause: the welcome replaced one screen, the signed-out panel, while the auth controller's other branches knew nothing of the page: a server that did not answer sent the visitor to the start-up mode (the setup intro, the Cloud consent, Google's owner check, `notOwner`), a busy server showed the blocked panel's "Map administration" and "Use another Google account", a refused session called `notAdmin` ("does not administer this map") and signed the account out, a map without an owner offered the claim, its loading text spoke of owning the project, and the account menu's statistics line named the administration.
    - Found by: the review, reading every branch of `controller.ts` against the page's address.
    - Fix and pin: the controller asks `contributing()` at each branch (no Cloud scope at sign-in; no server: `backendDown`, or `contributeClosed` for a start-up deploy; a session failure: `backendDown` with its reason; no owner: `contributeClosed`); `<hcm-blocked-panel>` on the page's address speaks to a contributor ("The map is resting", "not open yet", Back to the map), the loading screen never says the owner's check, the menu's line names the Contribute page (`controller-contribute.test.ts`, `contribute-blocked.test.ts`, `e2e/admin/specs/roles/welcome.spec.ts`; S-A92-BAD-CONTRIBUTE-NO-SERVER, S-A92-BAD-CONTRIBUTE-BUSY, S-A92-BAD-CONTRIBUTE-SESSION).
    - **When a public page shares a staff app's gate, fixing the one screen that was seen is not enough: walk the gate's state machine branch by branch (server down, busy, refused, unconfigured, loading) with the public address open, and give each a public row.**
516. **A historical layer switched on in the Layers panel did not show unless the timeline already sat on its year.**
    - Seen: the owner on the live map, 2026-11-09: with the timeline on one layer's year, switching another year's layer on changed nothing on the map.
    - Cause: the switch changed only the layer's visibility. The timeline (the year whose layers, photos and POIs the map shows) stayed on its stop, and the map stacked the rasters by the admin's `order`, so a layer of another year could draw under the timeline's own, opaque one.
    - Found by: the owner. Fix: a layer switched on moves the timeline to its year (`withLayerYear`, `packages/engine/src/core/state.ts`), and the map stacks the layers by date, the newest on top (`rasterSpec`'s `order` is the year); `store-layer-year.test.ts` and S-V03-BAD-LAYER-OF-ANOTHER-YEAR (DECISIONS-for-review.md §133).
    - **A control that shows something must leave the state that decides what shows (here the timeline) agreeing with it; test the switch from a stop other than the one it belongs to.**
517. **Two "Harta din …" chips side by side wrapped on a 360 px phone and their touch targets shrank to 44 px.**
    - Seen: 2026-11-09, the tour's `photo-map-year` state at c360 (`[target-size] "Harta din 1980" … is a 157x44 touch target`).
    - Cause: the chips sat inline in one paragraph; two did not fit one line, and the wrapped line stood closer than a 48 px target allows.
    - Found by: the tour's target-size checker. Fix: the chips stand one under another in a `section` of the sheet (`.details section`: a column with an 8 px gap), no new CSS (DECISIONS-for-review.md §133e).
    - **Buttons that may wrap need a gap of their own; check a new row of buttons at the narrowest window.**
518. **An owner's "permission" with nobody named would have made the whole archive's report invalid.**
    - Seen: 2026-11-09, building M20's core: the scan's report prefilled `licence: 'permission'`, `state: 'clear'` from the owner's sidecar for the IPB sheets, and the server's `rightsSchema` refuses a permission without `confirmedBy`, so `worker.archiveReport` would have refused the report of every series at once.
    - Cause: the Python twin of the rights record had no `confirmedBy` and no rule for a permission nobody granted; the schema's refinement lived only in TypeScript.
    - Fix and pin: the sidecar takes `confirmedBy`; `report.rights_of` reads a permission with no one named as `unknown`, *needs confirmation* (`PERMISSION_NOTE`), and keeps a copyright mark *do not publish* unless a permission is named (`test_archive_classify.py`, S-P20-BAD-SIDECAR).
    - **A cross-field rule a schema refines in one language must have its twin, and a test, on the side that writes the record.**
519. **Two tracks took the same scenario behaviour id the same day.**
    - Seen: 2026-11-09: M20's rows were first written as `S-A101-*`; `track/blocks` and `track/favicon` had already used `A101` for their own behaviours.
    - Cause: every track picks "the next free id" from its own base commit, and the merges renumber decisions and lessons but not scenario ids.
    - Fix: M20 uses `A120` and `P20` (its milestone's number); a row's id was grepped across every worktree before it was written.
    - **Pick a scenario id that names the milestone, and check the other worktrees before writing one.**
520. **`subprocess` for a sandboxed probe fails bandit; a spawned `multiprocessing` child is the repository's way.**
    - Seen: 2026-11-09, `pipeline-bandit` on the archive's probe (B404, B603).
    - Fix: `archive/probe.py` spawns `probe.child_main` (never forked), which sets GDAL's local-only options, limits itself (`RLIMIT_AS`, `RLIMIT_CPU`) and sends one JSON record over a pipe; a timeout, a death before the answer (`EOFError`) or a bad answer is an `unreadable` row (`test_archive_store.py`, `test_archive_intake.py`, S-P20-BAD-PROBE-CRASH), as `matcher/serve.py` already spawns its child.
    - **Reach for the pattern the repository already proved under its gates before adding a new kind of process.**
521. **One optional field in the manifest's strict schema cost the engine 40 bytes it did not have.**
    - Seen: 2026-11-09, the `build` stage of track/archive: with M20's `layer.rights?` (a strict object of a licence enum, an author and a source) `engine.iife.js` measured 125,040 bytes gzip against its 125,000 budget.
    - Cause: the engine validates the whole manifest with the shared schema, so every field of `layerSchema` ships in the viewer, read or not.
    - Fix: the field stays on the layer document (`layerRightsSchema`, `imagery-archive.ts`) and out of the manifest; the credit reaches the visitor through `attribution`; the manifest field waits for viewer bytes (DECISIONS §134c).
    - **A manifest field is engine bytes: build and measure before promising one, and keep server-only data on the server's own document.**
522. **The pipeline's own GDAL settings hid every world file from the georeferenced path.**
    - Seen: 2026-11-09, track/archive's paths: a Stereo 70 test map with a `.tfw` and no `.prj` opened with no geotransform under the test configuration, though it opened with one in a bare script.
    - Cause: `rasters.DEFAULT_SETTINGS` sets `GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR` (no folder listing on open), so GDAL never looks for a sidecar world file.
    - Fix and pin: `placing/embedded.py` reads the world file itself (`world_file`, six numbers, the centre of the top-left pixel) and warps by its four corners when the file's own tags have no placement (`test_placing_embedded.py`, S-P20-HAPPY-EMBEDDED).
    - **A setting that keeps GDAL off the network also keeps it off the file's neighbours: read sidecars yourself.**
523. **A two-point similarity could not fit scan pixels to Mercator metres, so every RANSAC sample was wrong.**
    - Seen: 2026-11-09, the drawn-map path's first fine fits: 262 of 559 pairs agreed with the coarse placement, and the RANSAC similarity refitted on them agreed with none.
    - Cause: pixels run down and Mercator metres run up, a reflection; the Umeyama similarity is reflection-free by design.
    - Fix and pin: `placing/geometry.similarity(..., flipped=True)` fits on (x, -y) and composes the flip; RANSAC keeps the handedness of the placement it starts from, and that placement competes as one more round (`test_placing_parts.py`).
    - **Write down the handedness of every transform between pixel and ground coordinates before fitting one.**
524. **The chamfer score alone placed a street-grid map one block over, and a few chance pairs then "held".**
    - Seen: 2026-11-09, synthetic towns: the best chamfer peak was 1.5 km off while the third was 11 m off; an 18-pair affine on the wrong peak passed 12 inliers, 5 checks and no gross check.
    - Cause: a regular street pattern scores almost as well shifted by a block, and nearest-junction checks always find a neighbour within 100 m in a dense city.
    - Fix and pin: the coarse search keeps three placements far apart, the fine fit runs on each, the one with most agreeing pairs wins and holds only when the runner-up has at most half as many (M9's rival share) and its pairs are at least 20 % of the junctions (`placing/single.py`, `placing/fine.py`; S-P20-BAD-OTHER-CITY).
    - **Choose between placements by the evidence the fit uses, never by the coarse score; a fit's share of the data is as much a gate as its count.**
525. **An 8-connected skeleton's staircase is full of "junctions".**
    - Seen: 2026-11-09: the drawn maps' junctions matched OpenStreetMap's for only 37 % of them under the true placement.
    - Cause: a pixel with three skeleton neighbours is a junction by count, and every diagonal step has three.
    - Fix and pin: a junction is a crossing number (empty-to-set turns around the eight neighbours) of three or more, clusters within a street's width merged, and on a line plan only the skeleton within 2.5 street half-widths of ink counts (block interiors are paper too) (`placing/streets.py`, S-P20-HAPPY-STREETS).
    - **Count branches by transitions around the pixel, not by neighbours.**
526. **A synthetic map drawn with no margin came out blank, and an Otsu split read the dark class as paper.**
    - Seen: 2026-11-09, the assembly tests: every page of an atlas drawn with `margin_px=0` was white, and every edge profile was zero.
    - Cause: `image[-margin:]` with a margin of 0 is the whole image; and `strip < threshold` misses the class Otsu puts at the threshold itself.
    - Fix: the margin is drawn only when there is one (`tests/synthetic/town.py`); edge profiles compare grey levels, not a thresholded ink mask (`placing/assemble.py`).
    - **A negative slice of zero is everything: guard every `-n:` whose n may be 0.**
527. **The core's archive versions could not be read by the pipeline at all: Python's version origins missed `archive`.**
    - Seen: 2026-11-09, the first local dry run of an `archive-series` job: `Version.of` raised "origin must be one of crop, join, regeoref, upload, usgs".
    - Cause: M20's core added `archive` to `VERSION_ORIGINS` in `@hcm/shared` only; the Python copy in `documents.py` had no parity test, and the core's step tests built versions that kept the seed's `usgs` origin.
    - Fix and pin: `archive` added; `VERSION_ORIGINS` joins `pipeline/tests/contracts/enums.json`, held equal by `test_contract.py` and `pipeline-contract.test.ts`.
    - **Every enum a Python reader checks belongs in the parity contract, and a new job type's test must read the version its server writes.**
528. **A chamfer score that is a plain mean prefers the densest part of the reference over the true place.**
    - Seen: 2026-11-09, synthetic towns: after a change to the skeleton's pruning, the true placement of a map at 5.2 m a pixel fell out of the six best chamfer peaks; every peak scored about 0.78.
    - Cause: the mean closeness under the template is high wherever the reference has many streets, so a shifted placement inside the town scores almost as well as the true one, and small changes reorder them.
    - Fix and pin: the template is correlated zero-mean (`cv2.TM_CCOEFF`, divided by its point count): the score is the closeness on the map's lines less what the same window gives on average; the true placement became the first candidate in every style tried (`placing/coarse.py`; S-P20-HAPPY-MATCH).
    - **Score a match against what chance gives in the same window, never in absolute terms.**
529. **An archive series' version page showed no place for its job: the worker feed's list of pipeline job types missed `archive-series`.**
    - Seen: 2026-11-09, building M20's admin: the version page of a series waiting for its day said nothing of where it would run, as for a job the pipeline does not run.
    - Cause: `PIPELINE_TYPES` in `packages/admin/src/worker/feed.ts` is a hand-kept list; M20's core added the job type to the shared contracts only.
    - Fix and pin: `archive-series` added; `packages/admin/test/worker/feed.test.ts` reads an archive series' place and its `daily` wait.
    - **A new job type the pipeline runs joins every hand-kept list of them in the same change: search for an existing type's name (`'layer-tiles'`).**
530. **The owner's sidecar applied only its deepest entry, so 4,545 sheets lost their folder's rights and credit.**
    - Seen: 2026-11-09, the review of track/archive: every IPB 1:500 sheet matched `Bucuresti actual 1_500` (year and zoom only), so the parent folder's permission and Idei Urbane credit never reached it; the report said `unknown`, `needs-confirmation`, no source.
    - Cause: `Sidecar.entry_for` took the longest matching path, like a router, while the owner writes the sidecar like a folder tree: rights on the folder, a year on the sub-folder.
    - Fix and pin: every matching entry merges from the root down, a deeper key overriding (`archive/sidecar.py`); `test_happy_path_the_owners_sidecar_states_what_detection_cannot` reads a root credit, a folder's rights and a sub-folder's year on one sheet (S-P20-HAPPY-REPORT).
    - **Declarations keyed by folder inherit down the tree; test a key set on a parent and read on a grandchild.**
531. **The import trusted the rights the browser sent, so "confirm the rights" was enforced only by the page.**
    - Seen: 2026-11-09, the review of track/archive: `imagery.archiveImport` stored `choice.rights` as sent; `{licence: 'PD', state: 'clear'}` with no `confirmedBy` passed, and the layer could then publish itself.
    - Cause: the callable treated the owner's edits as data to keep, not as a claim to check; `rightsSchema` only requires `confirmedBy` for a permission.
    - Fix and pin: the server starts from the stored report's rights; rights sent with a series are a confirmation, accepted only from the city's owner with `confirmedBy`, and only their licence, state and words are taken (`functions/src/imagery/archive-import.ts`; S-A121-BAD-RIGHTS-FORGED).
    - **Anything that lets content publish is derived on the server; what the browser sends is a request to change it, checked by role.**
532. **A module the engine never uses cost its IIFE 19 bytes because the package's index re-exported it with `export *`.**
    - Seen: 2026-11-09, merging track/archive into feat/engine-rewrite: 125,009 bytes gzip against 125,000, though no line of `imagery-archive.ts` reached the engine (stubbing every part of it changed nothing).
    - Found by: building the engine with one change at a time on the NUC (`git stash`, then a `sed` per experiment): deleting the index's star line, or naming its exports, measured 124,990; a star-exported barrel of named exports did not.
    - Fix: `packages/shared/src/index.ts` names `imagery-archive.ts`'s runtime exports and re-exports its types with `export type *`, and `api/index.ts` names `api/archive.ts`'s (DECISIONS-for-review.md §137j).
    - **When the engine grows with no source of its own changing, bisect the package index's `export *` lines: a star re-export can cost bytes even when tree-shaking drops the module's code.**
533. **A join failed live because a frame the owner approved while it waited counted as "ended", and the old join's retry said the same of a frame a newer join had taken.**
    - Seen: live 2026-11-09: 1980 (A038 published, A039 awaiting approval) "Frame D3C1216-100235A039 ended; import or retry it", and 2 Feb 1972 "Two of these frames are already published: delete one layer first".
    - Cause, proved by tests that failed first (`join.test.ts`, `join-parts.test.ts`, `retry.test.ts`): `partGone` treated a frame published as any layer but the join's as gone, the transaction refused a frame the policy had approved, `publishedFrame` refused two, and a frame stamped by a newer join answered the same `joinPartGone` as one whose versions all ended.
    - Fix: §138a–c (M8 §18): any usable version serves, the joined layer retires the others when it publishes, `joinPartTaken` is its own, not retryable, code.
    - **A refusal names the one condition that caused it. "Ended" for three different states sent the owner to the wrong fix.**
534. **Two archive tests used scenario ids a docstring and a registry row already held, and a docstring's explanation was read as ids.**
    - Seen: 2026-11-09, `check_e2e_matrix.py write` on track/batch4: "S-P20-HAPPY-GRID-NAMES: registered 2 times", and `streets`, `the`, `waits` "named but not registered".
    - Cause: `Scenarios:` takes every word after it as an id, and an id was reused for a new behaviour.
    - Fix: the explanation went into a comment, the new row is `S-P20-HAPPY-GRID-BY-NAMES`.
    - **Grep the registry for an id before adding it, and keep a `Scenarios:` line to ids only.**
535. **Two KH-4A Corona strips of 1966 found no vote and parked with a crop of the whole strip.**
    - Seen: 2026-11-09, the live 1966-08-18 frames F046 and F047 ended `locate` with `not proved (no-votes): crop 137350 x 9288 px`.
    - Found by: the owner's import of the 1964 and 1966 coverage; no test held a strip whose corners make no parallelogram, and every synthetic frame was a rectangle on the ground.
    - Fix and pin: `calibrate/strip.py` (docs/research/M9-calibration.md §16): a Corona strip is searched in a window of the city plus 15 km along it, under a local map linear along the footprint's long edges, each end in turn; a footprint off the city slides windows. `S-P06-HAPPY-STRIP-WINDOW`, `S-P06-BAD-STRIP-NO-PLACE`.
    - **A homography through four corners bends a long strip as a perspective would: fit a long frame locally, where the city is, and never crop the union of orientations that put the city at opposite ends.**
536. **"Every dataset fails" named the three declassified datasets, so adding Landsat turned a USGS outage into a partial harvest.**
    - Seen: 2026-11-09, track/landsat: with `USGS_DATASETS` grown to five, `search.test.ts`'s "every dataset in maintenance" and `tick.test.ts`'s back-off failed: the fake answered the two Landsat datasets with no scenes, so the harvest reported "found 0" instead of `apiError.usgs.maintenance`.
    - Cause: the tests listed `['corona2', 'declassii', 'declassiii']` where they meant "every dataset"; the code was right (it fails only when every requested dataset failed).
    - Fix and pin: the tests loop over `USGS_DATASETS` (`functions/test/imagery/search.test.ts`, `tick.test.ts`); the fake answers Landsat's scenes only once a spec asks (`usgs.landsatScenes`), so no other spec's counts move.
    - **A test that means "all of a list" iterates the list's constant, never a copy of today's members.**
537. **A Landsat scene's cloud reason was the fourth of its reasons, so its card never said why it ranked low.**
    - Seen: 2026-11-09, writing `S-A130-BAD-CLOUDY`: a 35 % cloudy scene contributes only 3 of the cloud part's 10 points, behind free, coverage and "no layers yet", and a card shows three reasons.
    - Fix and pin: a Landsat scene over the tick's 20 % cap, and one out of the leaf-on months, list their cloud or season reason first (`always`, `packages/shared/src/imagery/ranking.ts`; `RANKING_VERSION` 4).
    - **When a new kind of item is ranked by an old score, check which reason its card shows first, not only its place in the list.**
538. **One new import from the shared core renamed the core's exports, and a chunk that did not change outgrew its budget.**
    - Seen: 2026-11-09, track/landsat: `join-card` measured 3,027 bytes gzip against 3,000 with the same 8,449 raw bytes as before (2,991): the approval card's new `landsatClear` was one more export of `admin-core`, every later export's short name moved one letter, and the join card's imports (`Dr as e` became `Or as t`) renamed its locals and compressed worse.
    - Found by: building the base commit beside the branch on the NUC and comparing the chunk's first bytes, then dropping one import at a time.
    - Fix and pin: the verdict lives in `packages/shared/src/schemas/landsat-verdict.ts`, which imports nothing at run time, so it travels in the approval chunk alone; the scene list derives its chips from `USGS_DATASETS` rather than importing two more lists. The budget is not raised (DECISIONS-for-review.md §138g).
    - **When a chunk's gzip grows with its raw bytes unchanged, look at its import names: a new export of a shared chunk renames everything after it.**
539. **A Landsat product id, 40 characters with no space, pushed the scene list sideways on a phone.**
    - Seen: 2026-11-09, the first run of `landsat.spec.ts`: the tour's checker found the list pane 15 px too wide at 360 px (`imagery.results-landsat`), and at the laptop's list beside a version.
    - Cause: the scene row's text column was `1fr` (its minimum the longest word) and the declassified ids were short enough to fit.
    - Fix and pin: the column is `minmax(0, 1fr)` and the row's details wrap anywhere (`packages/ui/src/admin/imagery/imagery-styles.ts`); the two Landsat tour states pass the checkers.
    - **A new data source brings new string shapes: run the layout checkers on its rows at the phone's width before trusting the old ones.**

540. **Every archive series failed on the owner's computer: "the pipeline does not run archive-series jobs".**
    - Seen: 2026-11-09, the first real import of `harti.zip`: 4 series failed at once on the worker, before any step ran.
    - Cause: the M20 merge registered the series' steps in `contract.py` but not its params in `model.py`'s `_PARAMS`, which the runner checks first; the steps' own tests built their contexts directly and never went through `params_of`.
    - Fix and pin: `ArchiveSeriesParams` in `pipeline/src/hcm_pipeline/model.py`, with a happy and two bad rows in `tests/unit/test_model.py`.
    - **A new job type is three registrations (the steps, the params, the server's job writer): test it once through the runner's own entry, not only step by step.**

541. **The four failed archive series could not be retried once the worker was updated: no Retry, and a banner with a literal "{count}".**
    - Seen: 2026-11-09, after lesson 540's fix: the jobs had failed three times on the old image (`apiError.invalidRequest`, "the pipeline does not run archive-series jobs"), so `attempt` was `JOB_MAX_ATTEMPTS` and the Jobs page offered nothing; they were titled "Job", and the error read "problems found: {count}".
    - Cause: the runner reported a type its image did not know as an invalid job, which spends attempts like any failure; the worker claimed every pipeline type whatever its image ran; `translateApiError` left a placeholder visible when the pipeline gave no params; the Jobs page had no title for `archive-series`.
    - Fix and pin: the pipeline fails an unknown type `apiError.imagery.pipelineOutdated` (`OutdatedJobError`), and the worker names `RUN_JOB_TYPES` in its claim so the server leaves other types queued; `failedOutdated` (`@hcm/shared`) lets `jobRetryable` and `imagery.retry` retry such a failure (the legacy text included) whatever the count, with `attempt` back to 0; an aside whose placeholder has no value is dropped; `archive-series` reads "Archive import". S-A12-HAPPY-RETRY-OUTDATED, S-A12-BAD-RETRY-EXHAUSTED. The bad row's first run found the Jobs page offering Retry on any exhausted import: `jobRetryable` took a listed `guard` step as reached, though the pipeline lists every step `pending` from the start; a pending guard now counts as not reached.
    - **A failure caused by the runner, not the job, must not spend the job's attempts: give it its own code, and keep the runner from claiming what it cannot run.**

542. **31 archive series sat "Waiting for a later day" while the owner's computer was idle.**
    - Seen: 2026-11-09, `harti.zip`: the import started today's share (10 a day) and held the rest `daily`, so the whole archive would have taken four days on a computer that runs them free.
    - Cause: M20 counted a local-only series against the daily cap, a spend guard meant for Cloud Run and new cloud layers; the plan proposed it and nobody revisited it once the series ran only on the owner's computer.
    - Fix and pin: `countsSince` (`functions/src/imagery/limits.ts`) never counts a `localOnly` job; `imagery.archiveImport` starts every series at once; `releaseDaily` frees a local-only job whatever the share, so the held series go at the next tick; the report's total no longer counts days. S-A121-HAPPY-LOCAL-UNCAPPED, S-A121-BAD-DAILY-SPLITS.
    - **A cap is for the cost it guards: work that costs the project nothing must not wait behind it.**

543. **An archive series waiting for points opened a georeferencer with "The scan cannot be shown" and "No reference image".**
    - Seen: 2026-11-09, the owner's screenshot of `1895-1899` (pieces) in the georeferencer; its panes were also too small to work in.
    - Cause: an archive series is many scans, so M20 parked it with `help` only (`requiredOf`): no `scan`, no `reference`; the georeferencer reads exactly those two, and Locate again was offered to USGS frames only, so a parked series could not be made again.
    - Fix and pin: a parked series' stitched picture is also its `scan` and the city window's OpenStreetMap lines its `reference` (`placing/stitched.py`, `test_placing_assemble.py`); Locate again places an archive series again from `place` (`locate-again-archive.test.ts`); the panes take 70 % of the window, with Full screen (`georeferencer.spec.ts`, S-A122-*).
    - **A new kind of version that can wait for points must carry what every screen that opens a waiting version reads: test it by opening that screen, not by the version's schema alone.**

544. **An archive series the owner placed by hand parked again with "The map states no scale…".**
    - Seen: 2026-11-10, version `ar-mw993zri-s-e4d5974e8c85`: the owner placed pairs on the stitched picture and clicked Save and georeference; the job resumed and parked again.
    - Cause: `imagery.saveGcps` wrote the pairs as the version's `georef` and reset a `georef` step the archive job does not have; the runner re-ran `place` (left pending by the wait), whose class placer never read `georef` and failed as before.
    - Fix and pin: `place` warps a series from the owner's pairs when the version carries them (`placing/owner.py`: the pairs scaled from the scan to `stitched.tif`, a lattice through the fit, `warped.tif` at the series' `maxzoom`, `archive.method: 'gcps'`); too few pairs park it again with its help kept; `saveGcps` resets `place` for an archive series (`test_placing_owner.py`, `save-gcps.test.ts`, S-P20-HAPPY-OWNER-PAIRS, S-P20-BAD-OWNER-PAIRS-FEW).
    - **A wait for a person must be answered by the step that waited: test the resume path from the save to the step's result, not the save alone.**

545. **Georeferencer pair numbers on the map vanished below zoom 16.**
    - Seen: 2026-11-11, after §141 put pair numbers on the map via `addVectorOverlay(..., kind: 'poi')`.
    - Cause: `pois.ts` hides POI `title` below `POI_LABEL_MIN_ZOOM` (16); the georeferencer opens at zoom 13, so badges showed a `place`/`flag` icon with no number, unlike the scan's numbered discs. Checkpoints and selection also differed.
    - Fix and pin: shared `marker-badge.ts` painters; map canvas overlay (`marker-overlay.ts`); DECISIONS §143; S-A16-HAPPY asserts marker parity.

546. **Published Post 1847 line-art looked almost transparent on the public map.**
    - Seen: 2026-11-11, layer `post-1847-ante-1852` after Approve (own tiles, `paperTransparent`).
    - Cause: `lineart` used nearest only at the deepest zoom; overview levels averaged RGBA, so ink alpha washed toward transparent at city zooms. Layer opacity 0.85 was fine; the tiles themselves were soft.
    - Fix and pin: `ENCODINGS["lineart"].overview_resampling = "nearest"` (`tiles/encoding.py`); `write_tree` passes `overview-resampling`; live archive repaired as `…-fix1.pmtiles` and pointed from `cities/bucharest/manifest.json` plus the Firestore layer `source.url` (cache-bust past the prior one-year `Cache-Control`). Soft alpha on content tiles: 0 %. Regression: `test_lineart_tiles.py` — nearest keeps soft alpha at 0 % at every zoom; the same source with `average` washes above 5 % (`S-P20-BAD-LINEART-AVERAGE`).
    - **Line art with transparent paper must never average alpha across pyramid levels: nearest at every zoom, pin it with a tile that fails under average, and a live overwrite needs a new object name when the old one was cached for a year.**

547. **Georeferencer Undo only lasted one or a few steps with many pairs.**
    - Seen: 2026-11-12, owner: Undo does not keep 50 commands.
    - Cause: Terra Draw's settle emits every point; `GeorefMap.#changed` called `moved` for each, so one drag wrote one Undo step per pair and filled `UNDO_DEPTH` (50) after a couple of moves. The Undo button also keyed off `dirty` instead of history depth.
    - Fix and pin: only a place that actually moved is an edit (`#movedFeature`); `#edit` ignores no-ops; `canUndo` drives the button; Save clears history; fifty move/undo cycle in `georef.test.ts`.
    - **A settle that lists every feature must not turn unchanged neighbours into Undo steps.**

548. **Georef published lattice/terrain Vitest timed out under a full `tests` run.**
    - Seen: 2026-11-12, `georef-published.test.ts` lattice and terrain happy paths at Vitest's 5 s while the suite was busy; alone they finish in ~0.5 s.
    - Cause: opening a camera lattice (17×17) and warping under load exceeds the default; the assertions were fine.
    - Fix and pin: those two `it`s take 20 s (`georef-published.test.ts`).
    - **A test that is fine idle and times out only under the suite needs the suite's timeout, not a weaker assertion.**

549. **Georef coverage: Node canvas mock `??` hid null context; pinch null-guards stayed uncovered.**
    - Seen: 2026-11-12, `PIPELINE_STAGE=tests` blocked on `marker-overlay.ts` / `hcm-scan-viewer.ts` branch floors while shipping the 1847 lineart fix.
    - Cause: `host({ context: null })` used `options.context ?? context2d()`, so the null-context paint path never ran; pinch helpers kept `if (pair === null) return` after the caller already required two pointers, which v8 never marks covered. `FakeMap.project` also needs `mounted = true` or every badge paint skips.
    - Fix and pin: `'context' in options` for the mock; pinch takes a typed `[Point, Point]` once size ≥ 2; scan tests cover zero-size centre, coincident fingers and a lone finger after pinch; overview_find mid-size JPEG probe and series-root edges (`testing_strategy_skill.md` gotchas).
    - **A mock option of `null` must not be written with `??`; a guard the caller already made impossible is an uncovered branch forever—remove it or hit it from outside.**

550. **Grid/overview branch floors missed the wait-overview path and ORB early returns.**
    - Seen: 2026-11-12, `PIPELINE_STAGE=tests` blocked on `placing/grid.py` (80.8% branches) and `placing/overview.py` (84.1%).
    - Cause: waiting grids always fell through to the name mosaic (no overview canvas success/fail); ORB helpers never hit `des_o is None`, few keypoints, `hint is None`, a hint that empties matches, or an out-of-range sheet number.
    - Fix and pin: unit tests drive `_wait_picture` / `_overview_picture` with a stubbed overview, clear city bounds for `_placed`, and call the overview guards directly (`test_placing_grid.py`, `test_placing_overview.py`).
    - **A preferred alternate path that production rarely takes still needs both its success and its `None` return covered, or the branch floor fails.**

551. **Georef badges briefly put the engine over its IIFE gzip budget.**
    - Seen: 2026-11-12, `bundle-budget`: `engine.iife.js` 125.1 KB (budget 125) and `georef` 19.2 KB (budget 19) after map canvas badges / pinch / undo.
    - Cause: `MapPort.project` / `unproject` lived on the shared Mapbox adapter (IIFE inlines it); georef also kept dead POI-overlay exports and the new painters exceeded 19 KB in one chunk.
    - Fix and pin: admin-only `withMapProjection`; drop dead overlay exports; `georef-badges` named chunk (5 KB) for painters + map overlay so `georef` stays 19; shorter Map labels copy; DECISIONS §146. No existing budget raised.
    - **Admin-only map helpers belong beside `ViewerMapPort`, not on shared `MapPort`, or the public engine pays for them in the IIFE.**

552. **Approve stranded on `rights.state === 'needs-confirmation'` with no Confirm on the version.**
    - Seen: 2026-11-12, live archive version `ar-mw993zri-s-83618d0c24e6` (IPB) waiting for approval: Approve → `apiError.imagery.rightsUnconfirmed`; rights had been cleared once by hand, but the product had no path after Import.
    - Cause: M20 confirmed rights only in `imagery.archiveImport` (and the scan report). A version already `awaiting_approval` with `needs-confirmation` had no callable or approval-card control, so Approve stayed refused forever.
    - Fix and pin: `imagery.confirmRights` (`cityOwner`); VersionView rights summary; approval card Confirm + Approve disabled until `rightsAllowPublish`; DECISIONS §148; S-A120-HAPPY-CONFIRM-RIGHTS / S-A120-BAD-CONFIRM-*.
    - **A publish gate that only the owner can clear needs a Confirm on the surface where Approve lives, not only at Import.**
553. **Georeferencer Second-order polynomial refused sets affine still fitted.**
    - Seen: 2026-11-12, owner: "Second-order polynomial (at least 6 pairs)" broken on `#/georef` (DECISIONS §144).
    - Cause: TypeScript fitted the poly2 place→pixel map on the pairs alone. A quadratic has no quadratic inverse, so well-spread scan pixels whose places lay on two lines made the reverse design singular and `fitTransform('poly2')` returned `degenerate` while the pipeline's `_inverse_grid` (15×15 forward samples) still fitted. Pairs on only two scan rows stay singular in the forward design.
    - Fix and pin: `poly2Fitter` samples the forward map for the inverse (`POLY2_INVERSE_GRID`); S-A16-HAPPY-POLY2-GRID-INVERSE / S-A16-BAD-POLY2-TWO-ROWS.
    - **When a model has no inverse in its own class, build the reverse from samples of the forward map, not from the control pairs alone.**

554. **Hosting-only admin deploy wiped `/admin/install/` and broke Update the map.**
    - Seen: 2026-11-12 overnight: after shipping 1847/georef/confirmRights via Hosting without `build:install`, `https://…/admin/install/<slug>/manifest.json` returned the admin SPA HTML; Cloud Build fetch for Update/Install could not read the bundle. Installed release stayed `1.0.0+adbb1af` while Hosting said `1.0.0+3897359`.
    - Cause: Firebase Hosting's `/admin/**` rewrite serves `index.html` when the install files are absent from the uploaded tree. A fast Hosting upload of `dist/hosting` built with only `build:hosting` (or a stripped tree) replaces the previous release's install folder.
    - Fix and pin: always `build:hosting && build:install` before Hosting deploy; DECISIONS §149; restored `1-0-0-3897359` and re-ran Update builds.
    - **Never deploy Hosting without the install bundle; check `/admin/install/<slug>/manifest.json` is JSON before calling the ship done.**

555. **Post 1847 stayed see-through after nearest overviews: transparent paper was the real bug.**
    - Seen: 2026-11-12, live `post-1847-ante-1852` still see-through after `…-fix1.pmtiles` (lesson 546 nearest pin).
    - Cause: `paperTransparent` defaulted on for line art (`params.get(...) is not False`), so paper alpha was 0 and the basemap showed through. Soft overview alpha was a second problem; opaque white paper is what the owner wanted.
    - Fix and pin: default off; `paper_opaque` in the pyramid; live `…-fix2.pmtiles` + manifest/Firestore URL; DECISIONS §150; `S-P20-HAPPY-ENCODING`.
    - **A see-through plan needs opaque white paper by default; transparent paper is an opt-in overlay, not the product default.**

556. **Post 1847 got a black frame once its paper was opaque.**
    - Seen: 2026-11-12, owner screenshot: the rotated 1847 plan sat in a black rectangle after `…-fix2.pmtiles`.
    - Cause: the export's COG is one grey band with its alpha kept as an internal mask; the line-art encoder read alpha only from a second band, so a one-band source was all opaque and the black outside the warp became ink.
    - Fix and pin: `_alpha_rows` reads the band's mask (`GetMaskBand`) for a one-band source; `S-P20-BAD-ENCODING-MASK`. Live: the source raster was gone, so `…-fix3.pmtiles` cleared outside the paper's convex hull; manifest and Firestore point to it.
    - **A one-band raster's edge lives in its mask; read the mask band, never assume all opaque.**

557. **Bucuresti actual could not be deleted: a query on a field exempt from indexing.**
    - Seen: 2026-11-12, owner: Delete on the `bucuresti-actual-1-500` layer ended in "Something went wrong on the server"; the log said `FAILED_PRECONDITION: The query requires a COLLECTION_ASC index for collection jobs and field params.layerId`.
    - Cause: `firebase/firestore.indexes.json` exempts `jobs.params` from indexing, yet `layers.delete` (its busy check) and `history.revert` (`waitingLayerDeletes`) filtered on `params.layerId`. The emulator does not enforce indexes, and the in-memory fake ignored the exemptions, so every test passed.
    - Fix and pin: both ask by an indexed field (`status in` the unfinished statuses; `type == layer-delete`) and match the layer in code; the fake document store now refuses a query or count on an exempt field; `S-A33-HAPPY-DELETE-INDEXED`, `S-A33-BAD-UNINDEXED-QUERY`.
    - **A field exempt from indexing can never be queried; the fake must refuse what Firestore refuses, since the emulator does not.**

558. **One malformed `setup/status` area hid USGS from Imagery and failed every Setup write.**
    - Seen: 2026-11-12, live: Historical imagery → Find said "Connect USGS" while Setup showed USGS done; `setup.recordCloud` and `ops.tick`'s `health` and `tokens` steps logged `InvalidDocumentError: setup/status … (3 issues)`.
    - Cause: an out-of-band write (`updatedBy: u-overnight`, 2026-11-12 05:45 UTC) stored `install.{server,pipeline,site}.checkedAt` as Firestore timestamps where the schema wants ISO strings. Setup's screen reads each area leniently (`toSetupStatusView`), but the admin's Imagery feed, Home and every server writer read the whole document strictly, so the USGS record was never seen (`usgsOf` of a failed read is `missing`) and no write could build on the document.
    - Fix and pin: `setupStatusReadSchema` (an area its schema refuses reads as absent; the next write replaces it) for every reader; S-A11-HAPPY-USGS-BESIDE-BAD-AREA / S-A11-BAD-USGS-RECORD-MALFORMED.
    - **Read a multi-area status document per area: one broken area must not hide the others or block their writers.**

559. **A version stored with a scan over `MAX_SCAN_PIXELS` could never be ended.**
    - Seen: 2026-11-12, live `cities/bucharest/layerVersions/im-mvya873z-D3C1202-200149F039` (`scan.width` 258,271): Reject and Cancel answered `apiError.internal`, the admin did not list it, and its `awaiting_gcps` job made the 1972-02-02 join `joinLayerBusy` for ever.
    - Cause: the KH-9 import of 2026-11-02 wrote its version straight to Firestore with a scan side over `MAX_SCAN_PIXELS` (200,000 since M3; finding 62, lessons 332 and 493, which left it to the owner to delete). Every ending path read the version with the strict schema, and the store validates whole documents on write, so the record could not even be written back ended; the admin's list dropped it and its page failed.
    - Fix and pin: `layerVersionReadSchema` / `salvageLayerVersion` (the top-level fields the schema refuses left out, the state rule skipped) in Reject, Cancel, `endWork` and the admin's list and version page; the ended version is written back valid; S-A12-HAPPY-LEGACY-VERSION-ENDS / S-A12-BAD-LEGACY-VERSION-UNREADABLE.
    - **A record its schema refuses (an older shape, or a writer that skipped validation) must stay endable by its owner: read it for its ending without the refused fields.**

560. **One invalid parked frame stopped the automatic search of every other one.**
    - Seen: 2026-11-12, live log "imagery tick part failed … InvalidDocumentError … im-mvya873z" after each pipeline update.
    - Cause: `relocateOne` re-threw any error that was not an `ApiError`, so the invalid record above, sorting first, threw before `remember` and before any other frame.
    - Fix and pin: every failure is logged with the version and remembered, and the loop goes on; S-A69-BAD-AUTO-RELOCATE-INVALID.
    - **A per-item loop in a tick catches every error per item; only the item's own refusal codes differ in the log.**

561. **The harti.zip 1895 pieces never reached their overview, and would not have landed on it.**
    - Seen: 2026-11-12, local worker job `ar-mw993zri-s-4054e55659a3` (60 coloured pieces, class `pieces`): "assembled 4 parts, 56 left out", then `no-scale`; the overview path had returned None.
    - Cause: two. `find_overview` took the folder directly under the archive root (`Harti`, the zip's top folder) for the series and looked only at its siblings, so `Harti/Harta Bucuresti 1895.png`, two levels up, was never seen. And `overview_canvas` reads pieces and overview at the same 2,400 px, then estimated the pieces' downscale from those pixel sizes (1.4 against a true 7.07) with a ±20 % sweep: 0 of 60 landed when the overview was given by hand. The overview's 4,000 ORB features (one tile's budget for the whole sheet), a 25-inlier floor that refused correct fits of 10–24 inliers, an RMS measured over outliers too (289 px), and an upscale from the same equal sizes (1.5 against 7.1) made it worse.
    - Fix and pin: `find_overview` climbs ancestor by ancestor to the archive root (loose rasters and sibling folders, related by a shared year when the pieces' folders name one; a year is four digits standing alone); `expected_scale` from the pieces' count, a ×0.5–1.4 sweep, 20,000 overview features detected once, weak fits kept by scale-and-turn consensus, RMS over inliers, canvas upscale from the fits. Re-run on the real files: 57 of 60 on the overview, RMS 0.9 px; S-P20-HAPPY-OVERVIEW-ANCESTOR / S-P20-BAD-OVERVIEW-ANCESTOR-YEAR / S-P20-HAPPY-OVERVIEW-SCALE / S-P20-BAD-OVERVIEW-SCALE-BLANK.
    - **Images read at one working size carry no scale between them: estimate it from what they depict (how many pieces cover the sheet), and test a placer on pieces at the real ratio, not a 2× crop.**

562. **A right-click on the georeferencer's scan picked a point or let the selection go.**
    - Seen: 2026-11-12, adding the georeferencer's context menu: `<hcm-scan-viewer>`'s `pointerdown` started a gesture for any mouse button, so the right button's release was a click (`hcm-pick` while adding, `hcm-select` otherwise) under the menu it opened.
    - Fix and pin: only the main button (`button === 0`) starts a pick, drag or pan; a long press that opened the menu forgets its gesture (`cancelGesture`) and the map's click after it is swallowed. `S-A16-HAPPY-GEOREF-MENU` (`scan-viewer.test.ts` `badPath_aRightButtonPressPicksNothing…`, `georef-menu.test.ts`).
    - **A pointer handler that means a click checks the button; a press that opened a menu is no click.**

563. **The georeferencer's summary and map box failed the context menu's tour state.**
    - Seen: 2026-11-12, the first run of `georef.context-menu` (`S-A16-HAPPY-GEOREF-MENU`): at admin-c360-ro the guide's `<summary>` was a 328 × 19 px touch target; at admin-l1440-en the focus ring of the map's box (`div.canvas`, the keyboard's crosshair) was cut off by `hcm-admin-map`, which the georeferencer's panes round and clip.
    - Fix and pin: `.guide summary` is at least 48 px tall; `hcm-admin-map` draws the ring of its focusable box inside (`outline-offset: -3px`, as Mapbox's own canvas). Pinned by the state check of `georef.context-menu`.
    - **A box that takes the focus inside a clipped, rounded pane draws its ring inside.**

564. **A picked-up georeferencer point outlived its pair, and the menu's chunk failed silently.**
    - Seen: 2026-11-12, review of the context menu: `moving` kept the id of a pair that was deleted (Delete key, residual table, the menu) or undone, so the panes said "Moving point 0" and stayed in pick mode; turning **Add pairs** off while a point was picked up put the map back in select mode with the scan still picking; and a rejected `import('./georef-menu.js')` was an unhandled rejection with nothing logged.
    - Fix and pin: `GeorefStore.#refit` puts a picked-up point back when its pair is gone, `setAdding` clears `moving` with the mode, and the page's `menuChunk()` failure is logged through `createLogger('georef-page')` (the browser's own menu stays). `georef.test.ts` `badPath_aPickedUpPointWhosePairGoesAwayIsPutBack`, `badPath_turningAddPairsOffPutsAPickedUpPointBack…`; `georef-menu.test.ts` `badPath_aMenuChunkThatDoesNotLoad…`.
    - **Transient state that names an item is cleared where the items change; every lazy `import()` has a logged `.catch`.**

565. **A stopped archive series tried again never placed itself from the owner's saved pairs.**
    - Seen: 2026-11-12, the 1914 SOCEC series: the owner saved pairs (`imagery.saveGcps`), stopped the job, then clicked Try again; the series did not place itself from the pairs, and the georeferencer showed it read-only.
    - Cause: Stop writes `cancelRequested: true` on the job (`packages/admin/src/imagery/version.ts`), and `imagery.retry` copied it onto the retried job (`retriedJob` omitted only the error, the end, the lease and the execution). A queued job asked to stop is never dispatched (`dispatch.ts` `isQueued`), no worker claims it (`worker/claim.ts`), a run that starts stops at its first step (`runner.py` `_refresh`), and `imagery.tick` cancels it again (`cancelAsked`); meanwhile its version sat `processing`, which the georeferencer opens read-only (`georef/state.ts` `EDITABLE_STATES`). The pairs themselves were never lost: the retry keeps the version's `georef`, and `place` prefers them to the class's placer. The retry test seeded a stopped job without the `cancelRequested` every real Stop writes.
    - Fix and pin: the retried job leaves `cancelRequested`, `waitReason`, `placingPoints` and a local worker's overdue mark `workerOverdueAt` behind (`retry.ts` `LEFT_BY_THE_RUN`; kept, a series stopped while overdue would come back offering Run in Google Cloud at once and `tick-worker` would never mark the new wait); the whole path save → Stop → Try again → the tick's cancellation pass in `retry-stopped.test.ts`; `place` from the kept pairs after a Stop deleted `stitched.tif`, the class placer never run (`test_placing_owner.py`); the parked series editable with its pairs and the retried one read-only (`georef.test.ts`); S-A12-HAPPY-RETRY-STOPPED-PAIRS, S-A12-BAD-RETRY-STOPPED-DISMISSED, S-A12-BAD-RETRY-STOPPED-PLACING.
    - **A fixture of an ended job must carry every field the real ending writes; test a retry from the state the owner's own click leaves, not a hand-made one.**

566. **A deleted archive series could never be imported again, and a failed version showed a Delete that did not delete.**
    - Seen: 2026-11-12, review of `imagery.deleteVersion` (S-A125): the archive's record still named the deleted series' job, so `imagery.archiveImport` refused it (`archiveImported`) and the archive page showed it with no progress; a failed version kept Dismiss, labelled Delete but only `imagery.reject`, beside the new Delete this version.
    - Cause: the deletion cleaned the version's own documents and files but not the records that point at them (`archives/{a}.jobs`), and the UI's deletable states were narrowed to dodge a substring locator in an e2e test.
    - Fix and pin: the delete transaction drops the series from `archives/{a}.jobs` and the import refuses only a series still named; the archive page plans the series not imported yet; a failed version offers Delete this version alone, the e2e locators match exactly; `S-A125-HAPPY-DELETE-VERSION`.
    - **A deletion also clears every record that names what it deleted; never narrow a behaviour to suit a test's locator, fix the locator.**

567. **A place's year rule had a back door through History's Revert, and its date bound lived only in the editor.**
    - Seen: 2026-11-12, review of the place-year change: `history.revert` checked a restored place only against `poiDocSchema` (years optional), so reverting a dated place to an older version removed its years; the GeoJSON import and the rules accepted a year up to 2100, only the editor refused one after next year.
    - Fix and pin: `history.revert` answers `apiError.history.placeYear` for a version without a year over a dated place; the places area's context carries `latestYear` for the import; the rules' `dated` compares with `request.time.year() + 1`; `S-A32-HAPPY-PLACE-YEAR`, `S-A32-BAD-PLACE-YEAR`.
    - **A rule a lenient stored schema cannot hold must be checked at every door that writes, Admin SDK copies of old versions included, with the same bounds.**

568. **Merged on their own, three branches each fit their bundle budgets; together the viewer engine and `editor-shared` did not.**
    - Seen: 2026-11-12, the merge of track/georefmenu, track/pairs1914, track/deletecancel and track/placeyear into `feat/engine-rewrite`: `check_bundle_budget.py` failed `engine.iife.js` at 125.04 KB of 125 (the place-year rule's `validation.yearLate` words, which only the admin's editor shows, sat in the viewer's catalogue, and the index's `export *` of `legacy-reads.ts` left an empty module wrapper in the IIFE) and `editor-shared` at 13.05 KB of 13 (the work branch's `legacy-reads.ts`, which Home and the Imagery pages share). The merge also put `admin-imagery/{ro,en}.ts` and `packages/shared/src/index.ts` at 401 lines.
    - Fix and pin: a year after next year is the schema's `validation.tooBig`, said in the editor's own words (`adminContent.common.issue.yearLate` through `issue-text.ts`); `legacy-reads.ts` is its own chunk `legacy-reads` and the index names its exports; the georeferencer's texts moved to `admin-georef/` (DECISIONS-for-review.md §154, §155).
    - **Words only the admin shows belong in an admin catalogue, never the viewer's; the shared index names a module's exports (an `export *` can cost the IIFE a wrapper); and a merge of branches is built and measured before it is called done, since each branch's headroom is spent once.**

569. **The 1895 pieces stitched on their overview, then the server refused the record.**
    - Seen: 2026-11-12, worker log: "stitched 57 of 60 parts into one 16963 x 14298 picture", then "job ar-mw993zri-s-4054e55659a3 crashed in place … WorkerApiError: apiError.invalidRequest".
    - Cause: the pipeline writes `help.stitched.method: "overview"` (and `archive.method: "overview"` once placed), but `STITCH_METHODS` and `ARCHIVE_PLACE_METHODS` of `@hcm/shared` did not list it. The pipeline's fakes do not validate against the server's schemas, and `STITCH_METHODS` was not in the shared contract `pipeline/tests/contracts/enums.json`.
    - Fix and pin: `overview` in both lists on both sides; `STITCH_METHODS` joins the contract (both contract tests); `publish_stitched` and the placed record refuse a method outside the lists before publishing; `S-P20-BAD-STITCH-METHOD-UNKNOWN`.
    - **Every enum value the pipeline writes into a server document belongs to the shared contract; a new value goes into both languages in the same change.**

570. **The linked views lost a quick zoom while their lazy chunk loaded.**
    - Seen: 2026-11-12, `georef-linked.spec.ts`: two presses of `+` on the scan left the map where it was. The first pane move only started the fetch of `georef-extras`, and the second came before the chunk was in, so both were dropped.
    - Fix and pin: `LinkedPanes` keeps the latest move made while the chunk loads and plays it once `ViewLink` exists (`packages/admin/test/georef/georef-linked.test.ts`, S-A16-HAPPY-GEOREF-LINKED). The spec's first assertion was also wrong: the whole scan shows more than the map at zoom 13, so a scan zoom can zoom the map out; it now checks one step as log2(1.5) map zoom.
    - **An input that triggers a lazy load is kept and replayed, not dropped; assert relations the geometry guarantees, not a direction you expect.**

571. **The linked views dropped a first move that started on the map.**
    - Seen: 2026-11-12, review of the linked views: `ViewLink.map()` takes its first `move` only as the camera to compare with, and `LinkedPanes` replayed just the latest move once the chunk was in. A first action on the map of a fitted version (one jump and one `move` under reduced motion) therefore moved nothing; the tests and the spec always started on the scan. The e2e helper `georeferencerReady` also turned Link the views off only when it was already on, so a spec that opened a version without a fit and then added pairs (`suggestions.spec.ts`) ended up linked.
    - Fix and pin: `GeorefMap` says what the new map shows (`shown` → `LinkedPanes.seen` → `ViewLink.seen`), and `LinkedPanes` hands the camera before the waiting move to the link with it; a re-made map only reseeds, it moves nothing. `georef-linked.test.ts` `happyPath_aFirstMoveOnTheMapMovesTheScanWhileTheChunkLoads`, `happyPath_twoMapMovesBeforeTheChunkIsInFollowTheLatest`. The e2e helper remembers a page opened unlinked and `addPair` turns the toggle off again once a fit turns it on.
    - **A lazily loaded follower needs the state before the first input, not only the input; test the path from each side.**

572. **A coloured series stitched on its overview came out grey.**
    - Seen: 2026-11-12, harti.zip `Bucuresti 1895-1899` (coloured pieces, encoding `colour`): the georeferencer showed the stitched 1895-1899 map in grey.
    - Cause: `overview_canvas` read every piece through `_read_grey` for ORB and pasted those same grey arrays on a one-band canvas, so the colour was gone before the canvas was written; `canvas.tif`, `stitched.tif`, the georeferencer's `scan.tif` and the warped output all inherited one band. The other assemblies (`compose_canvas`) already kept colour.
    - Fix and pin: `CanvasOpts.colour` (from `SeriesJob.colour`) keeps fitting on grey and pastes each piece re-read in its own colour, one at a time, by the same matrix on a three-band canvas; grey and line-art series stay one band. S-P20-HAPPY-OVERVIEW-COLOUR / S-P20-BAD-OVERVIEW-GREY-STAYS-GREY.
    - **Features want grey, pictures want the source's bands: keep the two reads apart instead of reusing the matcher's input as the picture.**

573. **A pipeline test file grew past radon's maintainability grade A on its branch, and only the merge's `static` run saw it.**
    - Seen: 2026-11-12, the merge of track/colourstitch: `pipeline-radon` failed `pipeline/tests/unit/test_placing_overview_find.py - B (13.83)` after the colour series' three tests and two helpers joined its 290 lines; the branch had run pytest, ruff and mypy but not the `static` stage.
    - Fix and pin: the colour tests (S-P20-HAPPY-OVERVIEW-COLOUR, S-P20-BAD-OVERVIEW-GREY-STAYS-GREY) moved into their own `pipeline/tests/unit/test_placing_overview_colour.py`; the scenario notes follow.
    - **Radon grades whole files, tests included: a branch that adds tests to a long test file runs `pipeline-radon` (or the whole `static` stage) before it is called done, and splits by behaviour rather than appending.**

574. **A local series at its attempt cap could only be deleted.**
    - Seen: 2026-11-12, the 1895 archive series of lesson 569: after the server fix was deployed its version page offered only Delete this version (`attempt: 3`, `apiError.internal`).
    - Cause: `JOB_MAX_ATTEMPTS` capped every retry alike, though it exists to stop paid cloud work looping; a run on the owner's computer costs no cloud compute, and a server bug spent its three attempts.
    - Fix and pin: `retryPastCap` and `retryCures` of `@hcm/shared`, used by `jobRetryable` and `imagery.retry`: the owner's Retry of a local run (`runOn: 'local'`, `localOnly`, `archive-series`) passes the cap, its `attemptsExhausted` included, and starts the count again; a cloud run and every publish keep their caps (DECISIONS-for-review.md §158; S-A12-HAPPY-LOCAL-RETRY-PAST-CAP, S-A12-BAD-CLOUD-RETRY-AT-CAP).
    - **A limit that guards cost applies where the cost is: a manual retry that spends nothing must never be refused by it, and the client and the server read one shared predicate.**

575. **Removing the starter kit's Romanian half left a test that counted two README examples.**
    - Seen: 2026-11-12, the merge of track/englishdocs: `packages/shared/test/kit/template.test.ts` `happyPath_itsPhotoExamplesAreValidPhotosInBothLanguages` expected two JSON photo examples in `templates/starter-kit/README.md`; DECISIONS-for-review.md §157 left one. The branch ran only the functions tests it touched.
    - Fix and pin: the test is `happyPath_itsPhotoExampleIsAValidPhoto` and expects the one English example, still parsed by `photoSchema`.
    - **A docs-only change can break a test that reads the docs: run `vitest related` on the Markdown's readers too (`grep -rn` the file name in `**/test/`), not only on the code the branch changed.**

576. **S-A44-HAPPY waited for a map source the georeferencer no longer has.**
    - Seen: 2026-11-12, the merge of track/linkedviews (and already on fbf8af6a, before linked views): `suggestions.spec.ts` polled `overlayFeatureIds(page, 'georef-suggestions')` for the four suggestions and got `[]` at every window.
    - Cause: DECISIONS-for-review.md §143 moved the map's pair and suggestion markers from Mapbox sources to one badge canvas over the map (`packages/admin/src/georef/marker-overlay.ts`), so no `hcm-source-georef-suggestions` exists; the spec still read the old source, which nothing asserted was gone.
    - Fix and pin: `georefBadgesAt` (`e2e/admin/support/map.ts`) counts the places with paint on the `canvas[data-georef-badges]` near their projection; the spec reads the suggested places from the version, shows the map pane, zooms out with the map's own button until they are on screen (a badge off the view is not drawn) and expects four. S-A44-HAPPY's asserts say so.
    - **When a rendering moves from a map source to a canvas, its e2e reads move with it: assert the pixels the user sees, and grep the specs for the old source id in the same change.**

577. **A local city's join was refused by the cloud's daily cap.**
    - Seen: 2026-11-12, Bucharest (worker choice `local`): `imagery.join` of free USGS frames answered `apiError.imagery.dailyLimit` after ten jobs that day, though none of them would run on Cloud Run.
    - Cause: `limits.ts` counted every `usgs-import`, `geotiff-import` and `layer-join` except `localOnly` archive series; where a job would run was decided only at its first dispatch, after the cap.
    - Fix and pin: jobs on the computer (`runOn: 'local'`) never count; a `local` city's new jobs are created `runOn: 'local'` and pass the cap; a move to the cloud asks the cap then and counts on that day (DECISIONS-for-review.md §159; S-A12-HAPPY-LOCAL-PAST-DAILY-CAP, S-A12-BAD-RUNON-CLOUD-PAST-CAP).
    - **A cost cap counts only the work that costs: decide where a job runs when it is created, record it on the job, and check the cap again on every path that moves it to the paid place.**

578. **The 1923 plan-ghid failed: GDAL was asked to open a PDF.**
    - Seen: 2026-11-12, harti.zip on the owner's computer: the atlas `plan-ghid-al-orasului-bucuresti-v-miorini 1923.pdf` (143 pages) failed with `RasterError: GDAL cannot read … .pdf`.
    - Cause: `AtlasPlacer` (and `PiecesPlacer`) looked for an archive overview before swapping the PDF for its pages; the search found a loose map beside it in `Harti/` and `overview_canvas` read the series' sheets, the PDF itself, through GDAL, whose PDF driver in the pipeline image writes but cannot read.
    - Fix and pin: `maps.paged` swaps every PDF for its pages before any placer reads anything; a page that cannot be written as stored is decoded to a TIFF; a PDF pikepdf cannot open fails with `apiError.imagery.archiveCorrupt` naming it (S-P20-HAPPY-PDF-ATLAS, S-P20-BAD-PDF-BROKEN).
    - **Turn a container format into rasters at the entry of every path, before the first read, not inside one branch: a later branch added on top reads the original.**

579. **1844-1846 Borroczyn was refused by the server: the same `overview` record as lesson 569, run before its fix was deployed.**
    - Seen: 2026-11-12, about 12:13 local (the job's `stitched.tif` on the worker's volume: 10:13 UTC): the atlas (94 pages) found a loose overview map in `Harti/`, stitched on it (a 3192 x 3600 canvas, nearly blank), and `help.stitched` was refused with `WorkerApiError: apiError.invalidRequest`.
    - Cause: the deployed server's `STITCH_METHODS` did not list `overview` yet (commit a071ab5a, 13:17 local, lesson 569); the worker's error named no field, so it looked like a new bug. Rerun on today's branch with the worker's real files and a fake store, the whole version passes `layerVersionDocSchema`.
    - Fix and pin: `apiError.invalidRequest` now carries the refused fields' paths and codes from every `worker.step` refusal (never a value) and the worker's `WorkerApiError` repeats them (S-A62-BAD-NAMED-FIELD); `LEFT_OUT_REASONS` and `STITCHED_LEFT_OUT_MAX` join the shared contract and `publish_stitched` refuses an unknown reason before the work is published (S-P20-BAD-STITCH-METHOD-UNKNOWN).
    - **A refusal that does not name its field costs a reproduction: make the server say where, and date the run against the deploy before hunting a new cause.**

580. **A worker busy with one long step looked gone, and nothing stopped a step that never ended.**
    - Seen: 2026-11-12: an hour in `locate` on the KH-5 frame DS09065A089MC039, then a 60-sheet `place` at 110 % CPU; the admin said "No computer connected" both times and the whole local queue waited.
    - Cause: the worker's `lastSeenAt` was refreshed only by `worker.hello`, `claim` and `end`, never during a run (the lease's heartbeat thread renewed only the job), so after `WORKER_FRESH_SECONDS` (180 s) the admin, and `placeFor`, took the worker as gone; no step had a time limit.
    - Fix and pin: `worker.step`'s update stamps the worker's `lastSeenAt` when the write renews the lease (S-A62-HAPPY-BUSY-SEEN); every step has a wall-time limit raised at its next checkpoint as `apiError.imagery.stepTimeLimit` (S-P01-HAPPY-STEP-LIMIT, S-P01-BAD-STEP-LIMIT, on a fake clock).
    - **Presence must be refreshed by what runs during the work (the heartbeat), not only by what runs between jobs.**

581. **A frame joined before could never be joined again.**
    - Seen: 2026-11-12, the 1980-07-16 join: "Frame D3C1216-100235A039 has no usable version left (rejected, cancelled, failed)", though its version was `joined` (11.7 m) and the scene page offered no Import.
    - Cause: `isUsablePart` and `partGone` (`functions/src/imagery/join-parts.ts`) took every state of `ENDED_VERSION_STATES` but `published` as gone, and `joined` is one of them.
    - Fix and pin: `ENDED_YET_USABLE` (`published`, `joined`); a joined frame is taken by a new join and ready for it (S-A65-HAPPY-JOINED-FRAME; the dispatcher's case "joined into another" moved from gone to ready).
    - **When a list of ended states doubles as a list of unusable ones, name the ended states that still serve, and let the refusal's words match the list.**

582. **A KH-5 Argon frame searched an hour with no end.**
    - Seen: 2026-11-12, DS09065A089MC039 (1964-06-18): `locate` ran about an hour with no log line until it was cancelled.
    - Cause: the frame is about 550 km across at 140 m on the ground, so the city is a small patch of it; the vote search had no time bound, and nothing proves a KH-5 frame yet (M9 §14).
    - Fix and pin: `SensorSpec.search_seconds` (35 min, KH-5 10 min) bounds the search (`SearchBudget`): past it the windows left are not searched and the frame, not proved, waits for points (S-P06-HAPPY-SEARCH-BUDGET, S-P06-BAD-SEARCH-BUDGET); since lesson 607 as the whole frame shrunk, not as a crop by its footprint.
    - **Every search over an unknown space gets a time budget whose end is a result (not found, ask a person), not a failure.**

583. **The 1895 series offered 26 suggested pairs off its own scan.**
    - Seen: 2026-11-12, the 1895-1899 pieces on their overview (57 of 60, 16963 px wide): every "closest pair" had x past the 8192-px scan, and they put the scan 10 to 27 km off (a hand fit of 6 pairs: 9.4 m).
    - Cause: `place_map` writes the suggestions in the canvas's pixels; `publish_stitched` then publishes the scan shrunk to `SCAN_MAX_PX` and left the pairs as they were. A single map's picture is its working copy, while its pairs are in its original's pixels.
    - Fix and pin: `stitched.in_scan` moves the version's suggestions into the scan's pixels (`Stitched.pairs_scale` times the scan's shrink) and drops a pair outside the scan (S-P22-HAPPY-PAIRS-IN-SCAN, S-P22-BAD-PAIRS-OUTSIDE-SCAN).
    - **Every pixel coordinate written beside a picture names the picture it belongs to; when the picture is resized for the reader, its coordinates move in the same write.**

584. **The start site's footer links and the landing page's links were 44 px touch targets, and the English landing page was checked as a Romanian page.**
    - Seen: 2026-11-12, the first run of `e2e/admin/specs/start` at every admin project after the merge of the release: 15 failures at `admin-c360-ro` and `admin-m768-ro` (`[target-size]` on `a.start-site-link` and `a.landing-link`, 44 px under M3's 48) and at every Romanian project (`Language`, the English page's switch label, reported as English in a Romanian page).
    - Cause: `start-site.css` and `landing.css` gave their links `min-block-size: 2.75rem`; `landing.spec.ts` passed the project's language to `adminVisit` for a page whose language is its own (`index.html` English, `ro.html` Romanian). The specs had been run at `admin-l1440-ro` only.
    - Fix and pin: both link classes are `3rem` high; the landing visits name the page's own language (S-A132-HAPPY-LANDING, S-A76-HAPPY-LEGAL at every admin project).
    - **A link that stands alone (a footer, a list, a switch) is a touch target of 48 px; a page with its own language is checked in that language, not the project's; a new spec is run at the compact and the medium project before it is called green.**

585. **A new server-owned field the complete rules fixture lacks makes its "never removed" row pass for nothing.**
    - Seen: 2026-11-08, track/favicon: `client-writes.test.ts` found that a client could "remove" `cities/{city}.icon`, the tab icon's record; removing a field the seeded city did not have changes nothing, so the rule allowed it.
    - Cause: the field was added to `cityDocSchema` and the server, but not to `firebase/rules-tests/test/support/documents.ts`'s complete city, which every server-owned row seeds.
    - Found by: the `tests` stage (`documents.test.ts` compares the fixture's keys with the schema's, `client-writes.test.ts` the removal). Fix: the fixture carries `icon`; the rule was right all along.
    - **A field added to a document schema joins the rules' complete fixture in the same change, server-owned or not.**

586. **A request limit equal to the size limit's base64 hides the size message behind "invalid request".**
    - Seen: 2026-11-08, track/favicon: a 1,000,003-byte PNG sent to `cities.setIcon` came back `apiError.invalidRequest`, not `apiError.cityIcon.tooBig`, because its base64 was longer than the schema's `maxBase64Chars`.
    - Cause: the schema's cap (base64 of exactly 1 MB) refuses everything above it before the handler measures the bytes.
    - Found by: `functions/test/cities/set-icon.test.ts`. Fix: the admin checks the size in the browser first (`browserProblem`), so an editor always reads the size message; the server's cap stays as the request's own limit.
    - **When a schema caps a payload that the handler also measures, the client says the plain reason before sending.**

587. **A card added to an area chunk at its budget pushes the chunk over it.**
    - Seen: 2026-11-08, track/favicon: Settings → Browser tab icon took the `settings` chunk to 20.6 KB of its 20 KB.
    - Cause: the settings chunk had about 0.5 KB left, and a card's view, its CSS and its file checks weigh more.
    - Found by: the `build` stage's `bundle-budget` on the NUC. Fix: the card is a chunk of its own fetched when its section first opens (`lazy-icon.ts`), the file checks went with it, its CSS went (the page's own classes do), and the new chunk got its row (DECISIONS-for-review.md §165l); no budget raised.
    - **A new Settings card starts as a lazy chunk when the settings chunk is within 1 KB of its budget; measure before the review, not after.**

588. **A page that links a file the server has not written yet shows nothing until the server is updated.**
    - Seen: 2026-11-12, track/favicon: the Hosting root linked `cities/bucharest/icon-32.png` in the public bucket, which only the new functions draw; a Hosting deploy alone would have left the live tab without an icon until Update the map.
    - Cause: the default was made to depend on a server-written object, though the page could inline it.
    - Found by: comparing the built page with the live bucket (a 404) before the deploy. Fix: every page inlines the default and a script swaps in the bucket's file once it has loaded (DECISIONS-for-review.md §166d).
    - **A default never depends on another deploy: inline it, and treat the server's file as the upgrade.**

589. **Lines appended to a served `config.js` break every reader that expects one literal assignment.**
    - Seen: 2026-11-12, track/favicon: `build.test.ts` reads the built `config.js` with `readConfigJs`.
    - Found by: reading the tests before the change. Fix: the tab icon's script is its own file, `tab-icon.js` (§166c).
    - **A page's new behaviour gets its own script file; `config.js` stays data.**

590. **A part's build that was meant to share the engine's Lit bundled its own Lit and zod: 44 KB instead of 2.6.**
    - Seen: 2026-11-09, track/photoversions: the first build of `engine.extras.js` measured 146 KB raw, 44 KB gzip.
    - Cause: the plugin that turns every outside import into the engine's kit ran after Vite's own resolver, which had already resolved `lit` and `@hcm/shared` to files, so its `resolveId` never saw them.
    - Fix and pin: `sidePartKitPlugin` has `enforce: 'pre'` (`scripts/site/src/side-part.ts`); the part measures 2.6 KB gzip within its row of `ENGINE_CHUNK_BUDGETS`, and `packages/ui/test/viewer/extras-loader.test.ts` checks that the kit names everything the part imports.
    - **A Vite plugin that must decide how an import resolves runs with `enforce: 'pre'`; check a new build's size against what it should carry.**

591. **A re-export moved to save a line of the shared index made two engine chunks without a budget.**
    - Seen: 2026-11-12, track/photoversions after the merge: `streetViewUrl` re-exported from `text/urls.ts` (to keep `packages/shared/src/index.ts` at 400 lines) made the ES build emit `urls-<hash>.js` and `focus-<hash>.js` (the catalogues and the focus helpers, 6.6 KB), which `bundle-budget` refused.
    - Cause: a module that re-exports another is one more module shared by the entry and the lazy chunks; the bundler moved what they share out of `engine.mjs`.
    - Fix and pin: the index exports `streetViewUrl` from `geo/street-view.ts` itself and gains its lines back with inline `type` exports; `bundle-budget` fails on any chunk without a row.
    - **Never route an export through an unrelated module to save a line: build and run `check_bundle_budget.py` after any change to what `@hcm/shared` exports.**
592. **`tsc -b` on the NUC said TS6305 "has not been built from source" after a merge.**
    - Seen: 2026-11-12: the NUC's copy keeps `.tsbuild/` between runs (the sync leaves it out), and 77 merged commits left its build info older than the files.
    - Fix: delete `packages/*/.tsbuild`, `e2e/.tsbuild` and every `*.tsbuildinfo` on the NUC, then run `tsc -b` again.
    - **After a large merge, clear the incremental TypeScript output of a machine that only receives the sources.**

593. **Three branches, each under the start page's budget, went over it together: the page carried every Firestore schema and the API catalogue.**
    - Seen: 2026-11-12, the merge of track/workerfix, track/favicon and track/photoversions: `dist/start-app/start.mjs` measured 72.9 KB gzip of 72 (each branch alone 71.7 to 71.9), and `firebase/rules-tests/test/support/documents.ts` reached 601 lines of 600.
    - Cause: the start page needs a city id's pattern and three checks (`isUsableCityId`, `suggestCityId`, `cityBoundsProblem`); they lived in `schemas/paths.ts` and `schemas/cities.ts`, whose imports (`firestore.ts`, the API's limits) are zod schemas built at module level, which no bundler drops. So every new field, error text or schema of any branch grew the start page.
    - Fix and pin: `CITY_ID_PATTERN` is in `schemas/primitives.ts` and the checks in `schemas/city-id.ts` (`paths.ts` and `cities.ts` re-export them): 60.4 KB gzip, no `apiError.*` text in the page, no budget raised (`bundle-budget`). The photo's `derivative` helper moved to `photo-fields.ts`. The same full run found two gaps the branches' targeted runs had not measured: `placing/maps.py` at 88 % of its branches (no test of an atlas or of pieces whose PDF needs a password: added in `test_placing_pdf.py`) and `issue-text.ts` at 87.5 % (two branches nothing reaches, removed).
    - **A check a small page needs lives in a module that imports no schema; when a budget is within 1 % on several branches, measure the merge, not the branches, and read which modules the bundle holds before cutting bytes.**

594. **An untagged dev build of `1.0.0` blocked every `1.0.0-beta.1`: by SemVer the pre-release is older.**
    - Seen: 2026-11-12, live: the admin `1.0.0-beta.1+593d539` (the release prep's bump) against the server `1.0.0+dcfb067`, an untagged build of before the bump; step d said "Installed 1.0.0+dcfb067, newer than this admin: reload the page" and offered no Update.
    - Cause: `compareRelease` ordered by SemVer first; every build before the bump had called itself `1.0.0` though no `v1.0.0` tag existed, so it outranked every pre-release of 1.0.0.
    - Fix and pin: a release names its channel (a tagged build the version alone, any other `+<commit>`: `dev`); within one core a dev build is placed by its build time, two tagged releases by SemVer; a confirmed override installs over a newer release (`happyPath_aDevBuildIsOlderThanALaterPrereleaseOfItsCore`, `badPath_aTaggedReleaseIsNewerThanAnOlderPrerelease_theDowngradeGuard`, S-A55-HAPPY-INSTALL-OVER).
    - **A version that was never released must not outrank one that was: say in the build whether it is a tagged release, and give every guard an owner's way past it.**

595. **The scan pane threw the owner's zoom away whenever its box changed size.**
    - Seen: 2026-11-12, the owner placing points on 1966 Corona frames: after a pair was added, the scan sometimes showed the whole strip again.
    - Cause: `<hcm-scan-viewer>` set its view back to "fit" whenever its measured size changed (`#currentView` → `#measure`), and adding a pair changes the page below the panes (the residual table grows, a scrollbar comes, a status line wraps), which narrows the pane by a few pixels.
    - Fix and pin: `resizedView` keeps the zoom and the pixel at the centre over a size change and fits again only a pane never zoomed or never shown (`packages/ui/test/admin/georef/scan-viewer-keep.test.ts`, `e2e/admin/specs/imagery/georef-ghost.spec.ts`: S-A16-HAPPY-GEOREF-KEEP-ZOOM).
    - **A view the user chose survives a layout change: re-centre it, never reset it, and test it by resizing the box.**

596. **The linked map moved between the two clicks of a pair, so a fast second click landed 1 km off.**
    - Seen: 2026-11-12, the same session: with a fit, a scan zoom (or the wheel's trailing events) after the scan click moved the map to the fit's place of the scan centre while the owner aimed at the map.
    - Cause: the linked views (§156) applied every scan move to the map, a half pair pending or not.
    - Fix and pin: the link pauses while a half pair exists; the expected place is shown as a dashed ring instead (`ghost.ts`, `ghosts.ts`; S-A16-HAPPY-GEOREF-GHOST).
    - **Never move the target a user is about to click: show where you expect it instead.**

597. **The sharper scan was capped by its long side only, and switched on in CSS pixels.**
    - Seen: 2026-11-12, review of the georeferencer's sharper scan (§170): a near-square upload (20,000 px a side) would have written a 16,384 × 16,384 `scan-detail.jpg`, about 1 GiB of RGBA once the browser decodes it; and on a screen of two device pixels a CSS pixel the 4,096 px preview was already upscaled (blurry) from half the zoom that fetched the sharper one.
    - Cause: `publish_scan` sized the detail like the preview (one long-side cap, right for a long Corona strip), and the pane compared `view.scale` with 1 in CSS pixels, ignoring `devicePixelRatio`.
    - Fix and pin: `detail_scale` also caps the area (`SCAN_DETAIL_MAX_PIXELS` = 64 million, both sides of the contract; `pipeline/tests/unit/test_publish_scan.py`); the pane and the store compare `scale × devicePixelRatio` (`scan-draw.ts` `pictureOf`, `georef-pictures.ts` `zoomed`; `scan-viewer-keep.test.ts`, `georef-pictures.test.ts`, `georef-ghost.spec.ts`: S-A16-HAPPY-GEOREF-FULL-RES).
    - **An image a browser decodes whole is capped by its area, not only its side; a "past native resolution" test counts device pixels.**

598. **A map click right after a pair was made moved that pair to the click as well as starting the next one.**
    - Seen: 2026-11-12, the ghost spec once it checked the ring's place (review of §170): with Add pairs on, the click on the map that began pair 6 also moved pair 5 there (its fit error jumped to kilometres); a likely part of the owner's "pin landed 1 km off".
    - Cause: completing a pair selects it, and `GeorefMap` handed the selection to the drawing tools; the Terra Draw adapter's `select` switches the tools to `select` mode, in which a map click moves the selected point (the single-pointer way to place a pin, WCAG 2.5.7). The `static` mode that Add pairs had set was undone silently.
    - Fix and pin: while adding, `GeorefMap` does not select in the tools (the badges show the selection) and selects again when adding ends (`packages/admin/test/georef/georef-map.test.ts`; `e2e/admin/specs/imagery/georef-ghost.spec.ts`: the pair made before keeps its place).
    - **A port call can change a mode as a side effect: after it, assert the mode the feature relies on, and test the click after the edit, not only the edit.**

599. **A cap on a picture's area still left one JPEG of a quarter gigabyte decoded.**
    - Seen: 2026-11-12, audit of the georeferencer's sharper scan: capped at 64 million pixels it still decoded to 256 MiB of RGBA in one piece (more for a 2:1 frame), on laptops short of memory.
    - Cause: an `<img>` decodes the whole file whatever part the canvas draws; a cap only moves the number.
    - Fix and pin: the sharper scan is JPEG tiles in one file (`scan-tiles.bin`, `scan_tiles.py`); the pane decodes the tiles in view and keeps at most 32 (`scan-tiles.ts`; `scan-tiles.test.ts` pans a 16,384 px scan and counts; `test_publish_scan.py` reads every tile's size; DECISIONS §172).
    - **A picture larger than the screen is shown in pieces: budget the decoded bytes, and test the count and size of the pieces asked for.**

600. **Turning the map by the scan's angle minus the fit's rotation was 2 degrees off on the stand-in's frame.**
    - Seen: 2026-11-12, `georef-linked.spec.ts` (S-A16-HAPPY-GEOREF-ROTATE): the scan turned 15 degrees, the map 12.9.
    - Cause: an affine fit that stretches one axis more than the other turns different scan directions by different angles; the first version read the rotation of the scan's x axis only and subtracted angles.
    - Fix and pin: `rotation.ts` carries the very direction the pane shows along its x axis through the fit (`fitAngle` with an angle) and, the other way, a step of the map's x axis back through the inverse fit (`angleFor`); `rotation.test.ts`, the e2e within a few degrees of the stand-in's oblique fit.
    - **A rotation read from a fit is the rotation of one direction: carry the direction you show, not the scan's axis.**

601. **A tour state with a snackbar failed the scroll sweep on Mapbox's logo.**
    - Seen: 2026-11-12, `georef.pair-removed`: scrolled to 675 px, the map's clipped Mapbox logo lay within 12 px of the snackbar's Undo, which floats over the page at a large window.
    - Cause: the sweep scrolls the page under fixed elements; a notice that stays ten seconds meets whatever scrolls beneath it.
    - Fix and pin: the state is checked once the notice is gone (after its Undo); the notice itself is checked in the shell's own states.
    - **Check a page's state without a transient overlay over it, or the sweep reports the overlay's meeting with scrolled content.**

602. **The linked scan drifted a few degrees after the map's turn buttons, one run in four.**
    - Seen: 2026-11-13, `georef-linked.spec.ts` repeated three times at two projects: the scan's next turn was undone, or Upright ended at 4 degrees.
    - Cause: the map's buttons turned it with an animation, whose `move` events kept turning the scan after the owner's next press; and every map move read the scan's angle back through an oblique fit, whose two conversions are not exact inverses.
    - Fix and pin: the map's turn is a jump (`GeorefMap.rotateBy`), and only a move that changes the map's bearing turns the scan (`linkedPanesOf`; `rotation.test.ts`).
    - **Run a test of linked motion several times before trusting it; an animation is a second actor.**

603. **The light theme's FAB and menu labels were painted nearly invisible on Android, while every checker measured 6.9:1.**
    - Seen: 2026-11-12, the Pixel 9 Pro review (P2): #33406D on #BAC7FD in the computed styles, pale lilac on lilac on the screen.
    - Cause: the theme's light mode declared `color-scheme: light`. Chrome's dark theme for sites (on by default on Android with a dark system) repaints every element whose used scheme is light: it lightened the dark text and kept the tinted fill. Axe and the tour's non-text contrast read computed styles, which the repaint never touches, and no e2e browser ran with it.
    - Fix and pin: a chosen mode is `only light` / `only dark` (`packages/ui/src/theme/apply.ts`); the dark tours run Chromium with `--blink-settings=forceDarkModeEnabled=true`, the state `other-theme-menu` picks the other theme and opens the menu, and `e2e/support/rendered-contrast.ts` reads the FAB menu's contrast from pixels (`S-V12-HAPPY-ONLY-LIGHT`, `S-V12-BAD-FORCED-DARK-SYSTEM`).
    - **A colour check that reads styles cannot see a browser's repaint: measure pixels where it matters, and run a tour with the repaints real phones apply.**

604. **Mapbox's credits drew over the lightbox, and a copy of them took the foot of every sheet, About and Settings on a phone.**
    - Seen: 2026-11-12, the Pixel 9 Pro review (P3).
    - Cause: the legal bar (§21c) was a design the tour enforced: its rule asked for one logo and one attribution on top in every state, so a bar eating 40 to 80 px of a full-screen surface passed, and the legal controls were exempt from the modal checks. Mapbox's corners carry z-index 2 in the frame's stacking context, above the modal layer's auto.
    - Fix and pin: the modal layer has z-index 30; Mapbox's corners move out from under an open modal sheet (`legal-lift.ts`); no credit is owed where no map shows (`mapSeen` in `e2e/support/layout-probe.ts`), and a point seen through a scrim counts as uncovered (`S-V18-HAPPY-MODAL-STATES`, `S-V18-BAD-FULL-SHEET`, `packages/ui/test/viewer/legal-lift.test.ts`).
    - **A checker that encodes a design passes that design's defects: ask what the surface loses, not only whether the rule's element shows.**

605. **The FAB menu of a landscape phone ran seven items in one row off the screen.**
    - Seen: 2026-11-12, the Pixel 9 Pro at 884 × 322 with Chrome's bars (P1): "Setări" began at x 888.
    - Cause: the menu's columns were capped at the height left above the timeline and the chip; with Chrome's bars that was under one item, so each item made a column, and nothing capped the width. The tour's landscape viewport (915 × 412) was tall enough for two rows.
    - Fix and pin: rows that stack upwards across the map's width, 48 px items, the card and the chip hidden while the menu is open, a scroll as the last resort (`dock-styles.ts`, `fab-menu.ts`); the tour's journey `short-landscape` resizes every tour project to 884 × 322 and 568 × 270 and opens the menu (`e2e/tour/settings-states.ts`); `packages/ui/test/viewer/landscape-menu.test.ts` at 884 × 290 and 568 × 270.
    - **Test the shortest window a real phone gives, bars included, not only the nominal landscape size.**

606. **Points of interest off still drew tram and metro stations.**
    - Seen: 2026-11-08, the owner on the live map: the Layers panel's Points of interest switch off, the stations stayed.
    - Cause: Mapbox Standard splits what a visitor calls points of interest across `showPointOfInterestLabels` and `showTransitLabels`; the switch wrote only the first (DECISIONS-for-review.md §92b left transit the city's), and the e2e style draws no text, so every test passed on the property the code wrote.
    - Fix and pin: the switch drives `showTransitLabels` too, live, in the mount `config` and on swipe compare's map, with an explicit city `basemap.config` value standing (`transitLabels`; DECISIONS §175); `happyPath_transitStationsFollowThePointsOfInterestOffAndOn`, `happyPath_bothSidesHideTransitStationsWithThePointsOfInterest`, `S-V31-HAPPY-TRANSIT`, `S-V31-BAD-TRANSIT-CITY`, `S-V31-BAD-TRANSIT-UNKNOWN`.
    - **A switch named for what a visitor sees maps to every style property that draws it: read the style's whole configuration list against the switch's name, not only the property whose name matches.**

607. **A Corona strip nothing proved showed the owner farmland.**
    - Seen: 2026-11-12, DS1103-1058DF027 (1968-05-05, 131,443 px wide): two footprint windows, no AI proposal in either, then `not proved (no-votes): crop 35664 x 8172 px, delivery kept`; the georeferencer showed the first window, countryside, and no point could be placed on București.
    - Cause: `best_of` kept the best-voted window, the first of equals, and `locate` cut the frame by it: with no votes anywhere the choice was only the order of the list.
    - Fix and pin: a frame nothing proved is cut by a guess only when it was searched whole, in time, and fits a scan shown whole; else the scan is the whole exposure shrunk (`steps/whole.py`, marked in `scan.tif`), and the owner's rough points crop the film at full resolution (`steps/recrop.py`); the KH-5 cap ends the same way (S-P06-HAPPY-WHOLE-STRIP, S-P06-BAD-WHOLE-STRIP-UNPROVED, S-P06-HAPPY-ROUGH-POINTS-CROP, S-P06-BAD-ROUGH-POINTS-OUTSIDE, S-P06-BAD-ROUGH-POINTS-FILM-GONE).
    - **When nothing is proved, never let an unproved guess decide what the person sees: show everything, coarser, and let their answer choose.**

608. **The worker's memory was set for a server, not for the computer it runs on.**
    - Seen: 2026-11-12, `reports/resource-audit.md`: a warp held 4.5 GB and a 60-sheet colour atlas 3.8 GB on a 16 GB laptop that also ran the desktop; tile cutting started one 170 MB process a CPU.
    - Cause: `GDAL_CACHEMAX` 1,024 MB and `warpMemoryLimit` 2,048 MB were constants; `compose_canvas` warped every sheet onto a whole canvas and resized the owners' grid to it; `num-threads` was `ALL_CPUS`.
    - Fix and pin: the settings follow the memory the process may use (`rasters.gdal_memory`), each sheet is pasted in its own box, the tile processes are capped (`pyramid.tile_processes`), a city crop is copied by rows and every preview read shrunk (`locate.write_crop`, `common.scan_preview`), an atlas's pages are held grey and read again in colour to paste (`assemble.Pages`); each has a budget test in a process of its own (S-P31-HAPPY-WARP-BUDGET, S-P31-HAPPY-CANVAS-BUDGET, S-P31-HAPPY-TILE-PROCESSES and their bad rows).
    - **A memory setting is a share of the machine it runs on, read at run time, and every heavy call has a budget test that fails when the memory grows back.**

609. **An idle worker asked for a job 86,400 times a month, and a busy one could take the whole computer.**
    - Seen: 2026-11-12, `reports/resource-audit.md`: `hcm-worker` ran with no memory limit and nice 0 (an out-of-memory run takes the desktop with it), and `worker.claim` was called every 30 s for ever, each call with its Firestore reads.
    - Cause: the starter's `docker run` named no limit; the poll interval was one constant, and the admin counted a worker gone after 180 s, which forbade any longer wait.
    - Fix and pin: the starters cap the container at 60 % of Docker's memory with a low CPU weight, the worker nices itself and leaves a core; `worker/pace.py` backs the claims off to `idlePollSeconds` (60 s: the owner refused a five-minute wait for a new job) and wakes on a job or the admin's look, with `WORKER_FRESH_SECONDS` above the longest wait (S-P31-HAPPY-WORKER-POLITE, S-P31-BAD-WORKER-POLITE-OVERRIDE, S-P31-HAPPY-CLAIM-BACKOFF, S-P31-BAD-CLAIM-BACKOFF-OLD-SERVER).
    - **A poll's interval and the presence window that reads it change together, and the newer side must work against the older one in either deploy order.**

610. **Every memory probe started from pytest reported 2,105 MB.**
    - Seen: 2026-11-12, `pipeline/tests/integration/test_memory_budgets.py` in the full pipeline run on the PC: four budgets failed with the same peak, which no probe reached alone.
    - Cause: `getrusage(RUSAGE_SELF).ru_maxrss` keeps, across `exec`, the peak of the process that forked: a probe started from a pytest that had grown to 2.1 GB inherited its figure. Run alone or from a shell, the probes read right.
    - Fix and pin: `tests/budget_probe.py` reads its own `VmHWM` from `/proc/self/status`, which starts afresh with the new program.
    - **A child's own peak memory is `VmHWM`, never `ru_maxrss` read inside a process another large one started.**

611. **A request file's fields read in a new order raised a different error.**
    - Seen: 2026-11-12, M26: `read_request` read `ground` before `film` once the governor's budget was added, and a request holding a pickle in `film` raised `KeyError` for `ground` instead of the refusal of the pickle (`test_bad_path_a_request_holding_a_pickle_does_not_run`).
    - Cause: `numpy.load(allow_pickle=False)` refuses lazily, field by field; the order of reads decides which fault is seen first.
    - Fix and pin: the film's arrays are read first, as before, and the new `budget` only when it is present (an old request reads as the default budget).
    - **When a file is checked lazily by its reader, read the fields that carry the risk first, and add new fields as optional so an old file keeps its meaning.**

612. **The governor's heat limit sat inside a laptop's normal day.**
    - Seen: 2026-11-13, M26 measured: the laptop's package read 90 °C with only a local model running, the NUC 82 to 86 °C under a matcher run; the governor stepped down at 90 °C and back up only under 80 °C, and its load test on the NUC read `paused` throughout.
    - Cause: the limit was chosen from a desktop's habits; mobile processors run at 85 to 95 °C under load and their own trip points are 100 to 110 °C (the NUC's `TCPU` passive at 110).
    - Fix and pin: `CPU_HOT_C` 95 (back up under 85); `test_heat_steps_down_one_level_and_back_ten_degrees_below` asserts 90 °C is not hot.
    - **A threshold on a sensor is set from readings of the machines it will run on, never from a round number.**

613. **A faster matcher measured on easy frames lost the hard one.**
    - Seen: 2026-11-13, M26 h2 on the NUC: half resolution with 1,024 keypoints answered in 38 s against 553 s and still found F007 and F003 on Bucharest, but proposed nothing for F006 on Fetești, which the card finds with 3 pairs; 1,024 keypoints at full resolution also found nothing.
    - Cause: fewer keypoints a tile leave too few inliers on a frame that only just passes the 12-inlier pair gate.
    - Fix and pin: the processor searches at half resolution with the budget's 2,048 keypoints (64 s, F006 found), and the governor's quiet profile keeps 2,048 too (slower, never blinder).
    - **A speed-up of a search is measured on its hardest fixture (the fewest inliers the reference finds), not only on the ones it finds easily.**

614. **Every installed starter stayed old for days and nothing said so.**
    - Seen: 2026-11-13, the owner's laptop: `hcm-worker.service` ran the starter of 2026-11-08 after the hardware governor changed the file; the worker had no memory cap and "This computer" said no graphics card could be reached on a laptop with an RTX 3080.
    - Cause: both starter files passed `HCM_STARTER=2` and the pipeline's `STARTER_VERSION` was `"2"`: a version written by hand, never bumped as the files changed, so the worker never reported `old-starter`; and an installed starter had no way to update itself.
    - Fix and pin: the version is the content's SHA-256 (`scripts/site/src/admin/starter.ts`), held equal in the two files, `@hcm/shared` and the pipeline by `scripts/site/test/starter-version.test.ts` and the admin's build; the release lists each file's SHA-256 in `/admin/starter.json` and the installed starter replaces itself with the checked file at start, at each worker end and daily; the card shows both versions and, for an out-of-date helper, why and the one command (S-A142-HAPPY-VERSIONS, S-A142-BAD-OLD-STARTER, S-A142-HAPPY-SELF-UPDATE, S-A142-BAD-SELF-UPDATE).
    - **A version of something installed on users' machines is derived from its content and checked by a test, never typed by hand; and what is installed there updates itself from the release it belongs to.**

615. **A test held a layout at a minimum gap that a real card could not hold: the timeline overflowed and clipped its first year.**
    - Seen: 2026-11-12, the Pixel Tablet: twenty-two stops at 30 px each were wider than the card; 1847 showed as "7".
    - Cause: the scroll test only asked that the selected stop was in view and the labels did not meet; nothing asked that the labels stayed inside the card.
    - Fix and pin: the track fits the card with a density (`timeline-model.ts`); `S-V04-BAD-MANY-YEARS-FIT` checks no label sticks out at five window sizes.
    - **A layout check asks what is cut off as well as what overlaps.**

616. **`touch-action: none` on a control inside a scrolling panel turned every swipe across it into input.**
    - Seen: 2026-11-12, the Pixel Tablet: a swipe meant to scroll the Layers panel set a layer's opacity to 4 %.
    - Fix and pin: the slider is `pan-y` and waits 8 px for the finger's direction (`slider.ts`); `S-V22-BAD-TOUCH-VERTICAL-SWIPE` swipes with Chromium's own touch events.
    - **A control that moves along one axis leaves the other axis to the browser; test it with real touch events, not mouse ones.**

617. **A module script waits for every deferred script before it: the engine painted nothing until 526 KB of Mapbox GL had arrived.**
    - Seen: 2026-11-12, the Pixel Tablet: cold first paint 5,376 ms against 764 ms warm.
    - Found by: a throttled cold load (CDP Fast 4G, 4x CPU) with Mapbox's files given their CDN time: the first paint came after `mapbox-gl.js`'s end every time.
    - Fix and pin: Mapbox GL loads `async` and the map adapter takes a promise of it (§178f); `S-V01-BAD-SLOW-MAPBOX-FIRST-PAINT`.
    - Then: with Mapbox's CDN two seconds slower the first paint still came at 2.9 s: `mapbox-gl.css` in the page's head was render-blocking, and unused (the viewer links it in its shadow root). The pages link none now.
    - **A third-party script or stylesheet the first paint does not need is `async` or absent, and the code that needs it waits for it, not the page; measure with the third party slow, not only cold.**

618. **A sticky strip in a half-height sheet hid what the focus scrolled to, and 40 px rows overlapped their 48 px targets.**
    - Seen: 2026-11-13, the viewer tour at 320, 360, 412, 915 × 412, 768 × 1024 and 1024 × 768 px: Layers' switches and sliders "hidden under other content" (WCAG 2.4.11) and "52x40 touch target" (M3's 48 x 48).
    - Cause: the pinned Compare and map-label strip (`position: sticky`) took 170 of the half-height bottom sheet's 310 px, so a Tab scrolled each overlay's switch to the sheet's top, under the strip; and the map-label rows had shrunk to 40 px while each switch's touch ring is 48 px, so neighbours covered each other's rings. The commit that shrank them said "the switch keeps its own 48 px target", and no phone tour ran before the merge.
    - Fix and pin: the strip is static below a large window (1200 × 700 px; a 1024 × 768 side sheet showed the same), Compare's ring has 4 px inside the strip, the map-label rows are 48 px (`packages/ui/src/viewer/hcm-layer-panel.ts`); `S-V03-BAD-LAYERS-PINNED-PHONE`, and the tour at the phone projects.
    - **A sticky header belongs only where it leaves room to scroll; a row is at least as tall as the touch target it holds. Run the tour at a phone size before merging a layout change.**

619. **Three tour states failed on every run: a 19 px link, a pane that cut a story's foot, and a Tab wrap read as a step back.**
    - Seen: 2026-11-13, the viewer tour: at m768 the gallery's "Știu unde" was 19 px tall; at e1024 with WCAG 1.4.12 text spacing "Toate poveștile" was cut off by the docked pane; at c320 in the zoomed full-size view Tab went "back up" from Next to Close.
    - Cause: the gallery's lone link had no `.details` around it, so the sheet's 48 px rule for lone links (the T6 fix) never reached it; the stories sheet's wrapper was a block, as the photo list's had been, so a long story grew past the pane, which hides its overflow; the arrows' row, 24 px gaps apart, reached under Close at 320 px, so the round's wrap from Next to Close shared a column.
    - Fix and pin: `hcm-unplaced-gallery.ts` gives its link a 48 px box; `.stories-sheet` is `display: contents` beside `.photos-sheet` (`viewer-styles.ts`); the arrows' gap is 16 px under 360 px (`lightbox-styles.ts`); `S-V40-BAD-SUGGEST-SMALL-TARGET`, `S-V50-BAD-TEXT-SPACING-ALL-STORIES`, `S-V61-BAD-ZOOMED-TAB-ORDER` on the tour.
    - **A rule scoped to one component's class does not reach the same pattern elsewhere: when one sheet's wrapper or lone link is fixed, fix every sibling with the same shape.**

620. **The grouped lint passed every group and still failed: its EXIT trap named a variable local to `main`.**
    - Seen: 2026-11-12, track/optdev: `scripts/ci/lint.sh` said `out: unbound variable` after the last group, and the `eslint` gate failed with every group clean.
    - Cause: `trap 'rm -rf "$out"' EXIT` runs after `main` has returned, when its `local out` is gone, and `set -u` turns that into exit 1.
    - Found by: the `static` stage on the NUC. Fix: the folder is a global, `LINT_OUT` (§180a); a planted violation then failed the gate and only it.
    - **An EXIT trap reads only globals; a lint wrapper is proved by a planted violation as well as by a clean run.**

621. **The e2e stage in a 12 GB container lost its Firestore emulator to the kernel.**
    - Seen: 2026-11-12, track/optdev: the admin tests failed in under 100 ms each; the kernel log named the killed `java`.
    - Cause: the Functions emulator keeps one Node worker per function trigger (more under concurrent calls), about 250 MB each and never stopped while idle: 46 of them held 8.8 GB.
    - Found by: sampling the container's processes during the run (§180c). Fix so far: the JVMs' heap ceilings (§180d); the workers are §180f.
    - **Measure a tier's peak under the cap it will run with; a run killed for memory looks like a flood of fast test failures.**

622. **The rule-coverage report ran the Firestore emulator out of heap under a 12 GB container.**
    - Seen: 2026-11-12, track/optdev: `ruleCoverage` answered HTTP 500, `firestore-debug.log` said "Java heap space", and the `vitest` and `rules-coverage` gates failed with every test green.
    - Cause: the emulator builds the report whole in its heap: 582 MB of indented JSON, and the HTML view of the same data was asked for at once. The JVM's default heap is a quarter of the container's cap (3 GB); with the JSON alone 3 and 4 GB still ran out.
    - Found by: sampling the emulator's resident memory per heap ceiling on the NUC (§180g). Fix: `-Xmx6g` in `npm test`, the JSON alone streamed to disk, the values dropped as the check parses them; a stubbed short body then showed that `HTTPResponse.read(n)` returns quietly when a transfer breaks, so the save compares what was announced with what came.
    - **A report a gate needs is sized under the cap the gate runs with; a sized read of an HTTP body does not raise on a short body: check `response.length`.**

623. **Three merges on one day left three tests that each branch had passed: a file list, an export fixture and a function count.**
    - Seen: 2026-11-13, the `tests` stage of track/optdev after merging `origin/feat/engine-rewrite`: `test_import_job.py` expected `scan-tiles.bin` (track/georefux) for a crop that track/stripfix now keeps under the preview's 4,096 px; the shared API fixture lacked the governor's eight exports (track/hwgov); `packages/admin/src/setup/controller.ts` fell to 89 % of its functions after the install override (track/prerelease).
    - Cause: each branch ran its targeted tests; nothing ran the whole `tests` stage on the merged tree.
    - Fix and pin: the import test asks the version whether a sharper scan was written; the fixture names the exports (`exports-m7.ts`); `controller-intents.test.ts` drives the install cards' intents. The same run found the colour library's inline option missing in all but one project (§180h).
    - **After merging branches that each passed alone, run the full `tests` stage on the merge before pushing it.**

624. **A map of dark blocks was cropped by a margin it does not have.**
    - Seen: 2026-11-12, track/autostitch's synthetic series: sheets of a grey town (blocks filled, streets paper) lost about 20 px on two sides, differently per sheet, so neighbours' overlaps no longer matched.
    - Cause: the paper level was the 90th percentile, which on a map mostly of ink is the ink; and a ring of streets near the edge read as a frame, its "line" trimmed into the drawing.
    - Fix and pin: the paper is the 98th percentile; a frame counts only with a paper margin outside it; its line is trimmed only while a row is 90 % ink; a margin is at least 2 % of the side (`frame.content_box`; `test_placing_sheetwork.py`, S-P20-HAPPY-STITCH-ABUTTING).
    - **Before cropping a page to its content, prove the margin is paper: a crop that differs per sheet breaks every seam after it.**

625. **A turned sheet's neighbours turned too.**
    - Seen: 2026-11-12, track/autostitch: with three of twelve sheets turned, an upright sheet next to two turned ones was flipped (its seams to them scored better upside down by chance) and a turned one stayed.
    - Cause: the sheets were turned one after another in file order, each judged against neighbours not yet turned back.
    - Fix and pin: surest first: each sheet's gain is ranked, a sheet turns only to a variant that fits strongly and gains 0.2, and it is checked again just before it turns (`autostitch.orient`, S-P20-HAPPY-STITCH-TURNED).
    - **When choices depend on each other, make the surest one first and look again before each next one.**

626. **A seam's residual from chunks of a thin template measured noise.**
    - Seen: 2026-11-12, track/autostitch: line-art seams placed within 1 px reported a residual of 3-170 px, so good series were judged `check`.
    - Cause: thirds of a 10 px wide template were matched anywhere in the strip, and on hatching or plain blocks each third found another place.
    - Fix and pin: the residual is the phase correlation of the two aligned overlaps (`seams._residual`); several template widths are tried and the one whose whole overlap correlates best wins (S-P20-HAPPY-STITCH-SEAMS).
    - **A quality measure must be measured on the same area the decision used, never on a smaller piece searched again.**

627. **A grid prior made silent seams look like a good layout.**
    - Seen: 2026-11-13, the adversarial review of track/autostitch: on a named grid a sheet whose seams were all missing still sat at its prior cell, counted as placed and added nothing to the median, so 2 strong seams of 20 gave `good` and a misread grid would have been mosaicked; the older joins then mosaicked even `poor` layouts with no quality bar.
    - Cause: the measures were taken over the kept seams alone, and a sheet held only by the prior counted as placed.
    - Fix and pin: a sheet counts as placed only when a kept seam touches it, every seam not kept scores 0, and the older joins need their own matches to meet the bar (S-P20-BAD-STITCH-NAMES-NO-SEAMS, S-P20-BAD-STITCH-LEGACY-LOOSE).
    - **A verdict must count what was not measured as a failure, never leave it out of the average.**

628. **The tile wizard and the pipeline agreed on every field name and still disagreed on what the fields meant.**
    - Seen: 2026-11-13, an adversarial review of track/tilewizard against track/autostitch: the wizard showed only `weak` seams while the pipeline ranked `missing` ones lowest; the answer left out `no-seam` sheets, which the pipeline then marked `not-part` for good; a seam answer survived a turn of its sheet. The grid's `touch-action: none` also kept a phone from panning it.
    - Found by: reading both sides' code paths for the same document; every contract test was green, because they compare enums and shapes against a hand-written sample, and Playwright's mouse never pans.
    - Fix and pin: M20 §19.12; `S-A-HAPPY-TILE-WIZARD-{MOVE,SEAM-KEYS}`, `S-A-BAD-TILE-WIZARD-{SEAM-RESET,POINTS-FIRST}`, `happyPath_aSheetLeftOutForNoSeamIsTriedAgainAtItsFreeCell`.
    - **A cross-track contract test pins behaviour, not only names: for each enum value, write down what each side does with it, and test the reader against a file the writer produced.**

629. **A memory budget passed alone and failed in the full run: the child inherited the run's environment.**
    - Seen: 2026-11-13, merging track/autostitch: the colour memory-budget test failed in the full pipeline pytest and passed alone. Measured on the NUC, the two-sheet 12,000 px colour mosaic peaks at 617 MB with GDAL's default threads and at 852 MB with `GDAL_NUM_THREADS=2` (the bound is 800 MB).
    - Cause: the budget children (`tests/budget_probe.py`, `test_placing_canvas_window.py`'s child) took `os.environ` whole, so any GDAL, OpenCV, BLAS or `HCM_` setting present in the run sized them differently from the measurement.
    - Fix and pin: both start without any `GDAL_`, `CPL_`, `VSI_`, `OGR_`, `OPENCV_`, `OMP_`, `OPENBLAS_`, `MKL_`, `HCM_` or `MALLOC_` variable (`test_memory_budgets.probe_env`, `test_bad_path_settings_an_earlier_test_left_behind_never_reach_a_probe`); no budget changed. Open: a worker that sets `GDAL_NUM_THREADS` above 1 needs about 850 MB for two such colour sheets, over the 800 MB the windowed mosaic promises.
    - **A budget measured in a child process is measured in a known environment: strip every tuning variable, never inherit the test run's.**

630. **"Import every direction from the old site" was already done: the 10 photos without one have no cone there either.**
    - Seen: 2026-11-12, the owner: *only one photo near Gara Obor has a direction in our app; on the old site they all have*.
    - Cause: none in the code. Compared with the old site's live `geojson/photos.json` (56 points, 47 cones), 47 of our 57 photos have a cone there and live Firestore has all 47 directions (0 differences), and the 9 photos at Gara Obor without one are pins without a cone on the old site as well; the viewer's year filter leaves one cone (Parc Ferdinand, 1930) at the 1930s. Local `master` is not the old live site (44 points): the live data is `bucurestiuldisparut/bucurestiuldisparut.github.io` (`docs/research/M5-interfaces.md` → *Directions from the old site*).
    - Fix and pin: none needed; S-A28-HAPPY-DIRECTIONS / S-A28-BAD-OWNER-DIRECTION-KEPT already pin the import, and `legacy-corrections.mjs` reproduces `corrections.json` unchanged.
    - **Before re-importing "missing" legacy data, diff the live store against the old site's live file: a gap both share is the owner's to fill, not an import bug.**

631. **The viewer told every visitor how the gamepad was tested: "Standard gamepad (tried only simulated)".**
    - Seen: 2026-11-09, the owner, in the viewer's input list (`input.padTitle`). A sweep of every catalogue and user-facing file then found more of the kind: raw IAM role ids (`roles/run.invoker`), HTTP codes ("(404)"), MIME types, model ids, Firebase uids, "pipeline" and "service worker" inside Romanian, step letters screen readers never hear ("pasul c"), milestone names in an owner's README ("the M5 kit"), and a starter-kit note asking visitors to check the page's integrity hash.
    - Found by: the owner. Every tier was green: the tests assert the catalogue's own text, so a sentence that is correct but written for the developers passes them all, and the tour's leak check looks only for untranslated text and raw message ids.
    - Fix and pin: the texts reworded (`docs/research/DECISIONS-for-review.md` §184); the static gate `copy` (`scripts/ci/check_copy.py`, its terms, sources and allowed uses in `scripts/ci/check_copy.toml`, tests in `scripts/ci/tests/test_check_copy.py`) refuses test, build and milestone words in every catalogue value, the starter kit's page and data, the worker starter's messages and the export's README.
    - **Production copy says what the reader can do, never how the app was built or tested; a word list in a gate keeps it so, because no behaviour test can tell a developer's note from a user's sentence.**

632. **The live map told visitors its historical layers were "coming soon" and that it was hosted on GitHub Pages, months after both stopped being true.**
    - Seen: 2026-11-12, the owner ("make sure we don't have any dev text or old text anywhere"). The Bucharest city's About, credits and privacy came from `scripts/seed/bucharest.city.json` and the legacy manifest, written before the KH-9 and Corona layers went live and before the move to Firebase Hosting; the viewer's empty-state texts promised layers "soon" on every map without any; the worker's local pages still said "Historic City Map" and "copy the command from the admin" after the starter file replaced the command; the owner's guide and the README carried milestone notes, a test log and a self-host limit lifted since.
    - Found by: the owner, reading the live map. The `copy` gate of lesson 631 looked for test and build words only, and only in the catalogues and a few kit files: a sentence that was true when written passes every test that asserts it.
    - Fix and pin: the texts reworded (`docs/research/DECISIONS-for-review.md` §185); the `copy` gate gained the old-text terms ("coming soon" / "în curând", WIP, dummy, debug, placeholder, "GitHub Pages", the old repository's address, the old name) and the sources that carry them (the city seed, a new city's default texts, the landing page, the Hosting and start pages, the worker's local pages); the admin's legacy bundle takes the About, credits and privacy from the city file, so `seed/bucharest/` stays as migrated; `reports/stale-text-live.md` lists the texts a deploy never rewrites, for the owner's Texts editor.
    - **A text that states a fact about the product (where it is hosted, what is coming, what a button is called) goes stale silently: keep such facts out of data where possible, gate the known stale phrases, and remember that Firestore copies of seed texts need a hand edit after the seed changes.**

633. **An extra that threw while it ran would have been kept, half registered, for the whole visit.**
    - Seen: 2026-11-12, review of track/extras (DECISIONS-for-review.md §186): each extra's IIFE header creates `__hcmEngineHost.extras.<global>` before its body runs, so the loader's "registered nothing" check could never fire; a script that downloaded with a valid integrity and then threw resolved with `{}`, cached for good, and Compare failed with `error.mapLoad` at every try. Two engine releases on one page also shared the first one's host: Lit, `@hcm/shared` and the extras of another build.
    - Found by: code review; the unit test faked a case the real build cannot produce (an empty registry after `load`), and no Playwright spec loaded the analytics or gamepad extras through the IIFE.
    - Fix and pin: each extra ends with a ready mark (`<entry>.ready.<global>`, the build's `footer`), the loader uses only a marked extra, drops the half-filled entry and retries; the host has one entry per release (`__hcmEngineHost.v1_0_0`). Pinned by `packages/engine/test/extras/loader.test.ts` (`badPath_aScriptThatThrowsWhileItRunsFailsAndIsRetriedWhole`), `host.test.ts`, `scripts/site/test/engine-extras.test.ts` (the footer is the script's last statement) and S-V63-HAPPY-EXTRAS-CONSENT-AND-PAD.
    - **A loader's success test must check something only the end of the loaded code writes; a test's fake must do what the real artefact does, and a global shared across builds is keyed by the build.**

634. **Update the map put the new pipeline image in front of the old server, and one Hosting timeout failed the whole update.**
    - Seen: 2026-11-09, a live Update the map: the server's build failed at `fetch` on a 10 s connect timeout to Hosting; the pipeline's build, submitted beside it, finished, so `worker.image` named the new image and the local worker's claims were refused by the old server until it was updated.
    - Cause: `packages/admin/src/setup/install.ts` submitted the server and the pipeline at once (only the site waited for the server), and `fetch-script.ts` downloaded each file once.
    - Fix and pin: the pipeline waits for the server like the site, and a stopped server releases neither (S-A56-HAPPY-UPDATE-AFTER-SERVER, S-A56-BAD-UPDATE-SERVER-STOPPED); every download of `fetch` tries four times, 5, 15 and 30 s apart, on a network error, 408, 429 or 5xx (`fetch-script.test.ts`). DECISIONS-for-review.md §187.
    - **When two deploys must agree on a protocol, order them: the side that answers first, the side that asks after it; never "in parallel" because they are independent builds.**

635. **A whole-city date with two paid frames linked only the first.**
    - Seen: 2026-11-12, Find's Whole-city dates: "2 more would need ordering" was one link to the first paid frame's page; the second could be bought only by finding it in the list.
    - Fix and pin: each paid frame has its own Buy this scan: {frame}, or Your order: {frame} with its chip while the order is open, Order it again: {frame} once it expired (`paidFrameList` in `packages/ui/src/admin/imagery/orders/order-list.ts`, rendered by `join-card.ts`; `packages/ui/test/admin/imagery/join-paid.test.ts`; S-A66-HAPPY-BUY-EVERY-PAID, S-A66-BAD-PAID-ORDERED).
    - **A count that stands for several things is not a link to one of them: list each with its own action.**

636. **A visually hidden caption far down a scrolled page made the whole admin scroll into blank space.**
    - Seen: 2026-11-12, the tour's new `no-blank-scroll` checker: the Historical imagery, orders and georeferencer pages and the overlays settings scrolled 639 to 900 px of nothing under the shell (the owner's black area of 2026-11-09).
    - Cause: an absolutely positioned element is clipped only by ancestors between it and its containing block; the page's scroller is not positioned, so the `.visually-hidden` captions and labels took the frame as their containing block, escaped the scroller and stretched the document.
    - Fix and pin: the page's scroller is positioned, so it is their containing block and clips them (an `overflow: clip` on the frame, then the root's own `overflow: hidden`, cut the bottom bar's focus rings at the window's edge: the bar's rings are drawn inside their items, as the rail's were), the framed admin's root hides its overflow and overscroll (`<hcm-admin-shell data-frame>`), and every tour state runs `no-blank-scroll` (S-A31-HAPPY/BAD-NO-BLANK-SCROLL).
    - **An app shell hides the root's overflow, and a scroller that holds absolute elements is positioned, so it clips them.**
637. **A sticky strip in a short sheet hid the controls scrolled under it.**
    - Seen: 2026-11-12, the viewer tour at 360 × 800 and 915 × 412: the Layers strip pinned on 2026-11-10 covered the overlay switches and sliders the list scrolled under it (focus obscured, targets of 52 × 32 and 4 × 44), and at peek height Tab reached the strip's switches where nobody could see them; the overlay rows' 48 px rings also overlapped one another (52 × 40).
    - Fix and pin: the strip is sticky in the docked pane only; the overlay rows and the map-label rows are 48 px each (`packages/ui/test/viewer/hcm-layer-panel.test.ts`, the tour's Layers states).
    - **Pin a strip only where the pane is tall enough; a modal sheet's content scrolls whole, and rows of 48 px targets are 48 px apart.**

638. **A track that moved code into a lazily loaded part left the part asking for a binding its host never gave.**
    - Seen: 2026-11-13, the merge queue (track/mergequeue): after track/extras the engine's build refused swipe compare's extra (`compare carries packages/shared/src/i18n/...: it must take it from the host`).
    - Cause: track/extras listed the host's bindings for the code compare had when it branched; `feat/engine-rewrite` then gave compare `localizedCredit` from `@hcm/shared/credits`, a subpath the host did not map.
    - Found by: the extras' own build check (`scripts/site/src/engine-extras.ts`). Fix: `@hcm/shared/credits` maps to the same host entry and `host-shared.ts` exports `localizedCredit`; the side part's kit test (`packages/ui/test/viewer/extras-loader.test.ts`) guards the other lazily loaded part the same way.
    - **After merging branches that touch a lazily loaded part or what it imports, build the engine and run the part's kit test before anything else: its binding lists are written by hand and go stale silently.**

639. **A merge of tracks that renumbered the same lessons and decisions moved some references and missed others.**
    - Seen: 2026-11-13, the merge queue: stale-text's lessons became 621 and 622, but `.agent/skills/web/i18n_skill.md` and `ci_quality_gates_skill.md` still cited `LESSONS.md` 594, 595 (an unrelated release-channel lesson).
    - Cause: the renumbering matched `lesson N` and `§N` only, not `` `docs/LESSONS.md` N ``.
    - Fix and pin: every reference a merged track added is renumbered by the lines that track added, in each of the forms `lesson N`, `lessons N, M`, `` LESSONS.md` N ``, `§N` and `DECISIONS §N`; the merge note under each renumbered decision says the old and new numbers.
    - **When a merge renumbers a lesson or a decision, search the track's own added lines for every way the repository cites one, not only the common one.**

640. **Two merged fixes each passed their own tour and failed each other's: an app shell cut a 320 px viewer, and a reworded note broke the test that read the old one.**
    - Seen: 2026-11-13, the merge queue's viewer tour at c360, m768 and l1440: `viewer.menu-shortest-landscape` (568 × 270, from `feat/engine-rewrite`) found the map cut off by the body (`[edge]`, `[focus-ring]`), and `kit.loading-note` looked for "README.md" in the starter kit's late note.
    - Cause: track/layout made the city pages app shells (`overflow: hidden` on the root) while the viewer kept `min-block-size: 320px`, taller than the window; track/stale-text reworded the kit's late note to "Reload the page." but `e2e/tour/kit-states.ts` still read the old sentence.
    - Fix and pin: the viewer's least height is 240 px (`viewer-styles.ts`), so a 270 px window shows it whole; the kit state reads the new advice in both languages; cdn/engine rebuilt.
    - **After merging tracks, run the tour on the merged tree before calling it green: a track's own green tour never saw the other track's states or copy.**

641. **A coalesced scrub lost its last year: the viewer wrote the store's year back into the timeline before the frame sent the newer one.**
    - Seen: 2026-11-13, track/timeline, `S-V04-HAPPY-TOUCH-SCRUB` at every functional project: a finger moved from 1968 over 1969 to 1970 and held left the slider at 1969.
    - Cause: during a press `hcm-timeline` sends its first new year at once and the next one at the following animation frame; meanwhile the store's 1969 re-rendered the viewer, whose `.value=${state.year}` set the timeline back to 1969, and the frame then sent `this.value`, 1969, so 1970 was never sent.
    - Fix and pin: `YearSends` keeps the year it was given and sends that (`timeline-sends.ts`); `hcm-timeline-tip.test.ts` rewrites the value mid-scrub as the viewer does and expects the last year.
    - **A deferred send must carry the value chosen when it was deferred, never re-read a property the parent may rewrite in between.**

642. **A finger on the timeline's track panned the page instead of scrubbing: the card's `touch-action: none` stopped at its scroller.**
    - Seen: 2026-11-13, track/timeline, the first Playwright runs with Chromium's own touch events (`S-V04-HAPPY-TOUCH-SCRUB`): one `pointermove`, then `pointercancel`, so every scrub ended a year short; the unit tests' synthetic pointer events never asked the browser.
    - Cause: a browser computes a touch's allowed gestures from the target up to the nearest scroll container; the card's `.scroller` is one (`overflow: auto`), so the host's `touch-action: none` never applied to the track inside it.
    - Fix and pin: `.scroller` and `.track` inherit the card's touch-action (`timeline-styles.ts`); `hcm-timeline-tip.test.ts` reads it on the track, roomy and scrolling.
    - **Set touch-action inside the nearest scroll container of the element a finger lands on, and test a gesture with the browser's own touch events, never only with synthetic pointer events.**

643. **Spatial navigation stepped from a button into the map: the canvas under every control was the nearest box "to the right".**
    - Seen: 2026-11-13, track/consoles, `packages/ui/test/viewer/spatial-nav.test.ts`: ArrowRight from a top-left button focused the map's canvas, not the menu button.
    - Cause: the canvas is tabbable and covers the whole viewer; its centre lies right of (and below) every control, with no gap ahead or across, so it always scored best.
    - Fix and pin: a box that holds the middle of the focused control is around it, not beside it, and is never a step's target (`encloses` in `spatial-nav.ts`); a step from the map starts from the viewer's middle.
    - **A geometric focus search must skip the containers under the focus (the map, a scrolling pane), or the biggest box wins every direction.**

644. **A thicker focus ring for the TV was cut by Mapbox's box on the map and on its logo.**
    - Seen: 2026-11-13, track/consoles, the tour's journey `tv` at 1920 × 1080: `[focus-ring]` on the canvas and on Mapbox's logo, cut by `div.map.mapboxgl-map`, which hides its overflow.
    - Cause: the canvas's inner ring was `outline-offset: -3px` and the logo kept the kit's 2 px offset, both fitted to the 3 px ring; the 6 px one reached past the box.
    - Fix and pin: both offsets follow `--hcm-focus-ring-width` (`viewer-styles.ts`), the full attribution's padding too.
    - **A ring width that changes must change every offset written for the old width; search the styles for the old number.**

645. **A strip scanned right to left was joined left to right, and the layer ended at the seam: half the city.**
    - Seen: 2026-11-13, live: the KH-7 GAMBIT frame DZB00403000026H017001 (12 July 1966) covers all of Bucharest, but its layer `kh-7-gambit-12-iulie-1966` covered 49 % (lat 44.437 to 44.55); the crop stopped at a white edge.
    - Cause: USGS letters the strip's two segments in the film's order, right to left (`_b` lies left of `_a`), and `stitch` always put `_b` right of `_a`. Its match strip was the segment's first 160 px, the scanner's bright edge band, and it matched the other segment's band at 0.90, so the wrong join looked sure; `locate` then proved the city on `_a` alone.
    - Found by: the rehearsal's own copies on the NUC (`frame.json` placed `_b` at x 36 046 of `_a`'s 36 346) and the preview, where the city lay at `_a`'s left edge and `_b`'s right one; the first pair matched both ways on every real multi-segment frame.
    - Fix and pin: the matched strip starts `EDGE_SKIP_SHARE` in from the edge; the first pair is matched both ways and the better way holds for the frame; a pair under `MIN_PAIR_SCORE` either way is a segment of another frame and fails the step (S-P01-HAPPY-KH7-TWO-SEGMENTS, S-P01-BAD-SEGMENT-OTHER-FRAME; the generator's `kh7_segments`). An imported scene had no way back in: the scene page's **Import again (free)** (`imagery.import` with `again`) makes a new version of its layer that replaces the old one once approved (S-A12-HAPPY-IMPORT-AGAIN, S-A12-BAD-IMPORT-AGAIN-MOVED).
    - **A delivery's file order is the film's, not the image's: find the order from the pixels, and never match on a scan's own edge.**

646. **A search that outgrew its timeout told the owner only "Something went wrong on the server".**
    - Seen: 2026-11-13, live: Search USGS again on the scene page failed; `imagery-search` logged Cloud Run's "maximum request timeout" while the harvest went on for over 7 minutes (five datasets, two at the 500 cap and searched again per target year, ten years).
    - Cause: every dataset, target year and scene write ran one after another, with nothing to stop it before the 300 s timeout; the cut-off reached the browser without the callable's details, which reads as `apiError.internal`.
    - Found by: the function's logs (`mcp__firebase__functions_get_logs`, read only).
    - Fix and pin: datasets at once, target years two at a time, writes 25 at a time, no USGS page after `SEARCH_BUDGET_MS` (360 s), timeouts 540 s and 550 s; a search that failed with no reason after 5 minutes says it was cut off and what to do next (S-A11-BAD-SEARCH-CUT-OFF).
    - **A long call needs a budget of its own inside its timeout, and a failure the browser cannot read must still be told from the call's own context.**

647. **A press meant to open the collapsed timeline also moved its year.**
    - Seen: 2026-11-13, track/timeline-b, `timeline-dock.test.ts`: a press on the pill (V67) opened the card and called `setYear(null)`.
    - Cause: the dock's `@pointerdown` listened in the bubbling phase, after the timeline's own track listener inside its shadow root had already selected the stop under the press.
    - Fix and pin: the dock catches the press in the capture phase (`{ capture: true, handleEvent }`), stops it and opens the card; the test asserts no `setYear` call.
    - **A wrapper that must take a press away from the element it wraps listens in the capture phase; a bubbling listener runs after the element has acted.**

648. **Tab from the timeline skipped the photos chip whenever the year had several dates.**
    - Seen: 2026-11-13, track/timeline-b, the tour's journey `timeline-dates` at c320, c360 and c915l: "Tab never reaches Fotografii din jurul anului 1980".
    - Cause: the keyboard's year chip shows while the slider has the focus on a year of several dates, and the photos chip under it stepped aside with `visibility: hidden`, which also takes it out of the Tab order; the next Tab went past it.
    - Fix and pin: under the keyboard's chip (`tipping="focus"`) it steps aside with `opacity: 0` and no pointer (`dock-styles.ts`), so it keeps its place in the Tab order and shows again as the focus reaches it; under a finger's or a mouse's chip it is still hidden; the collapsed pill shows no year chip at all.
    - **To move a control out of sight for a moment while the keyboard is nearby, never use `visibility: hidden` or `display: none`: they take it out of the Tab order.**

649. **A WebGL context restore threw inside Mapbox and left a blank map; a browser's own script filled the crash list.**
    - Seen: 2026-11-08 and 11-11, the admin's Crashes page: "Cannot convert undefined or null to object" at `ModelManager.load ← reloadModels ← Map._contextRestored` (mapbox-gl 3.34.1), and two Firefox-for-iOS groups (`__firefox__`) whose only frame was the page's address at line 1.
    - Cause: Mapbox reloads every style fragment's 3D models with `Object.keys(this.modelUris[scope])`, and a fragment that never had a model has no entry; the reader-mode script of Firefox for iOS runs in every page and fails on ours.
    - Fix and pin: `packages/ui/src/map/context-restore.ts` gives the missing scopes an empty list in a capture listener that runs before Mapbox's (`packages/ui/test/map/context-restore.test.ts` reproduces the throw without it); `crashNoiseOf` drops injected, extension and aborted errors with their reason (`packages/shared/test/telemetry/crash-noise.test.ts`).
    - **Read the Crashes page's top frames before fixing: a group whose stack is all Mapbox can still be ours to work around, and one whose stack is the page at line 1 is the browser's.**

650. **The telemetry track left three files over their line limit, and nobody saw it until the next track added a line.**
    - Seen: 2026-11-13, track/analytics merging track/telemetry: ESLint's `max-lines` failed on `packages/shared/src/index.ts` (402), `packages/engine/src/core/store.ts` (404) and `packages/admin/src/app/mount.ts` before any line of this track counted.
    - Cause: the paused track never ran its `tests` and `static` stages after its last commits (its open items said so).
    - Fix and pin: the shared index re-exports the field events' types with `export type *` and the funnels from a subpath, the store's zoom and window size moved out (`compass.ts`, `window-size.ts`), the admin's telemetry wiring moved to `telemetry-wiring.ts` (DECISIONS-for-review.md §200h).
    - **Merging a paused track: run ESLint over every file it touched before adding your own lines, or its debt reads as yours.**

651. **A class field initialised from `this.deps` was undefined: the store's `deps` is a constructor parameter property.**
    - Seen: 2026-11-13, track/analytics, writing `readonly logInput = inputLogger(this.deps.telemetry)` in the viewer store.
    - Cause: with `useDefineForClassFields` a field initialiser runs before the constructor body that assigns a parameter property, so an eager read finds nothing (the store's other field arrows read `this.deps` only when called).
    - Fix and pin: `inputLogger(() => this.deps.telemetry)` reads it when used (`packages/engine/src/core/viewer-analytics.ts`, `packages/engine/test/core/store.test.ts`).
    - **A class field may close over `this.deps`, never read it while the object is built.**

652. **A catalogue line over 140 columns is refused by the i18n gate, not wrapped.**
    - Seen: 2026-11-13, track/analytics: Prettier wrapped the Statistics page's long help texts onto two lines and `check_i18n.py` refused them ("not a one-line entry").
    - Fix: shorter texts, one idea a key (`adminContent.statistics.how1` … `how6`).
    - **Write a catalogue message to fit its line with its key (about 90 characters): split a long help into numbered keys.**

653. **The date menu hung on a 16 px badge, too small for a finger or a mouse, and the pill was too small too.**
    - Seen: 2026-11-13, the owner on beta.1 (V13 and V12): "The date picker should show up when the user selects a year with multiple dates, not when the user taps the badge", and the phone's year pill was too small.
    - Cause: the badge was made a target of its own (a click handler on a 16 px span, lifted above the thumb's touch ring) instead of a hint; the menu followed a separate gesture rather than the selection itself. The pill kept the lying thumb's 40 px.
    - Fix and pin: the badge takes no pointer; the timeline asks for the menu when a press the visitor lifted ends on a year of several dates (`settle(released)` in `timeline-pointer.ts` and `timeline-scrub.ts`; a cancelled or swiped-away press says `false`), on Enter and on the gamepad's A (a click with `detail` 0), never while a drag passes it; B closes it through the input `close`. The pill is 56 px in a 64 px card, the year in title large. Pinned by `hcm-timeline-dates.test.ts`, `timeline-dock.test.ts`, `S-V68-BAD-SCRUB-PASSES` and the tour's `timeline-dates`.
    - **A choice that follows a selection opens on the selection's end (the release, Enter), never on a decoration beside it, and never on each step of a live drag.**

654. **A test of a module's "not loaded yet" state failed only beside other test files.**
    - Seen: 2026-11-13, `ship.sh`'s targeted run (`vitest related`, 571 files): `packages/admin/test/app/color.test.ts` expected `themeFromSeed` to throw before a theme loads; alone it passed.
    - Cause: another file in the same worker had loaded the colour library, and the module's state is shared by every test of that worker.
    - Fix and pin: the test takes a fresh copy (`vi.resetModules()` and a dynamic `import`) before asserting the unloaded state.
    - **A test of a module's initial state imports a fresh copy; never trust module state left by whoever ran before.**

655. **Every KH-9 panoramic preview failed with "cannot be fetched right now, try again", and Try again never helped.**
    - Seen: 2026-11-13, the live admin, D3C1207-300256A038 and D3C1212-300570A079; the logs read `UpstreamError: remote call failed: invalid`.
    - Cause: USGS's Declass 3 browse images are 7 to 13 MB (`curl -I` on `ims.cr.usgs.gov/browse/declass3/…`); `RemoteFiles` stops at `BROWSE_MAX_BYTES` (5 MB) and calls a longer file `invalid`, which the browse proxy turned into the retryable "unavailable".
    - Fix and pin: the fetch takes up to 30 MB in 30 s and stores a file over 5 MB shrunk to a 4,096 px JPEG; each failure records what failed (`browseNotImage`, `browseTooLarge`, `browseUnavailable`) and says what to do (`functions/test/imagery/browse.test.ts`, S-A12-HAPPY-LARGE-BROWSE, S-A12-BAD-BROWSE-SPECIFIC).
    - **Measure a real upstream file before choosing a size cap, and never word a failure that a retry cannot fix as "try again".**

656. **The whole-city plan kept offering to buy a scan that is all cloud over the city.**
    - Seen: 2026-11-13, the owner on DS09066A047MC019 (1964): "This scan is useless (too many clouds!!!)".
    - Cause: declassified records carry no cloud cover, so the rank scored every frame's clouds "unknown", and nothing let the owner set a scene aside: the client rule allowed `rejected`, but no screen wrote it and a client write would not rewrite the plan.
    - Fix and pin: the browse image's clouds over the city are measured (`cloud-estimate.ts`) and rank, card, page and Buy this scan say so; `imagery.markScene` sets a scene aside with why and writes the plan again (S-A152-*).
    - **When a choice the server makes for the owner can be wrong, give the owner a one-click way to overrule it, and make the server act on it at once.**

657. **The e2e count of Create the measurement reports still said 14 after §200 had registered 22 parameters.**
    - Seen: 2026-11-13, track/gadata adding `app_surface`: `e2e/admin/steps/analytics.spec.ts` asserted 14 creations while the unit test of `analytics-reports.ts` said 22.
    - Cause: the track that added eight dimensions updated the Vitest count and not the Playwright one (the e2e tier was not run before the merge).
    - Fix and pin: both counts follow `FIELD_DIMENSIONS` and `FIELD_METRICS` (23 now); a new parameter changes both in the same commit.
    - **A count asserted in two tiers changes in both, or the slower tier keeps the old truth until someone runs it.**

658. **GA4's funnel report is not in the Data API's stable version.**
    - Seen: 2026-11-13, track/gadata: `runFunnelReport` exists in `v1alpha` only; `v1beta` has `runReport` and `batchRunReports`.
    - Fix: the Statistics view computes the funnel (who left before each step) from `runReport` rows of `step_view` in the page's step order (`packages/admin/src/google/analytics-data.ts`).
    - **Check an API method's version before you design on it; build on the stable one and compute what it lacks.**

659. **The NUC's worker listed nvidia-smi's error sentence as a graphics card, and the admin called the worker out of date.**
    - Seen: 2026-11-13, the NUC (Intel Arc, NVIDIA's tools installed, no NVIDIA driver): `/state` listed a card named "NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver…" and a second with an empty name; the empty name failed `workerMachineSchema`, so "This computer" asked to update a current worker.
    - Found by: the owner reading `/state`; the starter's test only faked an nvidia-smi that succeeds or is missing, never one that fails on stdout.
    - Fix and pin: the starter keeps nvidia-smi's rows only on exit 0 and in shape, names cards by `lspci`, says `no-driver` for an NVIDIA card it cannot reach; the worker drops a card with an empty, multi-line or overlong name; the card links to NVIDIA's drivers. `S-A141-BAD-NO-DRIVER` (`starter-governor.test.ts`, `test_governor_probe.py`, `machine.test.ts`).
    - **A command's output is data only when the command succeeded and the output has the expected shape; never parse a failure's text as a value.**

660. **The worker's governor logged the same line every five seconds, for ever.**
    - Seen: 2026-11-13, `docker logs hcm-worker` on the laptop: "this computer: quiet (user-active), 4 threads, 5880 MB", then 5881, 5856, … one line a tick.
    - Cause: the line was written whenever the budget changed, and the memory budget (35 % of what is free) moved by a few megabytes each tick.
    - Fix and pin: the memory budget counts whole 256 MB steps, and the line is written only when the profile, its reason or the threads change (`test_the_log_says_a_change_of_state_only`).
    - **Log a state's change, not each reading of a noisy number; quantise a budget that follows a measurement.**

661. **The canvas test passed on one thread and the worker needed 870 MB on sixteen.**
    - Seen: 2026-11-13, the worker on the laptop and the NUC: two large colour sheets mosaicked past the 800 MB budget that `test_placing_canvas_window.py` held, because the test's child ran GDAL on one thread and the worker runs it on the cores but one.
    - Cause: GDAL's threads allocate from glibc's per-thread malloc arenas, which keep freed pages; about 115 MB of the layout's reads stayed resident while the canvas read its own.
    - Fix and pin: `python -m hcm_pipeline` starts with at most two arenas and the canvas gives the free pages back before and after each sheet (`heap.py`); the budget test runs on one thread and on `ALL_CPUS` (`S-P31-HAPPY-CANVAS-THREADS`).
    - **A memory budget test runs with the thread count production uses (and one), and a threaded C library's freed memory is not free until it is given back.**

662. **A second worker failed every archive series it took: the scanned maps were on another computer.**
    - Seen: live, 2026-11-13: after the NUC and the PC joined the laptop, five archive series failed at `gather` with "no record of
      ar-971b77774eee2871 on this computer", and an atlas used up its attempts on the same cause.
    - Found by: the owner's Jobs page; every test ran one worker, which always held the archive it imported.
    - Fix and pin: a worker without the sheets hands the job back unspent and the computer with the archive sends a copy through the
      bucket (M20 §20; `functions/test/worker/archive-host.test.ts`, `pipeline/tests/unit/test_archive_copy.py`).
    - **Data that lives on one machine needs a test with two workers: one that has it and one that does not.**

663. **Every Linux worker refused its own local AI: the starter read the worker's image instead of the AI's.**
    - Seen: 2026-11-13, the owner's PC (WSL) and the laptop: `local AI: refused an unexpected program image` every 20 s (286 times on the PC), the sidecar never started and every locate waited 30 minutes, then "the sidecar did not come up"; the frames fell to the admin's points.
    - Cause: `ai_image` in `hcm-worker.sh` took the last `"image": "…"` of the whole `/state` line with a greedy `sed`; since the worker added its own `image` (`sha256:…`, after `ai`), that was the match, and the check refused it. The tests fed `/state` as the `ai` record alone, so they never saw the second field. The Windows starter parses the JSON and was right.
    - Fix and pin: the starter reads `image` inside `"ai": {…}` only; the sidecar tests now feed the worker's whole `/state` (its own `image` and `starter` after `ai`). Starter version `fae0e8664ab5`.
    - **A test of a parser feeds the producer's real, whole output, never the one field the parser wants; a shell `sed` over JSON is greedy across fields.**

664. **The Statistics view blamed missing measurement names that Setup had just reported as all there.**
    - Seen: 2026-11-13, the owner's live test: "Google Analytics does not know the map's measurement names yet", while step g said "0 created, 23 already there"; an hour later the read worked, with no values for the custom names yet.
    - Cause: every HTTP 400 of `batchRunReports` was mapped to `noReports`. GA4 refuses the whole batch for one field its Data API does not list yet, and a name registered a few hours earlier is not listed yet; the fake answered 400 only for unregistered names, so the case never showed.
    - Fix and pin: the read asks the property's metadata first, sends only the reports it can answer, and says which of not registered, not ready, or no values yet (`analytics-fields.ts`); another 400 is `refused`. `S-A153-BAD-NOT-READY`, `-NOT-REGISTERED`, `-NO-DATA`, `-REFUSED`.
    - **Map an error code to a cause only when the code means that cause alone; a generic 400 is "refused", and the specific causes are found by asking, not guessed.**

665. **Under WSL the worker read "someone is typing" every five seconds, forever.**
    - Seen: 2026-11-13, the owner's PC (`ssh w5090`, WSL Ubuntu, the systemd user service `hcm-worker`): `host-hints.json` said `"idleS":0` on every pass, so the governor read `user-active` and Automatic never left Quiet (4 of 16 threads), whether or not the owner was at the PC.
    - Cause: the POSIX starter's last idle source, logind's `IdleHint`, is always `no` in WSL (there is no desktop session), and `no` was written as 0 seconds. Reading Windows instead has two traps: a systemd service has no `WSL_INTEROP` (powershell.exe fails with "Invalid argument" through `/run/WSL/1_interop`), and a process that sshd's `wsl.exe` started runs in session 0, whose `GetLastInputInfo` never sees a key and returns the uptime (82209 s, against 1614 s from the console session's socket).
    - Fix and pin: under WSL the starter reads `GetLastInputInfo` through powershell.exe (`-EncodedCommand`, as `hcm-worker.bat` reads it), trying `/run/WSL/*_interop` until a process in a session other than 0 answers, at most every 30 s, the answering socket first next time; no answer is an empty `idleS`, never 0 (`S-A141-HAPPY-WSL-IDLE`, `S-A141-BAD-WSL-NO-INTEROP`).
    - **An idle source that cannot see the person must say nothing, not "active"; and on Windows, check which session a reading comes from.**

666. **`imagery-onJobWrite` ran out of its 256 MiB four times in a day: three frames ending together each read the whole city.**
    - Seen: 2026-11-13, the admin's Statistics page, Cloud Error Reporting: "Memory limit of 256 MiB exceeded" (4 times, revision `imagery-onjobwrite-00043`); the function's log showed three events in one instance within a second, each ending in "date plan rewritten" over about 480 frames.
    - Cause: `rewriteDatePlan` reads every scene and every layer version of the city, and the trigger takes 80 events at once (`GLOBAL_OPTIONS.concurrency`), so frames ending together held several copies of the city in memory.
    - Fix and pin: one rewrite per city at a time in an instance; calls that come meanwhile share one more rewrite that starts after them, so the plan still shows their write (`functions/src/imagery/join-plan.ts`; `functions/test/imagery/join-plan-flight.test.ts` reads the city three times without it).
    - **A trigger with concurrency above one multiplies whatever one event reads: a read of a whole collection is coalesced per key, not repeated per event.**

667. **A label fixed at the source stays wrong in every record written before the fix.**
    - Seen: 2026-11-13, track/coronacrop: the id rules that name KH-5 Argon frames landed on 2026-11-09, but the 249 `corona2` scenes harvested on 2026-10-25 kept the fallback KH-4A, and the import copied it: an Argon frame, 550 km square, was searched as a Corona strip and shown whole with the city a speck (`DS09065A073MC043`).
    - Fix: `trueSensor` reads a stored fallback camera again by the frame's id at import (`functions/src/imagery/scene-record.ts`, DECISIONS §209).
    - **When a rule that derives a stored field changes, correct the stored records too (or read them through the rule), not only new ones.**

668. **The map pane's list pushed the map 80 px below the scan, and no check compared the two panes.**
    - Seen: 2026-11-13, the owner in full screen at about 2000 × 1125 (`#/georef/…`): "The right screen should be the same size and aligned with the left one, as it was before."
    - Cause: *The map shows* (§173, track/georefbase) went above the map inside the map pane's own flex column, so the map started under it while the scan started at the pane's top; the turn rows and notes followed at different heights. The tour's checkers look at each element (overlap, edges, targets), never at two elements that must line up, so every state stayed green.
    - Fix and pin: the panes share one grid's rows by subgrid (header, view, turn row, note, `georef-styles.ts`); on a compact window both panes sit in the same cell and the hidden one is `visibility: hidden`, so the switch keeps the view in place. `expectPanesAligned` (`e2e/admin/specs/imagery/georef.ts`) compares the views' top and height and the turn rows' top within 1 px, in the page and in full screen and on the map-shows state (`S-A122-BAD-GEOREF-PANES-MISALIGNED`).
    - **Two panes meant to be compared side by side share their rows in the layout itself (one grid, subgrid), and a test measures them as a pair; a control added to one pane goes in a row both have.**
    - Also found: the map-shows test chose from the list without showing the map pane, so at `admin-c360-ro` it waited for a hidden list until its 480 s ran out (on the base commit too); it now shows the map pane first.

669. **The published 1895-1899 layer had three white patches where three pieces were never placed.**
    - Seen: 2026-11-13, the owner on layer `1895-1899` (version `ar-mw993zri-s-4054e55659a3`): white patches near Grivița, Obor/Gara de Est and Tineretului. The version's `help.stitched` said `joined 57`, `leftOut` img366, img390, img418 (`no-join`); all three files are in harti.zip, not blank, and are the same printed plan as the overview `Harta Bucuresti 1895.png`.
    - Cause: `fit_tiles` matches each piece against the whole overview's 20,000 ORB features; on the quiet edges of town (rail yards, fields, a park) a piece's features lose the 0.75 ratio test to look-alikes elsewhere on the sheet, so fewer than 10 inliers survive. The consensus filter only rescues weak fits that exist; a piece with none was dropped, and the series was published with the holes.
    - Fix and pin: a second pass, `overview_holes.refit_in_holes`: once the others are placed, a left-out piece is turned and scaled by their consensus (as scanned and upside down: img418 was scanned the other way up) and searched by normalised cross-correlation only where it covers uncovered overview, kept when it clearly beats every other place, refined by its features within that window. Real files: 0.96 / 0.91 / 0.90 against next bests 0.66 / 0.51 / 0.15, 60 of 60 placed. `S-P20-HAPPY-OVERVIEW-HOLES`, `S-P20-BAD-OVERVIEW-HOLES-NOT-FOUND`. A published series had no way to be stitched again (its `place` only re-warps the kept picture through the pairs): Locate again now starts a new version that lays it on the overview again with the pairs kept (`S-A122-HAPPY-RESTITCH`, `S-P20-HAPPY-RESTITCH`).
    - **A placer that leaves parts out has learnt the series' scale, turn and the remaining holes from the parts it placed: search the left-out ones again with that knowledge, in the holes only, before publishing a picture with gaps.**
670. **Firebase Auth moves a sign-in out of `sessionStorage` into IndexedDB never.**
    - Seen: 2026-11-13, track/adminsite: the admin's own site uses `[indexedDBLocalPersistence, …]`; a user found in `browserSessionPersistence` stays there, because only persistences with `_shouldAllowMigration` (IndexedDB, `localStorage`) are migrated (`PersistenceUserManager.create` of `@firebase/auth`).
    - Fix: the own site's hierarchy is `[indexedDBLocalPersistence, browserLocalPersistence]`; the e2e puts the test's account into `localStorage` once on that origin, which Firebase moves into IndexedDB, so a second tab proves the shared sign-in (`e2e/admin/specs/shell/admin-site.spec.ts`).
    - **Read the SDK's migration rule before you change a persistence; a test that seeds one store proves nothing about another.**

671. **Hosting's redirects come before its files, and its regex is RE2.**
    - Seen: 2026-11-13, track/adminsite: forwarding the public map's `/admin/**` to the admin's own site would also have forwarded `/admin/starter.json`, which Linux starters already installed fetch with `curl` and no `-L`; RE2 has no lookahead to leave it out.
    - Fix: the forward's pattern lists every string but that name (`everyStringBut`, `scripts/site/src/hosting/admin-site.ts`) and the file stays in the public tree.
    - **Before a redirect replaces a path, list every client already installed that reads it and whether it follows redirects.**

672. **The date menu's peek took every press over the map, and opened over the zoom buttons.**
    - Seen: 2026-11-13, the tour's new `timeline-peek` state (V68, §195i) at 360 and 1024 wide: the map, the legal line, the compass, the zoom and the menu button "covered" by `hcm-date-menu`, and the menu over the zoom group and the photos chip.
    - Cause: the viewer's `.modal-layer > * { pointer-events: auto }` sits outside the menu's shadow root and beats its own `:host { pointer-events: none }`; while the menu was always modal its scrim hid that. Its place beside the year ignored the floating controls, which the inert frame under a modal menu had excused.
    - Fix and pin: `.modal-layer > hcm-date-menu { pointer-events: none }` in `viewer-styles.ts`; the dock measures the compass, the zoom, the menu button and the photos chip as the menu opens and the menu moves the shortest way past them (`date-menu-clear.ts`). Pinned by `timeline-dock-peek.test.ts`, `date-menu-clear.test.ts` and the tour's `timeline-peek`.
    - **A host's own `:host` rule loses to any rule its parent's shadow root sets on it; a non-modal overlay states its pass-through where it is placed, and keeps clear of the controls it no longer makes inert.**
673. **A computer without a screen could only be paired by stopping the owner's own worker and tunnelling a port.**
    - Seen: 2026-11-13, pairing the NUC and the Windows PC by hand (`docs/research/M7-local-worker.md`, *Household computers*).
    - Cause: the admin's auto-pair posts the code from the browser to the browser's own loopback (`127.0.0.1:8765`); a headless
      computer has no browser, so its worker was reachable only through an SSH tunnel to the laptop, with the laptop's worker stopped.
    - Fix and pin: the starter itself takes the one-time code (standard input, never argv) and posts it to its own worker's `/pair`
      (`S-A143-HAPPY-HEADLESS-PAIR`, `functions/test/worker/starter-household.test.ts`).
    - **What a browser does for its own computer, the helper on that computer must be able to do too: never route one computer's
      loopback through another.**

674. **A search reach in fixed shrunk pixels stopped short of a wide segment's overlap.**
    - Seen: 2026-11-13, track/corona68: the 1968 Corona frames DS1103-1058DF026 and DF027 (four 36 070 × 11 374 px segments, lettered right to left) overlap by about 23 % of a segment's width (8 200 px). `coarse_match` searched only the last 1 200 shrunk pixels (6 000 px at the 5 times shrink), so every pair matched a wrong place at 0.8 or so, the frame repeated a third of itself and looked mirrored where the repeats met, and DF027's city fell outside its crop.
    - Fix: the reach is the segment's shrunk height (`SEARCH_HEIGHT_SHARE`), capped at `MAX_OVERLAP_SHARE` of its width (`pipeline/src/hcm_pipeline/steps/stitch.py`; `pipeline/tests/unit/test_stitch_order.py`, S-P01-HAPPY-CORONA-WIDE-OVERLAP). Measured on the real segments: the true offsets score 0.96 to 0.99.
    - **Scale every search window with the image it searches, and check a stitch's offsets against a direct match of the real segments before blaming the film's orientation.**

675. **A redirect added for people broke a download that refuses redirects.**
    - Seen: 2026-11-13, track/adminsite: once the public map's `/admin/…` answered 301 to the admin's own site, Update the map from a tab on the old address failed at "Download and check the install files" with `unexpected redirect`: the build's `fetch` uses `redirect: 'error'` and the tab named its own (old) origin as the bundle's.
    - Fix: the `fetch` step follows one redirect, only to `HCM_REDIRECT_ORIGIN` (the project's admin site), and a tab on the old address refuses to submit with `apiError.install.adminOutdated` naming the new address (a reload lands there) (`packages/admin/src/install/fetch-script.ts`, `cloud-build-installer.ts`).
    - **Before a path starts to redirect, list every client that fetches it, including build steps and tabs already open.**

676. **No Landsat over Bucharest: the USGS harvest was all or nothing, and a run past its timeout stored and recorded nothing.**
    - Seen: 2026-11-13, `cities/bucharest/usgsScenes` held 525 scenes and none was Landsat; the last good harvest was 2026-10-25; the owner's Search USGS of that day logged "harvest cap reached" for `corona2` and `declassii`, then died at Cloud Run's 540 s.
    - Cause: `SEARCH_BUDGET_MS` only stopped asking for new pages. A page in flight, then the dataset ids, about 1,000 scene writes 25 at a time on 256 MiB, the browse prefetch and the date plan all ran after the search, past the timeout; every write waited for every dataset, and the attempt was recorded only at the end. Landsat 8 and 9 OLI was never searched, and the default years stopped at 2000.
    - Fix and pin: each dataset is stored as soon as its search ends; each request has its own `AbortController` timeout under the remaining time; the run ends by `RUN_BUDGET_MS` with the tail skipped past it; `ops/harvest-{city}` is written `running` at the start and per dataset, with a resume cursor, and a run found still `running` is logged `harvest.killed` and resumed; `landsat_ot_c2_l1` joined the datasets; the default years run to the current year (S-A11-BAD-REQUEST-TIMED-OUT, S-A11-BAD-HARVEST-PARTIAL-STORED, S-A11-HAPPY-HARVEST-RESUME, S-A11-BAD-HARVEST-KILLED, S-A130-HAPPY-OLI, S-P30-HAPPY-OLI).
    - **A long server job stores and records as it goes, gives every outside request its own timeout inside its remaining time, and leaves a cursor to resume: a stop at the timeout must lose at most the part in flight.**

677. **The engine's build emptied the Romanian catalogue, and one module that read it as it loaded broke every page.**
    - Seen: 2026-11-09 (track/langs), the first e2e run after the catalogues left the bundle: every viewer test failed on "uncaught TypeError: Cannot convert undefined or null to object" before `hcm-ready`.
    - Cause: `schemas/validation.ts` built its set of `validation.*` codes from `Object.keys(ro)` at load; the engine's build resolves `ro.ts` to `export const ro = undefined`.
    - Found by: the e2e suite only: Vitest imports the real catalogues, so every unit test passed.
    - Fix and pin: the codes are listed by name (`validation.test.ts` checks every catalogue key is one, and a near miss is not); every page boots in the e2e runs.
    - **Code the engine bundles never reads a catalogue object as it loads: a catalogue is data the engine fetches, read only through `translate` once registered.**
678. **A language's texts arrived after the skeleton had rendered, and nothing rendered again.**
    - Seen: 2026-11-09 (track/langs), while wiring the boot: the loading view rendered before its catalogue, with an empty "Loading the map…" and a progress indicator without a name, until the manifest changed the state.
    - Cause: the catalogue lives in a registry outside the store's state, so its arrival changed nothing a Lit element observes.
    - Found by: reading the boot path against the tour's `loading` state (manifest held, catalogue free).
    - Fix and pin: the boot sets the state again once the texts arrive (`#textsArrived`); the tour's `loading` state checks the named indicator.
    - **State kept outside the store (a registry, a cache) must announce its change through the store, or the view never learns of it.**
679. **The leak check called a city's English text, rightly shown in an Arabic page, a leak.**
    - Seen: 2026-11-09 (track/langs), the tour's `rtl-languages`: "Anonymous statistics", the fixture's English privacy heading, matched the English catalogue.
    - Cause: the check, generalised from Romanian pages to sixteen languages, compared every visible text, including data shown in its fallback language.
    - Found by: the tour's i18n check in the new Arabic journey.
    - Fix and pin: a city's text names its language (`lang`, WCAG 3.1.2), and the check skips what is marked as another language (`e2e/support/i18n.ts`).
    - **Mark text by its language where it is shown; a check of "the page's language" then reads the marks instead of guessing.**
680. **Right to left, the mirrored Mapbox attribution put its two links side by side and failed the target size.**
    - Seen: 2026-11-09 (track/langs), the tour's `rtl-photo` at 360 px: axe target-size (serious) on the legal bar's two links.
    - Cause: the bidi algorithm reordered the attribution's Latin runs and its separators inside an Arabic paragraph.
    - Found by: the tour's accessibility checker in the new Arabic journey.
    - Fix and pin: the attribution is `dir="ltr"`, as the map's own control is (`hcm-map-attribution.ts`); the tour's Arabic journey passes at every per-push viewport.
    - **Legal and third-party text in a right-to-left page keeps its own direction: mark it `dir="ltr"`, as the map's container is.**
681. **A language that could not be fetched stayed checked in the list.**
    - Seen: 2026-11-09 (track/langs), S-V11-BAD-CATALOGUE-404: the page stayed Romanian, the snackbar said so, the list showed Korean checked.
    - Cause: the kit's segmented button checks a choice at once; the dialog's value had not changed, so Lit never set it back (`live` only acts on a render).
    - Found by: the e2e row.
    - Fix and pin: the list is controlled: it shows the page's language until the store has switched (`hcm-about-dialog.ts`; `languages.test.ts`, S-V11-BAD-CATALOGUE-404).
    - **A choice whose effect can fail is controlled by its outcome, never by the click.**
682. **One translator removed a folder it had made and took another's catalogue with it.**
    - Seen: 2026-11-09 (track/langs): the Simplified Chinese catalogue, written to `i18n/viewer/zh.ts`, was gone; the Korean translator had created and then removed `i18n/viewer/`.
    - Cause: parallel agents in one worktree, two layouts in the brief and the design, and a clean-up of a folder that was no longer only its own.
    - Found by: the integration's key check (fifteen catalogues where sixteen were expected).
    - Fix and pin: re-translated in the agreed layout; the gate requires all sixteen files.
    - **Parallel writers agree on the paths first and never delete what they did not create alone.**
683. **The merge of the viewer's languages left two of its tests looking for the language list where it no longer was.**
    - Seen: 2026-11-12 (track/langs25), the first `ui` run after merging track/langs into the branch: `languages.test.ts` failed "no hcm-segmented-button in <hcm-about-dialog>".
    - Cause: track/settings had moved the language list into the dialog's `settings` mode while track/langs was apart; its tests mounted the dialog in its default `about` mode. The merge had only Markdown conflicts, so nothing flagged the TypeScript.
    - Found by: the `ui` project's run of the merged branch.
    - Fix and pin: the tests open the dialog in `mode: 'settings'` (`packages/ui/test/viewer/languages.test.ts`).
    - **A merge with no conflict in code still changes code: run the tests of both branches' areas before building on it.**
684. **The same merge took `packages/shared/test/index.test.ts` past ESLint's 600 lines.**
    - Seen: 2026-11-12 (track/langs25), ESLint on the changed files: 612 counted lines before any new export was listed.
    - Cause: each branch stayed under the limit; together they did not.
    - Found by: ESLint on the merged file.
    - Fix and pin: the i18n exports' lists moved to `packages/shared/test/fixtures/exports-ui-i18n.ts`, as the milestones' lists are.
    - **After a merge, lint the files both sides grew, not only the ones you touch.**
685. **A shared fallback put the viewer's catalogue into the start page's bundle.**
    - Seen: 2026-11-12 (track/langs25), the bundle budget: `start.mjs` 75.9 KB of its 72 after the per-key fallback.
    - Cause: the fallback lived in `i18n/index.ts` beside the viewer's bundled `{ro, en}`; the start page's translator imported it and the bundler kept the module's catalogue object the fallback read.
    - Found by: `check_bundle_budget.py` after `npm run build`.
    - Fix and pin: the registry of fetched files and the fallback are a module with no catalogue (`packages/shared/src/i18n/registry.ts`); the start page measures 70.4 KB.
    - **A helper every family uses lives in a module that imports no family: what it reads, every page that uses it bundles.**
686. **French translations run past 140 columns, and Prettier's wrap made the gate reject them.**
    - Seen: 2026-11-12 (track/langs25), the first import of the model's French: Prettier wrapped 40 entries after their key, which `check_i18n.py` read as "not a one-line entry".
    - Cause: Romanian and English are written to fit the line; a translation is longer and nobody shortens a model's text.
    - Found by: `prettier --check` on the imported files, then the gate.
    - Fix and pin: the gate and the build read a translation's wrapped entry as one (`unwrapped`, `catalogueEntries`); `ro` and `en` stay one line per entry (`test_bad_path_romanian_and_english_never_wrap`).
    - **A format rule written for hand-made files must say what it does with generated ones before the first import.**
687. **The start page's footer links were 44 px tall, under M3's 48 on a phone, and no tour state had scrolled a phone to them.**
    - Seen: 2026-11-12 (track/langs25), the new `admin.start.language-rtl` state at `admin-c360-ro`: four target-size findings on `a.start-site-link` once the sweep scrolled to the footer.
    - Cause: `.start-site-link` had `min-block-size: 2.75rem` (WCAG's 44 px), and the start page's states were visited only where the footer fit or was never scrolled to.
    - Found by: the tour's checkers in the new right-to-left state, on a compact window.
    - Fix and pin: `min-block-size: 3rem` with `padding-block: 0.75rem` (`scripts/site/src/start/legal.ts`); the state stays in the inventory at every admin project.
    - **A new state on a page re-checks the whole page: let it, and fix what it finds rather than narrowing the state.**
688. **The i18n gate's strict mode checked less than its default mode.**
    - Seen: 2026-11-12 (track/langs25), review: a leading space in a copy of `de.ts` failed the default run and passed `--strict`.
    - Cause: strict replaced the folder's languages with all 25, which switched off the viewer's checks (`viewer=locales == VIEWER_LOCALES`) and the shape checks that ran only on optional languages.
    - Found by: the review of the branch, reproduced on a copy of the catalogues.
    - Fix and pin: strict keeps every check and adds completeness (`check_folder`, `translations_problems`); `test_bad_path_strict_rejects_everything_the_default_mode_rejects`.
    - **A stricter mode is the default mode plus rules: build it by adding, and test that it rejects everything the default rejects.**
689. **A slow language file undid a later choice.**
    - Seen: 2026-11-12 (track/langs25), review: in the admin and on the start page, French chosen on a slow network then English: the French file's arrival switched the page to French and stored it.
    - Cause: `switchLanguage` applied whatever resolved, with no notion of the latest request; the viewer's store had one (§195b), the admin's copy did not.
    - Found by: the review of the branch.
    - Fix and pin: `latestLanguage` (one switch per page; a superseded switch shows, stores and reports nothing); `happyPath_aSlowLanguageThenEnglishEndsInEnglishAndStoresEnglish`, `badPath_theBootsFetchResolvingAfterAMenuChoiceNeverUndoesIt` and the start controller's equivalents.
    - **Every asynchronous switch driven by a person's choices needs "the latest wins" before it ships, wherever it is copied.**
690. **The tour's i18n leak check stopped at shadow roots, so a `lang` on a shadow host did not count.**
    - Seen: 2026-11-12 (track/langs25), the admin's Arabic state read as Arabic: the photos page's English texts, inside the shell's `lang="en"` area, were reported as leaks.
    - Cause: `textsInPage` asked `element.closest('[lang]')`, which ends at the shadow root; the browser and a screen reader inherit `lang` through the composed tree.
    - Found by: `admin.shell.language-rtl` once its leak check used the page's real language.
    - Fix and pin: the check walks up through shadow hosts (`markedOf` in `e2e/support/i18n.ts`); the same state and `admin.start.language-rtl` pass read as Arabic and Urdu. The start page's footer marks its Romanian link texts `lang="ro"` too.
    - **A checker that reads the DOM must read it as assistive technology does: across shadow boundaries.**
691. **After the languages left the engine's bundle, the Romanian map credited USGS in English again.**
    - Seen: 2026-11-13, the merge queue's languages after origin's merge: `layers.spec`'s S-V03-BAD-ATTRIBUTION-REPEATED failed on the Romanian page, the map's line and the Layers panel keeping "USGS EROS, declassified imagery (public domain)".
    - Cause: `localizedCredit` (`packages/shared/src/overlays/credits.ts`, origin's Pixel Tablet fix) found the stored English credit through the English catalogue, which the tests bundle but the engine fetches only for an English page or a language that falls back to it (`docs/research/DECISIONS-for-review.md` §218). Each branch passed alone; only the merged engine lacked English.
    - Found by: the e2e only: Vitest's `@hcm/shared` always bundles Romanian and English.
    - Fix and pin: the stored English is spelt beside the keys (`STORED_CREDITS`, held equal to `USGS_ATTRIBUTION`, `LANDSAT_ATTRIBUTION` and the English catalogue by `credits.test.ts`) and matched first; the fetched languages after it.
    - **Code that runs in the engine never needs a catalogue other than the page's own: English is not there unless the page is English or falls back to it.**
692. **The viewer's Settings stacked 25 languages whose rows overlapped by a pixel, and the tour's scroll sweep found one row covered.**
    - Seen: 2026-11-13, the merge queue's viewer tour at c360 (`viewer.settings` scrolled through): "Română", scrolled to a 7 px strip under the dialog's header, had its last pixel under "Tiếng Việt"; the Arabic state still expected sixteen languages.
    - Cause: a stacked segmented button pulled every row after the first up by 1 px (`margin-block-start: -1px`) to share its border; with nine more rows the sweep stopped where a strip just over the 5 px sliver allowance ended on that shared pixel.
    - Fix and pin: a row after the first draws no top border instead of overlapping (`segmented-button.ts`; `segmented-button.test.ts` holds the rows edge to edge); the tour state counts `VIEWER_LOCALES`.
    - **Shared borders are drawn by one side, never by overlapping boxes: a pixel of overlap is a covered pixel to the layout checks.**

693. **The translation QA held every Japanese and Chinese hint of several short sentences, whatever their wording.**
    - Seen: 2026-11-13, the merge queue's viewer QA: `input.padActs` and `input.padMove` in ja and zh failed "use about 6 (3) sentences like the English", and a one-sentence rewrite failed the same way.
    - Cause: the sentence counter of `hcm-wt/ltrans.py` (`SENT`) wanted a space after a full stop, and CJK writes `。！？` with none, so a CJK text of six sentences counted as one.
    - Fix and pin: with the owner's OK, `。！？` end a sentence with no space after them; the four strings then passed the validators, the laptop's back-translation and the second judge.
    - **A text check that counts by spaces counts wrong in the scripts that use none: test each validator on a CJK sample before it holds CJK strings.**

694. **Chips in the dark: the timeline's chips were light in the dark theme, because their M3 roles are light there.**
    - Seen: 2026-11-13, the owner's Android phone with the system in dark: the viewer turned dark, but the year chip over the timeline, the scrub chip above the finger, the phone's year pill and the dates' badge stayed light.
    - Cause: no browser darkening and no missing scope (the root and the viewer declare `color-scheme: light dark`, and the chips inherit the themed host's tokens): the chips took M3 roles whose dark-theme tones are light by design. The year chip was an M3 plain tooltip on `inverse-surface` (`#fdf7fe` in the baseline's dark), the pill `primary` (`#cdc0ec`), the badge `error` (`#f97386`). Every contrast check passed, since each pair reads well; only a check of the fill against the theme says the chip does not follow it.
    - Fix and pin: the year chip takes `surface-container-highest` on `on-surface` with an `outline-variant` edge and the level-2 shadow, the pill `primary-container` on `on-primary-container` with a 2 px `primary` edge, the badge `error-container` on `on-error-container`; forced colours give the pill and the chip ButtonFace and ButtonText, the badge Mark and MarkText, and the date menu an edge (`packages/ui/src/viewer/timeline-styles.ts`, `hcm-date-menu.ts`; S-V12-HAPPY-CHIPS-FOLLOW-THEME, S-V12-BAD-DARK-CHIPS-NOT-LIGHT, `packages/ui/test/viewer/hcm-timeline-theme.test.ts`).
    - **A component that must look dark in the dark theme takes a surface or a container role, never `inverse-*`, `primary` or `error` as a fill; test its fill's lightness per scheme, not only its contrast.**

695. **Setup offered the server's update only after the steps an outdated server cannot check.**
    - Seen: 2026-11-13, the live admin after the starter-0428b9113175 deploy: "The map's server is older than this admin: update it in Install the map's server", but step d said "Available after the steps above"; (b) and (c) read "Update the server to check", so the update never appeared.
    - Cause: `reachedSteps` opened (d) only after (c) was done or its items were; an outdated server leaves (c) unknown.
    - Fix and pin: a server in place but older than the admin counts as a prepared project, so (d) stays open with its update (`packages/admin/test/setup/controller.test.ts`, `S-A03-BAD-OLDER-SERVER-STATUS`).
    - **The way out of a state must never depend on what that state hides.**
696. **Versions said the busy worker's pipeline image matched the installed release.**
    - Seen: 2026-11-13, admin "This computer → Versions": the line said "It matches the installed release" while the worker was busy on an older image.
    - Cause: `versionsOf` used `outdated !== true`, and a worker only learns `outdated` at its next `worker.claim`, so a busy run kept the flag false after a newer pipeline was installed.
    - Fix and pin: when `setup/status.install.pipeline.image` is known (`WorkerFeed` → `LocalComputer`), compare the worker's reported digest with it; fall back to the flag only when the installed digest is unknown (`packages/admin/src/worker/machine.ts`, `packages/admin/test/worker/machine.test.ts`, S-A142).
    - **A status flag that updates only on the next poll is late for the UI: compare the facts the UI already has.**

697. **A build only a record said was at work hid Update the map, with no word why.**
    - Seen: 2026-11-13 23:45, the live admin: step d offered the server's update but showed no button; step d3's pipeline was recorded "installing" at 23:20 and nothing had looked since (no Google token on the page).
    - Cause: `building()` counted a recorded, unconfirmed build as at work to close finding 71's race, so the way out (the look) needed a click the owner could not guess (Check again on d3).
    - Fix and pin: such a build no longer hides the button; Update the map's click looks at it with its own token first and goes on only when no build is at work (`S-A55-HAPPY-UPDATE-STALE-RECORD`, `S-A55-BAD-UPDATE-STALE-RECORD`).
    - **A guard that waits on a check must run the check itself, not hide the button that would.**
698. **Admin language e2e still expected radios and treated German as unsupported after the dropdown and the 25 languages.**
    - Seen: 2026-11-14, `admin-c360-ro` / `admin-l1440-ro`: `S-A95-HAPPY-LANGUAGE-PICKER` timed out on a `radiogroup` named Limbă; `S-A21-BAD-UNSUPPORTED-LANGUAGE` opened Deutsch under `locale: 'de-DE'` instead of Romanian.
    - Cause: commit `43bbe138` replaced the account menu's language list with `<hcm-language-select>` (a native `<select>`), and `de` is one of `UI_LOCALES`, so `uiLocaleOf('de-DE')` is `de`. The viewer and start-page specs already asserted a combobox; the admin A95 count and A21's unsupported tag were left on the old contract.
    - Fix and pin: `languages.spec.ts` asserts 25 `option`s on the Limbă combobox (no radios); `title.spec.ts` uses `sv-SE` (outside `UI_LOCALES`); rows `S-A95-HAPPY-LANGUAGE-PICKER` and `S-A21-BAD-UNSUPPORTED-LANGUAGE`.
    - **When a control or a locale list changes, update every e2e assertion that names the old shape or an old "unsupported" tag; unsupported means outside `UI_LOCALES`, not "not Romanian or English".**
699. **A local worker lost a job's attempts to power cuts, and a rename alone let a torn file look finished.**
    - Seen: 2026-11-14, `RESILIENCE-AUDIT.md` (P0-1 to P0-4) on household computers without a UPS, and the laptop worker's volume at 113 GB (`work/` 81 GB of jobs long published, 46 old pipeline images).
    - Cause: a lost local run was re-queued with its attempt kept (three brownouts failed a job); writes went through a temp file and a rename with no `fsync`, so after a cut the new name could hold nothing; a resume trusted a local output by its mtime alone; the sweep only knew file ages, never whether the job was finished.
    - Fix and pin: `imagery.tick` and a claim from the same computer give the attempt back (`lostRuns` capped at 5); `durable.py` syncs the bytes and the folder; `intact.py` checks a local output's size and first bytes before a step is passed over; a full disk hands the job back (`diskFull`); the sweep asks the server's `jobStates`; the supervisor keeps Docker's restart policy and only the current and previous pipeline image (`test_durable.py`, `test_runner_resilience.py`, `test_worker_cleanup.py`, `functions/test/imagery/tick-local.test.ts`, S-P04, S-A62).
    - **A crash test simulates the cut at the `fsync`, not at the rename: what was not synced is not on the disk.**
700. **The phone's year pill was wider than the card the chip was centred under.**
    - Seen: 2026-11-13, track/green: the timeline specs at fn-c360 (and the `orientation` spec at every viewer project) failed: the photos chip stood 14 px off the standing timeline's axis, and the open menu showed two floating boxes, not three.
    - Cause: V67 collapsed the upright card to a 96 px pill, but the chip kept the 14 px inset that centres it under the 68 px card; and a press on the menu button collapses the open card (V12), whose pill then steps aside while the menu is open, so the spec's count of three was stale.
    - Fix: under the collapsed pill the chip is 28 px in (`timeline-dock-styles.ts`); the orientation spec expects the menu and the chip only.
    - **When a component changes its size in one state, re-check everything docked relative to it in that state.**

701. **Locate again for overview-hole restitching failed: `params has unknown keys: restitch`.**
    - Seen: 2026-11-14, an archive series re-queued by Locate again (`functions/src/imagery/restitch.ts`: `params.restitch: true`) failed as soon as the local worker started the job.
    - Cause: `archiveSeriesParamsSchema` and its Python twin (`_ARCHIVE_SERIES_KEYS` in `pipeline/src/hcm_pipeline/model.py`) were strict and never listed `restitch`, so `params_of` refused the flag the callable wrote.
    - Fix and pin: `restitch` is an optional boolean on `archive-series` only (shared zod + Python allow-list); other job types still reject it. Happy and bad pins in `packages/shared/test/schemas/imagery-archive.test.ts` and `pipeline/tests/unit/test_model.py` (S-A122-HAPPY-RESTITCH, S-P20-HAPPY-RESTITCH).
    - **A new job param a callable writes must land in that type's `JOB_PARAMS_SCHEMAS` entry and its Python twin in the same change, or the worker fails the job on start.**
702. **Every Landsat import failed because the delivery was "larger than USGS announced".**
    - Seen: 2026-11-14, Collection 2 Level-1 imports (`LC81820292019178LGN00`, datasets `landsat_ot_c2_l1` / TM / ETM+) all failed `fetch` with `apiError.imagery.downloadIncomplete`.
    - Cause: M2M `download-options` returns several products; the Product Bundle's `filesize` is often band-scale (and may sit under `secondaryDownloads`), while the signed address sends the full tar. `fetch` required an exact match to the announcement.
    - Fix and pin: `download_option` prefers a product whose name contains "bundle" (flattening `secondaryDownloads`); `transfer_size` takes the larger of the announcement and Content-Length (or a 206's Content-Range total); truncated bodies are still refused (`S-P30-HAPPY-BUNDLE-SIZE`, `S-P01-BAD-SIZE-MISMATCH`).
    - **When an upstream lists several products, size-check the product actually transferred (Content-Length), not only the catalogue's understated figure.**
703. **Every Landsat run on a computer failed at warp with `apiError.worker.refused`.**
    - Seen: 2026-11-14, Landsat imports passed `fetch` on the owner's computers, then failed "Projecting onto the map: apiError.internal: WorkerApiError: apiError.worker.refused".
    - Cause: M25's `warp` writes the version's `landsat` report (`ctx.update_version({"landsat": …})`), and `worker.step` refuses every field missing from `WORKER_VERSION_FIELDS` (`functions/src/worker/allow-list.ts`); `landsat` was never added. The cloud run writes Firestore directly, so every pipeline test was green.
    - Fix and pin: `landsat` is on the list (the schema still checks the report). `S-A62-HAPPY-LANDSAT-REPORT`, `S-A62-BAD-LANDSAT-REPORT` in `functions/test/worker/step.test.ts`.
    - **A new field the pipeline writes joins the worker's allow-list in the same change, with a `worker.step` test: the local path is a second writer.**
704. **Every computer card said "processing 0.0.0".**
    - Seen: 2026-11-14, live admin 1.0.0-beta.1: each computer showed "Helper …, processing 0.0.0" and Jobs once said "Your computer runs an old version (0.0.0)".
    - Cause: `hcm_pipeline.__version__` was the literal `0.0.0` of `pyproject.toml`; the installer's image build never told the image its release, so `worker.hello` always reported 0.0.0 (the up-to-date check compares image digests, so only the label was wrong).
    - Fix and pin: the installer builds with `--build-arg HCM_RELEASE=${_RELEASE}`, the image keeps it as `HCM_RELEASE` and `__version__` reads it (0.0.0 when missing or malformed). `S-A62-HAPPY-RELEASE-STAMPED`, `S-A62-BAD-RELEASE-UNSTAMPED`.
    - **A version shown to people comes from the build that made the artefact, never from a placeholder in a manifest.**
705. **A dropped USGS download failed the job at 1.20 of 1.23 GB.**
    - Seen: 2026-11-14, `LC81820292013225LGN02` failed `fetch` with "RemoteProtocolError: peer closed connection without sending complete message body".
    - Cause: `fetch` resumed only across runs (a SIGTERM, a new attempt); a connection closed mid-body escaped as an unexpected error and ended the job, although the upload session held every chunk before it.
    - Fix and pin: a `TransportError` while streaming asks again with a Range from the bytes the session holds, `DROP_ATTEMPTS` (5) times per address; past that the step fails as `downloadIncomplete` with the session kept. `S-P01-HAPPY-DROP-RESUMED`, `S-P01-BAD-DROP-REPEATED`.
    - **A long transfer treats a dropped connection as the normal case: resume from what is held before failing.**
706. **Landsat jobs resumed on another computer failed at warp with `missingBand`.**
    - Seen: 2026-11-14, `LC81830292017243LGN00` ("the Landsat band B4 was not extracted") and `LE71820292002235SGS00` (B3): `extract` ran at 08:3x on one computer, the job failed at `warp` (lesson 703), and the retry at 09:0x was claimed by another computer. Not the bundle's layout: the same OLI and ETM+ bundles extract B4, B3 and B8 fine in one run.
    - Cause: the runner passes over what feeds `locate` once `locate` is finished (`_consumed`, `pipeline/src/hcm_pipeline/runner.py`), and a Landsat scene's `locate` is `skipped`, which counted as finished. So `extract` was never run again, although its bands (`work/`, kept on the computer that extracted them) were not on this one.
    - Fix and pin: only a consumer that ran (`done`, its output still here) makes its inputs dispensable; `CONSUMERS` is `locate` and `warp` (a Landsat scene's bands feed `warp`). Without its bands the job extracts them again (fetching again when the delivery is gone too). `S-P30-HAPPY-BANDS-AGAIN`, `S-P30-BAD-BANDS-AND-DELIVERY-GONE` in `pipeline/tests/unit/test_runner.py`.
    - **A `skipped` step proves nothing about its inputs: "consumed" means a later step ran and its output is still here.**
707. **After Update the map every computer still said "processing 0.0.0".**
    - Seen: 2026-11-14, Setup installed `1.0.0-beta.1+fcccaff`; the computers pulled its image (`sha256:f711af…`, the installed digest, so they took jobs and the up-to-date check was right), yet `docker inspect` showed `HCM_RELEASE=0.0.0`: the build ran without `--build-arg HCM_RELEASE` (lesson 704's fix).
    - Cause: the admin's own Hosting site (§210) lost the `no-cache` rules of `firebase.json` in the split (`scripts/site/src/hosting/admin-site.ts` kept only `**` and `/admin/**` rules), so `admin.mjs` and `index.html` came with Hosting's one-hour `max-age`. A reload after the deploy ran the cached older admin with the fresh `runtime.json` (read `no-store`), so the release check passed and the build steps were the older admin's.
    - Fix and pin: the admin's site keeps every folder's header rule (`**…` sources and `regex` rules), in order, so its pages and scripts are revalidated and the install bundles stay immutable. `S-A160-HAPPY-ADMIN-NO-CACHE`, `S-A160-BAD-ADMIN-STALE-SCRIPT` in `scripts/site/test/hosting-admin-site.test.ts`. Live: the next Update the map (from a reloaded admin) builds a stamped image; until then the cards keep saying 0.0.0 while the computers run the installed image.
    - **An entry file that is not content-hashed (`admin.mjs`, `index.html`) must be revalidated on every site that serves it; a split configuration carries the cache rules with it.**
708. **The admin said "Your computer runs an old version: no jobs until it updates itself" while the computers took jobs.**
    - Seen: 2026-11-14, after Update the map: the alert of `<hcm-worker-panel>` (the worker document's `outdated`) stayed while the same computer claimed job after job.
    - Cause: `worker.hello` compares the worker's image with the installed one, which each function instance keeps a minute (`JOB_CACHE_MS`); a hello right after the build could still see the previous digest and write `outdated: true`. `worker.claim` (another instance, fresh) let the worker through, but `take` wrote the document as it read it, `outdated` included; only a claim that found no job wrote `outdated: false`.
    - Fix and pin: a claim that takes a job writes `outdated: false` (only a worker the image check let through gets there). `S-A62-HAPPY-OUTDATED-CLEARED`, `S-A62-BAD-OUTDATED-KEPT` in `functions/test/worker/pairing.test.ts`.
    - **A flag a gate decides is written on every answer of that gate, the one that hands out work included, never only on the refusal path.**
709. **A frame failed at locate with "LinAlgError: Singular matrix" instead of a plain message.**
    - Seen: 2026-11-14, job `im-mwf0xyzz-DS1111-1020AF035` (a DS1111 frame) failed in `locate` with numpy's raw error.
    - Cause: the scene's four catalogue corners were collinear or repeated, so `georef/corners.homography` solved a singular 8x8 system; every orientation raised, and nothing caught it. A panoramic refit could also return a singular local matrix, and a strip with no first guess divided by a zero axis.
    - Fix and pin: `homography` raises `DegenerateCornersError`; `assignments` and `first_guesses` drop a degenerate orientation and keep the others; with none left `reaching` raises `CityNotFoundError`, so the job fails with `apiError.imagery.cityNotFound` (ro + en: choose another frame) and the frame goes to the Help-calibrate queue like any other. `S-P01-HAPPY-KH9-STRIP`, `S-P01-BAD-CITY-NOT-FOUND` in `pipeline/tests/unit/test_corners.py`.
    - **Catalogue geometry is input: a transform fitted on it catches the singular case and tries the next candidate, never lets a `LinAlgError` reach the job.**
710. **A worker deleted the USGS delivery of a frame nothing proved.**
    - Seen: 2026-11-14, job `im-mwf0xyzz-DS1111-1020AF035` (release d3e0d6b): `locate` offered the whole strip shrunk 8 times, logged "delivery kept", then deleted `usgs-raw/corona2/DS1111-1020AF035/DS1111-1020AF035.tgz`.
    - Cause: the worker-resilience change (eb646592, "leave no data behind") added `delete_delivery` on a worker to `locate`'s two unproved branches (`_whole`, `_not_proved`), whose scan is a guess or a shrunk whole frame, not a full-resolution city crop. If the segments are later lost, `recrop` and **Locate again** have nothing to cut the city from but a new fetch.
    - Fix and pin: `delete_delivery` runs only after a proved crop and after `recrop`'s full-resolution cut; `test_raw_deleted.py` and `test_whole_frame.py` run both unproved branches in worker mode and assert the delivery stays (S-P01-BAD-WEAK-GUESS-KEEPS-RAW, S-P06-BAD-WHOLE-STRIP-KEEPS-RAW).
    - **Delete a source only after the product that replaces it is complete at full resolution; a cleanup added for disk space must check every branch's output, not just that the step ended.**
711. **"Device accent" did nothing on the owner's Android phone and laptop, with no word why.**
    - Seen: 2026-11-14, the live viewer and admin in Chrome on Android and on a Linux and a Windows laptop: Settings' **Device accent** was chosen, yet the map kept its own colours.
    - Cause: by design and silently. Chrome (150 and later; 157 on the owner's laptop) gives a tab's CSS `AccentColor` a constant `rgb(0, 117, 255)` against fingerprinting and the device's colour only to an installed web app in the primary profile; Safari gives a constant everywhere; Android's dynamic colour never reaches a page. `readDeviceAccent` rightly ignored those constants, but neither the viewer nor the admin is installable, so outside Firefox on a computer the option could never work, and nothing said so.
    - Fix and pin: `deviceAccentState` (`shared`, `grey`, `hidden`); with Device accent chosen and not `shared`, the viewer's Settings and the admin's account menu say under the choice why, what shows instead and how to get the device's colour (`accent.hidden`, `accent.grey`, in all sixteen viewer catalogues). `S-V12-BAD-NO-DEVICE-ACCENT`, `S-A21-BAD-NO-DEVICE-ACCENT`; `packages/ui/test/theme/device-accent.test.ts`, `packages/ui/test/viewer/hcm-about-dialog.test.ts`.
    - Found on the way: the first build threw `deviceAccentState is not a function` in the viewer only: `<hcm-about-dialog>` is side-loaded in `engine.extras.js`, whose imports from outside the part read the kit the engine hands over (`packages/ui/src/viewer/extras-kit.ts`); the unit tests import the module directly and passed. A new import in a side-loaded element joins the kit, and only the built viewer (Playwright) proves it.
    - **A choice that a browser can silently ignore says so on screen where it is chosen; check what a platform API really returns in a plain tab before shipping a default built on it.**
    - Correction (lesson 714): the installed app *does* get the real accent on Linux too (Chrome reads it from the desktop portal); what the owner then saw was the accent drowned in the city's muted palette, not a missing accent.

712. **A mouse could not reach the years beyond a scrolling timeline.**
    - Seen: 2026-11-14, the owner on a desktop: with more years than the card holds a finger scrolled the track, a mouse press only selected (and dragged the selection), and a vertical wheel did nothing on the lying card.
    - Cause: `timeline-pointer.ts` sent every non-touch press to the select-drag; the card scrolls natively only for a finger (`touch-action: pan-x`) and a horizontal scroller ignores a vertical wheel.
    - Fix and pin: a mouse on a scrolling track pans it past 4 px (`timeline-pan.ts`, grab/grabbing cursor) and a press within that is a click that selects and only then focuses the thumb (focusing it after a pan scrolled the card straight back, found by the unit test); the vertical and shift-wheel scroll a lying card; keyboard focus centres the selected year. `hcm-timeline-pan.test.ts`, S-V04-HAPPY-MOUSE-PAN, S-V04-BAD-MOUSE-PAN-CLICK.
    - **Every scrolling surface needs a mouse path as well as a finger's: drag with a threshold that keeps a click a click, and the wheel.**
713. **The admin's push registration would have unregistered the public map's new app worker.**
    - Seen: 2026-11-14, while making the map installable (`docs/ENGINE_API.md` → *Installable app*): the map's `sw.js` registers with the Hosting root as its scope, and on a project whose admin still lives under the map's `/admin/` (no admin site), turning notifications on ran `retireRootWorker`, which unregistered every registration of the root scope.
    - Found by: reading the M6 code that owns the root scope before giving it a worker; no test knew of a second worker there.
    - Cause: M6 retired "the root's worker" by scope alone, since the only worker that could ever be there was a pre-M6 admin's push worker.
    - Fix and pin: `retireRootWorker` unregisters a root registration only when one of its workers is `firebase-messaging-sw.js`; `badPath_thePublicMapsOwnAppWorkerAtTheRootStays` in `packages/admin/test/firebase/messaging.test.ts`.
    - **A cleanup that removes "whatever is at" a shared address names what it removes; the next feature may put something legitimate there.**
714. **The installed map on Linux "did not show the system colour", though Chrome gave it.**
    - Seen: 2026-11-14, the owner's map installed as an app (763fba39) in Chrome 157 on a GNOME laptop with the orange accent: Device accent looked like the map's own colours.
    - Found by: installing the live map as an app in a throwaway Chrome 157 profile on the same laptop through the DevTools protocol (`PWA.install`, `PWA.launch`): the app window gave `AccentColor` `rgb(237, 91, 0)` (the portal's `org.freedesktop.appearance accent-color`, GNOME's orange) with `display-mode: standalone`, a tab `rgb(0, 117, 255)`; the theme applied, but the dark primary went from lavender `#bcc5ee` only to a dull peach `#eabda9`, under a title bar that stays the manifest's brown `theme_color`.
    - Cause: `withAccent` kept each colour's chroma, so a muted city (Bucharest's primary has OKLCH chroma 0.077, GNOME's orange 0.196) turned to the accent's hue but kept its greyness: a desaturated orange in tone 80 reads as beige-brown, the map's own brand colour. Chromium exposes the accent on Linux since its portal change of 2025-08 (`[AccentColor] Pump Linux system accent color`, `kUsePortalAccentColor`, on by default), scoped to installed apps in the primary profile like Windows, macOS and ChromeOS (`WebAppScopeSystemAccentColor`, `CSSSystemAccentColorKeyword`, Chrome 150); not on Android.
    - Fix and pin: the schemes' chroma grows by the accent's over the city primary's, 1 to 3 times (a near-grey surface's by the square root), luminance and so every contrast ratio kept: Bucharest in GNOME orange is now `#a63d00` light and `#ffb693` dark. `happyPath_aMutedCityTakesTheVividAccentsColourfulness`, `badPath_aMutedAccentNeverGreysAVividCity`, `happyPath_aNearGreySurfaceStaysATintedNeutral` in `packages/ui/test/theme/device-accent.test.ts`.
    - **Verify a platform claim on the platform before writing its note, and judge a colour transform by what a person recognises, not only by the hue a test measures.**

715. **Eight series of the owner's scanned maps waited for one busy laptop while two other computers idled.**
    - Seen: 2026-11-14, Bucharest's Jobs page: eight queued "Bucuresti actual" series (4,534 and 525 sheets among them) waited "for the computer that has these scanned maps"; that laptop (`w-c9cc212966de0cb3`) ran a long declassified-frame job with its person at it, while the PC and the NUC had nothing to do.
    - Cause: §20's copy of a series was asked only by the holder's **claim**, and a busy worker does not claim; a pressed one (quiet, user-active) is answered `yielded` before any copy offer. The one computer that could unblock the others was the one least likely to ask.
    - Found by: the owner, live (Firestore: the eight jobs `waitReason: 'archive-copy'`, the holder `busy` and `quiet`); the unit tests of §20 drove the copy through an idle holder's claim only.
    - Fix and pin: a sharing thread on the holder (`worker/sharing.py`) asks `worker.archiveCopy` `wanted` on its own, also while it runs a job, and pre-seeds queued series before any computer hands one back, under the governor's rate and a 20 GB daily cap, its progress on the Computers card (M20 §22). S-A120-HAPPY-ARCHIVE-SHARE, S-A120-BAD-ARCHIVE-SHARE-DAY, S-P20-HAPPY-ARCHIVE-SHARE, S-A143-HAPPY-SHARING.
    - **A duty only one machine can do must not ride on that machine's request for work: give it its own channel, so being busy or polite never blocks the others.**

716. **Dragging the timeline's year pill also moved the bar.**
    - Seen: 2026-11-14, the owner with a mouse and a finger on a scrolling timeline: the pill followed the drag, then the years jumped under it on release.
    - Cause: `hcm-timeline.ts` centred the selected year after every change once a press ended (`#reveal` on `dragging` going false and on a scrub's live values), so a pointer's choice panned the bar; nothing scrolled on while the pill was held at an edge.
    - Fix and pin: a year a pointer chose is never centred (only the keyboard and a value from outside are); the pill held near an edge scrolls the card on (`EdgeScroll`, faster deeper in) and selects under it. The mouse pan also flings on after release, none under reduced motion. `timeline-fling.test.ts`, S-V04-HAPPY-PILL-DRAG, S-V04-HAPPY-PAN-FLING, S-V04-BAD-PAN-REDUCED.
    - **A selection made by dragging must never move what is under the pointer; auto-scroll only from an edge.**
717. **Update the map updated the server, but the imagery pipeline never got the new image.**
    - Seen: 2026-11-14, the live admin: step d went 62c7179 → bca1891 at 17:02, step d3 stayed "Installed: 62c7179" for 20+ minutes with no progress and no error; d refreshed only after Check again; every computer kept processing with 62c7179 (earlier at 13:45 d3 sat on "Build the pipeline's image" while its build had finished).
    - Found by: the owner. Every tier was green: the unit and e2e tests of the pipeline-after-server order always held a live token, and none let it run out mid-update, reloaded the page, or redeployed the admin between the two builds.
    - Cause: Google tokens live in the tab's memory for an hour and are never refreshed silently; `install-flow.ts` stopped its watch with no word when the token was gone, `install.ts #afterServer` dropped the held pipeline update with an info log line when the server was seen in without a live token, and a refused submit (a newer admin deployed meanwhile: `adminOutdated`) showed inside a card whose chip still said done.
    - Fix and pin: a watch without a token says so with Continue; the held update stays held and starts with the next token; a server that stopped says so on the waiting cards; a card with an error never wears the done chip. S-A56-BAD-UPDATE-TOKEN-RAN-OUT, S-A56-BAD-UPDATE-SERVER-STOPPED; `packages/admin/test/setup/install-wait.test.ts`.
    - **Work that waits for a token, a click or another build must never be dropped silently: hold it, say on screen what it waits for, and give the one button that lets it go on.**
718. **An installed map or admin kept the release it opened with until someone reloaded it by hand.**
    - Seen: 2026-11-14, the owner with the map and the admin installed as apps (763fba39): a deploy reached neither window; the map has no Reload control, and the admin offered its banner only while it was looked at.
    - Cause: the app's worker went to the network first and took over at once (lesson 707's rule), but nothing told an *open* page that a new build existed: a city site had no build id to compare, and the admin reloaded by itself only when hidden or just shown again. An installed app's window is rarely hidden and stays open for days.
    - Fix and pin: each city build writes `app-build.json` (a digest of every file but the data) and bakes the same id into `tab-icon.js` and `sw.js`; the page script (`watchAppUpdates`, `packages/shared/src/kit/app-update.ts`) looks at start, on focus, on a return and every 15 minutes (`registration.update()` and the build file, `no-store`) and reloads at a safe moment (no dialog, full-size view, compare or map menu; no pointer pressed; hidden or a minute idle), else the viewer's Reload snackbar. The admin's tab also reloads once untouched for a minute (`activity.ts`), never over an unsaved edit or an upload. Both write the build or release they reload for into `sessionStorage` first and never reload for it twice, so a cache that serves the old page cannot loop them. `S-V72-HAPPY-SELF-UPDATE`, `S-V72-BAD-UPDATE-HELD`, `S-A61-HAPPY-IDLE-RELOAD`, `S-A61-BAD-NO-RELOAD-LOOP`; `packages/shared/test/kit/app-update.test.ts`, `packages/admin/test/app/release-reload.test.ts`.
    - **A long-lived page needs its own way to learn of a new build: compare a build id it was made with against one served `no-store`, reload only when nothing would be lost, and remember what it reloaded for so a stale cache can never make it loop.**

719. **The install step specs opened Setup on "The map's sources" instead of their own card.**
    - Seen: 2026-11-14, from base commit 8db15a6a on: about fifteen tests of `e2e/admin/steps/install/{checking,stale-record,site,update}.spec.ts` failed `toBeVisible()` on their step's open card; the page showed the Sources step (To do).
    - Cause: M28 added the Sources step (e2, after Mapbox), done once the city holds `sources`. The step seeds (`seedClaimedCity`) wrote the city without it, so `resume()` opened Sources, the first step not done, and a spec's own card never opened or was replaced. Specs that open their step by address (`update-order.spec.ts`) passed.
    - Found by: the e2e tier; the unit tests of the controller and of `sources.ts` were green, and no spec of a later step ran in the M28 task.
    - Fix and pin: `seedClaimedCity(…, sourcesChosen)` also saves the suggested sources, as the owner's **Save my choice** would; the four install specs pass `true`, and `seedPublishedMap` (which rewrites the city as published) keeps a choice seeded before it. With its card open again, S-A57-HAPPY-UPDATE reached an expectation older than the 2026-11-12 order (it awaited the pipeline beside the server); it now awaits the server alone, then the pipeline and the site, as `update-order.spec.ts` pins. No other assertion changed.
    - **A new required step changes the world every later step's seed stands for: update the shared seeds in the same task and run the specs of the steps after it. A spec that fails early hides every later expectation: read them again once it runs through.**
720. **The live map asked for a tab icon its city does not have.**
    - Seen: 2026-11-14, the Grok scout on the live Bucharest map: `GET …/cities/bucharest/icon-own-32.png` failed with `net::ERR_BLOCKED_BY_ORB` early, from `tab-icon.js`; `icon-180.png` and `manifest.json` answered 200.
    - Cause: nothing was mistyped or unpublished: Bucharest wears the default icon, and `icon-own-32.png` exists only for an upload. `showCityIcon` probed it with an `Image` on every load to learn whether it existed; the bucket's 404 is XML, which Chrome blocks as an opaque cross-origin response and logs as an error. The e2e fake served every `icon-*.png`, so no test saw a city without the file.
    - Fix and pin: the manifest says `city.ownIcon: true` only while `icon.source` is `custom` (a source change requests a build); the page reads the manifest and asks for the own icon only then. S-V54-BAD-NOREQUEST; `scripts/site/test/hosting-pages.test.ts`, `functions/test/publish/assemble.test.ts`, `functions/test/publish/fields.test.ts`.
    - **Never learn whether an optional file exists by requesting it: a missing cross-origin object is an error the visitor's console shows. Publish the fact beside the data the page already reads.**
721. **Step d3 kept "Last seen installing" after Update the map, while every computer ran the new pipeline.**
    - Seen: 2026-11-14, 18:41, the live admin: step d installed 1.0.0-beta.1+cd570a8; d3 said "Installed: 62c7179 … Last seen installing 18:41" with no Continue, yet the PC, the NUC and the ZenBook all reported `version` cd570a8 on image `sha256:0cd7385f…`.
    - Found by: Firestore read-only: `setup/status.install.pipeline` = `working`, release 62c7179, image `sha256:6dc86628…`, build `cdef0f7d…`, written 16:41:31Z and never again; the three worker documents on the new digest, `outdated: false`. The build's last step (`jobs`) had put the new image on `raster-pipeline`, so it had ended.
    - Cause: the record is written only by the admin tab that watches the build with a Google token. That tab reloaded itself after the deploy (lesson 718) and opened without a token; its flow had never looked, so its own view was not "at work" and lesson 717's pause (with Continue) never fired: the card showed the record, frozen. The server, which reads the job's image for every `worker.image`, never wrote what it knew back.
    - Fix and pin: `installedImage` brings the record up to the job (another digest with a release label → `installed`, release, build time, digest); a card over a build only a record says is at work, on a page without a token, says following paused and offers Continue. S-A62-HAPPY-RECORD-FOLLOWS-JOB, S-A62-BAD-RECORD-FOLLOWS-JOB, S-A56-HAPPY-RECORDED-WORKING, S-A56-BAD-RECORDED-WORKING.
    - The same evening's other report, "the ZenBook shares nothing and the eight Bucuresti actual series (`ar-mwgcdw8s-*`) are not claimed", was no fault: all eight had their copies at 12:09–13:42Z and ran (six wait for points, two for approval); no job waited for a copy, so `worker.archiveCopy` `wanted` answered "nothing" every two minutes and the Computers card rightly showed no sharing line. The NUC was idle because its governor paused it (`share.why: thermal`), which never removes it from the computers a holder shares for.
    - **A state only a browser tab records goes stale the moment that tab reloads: let the server, which sees the truth (the job's image), correct the record, and never show a recorded "at work" without a way to look again.**

722. **The timeline opened on today instead of the selected year.**
    - Seen: 2026-11-14, the owner on the live map: a scrolling timeline started at today (the top standing) though another year was selected.
    - Cause: `hcm-timeline.ts` centred the selected year only when the value, the density or a drag changed. On a phone the card rests as its pill (`collapsed`) and opening it changed none of these; a year set before the card was laid out was centred against no size and never again.
    - Fix and pin: `TimelineScroll` (`timeline-scroll.ts`) keeps a centring pending until the card has a size and is not a pill; opening from the pill and every new size ask again. `hcm-timeline-edges.test.ts`, S-V04-HAPPY-START-AT-YEAR, S-V04-BAD-START-AT-YEAR-EDGE. The unit test of the date menu also clicked the pill while it still glided from today (its 350 ms spring) and picked the wrong year once the gap shrank to 40 px: it now clicks the year's own stop.
    - **Work that needs a layout (scroll, measure) waits until the element has one; never drop it because it came too early.**

723. **A dated layer's name ended in an ellipsis in Layers, cut under text spacing at 4K.**
    - Seen: 2026-11-14, from base commit 58ef989b on: the tour journeys "A historical year…", "The year chip…" and "A TV or a games console…" at `tour-x3840-light-ro` failed `[clipped-text] "Fotografie aeriană 1980 (e2e)" … cuts its text` in every `+ text spacing` check of `hcm-overlay-list`'s `span.label`; the same failure stopped the scroll-hint and date-menu journeys.
    - Cause: 3be559b7 put each layer's date below its name and kept the row at 48 px by making the name `nowrap` with `text-overflow: ellipsis`. In the 4K panel's 211 px column the name fit; WCAG 1.4.12's letter and word spacing made it longer than its line, so the ellipsis hid the layer's year. The specs of that change ran at 360 and 1440 px without text spacing.
    - Fix and pin: the dated name wraps (`overflow-wrap: anywhere`, no ellipsis); a name that fits keeps the 48 px row, a longer one grows it. `overlay-list.test.ts` (`badPath_longNameWrapsWholeInATallerRow`), S-V03-BAD-LAYER-NO-DATE now asserts the whole name wrapped.
    - **Never keep a row's height by cutting its text: an ellipsis is lost content under text spacing. Let the text wrap; the height holds for text that fits.**
724. **The tour's year-chip states pointed a mouse at a labelled year and a finger at a scrolling track.**
    - Seen: the same run: `timeline-chip-hover` waited 15 s for a chip "1974" at `tour-x3840-light-ro`; once past it, `timeline-chip-finger` at `tour-c360-light-en` never selected 1977.
    - Cause: the states predated the fixed gap (58ef989b, then 40 px in 96c150dc): a lying timeline labels every year, so a mouse over stop 9 rightly shows no chip; and a scrolling card scrubs only from the year pill, a finger elsewhere scrolls it (`touch-action: pan-y`), as `timeline-chip.spec.ts` already did. The product was right; the tour was stale.
    - Fix and pin: the hover state looks for a stop without its label (`.minor`, a standing card's years under the pill) and expects its chip, or no chip over a labelled year when the card has none; the finger state starts on the pill (`pillOn`, now shared in `e2e/support/timeline.ts`).
    - **When a behaviour changes, run the tour journeys that visit it, not only its spec: a journey that fails early hides the states after it.**
725. **knip reported e2e/tour and e2e/admin/support as unused in a worktree without node_modules.**
    - Seen: 2026-11-14, knip in a fresh worktree: fifteen unused files (`e2e/tour/*.tour.ts`, `e2e/setup/*.setup.ts`, the mock APIs) and unused exports in `e2e/admin/support`, after `ERROR: Error loading e2e/playwright.config.ts (Cannot find module '@playwright/test')`.
    - Cause: knip's Playwright and Vite plugins read the entry points from the configs; a config that cannot load (no `node_modules`) gives no entries, so everything only those configs reach looks dead. With the dependencies installed knip passes on the same commit: nothing was dead.
    - Fix: none in the code; run the static stage in a checkout with its `node_modules` (a worktree links them from the main checkout, as `ship.sh` does).
    - **Read knip's `Error loading … config` lines before deleting what it calls unused: a config that fails to load makes its entries look dead.**
726. **A Landsat preview came out solid yellow and its offset could not be measured.**
    - Seen: 2026-11-14, the admin's approval queue, Bucharest's `LT51820291991181XXX03` (30 June 1991, `LT05_L1GS_182029_19910630_20200915_02_T2`): yellow over the whole window, a few grey blobs, "Its offset from Sentinel-2 could not be measured", 0.5 % cloud over the city.
    - Cause: the scene is one cloud deck, saturated in every colour band (DN 255) over the whole city; a systematic (L1GS) product's quality band and its metadata called it 0 % cloud, so the harvest's cloud filter and the tick took it. The stretch then had no range: blue's 2nd and 98th percentiles were both 255, so every blue pixel became 1, while red and green sat at their 98th percentile (255): yellow. A flat image has no phase-correlation peak.
    - Fix and pin: a pixel saturated in a colour band (its type's largest value) counts as cloud, and a band with no range left stretches from 0 to its largest value (white) (`landsat/colour.py`, `compose.saturated`; `S-P30-BAD-SATURATED`).
    - **Never trust a quality band alone for cloud: a saturated sensor is cloud too, and a stretch must survive a band with no range.**
727. **A Landsat scene measured 3,744 m off Sentinel-2 while every other was within a pixel.**
    - Seen: 2026-11-14, Bucharest's `LT51820292008228MTI00` (15 August 2008): 124.8 px (3,744 m) off, held for approval; the 1984 to 2026 scenes were 2 to 5 m off.
    - Cause: the delivery was `LT05_L1GS_…_T2`: USGS could not place it on ground control points, so it is placed only by the satellite's orbit and attitude (L1GS), kilometres off; every other scene was `L1TP`. The pipeline treated every Level-1 product as already on the ground.
    - Fix and pin: `landsat/correct.py` reads the level from the delivery's name (or its first member); an L1GS or L1GT scene over a pixel off and within 5 km is moved by the measured shift and measured again, kept only within a pixel; past 5 km, or unconfirmed, it is left where it lies and the report says `refused` with why; a moved scene always waits; the approval card says how far it was moved, or why not and what to do (`S-P30-HAPPY-SYSTEMATIC-MOVED`, `S-P30-BAD-SYSTEMATIC-IMPLAUSIBLE`).
    - **Read the product's own processing level before trusting its placement, and move a scene only by a shift a second measure confirms, within what that level can be off.**
728. **A cancelled Landsat import could not be imported again, Find hid it, and Search read "Searching…" on every source for five minutes.**
    - Seen: 2026-11-14, Bucharest: the owner cancelled `LT51820291991181XXX03` (1991) and `LT51820292008228MTI00` (2008) to run them on the fixed pipeline; Find's Landsat 5 TM then listed only 1984 and 1985, and "Search USGS again" said Searching… for all six sources with no message.
    - Cause: (1) no version or job page offered a new import of the same scene; only the scene's own page had Import again. (2) Find reads the scenes best score first, 100 at a time, and its source and year filters kept only what that page held: every Landsat 5 scene ranked above 68 is from 1984 or 1985, and the 1991 and 2008 ones (68) lay past the first page; nothing hid imported scenes. (3) The harvest wrote all six datasets `searching` at its start although it searches two at a time, and a tail step that started in time (the browse copies, one at a time) ran past the callable's 540 s: the run was stopped before its outcome was written (`ops/harvest-bucharest` stayed `running`), so the page waited for its own timeout.
    - Fix and pin: **Run again with the latest pipeline** (`imagery.import` with `again`) on a USGS version that waits, was cancelled or failed, on its job's page, and as **Imported: run again** on Find's card, whose tag says the version's state (`S-A130-*-RUN-AGAIN*`, `S-A130-*-FIND-IMPORTED`); a source or year filter reads the next pages by itself while it keeps fewer than 50 (`wantsMore`); a dataset waiting its turn is `queued`, every tail step is cut at the run's end (`harvest.tailCut`) so the outcome is always written, and the search line says the usual length (up to 7 minutes) and the minutes so far (`S-A11-*-HARVEST-QUEUED`, `S-A11-BAD-HARVEST-TAIL-CUT`, `S-A11-*-SEARCH-ELAPSED`).
    - **A client-side filter over a paged query hides what lies past the page: read on while the filter keeps too little. A step that starts within a budget must also end within it.**
729. **Suggested pairs for two archive maps read "high, 98 %" and all lay 18 km outside Bucharest.**
    - Seen: 2026-11-14, the live admin: the 1974-01 and 1974-02 maps of the owner's `harti.zip` import each offered 100 suggested pairs at "Confidence high 98 %", every one around 44.58–44.60 N, 25.89–25.95 E, about 18 km north-west of the city; Accept all would have published both maps in the wrong place.
    - Cause: the single-map placer (`placing/single.py`) searches the city's bounds grown by half (`reference.CITY_MARGIN`), and its coarse search locked onto a street grid outside the city. That placement did not hold (no fine fit, no clean rival), so `_help` offered its closest junction pairs as suggestions, scored only by how close each drawn junction snapped to an OpenStreetMap junction (`fine.suggestion_pairs`: 1 on the spot). In a dense street network almost every junction snaps within a pixel or two under any placement, so the score said nothing about whether the placement was right, and nothing compared it with the city's own area. The georeferencer showed 0.98 as "high" and offered Accept all; the approval card would have taken a low checkpoint error from those same pairs.
    - Fix and pin: a placement that did not hold scores its pairs at closeness × `UNPROVEN_SHARE` (0.55: at most medium, never high); a placement whose footprint lands outside the city's own bounds (`placing/city_guard.py`, the twin of `landsInCity` in `@hcm/shared`: the centre within the bounds grown by a quarter, at least half the smaller box shared) is never warped or suggested and the version waits with `OUTSIDE_CITY`. The georeferencer marks suggestions whose places would put the map outside the city "Doubtful: the map would land outside the city" with no percentage, says why, and Accept all takes none; the approval card says a version lies mostly outside the city and Approve asks first (`approveOutside`). S-P20-BAD-OUTSIDE-CITY, S-A44-HAPPY-CITY-GUARD, S-A44-BAD-OUTSIDE-CITY.
    - **A match score measures agreement, not location: check every automatic placement against the city's own area before calling it sure, and never let a score made of nearest-neighbour closeness alone reach "high".**
