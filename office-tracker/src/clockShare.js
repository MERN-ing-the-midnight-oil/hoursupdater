import { CLOCK_RECORD_COLUMNS } from './driverClockRecord.js';

export function driverClockKey(name) {
  return String(name ?? '').trim().toLowerCase();
}

export function clockRecordFilename(name) {
  const slug = driverClockKey(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'driver'}-clock-records.csv`;
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function clockRecordCsv(sheets) {
  const header = CLOCK_RECORD_COLUMNS.map((column) => column.label);
  const lines = [header.join(',')];
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      lines.push(CLOCK_RECORD_COLUMNS.map((column) => csvCell(row[column.key])).join(','));
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

// Plain-text copy for an email body. Days with no clocks are left out.
export function clockRecordMessage(driverName, sheets) {
  const lines = [`Clock records for ${String(driverName || 'driver').trim() || 'driver'}`, ''];
  for (const sheet of sheets) {
    lines.push(sheet.label);
    let any = false;
    for (const row of sheet.rows) {
      const parts = [];
      for (const column of CLOCK_RECORD_COLUMNS) {
        if (column.text) continue;
        const value = String(row[column.key] || '').replace(/\s*\n\s*/g, ', ');
        if (value) parts.push(`${column.label} ${value}`);
      }
      if (!parts.length) continue;
      any = true;
      lines.push(`${row.dateLabel} ${row.weekday}: ${parts.join('; ')}`);
    }
    if (!any) lines.push('No clocks in this period.');
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

export function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}

// Where a phone should open the clock page. A kiosk on localhost is not
// reachable from a phone, so that case uses an address on this network.
export function clockShareOrigin({ protocol = 'http', host = '', port = 3849, addresses = [] } = {}) {
  const bare = String(host ?? '').trim();
  const hostname = bare.startsWith('[')
    ? bare.slice(1, bare.indexOf(']') === -1 ? undefined : bare.indexOf(']'))
    : bare.split(':')[0];
  const local =
    !hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  if (!local) {
    const scheme = protocol === 'https' ? 'https' : 'http';
    return `${scheme}://${bare}`;
  }
  const ip = addresses.find((item) => String(item || '').trim());
  if (!ip) return '';
  return `http://${ip}:${port}`;
}

// Origin a phone can open. The published site is its own address. A kiosk on
// this computer is not, because a phone cannot reach localhost.
export function pageShareOrigin(origin) {
  const base = String(origin || '').trim().replace(/\/$/, '');
  let url;
  try {
    url = new URL(base);
  } catch {
    return '';
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') return '';
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  return base;
}

export function clockShareUrl(origin, token) {
  const base = String(origin || '').replace(/\/$/, '');
  const link = String(token || '').trim();
  if (!base || !link) return '';
  return `${base}/driver-clock.html?t=${encodeURIComponent(link)}`;
}
