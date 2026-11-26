# A photo's precise date and its source (the owner's requests, 2026-11-07)

The owner's words: "for pictures we want the ability to set the year or the year and month, or year, month and day" and "for pictures we want the property to link the photo from where we have it". This is the shared contract; `docs/ENGINE_API.md` → `photos[]` is the public one.

## 1. The date

- **Fields**: `month` (1 to 12) and `day` (1 to 31) join `year` and `yearEnd`, optional, on `photoDocSchema` (`cities/{city}/photos/{photo}`) and on `photoSchema` (the manifest). The rules (`validPhoto`) check the same.
- **The rules** (`packages/shared/src/schemas/photo-date.ts`, each with its message):
  - `validation.datePart`: a month needs a year, a day needs a month;
  - `validation.dateImpossible`: the day exists in that month of that year (no 31 April, 29 February only in a leap year);
  - `validation.dateRange`: a month or a day dates one year: `yearEnd`, when present, equals `year`.
- **The timeline** keeps using `year` and `yearEnd`: `isPhotoNearYear`, the list and the map do not read the new fields.
- **What the visitor reads** (`photoDateText`, in this order): `dateText`, the source's own words, when present (it stays as it was); else the date at its precision through `Intl.DateTimeFormat` (`12 July 1936`, `12 iulie 1936`, `July 1936`, `Iulie 1936`: `en-GB` and `ro-RO`, first letter upper case); else the year or years as before (`photo.year`, `photo.years`); else `photo.unknownYear`.
- **The editor**: Year and End year as before; Month appears once there is a year (a list of the month names from `Intl`), Day once there is a month. Clearing the year clears the month and the day, clearing the month clears the day. While the photo has a range the Month field stays hidden, unless it already has a month, which then shows `validation.dateRange` where it can be cleared.

## 2. The source

- **In Firestore nothing new**: `sourceUrl` (https) and `sourceLabel` exist since M2, in the rules, the editor, the upload's remembered choices and the bulk dialog (Author, source and licence).
- **New in the manifest**: `source: {url, label?}`, optional, strict; `url` https only. `assemble.ts` publishes it when the document has a `sourceUrl`. A `sourceLabel` with no address stays in the admin, as before: nothing in the manifest.
- **The viewer**: in the photo sheet, after the rights lines, `Source: <a>` through `externalLink` (`target="_blank"`, `rel="noopener noreferrer nofollow ugc"`, https only, the second line of defence). The link's text is the label, else the address's host name. It is text and an anchor, never HTML from data.
- **The editor**: its own section, Source (address, then the optional name), out of Author and rights. `links` stay as they are; `seed/bucharest/` does not change.

## 3. Compatibility

Additive for a new engine reading an old manifest: it stays valid and reads as before. v1.0.0 is prepared and not tagged yet, so these fields join the baseline every 1.x engine reads (`docs/ENGINE_API.md` → *Additions before 1.0.0*) and need no `city.engine.minVersion`. Should v1.0.0 be tagged first, this becomes a minor release and the manifest needs `minVersion`.

**Not additive for an engine from before these fields**: its `photoSchema` is strict, so `month`, `day` or `source` fail its whole manifest and every visitor gets `error.manifest.invalid`. `minVersion` would not help: both builds are 1.0.0, and it would only change the card. So the reader goes first, the new viewer on Hosting before the new functions:

- **Setup's Update the map** holds this by construction: the admin installs its own bundle, which Hosting serves (`M6-interfaces.md`, *The same release everywhere*), and it got there in a Hosting release with the viewer of the same commit. The server build that `build-spec.ts` runs before the site build finds the new viewer already live.
- **A deploy outside the app must keep that order**: `firebase deploy --only hosting` first, the rest after. One command does not: `firebase-tools` deploys functions before hosting, so `--only firestore,storage,functions,hosting` leaves a window of minutes, for good if Hosting then fails. That is the `deploy-firebase` job of `.github/workflows/ci.yml` (master only, off while `DEPLOY_ENABLED` is not `true`). **Open, for the owner's yes** (a workflow edit that makes no gate stricter is *Ask first*): split it in two commands, Hosting first.
- **A rollback of Hosting alone across this release** breaks the map at once, since the manifest already published carries the fields. Roll forward instead, or roll the server back too and save any edit so the manifest is built again.

## 4. Scenarios

Viewer: `S-V07-HAPPY-PRECISE-DATE`, `S-V07-BAD-IMPOSSIBLE-DATE`, `S-V07-HAPPY-SOURCE-LINK`, `S-V07-BAD-SOURCE-NOT-HTTPS`, `S-V07-BAD-NO-SOURCE`; tour state `photo-source`.

Admin: `S-A09-HAPPY-DATE-PRECISION`, `S-A09-BAD-IMPOSSIBLE-DATE`, `S-A09-HAPPY-BULK-SOURCE`, `S-A09-BAD-BULK-SOURCE-NOT-HTTPS` (its reason names the source address: `adminContent.photos.reason.sourceUrl`), `S-A09-BAD-DISCARD-MONTH`; tour states `photos.editor-date` and `photos.editor-impossible-date`. A source address that is not https in the editor stays `photos.editor-invalid`.
