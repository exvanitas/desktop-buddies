#!/usr/bin/env node
/* A stand-in for desktop-buddies.exe and a running app: it takes `--api <json>` and writes a reply
   where the app would, whole, as the exe's writes are. FAKE_MODE picks the answer, and every
   request is kept in FAKE_LOG for the test to read. */
import fs from 'node:fs';
import path from 'node:path';
import { slotOf } from '../server.mjs';

const args = process.argv.slice(2), i = args.indexOf('--api');
const req = JSON.parse(args[i + 1]);
const dir = path.join(process.env.BUDDIES_DATA, 'api', 'replies');
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\n');
const mode = process.env.FAKE_MODE || 'ok';
const reply = mode === 'waiting' ? { v: 1, id: req.id, ok: false, error: 'waiting', message: 'Waiting for the person to allow this app in the Manager.' }
  : mode === 'off' ? { v: 1, id: req.id, ok: false, error: 'off', message: 'Other apps aren\'t let in.' }
  : mode === 'not-running' ? { v: 1, id: req.id, ok: false, error: 'not-running', message: 'Desktop Buddies wasn\'t running. Start it, then ask again.' }
  : req.do === 'list' ? { v: 1, id: req.id, ok: true, buddies: [{ id: 'olive', name: 'Olive', out: true, copies: 1, can: ['wave'] }] }
  : { v: 1, id: req.id, ok: true };
if (mode !== 'silent') {
  setTimeout(() => {
    fs.mkdirSync(dir, { recursive: true });
    const temp = path.join(dir, `.~${process.pid}`);
    fs.writeFileSync(temp, JSON.stringify(reply));
    fs.renameSync(temp, path.join(dir, `${slotOf(req.id)}.json`));
  }, Number(process.env.FAKE_DELAY_MS || 150));
}
