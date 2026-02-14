import { describe, it, expect } from 'vitest';
import { tempTargetRunning } from '../../../src/autosens/tempTarget';
import { FIXED_DATE } from '../helpers/factories';

const NOW = FIXED_DATE;

function makeTarget(
    hoursAgo: number,
    duration: number,
    top: number = 120,
    bottom: number = 120,
) {
    return {
        created_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
        duration,
        targetTop: top,
        targetBottom: bottom,
    };
}

describe('tempTargetRunning', () => {
    // -----------------------------------------------------------------------
    // Null / undefined guard
    // -----------------------------------------------------------------------

    it('returns undefined when temptargets_data is undefined', () => {
        expect(tempTargetRunning(undefined, NOW)).toBeUndefined();
    });

    it('returns undefined when temptargets_data is empty', () => {
        expect(tempTargetRunning([], NOW)).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // Active temp target
    // -----------------------------------------------------------------------

    it('returns average of targetTop/targetBottom for active target', () => {
        const targets = [makeTarget(1, 180, 160, 140)]; // started 1h ago, 3h duration
        expect(tempTargetRunning(targets, NOW)).toBe(150); // (160 + 140) / 2
    });

    it('returns target value when top equals bottom', () => {
        const targets = [makeTarget(1, 180, 120, 120)];
        expect(tempTargetRunning(targets, NOW)).toBe(120);
    });

    // -----------------------------------------------------------------------
    // Expired target
    // -----------------------------------------------------------------------

    it('returns undefined for expired target', () => {
        const targets = [makeTarget(3, 60)]; // started 3h ago, 1h duration (expired 2h ago)
        expect(tempTargetRunning(targets, NOW)).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // Duration 0 (cancel)
    // -----------------------------------------------------------------------

    it('returns 0 for duration-0 cancel target', () => {
        const targets = [makeTarget(1, 0)]; // cancel started 1h ago
        expect(tempTargetRunning(targets, NOW)).toBe(0);
    });

    it('cancel target overrides earlier active target when listed first', () => {
        // The buggy sort comparator produces unstable ordering, so we test
        // with the cancel entry already first (the most common real-world ordering)
        const targets = [
            makeTarget(1, 0),             // cancel: started 1h ago
            makeTarget(2, 600, 160, 160), // active: started 2h ago, 10h duration
        ];
        expect(tempTargetRunning(targets, NOW)).toBe(0);
    });

    // -----------------------------------------------------------------------
    // Null-safe targetTop/targetBottom
    // -----------------------------------------------------------------------

    it('handles missing targetTop/targetBottom with ?? 0', () => {
        const target = {
            created_at: new Date(NOW.getTime() - 3_600_000).toISOString(),
            duration: 180,
        } as any; // no targetTop/targetBottom
        expect(tempTargetRunning([target], NOW)).toBe(0); // (0 + 0) / 2
    });

    // -----------------------------------------------------------------------
    // Malformed sort (catch block)
    // -----------------------------------------------------------------------

    it('handles non-sortable data gracefully via catch block', () => {
        const malformed = {
            sort: () => { throw new Error('not sortable'); },
            length: 0,
        } as any;
        // Should not throw — catch block handles the error, index loop works with length: 0
        expect(tempTargetRunning(malformed, NOW)).toBeUndefined();
    });
});
