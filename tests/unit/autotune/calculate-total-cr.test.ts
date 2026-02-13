import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateTotalCR } from '../../../src/autotune/calculate-total-cr';
import type { AutotuneCRDatum } from '../../../src/autotune/types';

function makeCRDatum(overrides: Partial<AutotuneCRDatum> = {}): AutotuneCRDatum {
    return {
        CRInitialIOB: 0.5,
        CRInitialBG: 100,
        CRInitialCarbTime: new Date('2025-01-15T10:00:00.000Z'),
        CREndIOB: 0.1,
        CREndBG: 140,
        CREndTime: new Date('2025-01-15T13:00:00.000Z'),
        CRCarbs: 45,
        CRInsulin: 3.0,
        ...overrides,
    };
}

describe('calculateTotalCR', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('computes totalCR from a single CR datum', () => {
        // CRBGChange = 140-100 = 40, CRInsulinReq = 40/100 = 0.4
        // CRInsulinTotal = 0.5 + 3.0 + 0.4 = 3.9
        // totalCR = 45 / 3.9 = 11.538...
        const result = calculateTotalCR([makeCRDatum()], 100);
        expect(result.CRTotalCarbs).toBe(45);
        expect(result.CRTotalInsulin).toBe(3.9);
        expect(result.totalCR).toBe(11.538);
    });

    it('sums multiple CR data entries', () => {
        const data = [
            makeCRDatum({ CRCarbs: 30, CRInitialIOB: 0.5, CRInsulin: 2.0, CRInitialBG: 100, CREndBG: 130 }),
            makeCRDatum({ CRCarbs: 60, CRInitialIOB: 1.0, CRInsulin: 5.0, CRInitialBG: 110, CREndBG: 150 }),
        ];
        const result = calculateTotalCR(data, 100);
        // Datum 1: CRBGChange=30, CRInsulinReq=0.3, CRInsulinTotal=0.5+2.0+0.3=2.8
        // Datum 2: CRBGChange=40, CRInsulinReq=0.4, CRInsulinTotal=1.0+5.0+0.4=6.4
        // CRTotalCarbs=90, CRTotalInsulin=9.2, totalCR=90/9.2=9.783
        expect(result.CRTotalCarbs).toBe(90);
        expect(result.CRTotalInsulin).toBe(9.2);
        expect(result.totalCR).toBe(9.783);
    });

    it('skips entries where CRInsulinTotal <= 0', () => {
        const data = [
            makeCRDatum({ CRCarbs: 45, CRInitialIOB: -5, CRInsulin: 1.0, CRInitialBG: 100, CREndBG: 100 }),
            // CRInsulinTotal = -5 + 1.0 + 0 = -4 (skipped)
        ];
        const result = calculateTotalCR(data, 100);
        expect(result.CRTotalCarbs).toBe(0);
        expect(result.CRTotalInsulin).toBe(0);
    });

    it('mutates CRInsulinTotal on each datum', () => {
        const datum = makeCRDatum();
        calculateTotalCR([datum], 100);
        // CRInsulinTotal = 0.5 + 3.0 + (40/100) = 3.9
        expect(datum.CRInsulinTotal).toBe(3.9);
    });

    it('returns empty CRData gracefully', () => {
        const result = calculateTotalCR([], 100);
        expect(result.CRTotalCarbs).toBe(0);
        expect(result.CRTotalInsulin).toBe(0);
        expect(result.totalCR).toBeNaN(); // 0/0 = NaN
    });

    it('logs CRTotalCarbs, CRTotalInsulin, and totalCR', () => {
        calculateTotalCR([makeCRDatum()], 100);
        expect(console.error).toHaveBeenCalledWith(
            "CRTotalCarbs:", 45, "CRTotalInsulin:", 3.9, "totalCR:", 11.538,
        );
    });
});
