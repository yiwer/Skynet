import test from 'node:test';
import { longAnalysisPublic } from './analysis-long-public.js';
test('real independent installed Claude executes long extraction and aggregation with original citations and failed/skipped ranges', {timeout:240000},()=>longAnalysisPublic(true));
