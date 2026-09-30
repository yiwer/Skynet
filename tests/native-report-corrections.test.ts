import test from 'node:test';
import {reportCorrectionsPublic} from './report-corrections-public.js';
test('native Claude corrected report workflow uses bounded fresh analysis, loopback only',{timeout:240000},()=>reportCorrectionsPublic(true));
