import type { AutotuneCRDatum } from './types';

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

    CRTotalInsulin = Math.round(CRTotalInsulin * 1000) / 1000;
    const totalCR = Math.round(CRTotalCarbs / CRTotalInsulin * 1000) / 1000;
    console.error(`CRTotalCarbs: ${CRTotalCarbs} CRTotalInsulin: ${CRTotalInsulin} totalCR: ${totalCR}`);

    return { totalCR, CRTotalCarbs, CRTotalInsulin };
}
