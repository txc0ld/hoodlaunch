const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('typescript'),{createRequire}=require('module');
function load(file){const filename=path.resolve(file),module={exports:{}};const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;vm.runInNewContext(code,{exports:module.exports,module,require:createRequire(filename),crypto:require('node:crypto')},{filename});return module.exports;}
test('source funding plans are explicitly Ethereum ETH and contain no signing material',()=>{
 const {createFundingPlan}=load('src/lib/exchange-plan.ts');const address='0x1111111111111111111111111111111111111111';const p=createFundingPlan([address],'0.01');
 assert.equal(p.sourceChainId,1);assert.equal(p.asset,'ETH');assert.equal(p.nodes[0].address,address);assert.equal(p.nodes[0].amountEth,'0.01');assert.equal(p.nodes[0].index,1);assert.match(p.id,/^[0-9a-f-]{36}$/);
 assert.equal(Object.keys(p.nodes[0]).sort().join(','),'address,amountEth,index');
 for(const amount of ['0','-1','1e3','NaN','0.1234567890123456789','01'])assert.throws(()=>createFundingPlan([address],amount));
 assert.throws(()=>createFundingPlan([address,address],'1'));assert.throws(()=>createFundingPlan([],'1'));assert.throws(()=>createFundingPlan(Array(51).fill(address),'1'));assert.throws(()=>createFundingPlan(['0x'+'0'.repeat(40)],'1'));
});
test('verified-token links use fixed PONS/Dexscreener hosts and reject arbitrary input',()=>{
 const {renderToStaticMarkup}=require('react-dom/server');const React=require('react');const Links=load('src/components/TokenLinks.tsx').default;
 const address='0x1111111111111111111111111111111111111111';const html=renderToStaticMarkup(React.createElement(Links,{address}));
 assert.ok(html.includes('https://www.ponsfamily.com/launchpad/'+address));assert.ok(html.includes('https://dexscreener.com/search?q='+address));assert.ok(html.includes('noopener noreferrer'));assert.ok(html.includes('until it indexes'));
 assert.equal(renderToStaticMarkup(React.createElement(Links,{address:'javascript:alert(1)'})),'');
});
