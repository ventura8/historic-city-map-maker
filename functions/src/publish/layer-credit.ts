import { UNCLEAR_CREDIT, type LayerDoc } from '@hcm/shared';

const SEPARATOR = ' · ';
const MAX_ATTRIBUTION_LENGTH = 500;

/** Keep the rights note in the public credit even when the saved attribution was edited separately. */
export function publicLayerCredit(layer: Pick<LayerDoc, 'attribution' | 'rights'>): string | undefined {
    const { attribution, rights } = layer;
    if (rights?.licence !== 'unclear') {
        return attribution;
    }
    if (attribution === undefined) {
        return UNCLEAR_CREDIT;
    }
    if (attribution.split(SEPARATOR).includes(UNCLEAR_CREDIT)) {
        return attribution;
    }
    const credit = attribution.slice(0, MAX_ATTRIBUTION_LENGTH - SEPARATOR.length - UNCLEAR_CREDIT.length).trimEnd();
    return `${credit}${SEPARATOR}${UNCLEAR_CREDIT}`;
}
