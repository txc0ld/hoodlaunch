const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const ethers = require('ethers');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/token-lab.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleUnderTest = { exports: {} };
vm.runInNewContext(`(function(require,module,exports){${js}\n})`, {})(id => {
  if (id === 'ethers') return ethers;
  throw new Error(`Unexpected dependency: ${id}`);
}, moduleUnderTest, moduleUnderTest.exports);
const { calculateFdv, calculateAllocations, calculateFeeImpact, calculateVesting, clampVestingElapsed, exportScenarios } = moduleUnderTest.exports;
const plain = value => JSON.parse(JSON.stringify(value));

const allocation = { team: '20', community: '40', liquidity: '25', treasury: '15' };
const scenario = { name: 'Base case', totalSupply: '1000000', targetPriceUsd: '0.025', allocations: allocation, buyAmount: '1000', buyFeePercent: '2', sellAmount: '500', sellFeePercent: '3', vestingAmount: '200000', cliffMonths: '3', durationMonths: '15' };

test('FDV and fee impact retain bounded decimal precision', () => {
  assert.equal(calculateFdv('1000000', '0.025'), '25000');
  assert.equal(calculateFdv('0.1', '0.2'), '0.02');
  assert.deepEqual(plain(calculateFeeImpact('0.000000000000000001', '100')), { grossAmount: '0.000000000000000001', feePercent: '100', feeAmount: '0.000000000000000001', netAmount: '0' });
});

test('allocations identify zero, exact 100, and totals over 100', () => {
  const zero = calculateAllocations('1000', { team: '0', community: '0', liquidity: '0', treasury: '0' });
  assert.equal(zero.totalPercent, '0'); assert.equal(zero.remainingPercent, '100'); assert.equal(zero.exactTotal, false);
  const exact = calculateAllocations('1000', allocation);
  assert.equal(exact.totalPercent, '100'); assert.equal(exact.exactTotal, true); assert.deepEqual(plain(exact.tokenAmounts), { team: '200', community: '400', liquidity: '250', treasury: '150' });
  const over = calculateAllocations('1000', { ...allocation, treasury: '15.000000000000000001' });
  assert.equal(over.withinTotal, false); assert.equal(over.remainingPercent, '-0.000000000000000001');
});

test('vesting is zero at cliff start, linear after cliff, and complete at duration', () => {
  assert.deepEqual(plain(calculateVesting('1200', '3', '15', '0')), { elapsedMonths: '0', vestedPercent: '0', vestedAmount: '0', unvestedAmount: '1200' });
  assert.equal(calculateVesting('1200', '3', '15', '3').vestedAmount, '0');
  assert.equal(calculateVesting('1200', '3', '15', '9').vestedAmount, '600');
  assert.deepEqual(plain(calculateVesting('1200', '3', '15', '15')), { elapsedMonths: '15', vestedPercent: '100', vestedAmount: '1200', unvestedAmount: '0' });
  assert.equal(calculateVesting('1200', '3', '15', '99').vestedAmount, '1200');
});

test('duration edits keep the inspected point coherent across integer, fractional, and invalid states', () => {
  let elapsed = '9';
  const changeDuration = duration => { elapsed = clampVestingElapsed(elapsed, duration); return calculateVesting('100', '0', duration, elapsed); };
  assert.equal(changeDuration('2').elapsedMonths, '2');
  assert.equal(elapsed, '2');
  assert.equal(changeDuration('0.5').elapsedMonths, '0.5');
  assert.equal(elapsed, '0.5');
  assert.equal(clampVestingElapsed(elapsed, ''), '0');
  elapsed = clampVestingElapsed(elapsed, '');
  assert.equal(changeDuration('0.5').elapsedMonths, '0');
  assert.equal(clampVestingElapsed('NaN', '2'), '0');
});

test('invalid, negative, exponent, non-finite, overflow-sized, and invalid vesting inputs fail closed', () => {
  for (const bad of ['', '-1', '1e3', 'NaN', 'Infinity', '01', '0.0000000000000000001', '9'.repeat(77)]) assert.throws(() => calculateFdv(bad, '1'));
  assert.throws(() => calculateFdv('0', '1'), /greater than zero/);
  assert.throws(() => calculateFeeImpact('1', '100.000000000000000001'), /between 0 and 100/);
  assert.throws(() => calculateVesting('1', '12', '12', '12'), /greater than the cliff/);
  assert.throws(() => calculateVesting('1', '12', '121', '12'), /no more than 120 months/);
});

test('CSV and JSON exports include assumptions and reject invalid exports', () => {
  const json = exportScenarios([scenario], 'json');
  const parsed = JSON.parse(json.content); assert.equal(parsed.version, 1); assert.equal(parsed.scenarios[0].fdvUsd, '25000'); assert.match(parsed.assumptions, /Planning estimates only/);
  const csv = exportScenarios([{ ...scenario, name: '=unsafe' }], 'csv'); assert.match(csv.content, /"'=unsafe"/); assert.match(csv.content, /"FDV \(USD\)"/);
  assert.throws(() => exportScenarios([], 'json'), /1 to 3/);
  assert.throws(() => exportScenarios([scenario, scenario, scenario, scenario], 'csv'), /1 to 3/);
  assert.throws(() => exportScenarios([scenario], 'xml'), /CSV or JSON/);
  assert.throws(() => exportScenarios([{ ...scenario, targetPriceUsd: 'nope' }], 'json'));
  assert.throws(() => exportScenarios([{ ...scenario, totalSupply: '1' }], 'json'), /cannot exceed total supply/);
  assert.throws(() => exportScenarios([{ ...scenario, allocations: { ...allocation, team: '19' } }], 'json'), /exactly 100/);
});
