#!/usr/bin/env node
// Claude Code hook handler.
// Reads the hook JSON from stdin, trims it to a tiny display event, and POSTs it
// to the local court server. It never blocks Claude Code: hard time limit,
// prints nothing to stdout, and always exits 0.
//
// usage: node hook.js <port> <token>   injected via `claude --settings <temp file>` for the court's own claude
//        node hook.js --watch          installed by `eojeon watch` into ~/.claude/settings.json; finds the
//                                      running court through ~/.eojeon/runtime.json and does nothing if none
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { sanitize } from './sanitize.js';

const done = () => process.exit(0);
setTimeout(done, 1500).unref?.();

const WATCH = process.argv[2] === '--watch';
// the court's own claude already reports through its --settings hook; don't count it twice
if (WATCH && process.env.EOJEON_CHILD === '1') done();

let port;
let token;
if (WATCH) {
  try {
    ({ port, token } = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.eojeon', 'runtime.json'), 'utf8')));
  } catch {
    done(); // no court running
  }
} else {
  [port, token] = process.argv.slice(2);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  if (buf.length < 4_000_000) buf += c;
});
process.stdin.on('error', done);
process.stdin.on('end', () => {
  let ev;
  try {
    ev = sanitize(JSON.parse(buf));
  } catch {
    return done();
  }
  if (!port || !token) return done();
  if (WATCH) ev.ext = true; // a session outside the court: watch only, the stamps can't answer it
  const body = JSON.stringify(ev);
  const req = http.request(
    {
      host: '127.0.0.1',
      port: Number(port),
      path: '/hook',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-court-token': String(token) },
      timeout: 800,
    },
    (res) => {
      res.resume();
      res.on('end', done);
    },
  );
  req.on('timeout', () => req.destroy());
  req.on('error', done);
  req.end(body);
});
