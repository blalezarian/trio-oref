interface ISFData {
  sensitivities: Array<{
    offset: number;
    sensitivity: number;
    endOffset?: number;
  }>;
}

interface ISFLookup {
  (isf_data: ISFData, timestamp?: Date): number;
  isfLookup: ISFLookup;
}

declare const isfLookup: ISFLookup;
export = isfLookup;
