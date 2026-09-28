import { createRequire } from 'node:module';
import { stripVTControlCharacters } from 'node:util';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import assert from 'node:assert/strict';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const { runtime, ptyRoot, alpha, sourceHome, directory, env, allHooks, probePrompt } = JSON.parse(input);
const sandbox = { directory };
const envFor = (_home: string) => env;
const pty = createRequire(join(ptyRoot, 'package.json'))('node-pty');
  async function reviewHook() {
    const child = pty.spawn(runtime, ['--no-daemon', '--no-alt-screen'], { cwd: alpha, env: envFor(sourceHome), name: 'xterm-256color', cols: 180, rows: 42 });
    let terminal = ''; let exit: number | undefined;
    const controls: { keys: string; reason: string }[] = [];
    child.onData((data: string) => { terminal += data; if (data.includes('\x1b[6n')) child.write('\x1b[1;1R'); });
    child.onExit(({ exitCode }: { exitCode: number }) => { exit = exitCode; });
    const plain = () => stripVTControlCharacters(terminal);
    const send = (keys: string, reason: string) => { controls.push({ keys, reason }); child.write(keys); };
    async function waitFor(pattern: RegExp, after = 0) {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (pattern.test(plain().slice(after))) return;
        if (exit !== undefined) throw new Error(`CLI exited during normal review: ${exit}`);
        await setTimeout(100);
      }
      throw new Error(`Normal hook review screen missing: ${pattern}. See ${sandbox.directory}/hook-review.txt`);
    }
    try {
      await waitFor(/Trust this folder\?/); send('\r', 'Trust only the generated synthetic project directory');
      await waitFor(/Hooks need review/); send('\r', 'Open individual hook review');
      await setTimeout(800);
      if (plain().slice(-10000).includes('Set up the Codex agent sandbox')) send('\x1b', 'Return without changing machine sandbox setup');
      await waitFor(/t trust all.*enter review/s); await setTimeout(300);
      send('\r', 'Inspect the UserPromptSubmit hook details');
      await waitFor(allHooks ? /hooks/ : /UserPromptSubmit hooks/);
      await waitFor(allHooks ? /skynet-launcher\.mjs/ : /cli\.js/); await waitFor(/--state/); await waitFor(/t trust · esc back/);
      if (allHooks) { send('\x1b', 'Return to the event list after reviewing the shared exact installed command'); await setTimeout(400); await waitFor(/t trust all.*enter review/s); }
      const beforeTrust = plain().length;
      send('t', allHooks ? 'Trust all displayed event definitions using the same reviewed installed command via normal host action' : 'Trust the displayed exact product collector command via normal host action');
      await waitFor(allHooks ? /PreToolUse\s+1\s+1/ : /Trusted/, beforeTrust);
      await setTimeout(400);
      for (let attempt = 0; attempt < 5; attempt++) {
        send('\x1b', 'Return through normal review panels to the prompt'); await setTimeout(500);
      }
      if (probePrompt) {
        const beforePrompt = plain().length;
        send(probePrompt, 'Run the isolated loopback-provider conversation through the normal interactive CLI'); await setTimeout(300);
        send('\r', 'Submit the synthetic interactive prompt');
        await waitFor(/Synthetic CLI source or continuation completed/, beforePrompt);
      }
      send('/quit', 'Enter the normal quit command'); await setTimeout(400);
      send('\r', 'Submit the normal quit command'); await setTimeout(800);
      if (exit === undefined) send('\r', 'Submit the normal quit action');
      for (let attempt = 0; attempt < 100 && exit === undefined; attempt++) await setTimeout(100);
      assert.equal(exit, 0, 'normal review session exits successfully');
    } finally {
      if (exit === undefined) child.kill();
      await writeFile(join(sandbox.directory, 'hook-review.txt'), plain());
      await writeFile(join(sandbox.directory, 'hook-review-controls.json'), JSON.stringify(controls, null, 2));
    }
  }
try { await reviewHook(); process.exit(0); } catch(error) { console.error(error); process.exit(1); }
