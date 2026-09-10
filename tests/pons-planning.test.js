const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const ethers = require('ethers');
const compiled = ts.transpileModule(fs.readFileSync('src/lib/pons-planning.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod = {exports:{}};
vm.runInNewContext(compiled,{module:mod,exports:mod.exports,require:name=>{assert.equal(name,'ethers');return ethers;}});
const {getPonsPlanningSnapshot:snapshot,applyPonsPlan:apply} = mod.exports;
const a='0x1111111111111111111111111111111111111111', b='0x2222222222222222222222222222222222222222';
function fixture() {
 const draft={name:'Preserve me',symbol:'KEEP',configId:'0',developerBuyEth:'0',creatorTaxBps:0,slippageBps:100,buybackEnabled:true,exemptions:[a],website:'https://example.com',creatorFeeRecipient:b};
 const context={protocol:{chainId:4663,factory:a,router:b,launchFeeWei:'500000000000000',maxCreatorTaxBps:1000,configs:[{id:'0',enabled:true,supplyWei:ethers.utils.parseEther('1000000000').toString(),curveFeeBps:100,phantomQuoteWei:'1',graduationThresholdWei:'2',poolFee:3000,tickSpacing:60}]},configId:'0',pairAsset:null};
 return {draft,context};
}
function plan(context,creatorTaxPercent='1.23',developerBuyEth='0.05'){return {snapshotKey:snapshot(context).key,creatorTaxPercent,developerBuyEth};}
test('native plan displays protocol terms and copies only exact tax and initial buy',()=>{
 const {draft,context}=fixture(); const view=snapshot(context);
 assert.equal(view.supply,'1000000000.0');assert.equal(view.curveFeePercent,'1.0');assert.equal(view.launchFeeEth,'0.0005');
 const result=apply(draft,plan(context),context,false);
 assert.equal(result.creatorTaxBps,123);assert.equal(result.developerBuyEth,'0.05');
 for(const key of Object.keys(draft))if(!['creatorTaxBps','developerBuyEth'].includes(key))assert.equal(result[key],draft[key]);
 assert.equal(draft.creatorTaxBps,0); assert.equal(draft.developerBuyEth,'0');
});
test('invalid percentages, excessive precision, exponents and excessive ETH fail',()=>{
 const {draft,context}=fixture();
 for(const value of ['', '-1','NaN','Infinity','1e1','01','1.001','10.01',' 1','1.','999']) assert.throws(()=>apply(draft,plan(context,value),context,false),undefined,value);
 for(const value of ['', '-1','NaN','Infinity','1e1','01','0.0000000000000000001',' 1','1.','9'.repeat(78)]) assert.throws(()=>apply(draft,plan(context,'1',value),context,false),undefined,value);
 assert.equal(apply(draft,plan(context,'10.00','0.000000000000000001'),context,false).creatorTaxBps,1000);
});
test('current protocol and pair changes reject an old plan',()=>{
 const {draft,context}=fixture();const input=plan(context);
 for(const change of [c=>c.protocol.chainId=1,c=>c.protocol.factory=b,c=>c.protocol.router=a,c=>c.protocol.maxCreatorTaxBps=50,c=>c.protocol.launchFeeWei='3',c=>c.protocol.configs[0].enabled=false,c=>c.protocol.configs[0].supplyWei='12',c=>c.protocol.configs[0].curveFeeBps=200,c=>c.configId='1',c=>c.pairToken=b]){
   const copy=structuredClone(context);change(copy);assert.throws(()=>apply(draft,input,copy,false));
 }
 assert.throws(()=>apply({...draft,configId:'9'},input,context,false));
 assert.throws(()=>apply(draft,input,context,true));
 assert.equal(snapshot({...context,protocol:null}),null);
 for(const cap of [NaN,-1,10001,1.5])assert.equal(snapshot({...context,protocol:{...context.protocol,maxCreatorTaxBps:cap}}),null);
});
test('custom pair requires verified metadata and zero initial buy',()=>{
 const {draft,context}=fixture();draft.pairToken=b;context.pairToken=b;
 assert.equal(snapshot(context),null);
 context.pairAsset={address:b,symbol:'QUOTE',decimals:18,phantomQuoteWei:'1',graduationThresholdWei:'2'};
 assert.equal(snapshot(context).customPair,true);
 assert.throws(()=>apply(draft,plan(context),context,false),/zero initial buy/);
 assert.equal(apply(draft,plan(context,'0','0'),context,false).developerBuyEth,'0.0');
 const input=plan(context,'0','0');context.pairAsset.graduationThresholdWei='3';assert.throws(()=>apply(draft,input,context,false));
 context.pairAsset.address=a;assert.equal(snapshot(context),null);
});
