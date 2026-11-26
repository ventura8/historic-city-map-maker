# M11: Mapbox publishing without the owner (design)

The owner, 2026-11-07: "the mapbox process needs to be automatic", and "i want to aprove satelite images". Nothing is built. Mapbox's pages read 2026-11-07; no real token used.

**Not chosen (the owner, 2026-11-07):** this design stays as the record of why. The owner chose to serve tiles from the project's own public bucket: `docs/research/M12-own-tiles.md`.

## Read this first: the Uploads path is not free by right

M7 §6, decision 83i and `publish-path.ts` call it free, with no compute units. Mapbox's documentation contradicts that:

- **It bills compute units.** The [tiling pricing guide](https://docs.mapbox.com/mapbox-tiling-service/guides/pricing/) covers MTS and Uploads alike: "Each tilesets processing job is billed in two ways: file size and compute units".
- **Free means an allowance**, shared with MTS ([pricing page](https://www.mapbox.com/pricing)): monthly 10,000 MB, then $0.007/MB; 20 CU, then $0.90/CU; 750 tileset hosting days.
- **Only the Console upload is documented as charge-free** ([Studio manual](https://docs.mapbox.com/studio-manual/reference/tilesets/): 20 uploads a month, 300 MB each). It is a human step.
- **No meter, no forecast.** An [upload's status](https://docs.mapbox.com/api/maps/uploads/) has no CU field. The guide's `estimate-cu` is absent from tilesets-cli's master `README.md` and `cli.py`. No spending cap is stated.
- **The API page marks Uploads as legacy** and recommends MTS; Mapbox guesses the zooms.

So scopes and a sweep alone are unsafe: `takeUploads` reserves nothing and skips the 24-tileset cap and the city's share, so five publishes could bill unseen. **Metering (§2) ships before the scopes.**

## 1. The owner's steps: one paste, one number

1. `MAPBOX_BOOTSTRAP_SCOPES` and `MAPBOX_TILES_SCOPES` gain `uploads:read`, `uploads:write` and `uploads:list` (for §6's duplicate check). A token cannot mint scopes it lacks ([Tokens API](https://docs.mapbox.com/api/accounts/tokens/)).
2. The tick lists the tokens once with the stored bootstrap token and records their real scopes in `setup/status` (`mapboxRecord`'s `scopes` only copies the constant). A `credentials` 403 sets it too.
3. If the bootstrap token already has the scopes, step 5 runs with no paste.
4. Otherwise the Setup's Mapbox card asks once: `https://console.mapbox.com/account/access-tokens/`, the copyable scope list, the billing facts above. Saving is the owner's consent to the path.
5. `setup.saveMapbox`, seeing the same `user`, skips `upsertPublicToken` and the city write, so viewer tokens and the manifest stay untouched. Another account is refused (new `ro`+`en` error). It mints the tiles token, writes `mapbox-sk-tiles`, commits `secretsRev`, then deletes the old token. Today `ensureTilesToken` deletes first and never checks a kept token's scopes.
6. After the first upload, the owner enters its CU from Statistics once (§2).

## 2. Metering: one guard for both paths

- `decide` runs for both paths; `takeUploads` only on `within`. The cap and city share now apply.
- Uploads reserve `UPLOADS_RESERVE_CU`, initially 5: Mapbox says 99% of jobs use 5 CU or less. **That is no bound for this raster.** `KM2_PER_COMPUTE_UNIT`, UNVERIFIED, is what walls these versions today.
- `uploadsUsage` counts the reservation as spent: four uploads a month.
- **Calibration gate:** one upload runs, then the sweep holds until the owner enters its CU; the reservation becomes `ceil(highest seen × 1.5)`.
- `fitsAllowance` counts `uploadedMb` and uploads in flight too, against 10,000 MB.
- `over` on this path waits for next month and the tick retries. **Pay** stays an explicit button.

## 3. The sweep

A new `imagery.tick` part, `freePath`, runs while the budget guard is green and the tiles token has the scopes: one version a tick, across cities, while no upload runs. Candidates: version `approved`, job `awaiting_approval`, no `mapboxJobId` or reservation, and any of a `skipped` `uploads` step, `guard.choice` `studio`, a verdict with no choice, or `too-large` with a Studio file. `pay` and an unexpired `defer` stay: the owner chose them.

That covers the Aug 1972 join and 1982, 1967, 1978, 1984, subject to §8. For `studio` it first runs the `studioTileset` search and links a tileset the owner already uploaded. Otherwise one transaction removes the `uploads` step and the verdict and choice, and queues `free-path-<secretsRev>`. Cloud Tasks refuses a known id; `claimAttempt` stops a second publish; the guard still runs, so nothing charges.

## 4. Layers already published

Nothing is republished; the viewer keeps its public token. A new version of an MTS layer stays on MTS behind the guard, because Uploads [cannot replace an MTS tileset](https://docs.mapbox.com/api/maps/uploads/). A layer linked from Studio has a Mapbox-assigned id, so an upload makes a second tileset: the cap must count it until the old one goes. `finalize.ts`'s handling of the old one was not checked.

## 5. What the admin sees

Within existing cards: the admin is at 630.0 of 630 KB, so a cut pays for additions.

- The path (`mapbox.via`), worded "uses your free allowance", never "free".
- Mapbox's `progress` on the `tiles` step.
- CU of 20, MB of 10,000, tilesets of 24.
- Why it waits: token, calibration, month, cap, Mapbox's error, no small copy.
- The Studio steps, the charge-free way out.

## 6. Failures: none charge, none reach MTS by themselves

An MTS fallback spends free units and locks the layer to MTS: the owner's choice.

| Failure | What happens |
| --- | --- |
| `credentials` 401/403 | Waits, attempt given back, no `skipped` mark, Setup asks |
| `status` 401/403 | Keeps polling. Today it falls back and can publish twice: a bug |
| `create` refused, status `error` | Stays approved with Mapbox's text; **Try again** or Studio |
| 429, 5xx | Cloud Tasks retries; a recorded upload is only polled |
| Lost after `create` | `GET /uploads` finds this tileset's upload before any new `create` |

Whether an upload that later errors is billed is unclear: its reservation stays.

## 7. Files over the free size

300 MB is the Console's limit; the API takes [10 GB](https://docs.mapbox.com/api/maps/uploads/), so `UPLOADS_FREE_MAX_BYTES` borrows the wrong constant. `write_studio` halves the resolution until the file fits, which the card must show. Keep 300 MB, as a separate constant, until calibration: CU grows with size. A version with no fitting copy offers **Make a small copy** or the guard's choices.

## 8. Approval stays the owner's

`autoPublish` defaults to `true`, so the policy approves without anyone. Read here as: approving each image is human, everything after it automatic. Proposed: `autoPublish` off for Bucharest; the sweep returns `approval.auto: true` versions to `awaiting_approval`. **To confirm with the owner.**

## 9. Not verifiable without a real token

Tests use fakes. Unproved:

- a raster's real CU, and whether the account is on [legacy pricing](https://docs.mapbox.com/mapbox-tiling-service/guides/legacy-pricing);
- whether Mapbox accepts the JPEG `studio.tif`, and its chosen zooms;
- that a public token reads a tileset created private;
- whether the billing period matches `usageMonth`;
- the five layers' origins and approvals.

**First real run:** paste; Self-test; one version publishes; log and card show the path; the map shows the layer; Statistics shows Tileset Processing CU and File Size. The owner enters the CU. Over 5: stop.

## 10. Decisions for the owner

1. Accept an unmeasured cost per job, capped by reservation, not by Mapbox. Otherwise Studio remains the only route.
2. Or try MTS: its [job record has `cu`](https://docs.mapbox.com/api/maps/mapbox-tiling-service/) (`finalize.ts` counts the estimate instead), it sets `maxzoom`, and Mapbox recommends it. One job could show the table is too high and open the guard with a true meter, but locks that layer.

## Scenario rows

Happy and bad, with tour states: `S-A70-*` token upgrade, `S-A71-*` sweep, `S-A72-*` reservation. `S-A64-BAD-NO-SCOPE` changes: no fallback.
