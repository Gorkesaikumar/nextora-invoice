/**
 * Reusable date presets and comparison period calculations for frontend views.
 * Adheres strictly to Indian Financial Year conventions (April 1 to March 31).
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
  let label = '';

  switch (presetKey) {
    case 'today': {
      const todayStr = toIsoDate(now);
      fromDate = todayStr;
      toDate = todayStr;
      label = 'Today';
      break;
    }

    case 'yesterday': {
      const yDate = addDays(now, -1);
      const yStr = toIsoDate(yDate);
      fromDate = yStr;
      toDate = yStr;
      label = 'Yesterday';
      break;
    }

    case 'this_week': {
      const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
      const monday = addDays(now, -(dayOfWeek - 1));
      fromDate = toIsoDate(monday);
      toDate = toIsoDate(now);
      label = 'This week';
      break;
    }

    case 'last_week': {
      const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
      const lastMonday = addDays(now, -(dayOfWeek - 1 + 7));
      const lastSunday = addDays(lastMonday, 6);
      fromDate = toIsoDate(lastMonday);
      toDate = toIsoDate(lastSunday);
      label = 'Last week';
      break;
    }

    case 'this_month': {
      fromDate = `${year}-${pad(month)}-01`;
      toDate = toIsoDate(now);
      label = 'This month';
      break;
    }

    case 'last_month': {
      const priorMonth = month === 1 ? 12 : month - 1;
      const priorYear = month === 1 ? year - 1 : year;
      const daysInMonth = new Date(priorYear, priorMonth, 0).getDate();
      fromDate = `${priorYear}-${pad(priorMonth)}-01`;
      toDate = `${priorYear}-${pad(priorMonth)}-${pad(daysInMonth)}`;
      label = 'Last month';
      break;
    }

    case 'last_7_days': {
      fromDate = toIsoDate(addDays(now, -6));
      toDate = toIsoDate(now);
      label = 'Last 7 days';
      break;
    }

    case 'last_30_days': {
      fromDate = toIsoDate(addDays(now, -29));
      toDate = toIsoDate(now);
      label = 'Last 30 days';
      break;
    }

    case 'this_quarter': {
      let qNum;
      let qStartM;
      let qYear = year;
      if (month >= 4 && month <= 6) { qNum = 1; qStartM = 4; }
      else if (month >= 7 && month <= 9) { qNum = 2; qStartM = 7; }
      else if (month >= 10 && month <= 12) { qNum = 3; qStartM = 10; }
      else { qNum = 4; qStartM = 1; }

      fromDate = `${qYear}-${pad(qStartM)}-01`;
      toDate = toIsoDate(now);
      label = `This quarter (Q${qNum})`;
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
      label = `Last quarter (Q${qNum})`;
      break;
    }

    case 'this_fy': {
      const fyStartYear = month >= 4 ? year : year - 1;
      fromDate = `${fyStartYear}-04-01`;
      toDate = toIsoDate(now);
      label = `Current financial year (${fyStartYear}-${String(fyStartYear + 1).slice(-2)})`;
      break;
    }

    case 'last_fy': {
      const fyStartYear = month >= 4 ? year - 1 : year - 2;
      fromDate = `${fyStartYear}-04-01`;
      toDate = `${fyStartYear + 1}-03-31`;
      label = `Previous financial year (${fyStartYear}-${String(fyStartYear + 1).slice(-2)})`;
      break;
    }

    case 'all_time': {
      fromDate = '';
      toDate = '';
      label = 'All available dates';
      break;
    }

    case 'custom':
    default: {
      fromDate = customFrom || '';
      toDate = customTo || '';
      label = fromDate && toDate ? `Custom (${fromDate} to ${toDate})` : 'Custom date range';
      break;
    }
  }

  return {
    preset: presetKey,
    from: fromDate,
    to: toDate,
    label,
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
