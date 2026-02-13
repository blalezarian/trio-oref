/**
 * Shared glucose timestamp resolution used by COB bucketing and autosens.
 *
 * display_time has T replaced with space to force local-time interpretation.
 * dateString is used as-is (typically contains timezone info).
 */

/** Parse the timestamp from a glucose entry's display_time or dateString field */
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
