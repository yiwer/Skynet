import test from 'node:test';
import { longAnalysisPublic } from './analysis-long-public.js';
test('long archive → bounded extraction/aggregation → original quotes through API, Web, MCP and raw export, with partial ranges', {timeout:90000},()=>longAnalysisPublic(false));
