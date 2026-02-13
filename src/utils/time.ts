import { EpochMillis } from '../types';
import { MS_PER_MINUTE } from '../shared/constants';

// ---------------------------------------------------------------------------
// Schedule offset conversion
// ---------------------------------------------------------------------------

/**
 * Convert a pump schedule offset (minutes since midnight) to an epoch
 * timestamp for today in the device's local timezone.
 *
 * Pump schedules (basal rates, BG targets, carb ratios) are defined in
 * local time — e.g. "0.8 U/hr from 08:00 to 12:00". This function turns
 * a schedule entry's `offset` field (480 = 08:00) into an absolute epoch
 * so it can be compared against `Date.now()` or `now.getTime()`.
 *
 * Relies on the device clock's timezone, which in the Trio iOS context
 * is always the user's phone — matching the pump's schedule timezone.
 */
export function scheduleOffsetToEpoch(minutesSinceMidnight: number): EpochMillis {
    const midnight = new Date();
    midnight.setHours(0);
    midnight.setMinutes(0);
    midnight.setSeconds(0);
    midnight.setMilliseconds(0);

    return midnight.getTime() + minutesSinceMidnight * MS_PER_MINUTE;
}

// ---------------------------------------------------------------------------
// Glucose timestamp resolution
// ---------------------------------------------------------------------------

/**
 * Parse the timestamp from a glucose entry's display_time or dateString field.
 *
 * display_time has T replaced with space to force local-time interpretation.
 * dateString is used as-is (typically contains timezone info).
 */
export function resolveGlucoseTime(
    entry: { display_time?: string; dateString?: string },
): Date | undefined {
    if (entry.display_time) {
        return new Date(entry.display_time.replace('T', ' '));
    }
    if (entry.dateString) {
        return new Date(entry.dateString);
    }
    return undefined;
}
