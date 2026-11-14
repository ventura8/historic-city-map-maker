/** The camera of a scene: what the metadata says, else what the frame's id says (a real Argon frame was read as KH-4A: M9 §14). */
import type { BoundsRecord, UsgsDataset } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { sceneFields, trueSensor } from '../../src/imagery/scene-record.js';
import { sceneRecord } from '../support/imagery-fakes.js';

const BOUNDS: BoundsRecord = { west: 25.9, south: 44.3, east: 26.3, north: 44.6 };

function sensorOf(dataset: UsgsDataset, entityId: string, metadata: Record<string, string> = {}): string | undefined {
    return sceneFields(sceneRecord(entityId, { metadata }), dataset, BOUNDS)?.sensor;
}

describe('the camera of a scene', () => {
    it.each([
        ['corona2', 'DS09065A089MC039', 'KH-5'],
        ['corona2', 'DS1105-1071DF075', 'KH-4B'],
        ['corona2', 'DS1035-1057DA023', 'KH-4A'],
        ['corona2', 'DS009048-049DF012', 'KH-4'],
        ['declassii', 'DZB00403000026H017001', 'KH-7'],
        ['declassii', 'DZB1214-500086L005001', 'KH-9-mapping'],
        ['declassiii', 'D3C1203-300415F006', 'KH-9-pan'],
    ] as const)('happyPath_%s_%s_isNamedByItsIdWhenTheMetadataSaysNothing @S-A11-HAPPY-CAMERA-FROM-ID', (dataset, entityId, sensor) => {
        expect(sensorOf(dataset, entityId)).toBe(sensor);
    });

    it('happyPath_theMetadataNamesArgonInWords @S-A11-HAPPY-CAMERA-FROM-ID', () => {
        expect(sensorOf('corona2', 'E1', { 'Camera Type': 'ARGON Mapping' })).toBe('KH-5');
        expect(sceneFields(sceneRecord('DS09065A089MC039'), 'corona2', BOUNDS)?.resolutionM).toBe(140);
    });

    it('badPath_theMetadataOutranksTheIdAndAnIdOfNoKnownFormKeepsTheDatasetsCamera @S-A11-BAD-CAMERA-UNKNOWN-ID', () => {
        expect(sensorOf('corona2', 'DS1105-1071DF075', { 'Camera Type': 'KH-4A' })).toBe('KH-4A');
        expect(sensorOf('corona2', 'XYZ001')).toBe('KH-4A');
        expect(sensorOf('declassii', 'XYZ001')).toBe('KH-9-mapping');
    });
});

describe('the camera of a stored scene', () => {
    it('happyPath_aSceneHarvestedBeforeTheIdRulesIsReadByItsId @S-A12-HAPPY-STALE-CAMERA', () => {
        expect(trueSensor({ dataset: 'corona2', entityId: 'DS09065A073MC043', sensor: 'KH-4A' })).toBe('KH-5');
        expect(trueSensor({ dataset: 'corona2', entityId: 'DS1103-1058DF027', sensor: 'KH-4A' })).toBe('KH-4B');
    });

    it('badPath_aNamedCameraOrAnIdOfNoKnownFormIsKept @S-A12-BAD-STALE-CAMERA-KEPT', () => {
        expect(trueSensor({ dataset: 'corona2', entityId: 'DS1035-1057DA023', sensor: 'KH-4B' })).toBe('KH-4B');
        expect(trueSensor({ dataset: 'corona2', entityId: 'XYZ001', sensor: 'KH-4A' })).toBe('KH-4A');
        // Admin sweep 2026-11-14: an Argon frame's id (mission 9xxxA, `MC`) is Argon whatever the record or the metadata says.
        expect(trueSensor({ dataset: 'corona2', entityId: 'DS09065A073MC043', sensor: 'KH-4B' })).toBe('KH-5');
        expect(sensorOf('corona2', 'DS09059A041MC015', { 'Camera Type': 'KH-4A' })).toBe('KH-5');
    });
});
