import {
    MGDL_TO_MMOL,
    MINUTES_PER_HOUR,
    PRED_INTERVAL_MINUTES,
} from '../shared/constants';

import { EXPECTED_DELTA_HOURS } from './constants';

import type { Profile } from '../types/index';

// Rounds value to 'digits' decimal places
export function round(value: number, digits?: number): number {
    if (! digits) { digits = 0; }
    const scale = Math.pow(10, digits);
    return Math.round(value * scale) / scale;
}

// we expect BG to rise or fall at the rate of BGI,
// adjusted by the rate at which BG would need to rise /
// fall to get eventualBG to target over 2 hours
export function calculate_expected_delta(
    target_bg: number,
    eventual_bg: number,
    bgi: number,
): number {
    // (hours * mins_per_hour) / 5 = how many 5 minute periods in 2h = 24
    const five_min_blocks = (EXPECTED_DELTA_HOURS * MINUTES_PER_HOUR) / PRED_INTERVAL_MINUTES;
    const target_delta = target_bg - eventual_bg;
    return /* expectedDelta */ round(bgi + (target_delta / five_min_blocks), 1);
}


export function convert_bg(value: number, profile: Profile): number {
    if (profile.out_units === "mmol/L") return round(value * MGDL_TO_MMOL,1);   
    
    return Math.round(value);
}
