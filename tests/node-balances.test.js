const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const ethers = require('ethers');
const addresses = Array.from({length: 6}, (_, i) => ethers.utils.getAddress('0x' + (i + 1).toString(16).padStart(40, '0')));
function harness(options={}) {
  const calls=[]; let chains=0; let active=0, maximum=0;
  class Provider {
    constructor(connection) { assert.equal(connection.url,'https://rpc.mainnet.chain.robinhood.com'); }
    async send(method) { calls.push(method); chains++; return options.wrongChain || (options.changeChain && chains>1) ? '0x1' : '0x1237'; }
    async getBlockNumber() { return 123; }
    async getBalance(address, block) { calls.push([address,block]); active++; maximum=Math.max(maximum,active); await new Promise(resolve=>setImmediate(resolve)); active--; if(options.fail)throw Error('private upstream detail');return ethers.BigNumber.from('900719925474099312345'); }
    removeAllListeners() { calls.push('cleanup'); }
  }
  const source=fs.readFileSync(require('node:path').join(__dirname,'../src/lib/node-balances.ts'),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const module={exports:{}};
  vm.runInNewContext('(function(require,module,exports){'+js+'\n})',{setTimeout,clearTimeout,Date,Error})(id=>id==='ethers'?{...ethers,providers:{JsonRpcProvider:Provider}}:{PONS_CHAIN_ID:4663,PONS_RPC:'https://rpc.mainnet.chain.robinhood.com'},module,module.exports);
  return {...module.exports,calls,get maximum(){return maximum}};
}
test('node balances use exact values, one block and bounded concurrency without wallet signing',async()=>{
 const h=harness();const result=await h.getNodeBalances(addresses);
 assert.equal(result.chainId,4663);assert.equal(result.blockNumber,123);assert.equal(result.balances.length,6);
 assert.ok(result.balances.every(b=>b.balanceWei==='900719925474099312345'));
 assert.ok(h.calls.filter(Array.isArray).every(c=>c[1]===123));assert.equal(h.maximum,4);
 assert.deepEqual(h.calls.filter(x=>typeof x==='string'),['eth_chainId','eth_chainId','cleanup']);assert.ok(Object.isFrozen(result.balances));
});
test('invalid or duplicate recipients are rejected before RPC construction',async()=>{
 for(const value of [[],Array(21).fill(addresses[0]),[addresses[0],addresses[0]],['bad'],[ethers.constants.AddressZero]]){const h=harness();await assert.rejects(h.getNodeBalances(value));assert.equal(h.calls.length,0)}
});
test('wrong network or changed network never returns a balance snapshot',async()=>{
 for(const options of [{wrongChain:true},{changeChain:true}]){const h=harness(options);await assert.rejects(h.getNodeBalances(addresses),/Could not read node balances/);assert.equal(h.calls.at(-1),'cleanup')}
});
test('failed reads return safe errors and cannot be mistaken for zero balances',async()=>{
 const h=harness({fail:true});await assert.rejects(h.getNodeBalances(addresses),e=>e.message==='Could not read node balances on Robinhood Chain. Try again.');assert.equal(h.calls.at(-1),'cleanup');
});


test('fifty balances retain order and concurrency four; fifty-one fails before RPC',async()=>{
 const fifty=Array.from({length:50},(_,i)=>ethers.utils.getAddress('0x'+(i+1).toString(16).padStart(40,'0'))),h=harness();
 const result=await h.getNodeBalances(fifty);assert.equal(result.balances.length,50);assert.equal(result.balances[49].address,fifty[49]);assert.equal(h.maximum,4);
 const over=harness();await assert.rejects(over.getNodeBalances([...fifty,ethers.utils.getAddress('0x'+(51).toString(16).padStart(40,'0'))]),/1 and 50/);assert.equal(over.calls.length,0);
});
