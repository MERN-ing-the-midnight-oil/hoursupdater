const SEGMENT_LABELS = {
  AM: 'AM',
  MIDDAY: 'Midday',
  PM: 'PM',
};

// A starting schedule stores the same time on both sides. Those rows are not changes.
function isClockChange(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const previous = String(entry.previous_time ?? '').trim();
  const next = String(entry.new_time ?? '').trim();
  return Boolean(previous && next && previous !== next);
}

function recordedBy(entry, routeName) {
  const name = String(entry?.entered_by ?? '').trim();
  if (!name || name === routeName) return '';
  return name;
}

// Clock-time changes across every route, newest save first.
export function recentRouteChanges(state) {
  const profiles =
    state?.profiles && typeof state.profiles === 'object' ? Object.values(state.profiles) : [];
  const items = [];
  for (const profile of profiles) {
    if (!profile || typeof profile !== 'object') continue;
    const routeName = String(profile.name ?? '').trim() || 'Route';
    const routeId = String(profile.id ?? '').trim();
    for (const entry of profile.changeLog ?? []) {
      if (!isClockChange(entry)) continue;
      const enteredBy = recordedBy(entry, routeName);
      const written = String(entry.entered_by ?? '').trim();
      const note = String(entry.note ?? '').trim();
      const segment = String(entry.segment ?? '').trim();
      items.push({
        id: String(entry.id ?? ''),
        routeId,
        routeName,
        segment,
        segmentLabel: SEGMENT_LABELS[segment] || segment || 'Run',
        previousTime: String(entry.previous_time).trim(),
        newTime: String(entry.new_time).trim(),
        effectiveDate: String(entry.effective_date ?? '').trim(),
        submittedAt: String(entry.submitted_at ?? '').trim(),
        enteredBy,
        note: note && note !== written && note !== 'Starting schedule' ? note : '',
      });
    }
  }
  items.sort((a, b) => {
    const byTime = b.submittedAt.localeCompare(a.submittedAt);
    if (byTime !== 0) return byTime;
    return b.id.localeCompare(a.id);
  });
  return items;
}
