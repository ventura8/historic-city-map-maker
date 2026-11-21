# M18: improvements from the owner's use (2026-11-08)

The owner's standing rule: when something is off or the owner struggles, fix it or automate it. This file lists the
nine items of 2026-11-08, what was done for each, where it lives and which scenario rows test it. It is the record of
the track `track/improve`; later addenda are appended below, never rewritten.

## 1. Update the map appears after a deploy without a reload

**What was off.** A tab left open across a deploy kept the release it booted with (`runtime.json`, read once), so Home's
and Setup's **Update the map**, which compare what is installed with the admin's own release, stayed hidden until the
owner reloaded. The Reload banner of finding 29 said a newer admin was ready, but nothing happened by itself.

**What was done.** `packages/admin/src/app/release-reload.ts` follows the release watch: once Hosting serves a newer
admin the tab reloads by itself when no one is looking at it (hidden) or the owner has just come back to it (the newer
release seen within `RETURN_WINDOW_MS`, 10 s, of the tab becoming visible, or on any later return), and only when no
edit would be lost (`unsaved`). While the owner works on a visible tab, or with an unsaved edit, the Reload banner stays
as before. The sign-in lives in the tab's `sessionStorage`, so the reload keeps it. Review of 2026-11-08: an upload
still being sent (a GeoTIFF on Imagery, the Photos queue: `AreaStore.busy`) holds the reload back as an edit does; the
unsaved guard still does not ask about it.

**Rows.** S-A61-HAPPY-SELF-RELOAD (new), S-A61-HAPPY (now the banner seen while working), S-A61-BAD-UPLOAD-HOLDS-RELOAD
(`planned`: unit tests only).

## 2. A blocked Google window: plain words and one real retry

**What was done.** `packages/admin/src/app/consent-retry.ts` wraps the shell's Google consent: a window the browser
blocked puts `adminShell.oauth.popupBlocked` in the snackbar with **Try again**. Its click is a real click, and the retry
asks Google inside it before anything is awaited, so the browser lets the window open. A retry blocked again offers the
same; a granted one keeps the token and says so (`adminShell.oauth.retryGranted`), and the step's own button then goes on
without another window. The words now say what to do: press again, else allow pop-ups from the address bar's icon.

**Rows.** S-A27-HAPPY-BLOCKED-TRY-AGAIN, S-A27-BAD-POPUP-BLOCKED.

## 3. Frames parked for points search again by themselves; a failed crop offers Locate again; re-runs are free

**What was done.**

- `functions/src/imagery/relocate.ts`, a part of `imagery.tick`: every frame waiting for points remembers the pipeline
  image it was searched with (`JobDoc.searchedWith`, written the first time a tick sees it). Once another image is
  installed (`installedImage`, the job `raster-pipeline`'s digest) the frame searches again by itself, as **Locate
  again** does, at most `RELOCATE_PER_TICK` (3) a city a tick. A refusal (inputs gone, files on the other place) is
  logged once and remembered, so no later tick asks again for the same image. Frames parked before this change keep the
  image of the first tick that sees them and search again at the next pipeline update. Review of 2026-11-08: only the
  image the job runs counts (`from === 'job'`); while the job cannot be read the record `setup/status` is no ground to
  search again, so nothing moves. A frame an editor is placing points on keeps waiting: the georeferencer marks its job
  `placingPoints` (`packages/admin/src/georef/placing.ts`, at the first edit and every 30 minutes; the rules let a client
  set it on a job `awaiting_gcps` only), and the tick holds it for `PLACING_POINTS_HOLD_MS` (2 h) after the mark.
- `imagery.locateAgain` (`functions/src/imagery/locate-again.ts`) also takes a frame whose crop failed (its job failed at
  `stitch` or `locate`), so the version page offers **Locate again** before anyone imports it anew; a failure after the
  crop stays Try again's.
- Locate again is free: never the day's limit (it never was) and, for a frame parked for points like the admin's points,
  one run of its own whatever the runs before used (`attemptForSearch`), where it used to refuse with
  `apiError.imagery.attemptsExhausted`. A failed crop's runs count as Retry's (review of 2026-11-08: with the pipeline
  unchanged the same failure would repeat without end): at `JOB_MAX_ATTEMPTS` it is refused and no longer offered.
- The day's limit (`functions/src/imagery/limits.ts`) counts only what brings imagery in: `usgs-import`,
  `geotiff-import`, `layer-join`. New points, a crop (`regeoref`) and tiles (`layer-tiles`) never count; a re-run still
  stops while the budget guard is red (`refuseWhileGuardRed`).

**Rows.** S-A69-HAPPY-AUTO-RELOCATE, S-A69-BAD-AUTO-RELOCATE-REFUSED, S-A69-HAPPY-FAILED-CROP, S-A69-BAD-FAILED-LATER,
S-A12-HAPPY-RERUNS-FREE; S-A69-BAD-ATTEMPTS now asserts the run of its own; review: S-A69-BAD-AUTO-RELOCATE-PLACING,
S-A69-BAD-AUTO-RELOCATE-RECORD, S-A69-BAD-FAILED-CROP-ATTEMPTS.

## 4. A join refused because a frame's layer is busy

**What was done.** `imagery.join` refuses a busy published frame's layer with its own code,
`apiError.imagery.joinLayerBusy`: the layer is processed or published right now and a join would change it under that
work. The admin (`packages/admin/src/imagery/join.ts`) shows it beside Join frames and offers **Join when it ends** in the
snackbar; chosen, it says it waits and asks `imagery.join` again every `JOIN_WAIT_MS` (a minute) while the admin is open,
at most `JOIN_WAIT_TRIES` (two hours). Once the layer is free the join starts by itself and the snackbar says so; any
other refusal ends the wait and is said. The area's end stops the wait.

**Rows.** S-A65-BAD-JOIN-LAYER-BUSY, S-A65-HAPPY-JOIN-WHEN-FREE (`e2e/admin/specs/imagery/join-wait.spec.ts`, built at
the merge of 2026-11-08: a frame published as its own layer, a job still running on that layer seeded in the emulators,
the page's clock moved on a minute at a time; and `packages/admin/test/imagery/join.test.ts`).

## 5. One Delete for an image at every stage

**What was done.** The same word and the same question everywhere: **Delete** and *Delete this image?* for a frame
waiting for points (the question `drop` of `hcm-imagery-page.ts`), one waiting for approval or approved at the guard
(Reject), a failed one (Dismiss) and a published one (the Layers page's delete). A deleted version reads *Deleted*, and
the filter *Hide deleted*. Review of 2026-11-08: the waiting frame's Delete is `imagery.reject` too (it cancelled the job,
so the version read *Cancelled*), and an image stopped at the guard is offered Delete beside the three ways out (it had
none).

**Rows.** S-A33-HAPPY-ONE-DELETE.

**At the merge with recal (2026-11-08).** A recalibration of a published version keeps the word Delete, but its question
says only the new fit goes and the published version stays (S-A89-HAPPY-DELETE-NEW-FIT, S-A89-BAD-DELETE-WAITING-BASE).

## 6. The viewer's Layers groups and the admin's pointer to Place categories

**Checked.** The viewer's Layers panel already groups Historical layers, Places (the city's categories, only when it has
some) and Map labels (S-V24-BAD-NO-POIS, `e2e/specs/viewer/map-labels.spec.ts`).

**What was done.** The admin's Layers page says that the public map's Places are the place categories, with a link to
Settings → Place categories (`hcm-layers-page.ts`, a 48 px target).

**Rows.** S-A39-HAPPY-FROM-LAYERS.

## 7. Home: What needs you

**What was done.** Home opens with **What needs you**: the historical images to approve, the role requests to accept,
the suggestions to review and the jobs that stopped (failed), each a link to where it is done (Imagery, Review, Jobs),
listed only while there are some; otherwise *Nothing needs you now.* A count the admin's role may not read (role
requests for anyone but the owner, suggestions for an uploader) is not asked: nothing there for them. Review of
2026-11-08: a count not read yet (an ellipsis) or that failed (a dash) keeps its item, so a failure never reads as
nothing to do. The counts are Firestore aggregations, one read per thousand.

**Rows.** S-A40-HAPPY-NEEDS-YOU, S-A40-BAD-NOTHING-NEEDS-YOU, S-A40-BAD-COUNT-UNREAD-SHOWN (`planned`: unit tests only).

**At the merge with stories (2026-11-08).** What needs you also lists *Stories to review* (M17's stories waiting in the
review queue), not asked for an uploader: S-A40-HAPPY-STORIES-TO-REVIEW, S-A40-BAD-UPLOADER-NO-STORY-COUNT.

## 8. The public map without WebGL

**What was done.** The consent card no longer covers the error card: without a map it flows in the photo list's column
under the error card instead of the docked card at the top (`viewer-render.ts`, `renderConsentBanner(..., false)`). The
list's first rows load their thumbnails at once (`EAGER_ROWS`, 12) and the rest lazily; the e2e now asserts the first
thumbnail is drawn. The live report of empty thumbnails could not be reproduced in the e2e world, where they load.

**Rows.** S-V02-HAPPY-NO-WEBGL-THUMBS, S-V02-BAD-NO-WEBGL-CONSENT.

## 9. An old starter file

**What was done.** When the computer's worker reports `old-starter`, the worker panel shows an alert with the one action
and what it unlocks: press Use this computer (on the same panel) and open the new file once; the computer updates itself
and hard frames are then placed by its own AI, free, before the owner is asked for points.

**Rows.** S-A68-BAD-OLD-STARTER; tour state `worker.panel-ai-old-starter`.
