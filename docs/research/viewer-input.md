# Viewer input: shortcuts, gamepad, the basemap's light, the accessibility statement

The owner's request of 2026-11-07 ("keyboard and gamepad support for viewers"). Behaviours V36 to V39 of `e2e/scenarios.json`. This is the contract the code follows; the public description is `docs/ENGINE_API.md` → *Keyboard and gamepad* and → *`basemap.config`*.

## 1. One command set

`packages/ui/src/viewer/input-commands.ts` is the one place that decides what an input does: `year-next`, `year-previous`, `opacity-up`, `opacity-down`, `photo-next`, `photo-previous`, `layers`, `help`, `close`. Keyboard and gamepad both go through `HcmMapViewer.runInput(command)`, which applies `commandAllowed` and then acts on the store. No input path touches the map or the hash except through the store, apart from the gamepad's camera (§3).

- *Current layer*: the first visible raster overlay. None visible: the toast `input.noLayer`.
- *Photos*: the photos near the year when a year is chosen, all of them at "today" or in the lightbox; steps wrap around. None: `input.noPhoto`.
- *Feedback*: year and opacity changes show in a toast, which is also the announcement.
- *Layers where the panel is always docked*: nothing opens and the store is not touched, so the photo or place open beside the panel stays; only the focus moves.
- *Which surfaces allow what*: over the lightbox only photos and close; over About and the help panel only help and close; without WebGL no year, opacity or Layers.

## 2. Keyboard

The listener is on the document, but a key counts only when the event comes from inside the viewer, or from the page's body while this is the page's first viewer. A second viewer or the host page's own controls are never driven.

| Key | Command |
| --- | --- |
| `.` and `,` | later and earlier year |
| `o` and `i` | more and less opacity of the current layer |
| `n` and `p` | next and previous photo |
| `l` | open or close Layers (on an extra-large window, where the panel is always docked, move the focus to it) |
| `?` | the help panel |

Why these keys:

- Arrows, `+`, `-` and `=` belong to Mapbox on the focused map, and to the timeline and the lightbox.
- A key with Ctrl, Alt or Meta is never taken (AltGr reports Ctrl and Alt), nor one being composed, nor one a control already handled.
- Focus in a field, a contenteditable, a text-like role or an open menu takes nothing: typing always wins.
- Only the opacity keys repeat when held.
- A screen reader in browse mode swallows these letters itself and nothing happens in the page. Its keys are not overridden; focus mode reaches the shortcuts. This has not been tested with people, and the help panel does not say it, for the entry's budget.
- WCAG 2.1.4 (character key shortcuts) asks for a way to turn single-key shortcuts off: the switch in the help panel does, stored as the `shortcuts` preference (`hcm:<cityId>:shortcuts`, localStorage, like language and theme; no cookie). With it off `?` does nothing either, so the panel also opens from About.

The help panel is a mode of `<hcm-about-dialog>` (`sheet: 'help'`), so it shares the dialog, the focus return and the map's legal line at its foot.

## 3. Gamepad

- **Lazy**: the entry only listens for `gamepadconnected` (`viewer/gamepad/watch.ts`) and looks once at the pads the browser already reveals. The chunk `gamepad-<hash>.js` (`viewer/gamepad/gamepad.ts`, `@hcm/ui/viewer/gamepad`) is fetched only then, and has its own row in `scripts/ci/check_bundle_budget.py`. A failed fetch logs a warning and retries at the next connection.
- **Mapping**: only `mapping === 'standard'` is read. Any other pad is refused once with a toast, and nothing polls it. A cross-origin frame without the `gamepad` permission throws from `getGamepads`: that reads as no pads.
- **Loop**: one `requestAnimationFrame` loop, only while a standard pad is connected and the tab is visible. It stops at `visibilitychange` to hidden and at disconnect. When it starts, what is already held counts as held, so a press from before fires nothing.
- **Sticks**: a radial dead zone of 0.15. The left stick pans at up to 500 px/s, the right stick's vertical axis and the triggers zoom at up to 1.5 levels/s, its horizontal axis turns the map at up to 90°/s (§6). The camera goes through `MapPort.getView` and `flyTo(view, {animate: false})`, Mapbox applies the city's bounds and zoom range, and a covered map (a modal open, no WebGL, not ready) does not move.
- **Buttons** (standard indices): 0 A activates what has the focus, or with nothing focused does what Enter does on the map (the photo or place at its centre); 1 B closes the menu or the front surface; 3 Y Layers; 4 and 5 LB and RB previous and next photo; 8 Back help; 9 Start menu (not under a modal surface: `click()` fires on an inert element too); 12 to 15 the D-pad is spatial navigation (§6): the focused control gets the arrow key (the timeline steps its year at once, the menu moves its item), and otherwise the focus goes to the nearest control that way. A and the D-pad go through the viewer (`GamepadSurface.activate`, `navigate`), so the pad, the arrow keys and the Xbox's key emulation share one code path in the entry.
- **An open menu** takes no command, as it takes no shortcut: only the D-pad, A and B act in it, so nothing opens behind it.
- **Focus**: Chromium's `:focus-visible` shows no ring on a programmatic focus after a mouse click, so from the pad's first press on, every frame sets the ring on what has the focus, through the CSSOM (the CSP allows that), and blur removes it. Reading the focus each frame covers every path, also those that focus after a render (Y, Start, a closed surface's opener), with no code in them. A control clicked with the mouse after that gets a ring too, which harms nothing and costs the entry, which has no margin, no listeners.
- **Limits**: tested only with a fake pad (`navigator.getGamepads` replaced); no real hardware was available. Two viewers on a page both follow the pad.

## 4. The basemap's light

`core/map-light.ts`: `mapLight(state)` is `day` or `night` from the effective theme (`theme`, or `prefers-color-scheme` under `system`, kept in the state as `systemDark`), and null when the city's `basemap.config` names `lightPreset`. A dark theme also goes into the mount's `config`, so a dark page never flashes day. After that `MapSync` writes through `getBasemapOption` and `setBasemapOption` only what the mounted style reports having. Light never adds a map load; a style without the property is never written to, and Mapbox ignores the mount's `config` for it. Compare's second map follows through its own `MapSync`.

Standard's light dims what is not emissive, and Mapbox's default emissive strength is 0 for fill, line and circle layers (1 for icons and text). So the raster, the view cones and the POI fills, casings, lines and discs set `*-emissive-strength: 1`: the colours a city owner chose read the same by day and by night. Not checked on a real Mapbox Standard night by eye; the e2e tier reads the value from the mounted map.

## 5. The accessibility statement

In About, catalogue strings in Romanian and English: what works, what is missing (no screen reader test with people, the map's picture has no text alternative) and how to report a problem. It claims no legal conformance by saying none; the sentence that said so went to the entry's budget. The manifest has no contact field, so the report is a link to the engine's issue tracker (`https://github.com/ventura8/historic-city-map-maker/issues`), on every city, also one with no credits: the viewer's accessibility is the engine's. GitHub asks for a free account. A contact per city would be a new manifest field, with its admin editor; the owner's decision, not made here.

## 6. Games consoles and the 10-foot view (beta.1)

The owner's request of 2026-11-13: "make sure our app (the viewer) is usable on PS and Xbox". Behaviours V65 and V66 of `e2e/scenarios.json` (`e2e/specs/viewer/consoles.spec.ts`, the console's card in `no-webgl.spec.ts`, the tour's journey `tv` in `e2e/tour/tv-states.ts`); DECISIONS-for-review.md §194.

### What the consoles offer (research, 2026-11-13)

- **Xbox Series X|S**: Microsoft Edge, Chromium since 2021, user agent with `Xbox; Xbox Series X`. The controller starts as a mouse cursor ("browsing mode"); Edge switches to "game controls" when the visitor asks or a page reads the Gamepad API, and then the Gamepad API reports a standard pad (Xbox Cloud Gaming runs this way). WebGL 2 is there (Chromium's ANGLE on the console's GPU), so Mapbox GL JS 3 runs. The legacy EdgeHTML property `navigator.gamepadInputEmulation` (`mouse`, `keyboard`, `gamepad`; Microsoft's UWP docs, *How to disable mouse mode*) turns the D-pad, A, B, Y and View into keys named `GamepadDPadUp`, `GamepadA`, ...; Chromium Edge has no such property and no page-level switch was found.
- **PlayStation 5**: no browser app. A WebKit window opens from links in Settings (the user guide, sign-in pages); the user agent says `PlayStation; PlayStation 5`. The controller drives a cursor and the D-pad moves between links. The only report found says WebGL apps do not run there; no reliable report of the Gamepad API was found, and none was assumed.
- **Not tested on real hardware**: no console was available. Everything below is checked with Chromium in Playwright (a fake Gamepad API, keyboard events, a 1920 × 1080 window with a coarse pointer, WebGL removed).

### What the viewer does

- **Spatial navigation** (`packages/ui/src/viewer/spatial-nav.ts`, in the entry): an arrow key on a control that has no use for it moves the focus to the nearest reachable control on screen in that direction (the gap ahead, plus twice the gap across, plus a tenth of the centres' offset as a tie-break; tabbable and not inert, so a modal surface keeps the focus inside). A control that uses its arrows keeps them: typing, the map's canvas (Mapbox pans), a menu, and every component that cancels the key (the timeline, a slider, the lightbox, a toolbar along its axis). An arrow from outside the viewer, with a modifier, or with nothing that way stays the browser's.
- **The D-pad** (the gamepad chunk, or the Xbox's keys): the focused control gets the arrow key; a horizontal slider keeps left and right, and up and down leave it, so the timeline is reached and left with the D-pad alone; from the map or with nothing focused the move starts from the viewer's middle.
- **Xbox key emulation**: the viewer sets `navigator.gamepadInputEmulation = 'keyboard'` only where the property exists; `GamepadDPad*` navigate, `GamepadA` activates, `GamepadB` closes, `GamepadY` Layers, `GamepadView` help. The gamepad loop then ignores those buttons, so nothing acts twice. Chromium Edge keeps its cursor: every control also works with it.
- **A focus ring for the room**: `--hcm-focus-ring-width` (3 px; the kit's own token elsewhere) is 6 px on a window 1200 px wide or more with a coarse pointer or none (`viewer-styles.ts`). The gamepad's ring uses the same width.
- **The 10-foot view**: on the same windows the kit's buttons, icon buttons, small FABs, segmented buttons and chips are 48 px to the eye (`--hcm-control-size`, `--hcm-chip-size`; 40 and 32 px elsewhere, with their 48 px touch target), and the body, label and title type a quarter larger (the M3 type tokens set again on the viewer's wrapper, since `applyTheme` sets them on the host). Nothing shows on hover only: the timeline's year chip also shows for the keyboard's focus (track/timeline).
- **No WebGL on a console**: `game-console.ts` reads `Xbox` or `PlayStation` in the user agent, and the fallback says `error.webglConsole`: the console's browser cannot draw the map because it lacks the 3D graphics it needs, the photo list below still works, and the map opens on a phone. Every other browser keeps `error.webgl`.
