import { Worker } from 'node:worker_threads';

export type WorkerExit = { code: number | null; signal: string | null; error?: string; fault?: 'launch-thread' };
export type WorkerReady = { pid: number; instance: string };
export type OwnedWorkerProcess = { result: Promise<WorkerExit>; stop: () => Promise<void> };

// Windows process creation can block synchronously. Keep that operation, its
// IPC and its actual ChildProcess in another event loop so the authenticated
// supervisor lease continues answering status/stop during creation.
export function startWorkerProcess(options: { node: string; cli: string; state: string; supervisorInstance: string },
  ready: (worker: WorkerReady) => void): OwnedWorkerProcess {
  const thread = new Worker(new URL('./worker-process-thread.js', import.meta.url), {
    workerData: options, env: { ...process.env, SKYNET_KEY: undefined },
  });
  let outcome: WorkerExit | undefined; let stopped = false; let ended = false;
  const result = new Promise<WorkerExit>(resolve => {
    thread.on('message', message => {
      if (message?.type === 'ready' && !stopped && Number.isInteger(message.pid) && typeof message.instance === 'string') {
        ready({ pid: message.pid, instance: message.instance });
      }
      if (message?.type === 'result') outcome = message.result;
    });
    thread.once('error', () => { outcome = { code: null, signal: null, fault: 'launch-thread', error: 'Worker launch thread failed; registered paths and state retained' }; });
    // A normal result follows child exit. A thread fault only proves the
    // thread ended: the supervisor must reconcile the authenticated worker
    // lease while that child handles IPC disconnection and asynchronous drain.
    thread.once('exit', () => { ended = true; resolve(outcome ?? { code: null, signal: null, fault: 'launch-thread', error: 'Worker launch thread exited without a result; state retained' }); });
  });
  return { result, stop: async () => {
    if (!stopped) { stopped = true; if (!ended) thread.postMessage({ type: 'stop' }); }
    await result;
  } };
}
