#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {plan, fail} = require('./model.cjs');
const {openState} = require('./state.cjs');
const {createExchange} = require('./exchanges.cjs');
const {prepare, execute, history} = require('./operations.cjs');
const USAGE = `HOODLABS local exchange companion (Node 24, Linux / WSL)
No web server. Credentials stay in this process environment.

node companion/cli.cjs inspect <kraken|binance|okx> <plan.json> <node-index>
node companion/cli.cjs prepare kraken <plan.json> <node-index> <maximum-debit-ETH>
node companion/cli.cjs execute kraken <review-id> "WITHDRAW <review-id>"
node companion/cli.cjs history kraken <review-id>

Binance and OKX are read-only connections; use their websites to withdraw.
Live execution defaults off. Read docs/EXCHANGES.md before enabling it.
`;
function readPlan(file) {
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.size > 65536) fail('Invalid plan file size or type.'); return plan(JSON.parse(fs.readFileSync(fd, 'utf8'))); }
  catch { fail('Could not read a valid public-only funding plan.'); } finally { if (fd !== undefined) fs.closeSync(fd); }
}
async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || args[0] === '--help') { console.log(USAGE); return; }
  if (Number(process.versions.node.split('.')[0]) < 24) fail('Node 24 or newer is required.');
  const [command, provider, item, selection, maximum] = args;
  if (!['inspect', 'prepare', 'execute', 'history'].includes(command) || !['kraken', 'binance', 'okx'].includes(provider) || args.length !== ({inspect: 4, prepare: 5, execute: 4, history: 3}[command])) fail(USAGE);
  // The fixed private directory deliberately has no command-line/env override. Changing state must not become a retry mechanism.
  const state = openState(path.join(os.homedir(), '.hoodlaunch-exchange'));
  try {
    const exchange = createExchange(provider, state);
    let result;
    if (command === 'inspect' || command === 'prepare') {
      const p = readPlan(item), index = Number(selection);
      if (!/^[1-9][0-9]?$/.test(selection) || !p.nodes[index - 1]) fail('Choose a node index in this plan.');
      result = command === 'inspect' ? await exchange.inspect(p.nodes[index - 1]) : await prepare(state, exchange, p, index, maximum);
    } else if (command === 'execute') result = await execute(state, exchange, item, selection);
    else result = await history(state, exchange, item);
    console.log(JSON.stringify(result, null, 2));
  } finally { state.close(); }
}
if (require.main === module) main().catch(error => { console.error(error instanceof Error ? error.message : 'Companion operation failed.'); process.exitCode = 1; });
module.exports = {main, readPlan};
