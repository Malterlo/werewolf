import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import 'dotenv/config';

const userLocalBin = path.join(os.homedir(), '.local', 'bin');
if (!process.env.PATH?.includes(userLocalBin)) {
  process.env.PATH = `${userLocalBin}:${process.env.PATH || ''}`;
}

function findCloudflared() {
  const localBin = path.join(userLocalBin, 'cloudflared');
  if (fs.existsSync(localBin)) return localBin;
  return 'cloudflared';
}

const PORT = +process.env.PORT || 8080;
const portArgIndex = process.argv.indexOf('--port');
const targetPort = portArgIndex !== -1 && process.argv[portArgIndex + 1]
  ? +process.argv[portArgIndex + 1]
  : PORT;

async function isBackendRunning(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

let backendProc = null;
let tunnelProc = null;

function cleanup() {
  try { if (fs.existsSync('.tunnel.json')) fs.unlinkSync('.tunnel.json'); } catch {}
  try { if (fs.existsSync('frontend/tunnel.json')) fs.unlinkSync('frontend/tunnel.json'); } catch {}
  if (tunnelProc && !tunnelProc.killed) {
    tunnelProc.kill('SIGTERM');
    tunnelProc = null;
  }
  if (backendProc && !backendProc.killed) {
    backendProc.kill('SIGTERM');
    backendProc = null;
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
process.on('exit', cleanup);

function onTunnelReady(url, port) {
  const wssUrl = url.replace(/^https:/, 'wss:');
  const ghPagesUrl = `https://malterlo.github.io/werewolf/?server=${encodeURIComponent(wssUrl)}`;
  const localFrontendUrl = `http://localhost:3000/?server=${encodeURIComponent(wssUrl)}`;

  const info = {
    tunnelUrl: url,
    wssUrl,
    ghPagesUrl,
    localFrontendUrl,
    connectedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync('.tunnel.json', JSON.stringify(info, null, 2));
    const frontendDir = path.resolve('frontend');
    if (fs.existsSync(frontendDir)) {
      fs.writeFileSync(path.join(frontendDir, 'tunnel.json'), JSON.stringify(info, null, 2));
    }
  } catch (err) {
    console.error('Warning: could not write tunnel.json:', err.message);
  }

  console.log('\n' + '='.repeat(76));
  console.log('  🌩️   Cloudflare Quick Tunnel Connected for WSS Backend!');
  console.log('='.repeat(76));
  console.log(`  Backend WSS:     ${wssUrl}`);
  console.log(`  Backend HTTPS:   ${url}`);
  console.log(`  Local Service:   http://127.0.0.1:${port}`);
  console.log('-'.repeat(76));
  console.log('  🎮  Frontend Access Links:');
  console.log(`  1. Web App Direct:`);
  console.log(`     ${url}`);
  console.log(`  2. GitHub Pages (connected to this tunnel):`);
  console.log(`     ${ghPagesUrl}`);
  console.log(`  3. Local Frontend (connected to this tunnel):`);
  console.log(`     ${localFrontendUrl}`);
  console.log('='.repeat(76));
  console.log('  Press Ctrl+C anytime to close the tunnel.\n');
}

async function main() {
  const alreadyRunning = await isBackendRunning(targetPort);
  if (alreadyRunning) {
    console.log(`✓ Backend server detected and responding on http://127.0.0.1:${targetPort}`);
  } else {
    const isDev = process.argv.includes('--dev');
    console.log(`Starting backend server on port ${targetPort}${isDev ? ' (dev mode)' : ''}...`);
    const cmd = isDev ? 'npx' : 'node';
    const args = isDev ? ['nodemon', 'backend/server.js'] : ['backend/server.js'];
    backendProc = spawn(cmd, args, {
      env: { ...process.env, PORT: String(targetPort) },
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    backendProc.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
    backendProc.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`));

    // Wait for backend to be ready
    let ready = false;
    for (let i = 0; i < 40; i++) {
      if (await isBackendRunning(targetPort)) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!ready) {
      console.error(`Backend did not start on port ${targetPort} within 10s.`);
      process.exit(1);
    }
    console.log(`✓ Backend is ready on http://127.0.0.1:${targetPort}`);
  }

  const cloudflaredBin = findCloudflared();
  console.log(`Connecting Cloudflare quick tunnel to http://127.0.0.1:${targetPort}...`);

  const tunnelArgs = ['tunnel', '--url', `http://127.0.0.1:${targetPort}`];
  tunnelProc = spawn(cloudflaredBin, tunnelArgs, {
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  const urlRegex = /https:\/\/([a-zA-Z0-9-]+\.trycloudflare\.com)/;
  let tunnelDetected = false;

  const handleOutput = (chunk) => {
    const text = chunk.toString();
    if (!tunnelDetected) {
      const match = text.match(urlRegex);
      if (match) {
        tunnelDetected = true;
        onTunnelReady(match[0], targetPort);
      }
    }
  };

  tunnelProc.stdout.on('data', handleOutput);
  tunnelProc.stderr.on('data', handleOutput);

  tunnelProc.on('error', (err) => {
    console.error('Failed to start cloudflared:', err.message);
    console.error('Please ensure cloudflared is installed or available in ~/.local/bin/cloudflared');
    cleanup();
    process.exit(1);
  });

  tunnelProc.on('exit', (code, sig) => {
    if (code !== 0 && code !== null) {
      console.log(`Cloudflare tunnel exited with code ${code}`);
    }
    cleanup();
  });
}

main().catch((err) => {
  console.error('Tunnel launcher error:', err);
  cleanup();
  process.exit(1);
});
