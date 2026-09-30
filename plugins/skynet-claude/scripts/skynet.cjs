#!/usr/bin/env node
if (Number(process.versions.node.split('.')[0]) !== 24) {
  console.error('Skynet requires Node 24. Install it, then rerun this command in a local terminal. No binding or capture has occurred.');
  process.exitCode = 1;
} else {
  import(require('node:url').pathToFileURL(require('node:path').join(__dirname, '..', 'payload', 'dist', 'apps', 'collector', 'cli.js')).href)
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
