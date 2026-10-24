#!/usr/bin/env node
// Claude Code hook handler (injected via `claude --settings <temp file>`).
// Reads the hook JSON from stdin, trims it to a tiny display event, and POSTs it
// to the local court server. It never blocks Claude Code: hard time limit,
// prints nothing to stdout, and always exits 0.
//
// usage: node hook.js <port> <token>
import http from 'node:http';
import { sanitize } from './sanitize.js';

const [port, token] = process.argv.slice(2);
const done = () => process.exit(0);
setTimeout(done, 1500).unref?.();

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
  const body = JSON.stringify(ev);
  const req = http.request(
    {
      host: '127.0.0.1',
      port: Number(port),
      path: '/hook',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-court-token': token },
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
