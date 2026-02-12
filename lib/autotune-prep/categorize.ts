import tz from 'moment-timezone';
import basal from '../profile/basal';
import getIOB from '../iob/index';
import ISF from '../profile/isf';
import find_insulin from '../iob/history';
import dosed from './dosed';
import type { PumpHistoryEvent, CarbTreatment, InsulinCurve } from '../types/index';
import {
    MIN_VALID_GLUCOSE_MGDL,
    MS_PER_MINUTE,
    MS_PER_HOUR,
    MINUTES_PER_HOUR,
    MIN_BG_TARGET,
    PRED_INTERVAL_MINUTES,
    AUTOSENS_MIN_VALID_BG,
    BUCKETING_MERGE_THRESHOLD_MIN,
} from '../constants';

/** Rounding scale for 3 decimal places */
const ROUND_SCALE_3DP = 1000;
/** Rounding scale for 2 decimal places */
const ROUND_SCALE_2DP = 100;

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
  mealAbsorption?: string;
  mealCarbs?: number;
  uamAbsorption?: string;
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

interface CategorizeIOBInputs {
  profile: CategorizeProfile;
  history: PumpHistoryEvent[];
  clock?: string;
}

interface CategorizeDosedTreatment {
  insulin?: number | null;
  date: number;
}

interface CategorizeDosedOpts {
  start: Date;
  end: Date;
  treatments: CategorizeDosedTreatment[] | undefined;
  profile: Record<string, unknown>;
}

interface CategorizeGlucoseDatum {
  glucose: number;
  date: number;
  dateString: string;
  avgDelta: string;
  BGI: number;
  deviation: string;
  mealAbsorption?: string;
  mealCarbs?: number;
  uamAbsorption?: string;
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

// main function categorizeBGDatums. ;) categorize to ISF, CSF, or basals.

function categorizeBGDatums(opts: CategorizeOpts): CategorizeResult {
    const treatments = opts.treatments;
    // this sorts the treatments collection in order.
    treatments.sort((a: CarbTreatment, b: CarbTreatment) => {
        const aDate = new Date(tz(a.timestamp));
        const bDate = new Date(tz(b.timestamp));
        //console.error(aDate);
        return bDate.getTime() - aDate.getTime();
    });
    const profileData = opts.profile;

    let glucoseData: CategorizeGlucoseEntry[] = [ ];
    if (opts.glucose !== undefined) {
        //var glucoseData = opts.glucose;
        glucoseData = opts.glucose.map((obj: CategorizeGlucoseEntry) => {
            //Support the NS sgv field to avoid having to convert in a custom way
            obj.glucose = obj.glucose || obj.sgv;

            if (obj.date) {
                //obj.BGTime = new Date(obj.date);
            } else if (obj.displayTime) {
                // Attempt to get date from displayTime
                obj.date = new Date(obj.displayTime.replace('T', ' ')).getTime();
            } else if (obj.dateString) {
                // Attempt to get date from dateString
                obj.date = new Date(obj.dateString).getTime();
            }// else { console.error("Could not determine BG time"); }

            if (!obj.dateString)
            {
                obj.dateString = new Date(tz(obj.date)).toISOString();
            }
            return obj;
        }).filter((obj: CategorizeGlucoseEntry) => {
            // Only take records with a valid date record
            // and a glucose value, which is also above 39
            return (obj.date && obj.glucose && obj.glucose >=MIN_VALID_GLUCOSE_MGDL);
        }).sort((a: CategorizeGlucoseEntry, b: CategorizeGlucoseEntry) => {
            // sort the collection in order
            return b.date! - a.date!;
        });
    }
    // if (typeof(opts.preppedGlucose) !== 'undefined') {
        // var preppedGlucoseData = opts.preppedGlucose;
    // }
    //starting variable at 0
    const boluses = 0;
    const maxCarbs = 0;
    //console.error(treatments);
    if (!treatments) return {} as CategorizeResult;

    //console.error(glucoseData);
    let IOBInputs: CategorizeIOBInputs = {
        profile: profileData
    ,   history: opts.pumpHistory
    };
    let CSFGlucoseData: CategorizeGlucoseDatum[] = [];
    let ISFGlucoseData: CategorizeGlucoseDatum[] = [];
    let basalGlucoseData: CategorizeGlucoseDatum[] = [];
    const UAMGlucoseData: CategorizeGlucoseDatum[] = [];
    const CRData: CRDatum[] = [];

    const bucketedData: CategorizeGlucoseEntry[] = [];
    bucketedData[0] = JSON.parse(JSON.stringify(glucoseData[0]));
    let j=0;
    let k=0; // index of first value used by bucket
    let i: number;
    // variables used across multiple for-loops (were function-scoped with var)
    let BGTime: number | string;
    let treatment: CarbTreatment;
    let treatmentDate: Date;
    let treatmentTime: number;
    let glucoseDatum: CategorizeGlucoseEntry;
    let BGDate: Date;
    //for loop to validate and bucket the data
    for (i=1; i < glucoseData.length; ++i) {
        BGTime = glucoseData[i].date!;
        const lastBGTime = glucoseData[k].date!;
        const elapsedMinutes = ((BGTime as number) - lastBGTime)/MS_PER_MINUTE;

        if(Math.abs(elapsedMinutes) >= BUCKETING_MERGE_THRESHOLD_MIN) {
            j++; // move to next bucket
            k=i; // store index of first value used by bucket
            bucketedData[j]=JSON.parse(JSON.stringify(glucoseData[i]));
        } else {
            // average all readings within time deadband
            const glucoseTotal = glucoseData.slice(k, i+1).reduce((total: number, entry: CategorizeGlucoseEntry) => {
                return total + entry.glucose!;
            }, 0);
            bucketedData[j].glucose = glucoseTotal / (i-k+1);
        }
    }
    //console.error(bucketedData);
    //console.error(bucketedData[bucketedData.length-1]);
    // go through the treatments and remove any that are older than the oldest glucose value
    //console.error(treatments);
    for (i=treatments.length-1; i>0; --i) {
        treatment = treatments[i];
        //console.error(treatment);
        if (treatment) {
            treatmentDate = new Date(tz(treatment.timestamp));
            treatmentTime = treatmentDate.getTime();
            glucoseDatum = bucketedData[bucketedData.length-1];
            //console.error(glucoseDatum);
            if (glucoseDatum) {
                BGDate = new Date(glucoseDatum.date!);
                BGTime = BGDate.getTime();
                if ( treatmentTime < BGTime ) {
                    treatments.splice(i,1);
                }
            }
        }
    }
    //console.error(treatments);
    let calculatingCR = false;
    let absorbing = 0;
    let uam = 0; // unannounced meal
    let mealCOB = 0;
    let mealCarbs = 0;
    let CRCarbs = 0;
    let type="";
    let CRInitialIOB: number = undefined as unknown as number;
    let CRInitialBG: number = undefined as unknown as number;
    let CRInitialCarbTime: Date = undefined as unknown as Date;
    // main for loop
    const fullHistory = IOBInputs.history;
    for (i=bucketedData.length-5; i > 0; --i) {
        glucoseDatum = bucketedData[i];
        //console.error(glucoseDatum);
        BGDate = new Date(glucoseDatum.date!);
        BGTime = BGDate.getTime();
        // As we're processing each data point, go through the treatment.carbs and see if any of them are older than
        // the current BG data point.  If so, add those carbs to COB.
        treatment = treatments[treatments.length-1];
        let myCarbs = 0;
        if (treatment) {
            treatmentDate = new Date(tz(treatment.timestamp));
            treatmentTime = treatmentDate.getTime();
            //console.error(treatmentDate);
            if ( treatmentTime < BGTime ) {
                if (treatment.carbs! >= 1) {
                    mealCOB += parseFloat(treatment.carbs as unknown as string);
                    mealCarbs += parseFloat(treatment.carbs as unknown as string);
                    myCarbs = treatment.carbs!;
                }
                treatments.pop();
            }
        }

        let BG: number = undefined as unknown as number;
        let delta: number = undefined as unknown as number;
        let avgDelta: number | string = undefined as unknown as number;
        // TODO: re-implement interpolation to avoid issues here with gaps
        // calculate avgDelta as last 4 datapoints to better catch more rises after COB hits zero
        if (bucketedData[i].glucose !== undefined && bucketedData[i+4].glucose !== undefined) {
            //console.error(bucketedData[i]);
            BG = bucketedData[i].glucose!;
            if ( BG < AUTOSENS_MIN_VALID_BG || bucketedData[i+4].glucose! < AUTOSENS_MIN_VALID_BG) {
                //process.stderr.write("!");
                continue;
            }
            delta = (BG - bucketedData[i+1].glucose!);
            avgDelta = (BG - bucketedData[i+4].glucose!)/4;
        } else { console.error("Could not find glucose data"); }

        avgDelta = (avgDelta as unknown as number).toFixed(2);
        glucoseDatum.avgDelta = avgDelta;

        //sens = ISF
        const sens = ISF.isfLookup(IOBInputs.profile.isfProfile,BGDate);
        IOBInputs.clock=BGDate.toISOString();
        // trim down IOBInputs.history to just the data for 6h prior to BGDate
        //console.error(IOBInputs.history[0].created_at);
        const newHistory: PumpHistoryEvent[] = [];
        for (let h=0; h<fullHistory.length; h++) {
            const hDate: Date = new Date(fullHistory[h].created_at as string)
            //console.error(fullHistory[i].created_at, hDate, BGDate, BGDate-hDate);
            //if (h == 0 || h == fullHistory.length - 1) {
                //console.error(hDate, BGDate, hDate-BGDate)
            //}
            if (BGDate.getTime()-hDate.getTime() < 6*MS_PER_HOUR && BGDate.getTime()-hDate.getTime() > 0) {
                //process.stderr.write("i");
                //console.error(hDate);
                newHistory.push(fullHistory[h]);
            }
        }
        IOBInputs.history = newHistory;
        // process.stderr.write("" + newHistory.length + " ");
        //console.error(newHistory[0].created_at,newHistory[newHistory.length-1].created_at,newHistory.length);


        // for IOB calculations, use the average of the last 4 hours' basals to help convergence;
        // this helps since the basal this hour could be different from previous, especially if with autotune they start to diverge.
        // use the pumpbasalprofile to properly calculate IOB during periods where no temp basal is set
        const currentPumpBasal = basal.basalLookup(opts.pumpbasalprofile, BGDate);
        const BGDate1hAgo = new Date((BGTime as number)-1*MS_PER_HOUR);
        const BGDate2hAgo = new Date((BGTime as number)-2*MS_PER_HOUR);
        const BGDate3hAgo = new Date((BGTime as number)-3*MS_PER_HOUR);
        const basal1hAgo = basal.basalLookup(opts.pumpbasalprofile, BGDate1hAgo);
        const basal2hAgo = basal.basalLookup(opts.pumpbasalprofile, BGDate2hAgo);
        const basal3hAgo = basal.basalLookup(opts.pumpbasalprofile, BGDate3hAgo);
        const sum = [currentPumpBasal,basal1hAgo,basal2hAgo,basal3hAgo].reduce((a, b) => a! + b!)!;
        IOBInputs.profile.currentBasal = Math.round(((sum as number)/4)*ROUND_SCALE_3DP)/ROUND_SCALE_3DP;

        // this is the current autotuned basal, used for everything else besides IOB calculations
        const currentBasal: number = basal.basalLookup(opts.basalprofile, BGDate)!;

        //console.error(currentBasal,basal1hAgo,basal2hAgo,basal3hAgo,IOBInputs.profile.currentBasal);
        // basalBGI is BGI of basal insulin activity.
        const basalBGI = Math.round(( currentBasal * sens / MINUTES_PER_HOUR * PRED_INTERVAL_MINUTES )*ROUND_SCALE_2DP)/ROUND_SCALE_2DP; // U/hr * mg/dL/U * 1 hr / 60 minutes * 5 = mg/dL/5m
        //console.log(JSON.stringify(IOBInputs.profile));
        // call iob since calculated elsewhere
        const iob = getIOB(IOBInputs as unknown as Parameters<typeof getIOB>[0])[0];
        //console.error(JSON.stringify(iob));

        // activity times ISF times 5 minutes is BGI
        const bgImpact = Math.round(( -iob.activity * sens * PRED_INTERVAL_MINUTES )*ROUND_SCALE_2DP)/ROUND_SCALE_2DP;
        // datum = one glucose data point (being prepped to store in output)
        glucoseDatum.BGI = bgImpact;
        // calculating deviation
        let deviation: number | string = (avgDelta as unknown as number)-bgImpact;
        let dev5m: number | string = delta-bgImpact;
        //console.error(deviation,avgDelta,BG,bucketedData[i].glucose);

        // set positive deviations to zero if BG is below 80
        if ( BG < MIN_BG_TARGET && deviation > 0 ) {
            deviation = 0;
        }

        // rounding and storing deviation
        deviation = deviation.toFixed(2);
        dev5m = dev5m.toFixed(2);
        glucoseDatum.deviation = deviation;


        // Then, calculate carb absorption for that 5m interval using the deviation.
        if ( mealCOB > 0 ) {
            const profile = profileData;
            const carbImpact = Math.max(deviation as unknown as number, profile.min_5m_carbimpact);
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
                CRInitialBG = glucoseDatum.glucose!;
                CRInitialCarbTime = new Date(glucoseDatum.date!);
                console.error("CRInitialIOB:",CRInitialIOB,"CRInitialBG:",CRInitialBG,"CRInitialCarbTime:",CRInitialCarbTime);
            }
            // keep calculatingCR as long as we have COB or enough IOB
            if ( mealCOB > 0 && i>1 ) {
                calculatingCR = true;
            } else if ( iob.iob > currentBasal/2 && i>1 ) {
                calculatingCR = true;
            // when COB=0 and IOB drops low enough, record end values and be done calculatingCR
            } else {
                const CREndIOB = iob.iob;
                const CREndBG = glucoseDatum.glucose!;
                const CREndTime: Date = new Date(glucoseDatum.date!);
                console.error("CREndIOB:",CREndIOB,"CREndBG:",CREndBG,"CREndTime:",CREndTime);
                const crDatum: CRDatum = {
                    CRInitialIOB: CRInitialIOB
                ,   CRInitialBG: CRInitialBG
                ,   CRInitialCarbTime: CRInitialCarbTime
                ,   CREndIOB: CREndIOB
                ,   CREndBG: CREndBG
                ,   CREndTime: CREndTime
                ,   CRCarbs: CRCarbs
                };
                //console.error(crDatum);

                const CRElapsedMinutes = Math.round((CREndTime.getTime() - CRInitialCarbTime.getTime()) / MS_PER_MINUTE);
                //console.error(CREndTime - CRInitialCarbTime, CRElapsedMinutes);
                if ( CRElapsedMinutes < 60 || ( i===1 && mealCOB > 0 ) ) {
                    console.error("Ignoring",CRElapsedMinutes,"m CR period.");
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
            } else if ((deviation as unknown as number) > 0) {
                absorbing = 1;
            } else {
                absorbing = 0;
            }
            if ( ! absorbing && ! mealCOB ) {
                mealCarbs = 0;
            }
            // check previous "type" value, and if it wasn't csf, set a mealAbsorption start flag
            //console.error(type);
            if ( type !== "csf" ) {
                glucoseDatum.mealAbsorption = "start";
                console.error(glucoseDatum.mealAbsorption,"carb absorption");
            }
            type="csf";
            glucoseDatum.mealCarbs = mealCarbs;
            //if (i == 0) { glucoseDatum.mealAbsorption = "end"; }
            CSFGlucoseData.push(glucoseDatum as unknown as CategorizeGlucoseDatum);
        } else {
          // check previous "type" value, and if it was csf, set a mealAbsorption end flag
          if ( type === "csf" ) {
            CSFGlucoseData[CSFGlucoseData.length-1].mealAbsorption = "end";
            console.error(CSFGlucoseData[CSFGlucoseData.length-1].mealAbsorption,"carb absorption");
          }

          if ((iob.iob > 2 * currentBasal || (deviation as unknown as number) > 6 || uam) ) {
            if ((deviation as unknown as number) > 0) {
                uam = 1;
            } else {
                uam = 0;
            }
            if ( type !== "uam" ) {
                glucoseDatum.uamAbsorption = "start";
                console.error(glucoseDatum.uamAbsorption,"uannnounced meal absorption");
            }
            type="uam";
            UAMGlucoseData.push(glucoseDatum as unknown as CategorizeGlucoseDatum);
          } else {
            if ( type === "uam" ) {
                console.error("end unannounced meal absorption");
            }


            // Go through the remaining time periods and divide them into periods where scheduled basal insulin activity dominates. This would be determined by calculating the BG impact of scheduled basal insulin (for example 1U/hr * 48 mg/dL/U ISF = 48 mg/dL/hr = 5 mg/dL/5m), and comparing that to BGI from bolus and net basal insulin activity.
            // When BGI is positive (insulin activity is negative), we want to use that data to tune basals
            // When BGI is smaller than about 1/4 of basalBGI, we want to use that data to tune basals
            // When BGI is negative and more than about 1/4 of basalBGI, we can use that data to tune ISF,
            // unless avgDelta is positive: then that's some sort of unexplained rise we don't want to use for ISF, so that means basals
            if (basalBGI > -4 * bgImpact) {
                type="basal";
                basalGlucoseData.push(glucoseDatum as unknown as CategorizeGlucoseDatum);
            } else {
                if ( (avgDelta as unknown as number) > 0 && (avgDelta as unknown as number) > -2*bgImpact ) {
                    //type="unknown"
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
        const BGDateArray = BGDate.toString().split(" ");
        BGTime = BGDateArray[4];
        // console.error(absorbing.toString(),"mealCOB:",mealCOB.toFixed(1),"mealCarbs:",mealCarbs,"basalBGI:",basalBGI.toFixed(1),"BGI:",BGI.toFixed(1),"IOB:",iob.iob.toFixed(1),"at",BGTime,"dev:",deviation,"avgDelta:",avgDelta,type);
        console.error(absorbing.toString(),"mealCOB:",mealCOB.toFixed(1),"mealCarbs:",mealCarbs,"BGI:",bgImpact.toFixed(1),"IOB:",iob.iob.toFixed(1),"at",BGTime,"dev:",dev5m,"avgDev:",deviation,"avgDelta:",avgDelta,type,BG,myCarbs);
    }

    IOBInputs = {
        profile: profileData
    ,   history: opts.pumpHistory
    };
    const dosedTreatments = find_insulin(IOBInputs as unknown as Parameters<typeof find_insulin>[0]);
    CRData.forEach((crEntry: CRDatum) => {
        const dosedOpts: CategorizeDosedOpts = {
            treatments: dosedTreatments as unknown as CategorizeDosedTreatment[]
            , profile: opts.profile as unknown as Record<string, unknown>
            , start: crEntry.CRInitialCarbTime
            , end: crEntry.CREndTime
        };
        const insulinDosed = dosed(dosedOpts as unknown as Parameters<typeof dosed>[0]);
        crEntry.CRInsulin = (insulinDosed as unknown as { insulin?: number }).insulin;
        //console.error(crEntry);
    });

    const CSFLength = CSFGlucoseData.length;
    let ISFLength = ISFGlucoseData.length;
    const UAMLength = UAMGlucoseData.length;
    let basalLength = basalGlucoseData.length;

    if (opts.categorize_uam_as_basal) {
        console.error("--categorize-uam-as-basal=true set: categorizing all UAM data as basal.");
        basalGlucoseData = basalGlucoseData.concat(UAMGlucoseData);
    } else if (CSFLength > 12) {
        console.error("Found at least 1h of carb absorption: assuming all meals were announced, and categorizing UAM data as basal.");
        basalGlucoseData = basalGlucoseData.concat(UAMGlucoseData);
    } else {
        if (2*basalLength < UAMLength) {
            //console.error(basalGlucoseData, UAMGlucoseData);
            console.error("Warning: too many deviations categorized as UnAnnounced Meals");
            console.error("Adding",UAMLength,"UAM deviations to",basalLength,"basal ones");
            basalGlucoseData = basalGlucoseData.concat(UAMGlucoseData);
            //console.error(basalGlucoseData);
            // if too much data is excluded as UAM, add in the UAM deviations to basal, but then discard the highest 50%
            basalGlucoseData.sort((a: CategorizeGlucoseDatum, b: CategorizeGlucoseDatum) => {
                return (a.deviation as unknown as number) - (b.deviation as unknown as number);
            });
            const newBasalGlucose = basalGlucoseData.slice(0,basalGlucoseData.length/2);
            //console.error(newBasalGlucose);
            basalGlucoseData = newBasalGlucose;
            console.error("and selecting the lowest 50%, leaving", basalGlucoseData.length, "basal+UAM ones");
        }

        if (2*ISFLength < UAMLength && ISFLength < 10) {
            console.error("Adding",UAMLength,"UAM deviations to",ISFLength,"ISF ones");
            ISFGlucoseData = ISFGlucoseData.concat(UAMGlucoseData);
            // if too much data is excluded as UAM, add in the UAM deviations to ISF, but then discard the highest 50%
            ISFGlucoseData.sort((a: CategorizeGlucoseDatum, b: CategorizeGlucoseDatum) => {
                return (a.deviation as unknown as number) - (b.deviation as unknown as number);
            });
            const newISFGlucose = ISFGlucoseData.slice(0,ISFGlucoseData.length/2);
            //console.error(newISFGlucose);
            ISFGlucoseData = newISFGlucose;
            console.error("and selecting the lowest 50%, leaving", ISFGlucoseData.length, "ISF+UAM ones");
            //console.error(ISFGlucoseData.length, UAMLength);
        }
    }
    basalLength = basalGlucoseData.length;
    ISFLength = ISFGlucoseData.length;
    if ( 4*basalLength + ISFLength < CSFLength && ISFLength < 10 ) {
        console.error("Warning: too many deviations categorized as meals");
        //console.error("Adding",CSFLength,"CSF deviations to",basalLength,"basal ones");
        //var basalGlucoseData = basalGlucoseData.concat(CSFGlucoseData);
        console.error("Adding",CSFLength,"CSF deviations to",ISFLength,"ISF ones");
        ISFGlucoseData = ISFGlucoseData.concat(CSFGlucoseData);
        CSFGlucoseData = [];
    }


    return {
        CRData: CRData,
        CSFGlucoseData: CSFGlucoseData,
        ISFGlucoseData: ISFGlucoseData,
        basalGlucoseData: basalGlucoseData
    };
}

export default categorizeBGDatums;
