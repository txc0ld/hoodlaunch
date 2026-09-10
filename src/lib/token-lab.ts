import { BigNumber, utils } from 'ethers';

export const TOKEN_LAB_DECIMALS = 18;
export const TOKEN_LAB_DISCLAIMER = 'Planning estimates only. Token Lab does not deploy, lock, burn, approve, trade, change taxes, or predict prices or returns.';

const SCALE = BigNumber.from(10).pow(TOKEN_LAB_DECIMALS);
const HUNDRED = SCALE.mul(100);
const MAX_VESTING_MONTHS = SCALE.mul(120);
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;

export type AllocationInput = {
  team: string;
  community: string;
  liquidity: string;
  treasury: string;
};

export type AllocationResult = {
  totalPercent: string;
  remainingPercent: string;
  exactTotal: boolean;
  withinTotal: boolean;
  tokenAmounts: AllocationInput;
};

export type FeeImpact = { grossAmount: string; feePercent: string; feeAmount: string; netAmount: string };
export type VestingResult = { elapsedMonths: string; vestedPercent: string; vestedAmount: string; unvestedAmount: string };

export type TokenLabScenario = {
  name: string;
  totalSupply: string;
  targetPriceUsd: string;
  allocations: AllocationInput;
  buyAmount: string;
  buyFeePercent: string;
  sellAmount: string;
  sellFeePercent: string;
  vestingAmount: string;
  cliffMonths: string;
  durationMonths: string;
};

export type ScenarioSummary = TokenLabScenario & {
  fdvUsd: string;
  allocationTotalPercent: string;
  buyFeeAmount: string;
  buyNetAmount: string;
  sellFeeAmount: string;
  sellNetAmount: string;
};

function decimal(value: string, label: string, allowZero = true): BigNumber {
  if (typeof value !== 'string' || value.length > 76 || !DECIMAL_PATTERN.test(value)) {
    throw new Error(`${label} must be a plain decimal with up to 18 decimal places.`);
  }
  const units = utils.parseUnits(value, TOKEN_LAB_DECIMALS);
  if (!allowZero && units.isZero()) throw new Error(`${label} must be greater than zero.`);
  return units;
}

function percentage(value: string, label: string): BigNumber {
  const units = decimal(value, label);
  if (units.gt(HUNDRED)) throw new Error(`${label} must be between 0 and 100%.`);
  return units;
}

function format(units: BigNumber): string {
  const value = utils.formatUnits(units, TOKEN_LAB_DECIMALS);
  return value.includes('.') ? value.replace(/\.0+$|(?<=\.[0-9]*[1-9])0+$/, '') : value;
}

function multiply(left: BigNumber, right: BigNumber): BigNumber {
  return left.mul(right).div(SCALE);
}

export function calculateFdv(totalSupply: string, targetPriceUsd: string): string {
  return format(multiply(decimal(totalSupply, 'Total supply', false), decimal(targetPriceUsd, 'Target USD price')));
}

export function calculateAllocations(totalSupply: string, allocations: AllocationInput): AllocationResult {
  const supply = decimal(totalSupply, 'Total supply', false);
  const entries = (Object.keys(allocations) as (keyof AllocationInput)[]).map(key => [key, percentage(allocations[key], `${key[0].toUpperCase()}${key.slice(1)} allocation`)] as const);
  const total = entries.reduce((sum, [, value]) => sum.add(value), BigNumber.from(0));
  const tokenAmounts = Object.fromEntries(entries.map(([key, value]) => [key, format(supply.mul(value).div(HUNDRED))])) as AllocationInput;
  const withinTotal = total.lte(HUNDRED);
  return {
    totalPercent: format(total),
    remainingPercent: withinTotal ? format(HUNDRED.sub(total)) : `-${format(total.sub(HUNDRED))}`,
    exactTotal: total.eq(HUNDRED),
    withinTotal,
    tokenAmounts,
  };
}

export function calculateFeeImpact(amount: string, feePercent: string): FeeImpact {
  const gross = decimal(amount, 'Token amount');
  const rate = percentage(feePercent, 'Fee or tax');
  const fee = gross.mul(rate).div(HUNDRED);
  return { grossAmount: format(gross), feePercent: format(rate), feeAmount: format(fee), netAmount: format(gross.sub(fee)) };
}

export function calculateVesting(totalAmount: string, cliffMonths: string, durationMonths: string, elapsedMonths: string): VestingResult {
  const total = decimal(totalAmount, 'Vesting token amount');
  const cliff = decimal(cliffMonths, 'Cliff');
  const duration = decimal(durationMonths, 'Duration', false);
  const elapsed = decimal(elapsedMonths, 'Elapsed time');
  if (duration.gt(MAX_VESTING_MONTHS) || cliff.gt(MAX_VESTING_MONTHS)) throw new Error('Cliff and duration must be no more than 120 months.');
  if (cliff.gte(duration)) throw new Error('Duration must be greater than the cliff.');
  let vested = BigNumber.from(0);
  if (elapsed.gte(duration)) vested = total;
  else if (elapsed.gt(cliff)) vested = total.mul(elapsed.sub(cliff)).div(duration.sub(cliff));
  return {
    elapsedMonths: format(elapsed),
    vestedPercent: total.isZero() ? '0' : format(vested.mul(HUNDRED).div(total)),
    vestedAmount: format(vested),
    unvestedAmount: format(total.sub(vested)),
  };
}

export function summarizeScenario(scenario: TokenLabScenario): ScenarioSummary {
  const name = scenario.name.trim();
  if (!name || name.length > 40) throw new Error('Scenario name must contain 1 to 40 characters.');
  const allocations = calculateAllocations(scenario.totalSupply, scenario.allocations);
  if (!allocations.exactTotal) throw new Error('Scenario allocations must total exactly 100%.');
  if (decimal(scenario.vestingAmount, 'Vesting token amount').gt(decimal(scenario.totalSupply, 'Total supply', false))) {
    throw new Error('Vesting allocation cannot exceed total supply.');
  }
  const buy = calculateFeeImpact(scenario.buyAmount, scenario.buyFeePercent);
  const sell = calculateFeeImpact(scenario.sellAmount, scenario.sellFeePercent);
  calculateVesting(scenario.vestingAmount, scenario.cliffMonths, scenario.durationMonths, scenario.durationMonths);
  return {
    ...scenario,
    name,
    fdvUsd: calculateFdv(scenario.totalSupply, scenario.targetPriceUsd),
    allocationTotalPercent: allocations.totalPercent,
    buyFeeAmount: buy.feeAmount,
    buyNetAmount: buy.netAmount,
    sellFeeAmount: sell.feeAmount,
    sellNetAmount: sell.netAmount,
  };
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function exportScenarios(scenarios: readonly TokenLabScenario[], type: 'csv' | 'json'): { filename: string; mimeType: string; content: string } {
  if (!Array.isArray(scenarios) || scenarios.length < 1 || scenarios.length > 3) throw new Error('Export requires 1 to 3 valid scenarios.');
  const summaries = scenarios.map(summarizeScenario);
  if (type === 'json') {
    return {
      filename: 'token-lab-scenarios.json',
      mimeType: 'application/json',
      content: JSON.stringify({ version: 1, assumptions: TOKEN_LAB_DISCLAIMER, scenarios: summaries }, null, 2),
    };
  }
  if (type !== 'csv') throw new Error('Export format must be CSV or JSON.');
  const columns: [string, (scenario: ScenarioSummary) => string][] = [
    ['Scenario', item => item.name], ['Total supply (tokens)', item => item.totalSupply], ['Target price (USD)', item => item.targetPriceUsd], ['FDV (USD)', item => item.fdvUsd],
    ['Team (%)', item => item.allocations.team], ['Community (%)', item => item.allocations.community], ['Liquidity (%)', item => item.allocations.liquidity], ['Treasury (%)', item => item.allocations.treasury], ['Allocation total (%)', item => item.allocationTotalPercent],
    ['Buy amount (tokens)', item => item.buyAmount], ['Buy fee (%)', item => item.buyFeePercent], ['Buy fee amount (tokens)', item => item.buyFeeAmount], ['Buy net amount (tokens)', item => item.buyNetAmount],
    ['Sell amount (tokens)', item => item.sellAmount], ['Sell fee (%)', item => item.sellFeePercent], ['Sell fee amount (tokens)', item => item.sellFeeAmount], ['Sell net amount (tokens)', item => item.sellNetAmount],
    ['Vesting amount (tokens)', item => item.vestingAmount], ['Cliff (months)', item => item.cliffMonths], ['Duration (months)', item => item.durationMonths], ['Assumptions', () => TOKEN_LAB_DISCLAIMER],
  ];
  const content = [columns.map(([name]) => csvCell(name)).join(','), ...summaries.map(item => columns.map(([, read]) => csvCell(read(item))).join(','))].join('\n');
  return { filename: 'token-lab-scenarios.csv', mimeType: 'text/csv;charset=utf-8', content };
}
