import type { AutotuneCRDatum } from './types';
import { roundTo3dp } from '../utils/rounding';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TotalCRResult {
    totalCR: number;
    CRTotalCarbs: number;
    CRTotalInsulin: number;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Calculate aggregate carb ratio from meal data by summing carbs and insulin across valid entries */
export function calculateTotalCarbRatio(
    CRData: AutotuneCRDatum[],
    ISF: number,
): TotalCRResult {
    let CRTotalCarbs = 0;
    let CRTotalInsulin = 0;

    for (const CRDatum of CRData) {
        const CRBGChange = CRDatum.CREndBG - CRDatum.CRInitialBG;
        const CRInsulinReq = CRBGChange / ISF;
        CRDatum.CRInsulinTotal = CRDatum.CRInitialIOB + CRDatum.CRInsulin + CRInsulinReq;

        if (CRDatum.CRInsulinTotal > 0) {
            CRTotalCarbs += CRDatum.CRCarbs;
            CRTotalInsulin += CRDatum.CRInsulinTotal;
        }
    }

    CRTotalInsulin = roundTo3dp(CRTotalInsulin);
    const totalCR = roundTo3dp(CRTotalCarbs / CRTotalInsulin);
    console.log(`CRTotalCarbs: ${CRTotalCarbs} CRTotalInsulin: ${CRTotalInsulin} totalCR: ${totalCR}`);

    return { totalCR, CRTotalCarbs, CRTotalInsulin };
}
