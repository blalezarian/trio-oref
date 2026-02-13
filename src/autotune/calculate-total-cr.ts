
import type { AutotuneCRDatum } from './types';

export interface TotalCRResult {
    totalCR: number;
    CRTotalCarbs: number;
    CRTotalInsulin: number;
}

export function calculateTotalCR(
    CRData: AutotuneCRDatum[],
    ISF: number,
): TotalCRResult {
    let CRTotalCarbs = 0;
    let CRTotalInsulin = 0;

    CRData.forEach((CRDatum: AutotuneCRDatum) => {
        const CRBGChange = CRDatum.CREndBG - CRDatum.CRInitialBG;
        const CRInsulinReq = CRBGChange / ISF;
        CRDatum.CRInsulinTotal = CRDatum.CRInitialIOB + CRDatum.CRInsulin + CRInsulinReq;

        if (CRDatum.CRInsulinTotal > 0) {
            CRTotalCarbs += CRDatum.CRCarbs;
            CRTotalInsulin += CRDatum.CRInsulinTotal;
        }
    });

    CRTotalInsulin = Math.round(CRTotalInsulin * 1000) / 1000;
    const totalCR = Math.round(CRTotalCarbs / CRTotalInsulin * 1000) / 1000;
    console.error("CRTotalCarbs:", CRTotalCarbs, "CRTotalInsulin:", CRTotalInsulin, "totalCR:", totalCR);

    return { totalCR, CRTotalCarbs, CRTotalInsulin };
}
