const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const ethers = require('ethers');
function harness() {
 const state = { calls: 0, active: 0, maxActive: 0, releases: [] };
 const snapshot = async token => { state.calls++; state.active++; state.maxActive=Math.max(state.maxActive,state.active); await new Promise(resolve=>state.releases.push(resolve)); state.active--; return { tokenAddress:token }; };
 const source=ts.transpileModule(fs.readFileSync('src/components/NodeTrading.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(source+'\nmodule.exports.probe={read:typeof snapshotRead==="function"?snapshotRead:pons_trade_1.getNodeTradingSnapshot,beforeDeadline};',{
  module,exports:module.exports,require:id=>id==='../lib/pons-trade'?{getNodeTradingSnapshot:snapshot}:id.startsWith('../lib/')?{}:id.endsWith('.css')?{}:require(id),Date,setTimeout,clearTimeout,console,
 });
 return {...module.exports.probe,state};
}
const addresses=Array.from({length:50},(_,i)=>ethers.utils.getAddress('0x'+(i+1).toString(16).padStart(40,'0')));
const token=ethers.utils.getAddress('0x'+'11'.repeat(20));
test('a snapshot held beyond the twenty-second UI deadline remains coalesced until actual settlement',async()=>{
 const h=harness();
 await assert.rejects(h.beforeDeadline(()=>h.read(token,addresses),Date.now()+20000,'Holdings refresh timed out.'),/timed out/);
 assert.equal(h.state.active,1);
 const joined=Array.from({length:5},()=>h.read(token,addresses));
 const calls=h.state.calls;h.state.releases.splice(0).forEach(resolve=>resolve());await Promise.all(joined);
 assert.equal(calls,1,'UI timeout must not free the underlying snapshot read or start overlapping retries');assert.equal(h.state.maxActive,1);
});
test('outstanding snapshot reads are globally bounded across different selections',async()=>{
 const h=harness(),pending=[];
 for(let i=0;i<3;i++)pending.push(h.read(ethers.utils.getAddress('0x'+(100+i).toString(16).padStart(40,'0')),addresses));
 let rejected=false;try{await h.beforeDeadline(()=>h.read(token,[...addresses].reverse()),Date.now()+5,'timeout');}catch(error){rejected=/still in progress/.test(error.message);}
 h.state.releases.splice(0).forEach(resolve=>resolve());await Promise.all(pending);
 assert.equal(rejected,true);assert.equal(h.state.maxActive,3);
});
