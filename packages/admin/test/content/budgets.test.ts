import { describe, expect, it } from 'vitest';

import { CONTENT_INPUT_BUDGETS, contentFlowBudget } from '../../src/content/budgets.js';

describe("the editors' input budgets", () => {
    it('happyPath_theContractsTableAsCode', () => {
        expect([contentFlowBudget('photoBatch'), contentFlowBudget('pointPlace'), contentFlowBudget('category')]).toEqual([3, 6, 3]);
        expect(Object.values(CONTENT_INPUT_BUDGETS).every((budget) => budget.inputs > 0 && budget.how.length > 0)).toBe(true);
    });

    it('happyPath_aDrawnShapeAndTheSlidersAddOnePerVertexOrMove', () => {
        expect([contentFlowBudget('polygonPlace', 5), contentFlowBudget('layerAdjustments', 3), contentFlowBudget('cancelJob', 9)]).toEqual(
            [10, 4, 3],
        );
    });

    it('happyPath_theImageryFlowsOfTheM3Contract', () => {
        expect([
            contentFlowBudget('importScene'),
            contentFlowBudget('approveVersion'),
            contentFlowBudget('uploadGeotiff'),
            contentFlowBudget('chooseStudio'),
            contentFlowBudget('georeferencePair'),
        ]).toEqual([1, 1, 3, 3, 2]);
        expect(contentFlowBudget('cropLayer', 4)).toBe(6);
    });

    it('happyPath_theCityAndExportFlowsOfTheM5Contract', () => {
        expect([
            contentFlowBudget('newCity'),
            contentFlowBudget('newCityDrawn'),
            contentFlowBudget('switchCity'),
            contentFlowBudget('inviteToCity'),
            contentFlowBudget('setCityRole'),
            contentFlowBudget('exportCity'),
            contentFlowBudget('exportWithRasters'),
            contentFlowBudget('publishCity'),
        ]).toEqual([2, 3, 2, 3, 3, 2, 3, 2]);
        expect(contentFlowBudget('setCityLimits', 2)).toBe(3);
    });
});
