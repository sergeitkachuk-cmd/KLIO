// Deployment supervisor only. KLIO, Caddy and GOST remain separate processes.
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function configuration(env) {
  const port = Number(env.PORT || env.TELEGRAM_HTTP_PORT || 8081);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [18081, 18082, 18083].includes(port)) throw Error('Invalid public port');
  const password = env.HIRVI_TRANSPORT_PASSWORD || '';
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(password)) throw Error('Missing valid transport credential');
  return {
    caddy: {
      admin: { disabled: true },
      logging: { logs: { default: { level: 'ERROR' } } },
      apps: { http: { servers: { shared: {
        listen: [`:${port}`],
        routes: [
          { match: [{ path: ['/_hirvi/ws'] }], handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '127.0.0.1:18082' }] }], terminal: true },
          { handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '127.0.0.1:18083' }] }] },
        ],
      } } } },
    },
    gost: {
      log: { level: 'warn', output: 'stderr' },
      services: [{
        name: 'hirvi-openai-transport', addr: '127.0.0.1:18082', bypass: 'openai-only',
        handler: { type: 'relay', auth: { username: 'hirvi', password } },
        listener: { type: 'ws', metadata: { path: '/_hirvi/ws' } },
      }],
      bypasses: [{ name: 'openai-only', whitelist: true, matchers: ['auth.openai.com:443', 'chatgpt.com:443', 'api.openai.com:443'] }],
    },
  };
}

export function childEnvironments(env, dir) {
  const klioEnv = { ...env, PORT: '18083', TELEGRAM_HTTP_PORT: '18083' };
  delete klioEnv.HIRVI_TRANSPORT_PASSWORD;
  const isolatedEnv = { PATH: env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: dir, TMPDIR: tmpdir() };
  return { klioEnv, isolatedEnv };
}

export function start() {
  const config = configuration(process.env);
  const original = JSON.parse(readFileSync('/opt/hirvi-transport/original-command.json', 'utf8'));
  if (!Array.isArray(original) || !original.length || original.some(x => typeof x !== 'string')) throw Error('Invalid original startup command');
  const dir = mkdtempSync(join(tmpdir(), 'hirvi-transport-'));
  chmodSync(dir, 0o700);
  for (const [name, value] of Object.entries(config)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(value), { mode: 0o600 });
  const { klioEnv, isolatedEnv } = childEnvironments(process.env, dir);
  const children = [];
  let stopping = false;
  let exitCode = 0;
  let timer;
  const finish = () => {
    if (stopping && children.every(c => c.exitCode !== null || c.signalCode !== null)) {
      clearTimeout(timer);
      process.exit(exitCode);
    }
  };
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    for (const child of children) child.kill('SIGTERM');
    timer = setTimeout(() => {
      for (const child of children) child.kill('SIGKILL');
      process.exit(exitCode);
    }, 20000);
    finish();
  };
  const launch = (name, command, args, env) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'inherit', 'inherit'] });
    children.push(child);
    child.on('error', () => { console.error(`${name} startup failed`); stop(1); });
    child.on('exit', () => { if (!stopping) { console.error(`${name} exited`); stop(1); } finish(); });
  };
  launch('KLIO', original[0], original.slice(1), klioEnv);
  launch('Transport', '/usr/local/bin/gost', ['-C', join(dir, 'gost.json')], { ...isolatedEnv, GOMEMLIMIT: '64MiB' });
  launch('HTTP entry', '/usr/local/bin/caddy', ['run', '--config', join(dir, 'caddy.json')], { ...isolatedEnv, GOMEMLIMIT: '96MiB' });
  process.on('SIGTERM', () => stop());
  process.on('SIGINT', () => stop());
  console.log('Shared KLIO and HIRVI transport supervisor started');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { start(); } catch { console.error('Shared relay configuration failed'); process.exit(1); }
}
