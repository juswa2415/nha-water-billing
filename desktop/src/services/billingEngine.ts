// src/services/billingEngine.ts

export interface BillingCycleParams {
  ratePerCubicM: number;
  // Building level
  bldgSubMeterPrev: number;
  bldgSubMeterCurr: number;
  sumOfUnitReadings: number;   // sum of all individual unit consumptions in this bldg
  activeUnitsInBuilding: number;
  // Community level (CamRes 3)
  mayniladTotalCurr: number;
  mayniladTotalPrev: number;
  sumOfAllSubMeters: number;   // total consumption across all sub-meters in CamRes
  totalActiveUnitsCamRes: number;
}

export interface UnitBillResult {
  consumptionCubicM: number;
  waterCharge: number;
  sysLossCharge: number;         // building-level system loss share
  commonSysLossCharge: number;   // community-level common system loss share
  reconnectionFee: number;
  penalty: number;
  previousBalance: number;
  totalForMonth: number;
  totalAmountDue: number;
  // Breakdown details (for bill printing)
  breakdown: {
    bldgSubMeterTotal: number;
    bldgSystemLoss: number;
    bldgSystemLossPhp: number;
    sysLossPerUnit: number;
    camResCommonLoss: number;
    camResCommonLossPhp: number;
    commonLossPerUnit: number;
  };
}

export function computeUnitBill(
  prevReading: number,
  currReading: number,
  params: BillingCycleParams,
  previousBalance: number = 0,
  reconnectionFee: number = 0,
  penalty: number = 0
): UnitBillResult {
  const { ratePerCubicM } = params;

  // 1. Individual consumption
  const consumptionCubicM = Math.max(0, currReading - prevReading);
  const waterCharge = round2(consumptionCubicM * ratePerCubicM);

  // 2. Building system loss
  //    (As per NHA bill: Bldg sub-meter total − sum of all unit readings)
  const bldgSubMeterTotal = Math.max(0, params.bldgSubMeterCurr - params.bldgSubMeterPrev);
  const bldgSystemLoss = Math.max(0, bldgSubMeterTotal - params.sumOfUnitReadings);
  const bldgSystemLossPhp = round2(bldgSystemLoss * ratePerCubicM);
  const sysLossPerUnit = round2(bldgSystemLossPhp / params.activeUnitsInBuilding);

  // 3. Community common system loss
  //    (Maynilad main meter − sum of all building sub-meters)
  const mayniladTotal = Math.max(0, params.mayniladTotalCurr - params.mayniladTotalPrev);
  const camResCommonLoss = Math.max(0, mayniladTotal - params.sumOfAllSubMeters);
  const camResCommonLossPhp = round2(camResCommonLoss * ratePerCubicM);
  const commonLossPerUnit = round2(camResCommonLossPhp / params.totalActiveUnitsCamRes);

  // 4. Totals
  const totalForMonth = round2(
    waterCharge + sysLossPerUnit + commonLossPerUnit + reconnectionFee + penalty
  );
  const totalAmountDue = round2(totalForMonth + previousBalance);

  return {
    consumptionCubicM,
    waterCharge,
    sysLossCharge: sysLossPerUnit,
    commonSysLossCharge: commonLossPerUnit,
    reconnectionFee,
    penalty,
    previousBalance,
    totalForMonth,
    totalAmountDue,
    breakdown: {
      bldgSubMeterTotal,
      bldgSystemLoss,
      bldgSystemLossPhp,
      sysLossPerUnit,
      camResCommonLoss,
      camResCommonLossPhp,
      commonLossPerUnit,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Validation: detect anomalies before approving readings
export function validateReading(
  prevReading: number,
  currReading: number,
  avgMonthlyConsumption?: number
): { valid: boolean; flags: string[] } {
  const flags: string[] = [];

  if (currReading < prevReading) {
    flags.push('CURRENT_BELOW_PREVIOUS: Meter may have been reset or misread.');
  }

  const consumption = currReading - prevReading;
  if (consumption === 0) {
    flags.push('ZERO_CONSUMPTION: No water usage detected. Possible misread or vacant unit.');
  }

  if (avgMonthlyConsumption && consumption > avgMonthlyConsumption * 3) {
    flags.push(`ABNORMAL_SPIKE: Consumption ${consumption} cu.m is 3× the average.`);
  }

  return { valid: flags.length === 0, flags };
}