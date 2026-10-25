/**
 * Reusable date presets and comparison period calculations.
 * Adheres strictly to Indian Financial Year conventions:
 * - Financial Year runs April 1 to March 31.
 * - Q1: Apr 1 - Jun 30
 * - Q2: Jul 1 - Sep 30
 * - Q3: Oct 1 - Dec 31
 * - Q4: Jan 1 - Mar 31
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

export function toIsoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseIsoDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function addDays(d, n) {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

export function resolveDatePreset(presetKey, { baseDate = new Date(), customFrom = '', customTo = '' } = {}) {
  const now = new Date(baseDate);
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1 - 12
  const day = now.getDate();

  let fromDate = null;
  let toDate = null;
  let priorFrom = null;
  let priorTo = null;
  let label = '';
  let priorLabel = '';

  switch (presetKey) {
    case 'today': {
      const todayStr = toIsoDate(now);
      fromDate = todayStr;
      toDate = todayStr;
      const yesterday = addDays(now, -1);
      const yesterdayStr = toIsoDate(yesterday);
      priorFrom = yesterdayStr;
      priorTo = yesterdayStr;
      label = 'Today';
      priorLabel = 'Yesterday';
      break;
    }

    case 'yesterday': {
      const yDate = addDays(now, -1);
      const yStr = toIsoDate(yDate);
      fromDate = yStr;
      toDate = yStr;
      const dayBefore = addDays(now, -2);
      const dbStr = toIsoDate(dayBefore);
      priorFrom = dbStr;
      priorTo = dbStr;
      label = 'Yesterday';
      priorLabel = 'Day before yesterday';
      break;
    }

    case 'this_week': {
      // Monday as day 1
      const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
      const monday = addDays(now, -(dayOfWeek - 1));
      fromDate = toIsoDate(monday);
      toDate = toIsoDate(now);
      const priorMonday = addDays(monday, -7);
      const priorSameDay = addDays(priorMonday, dayOfWeek - 1);
      priorFrom = toIsoDate(priorMonday);
      priorTo = toIsoDate(priorSameDay);
      label = 'This week';
      priorLabel = 'Same period last week';
      break;
    }

    case 'last_week': {
      const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
      const lastMonday = addDays(now, -(dayOfWeek - 1 + 7));
      const lastSunday = addDays(lastMonday, 6);
      fromDate = toIsoDate(lastMonday);
      toDate = toIsoDate(lastSunday);
      const priorMonday = addDays(lastMonday, -7);
      const priorSunday = addDays(lastSunday, -7);
      priorFrom = toIsoDate(priorMonday);
      priorTo = toIsoDate(priorSunday);
      label = 'Last week';
      priorLabel = 'Week before last';
      break;
    }

    case 'this_month': {
      fromDate = `${year}-${pad(month)}-01`;
      toDate = toIsoDate(now);
      const priorMonth = month === 1 ? 12 : month - 1;
      const priorYear = month === 1 ? year - 1 : year;
      const daysInPrior = new Date(priorYear, priorMonth, 0).getDate();
      const priorDay = Math.min(day, daysInPrior);
      priorFrom = `${priorYear}-${pad(priorMonth)}-01`;
      priorTo = `${priorYear}-${pad(priorMonth)}-${pad(priorDay)}`;
      label = 'This month';
      priorLabel = 'Same period last month';
      break;
    }

    case 'last_month': {
      const priorMonth = month === 1 ? 12 : month - 1;
      const priorYear = month === 1 ? year - 1 : year;
      const daysInMonth = new Date(priorYear, priorMonth, 0).getDate();
      fromDate = `${priorYear}-${pad(priorMonth)}-01`;
      toDate = `${priorYear}-${pad(priorMonth)}-${pad(daysInMonth)}`;

      const monthBefore = priorMonth === 1 ? 12 : priorMonth - 1;
      const yearBefore = priorMonth === 1 ? priorYear - 1 : priorYear;
      const daysInMonthBefore = new Date(yearBefore, monthBefore, 0).getDate();
      priorFrom = `${yearBefore}-${pad(monthBefore)}-01`;
      priorTo = `${yearBefore}-${pad(monthBefore)}-${pad(daysInMonthBefore)}`;
      label = 'Last month';
      priorLabel = 'Month before last';
      break;
    }

    case 'last_7_days': {
      fromDate = toIsoDate(addDays(now, -6));
      toDate = toIsoDate(now);
      priorFrom = toIsoDate(addDays(now, -13));
      priorTo = toIsoDate(addDays(now, -7));
      label = 'Last 7 days';
      priorLabel = 'Preceding 7 days';
      break;
    }

    case 'last_30_days': {
      fromDate = toIsoDate(addDays(now, -29));
      toDate = toIsoDate(now);
      priorFrom = toIsoDate(addDays(now, -59));
      priorTo = toIsoDate(addDays(now, -30));
      label = 'Last 30 days';
      priorLabel = 'Preceding 30 days';
      break;
    }

    case 'last_90_days': {
      fromDate = toIsoDate(addDays(now, -89));
      toDate = toIsoDate(now);
      priorFrom = toIsoDate(addDays(now, -179));
      priorTo = toIsoDate(addDays(now, -90));
      label = 'Last 90 days';
      priorLabel = 'Preceding 90 days';
      break;
    }

    case 'this_quarter': {
      // Indian FY quarters: Q1(4-6), Q2(7-9), Q3(10-12), Q4(1-3)
      let qNum;
      let qStartM;
      let qEndM;
      let qYear = year;
      if (month >= 4 && month <= 6) { qNum = 1; qStartM = 4; qEndM = 6; }
      else if (month >= 7 && month <= 9) { qNum = 2; qStartM = 7; qEndM = 9; }
      else if (month >= 10 && month <= 12) { qNum = 3; qStartM = 10; qEndM = 12; }
      else { qNum = 4; qStartM = 1; qEndM = 3; }

      const lastDayOfQ = new Date(qYear, qEndM, 0).getDate();
      fromDate = `${qYear}-${pad(qStartM)}-01`;
      toDate = toIsoDate(now);

      // Prior quarter
      let pStartM;
      let pEndM;
      let pYear = qYear;
      if (qNum === 1) { pStartM = 1; pEndM = 3; } // Jan-Mar of same calendar year
      else if (qNum === 2) { pStartM = 4; pEndM = 6; }
      else if (qNum === 3) { pStartM = 7; pEndM = 9; }
      else { pStartM = 10; pEndM = 12; pYear = qYear - 1; }

      const daysInP = new Date(pYear, pEndM, 0).getDate();
      priorFrom = `${pYear}-${pad(pStartM)}-01`;
      priorTo = `${pYear}-${pad(pEndM)}-${pad(daysInP)}`;
      label = `This quarter (Q${qNum})`;
      priorLabel = 'Previous quarter';
      break;
    }

    case 'last_quarter': {
      let qNum;
      let pStartM;
      let pEndM;
      let pYear = year;
      if (month >= 4 && month <= 6) { qNum = 4; pStartM = 1; pEndM = 3; }
      else if (month >= 7 && month <= 9) { qNum = 1; pStartM = 4; pEndM = 6; }
      else if (month >= 10 && month <= 12) { qNum = 2; pStartM = 7; pEndM = 9; }
      else { qNum = 3; pStartM = 10; pEndM = 12; pYear = year - 1; }

      const daysInP = new Date(pYear, pEndM, 0).getDate();
      fromDate = `${pYear}-${pad(pStartM)}-01`;
      toDate = `${pYear}-${pad(pEndM)}-${pad(daysInP)}`;

      // Quarter before that
      let bbStartM;
      let bbEndM;
      let bbYear = pYear;
      if (qNum === 1) { bbStartM = 1; bbEndM = 3; }
      else if (qNum === 2) { bbStartM = 4; bbEndM = 6; }
      else if (qNum === 3) { bbStartM = 7; bbEndM = 9; }
      else { bbStartM = 10; bbEndM = 12; bbYear = pYear - 1; }

      const daysInBB = new Date(bbYear, bbEndM, 0).getDate();
      priorFrom = `${bbYear}-${pad(bbStartM)}-01`;
      priorTo = `${bbYear}-${pad(bbEndM)}-${pad(daysInBB)}`;
      label = `Last quarter (Q${qNum})`;
      priorLabel = 'Quarter before last';
      break;
    }

    case 'this_fy': {
      const fyStartYear = month >= 4 ? year : year - 1;
      fromDate = `${fyStartYear}-04-01`;
      toDate = toIsoDate(now);
      const priorFyStartYear = fyStartYear - 1;
      priorFrom = `${priorFyStartYear}-04-01`;
      // Same day in prior FY
      const priorEndDay = new Date(year - 1, now.getMonth(), now.getDate());
      priorTo = toIsoDate(priorEndDay);
      label = `Current financial year (${fyStartYear}-${String(fyStartYear + 1).slice(-2)})`;
      priorLabel = `Previous financial year (${priorFyStartYear}-${String(fyStartYear).slice(-2)})`;
      break;
    }

    case 'last_fy': {
      const fyStartYear = month >= 4 ? year - 1 : year - 2;
      fromDate = `${fyStartYear}-04-01`;
      toDate = `${fyStartYear + 1}-03-31`;
      const priorFyStartYear = fyStartYear - 1;
      priorFrom = `${priorFyStartYear}-04-01`;
      priorTo = `${fyStartYear}-03-31`;
      label = `Previous financial year (${fyStartYear}-${String(fyStartYear + 1).slice(-2)})`;
      priorLabel = `Financial year (${priorFyStartYear}-${String(fyStartYear).slice(-2)})`;
      break;
    }

    case 'all_time': {
      fromDate = null;
      toDate = null;
      priorFrom = null;
      priorTo = null;
      label = 'All available dates';
      priorLabel = 'No comparison';
      break;
    }

    case 'custom':
    default: {
      fromDate = customFrom || null;
      toDate = customTo || null;
      if (fromDate && toDate) {
        const d1 = parseIsoDate(fromDate);
        const d2 = parseIsoDate(toDate);
        if (d1 && d2 && d2 >= d1) {
          const diffMs = d2.getTime() - d1.getTime();
          const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
          const p2 = addDays(d1, -1);
          const p1 = addDays(p2, -(diffDays - 1));
          priorFrom = toIsoDate(p1);
          priorTo = toIsoDate(p2);
          label = `Custom range (${fromDate} to ${toDate})`;
          priorLabel = `Preceding ${diffDays} days (${priorFrom} to ${priorTo})`;
        } else {
          label = 'Custom date range';
          priorLabel = 'No comparison';
        }
      } else {
        label = 'All available dates';
        priorLabel = 'No comparison';
      }
      break;
    }
  }

  return {
    preset: presetKey,
    from: fromDate,
    to: toDate,
    label,
    prior: {
      from: priorFrom,
      to: priorTo,
      label: priorLabel,
    },
  };
}

export const DATE_PRESETS = [
  { key: 'this_fy', label: 'Current financial year' },
  { key: 'last_fy', label: 'Previous financial year' },
  { key: 'this_quarter', label: 'This quarter' },
  { key: 'last_quarter', label: 'Last quarter' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_week', label: 'This week' },
  { key: 'last_week', label: 'Last week' },
  { key: 'last_7_days', label: 'Last 7 days' },
  { key: 'last_30_days', label: 'Last 30 days' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'all_time', label: 'All available dates' },
  { key: 'custom', label: 'Custom date range' },
];
