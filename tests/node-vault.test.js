const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const { Wallet, utils } = require('ethers');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/node-vault.ts'), 'utf8');
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiled = { exports: {} };
const tradeHelpers = { exports: {} };
const tradeJavascript = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/pons-trade.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
new Function('exports', 'module', 'require', tradeJavascript)(tradeHelpers.exports, tradeHelpers, require);
new Function('exports', 'module', 'require', javascript)(compiled.exports, compiled, (id) => id === './pons-trade' ? tradeHelpers.exports : require(id));
const vault = compiled.exports;
// Disposable test wallets only. Assertions never print secret key material.
const password = '  local recovery test password  ';
let original;
let serialized;
let backup;

test.before(async () => {
  original = vault.createNodeSession(3);
  serialized = await vault.encryptNodeBackup(original, password);
  backup = JSON.parse(serialized);
});

test.after(() => vault.forgetNodeSession(original));

function modified(change) {
  const copy = JSON.parse(serialized);
  change(copy);
  return JSON.stringify(copy);
}

test('generation enforces counts and creates random, immutable public identities', () => {
  for (const count of [0, -1, 51, 1.5, NaN, Infinity, '2', null]) {
    assert.throws(() => vault.createNodeSession(count), /between 1 and 50/);
  }
  const other = vault.createNodeSession(20);
  assert.equal(other.addresses.length, 20);
  assert.equal(new Set(other.addresses).size, 20);
  assert.notEqual(original.addresses[0], other.addresses[0]);
  assert.notEqual(original.id, other.id);
  assert.equal(Object.isFrozen(original), true);
  assert.equal(Object.isFrozen(original.addresses), true);
  assert.deepEqual(Object.keys(original).sort(), ['addresses', 'backupVerified', 'id']);
  assert.equal(/privateKey|mnemonic|phrase|password/.test(JSON.stringify(original)), false);
  assert.equal(vault.isVerifiedNodeSession(original), false);
  assert.throws(() => original.addresses.push(other.addresses[0]), TypeError);
  vault.forgetNodeSession(other);
});

test('backup contains encrypted mnemonic and real recovery reproduces every account', async () => {
  assert.equal(backup.version, 1);
  assert.equal(backup.count, 3);
  assert.equal(backup.keystore.version, 3);
  assert.equal(typeof backup.keystore['x-ethers'].mnemonicCiphertext, 'string');
  assert.equal(backup.keystore.crypto.kdfparams.n, 131072);
  const decrypted = await Wallet.fromEncryptedJson(JSON.stringify(backup.keystore), password);
  assert.equal(Boolean(decrypted.mnemonic && decrypted.mnemonic.phrase), true);
  assert.equal(serialized.includes(decrypted.privateKey), false, 'backup must not expose a private key');
  assert.equal(serialized.includes(decrypted.mnemonic.phrase), false, 'backup must not expose the recovery phrase');
  const expected = Array.from({ length: 3 }, (_, i) => (
    Wallet.fromMnemonic(decrypted.mnemonic.phrase, `m/44'/60'/0'/0/${i}`).address
  ));
  assert.deepEqual(original.addresses, expected);
  assert.equal(decrypted.address, expected[0]);
  const progress = [];
  const restored = await vault.restoreNodeBackup(serialized, password, (value) => progress.push(value));
  assert.deepEqual(restored.addresses, expected);
  assert.notEqual(restored.id, original.id);
  assert.equal(restored.backupVerified, true);
  assert.equal(vault.isVerifiedNodeSession(restored), true);
  assert.equal(progress.length > 0 && progress.every((value) => value >= 0 && value <= 1), true);
  assert.equal(/privateKey|mnemonic|phrase|password/.test(JSON.stringify(restored)), false);
  vault.forgetNodeSession(restored);
  assert.equal(vault.isVerifiedNodeSession(restored), false);
});

test('individual standard keystore gives external control over only the selected account', async () => {
  const encrypted = await vault.exportNodeKeystore(original, 2, password, () => {
    throw new Error('A failed UI progress observer must not interrupt recovery.');
  });
  const store = JSON.parse(encrypted);
  assert.equal(store.version, 3);
  assert.equal(Object.hasOwn(store, 'x-ethers'), false);
  const wallet = await Wallet.fromEncryptedJson(encrypted, password);
  assert.equal(wallet.address, original.addresses[2]);
  assert.equal(wallet.mnemonic, null);
  // A signature proves the exported key controls the advertised address; this
  // is a local test message, never a transaction or production key operation.
  const message = 'Local node vault recovery acceptance test';
  const signature = await wallet.signMessage(message);
  assert.equal(utils.verifyMessage(message, signature), original.addresses[2]);
});

test('wrong password and whitespace-trimmed password fail with sanitized errors', async () => {
  for (const wrong of ['a different test password', password.trim()]) {
    await assert.rejects(vault.restoreNodeBackup(serialized, wrong), {
      message: 'Unable to restore backup. Check the file and password.',
    });
  }
});

test('password bounds and export index bounds fail before encryption', async () => {
  for (const invalid of ['', 'a'.repeat(11), 'a'.repeat(129), null, 12]) {
    await assert.rejects(vault.encryptNodeBackup(original, invalid), /12 to 128/);
    await assert.rejects(vault.restoreNodeBackup(serialized, invalid), /12 to 128/);
    await assert.rejects(vault.exportNodeKeystore(original, 0, invalid), /12 to 128/);
  }
  for (const index of [-1, 3, 0.1, NaN, '0']) {
    await assert.rejects(vault.exportNodeKeystore(original, index, password), /Invalid node index/);
  }
});

test('forged, cloned, and forgotten identities cannot authenticate or export', async () => {
  const clone = JSON.parse(JSON.stringify(original));
  clone.backupVerified = true;
  assert.equal(vault.isVerifiedNodeSession(clone), false);
  await assert.rejects(vault.encryptNodeBackup(clone, password), /no longer available/);
  await assert.rejects(vault.exportNodeKeystore(clone, 0, password), /no longer available/);
  const forgotten = vault.createNodeSession(1);
  vault.forgetNodeSession(forgotten);
  vault.forgetNodeSession(forgotten);
  await assert.rejects(vault.encryptNodeBackup(forgotten, password), /no longer available/);
  assert.equal(vault.isVerifiedNodeSession(null), false);
  assert.equal(vault.isVerifiedNodeSession({ id: original.id, backupVerified: true }), false);
});

test('strict size, schema, path and KDF bounds reject before ethers decryption', async () => {
  const realDecrypt = Wallet.fromEncryptedJson;
  let attempted = 0;
  Wallet.fromEncryptedJson = async () => { attempted++; throw new Error('Decryption should not be called'); };
  try {
    const invalid = [
      '', 'null', '[]', '{', ' '.repeat(16385),
      modified((b) => { b.extra = true; }),
      modified((b) => { b.version = 2; }),
      modified((b) => { b.count = 51; }),
      modified((b) => { b.count = '3'; }),
      modified((b) => { b.addresses.pop(); }),
      modified((b) => { b.addresses[0] = null; }),
      modified((b) => { b.keystore.crypto.kdf = 'pbkdf2'; }),
      modified((b) => { b.keystore.crypto.kdfparams.n = 2 ** 30; }),
      modified((b) => { b.keystore.crypto.kdfparams.n = '131072'; }),
      modified((b) => { b.keystore.crypto.kdfparams.n = 2; }),
      modified((b) => { b.keystore.crypto.kdfparams.r = 10000000; }),
      modified((b) => { b.keystore.crypto.kdfparams.p = 10000000; }),
      modified((b) => { b.keystore.crypto.kdfparams.dklen = 64; }),
      modified((b) => { b.keystore.crypto.kdfparams.N = 131072; }),
      modified((b) => { b.keystore.Crypto = b.keystore.crypto; }),
      modified((b) => { b.keystore.crypto.cipherparams.iv = '0'.repeat(30); }),
      modified((b) => { b.keystore.crypto.kdfparams.salt = '0'.repeat(62); }),
      modified((b) => { b.keystore['x-ethers'].path = "m/44'/60'/0'/0/1"; }),
      modified((b) => { b.keystore['x-ethers'].locale = 'fr'; }),
      modified((b) => { delete b.keystore['x-ethers']; }),
      modified((b) => { b.keystore['x-ethers'].mnemonicCiphertext = '0'.repeat(64); }),
    ];
    for (const serializedInvalid of invalid) {
      await assert.rejects(vault.restoreNodeBackup(serializedInvalid, password), /Unable to restore backup/);
    }
    assert.equal(attempted, 0);
  } finally {
    Wallet.fromEncryptedJson = realDecrypt;
  }
});

test('address replacement, reorder and a shortened valid prefix fail authentication', async () => {
  const tampered = [
    modified((b) => { b.addresses[1] = b.addresses[0]; }),
    modified((b) => { b.addresses.reverse(); }),
    modified((b) => { b.count = 2; b.addresses.pop(); }),
    modified((b) => { b.manifestMac = `0x${'0'.repeat(64)}`; }),
  ];
  for (const value of tampered) {
    await assert.rejects(vault.restoreNodeBackup(value, password), /Unable to restore backup/);
  }
});

test('encrypted private key, mnemonic and root address tampering fail recovery', async () => {
  function flip(hex) { return `${hex[0] === '0' ? '1' : '0'}${hex.slice(1)}`; }
  const tampered = [
    modified((b) => { b.keystore.crypto.ciphertext = flip(b.keystore.crypto.ciphertext); }),
    modified((b) => { b.keystore['x-ethers'].mnemonicCiphertext = flip(b.keystore['x-ethers'].mnemonicCiphertext); }),
    modified((b) => { b.keystore.address = '0'.repeat(40); }),
  ];
  for (const value of tampered) {
    await assert.rejects(vault.restoreNodeBackup(value, password), /Unable to restore backup/);
  }
});

test('concurrent KDF operations are bounded and forgetting revokes a pending export', async () => {
  const temporary = vault.createNodeSession(1);
  const pending = vault.encryptNodeBackup(temporary, password, () => vault.forgetNodeSession(temporary));
  const rejected = assert.rejects(pending, /Unable to encrypt/);
  await assert.rejects(vault.restoreNodeBackup(serialized, password), /in progress/);
  await rejected;
  // Failure releases the lock; a valid recovery still succeeds afterward.
  const restored = await vault.restoreNodeBackup(serialized, password);
  assert.equal(vault.isVerifiedNodeSession(restored), true);
  vault.forgetNodeSession(restored);
});


test('fifty unique wallets roundtrip through the unchanged encrypted format', async () => {
  const fifty=vault.createNodeSession(50);
  try {
    assert.equal(fifty.addresses.length,50);assert.equal(new Set(fifty.addresses).size,50);
    const text=await vault.encryptNodeBackup(fifty,password),data=JSON.parse(text);
    assert.equal(data.version,1);assert.equal(data.count,50);assert.ok(Buffer.byteLength(text)<=16384);
    const restored=await vault.restoreNodeBackup(text,password);
    try {assert.equal(restored.backupVerified,true);assert.deepEqual(restored.addresses,fifty.addresses);assert.equal(restored.addresses[49],fifty.addresses[49]);}
    finally {vault.forgetNodeSession(restored);}
    data.count=51;data.addresses.push(utils.getAddress('0x'+'1'.repeat(40)));
    await assert.rejects(vault.restoreNodeBackup(JSON.stringify(data),password),/Unable to restore/);
  } finally {vault.forgetNodeSession(fifty);}
});
