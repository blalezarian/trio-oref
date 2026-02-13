
import type { PumpHistoryEvent } from '../types/index';
import type {
    TempEvent,
    TempBasalsAndBoluses,
} from './types';
import {
    MS_PER_MINUTE,
    MINUTES_PER_HOUR,
} from '../shared/constants';

export function extractTempBasalsAndBoluses(
    pumpHistory: PumpHistoryEvent[],
    now: Date,
    zeroTempDuration?: number,
): TempBasalsAndBoluses {
    const tempHistory: TempEvent[] = [];
    const tempBoluses: TempEvent[] = [];
    let lastRecordTime = now;

    for (let i=0; i < pumpHistory.length; i++) {
        let current: PumpHistoryEvent = pumpHistory[i];
        if (current.bolus && current.bolus._type === "Bolus") {
            const temp: TempEvent = current as unknown as TempEvent;
            current = (temp as unknown as PumpHistoryEvent).bolus as PumpHistoryEvent;
        }
        if (current.created_at) {
            current.timestamp = current.created_at;
        }
        const currentRecordTime = new Date(current.timestamp as string);
        // ignore duplicate or out-of-order records (due to 1h and 24h overlap, or timezone changes)
        if (currentRecordTime > lastRecordTime) {
            continue;
        } else {
            lastRecordTime = currentRecordTime;
        }
        if (current._type === "Bolus") {
            const started_at = new Date(current.timestamp as string);
            if (started_at > now) {
                process.stderr.write(` ${current.amount}U @ ${started_at}`);
            } else {
                tempBoluses.push({
                    date: started_at.getTime(),
                    timestamp: current.timestamp,
                    started_at,
                    insulin: current.amount,
                });
            }
        } else if (current.eventType === "Meal Bolus" || current.eventType === "Correction Bolus" || current.eventType === "Snack Bolus" || current.eventType === "Bolus Wizard") {
            // imports treatments entered through Nightscout Care Portal
            // "Bolus Wizard" refers to the Nightscout Bolus Wizard, not the Medtronic Bolus Wizard
            const started_at = new Date(current.created_at as string);
            tempBoluses.push({
                date: started_at.getTime(),
                timestamp: current.created_at,
                started_at,
                insulin: current.insulin,
            });
        } else if (current.enteredBy === "xdrip") {
            const started_at = new Date(current.timestamp as string);
            tempBoluses.push({
                date: started_at.getTime(),
                timestamp: current.timestamp,
                started_at,
                insulin: current.insulin,
            });
        } else if (current.enteredBy ==="HAPP_App" && current.insulin) {
            const started_at = new Date(current.created_at as string);
            tempBoluses.push({
                date: started_at.getTime(),
                timestamp: current.created_at,
                started_at,
                insulin: current.insulin,
            });
        } else if (current.eventType === "Temp Basal" && (current.enteredBy === "HAPP_App" || current.enteredBy === "openaps://AndroidAPS")) {
            const started_at = new Date(current.created_at as string);
            tempHistory.push({
                date: started_at.getTime(),
                rate: current.absolute,
                duration: current.duration,
                timestamp: current.created_at,
                started_at,
            });
        } else if (current.eventType === "Temp Basal") {
            let rate = current.rate;
            // Loop reports the amount of insulin actually delivered while the temp basal was running
            // use that to calculate the effective temp basal rate
            if (current.amount !== undefined) {
                rate = current.amount / (current.duration as number) * MINUTES_PER_HOUR;
            }
            const started_at = new Date(current.timestamp as string);
            tempHistory.push({
                date: started_at.getTime(),
                rate,
                duration: current.duration,
                timestamp: current.timestamp,
                started_at,
            });
        } else if (current._type === "TempBasal") {
            if (current.temp === 'percent') {
                continue;
            }
            const rate = current.rate;
            const timestamp = current.timestamp;
            let duration: number | undefined;
            if (i>0 && pumpHistory[i-1].timestamp === timestamp && pumpHistory[i-1]._type === "TempBasalDuration") {
                duration = pumpHistory[i-1]['duration (min)'] as number;
            } else {
                for (let iter=0; iter < pumpHistory.length; iter++) {
                    if (pumpHistory[iter].timestamp === timestamp && pumpHistory[iter]._type === "TempBasalDuration") {
                            duration = pumpHistory[iter]['duration (min)'] as number;
                            break;
                    }
                }

                if (duration === undefined) {
                    console.error(`No duration found for ${rate} U/hr basal ${timestamp}`, pumpHistory[i - 1], current, pumpHistory[i + 1]);
                }
            }
            const started_at = new Date(timestamp as string);
            tempHistory.push({
                date: started_at.getTime(),
                rate,
                timestamp: current.timestamp,
                started_at,
                duration,
            });
        }
        // Add a temp basal cancel event to ignore future temps and reduce predBG oscillation
        const cancelStarted = new Date(now.getTime() + MS_PER_MINUTE);
        tempHistory.push({
            date: cancelStarted.getTime(),
            rate: 0,
            // start the zero temp 1m in the future to avoid clock skew
            started_at: cancelStarted,
            duration: zeroTempDuration || 0,
        });
    }

    return { tempHistory, tempBoluses };
}
