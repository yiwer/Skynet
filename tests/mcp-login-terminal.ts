import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';
import { join } from 'node:path';

// Test-only normal terminal for a CLI which refuses headless stdin. Never writes credential stores.
const input = createInterface({ input: process.stdin });
let child: any; let terminal = ''; let announced = false;
input.on('line', line => {
  if (child) { child.write(line + '\r'); return; }
  const { runtime, args, env, cwd, ptyRoot } = JSON.parse(line);
  const pty = createRequire(join(ptyRoot, 'package.json'))('node-pty');
  child = pty.spawn(runtime, args, { cwd, env, name: 'xterm-256color', cols: 2000, rows: 40 });
  const timer = setTimeout(() => { child.kill(); process.stderr.write('Normal terminal login timed out\n'); process.exit(1); }, 40_000);
  child.onData((data: string) => {
    terminal += data;
    if (data.includes('\x1b[6n')) child.write('\x1b[1;1R');
    const match = /https:\/\/127\.0\.0\.1:\d+\/oauth\/authorize\?[^\s]+/.exec(stripVTControlCharacters(terminal));
    // This CLI paints "Waiting…" immediately after the URL without a printable separator.
    // Its resource parameter is last; retain the exact URL through that measured field.
    if (match && !announced) {
      const url = match[0].replace(/(resource=https%3A%2F%2F127\.0\.0\.1%3A\d+%2Fmcp).*$/i, '$1');
      announced = true; process.stdout.write(url + '\n');
    }
  });
  child.onExit(({ exitCode }: { exitCode: number }) => {
    clearTimeout(timer);
    if (exitCode !== 0) process.stderr.write(stripVTControlCharacters(terminal).replace(/https?:\/\/[^\s]+/g, value => value.split('?')[0]!) + '\n');
    process.exit(exitCode);
  });
});
