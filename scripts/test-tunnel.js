import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

console.log('Testing Cloudflare quick tunnel for WSS and HTTP...');

const proc = spawn('node', ['scripts/tunnel.js', '--port', '8080'], {
  stdio: ['inherit', 'pipe', 'pipe'],
});

let tunnelUrl = null;
const urlRegex = /https:\/\/([a-zA-Z0-9-]+\.trycloudflare\.com)/;

const timeout = setTimeout(() => {
  proc.kill('SIGTERM');
  console.error('Timed out waiting for quick tunnel.');
  process.exit(1);
}, 25000);

function handleOutput(chunk) {
  const text = chunk.toString();
  process.stdout.write(text);
  if (!tunnelUrl) {
    const match = text.match(urlRegex);
    if (match) {
      tunnelUrl = match[0];
      runTests(tunnelUrl);
    }
  }
}

proc.stdout.on('data', handleOutput);
proc.stderr.on('data', handleOutput);

async function runTests(url) {
  clearTimeout(timeout);
  const wssUrl = url.replace(/^https:/, 'wss:');
  console.log(`\nStarting validation on ${url} and ${wssUrl}...`);

  // Wait 3 seconds for Cloudflare edge routing to settle
  await new Promise((r) => setTimeout(r, 3000));

  // 1. Health check over HTTPS
  let healthOk = false;
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        const body = await res.json();
        assert.equal(body.ok, true);
        healthOk = true;
        console.log('✓ HTTPS /health check passed');
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(healthOk, 'Tunnel HTTPS /health failed to respond');

  // 2. Static frontend check over HTTPS
  const rootRes = await fetch(url);
  assert.equal(rootRes.ok, true);
  const html = await rootRes.text();
  assert.ok(html.includes('Night Table'), 'Direct tunnel HTTP failed to serve Night Table frontend');
  console.log('✓ Direct HTTPS frontend serving passed');

  // 3. WebSocket over WSS check
  let wsConnected = false;
  let receivedMsg = false;

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wssUrl, {
      headers: {
        Origin: 'https://malterlo.github.io',
      },
    });

    const wsTimer = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket connection timed out on ' + wssUrl));
    }, 10000);

    ws.on('open', () => {
      wsConnected = true;
      console.log('✓ WSS connection established with Origin: https://malterlo.github.io');
      ws.send(JSON.stringify({ type: 'noop' }));
      // Also test creating a room over WSS
      ws.send(JSON.stringify({ type: 'create', theme: 'werewolf' }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'joined' || msg.type === 'state') {
        receivedMsg = true;
        console.log(`✓ Received WebSocket message: type=${msg.type}${msg.code ? ` code=${msg.code}` : ''}`);
        clearTimeout(wsTimer);
        ws.close();
        resolve();
      }
    });

    ws.on('error', (err) => {
      clearTimeout(wsTimer);
      reject(err);
    });
  });

  assert.ok(wsConnected, 'WebSocket failed to connect over WSS');
  assert.ok(receivedMsg, 'Failed to receive message over WSS');

  console.log('\n🎉 ALL CLOUDFLARE QUICK TUNNEL TESTS PASSED SUCCESSFULLY!\n');
  proc.kill('SIGTERM');
  process.exit(0);
}
