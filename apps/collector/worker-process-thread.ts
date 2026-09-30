import { spawn, type ChildProcess } from 'node:child_process';
import { parentPort, workerData } from 'node:worker_threads';
import type { WorkerExit } from './worker-process.js';

if (!parentPort) throw new Error('Worker launch entry requires its owning thread');
const port = parentPort;
const options = workerData as { node: string; cli: string; state: string; supervisorInstance: string };
let child: ChildProcess | undefined; let stopping = false; let initialized = false; let finished = false;
let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
let diagnostic = '';
function send(message: object) {
  if (child?.connected) child.send(message, () => undefined);
}
function stop() {
  stopping = true;
  // Complete the normal start handshake before stop, including when the stop
  // arrived while spawn was blocked and the child did not exist yet.
  if (initialized) send({ type: 'stop' });
  if (child && !finished && !timer) {
    const owned = child;
    // Only the ChildProcess created here is authority for this fallback.
    timer = globalThis.setTimeout(() => owned.kill(), 10_000);
  }
}
function finish(result: WorkerExit) {
  if (finished) return;
  finished = true; clearTimeout(timer);
  port.postMessage({ type: 'result', result }); port.close();
}
port.on('message', message => { if (message?.type === 'stop') stop(); });
port.once('close', () => { if (!finished) stop(); });
try {
  child = spawn(options.node, [options.cli, 'background-worker', '--state', options.state], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, SKYNET_KEY: undefined },
  });
  child.stderr?.on('data', part => { diagnostic = (diagnostic + part).slice(-4096); });
  child.once('error', () => finish({ code: null, signal: null, error: 'Worker process could not be started; verify the registered Node/runtime paths' }));
  child.once('exit', (code, signal) => finish({ code, signal, ...(code ? { error: diagnostic } : {}) }));
  child.on('message', message => {
    if (typeof message !== 'object' || message === null) return;
    if ((message as any).type === 'initializing' && !initialized) {
      initialized = true; send({ type: 'start', supervisorInstance: options.supervisorInstance });
      if (stopping) send({ type: 'stop' });
    }
    if ((message as any).type === 'ready' && !stopping) port.postMessage({ type: 'ready', pid: child!.pid, instance: (message as any).instance });
  });
  if (stopping) stop();
} catch {
  finish({ code: null, signal: null, error: 'Worker process could not be started; verify the registered Node/runtime paths' });
}
