'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {fail} = require('./model.cjs');
// The OS user and this program are trusted. Same-user malware/root compromise cannot be solved by file modes.
function secureParents(directory) {
  const absolute = path.resolve(directory); let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('State path must contain only real directories.');
    if (stat.uid !== process.getuid() && stat.uid !== 0) fail('State parent is owned by another user.');
    if ((stat.mode & 0o022) && !(stat.uid === 0 && (stat.mode & 0o1000))) fail('State parent is writable by another user. Use a private Linux home directory.');
  }
  return absolute;
}
function syncDir(dir) { const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function openState(directory) {
  if (process.platform === 'win32' || !process.getuid) fail('Use Node 24 in Linux/WSL with state in its private Linux home; Windows ACL support has not been verified.');
  const parent = secureParents(path.dirname(path.resolve(directory)));
  const dir = path.join(parent, path.basename(directory));
  try { fs.mkdirSync(dir, {mode: 0o700}); syncDir(parent); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  secureParents(dir); const st = fs.lstatSync(dir);
  if (st.uid !== process.getuid() || (st.mode & 0o777) !== 0o700) fail('State directory must be owned by you with mode 0700.');
  const lock = path.join(dir, 'process.lock');
  let lockFd;
  try { lockFd = fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); }
  catch { fail('Companion is locked. Another process may be running or crashed. Read recovery instructions; never retry a withdrawal to clear this.'); }
  try { fs.writeFileSync(lockFd, JSON.stringify({pid: process.pid})); fs.fsyncSync(lockFd); syncDir(dir); }
  catch (e) { fs.closeSync(lockFd); throw e; }
  let released = false;
  function name(key) { if (!/^[a-z0-9-]+$/.test(key)) fail('Invalid state key.'); return path.join(dir, key + '.json'); }
  function read(key) {
    let fd; try { fd = fs.openSync(name(key), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); } catch (e) { if (e.code === 'ENOENT') return null; fail('Unsafe or unreadable state file.'); }
    try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024) fail('State file permissions or size are invalid.'); const value = JSON.parse(fs.readFileSync(fd, 'utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid state object.'); return value; }
    catch { fail('State is unreadable. Do not delete it or resubmit; follow recovery instructions.'); } finally { fs.closeSync(fd); }
  }
  function write(key, value) {
    if (released) fail('State lock was released.');
    const dest = name(key);
    try { fs.lstatSync(dest); read(key); } catch (error) { if (error.code !== 'ENOENT') throw error; } // Includes dangling symlinks.
    const temp = path.join(dir, 'write-' + crypto.randomUUID());
    const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, dest); syncDir(dir);
  }
  function nonce(account) {
    const key = 'nonce-' + account, old = read(key);
    if (old !== null && (typeof old.value !== 'string' || !/^[0-9]{1,20}$/.test(old.value))) fail('Invalid persisted nonce.');
    const now = BigInt(Date.now()) * 1000n, last = old ? BigInt(old.value) : 0n;
    const next = now > last ? now : last + 1n; if (next > 18446744073709551615n) fail('Kraken nonce limit exceeded.');
    const value = next.toString(); write(key, {value}); return value;
  }
  return {read, write, nonce, close() { if (!released) { fs.closeSync(lockFd); fs.unlinkSync(lock); syncDir(dir); released = true; } }};
}
module.exports = {openState};
