import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Local signaling only. Media travels directly between the two browsers.
const token = randomBytes(24).toString('hex');
const queues = { sender: [], receiver: [] };
const page = readFileSync(new URL('./viewer.html', import.meta.url));
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !['https://grandblooming.trinket.lol', 'http://127.0.0.1:43119'].includes(origin)) {
    res.writeHead(403); return res.end();
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://127.0.0.1:43119');
  if (url.pathname === '/' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html'); return res.end(page);
  }
  if (url.searchParams.get('token') !== token) { res.writeHead(403); return res.end(); }
  const role = url.searchParams.get('role');
  if (!Object.hasOwn(queues, role)) { res.writeHead(400); return res.end(); }
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(queues[role].splice(0)));
  }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100000) { res.writeHead(413); return res.end(); }
  }
  try {
    const message = JSON.parse(body);
    const queue = queues[role === 'sender' ? 'receiver' : 'sender'];
    if (queue.length >= 100) queue.shift();
    queue.push(message);
    res.writeHead(204); res.end();
  } catch { res.writeHead(400); res.end(); }
});
server.listen(43119, '127.0.0.1', () => {
  console.log(`Meld source: http://127.0.0.1:43119/#${token}`);
  console.log('Paste this same URL into Foundry Tactical Stream sender setup. Keep this helper running.');
});
