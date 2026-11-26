/** A layer's client edits: every field `CLIENT_WRITES.layer.update` lets an admin change, each at an edge of its range. */
import type { Data } from './world.js';

export const LAYER_EDITS: Readonly<Data> = {
    label: { ro: 'București, 1966' },
    description: { ro: 'Corona KH-4A.' },
    attribution: 'USGS',
    rights: { licence: 'CC-BY-SA-4.0', author: 'Institutul Geografic', source: { label: 'Biblioteca Națională' } },
    year: 1967,
    date: '1967-05-31',
    order: 2,
    opacity: 0,
    defaultVisible: false,
    adjustments: { brightnessMin: 0, brightnessMax: 1, contrast: -1, saturation: 1 },
    published: false,
    kind: 'map',
    placeIds: ['poi-1', 'poi-2'],
    level: { order: 0.5, label: { ro: 'Mezanin' } },
    shotDirection: 360,
};
