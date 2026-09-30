import test from 'node:test';
import {reportCorrectionsPublic} from './report-corrections-public.js';
test('public authenticated corrections reclassify unknown project, propagate day/week/project and fence old analysis',{timeout:240000},()=>reportCorrectionsPublic(false));
