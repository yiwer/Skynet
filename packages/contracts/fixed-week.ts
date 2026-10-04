import {reportDate} from './reports.js';
/** A calendar-week anchor is only accepted by fixed report readers or the
 * existing weekly-work materialization route, never a generic live range. */
export const fixedWeek=reportDate.refine(value=>new Date(value+'T00:00:00Z').getUTCDay()===1,'周起始日期必须为周一');
