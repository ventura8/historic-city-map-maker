/**
 * One editor area as the admin loads it lazily (`DECISIONS-for-review.md` §34b): the page's elements of `@hcm/ui/admin`
 * and the area's store module, in one chunk per area (`../pages/<area>.ts`) that the page registry imports when the
 * area's route first opens. The entry (`../index.ts`) keeps only the shell, Setup and the editing kit.
 */
import type { AreaElements } from '@hcm/ui/admin';

import type { ContentArea, ContentModules } from '../content/areas.js';

export interface AreaChunk<Area extends ContentArea> {
    readonly elements: AreaElements;
    readonly module: NonNullable<ContentModules[Area]>;
}
