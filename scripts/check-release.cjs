const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const files=cp.execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const forbidden=files.filter(f=>/(^|\/)(\.env[^/]*|\.local|node_modules|\.next|artifacts|work)(\/|$)/.test(f)&&f!=='.env.example');
if(forbidden.length)throw Error('Private/generated paths are tracked: '+forbidden.join(', '));
if(files.some(f=>/^pages\/api\/(kraken|cex|sign|withdraw)/.test(f)))throw Error('Owner financial endpoint in public release');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
if(!fs.existsSync('.next/static'))throw Error('Build first to scan browser artifacts');
const browser=walk('.next/static');
const sensitive=/SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|PINATA_JWT|KRAKEN_API_KEY|KRAKEN_API_SECRET|CEX_SECRET|WALLET_PRIVATE_KEY/;
for(const f of browser){if(f.endsWith('.map'))throw Error('Client source map emitted');if(sensitive.test(fs.readFileSync(f,'utf8')))throw Error('Server credential reference in browser artifact');}
console.log(JSON.stringify({trackedFiles:files.length,browserFiles:browser.length,privatePaths:0,clientCredentialReferences:0,clientSourceMaps:0}));
