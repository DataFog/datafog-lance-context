import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = process.env.API_PORT || '8134';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  console.error('API_PORT must be a valid TCP port.');
  process.exit(1);
}
const localDatabase = process.env.GENEVA_DATABASE_URI ? null : mkdtempSync(join(tmpdir(), 'datafog-geneva-'));
const environment = {...process.env, GENEVA_DATABASE_URI: process.env.GENEVA_DATABASE_URI || localDatabase, VITE_API_PROXY: `http://127.0.0.1:${port}`};
const children = [
  spawn('uv', ['run', '--frozen', '--python', '3.12', 'uvicorn', 'datafog_lance_context.api:app', '--host', '127.0.0.1', '--port', port, '--no-access-log'], {cwd: root, env: environment, stdio: 'inherit'}),
  spawn('npm', ['--prefix', 'ui', 'run', 'dev', '--', '--host', '127.0.0.1'], {cwd: root, env: environment, stdio: 'inherit'}),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  if (localDatabase) rmSync(localDatabase, {recursive: true, force: true});
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
for (const child of children) {
  child.on('error', error => {console.error(error.message); stop(1);});
  child.on('exit', code => {if (!stopping) stop(code || 0);});
}
