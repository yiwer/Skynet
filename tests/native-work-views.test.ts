import test from 'node:test';
import { workViewsPublic } from './work-views-public.js';
test('native Claude automatically processes weekly/project inputs, synthetic loopback only', { timeout: 180000 }, () => workViewsPublic(true));
