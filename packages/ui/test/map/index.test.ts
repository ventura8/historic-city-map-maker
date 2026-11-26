import { describe, expect, it } from 'vitest';

import * as draw from '../../src/map/draw/index.js';
import * as map from '../../src/map/index.js';

describe('the map entries', () => {
    it('happyPath_mapExportsThePortsAdapterAndHelpers', () => {
        expect(new Set(Object.keys(map))).toEqual(
            new Set([
                'CONE_MIN_ZOOM',
                'EventListeners',
                'Listeners',
                'MAPBOX_GL_CSS_URL',
                'MAPBOX_GL_SCRIPT_URL',
                'MAPBOX_GL_VERSION',
                'MAPBOX_INTEGRITY_ATTRIBUTE',
                'PHOTOS_OVERLAY_ID',
                'browserAdapterEnv',
                'createMapboxPort',
                'createViewerMapPort',
                'nativeMap',
                'loadMapboxGl',
            ]),
        );
    });

    it('happyPath_drawExportsTheRulesAndTheTerraDrawAdapter', () => {
        expect(new Set(Object.keys(draw))).toEqual(
            new Set([
                'CLICK_DRAW_OVERLAY_ID',
                'DRAW_DECIMALS',
                'checkGeometry',
                'checkPositions',
                'createClickDrawPort',
                'createTerraDrawPort',
                'loadTerraDraw',
                'drawnPositions',
                'polygonCrossesItself',
                'ringArea',
                'roundGeometry',
                'roundPosition',
                'segmentsMeet',
                'shapeGeometry',
            ]),
        );
    });
});
