// api/src/modules/payroll/payroll.engine.ts
//
// Kenya Statutory Payroll Calculations — KRA 2025/2026
// =====================================================================
//
// LEGAL BASIS (Kenya Revenue Authority + statute):
//
// 1. GROSS PAY = Basic Salary + All Allowances
//
// 2. PENSIONABLE PAY = Basic Salary only
//    NSSF is computed on pensionable pay NOT gross (allowances excluded)
//    NSSF Act 2013 — Tier I: 6% of first KES 8,000
//                    Tier II: 6% of KES 8,001–108,000 (ceiling Feb 2026)
//                    Max per party: KES 6,000/mo
//    Employee and employer contribute equally.
//
// 3. NON-TAXABLE ALLOWANCES (KRA limits — Income Tax Act Cap 470)
//    House allowance   : first KES 3,000/mo non-taxable
//    Transport allowance: first KES 2,000/mo non-taxable
//    Other allowances  : fully taxable unless specific exemption applies
//    Excess above limits is taxable.
//
// 4. TAXABLE INCOME = Basic + Taxable Allowances − NSSF(emp) − AHL(emp)
//    AHL is tax-deductible (Finance Act 2023, effective Dec 2024)
//    SHIF is NOT tax-deductible.
//
// 5. PAYE BANDS (monthly, effective Jan 2023 — in force 2025/2026)
//    KES 0       – 24,000   : 10%
//    KES 24,001  – 32,333   : 25%
//    KES 32,334  – 500,000  : 30%
//    KES 500,001 – 800,000  : 32.5%
//    KES 800,001+           : 35%
//    Personal relief        : KES 2,400/mo (all employees)
//
// 6. TAX RELIEFS (reduce PAYE after computation)
//    Disability relief      : KES 2,400/mo additional
//    Insurance relief       : 15% of premium paid, max KES 5,000/mo
//    Mortgage interest      : actual interest paid, max KES 25,000/mo
//    Pension contributions  : registered fund, max KES 30,000/mo
//    Post-retirement medical: max KES 10,000/mo
//
// 7. SHIF = 2.75% of gross, minimum KES 300. Employee-only. NOT tax-deductible.
//
// 8. AHL = 1.5% of gross, both sides. Tax-deductible for employee.
//
// 9. NITA = KES 50 flat/employee/month (employer only).
//
// 10. Exemptions: per-employee flags for NSSF/SHIF/AHL/NITA.
//
// =====================================================================

const INSURANCE_RELIEF_CAP       = 5_000;
const MORTGAGE_RELIEF_CAP        = 25_000;
const PENSION_RELIEF_CAP         = 30_000;
const POST_RETIREMENT_CAP        = 10_000;
const DISABILITY_RELIEF_AMOUNT   = 2_400;
const HOUSE_NONTAXABLE_LIMIT     = 3_000;
const TRANSPORT_NONTAXABLE_LIMIT = 2_000;
const NSSF_TIER1_CEILING         = 8_000;
const NSSF_TIER2_CEILING         = 108_000;
const NSSF_RATE                  = 0.06;
const NSSF_MAX_PER_PARTY         = 6_000;
const SHIF_RATE                  = 0.0275;
const SHIF_MIN                   = 300;
const AHL_RATE                   = 0.015;
const NITA_FLAT                  = 50;
const PERSONAL_RELIEF            = 2_400;

const PAYE_BANDS = [
  { limit:    24_000, rate: 0.10  },
  { limit:    32_333, rate: 0.25  },
  { limit:   500_000, rate: 0.30  },
  { limit:   800_000, rate: 0.325 },
  { limit: Infinity,  rate: 0.35  },
];

export interface PayrollInputs {
  grossSalary:        number;
  houseAllowance:     number;
  transportAllowance: number;
  otherAllowances:    number;
  houseAllowanceTaxableOverride?:     number | null;
  transportAllowanceTaxableOverride?: number | null;
  exemptNSSF?: boolean;
  exemptSHIF?: boolean;
  exemptAHL?:  boolean;
  exemptNITA?: boolean;
  disabilityExemption?:  boolean;
  insuranceRelief?:      number;
  mortgageRelief?:       number;
  pensionRelief?:        number;
  postRetirementRelief?: number;
  helbDeduction:     number;
  saccoDeduction:    number;
  loanDeduction:     number;
  advanceDeduction:  number;
  otherDeductions:   number;
}

export interface PayrollOutputs {
  basicSalary:              number;
  totalGross:               number;
  pensionablePay:           number;
  nonTaxableAllowances:     number;
  taxableAllowances:        number;
  taxableGross:             number;
  nssfEmployee:             number;
  shifEmployee:             number;
  ahlEmployee:              number;
  taxableIncome:            number;
  grossPaye:                number;
  personalRelief:           number;
  disabilityRelief:         number;
  insuranceReliefApplied:   number;
  mortgageReliefApplied:    number;
  pensionReliefApplied:     number;
  postRetirementApplied:    number;
  totalRelief:              number;
  paye:                     number;
  helbDeduction:            number;
  saccoDeduction:           number;
  loanDeduction:            number;
  advanceDeduction:         number;
  otherDeductions:          number;
  totalDeductions:          number;
  netPay:                   number;
  nssfEmployer:             number;
  ahlEmployer:              number;
  nita:                     number;
  totalEmployerCost:        number;
}

function calcNSSF(pensionablePay: number, exempt: boolean): number {
  if (exempt || pensionablePay <= 0) return 0;
  const tier1 = Math.min(pensionablePay, NSSF_TIER1_CEILING);
  const tier2 = Math.max(0, Math.min(pensionablePay, NSSF_TIER2_CEILING) - NSSF_TIER1_CEILING);
  return Math.min(Math.floor((tier1 + tier2) * NSSF_RATE), NSSF_MAX_PER_PARTY);
}

function calcSHIF(gross: number, exempt: boolean): number {
  if (exempt || gross <= 0) return 0;
  return Math.max(SHIF_MIN, Math.floor(gross * SHIF_RATE));
}

function calcAHL(gross: number, exempt: boolean): number {
  if (exempt || gross <= 0) return 0;
  return Math.floor(gross * AHL_RATE);
}

function calcGrossPAYE(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0;
  let tax = 0; let prev = 0;
  for (const band of PAYE_BANDS) {
    if (taxableIncome <= prev) break;
    tax += (Math.min(taxableIncome, band.limit) - prev) * band.rate;
    prev = band.limit;
  }
  return Math.floor(tax);
}

export function calculatePayroll(inputs: PayrollInputs): PayrollOutputs {
  const basic = Math.max(0, inputs.grossSalary);

  // Non-taxable allowance splits
  const houseLimit     = inputs.houseAllowanceTaxableOverride ?? HOUSE_NONTAXABLE_LIMIT;
  const transportLimit = inputs.transportAllowanceTaxableOverride ?? TRANSPORT_NONTAXABLE_LIMIT;

  const houseNonTaxable     = Math.min(inputs.houseAllowance, houseLimit);
  const houseTaxable        = Math.max(0, inputs.houseAllowance - houseNonTaxable);
  const transportNonTaxable = Math.min(inputs.transportAllowance, transportLimit);
  const transportTaxable    = Math.max(0, inputs.transportAllowance - transportNonTaxable);

  const nonTaxableAllowances = houseNonTaxable + transportNonTaxable;
  const taxableAllowances    = houseTaxable + transportTaxable + Math.max(0, inputs.otherAllowances);
  const totalGross           = basic + inputs.houseAllowance + inputs.transportAllowance + inputs.otherAllowances;
  const taxableGross         = basic + taxableAllowances;
  const pensionablePay       = basic;

  // Statutory deductions
  const nssfEmployee = calcNSSF(pensionablePay, inputs.exemptNSSF ?? false);
  const nssfEmployer = calcNSSF(pensionablePay, inputs.exemptNSSF ?? false);
  const shifEmployee = calcSHIF(totalGross,     inputs.exemptSHIF ?? false);
  const ahlEmployee  = calcAHL(totalGross,      inputs.exemptAHL  ?? false);
  const ahlEmployer  = calcAHL(totalGross,      inputs.exemptAHL  ?? false);

  // Taxable income: taxableGross − NSSF − AHL (SHIF NOT deductible)
  const taxableIncome = Math.max(0, taxableGross - nssfEmployee - ahlEmployee);
  const grossPaye     = calcGrossPAYE(taxableIncome);

  // Tax reliefs
  const personalRelief        = PERSONAL_RELIEF;
  const disabilityRelief      = inputs.disabilityExemption ? DISABILITY_RELIEF_AMOUNT : 0;
  const insuranceReliefApplied = Math.min(Math.floor((inputs.insuranceRelief ?? 0) * 0.15), INSURANCE_RELIEF_CAP);
  const mortgageReliefApplied  = Math.min(inputs.mortgageRelief ?? 0, MORTGAGE_RELIEF_CAP);
  const pensionReliefApplied   = Math.min(inputs.pensionRelief ?? 0, PENSION_RELIEF_CAP);
  const postRetirementApplied  = Math.min(inputs.postRetirementRelief ?? 0, POST_RETIREMENT_CAP);

  const totalRelief = personalRelief + disabilityRelief + insuranceReliefApplied +
    mortgageReliefApplied + pensionReliefApplied + postRetirementApplied;

  const paye = Math.max(0, grossPaye - totalRelief);

  // Voluntary deductions
  const helbDeduction    = Math.max(0, inputs.helbDeduction);
  const saccoDeduction   = Math.max(0, inputs.saccoDeduction);
  const loanDeduction    = Math.max(0, inputs.loanDeduction);
  const advanceDeduction = Math.max(0, inputs.advanceDeduction);
  const otherDeductions  = Math.max(0, inputs.otherDeductions);

  const totalDeductions = nssfEmployee + shifEmployee + ahlEmployee + paye +
    helbDeduction + saccoDeduction + loanDeduction + advanceDeduction + otherDeductions;

  const netPay = Math.max(0, totalGross - totalDeductions);

  const nita             = inputs.exemptNITA ? 0 : NITA_FLAT;
  const totalEmployerCost = totalGross + nssfEmployer + ahlEmployer + nita;

  return {
    basicSalary: basic, totalGross, pensionablePay,
    nonTaxableAllowances, taxableAllowances, taxableGross,
    nssfEmployee, shifEmployee, ahlEmployee,
    taxableIncome, grossPaye,
    personalRelief, disabilityRelief,
    insuranceReliefApplied, mortgageReliefApplied,
    pensionReliefApplied, postRetirementApplied,
    totalRelief, paye,
    helbDeduction, saccoDeduction, loanDeduction, advanceDeduction, otherDeductions,
    totalDeductions, netPay,
    nssfEmployer, ahlEmployer, nita, totalEmployerCost,
  };
}