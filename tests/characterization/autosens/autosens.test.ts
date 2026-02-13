/**
 * Characterization tests for determine-basal/autosens.js (detectSensitivity)
 *
 * Tests the auto-sensitivity detection function that analyzes glucose data
 * to detect insulin sensitivity/resistance changes and compute adjustment
 * ratios. The function returns { ratio, newisf }.
 *
 * SAFETY: This is a characterization test suite. Snapshots capture the EXACT
 * current behavior. Do not update snapshots without understanding why they changed.
 */

import { describe, it, expect } from 'vitest';
import { detectSensitivity } from '../../../src/autosens/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const NOW = new Date(FIXED_TIME).getTime();

/**
 * Creates a glucose data array in newest-first order.
 * @param readings Array of {bg, minsAgo} objects
 */
function makeGlucoseData(readings: Array<{ bg: number; minsAgo: number }>) {
  return readings.map((r) => ({
    glucose: r.bg,
    dateString: new Date(NOW - r.minsAgo * 60_000).toISOString(),
    date: NOW - r.minsAgo * 60_000,
  }));
}

/**
 * Create a series of glucose readings at 5-min intervals (newest-first).
 * @param startBG BG at most recent time
 * @param count Number of readings
 * @param deltaPerReading BG change per 5-min interval (positive = rising from past to present)
 */
function makeUniformGlucoseData(
  startBG: number,
  count: number,
  deltaPerReading: number = 0,
) {
  const data = [];
  for (let i = 0; i < count; i++) {
    const bg = Math.round(startBG - deltaPerReading * i);
    data.push({
      glucose: bg,
      dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
      date: NOW - i * 5 * 60_000,
    });
  }
  return data;
}

const BASAL_PROFILE = [{ i: 0, start: '00:00:00', rate: 1, minutes: 0 }];

function makeInputs(
  glucoseData: any[],
  overrides: Record<string, unknown> = {},
) {
  const base = {
    glucose_data: glucoseData,
    iob_inputs: {
      profile: {
        dia: 5,
        curve: 'rapid-acting' as const,
        useCustomPeakTime: false,
        insulinPeakTime: 75,
        current_basal: 1,
        basalprofile: BASAL_PROFILE,
        min_5m_carbimpact: 8,
        carb_ratio: 10,
        sens: 40,
        isfProfile: { sensitivities: [{ offset: 0, sensitivity: 40 }] },
        max_daily_basal: 1,
        autosens_min: 0.7,
        autosens_max: 1.2,
        rewind_resets_autosens: true,
        high_temptarget_raises_sensitivity: false,
        exercise_mode: false,
        temptargetSet: false,
        maxMealAbsorptionTime: 6,
      },
      history: [] as any[],
      clock: FIXED_TIME,
    },
    basalprofile: BASAL_PROFILE,
    carbs: [],
    temptargets: [],
    retrospective: true,
    ...overrides,
  };

  // Allow nested profile overrides
  if (overrides.profileOverrides) {
    Object.assign(
      base.iob_inputs.profile,
      overrides.profileOverrides as Record<string, unknown>,
    );
    delete (base as any).profileOverrides;
  }

  // Allow overriding history
  if (overrides.history !== undefined) {
    base.iob_inputs.history = overrides.history as any[];
    delete (base as any).history;
  }

  return base;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('determine-basal/autosens (detectSensitivity) characterization tests', () => {
  // -----------------------------------------------------------------------
  // Core sensitivity detection
  // -----------------------------------------------------------------------
  describe('core sensitivity detection', () => {
    it('flat BG ~120 with no insulin and no meals returns ratio near 1.0', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('rising BG (positive deviations) indicates resistance', () => {
      // Rising: each older reading is lower, so deltaPerReading = -1
      // present=180, 5m ago=181, 10m ago=182, etc.
      const glucose = makeUniformGlucoseData(180, 40, -1);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('falling BG (negative deviations) indicates sensitivity', () => {
      // Falling: each older reading is higher, so deltaPerReading = 1
      // present=80, 5m ago=79, 10m ago=78, etc.
      const glucose = makeUniformGlucoseData(120, 40, 1);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Ratio clamping
  // -----------------------------------------------------------------------
  describe('ratio clamping', () => {
    it('very strong resistance is clamped to autosens_max (1.2)', () => {
      // Large positive deviations: BG rising steeply
      const glucose = makeUniformGlucoseData(250, 40, -5);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      expect(result.ratio).toBeLessThanOrEqual(1.2);
      expect(result).toMatchSnapshot();
    });

    it('very strong sensitivity is clamped to autosens_min (0.7)', () => {
      // Large negative deviations: BG falling steeply
      const glucose = makeUniformGlucoseData(200, 40, 5);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      expect(result.ratio).toBeGreaterThanOrEqual(0.7);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Site change / Rewind handling
  // -----------------------------------------------------------------------
  describe('site change / Rewind handling', () => {
    it('rewind_resets_autosens with Rewind event in history', () => {
      // Put a Rewind event 2 hours ago; only data after rewind should be used
      const rewindTime = new Date(NOW - 2 * 60 * 60_000).toISOString();
      const glucose = makeUniformGlucoseData(120, 40, 0);
      const inputs = makeInputs(glucose, {
        history: [
          // history[0] is skipped (loop starts at h=1), so put dummy first
          { _type: 'Bolus', timestamp: FIXED_TIME, amount: 0 },
          { _type: 'Rewind', timestamp: rewindTime },
        ],
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('rewind_resets_autosens without Rewind event falls through to 24h default', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      const inputs = makeInputs(glucose, {
        history: [
          { _type: 'Bolus', timestamp: FIXED_TIME, amount: 0 },
        ],
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Retrospective mode
  // -----------------------------------------------------------------------
  describe('retrospective mode', () => {
    it('retrospective: true uses glucose_data[0].date for 24h lookback', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      const inputs = makeInputs(glucose, { retrospective: true });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('retrospective: false uses current time for lookback', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      const inputs = makeInputs(glucose, { retrospective: false });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Glucose data edge cases
  // -----------------------------------------------------------------------
  describe('glucose data edge cases', () => {
    it('sgv field compat: entries with sgv instead of glucose', () => {
      const data = [];
      for (let i = 0; i < 40; i++) {
        data.push({
          sgv: 120,
          dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
          date: NOW - i * 5 * 60_000,
        });
      }
      const inputs = makeInputs(data);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('display_time field format instead of dateString', () => {
      const data = [];
      for (let i = 0; i < 40; i++) {
        const d = new Date(NOW - i * 5 * 60_000);
        // display_time uses space instead of T (the replace call in the code handles T too)
        const displayTime = d.toISOString().replace('T', ' ').replace('Z', '');
        data.push({
          glucose: 120,
          display_time: displayTime,
          date: NOW - i * 5 * 60_000,
        });
      }
      const inputs = makeInputs(data);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('BG < 39 entries are skipped', () => {
      // Mix some sub-39 readings into normal data
      const readings: Array<{ bg: number; minsAgo: number }> = [];
      for (let i = 0; i < 40; i++) {
        const bg = i % 7 === 0 ? 30 : 120; // every 7th reading is sub-39
        readings.push({ bg, minsAgo: i * 5 });
      }
      const glucose = makeGlucoseData(readings);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('BG < 80 zeros positive deviations', () => {
      // BG at 75, slightly rising (would normally produce positive deviations)
      const glucose = makeUniformGlucoseData(75, 40, -0.5);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      // With positive deviations zeroed, ratio should stay near or below 1.0
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Meal exclusion
  // -----------------------------------------------------------------------
  describe('meal exclusion', () => {
    it('carbs present: meal deviations are excluded from autosens', () => {
      // Rising BG with carbs entered 1h ago
      const glucose = makeUniformGlucoseData(180, 40, -1);
      const carbTime = new Date(NOW - 60 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        carbs: [{ carbs: 50, created_at: carbTime }],
      });
      // Override profileOverrides for meal handling
      (inputs.iob_inputs.profile as any).maxMealAbsorptionTime = 6;
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // UAM exclusion
  // -----------------------------------------------------------------------
  describe('UAM exclusion', () => {
    it('UAM detected in non-retrospective mode: deviations excluded', () => {
      // non-retrospective mode with rising BG; IOB would need to be > 2*currentBasal
      // But since we have no insulin history, IOB=0, so UAM won't trigger from IOB alone.
      // However, mealStartCounter < 9 also triggers UAM-like exclusion.
      // We provide a carb entry in the near past to trigger the meal path first,
      // then after COB=0, UAM should kick in for subsequent positive deviations.
      const glucose = makeUniformGlucoseData(200, 40, -2);
      const carbTime = new Date(NOW - 150 * 60_000).toISOString(); // 2.5h ago
      const inputs = makeInputs(glucose, {
        retrospective: false,
        carbs: [{ carbs: 10, created_at: carbTime }],
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Exercise mode / temp targets
  // -----------------------------------------------------------------------
  describe('exercise mode / temp targets', () => {
    it('exercise_mode with high temp target adds negative deviations', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      // Temp target started 2 hours ago, duration 3 hours, target 120
      const ttStart = new Date(NOW - 2 * 60 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        temptargets: [
          {
            created_at: ttStart,
            duration: 180, // 3 hours
            targetTop: 120,
            targetBottom: 120,
          },
        ],
        profileOverrides: {
          exercise_mode: true,
          high_temptarget_raises_sensitivity: true,
        },
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('temp target with duration 0 (cancelled) returns 0 from tempTargetRunning', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      // First a high temp target, then cancelled
      const ttStart = new Date(NOW - 2 * 60 * 60_000).toISOString();
      const ttCancel = new Date(NOW - 1 * 60 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        temptargets: [
          {
            created_at: ttStart,
            duration: 180,
            targetTop: 120,
            targetBottom: 120,
          },
          {
            created_at: ttCancel,
            duration: 0,
            targetTop: 120,
            targetBottom: 120,
          },
        ],
        profileOverrides: {
          exercise_mode: true,
          high_temptarget_raises_sensitivity: true,
        },
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Lookback and padding
  // -----------------------------------------------------------------------
  describe('lookback and padding', () => {
    it('custom deviations lookback of 48 (4h)', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      const inputs = makeInputs(glucose, { deviations: 48 });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('few data points get zero-padded', () => {
      // Only 10 data points -- far less than 96
      const glucose = makeUniformGlucoseData(120, 10, 0);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // xDrip_started_at handling
  // -----------------------------------------------------------------------
  describe('xDrip_started_at handling', () => {
    it('entries with xDrip_started_at are skipped', () => {
      // Mix normal entries with xDrip entries
      const data: any[] = [];
      for (let i = 0; i < 40; i++) {
        const entry: any = {
          glucose: 120,
          date: NOW - i * 5 * 60_000,
        };
        if (i % 5 === 2) {
          // Every 5th entry (starting at index 2) is xDrip-only
          entry.xDrip_started_at = new Date(
            NOW - i * 5 * 60_000,
          ).toISOString();
          // No dateString or display_time -> triggers xDrip_started_at continue
        } else {
          entry.dateString = new Date(NOW - i * 5 * 60_000).toISOString();
        }
        data.push(entry);
      }
      const inputs = makeInputs(data);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Glucose bucketing: close timestamps (<= 2 min) trigger averaging
  // -----------------------------------------------------------------------
  describe('glucose bucketing with close timestamps', () => {
    it('entries within 2 minutes are averaged into the same bucket', () => {
      // Build glucose data where some consecutive entries are < 2 min apart
      // after reversal (code reverses the array, so oldest first).
      // newest-first input: newest at index 0
      const data: any[] = [];
      for (let i = 0; i < 40; i++) {
        // Most entries at 5-min intervals, but every 4th entry is only 1 min after the previous
        const offset = i < 10 ? i * 5 : (10 * 5) + (i - 10) * 1; // first 10 at 5-min, rest at 1-min
        data.push({
          glucose: 120 + (i % 3), // slight variation to trigger averaging
          dateString: new Date(NOW - offset * 60_000).toISOString(),
          date: NOW - offset * 60_000,
        });
      }
      const inputs = makeInputs(data);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // "Could not determine BG time" and "Could not determine last BG time"
  // -----------------------------------------------------------------------
  describe('BG time error paths', () => {
    it('entry without dateString, display_time, or xDrip_started_at logs error and continues', () => {
      // Insert an entry with no time field at all (triggers "Could not determine BG time")
      const data: any[] = [];
      for (let i = 0; i < 40; i++) {
        if (i === 5) {
          // This entry has no time fields at all
          data.push({
            glucose: 120,
            date: NOW - i * 5 * 60_000,
            // no dateString, no display_time, no xDrip_started_at
          });
        } else {
          data.push({
            glucose: 120,
            dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
            date: NOW - i * 5 * 60_000,
          });
        }
      }
      const inputs = makeInputs(data);
      // Should not throw; the error path logs and continues
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('previous entry without dateString, display_time triggers lastbgTime error path', () => {
      // Entry [i-1] has no dateString/display_time, and bucketed_data[0] also has no display_time
      // but entry[i-1] has xDrip_started_at -> triggers the xDrip_started_at continue for lastbgTime
      const data: any[] = [];
      for (let i = 0; i < 40; i++) {
        if (i === 6) {
          // This entry's predecessor (i=5 in newest-first = an older entry after reversal)
          // has xDrip_started_at only
          data.push({
            glucose: 120,
            date: NOW - i * 5 * 60_000,
            xDrip_started_at: new Date(NOW - i * 5 * 60_000).toISOString(),
          });
        } else {
          data.push({
            glucose: 120,
            dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
            date: NOW - i * 5 * 60_000,
          });
        }
      }
      const inputs = makeInputs(data);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('lastbgTime falls back to bucketed_data[0].display_time when previous entry has no dateString', () => {
      // First entry (index 0, newest) uses display_time format.
      // Entry at index 1 has no dateString or display_time => the code tries bucketed_data[0].display_time
      const data: any[] = [];
      for (let i = 0; i < 40; i++) {
        if (i === 0) {
          // Newest entry with display_time (this becomes bucketed_data[0] after processing)
          const d = new Date(NOW - i * 5 * 60_000);
          data.push({
            glucose: 120,
            display_time: d.toISOString().replace('T', ' ').replace('Z', ''),
            date: NOW - i * 5 * 60_000,
          });
        } else if (i === 1) {
          // Second newest: has no dateString, no display_time. But previous entry (index 0)
          // has display_time. After reversal, index 0 becomes the last element.
          // Actually, the code reverses the array so newest-first becomes oldest-first.
          // After reversal: glucose_data[0] = oldest, glucose_data[N-1] = newest.
          // bucketed_data[0] = glucose_data[0] = oldest entry.
          // For i=1 (second oldest after reversal), i-1=0 (oldest).
          // We need the oldest entry (last in our input array, index 39) to have display_time,
          // and the second oldest (index 38) to have no dateString.
          data.push({
            glucose: 120,
            dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
            date: NOW - i * 5 * 60_000,
          });
        } else {
          data.push({
            glucose: 120,
            dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
            date: NOW - i * 5 * 60_000,
          });
        }
      }
      // The code reverses the array. After reversal, glucose_data[0] is the oldest (index 39 in our array).
      // For the lastbgTime fallback to bucketed_data[0].display_time:
      // We need glucose_data[i-1] to have no dateString AND no display_time,
      // AND bucketed_data[0] to have display_time.
      // bucketed_data[0] = glucose_data[0] (after reversal) = data[39] (oldest).
      // So set data[39] (oldest) to have display_time, and data[38] to have neither dateString nor display_time.
      const oldest = data.length - 1;
      const secondOldest = data.length - 2;
      const d39 = new Date(NOW - oldest * 5 * 60_000);
      data[oldest] = {
        glucose: 120,
        display_time: d39.toISOString().replace('T', ' ').replace('Z', ''),
        date: NOW - oldest * 5 * 60_000,
      };
      // Second oldest has no dateString, no display_time, no xDrip_started_at
      // This will trigger "Could not determine last BG time" log on line 94
      data[secondOldest] = {
        glucose: 120,
        date: NOW - secondOldest * 5 * 60_000,
        // no dateString, no display_time, no xDrip_started_at
      };
      // But we also need glucose_data[i] (the entry being processed) to have a valid time.
      // glucose_data[1] after reversal = data[38]. We need glucose_data[1] to have bgTime.
      // Wait -- data[38] IS glucose_data[1] after reversal. It has no dateString.
      // So bgTime would also fail. Let's give data[38] a dateString for bgTime, but NOT for lastbgTime.
      // Actually the issue is: glucose_data[i] = data[38] needs dateString for its own bgTime,
      // AND glucose_data[i-1] = data[39] needs to NOT have dateString.
      // data[39] has display_time but not dateString. In the lastbgTime code:
      //   if (glucose_data[i-1].display_time) -> YES, lastbgTime from display_time
      // That doesn't hit the fallback. We need data[39] to have NO display_time AND no dateString.
      // Let's restructure: make data[39] have only a valid dateString (so it's bucketed), but
      // make bucketed_data[0] have display_time.
      // Actually bucketed_data[0] = glucose_data[0] = data[39]. So if data[39] has display_time,
      // bucketed_data[0] has display_time.
      // For glucose_data[1] (= data[38]):
      //   - bgTime: needs dateString or display_time -> give it dateString
      //   - lastbgTime: check glucose_data[0] (= data[39]):
      //     - display_time? If we give data[39] display_time, line 87 matches, not our target.
      //     - We need data[39] to NOT have display_time AND NOT have dateString
      //       -> then check bucketed_data[0].display_time
      //     - But bucketed_data[0] = glucose_data[0] = data[39] which also won't have display_time!
      // The only way to hit line 90 is if glucose_data[i-1] has neither display_time nor dateString,
      // but bucketed_data[0] (which could differ from glucose_data[i-1]) has display_time.
      // bucketed_data[0] starts as glucose_data[0], but as bucketing proceeds, if glucose_data[1]
      // is within 2 min of glucose_data[0], they merge and bucketed_data[0] keeps glucose_data[0]'s fields.
      // So bucketed_data[0] always is glucose_data[0].
      // For i=1: glucose_data[i-1] = glucose_data[0] = bucketed_data[0]. They're the same object!
      // So if glucose_data[0] has no display_time, bucketed_data[0] also won't.
      // For i>1: glucose_data[i-1] might differ from bucketed_data[0].
      // So we need i >= 2, glucose_data[i-1] with no display_time and no dateString,
      // glucose_data[0] (= bucketed_data[0]) WITH display_time.
      // After reversal: glucose_data[0] = data[39], glucose_data[2] = data[37], glucose_data[1] = data[38]
      // We need: data[39] has display_time (for bucketed_data[0]),
      //          data[38] has dateString (for glucose_data[1] own bgTime, and for glucose_data[2]'s lastbgTime if needed),
      //          data[37] has dateString (for its own bgTime),
      //          data[38] should NOT have display_time or dateString for when it's glucose_data[i-1]...
      // Wait, that's contradictory. data[38] can't both have and not have dateString.
      // Let me think differently: we need some glucose_data[i-1] that has no display_time and no dateString.
      // That means the entry just before i in the reversed array has no time fields.
      // If glucose_data[i-1] has no time, it would have been skipped or errored during its own processing.
      // But the lastbgTime check at line 86 uses the raw glucose_data[i-1], not bucketed data.
      // So even if glucose_data[i-1] was skipped during bucketing, it's still checked.
      // So: glucose_data[0] = data[39] -> has display_time
      //     glucose_data[1] = data[38] -> has NO dateString, no display_time (will be skipped by bgTime error)
      //     glucose_data[2] = data[37] -> has dateString (valid bgTime)
      //       lastbgTime check: glucose_data[1] = data[38] has no display_time, no dateString
      //       -> falls through to bucketed_data[0].display_time check (line 90)
      //       bucketed_data[0] = glucose_data[0] = data[39] which HAS display_time -> line 91 matches!
      // This is the path we want.
      // Reset and rebuild properly:
      const properData: any[] = [];
      for (let i = 0; i < 40; i++) {
        properData.push({
          glucose: 120,
          dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
          date: NOW - i * 5 * 60_000,
        });
      }
      // After reversal: glucose_data[0]=properData[39], glucose_data[1]=properData[38], glucose_data[2]=properData[37]
      // Set properData[39] (oldest, becomes glucose_data[0] / bucketed_data[0]) to have display_time
      const d0 = new Date(NOW - 39 * 5 * 60_000);
      properData[39] = {
        glucose: 120,
        display_time: d0.toISOString().replace('T', ' ').replace('Z', ''),
        date: NOW - 39 * 5 * 60_000,
      };
      // Set properData[38] (becomes glucose_data[1]) to have NO dateString, NO display_time
      properData[38] = {
        glucose: 120,
        date: NOW - 38 * 5 * 60_000,
        // no dateString, no display_time -> triggers "Could not determine BG time" when it's processed as glucose_data[i]
        // But when it's glucose_data[i-1] for glucose_data[2], it triggers the lastbgTime fallback
      };
      const inputs2 = makeInputs(properData);
      const result2 = detectSensitivity(inputs2);
      expect(result2).toMatchSnapshot();
    });

    it('previous entry has no time fields and no xDrip_started_at triggers last BG time error', () => {
      // Need glucose_data[i-1] with no display_time, no dateString, no xDrip_started_at
      // AND bucketed_data[0] also has no display_time
      // This hits line 94: "Could not determine last BG time"
      const data: any[] = [];
      for (let i = 0; i < 40; i++) {
        data.push({
          glucose: 120,
          dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
          date: NOW - i * 5 * 60_000,
        });
      }
      // After reversal: glucose_data[0] = data[39], glucose_data[1] = data[38], glucose_data[2] = data[37]
      // glucose_data[0] / bucketed_data[0]: NO display_time (just dateString)
      // glucose_data[1] = data[38]: no dateString, no display_time, no xDrip_started_at
      // When processing glucose_data[2]: lastbgTime check for glucose_data[1]:
      //   - no display_time -> no
      //   - no dateString -> no
      //   - bucketed_data[0].display_time -> no (has dateString only)
      //   - glucose_data[1].xDrip_started_at -> no
      //   -> hits "Could not determine last BG time"
      data[38] = {
        glucose: 120,
        date: NOW - 38 * 5 * 60_000,
        // no time fields at all
      };
      const inputs = makeInputs(data);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Meal COB tracking and absorption during deviation loop
  // -----------------------------------------------------------------------
  describe('meal COB tracking and absorption', () => {
    it('multiple meals with COB absorption, including mealStartCounter > 60 path', () => {
      // Need enough data points with carbs far enough in the past that mealStartCounter > 60
      // and mealCOB decays to < 0.5. This requires ~60 data points after carb entry.
      // Use 100 data points (500 min = ~8h) with a small carb entry 7h ago
      const glucose = makeUniformGlucoseData(130, 100, 0);
      const carbTime = new Date(NOW - 7 * 60 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        carbs: [{ carbs: 20, created_at: carbTime }],
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('meal with negative deviation sets absorbing=0 and mealCarbs=0 when COB<0.5', () => {
      // Falling BG with a small carb entry in the past. Negative deviations will cause
      // absorbing=0 and eventually mealCarbs=0 when mealCOB drops below 0.5
      const glucose = makeUniformGlucoseData(150, 80, 0.5);
      const carbTime = new Date(NOW - 5 * 60 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        carbs: [{ carbs: 5, created_at: carbTime }],
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('treatment is removed when older than oldest bucketed glucose', () => {
      // Carb entry much older than glucose data range (>24h ago) triggers meal removal in line 120-137
      const glucose = makeUniformGlucoseData(120, 40, 0);
      const oldCarbTime = new Date(NOW - 25 * 60 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        carbs: [{ carbs: 30, created_at: oldCarbTime }],
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('absorbed is falsy (zero) when ci and deviation are both zero', () => {
      // When deviation is 0 and min_5m_carbimpact is 0, ci = max(0, 0) = 0
      // absorbed = 0 * carb_ratio / sens = 0, which is falsy -> hits console log
      const glucose = makeUniformGlucoseData(120, 40, 0);
      const carbTime = new Date(NOW - 60 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        carbs: [{ carbs: 30, created_at: carbTime }],
        profileOverrides: {
          min_5m_carbimpact: 0,
        },
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // UAM detection paths (iob > 2*currentBasal, uam state transitions)
  // -----------------------------------------------------------------------
  describe('UAM detection and state transitions', () => {
    it('high IOB in non-retrospective mode triggers UAM exclusion with state transitions', () => {
      // Non-retrospective mode with bolus history that creates high IOB (> 2*currentBasal)
      // followed by BG rising then falling to trigger uam=1 then uam=0
      const glucose: any[] = [];
      for (let i = 0; i < 60; i++) {
        // First half: rising BG, second half: falling BG
        let bg: number;
        if (i < 30) {
          bg = 150 - i; // rising from past to present (newest=150)
        } else {
          bg = 150 - 30 + (i - 30); // falling before the rise
        }
        glucose.push({
          glucose: bg,
          dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
          date: NOW - i * 5 * 60_000,
        });
      }
      // Add a large bolus 30 min ago to create high IOB
      const bolusTime = new Date(NOW - 30 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        retrospective: false,
        history: [
          {
            _type: 'Bolus',
            timestamp: bolusTime,
            amount: 10,
            duration: 0,
            rate: 0,
          },
        ],
        profileOverrides: {
          current_basal: 0.5,
        },
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('UAM end transition (type uam -> non-meal) logs closing paren', () => {
      // Short carb entry followed by positive deviations (UAM triggered) then negative deviations
      // with no carbs, causing transition from uam type to non-meal
      const glucose: any[] = [];
      for (let i = 0; i < 60; i++) {
        // Create pattern: negative deviation zone after positive
        const bg = i < 20 ? 120 : 120 + (i - 20) * 0.5;
        glucose.push({
          glucose: Math.round(bg),
          dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
          date: NOW - i * 5 * 60_000,
        });
      }
      const carbTime = new Date(NOW - 200 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        retrospective: false,
        carbs: [{ carbs: 5, created_at: carbTime }],
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Deviation === 0 path in non-meal type
  // -----------------------------------------------------------------------
  describe('deviation zero path', () => {
    it('deviation exactly 0 in non-meal context writes = sign', () => {
      // Create data where bg - last_bg = bgi exactly, resulting in deviation = 0
      // With flat BG and no IOB, bgi = 0, delta = 0, deviation = 0
      // But bg >= 80 so positive deviations are NOT zeroed
      const glucose = makeUniformGlucoseData(100, 40, 0);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      // With perfectly flat BG and no IOB, all deviations should be 0
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Meals sorting with actual timestamps (covers lines 57-61)
  // -----------------------------------------------------------------------
  describe('meals sorting', () => {
    it('multiple carb entries are sorted by timestamp', () => {
      const glucose = makeUniformGlucoseData(150, 40, 0);
      const carb1Time = new Date(NOW - 120 * 60_000).toISOString();
      const carb2Time = new Date(NOW - 60 * 60_000).toISOString();
      const carb3Time = new Date(NOW - 90 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        carbs: [
          { carbs: 20, created_at: carb1Time },
          { carbs: 10, created_at: carb2Time },
          { carbs: 15, created_at: carb3Time },
        ],
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // isNaN / invalid BG in bucketed_data (lines 160-162)
  // -----------------------------------------------------------------------
  describe('invalid BG values in bucketed data', () => {
    it('NaN glucose in bucketed data is skipped with ! marker', () => {
      const data: any[] = [];
      for (let i = 0; i < 40; i++) {
        // Put NaN glucose at a point that will end up in bucketed_data positions
        // such that bg, last_bg, or old_bg is NaN. Index 10 after reversal = index 29.
        const bg = (i === 10 || i === 11) ? NaN : 120;
        data.push({
          glucose: bg,
          dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
          date: NOW - i * 5 * 60_000,
        });
      }
      const inputs = makeInputs(data);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('glucose value of 0 (falsy) is skipped', () => {
      const data: any[] = [];
      for (let i = 0; i < 40; i++) {
        const bg = (i === 15) ? 0 : 120;
        data.push({
          glucose: bg,
          dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
          date: NOW - i * 5 * 60_000,
        });
      }
      const inputs = makeInputs(data);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('glucose below 40 in bucketed data is skipped', () => {
      const data: any[] = [];
      for (let i = 0; i < 40; i++) {
        const bg = (i === 20) ? 35 : 120;
        data.push({
          glucose: bg,
          dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
          date: NOW - i * 5 * 60_000,
        });
      }
      const inputs = makeInputs(data);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // "Could not find glucose data" (undefined glucose in bucketed_data)
  // -----------------------------------------------------------------------
  describe('missing glucose field in bucketed data', () => {
    it('entry with undefined glucose after bucketing logs error and continues', () => {
      // Create entries where the glucose field is explicitly undefined
      const data: any[] = [];
      for (let i = 0; i < 40; i++) {
        const entry: any = {
          dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
          date: NOW - i * 5 * 60_000,
        };
        if (i === 15) {
          // Do not set glucose at all for this entry
          // After bucketing, this entry's glucose will be undefined
        } else {
          entry.glucose = 120;
        }
        data.push(entry);
      }
      const inputs = makeInputs(data);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // isNaN(delta) path (line 186-187)
  // -----------------------------------------------------------------------
  describe('bad delta path', () => {
    it('NaN delta from Infinity glucose values leaves deviation uninitialized', () => {
      // If bg = Infinity and last_bg = Infinity: Infinity - Infinity = NaN.
      // isNaN(Infinity) = false, !Infinity = false, Infinity < 40 = false -> passes the validity check.
      // delta = Infinity - Infinity = NaN -> hits the "Bad delta" log.
      // deviation is never set for that iteration; NaN propagates silently
      // through the rest of the loop. The function still returns a result.
      const data: any[] = [];
      for (let i = 0; i < 40; i++) {
        const bg = (i === 15 || i === 16) ? Infinity : 120;
        data.push({
          glucose: bg,
          dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
          date: NOW - i * 5 * 60_000,
        });
      }
      const inputs = makeInputs(data);
      const result = detectSensitivity(inputs);
      expect(result).toHaveProperty('ratio');
      expect(result).toHaveProperty('newisf');
    });
  });

  // -----------------------------------------------------------------------
  // tempTargetRunning: active temp target > 100, expired target, catch block
  // -----------------------------------------------------------------------
  describe('tempTargetRunning paths', () => {
    it('active high temp target (> 100) adds negative deviations', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      // Temp target at 160 (very high) started long ago, still active
      const ttStart = new Date(NOW - 4 * 60 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        temptargets: [
          {
            created_at: ttStart,
            duration: 600, // 10 hours
            targetTop: 160,
            targetBottom: 160,
          },
        ],
        profileOverrides: {
          exercise_mode: true,
          high_temptarget_raises_sensitivity: true,
        },
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('expired temp target does not affect deviations', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      // Temp target started 5h ago with 1h duration (expired 4h ago)
      const ttStart = new Date(NOW - 5 * 60 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        temptargets: [
          {
            created_at: ttStart,
            duration: 60, // 1 hour (expired 4h ago)
            targetTop: 160,
            targetBottom: 160,
          },
        ],
        profileOverrides: {
          exercise_mode: true,
          high_temptarget_raises_sensitivity: true,
        },
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('non-sortable temptargets_data triggers catch block gracefully', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      // Pass a non-array (null) as temptargets to trigger the catch block
      // Actually the catch block handles errors in .sort(), so we need something
      // that has a .sort() that throws. A string has no .sort().
      // Actually, the code does temptargets_data.sort(...) in a try block.
      // If temptargets_data is null, .sort() will throw.
      // But the for loop after uses temptargets_data.length, which will also throw.
      // Let's pass an object that makes sort throw but has length 0.
      const inputs = makeInputs(glucose, {
        temptargets: { sort: () => { throw new Error('not sortable'); }, length: 0 } as any,
        profileOverrides: {
          exercise_mode: true,
          high_temptarget_raises_sensitivity: true,
        },
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('temp target with duration 0 cancels earlier active target', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      // Active high temp target cancelled 30 min later
      const ttStart = new Date(NOW - 3 * 60 * 60_000).toISOString();
      const ttCancel = new Date(NOW - 2.5 * 60 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        temptargets: [
          {
            created_at: ttStart,
            duration: 600,
            targetTop: 150,
            targetBottom: 150,
          },
          {
            created_at: ttCancel,
            duration: 0,
            targetTop: 0,
            targetBottom: 0,
          },
        ],
        profileOverrides: {
          exercise_mode: true,
          high_temptarget_raises_sensitivity: true,
        },
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Deviations overflow: more than lookback deviations triggers shift
  // -----------------------------------------------------------------------
  describe('deviations overflow and shift', () => {
    it('more than lookback deviations triggers shift to keep only recent data', () => {
      // Use a small lookback with lots of data points
      const glucose = makeUniformGlucoseData(120, 100, 0);
      const inputs = makeInputs(glucose, { deviations: 10 });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // History entries without _type (line 34 branch)
  // -----------------------------------------------------------------------
  describe('history entries without _type', () => {
    it('history entry without _type property is skipped in rewind search', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      const rewindTime = new Date(NOW - 2 * 60 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        history: [
          { _type: 'Bolus', timestamp: FIXED_TIME, amount: 0 },
          { timestamp: FIXED_TIME }, // no _type at all
          { _type: 'TempBasal', timestamp: FIXED_TIME, rate: 0 },
          { _type: 'Rewind', timestamp: rewindTime },
        ],
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // CSF to non-meal transition (line 265-266)
  // -----------------------------------------------------------------------
  describe('CSF to non-meal transition', () => {
    it('transition from csf (meal absorption) to non-meal logs closing paren', () => {
      // Rising BG during meal absorption then flat BG after COB depleted
      const glucose: any[] = [];
      for (let i = 0; i < 80; i++) {
        // Falling BG (negative deviations) to quickly deplete COB
        const bg = 150 - i * 0.3;
        glucose.push({
          glucose: Math.round(bg * 10) / 10,
          dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
          date: NOW - i * 5 * 60_000,
        });
      }
      const carbTime = new Date(NOW - 300 * 60_000).toISOString(); // 5h ago
      const inputs = makeInputs(glucose, {
        carbs: [{ carbs: 10, created_at: carbTime }],
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Meal removal loop: bucketed_data[0] empty or without date (line 128)
  // -----------------------------------------------------------------------
  describe('meal removal with empty bucketed data', () => {
    it('bucketed_data[0] undefined triggers continue in meal removal loop', () => {
      // Create glucose data where all entries except the first are sub-39
      // After reversal and bucketing, bucketed_data ends up empty after shift().
      // But we also need at least 2 meals for the loop (i > 0).
      // After reversal: glucose_data[0] = oldest (gets set as bucketed_data[0]),
      // but if subsequent entries are all sub-39, they're skipped, so bucketed_data stays [glucose_data[0]].
      // Then shift() removes it, leaving bucketed_data = [].
      // bucketed_data[0] = undefined -> line 128 triggered.
      const data: any[] = [];
      // First entry (newest): valid BG
      data.push({
        glucose: 120,
        dateString: new Date(NOW).toISOString(),
        date: NOW,
      });
      // Rest: all sub-39 (will be skipped by line 95-97)
      for (let i = 1; i < 10; i++) {
        data.push({
          glucose: 30,
          dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
          date: NOW - i * 5 * 60_000,
        });
      }
      // Two carb entries to make meals.length >= 2 (loop runs for i > 0)
      const carbTime1 = new Date(NOW - 30 * 60_000).toISOString();
      const carbTime2 = new Date(NOW - 60 * 60_000).toISOString();
      const inputs = makeInputs(data, {
        carbs: [
          { carbs: 10, created_at: carbTime1 },
          { carbs: 10, created_at: carbTime2 },
        ],
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Meal removal: treatmentTime < BGTime (line 134)
  // -----------------------------------------------------------------------
  describe('meal removal when treatment is older than BG', () => {
    it('meals older than oldest bucketed glucose are spliced out', () => {
      // Create glucose data spanning 3 hours, and a meal entry from 4 hours ago.
      // After bucketing, the oldest BG is ~3h ago. The meal at 4h ago is older,
      // so treatmentTime < BGTime -> splice.
      // Need at least 2 meals for the loop to execute (loop: i = meals.length-1; i > 0).
      const glucose = makeUniformGlucoseData(120, 40, 0); // 40 * 5min = 200min = 3.3h
      const oldMealTime = new Date(NOW - 4 * 60 * 60_000).toISOString(); // 4h ago
      const recentMealTime = new Date(NOW - 30 * 60_000).toISOString(); // 30min ago
      const inputs = makeInputs(glucose, {
        carbs: [
          { carbs: 20, created_at: recentMealTime },
          { carbs: 15, created_at: oldMealTime },
        ],
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // mealStartCounter > 60 && mealCOB < 0.5 (line 242)
  // -----------------------------------------------------------------------
  describe('meal absorption with mealStartCounter > 60', () => {
    it('tiny carb entry with high min_5m_carbimpact depletes COB quickly while mealStartCounter starts at 999', () => {
      // mealStartCounter starts at 999 (line 144). With a 1-carb entry:
      // - mealCOB = 1 after adding carbs
      // - absorbed = max(deviation, 8) * 10 / 40 = 2 -> mealCOB = max(0, 1-2) = 0
      // - At line 235: mealCOB(0) > 0? No. absorbing(0)? No. mealCarbs(1) > 0? Yes.
      // - At line 242: mealStartCounter(999) > 60 && mealCOB(0) < 0.5 -> TRUE!
      const glucose = makeUniformGlucoseData(120, 40, 0);
      // Carb entry 2.5 hours ago (well within the data range)
      const carbTime = new Date(NOW - 150 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        carbs: [{ carbs: 1, created_at: carbTime }],
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // UAM via high IOB: !inputs.retrospective && iob.iob > 2 * currentBasal (line 274)
  // -----------------------------------------------------------------------
  describe('UAM via high IOB in non-retrospective mode', () => {
    it('iob > 2 * currentBasal in non-retrospective mode triggers UAM path', () => {
      // Need: retrospective = false, and enough insulin on board (> 2 * current_basal)
      // with positive deviations that don't come from meals.
      // Non-retrospective uses new Date() for lastSiteChange, so glucose data must be
      // within 24h of real current time.
      const REAL_NOW = Date.now();
      const glucose: any[] = [];
      for (let i = 0; i < 60; i++) {
        // Rising BG: newest=160, oldest=100
        glucose.push({
          glucose: 160 + i, // rising from past to present after reversal
          dateString: new Date(REAL_NOW - i * 5 * 60_000).toISOString(),
          date: REAL_NOW - i * 5 * 60_000,
        });
      }
      // Large bolus 30 min ago to create high IOB
      const bolusTime = new Date(REAL_NOW - 30 * 60_000).toISOString();
      const inputs = {
        glucose_data: glucose,
        iob_inputs: {
          profile: {
            dia: 5,
            curve: 'rapid-acting' as const,
            useCustomPeakTime: false,
            insulinPeakTime: 75,
            current_basal: 0.5,
            basalprofile: BASAL_PROFILE,
            min_5m_carbimpact: 8,
            carb_ratio: 10,
            sens: 40,
            isfProfile: { sensitivities: [{ offset: 0, sensitivity: 40 }] },
            max_daily_basal: 1,
            autosens_min: 0.7,
            autosens_max: 1.2,
            rewind_resets_autosens: false,
            high_temptarget_raises_sensitivity: false,
            exercise_mode: false,
            temptargetSet: false,
            maxMealAbsorptionTime: 6,
          },
          history: [
            {
              _type: 'Bolus',
              timestamp: bolusTime,
              amount: 15,
              duration: 0,
              rate: 0,
            },
          ],
          clock: new Date(REAL_NOW).toISOString(),
        },
        basalprofile: BASAL_PROFILE,
        carbs: [],
        temptargets: [],
        retrospective: false,
      };
      const result = detectSensitivity(inputs);
      // iob.iob should be > 2 * 0.5 = 1.0 from the 15U bolus
      expect(result).toHaveProperty('ratio');
      expect(result).toHaveProperty('newisf');
      expect(typeof result.ratio).toBe('number');
    });
  });

  // -----------------------------------------------------------------------
  // tempTargetRunning: duration === 0 with single cancel-only entry (line 440)
  // -----------------------------------------------------------------------
  describe('tempTargetRunning duration 0 cancel path', () => {
    it('single duration-0 cancel temp target that matches BG time range', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      // A single cancel-only temp target created well before all BG data points
      // so time >= created_at is true for all iterations.
      const ttCancel = new Date(NOW - 4 * 60 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        temptargets: [
          {
            created_at: ttCancel,
            duration: 0,
            targetTop: 0,
            targetBottom: 0,
          },
        ],
        profileOverrides: {
          exercise_mode: true,
          high_temptarget_raises_sensitivity: true,
        },
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });
});
