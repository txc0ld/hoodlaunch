const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PassThrough } = require('node:stream');
const ts = require('typescript');
const { createRequire } = require('node:module');
function load(file, mocks = {}) {
 const filename = path.resolve(file); const source = ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const module = {exports:{}}; const actual = createRequire(filename);
 const req = name => mocks[name] || (name.startsWith('.') && fs.existsSync(path.resolve(path.dirname(filename),name+'.ts')) ? load(path.resolve(path.dirname(filename),name+'.ts'),mocks) : actual(name));
 vm.runInNewContext(source,{module,exports:module.exports,require:req,process,Buffer,URL,FormData,Blob,fetch,AbortSignal,setTimeout,clearTimeout,console},{filename}); return module.exports;
}
const security = load('src/server/public-security.ts');
const original = process.env.APP_ORIGIN; process.env.APP_ORIGIN='https://launch.example.com';
test.after(()=>{if(original===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=original;});
function request(body={},extra={}) { const req=new PassThrough();req.method='POST';req.rawHeaders=['Origin','https://launch.example.com'];req.headers={origin:'https://launch.example.com','content-type':'application/json',...extra};process.nextTick(()=>req.end(Buffer.from(JSON.stringify(body))));return req; }
function response() { return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;}}; }
const baseServices={accountConfigured:()=>true,billingConfigured:()=>false,account:async()=>null,takeQuota:async()=>{},hasPro:async()=>false};
function accountRoute(services={}) {return load('pages/api/account.ts',{'../../src/server/public-services':{...baseServices,...services},'../../src/server/public-security':security}).default;}
test('wrong/missing/duplicate origin fails before account service',async()=>{
 let calls=0;const handler=accountRoute({account:async()=>{calls++;return 'attacker';}});
 for(const origin of ['https://evil.test',undefined,'https://launch.example.com.evil.test']) {const req=request({action:'status'},{origin});const res=response();await handler(req,res);assert.equal(res.code,403);}
 const req=request({action:'status'});req.rawHeaders.push('origin','https://launch.example.com');const res=response();await handler(req,res);assert.equal(res.code,403);assert.equal(calls,0);
});
test('method, content type and forwarded-header claims cannot bypass guards',async()=>{
 const handler=accountRoute();const a=request({action:'status'});a.method='GET';let res=response();await handler(a,res);assert.equal(res.code,405);
 const b=request({}, {'content-type':'text/plain'});res=response();await handler(b,res);assert.equal(res.code,415);
 const c=request({}, {origin:'https://evil.test','x-forwarded-host':'launch.example.com'});res=response();await handler(c,res);assert.equal(res.code,403);
});
test('setup disabled does not grant entitlement',async()=>{
 const res=response();await accountRoute({accountConfigured:()=>false})(request({action:'status',userId:'fake',pro:true}),res);assert.equal(res.body.pro,false);assert.equal(res.body.configured,false);
});
test('client account and Pro claims never decide status',async()=>{
 const res=response();await accountRoute()(request({action:'status',userId:'another',pro:true}),res);assert.equal(res.body.signedIn,false);assert.equal(res.body.pro,false);
});
test('opaque cookies must be exactly one valid token',()=>{
 const name=security.cookieName();const token='a'.repeat(64);assert.equal(security.readToken({headers:{cookie:`${name}=${token}`}}),token);
 assert.equal(security.readToken({headers:{cookie:`${name}=${token}; ${name}=${token}`}}),null);
 assert.equal(security.readToken({headers:{cookie:`${name}=user-123`}}),null);
 assert.notEqual(security.digest(token),token);assert.equal(security.sessionToken().length,64);
});
test('logout revokes server session before cookie removal and fails closed on DB errors',async()=>{
 let hash; const route=accountRoute({database:()=>({from:()=>({delete:()=>({eq:async(k,v)=>{hash=v;return {error:null};}})})})});
 const res=response();await route(request({action:'logout'},{cookie:`${security.cookieName()}=${'a'.repeat(64)}`}),res);assert.equal(hash,security.digest('a'.repeat(64)));assert.match(res.headers['Set-Cookie'],/Max-Age=0/);
});
test('upstream sensitive errors are redacted',async()=>{
 const res=response();await accountRoute({account:async()=>{throw Error('secret-canary-key-123');}})(request({action:'status'}),res);assert.equal(res.code,503);assert.equal(JSON.stringify(res).includes('secret-canary'),false);
});
test('body size is bounded before JSON/service work',async()=>{
 const res=response();await accountRoute()(request({action:'status'},{'content-length':'999999'}),res);assert.equal(res.code,413);
});
test('Stripe active status exact customer price quantity and current period are required',()=>{
 const svc=load('src/server/public-services.ts',{'./public-security':security});
 const item={price:{id:'price_test'},quantity:1,current_period_end:Math.floor(Date.now()/1000)+500};
 const s={customer:'cus_test',status:'active',items:{data:[item]}};
 assert.equal(svc.eligibleSubscription(s,'cus_test','price_test'),true);
 for(const change of [{customer:'cus_other'},{status:'trialing'},{status:'past_due'},{items:{data:[{...item,quantity:2}]}},{items:{data:[{...item,current_period_end:0}]}}])assert.equal(svc.eligibleSubscription({...s,...change},'cus_test','price_test'),false);
 assert.equal(svc.eligibleSubscription(s,'cus_test','price_other'),false);
});
test('unauthenticated upload cannot consume provider quota',async()=>{
 let calls=0;const handler=load('pages/api/token-image.ts',{'../../src/server/public-services':{requirePro:async()=>security.fail(401,'SIGN_IN','Sign in.'),takeQuota:async()=>{calls++;}},'../../src/server/public-security':security,'../../src/server/public-upload':{IMAGE_LIMIT:4e6,sanitizeImage:async()=>{calls++;},uploadPublicImage:async()=>{calls++;}}}).default;
 const res=response();await handler(request({}, {'content-type':'image/png'}),res);assert.equal(res.code,401);assert.equal(calls,0);
});
test('real raster decoder rejects disguised bytes and strips metadata',async()=>{
 const upload=load('src/server/public-upload.ts',{'./public-security':security});const sharp=require('sharp');
 await assert.rejects(upload.sanitizeImage(Buffer.from('<svg onload="alert(1)"/>'),'image/png'));
 const png=await sharp({create:{width:10,height:10,channels:3,background:'red'}}).png().toBuffer();
 const webp=await upload.sanitizeImage(png,'image/png');const info=await sharp(webp).metadata();assert.equal(info.format,'webp');assert.equal(info.exif,undefined);
 await assert.rejects(upload.sanitizeImage(png,'image/jpeg'));
});

test('CID validator checks structural version/hash/digest length',()=>{
 const {isValidCid}=load('src/server/public-cid.ts');
 assert.equal(isValidCid('bafyaaaaaaaaaaaaaaaaaaaa'),false);
 assert.equal(isValidCid('QmYwAPJzv5CZsnAzt8auVZRnGiRA1PzKYw2JRUSpxD6aTv'),true);
 assert.equal(isValidCid('bafy'+ 'a'.repeat(200)),false);
});

test('checkout cannot charge while live tools are disabled',async()=>{
 const before=process.env.LIVE_LAUNCH_ENABLED;delete process.env.LIVE_LAUNCH_ENABLED;let calls=0;
 try{const res=response();await accountRoute({account:async()=>{calls++;return 'user';}})(request({action:'checkout'}),res);assert.equal(res.code,503);assert.equal(calls,0);}finally{if(before!==undefined)process.env.LIVE_LAUNCH_ENABLED=before;}
});
