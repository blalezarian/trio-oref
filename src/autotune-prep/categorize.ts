import { getCurrentBasalRate } from '../profile/basal';
import getIOB from '../iob/index';
import { isfLookup as ISFLookup } from '../profile/isf';
import find_insulin from '../iob/extract-treatments';
import type { IobInputs } from '../iob/types';
import dosed from './dosed';
import type { DosedOpts } from './dosed';
import type { PumpHistoryEvent, CarbTreatment, InsulinCurve, MealAbsorptionPhase } from '../types/index';
import {
    MIN_VALID_GLUCOSE_MGDL,
    MS_PER_MINUTE,
    MS_PER_HOUR,
    MINUTES_PER_HOUR,
    MIN_BG_TARGET,
    PRED_INTERVAL_MINUTES,
    AUTOSENS_MIN_VALID_BG,
    BUCKETING_MERGE_THRESHOLD_MIN,
} from '../shared/constants';

/** Rounding scale for 3 decimal places */
const ROUND_SCALE_3DP = 1000;
/** Rounding scale for 2 decimal places */
const ROUND_SCALE_2DP = 100;
/** Minimum CSF data points to consider 1h of carb absorption confirmed */
const MIN_CSF_FOR_CONFIRMED_MEALS = 12;
/** Number of lookback glucose entries used to compute avgDelta */
const AVG_DELTA_LOOKBACK = 4;
/** Deviation threshold above which UAM absorption is flagged */
const UAM_DEVIATION_THRESHOLD = 6;
/** IOB-to-basal ratio threshold for UAM detection */
const UAM_IOB_RATIO = 2;
/** BGI ratio used to determine basal-dominant vs ISF-dominant periods */
const BASAL_BGI_RATIO = 4;
/** Multiplier applied to bgImpact for avgDelta comparison in ISF vs basal assignment */
const AVG_DELTA_BGI_MULTIPLIER = 2;
/** Number of lookback hours for pump basal averaging */
const BASAL_LOOKBACK_HOURS = 4;
/** Number of bucketed entries skipped from end as padding */
const BUCKETING_END_PADDING = 5;
/** Minimum IOB lookback window (hours) for trimming pump history */
const IOB_LOOKBACK_HOURS = 6;
/** Minimum ISF data points threshold for redistribution */
const MIN_ISF_DATA_POINTS = 10;
/** Minimum CR elapsed time (minutes) to consider valid */
const MIN_CR_ELAPSED_MINUTES = 60;

interface CategorizeGlucoseEntry {
  glucose?: number;
  sgv?: number;
  date?: number;
  displayTime?: string;
  dateString?: string;
  // Fields added during processing in the main loop:
  avgDelta?: string;
  BGI?: number;
  deviation?: string;
  mealAbsorption?: MealAbsorptionPhase;
  mealCarbs?: number;
  uamAbsorption?: 'start';
}

interface CategorizeBasalProfileEntry {
  i: number;
  start: string;
  rate: number;
  minutes: number;
}

interface CategorizeISFProfile {
  sensitivities: Array<{
    offset: number;
    sensitivity: number;
    endOffset: number;
  }>;
}

interface CategorizeProfile {
  dia: number;
  curve?: InsulinCurve;
  useCustomPeakTime?: boolean;
  insulinPeakTime?: number;
  current_basal?: number;
  basalprofile: CategorizeBasalProfileEntry[];
  min_5m_carbimpact: number;
  carb_ratio: number;
  sens?: number;
  isfProfile: CategorizeISFProfile;
  currentBasal?: number;
  [key: string]: unknown;
}

interface CategorizeOpts {
  treatments: CarbTreatment[];
  profile: CategorizeProfile;
  pumpHistory: PumpHistoryEvent[];
  glucose: CategorizeGlucoseEntry[];
  basalprofile: CategorizeBasalProfileEntry[];
  pumpbasalprofile: CategorizeBasalProfileEntry[];
  categorize_uam_as_basal?: boolean;
}

interface CategorizeGlucoseDatum {
  glucose: number;
  date: number;
  dateString: string;
  avgDelta: string;
  BGI: number;
  deviation: string;
  mealAbsorption?: MealAbsorptionPhase;
  mealCarbs?: number;
  uamAbsorption?: 'start';
}

interface CRDatum {
  CRInitialIOB: number;
  CRInitialBG: number;
  CRInitialCarbTime: Date;
  CREndIOB: number;
  CREndBG: number;
  CREndTime: Date;
  CRCarbs: number;
  CRInsulin?: number;
}

interface CategorizeResult {
  CRData: CRDatum[];
  CSFGlucoseData: CategorizeGlucoseDatum[];
  ISFGlucoseData: CategorizeGlucoseDatum[];
  basalGlucoseData: CategorizeGlucoseDatum[];
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Categorize bucketed glucose data into ISF, CSF, basal, and UAM categories for autotune */
function categorizeBGDatums(opts: CategorizeOpts): CategorizeResult {
    const treatments = opts.treatments;
    // this sorts the treatments collection in order.
    treatments.sort((a: CarbTreatment, b: CarbTreatment) => {
        const aDate = new Date(a.timestamp);
        const bDate = new Date(b.timestamp);
        return bDate.getTime() - aDate.getTime();
    });
    const profileData = opts.profile;

    let glucoseData: CategorizeGlucoseEntry[] = [ ];
    if (opts.glucose !== undefined) {
        glucoseData = opts.glucose.map((glucoseEntry: CategorizeGlucoseEntry) => {
            //Support the NS sgv field to avoid having to convert in a custom way
            glucoseEntry.glucose = glucoseEntry.glucose || glucoseEntry.sgv;

            if (!glucoseEntry.date) {
                if (glucoseEntry.displayTime) {
                    // Attempt to get date from displayTime
                    glucoseEntry.date = new Date(glucoseEntry.displayTime.replace('T', ' ')).getTime();
                } else if (glucoseEntry.dateString) {
                    // Attempt to get date from dateString
                    glucoseEntry.date = new Date(glucoseEntry.dateString).getTime();
                }
            }

            if (!glucoseEntry.dateString)
            {
                glucoseEntry.dateString = new Date(glucoseEntry.date as number).toISOString();
            }
            return glucoseEntry;
        }).filter((glucoseEntry: CategorizeGlucoseEntry) => {
            // Only take records with a valid date record
            // and a glucose value, which is also above 39
            return (glucoseEntry.date && glucoseEntry.glucose && glucoseEntry.glucose >=MIN_VALID_GLUCOSE_MGDL);
        }).sort((a: CategorizeGlucoseEntry, b: CategorizeGlucoseEntry) => {
            // sort the collection in order
            return (b.date as number) - (a.date as number);
        });
    }
    if (!treatments) return {} as CategorizeResult;

    let IOBInputs = {
        clock: ''
    ,   history: opts.pumpHistory
    ,   profile: profileData
    };
    let CSFGlucoseData: CategorizeGlucoseDatum[] = [];
    let ISFGlucoseData: CategorizeGlucoseDatum[] = [];
    let basalGlucoseData: CategorizeGlucoseDatum[] = [];
    const UAMGlucoseData: CategorizeGlucoseDatum[] = [];
    const CRData: CRDatum[] = [];

    const bucketedData: CategorizeGlucoseEntry[] = [];
    bucketedData[0] = JSON.parse(JSON.stringify(glucoseData[0]));
    let bucketIdx=0;
    let bucketStartIdx=0; // index of first value used by bucket
    let i: number;
    // variables used across multiple for-loops (were function-scoped with var)
    let BGTime: number;
    let treatment: CarbTreatment;
    let treatmentDate: Date;
    let treatmentTime: number;
    let glucoseDatum: CategorizeGlucoseEntry;
    let BGDate: Date;
    //for loop to validate and bucket the data
    for (i=1; i < glucoseData.length; ++i) {
        BGTime = glucoseData[i].date as number;
        const lastBGTime = glucoseData[bucketStartIdx].date as number;
        const elapsedMinutes = (BGTime - lastBGTime)/MS_PER_MINUTE;

        if(Math.abs(elapsedMinutes) >= BUCKETING_MERGE_THRESHOLD_MIN) {
            bucketIdx++; // move to next bucket
            bucketStartIdx=i; // store index of first value used by bucket
            bucketedData[bucketIdx]=JSON.parse(JSON.stringify(glucoseData[i]));
        } else {
            // average all readings within time deadband
            const glucoseTotal = glucoseData.slice(bucketStartIdx, i+1).reduce((total: number, glucoseEntry: CategorizeGlucoseEntry) => {
                return total + (glucoseEntry.glucose as number);
            }, 0);
            bucketedData[bucketIdx].glucose = glucoseTotal / (i-bucketStartIdx+1);
        }
    }
    // go through the treatments and remove any that are older than the oldest glucose value
    trimOldTreatments(treatments, bucketedData);
    let calculatingCR = false;
    let absorbing = 0;
    let uam = 0; // unannounced meal
    let mealCOB = 0;
    let mealCarbs = 0;
    let CRCarbs = 0;
    let type="";
    let CRInitialIOB: number | undefined;
    let CRInitialBG: number | undefined;
    let CRInitialCarbTime: Date | undefined;
    // main for loop
    const fullHistory = IOBInputs.history;
    for (i=bucketedData.length-BUCKETING_END_PADDING; i > 0; --i) {
        glucoseDatum = bucketedData[i];
        BGDate = new Date(glucoseDatum.date as number);
        BGTime = BGDate.getTime();
        // As we're processing each data point, go through the treatment.carbs and see if any of them are older than
        // the current BG data point.  If so, add those carbs to COB.
        treatment = treatments[treatments.length-1];
        let myCarbs = 0;
        if (treatment) {
            treatmentDate = new Date(treatment.timestamp);
            treatmentTime = treatmentDate.getTime();
            if ( treatmentTime < BGTime ) {
                const carbsValue = treatment.carbs ?? 0;
                if (carbsValue >= 1) {
                    mealCOB += carbsValue;
                    mealCarbs += carbsValue;
                    myCarbs = carbsValue;
                }
                treatments.pop();
            }
        }

        let BG: number | undefined;
        let delta: number | undefined;
        let avgDelta: number | undefined;
        // TODO: re-implement interpolation to avoid issues here with gaps
        // calculate avgDelta as last 4 datapoints to better catch more rises after COB hits zero
        if (bucketedData[i].glucose !== undefined && bucketedData[i+AVG_DELTA_LOOKBACK].glucose !== undefined) {
            BG = bucketedData[i].glucose as number;
            if ( BG < AUTOSENS_MIN_VALID_BG || (bucketedData[i+AVG_DELTA_LOOKBACK].glucose as number) < AUTOSENS_MIN_VALID_BG) {
                continue;
            }
            delta = (BG - (bucketedData[i+1].glucose as number));
            avgDelta = (BG - (bucketedData[i+AVG_DELTA_LOOKBACK].glucose as number))/AVG_DELTA_LOOKBACK;
        } else {
            console.log("Could not find glucose data");
        }

        avgDelta = parseFloat((avgDelta as number).toFixed(2));
        glucoseDatum.avgDelta = avgDelta.toFixed(2);

        const sens = ISFLookup(IOBInputs.profile.isfProfile,BGDate);
        IOBInputs.clock=BGDate.toISOString();
        // trim down IOBInputs.history to just the data for 6h prior to BGDate
        const newHistory: PumpHistoryEvent[] = [];
        for (let historyIdx=0; historyIdx<fullHistory.length; historyIdx++) {
            const historyDate: Date = new Date(fullHistory[historyIdx].created_at as string)
            if (BGDate.getTime()-historyDate.getTime() < IOB_LOOKBACK_HOURS*MS_PER_HOUR && BGDate.getTime()-historyDate.getTime() > 0) {
                newHistory.push(fullHistory[historyIdx]);
            }
        }
        IOBInputs.history = newHistory;

        // for IOB calculations, use the average of the last 4 hours' basals to help convergence;
        // this helps since the basal this hour could be different from previous, especially if with autotune they start to diverge.
        // use the pumpbasalprofile to properly calculate IOB during periods where no temp basal is set
        const currentPumpBasal = getCurrentBasalRate(opts.pumpbasalprofile, BGDate);
        const BGDate1hAgo = new Date(BGTime-1*MS_PER_HOUR);
        const BGDate2hAgo = new Date(BGTime-2*MS_PER_HOUR);
        const BGDate3hAgo = new Date(BGTime-3*MS_PER_HOUR);
        const basal1hAgo = getCurrentBasalRate(opts.pumpbasalprofile, BGDate1hAgo);
        const basal2hAgo = getCurrentBasalRate(opts.pumpbasalprofile, BGDate2hAgo);
        const basal3hAgo = getCurrentBasalRate(opts.pumpbasalprofile, BGDate3hAgo);
        const sum = [currentPumpBasal,basal1hAgo,basal2hAgo,basal3hAgo].reduce((acc, rate) => (acc as number) + (rate as number)) as number;
        IOBInputs.profile.currentBasal = Math.round((sum/BASAL_LOOKBACK_HOURS)*ROUND_SCALE_3DP)/ROUND_SCALE_3DP;

        // this is the current autotuned basal, used for everything else besides IOB calculations
        const currentBasal = getCurrentBasalRate(opts.basalprofile, BGDate) as number;

        // basalBGI is BGI of basal insulin activity.
        const basalBGI = Math.round(( currentBasal * sens / MINUTES_PER_HOUR * PRED_INTERVAL_MINUTES )*ROUND_SCALE_2DP)/ROUND_SCALE_2DP; // U/hr * mg/dL/U * 1 hr / 60 minutes * 5 = mg/dL/5m
        // call iob since calculated elsewhere
        const iob = getIOB(IOBInputs as IobInputs)[0];

        // activity times ISF times 5 minutes is BGI
        const bgImpact = Math.round(( -iob.activity * sens * PRED_INTERVAL_MINUTES )*ROUND_SCALE_2DP)/ROUND_SCALE_2DP;
        // datum = one glucose data point (being prepped to store in output)
        glucoseDatum.BGI = bgImpact;
        // calculating deviation
        let deviation = avgDelta-bgImpact;
        let dev5m = (delta as number)-bgImpact;

        // set positive deviations to zero if BG is below 80
        if ( (BG as number) < MIN_BG_TARGET && deviation > 0 ) {
            deviation = 0;
        }

        // rounding and storing deviation
        deviation = parseFloat(deviation.toFixed(2));
        const dev5mStr = dev5m.toFixed(2);
        glucoseDatum.deviation = deviation.toFixed(2);


        // Then, calculate carb absorption for that 5m interval using the deviation.
        if ( mealCOB > 0 ) {
            const profile = profileData;
            const carbImpact = Math.max(deviation, profile.min_5m_carbimpact);
            const absorbed = carbImpact * profile.carb_ratio / sens;
            // Store the COB, and use it as the starting point for the next data point.
            mealCOB = Math.max(0, mealCOB-absorbed);
        }


        // Calculate carb ratio (CR) independently of CSF and ISF
        // Use the time period from meal bolus/carbs until COB is zero and IOB is < currentBasal/2
        // For now, if another meal IOB/COB stacks on top of it, consider them together
        // Compare beginning and ending BGs, and calculate how much more/less insulin is needed to neutralize
        // Use entered carbs vs. starting IOB + delivered insulin + needed-at-end insulin to directly calculate CR.

        if (mealCOB > 0 || calculatingCR ) {
            // set initial values when we first see COB
            CRCarbs += myCarbs;
            if (!calculatingCR) {
                CRInitialIOB = iob.iob;
                CRInitialBG = glucoseDatum.glucose as number;
                CRInitialCarbTime = new Date(glucoseDatum.date as number);
                console.log(`CRInitialIOB: ${CRInitialIOB} CRInitialBG: ${CRInitialBG} CRInitialCarbTime: ${CRInitialCarbTime}`);
            }
            // keep calculatingCR as long as we have COB or enough IOB
            if ( mealCOB > 0 && i>1 ) {
                calculatingCR = true;
            } else if ( iob.iob > currentBasal/2 && i>1 ) {
                calculatingCR = true;
            // when COB=0 and IOB drops low enough, record end values and be done calculatingCR
            } else {
                const CREndIOB = iob.iob;
                const CREndBG = glucoseDatum.glucose as number;
                const CREndTime: Date = new Date(glucoseDatum.date as number);
                console.log(`CREndIOB: ${CREndIOB} CREndBG: ${CREndBG} CREndTime: ${CREndTime}`);
                const crDatum: CRDatum = {
                    CRInitialIOB: CRInitialIOB as number
                ,   CRInitialBG: CRInitialBG as number
                ,   CRInitialCarbTime: CRInitialCarbTime as Date
                ,   CREndIOB: CREndIOB
                ,   CREndBG: CREndBG
                ,   CREndTime: CREndTime
                ,   CRCarbs: CRCarbs
                };

                const CRElapsedMinutes = Math.round((CREndTime.getTime() - (CRInitialCarbTime as Date).getTime()) / MS_PER_MINUTE);
                if ( CRElapsedMinutes < MIN_CR_ELAPSED_MINUTES || ( i===1 && mealCOB > 0 ) ) {
                    console.log(`Ignoring ${CRElapsedMinutes}m CR period.`);
                } else {
                    CRData.push(crDatum);
                }

                CRCarbs = 0;
                calculatingCR = false;
            }
        }


        // If mealCOB is zero but all deviations since hitting COB=0 are positive, assign those data points to CSFGlucoseData
        // Once deviations go negative for at least one data point after COB=0, we can use the rest of the data to tune ISF or basals
        if (mealCOB > 0 || absorbing || mealCarbs > 0) {
            // if meal IOB has decayed, then end absorption after this data point unless COB > 0
            if ( iob.iob < currentBasal/2 ) {
                absorbing = 0;
            // otherwise, as long as deviations are positive, keep tracking carb deviations
            } else if (deviation > 0) {
                absorbing = 1;
            } else {
                absorbing = 0;
            }
            if ( ! absorbing && ! mealCOB ) {
                mealCarbs = 0;
            }
            // check previous "type" value, and if it wasn't csf, set a mealAbsorption start flag
            if ( type !== "csf" ) {
                glucoseDatum.mealAbsorption = "start";
                console.log(`${glucoseDatum.mealAbsorption} carb absorption`);
            }
            type="csf";
            glucoseDatum.mealCarbs = mealCarbs;
            CSFGlucoseData.push(glucoseDatum as unknown as CategorizeGlucoseDatum);
        } else {
          // check previous "type" value, and if it was csf, set a mealAbsorption end flag
          if ( type === "csf" ) {
            CSFGlucoseData[CSFGlucoseData.length-1].mealAbsorption = "end";
            console.log(`${CSFGlucoseData[CSFGlucoseData.length-1].mealAbsorption} carb absorption`);
          }

          if ((iob.iob > UAM_IOB_RATIO * currentBasal || deviation > UAM_DEVIATION_THRESHOLD || uam) ) {
            if (deviation > 0) {
                uam = 1;
            } else {
                uam = 0;
            }
            if ( type !== "uam" ) {
                glucoseDatum.uamAbsorption = "start";
                console.log(`${glucoseDatum.uamAbsorption} uannnounced meal absorption`);
            }
            type="uam";
            UAMGlucoseData.push(glucoseDatum as unknown as CategorizeGlucoseDatum);
          } else {
            if ( type === "uam" ) {
                console.log("end unannounced meal absorption");
            }


            // Go through the remaining time periods and divide them into periods where scheduled basal insulin activity dominates. This would be determined by calculating the BG impact of scheduled basal insulin (for example 1U/hr * 48 mg/dL/U ISF = 48 mg/dL/hr = 5 mg/dL/5m), and comparing that to BGI from bolus and net basal insulin activity.
            // When BGI is positive (insulin activity is negative), we want to use that data to tune basals
            // When BGI is smaller than about 1/4 of basalBGI, we want to use that data to tune basals
            // When BGI is negative and more than about 1/4 of basalBGI, we can use that data to tune ISF,
            // unless avgDelta is positive: then that's some sort of unexplained rise we don't want to use for ISF, so that means basals
            if (basalBGI > -BASAL_BGI_RATIO * bgImpact) {
                type="basal";
                basalGlucoseData.push(glucoseDatum as unknown as CategorizeGlucoseDatum);
            } else {
                if ( avgDelta > 0 && avgDelta > -AVG_DELTA_BGI_MULTIPLIER*bgImpact ) {
                    type="basal"
                    basalGlucoseData.push(glucoseDatum as unknown as CategorizeGlucoseDatum);
                } else {
                    type="ISF";
                    ISFGlucoseData.push(glucoseDatum as unknown as CategorizeGlucoseDatum);
                }
            }
          }
        }
        // debug line to print out all the things
        const BGTimeStr = BGDate.toString().split(" ")[4];
        console.log(`${absorbing} mealCOB: ${mealCOB.toFixed(1)} mealCarbs: ${mealCarbs} BGI: ${bgImpact.toFixed(1)} IOB: ${iob.iob.toFixed(1)} at ${BGTimeStr} dev: ${dev5mStr} avgDev: ${deviation.toFixed(2)} avgDelta: ${avgDelta.toFixed(2)} ${type} ${BG} ${myCarbs}`);
    }

    IOBInputs = {
        clock: ''
    ,   history: opts.pumpHistory
    ,   profile: profileData
    };
    const dosedTreatments = find_insulin(IOBInputs as IobInputs);
    CRData.forEach((crEntry: CRDatum) => {
        const dosedOpts: DosedOpts = {
            treatments: dosedTreatments
            , profile: opts.profile as Record<string, unknown>
            , start: crEntry.CRInitialCarbTime
            , end: crEntry.CREndTime
        };
        const insulinDosed = dosed(dosedOpts);
        crEntry.CRInsulin = insulinDosed.insulin;
    });

    const merged = mergeUAMData(
        opts.categorize_uam_as_basal,
        CSFGlucoseData,
        ISFGlucoseData,
        basalGlucoseData,
        UAMGlucoseData,
    );

    return {
        CRData: CRData,
        CSFGlucoseData: merged.CSFGlucoseData,
        ISFGlucoseData: merged.ISFGlucoseData,
        basalGlucoseData: merged.basalGlucoseData
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove treatments older than the oldest bucketed glucose value. Mutates treatments array. */
function trimOldTreatments(
    treatments: CarbTreatment[],
    bucketedData: CategorizeGlucoseEntry[],
): void {
    for (let treatmentIdx = treatments.length - 1; treatmentIdx > 0; --treatmentIdx) {
        const treatment = treatments[treatmentIdx];
        if (treatment) {
            const treatmentTime = new Date(treatment.timestamp).getTime();
            const lastBucket = bucketedData[bucketedData.length - 1];
            if (lastBucket) {
                const bgTime = new Date(lastBucket.date as number).getTime();
                if (treatmentTime < bgTime) {
                    treatments.splice(treatmentIdx, 1);
                }
            }
        }
    }
}

/** Redistribute UAM data across basal/ISF categories based on count heuristics */
function mergeUAMData(
    categorize_uam_as_basal: boolean | undefined,
    CSFGlucoseData: CategorizeGlucoseDatum[],
    ISFGlucoseData: CategorizeGlucoseDatum[],
    basalGlucoseData: CategorizeGlucoseDatum[],
    UAMGlucoseData: CategorizeGlucoseDatum[],
): {
    CSFGlucoseData: CategorizeGlucoseDatum[];
    ISFGlucoseData: CategorizeGlucoseDatum[];
    basalGlucoseData: CategorizeGlucoseDatum[];
} {
    const CSFLength = CSFGlucoseData.length;
    let ISFLength = ISFGlucoseData.length;
    const UAMLength = UAMGlucoseData.length;
    let basalLength = basalGlucoseData.length;

    if (categorize_uam_as_basal) {
        console.log("--categorize-uam-as-basal=true set: categorizing all UAM data as basal.");
        basalGlucoseData = basalGlucoseData.concat(UAMGlucoseData);
    } else if (CSFLength > MIN_CSF_FOR_CONFIRMED_MEALS) {
        console.log("Found at least 1h of carb absorption: assuming all meals were announced, and categorizing UAM data as basal.");
        basalGlucoseData = basalGlucoseData.concat(UAMGlucoseData);
    } else {
        if (2*basalLength < UAMLength) {
            console.log("Warning: too many deviations categorized as UnAnnounced Meals");
            console.log(`Adding ${UAMLength} UAM deviations to ${basalLength} basal ones`);
            basalGlucoseData = basalGlucoseData.concat(UAMGlucoseData);
            // if too much data is excluded as UAM, add in the UAM deviations to basal, but then discard the highest 50%
            basalGlucoseData.sort((a, b) => parseFloat(a.deviation) - parseFloat(b.deviation));
            basalGlucoseData = basalGlucoseData.slice(0,basalGlucoseData.length/2);
            console.log(`and selecting the lowest 50%, leaving ${basalGlucoseData.length} basal+UAM ones`);
        }

        if (2*ISFLength < UAMLength && ISFLength < MIN_ISF_DATA_POINTS) {
            console.log(`Adding ${UAMLength} UAM deviations to ${ISFLength} ISF ones`);
            ISFGlucoseData = ISFGlucoseData.concat(UAMGlucoseData);
            // if too much data is excluded as UAM, add in the UAM deviations to ISF, but then discard the highest 50%
            ISFGlucoseData.sort((a, b) => parseFloat(a.deviation) - parseFloat(b.deviation));
            ISFGlucoseData = ISFGlucoseData.slice(0,ISFGlucoseData.length/2);
            console.log(`and selecting the lowest 50%, leaving ${ISFGlucoseData.length} ISF+UAM ones`);
        }
    }
    basalLength = basalGlucoseData.length;
    ISFLength = ISFGlucoseData.length;
    if ( BASAL_BGI_RATIO*basalLength + ISFLength < CSFLength && ISFLength < MIN_ISF_DATA_POINTS ) {
        console.log("Warning: too many deviations categorized as meals");
        console.log(`Adding ${CSFLength} CSF deviations to ${ISFLength} ISF ones`);
        ISFGlucoseData = ISFGlucoseData.concat(CSFGlucoseData);
        CSFGlucoseData = [];
    }

    return { CSFGlucoseData, ISFGlucoseData, basalGlucoseData };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default categorizeBGDatums;
export { categorizeBGDatums, trimOldTreatments, mergeUAMData };
export type { CategorizeOpts, CategorizeResult, CategorizeGlucoseDatum, CRDatum };
