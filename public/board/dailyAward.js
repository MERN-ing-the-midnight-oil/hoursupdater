/**
 * Who got each daily-work trip.
 * The office seniority number sets the order. The written request sets which
 * trips that driver wants, and in what order. No parentheses means one trip,
 * the first choice that fits. Parentheses means every trip in that group that
 * fits, then the backup group.
 *
 * The utility position is offered the work first, up to 40 contracted hours.
 * A trip then goes to the most senior driver who can finish it with the
 * regular runs and no overtime. If nobody can, it goes to the least overtime,
 * up to one hour. A trip that crosses a regular run stays with that run.
 * A field trip of 3.5 hours or more that leaves town goes by seniority number.
 */

import { formatClock, openDuty, overlappingBars, parseMinutes, regularRouteBars, tripInterval } from './gantt.js';
import { formatDuration, parsePreference } from './preference.js';
import { sheetWeekday } from './sheetFormat.js';
import { sameDateLotsPrompt } from '../shared/contractCitations.js';

const DAY_LIMIT = 8 * 60;
const OT_CAP = 60;
const OUT_OF_TOWN_MINUTES = 3.5 * 60;

/**
 * A field trip of 3.5 hours or more that leaves town goes by seniority even with overtime.
 * @param {{ out_of_town?: boolean, times?: Record<string, string> }} trip
 */
function outOfTownTrip(trip) {
  if (!trip?.out_of_town) return false;
  const interval = tripInterval(trip.times);
  if (!interval) return false;
  return interval.end - interval.start >= OUT_OF_TOWN_MINUTES;
}

/**
 * The utility position, not a short regular route.
 * @param {string} driverId
 * @param {Array<{ driver_id?: string, route_id?: string, segments?: object }>} schedules
 */
function utilityDriver(driverId, schedules) {
  return openDuty((schedules || []).filter((row) => row?.driver_id === driverId))?.kind === 'utility';
}

function rankOf(person) {
  return person?.driver?.seniority_rank ?? 9999;
}

function comparePeople(a, b) {
  if (a.utility !== b.utility) return a.utility ? -1 : 1;
  if (rankOf(a) !== rankOf(b)) return rankOf(a) - rankOf(b);
  return String(a.driver.name || '').localeCompare(String(b.driver.name || ''));
}

function compareClaims(a, b) {
  const aZero = a.fit.ot === 0 ? 0 : 1;
  const bZero = b.fit.ot === 0 ? 0 : 1;
  if (aZero !== bZero) return aZero - bZero;
  if (a.fit.ot !== b.fit.ot) return a.fit.ot - b.fit.ot;
  if (a.person.utility !== b.person.utility) return a.person.utility ? -1 : 1;
  if (rankOf(a.person) !== rankOf(b.person)) return rankOf(a.person) - rankOf(b.person);
  return String(a.person.driver.name || '').localeCompare(String(b.person.driver.name || ''));
}

/**
 * Same hire date, and lots have not given them different tie-break numbers.
 * A missing hire date is not a tie. A recorded lots result is not a tie.
 */
function unresolvedHireTie(a, b) {
  const aDate = a?.driver?.hire_date || null;
  const bDate = b?.driver?.hire_date || null;
  if (!aDate || aDate !== bDate) return false;
  const aTie = a.driver.tie_break ?? null;
  const bTie = b.driver.tie_break ?? null;
  if (aTie != null && bTie != null && aTie !== bTie) return false;
  return true;
}

function lotsPeers(group, best) {
  return group.filter((row) => {
    if (row.person.utility !== best.person.utility) return false;
    if (row.fit.ot !== best.fit.ot) return false;
    return unresolvedHireTie(best.person, row.person);
  });
}

function lotsHoldReason(peers) {
  const names = peers
    .map((row) => cleanToken(row.person.driver.name))
    .filter(Boolean);
  const who =
    names.length > 1
      ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
      : names[0] || 'These drivers';
  const hired = hireWords(peers[0]?.person?.driver?.hire_date);
  const when = hired ? ` on ${hired}` : '';
  return `${sameDateLotsPrompt()} ${who} were hired${when}, and that result is not recorded, so this ticket is not awarded.`;
}

function cleanToken(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function hireWords(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!match) return '';
  const month = MONTH_NAMES[Number(match[2]) - 1];
  if (!month) return '';
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

function driverPhrase(driver) {
  const name = cleanToken(driver?.name) || 'This driver';
  const hired = hireWords(driver?.hire_date);
  if (driver?.seniority_rank == null) return `${name} (no seniority number)`;
  return hired
    ? `${name} (seniority ${driver.seniority_rank}, hired ${hired})`
    : `${name} (seniority ${driver.seniority_rank})`;
}

function weekSentence(person) {
  if (person.utility) {
    return 'This is a utility driver. Extra work is offered here first, up to 40 contracted hours.';
  }
  return `The regular runs are ${formatDuration(person.regular)} that day, counted as ${formatDuration(person.weekly)} for a five-day week.`;
}

function shortTownNote(trip) {
  if (!trip?.out_of_town || outOfTownTrip(trip)) return '';
  const interval = tripInterval(trip.times);
  if (!interval) return '';
  return ` Leaves town is checked, but this trip is ${formatDuration(interval.end - interval.start)}, under 3.5 hours, so the regular rule decides it.`;
}

function routeMinutes(bars) {
  return (bars || []).reduce((sum, bar) => sum + Math.max(0, bar.end - bar.start), 0);
}

/**
 * @param {string} driverId
 * @param {Array<{ driver_id?: string, route_id?: string, segments?: object }>} schedules
 */
function barsFor(driverId, schedules) {
  return regularRouteBars((schedules || []).filter((row) => row?.driver_id === driverId));
}

/**
 * @param {Array<{ driver_id?: string, trip_number?: string, bids?: Array<{ driver_id?: string, preference?: string, signed_at?: string }> }>} dayTrips
 * @param {string} driverId
 */
function requestFor(dayTrips, driverId) {
  const bids = [];
  for (const trip of dayTrips) {
    for (const bid of trip.bids || []) {
      if (bid?.driver_id === driverId) bids.push({ bid, trip });
    }
  }
  bids.sort((a, b) => String(b.bid.signed_at || '').localeCompare(String(a.bid.signed_at || '')));
  const preference = cleanToken(bids[0]?.bid.preference || '');
  const parsed = parsePreference(preference);
  const signed = [];
  for (const row of bids) {
    const token = cleanToken(row.trip.trip_number);
    if (token && !signed.includes(token)) signed.push(token);
  }
  const groups = parsed.groups.length ? parsed.groups : signed.length ? [signed] : [];
  return {
    preference,
    mode: parsed.mode === 'many' ? 'many' : 'one',
    groups,
    signed,
  };
}

/**
 * Awarded weekly work on this date, as busy bars a daily trip has to fit around.
 * @param {Array<Record<string, unknown>>} postings
 * @param {string} date
 */
export function weeklyBusyBars(postings, date) {
  const day = String(date || '');
  const bars = [];
  for (const row of postings || []) {
    if (!row || row.list !== 'weekly' || row.status !== 'awarded') continue;
    if ((row.trip_date || '') !== day) continue;
    const driverId = String(row.awarded_driver_id || '');
    if (!driverId) continue;
    const interval = tripInterval(row.times);
    if (!interval) continue;
    const number = cleanToken(row.trip_number);
    bars.push({
      driver_id: driverId,
      start: interval.start,
      end: interval.end,
      segment: 'WEEKLY',
      label: number ? `Weekly #${number}` : 'Weekly work',
    });
  }
  return bars;
}

/**
 * @param {{
 *   postings?: Array<Record<string, unknown>>,
 *   drivers?: Array<{ driver_id?: string, name?: string, seniority_rank?: number | null }>,
 *   schedules?: Array<{ driver_id?: string, route_id?: string, segments?: object }>,
 *   extraBars?: Array<{ driver_id?: string, start: number, end: number, label?: string, segment?: string }>,
 *   date?: string,
 * }} input
 */
export function planDailyAwards({ postings = [], drivers = [], schedules = [], extraBars = [], date = '' } = {}) {
  const day = String(date || '');
  const dayTrips = (postings || []).filter((row) => {
    if (!row || row.status === 'draft') return false;
    if (row.list === 'roster') return false;
    return (row.trip_date || '') === day;
  });
  const byNumber = new Map();
  for (const trip of dayTrips) {
    const token = cleanToken(trip.trip_number);
    if (token && !byNumber.has(token)) byNumber.set(token, trip);
  }

  const signerIds = [];
  for (const trip of dayTrips) {
    for (const bid of trip.bids || []) {
      const id = String(bid?.driver_id || '');
      if (id && !signerIds.includes(id)) signerIds.push(id);
    }
  }

  const people = signerIds.map((id) => {
    const driver = (drivers || []).find((row) => row.driver_id === id) || {
      driver_id: id,
      name: id,
      seniority_rank: null,
    };
    const request = requestFor(dayTrips, id);
    const bars = barsFor(id, schedules);
    const extra = (extraBars || []).filter((bar) => bar?.driver_id === id && bar.end > bar.start);
    const regular = routeMinutes(bars);
    return {
      driver,
      bars,
      extra,
      extraMinutes: routeMinutes(extra),
      regular,
      weekly: regular * 5,
      utility: utilityDriver(id, schedules),
      ...request,
    };
  });

  people.sort(comparePeople);

  const open = new Set(dayTrips.map((trip) => trip.id));
  const awarded = new Map();
  const driverLines = new Map();
  const tripSteps = new Map();

  function heldIntervals(driverId) {
    const intervals = [];
    for (const [tripId, row] of awarded) {
      if (row.driver.driver_id !== driverId) continue;
      const trip = dayTrips.find((item) => item.id === tripId);
      const interval = trip ? tripInterval(trip.times) : null;
      if (interval) intervals.push({ ...interval, trip_number: trip.trip_number });
    }
    return intervals;
  }

  function heldMinutes(driverId) {
    return heldIntervals(driverId).reduce((sum, interval) => sum + (interval.end - interval.start), 0);
  }

  function daySentence(person, tripMinutes) {
    const held = heldMinutes(person.driver.driver_id);
    const pieces = [`${formatDuration(person.regular)} on the regular runs`];
    const awardedWeek = person.extraMinutes || 0;
    if (awardedWeek) pieces.push(`${formatDuration(awardedWeek)} of weekly work already awarded`);
    if (held) pieces.push(`${formatDuration(held)} of extra work already awarded`);
    pieces.push(`this trip at ${formatDuration(tripMinutes)}`);
    const total = person.regular + awardedWeek + held + tripMinutes;
    return `${driverPhrase(person.driver)} would have ${pieces.join(', ')}. That day would be ${formatDuration(total)}.`;
  }

  function explainFit(person, trip) {
    const interval = tripInterval(trip.times);
    const number = cleanToken(trip.trip_number) || 'This trip';
    const who = driverPhrase(person.driver);
    if (!interval) {
      return {
        ok: false,
        ot: 0,
        reason: `#${number} has no start and end time, so the hours cannot be checked for ${who}.`,
      };
    }
    const hits = overlappingBars(interval, person.bars);
    const town = outOfTownTrip(trip);
    const blocking = town ? hits.filter((bar) => bar.segment !== 'MIDDAY') : hits;
    if (blocking.length) {
      const runs = blocking
        .map((bar) => `${bar.label} ${formatClock(bar.start)}–${formatClock(bar.end)}`)
        .join(', ');
      return {
        ok: false,
        ot: 0,
        reason: `Crosses ${runs}. The regular run stays with ${who}. A trip that crosses a regular run is left with that run, so this ticket is not offered to this driver.${shortTownNote(trip)}`,
      };
    }
    const weeklyHits = overlappingBars(interval, person.extra || []);
    if (weeklyHits.length) {
      const awarded = weeklyHits
        .map((bar) => `${bar.label || 'Weekly work'} ${formatClock(bar.start)}–${formatClock(bar.end)}`)
        .join(', ');
      return {
        ok: false,
        ot: 0,
        reason: `Crosses awarded weekly work ${awarded}. That time is no longer free, so this ticket is not offered to ${who}.${shortTownNote(trip)}`,
      };
    }
    const midday = town ? hits.filter((bar) => bar.segment === 'MIDDAY') : [];
    const clash = heldIntervals(person.driver.driver_id).find(
      (item) => item.start < interval.end && interval.start < item.end
    );
    if (clash) {
      return {
        ok: false,
        ot: 0,
        reason: `Already has #${cleanToken(clash.trip_number)} at ${formatClock(clash.start)}–${formatClock(clash.end)}. ${who} cannot take two trips that overlap.${shortTownNote(trip)}`,
      };
    }
    const tripMinutes = interval.end - interval.start;
    const released = midday.reduce((sum, bar) => sum + Math.max(0, bar.end - bar.start), 0);
    const total = person.regular - released + (person.extraMinutes || 0) + heldMinutes(person.driver.driver_id) + tripMinutes;
    const ot = Math.max(0, total - DAY_LIMIT);
    const hours = daySentence(
      released ? { ...person, regular: Math.max(0, person.regular - released) } : person,
      tripMinutes
    );
    if (town) {
      const middayNote = midday.length
        ? ' The midday run overlaps this trip. That midday comes off the route and is posted on the daily board. The driver still finishes the other runs after the trip.'
        : '';
      const overtime =
        ot > 0
          ? `This would be ${formatDuration(ot)} of overtime.`
          : 'This finishes with the regular runs and no overtime.';
      return {
        ok: true,
        ot,
        reason: `${overtime} ${hours}${middayNote} The trip leaves town and is ${formatDuration(tripMinutes)}, at least 3.5 hours, so seniority decides it even with overtime.`,
      };
    }
    if (ot > OT_CAP) {
      return {
        ok: false,
        ot,
        reason: `This would be ${formatDuration(ot)} of overtime, past the one-hour limit. ${hours} Extra work is not awarded once overtime passes one hour.${shortTownNote(trip)}`,
      };
    }
    if (ot > 0) {
      return {
        ok: true,
        ot,
        reason: `Fits with the regular runs and ${formatDuration(ot)} of overtime. ${hours} That is ${formatDuration(ot)} past 8 hours, still within the one-hour overtime limit.${shortTownNote(trip)}`,
      };
    }
    return {
      ok: true,
      ot: 0,
      reason: `Fits with the regular runs and no overtime. ${hours} That stays within 8 hours, so this trip adds no overtime.${shortTownNote(trip)}`,
    };
  }

  function orderedGroups(person) {
    const used = new Set();
    return person.groups.map((group) => {
      const trips = [];
      for (const token of group) {
        const trip = byNumber.get(cleanToken(token));
        if (!trip || used.has(trip.id)) continue;
        if (!person.signed.includes(cleanToken(token))) continue;
        used.add(trip.id);
        trips.push(trip);
      }
      return trips;
    });
  }

  function pushLine(person, trip, outcome, reason) {
    const line = {
      trip_id: trip.id,
      trip_number: cleanToken(trip.trip_number),
      outcome,
      reason,
    };
    const lines = driverLines.get(person.driver.driver_id) || [];
    lines.push(line);
    driverLines.set(person.driver.driver_id, lines);
    if (!person.signed.includes(cleanToken(trip.trip_number))) return;
    const steps = tripSteps.get(trip.id) || [];
    steps.push({
      driver_id: person.driver.driver_id,
      name: person.driver.name || person.driver.driver_id,
      seniority_rank: person.driver.seniority_rank ?? null,
      hire_date: person.driver.hire_date || null,
      preference: person.preference,
      mode: person.mode,
      utility: person.utility,
      weekly_minutes: person.weekly,
      outcome,
      reason,
    });
    tripSteps.set(trip.id, steps);
  }

  function preferenceTrips(person) {
    return orderedGroups(person).flat();
  }

  function higherChoiceNotes(person, trip) {
    const notes = [];
    for (const earlier of preferenceTrips(person)) {
      if (earlier.id === trip.id) break;
      const number = cleanToken(earlier.trip_number);
      const holding = awarded.get(earlier.id);
      if (holding?.driver.driver_id === person.driver.driver_id) continue;
      if (holding) {
        notes.push(`#${number} went to ${driverPhrase(holding.driver)}.`);
        continue;
      }
      const fit = explainFit(person, earlier);
      notes.push(`#${number}: ${fit.reason}`);
    }
    return notes;
  }

  function compareOutOfTown(a, b) {
  if (rankOf(a.person) !== rankOf(b.person)) return rankOf(a.person) - rankOf(b.person);
  return String(a.person.driver.name || '').localeCompare(String(b.person.driver.name || ''));
}

function gotReason(best, others) {
    const who = driverPhrase(best.person.driver);
    const rank = best.person.driver.seniority_rank ?? 9999;
    const hours = weekSentence(best.person);
    if (outOfTownTrip(best.trip)) {
      const lineup = [best, ...others]
        .map((row) => driverPhrase(row.person.driver))
        .join('; ');
      const midday = /midday run overlaps/i.test(best.fit.reason)
        ? ' The midday run comes off the route and is posted on the daily board.'
        : '';
      return `Got the trip. ${who} has the lowest seniority number of the drivers who asked for it and can take it. ${hours}${midday} Compared by seniority number: ${lineup}. A field trip of 3.5 hours or more that leaves town goes by seniority even when it causes overtime.`;
    }
    if (best.fit.ot === 0) {
      const fullWeek = others.filter((row) => !row.person.utility);
      if (best.person.utility && fullWeek.length) {
        const detail = fullWeek
          .map((row) => {
            const otBit =
              row.fit.ot > 0
                ? ` This trip would be ${formatDuration(row.fit.ot)} of overtime for that driver.`
                : ' This trip would also fit that driver with no overtime.';
            return `${driverPhrase(row.person.driver)} is a route driver, with regular runs of ${formatDuration(row.person.regular)} that day.${otBit} The utility position is offered the work first.`;
          })
          .join(' ');
        return `Got the trip. ${who} is a utility driver and is under 40 contracted hours, so the work is offered here first, and it finishes with the regular runs and no overtime. ${hours} ${detail}`;
      }
      const moreSenior = others.filter((row) => (row.person.driver.seniority_rank ?? 9999) < rank);
      if (moreSenior.length) {
        const detail = moreSenior
          .map((row) => {
            if (row.fit.ot > 0) {
              return `${driverPhrase(row.person.driver)} would have ${formatDuration(row.fit.ot)} of overtime on this trip. No overtime comes ahead of a higher seniority number.`;
            }
            return `${driverPhrase(row.person.driver)} is more senior, but cannot take this trip with the regular runs and no overtime.`;
          })
          .join(' ');
        return `Got the trip. ${who} can finish with the regular runs and no overtime. ${hours} More senior drivers who asked for it cannot finish it with their regular runs and no overtime. ${detail}`;
      }
      const behind = others.map((row) => driverPhrase(row.person.driver));
      const rest = behind.length
        ? `The drivers behind this seniority number who also asked for it and can finish with the regular runs and no overtime are ${behind.join('; ')}. The lower seniority number puts this driver ahead of them. The most senior driver who can finish with no overtime gets the trip.`
        : 'No other signed-up driver can finish this trip with the regular runs and no overtime.';
      return `Got the trip. ${who} can finish with the regular runs and no overtime. ${hours} ${rest}`;
    }
    const lineup = [best, ...others]
      .map((row) => `${driverPhrase(row.person.driver)} would have ${formatDuration(row.fit.ot)} of overtime`)
      .join('; ');
    return `Got the trip. Nobody who asked for it can finish with no overtime. ${who} has the least overtime, ${formatDuration(best.fit.ot)}, within one hour. ${hours} Compared by overtime, then by seniority number: ${lineup}. The smallest overtime within one hour gets the trip. Seniority is used only when the overtime is the same.`;
  }

  const holds = new Map();
  let guard = 0;
  while (guard < 100) {
    guard += 1;
    const claims = [];
    for (const person of people) {
      const already = [...awarded.values()].some((row) => row.driver.driver_id === person.driver.driver_id);
      if (person.mode === 'one' && already) continue;
      for (const trip of preferenceTrips(person)) {
        if (!open.has(trip.id)) continue;
        const fit = explainFit(person, trip);
        if (!fit.ok) continue;
        if (!outOfTownTrip(trip) && fit.ot > OT_CAP) continue;
        claims.push({ person, trip, fit });
        break;
      }
    }
    if (!claims.length) break;
    const byTrip = new Map();
    for (const claim of claims) {
      const list = byTrip.get(claim.trip.id) || [];
      list.push(claim);
      byTrip.set(claim.trip.id, list);
    }
    for (const group of byTrip.values()) {
      group.sort(outOfTownTrip(group[0].trip) ? compareOutOfTown : compareClaims);
      const best = group[0];
      const peers = lotsPeers(group, best);
      if (peers.length > 1) {
        open.delete(best.trip.id);
        holds.set(best.trip.id, {
          reason: lotsHoldReason(peers),
          driverIds: new Set(peers.map((row) => row.person.driver.driver_id)),
        });
        continue;
      }
      const notes = higherChoiceNotes(best.person, best.trip);
      const why = gotReason(best, group.slice(1));
      const request = best.person.preference
        ? `The written request is ${best.person.preference}.`
        : 'There is no written order, so the signed tickets are used.';
      const requestRule =
        best.person.mode === 'many'
          ? 'Parentheses means every trip in that group that fits.'
          : 'No parentheses means one trip, the first choice that fits.';
      const because = notes.length
        ? `Higher choices did not fit. ${driverPhrase(best.person.driver)} wrote that order. ${request} ${requestRule} ${notes.join(' ')} ${why}`
        : why;
      const reason = `${because}${shortTownNote(best.trip)}`;
      open.delete(best.trip.id);
      awarded.set(best.trip.id, { driver: best.person.driver, reason, ot: best.fit.ot });
    }
  }

  for (const person of people) {
    const list = preferenceTrips(person);
    const wonIds = new Set(
      [...awarded.entries()]
        .filter(([, row]) => row.driver.driver_id === person.driver.driver_id)
        .map(([id]) => id)
    );
    const wonTrip = list.find((trip) => wonIds.has(trip.id));
    let passedWin = false;
    for (const trip of list) {
      if (wonIds.has(trip.id)) {
        passedWin = true;
        pushLine(person, trip, 'awarded', awarded.get(trip.id).reason);
        continue;
      }
      if (person.mode === 'one' && passedWin) {
        pushLine(
          person,
          trip,
          'later',
          `This request has no parentheses, so it is one trip. #${cleanToken(wonTrip?.trip_number)} already fits for ${driverPhrase(person.driver)}, and this later choice is not awarded.`
        );
        continue;
      }
      const held = holds.get(trip.id);
      if (held?.driverIds.has(person.driver.driver_id)) {
        pushLine(person, trip, 'tied', held.reason);
        continue;
      }
      const holding = awarded.get(trip.id);
      if (holding) {
        const fit = explainFit(person, trip);
        if (!fit.ok) {
          pushLine(person, trip, 'passed', fit.reason);
          continue;
        }
        pushLine(
          person,
          trip,
          'taken',
          `Went to ${driverPhrase(holding.driver)}. ${driverPhrase(person.driver)} also signed up for this ticket. ${holding.reason}`
        );
        continue;
      }
      const fit = explainFit(person, trip);
      pushLine(person, trip, 'passed', fit.reason);
    }
  }

  function orderedSteps(trip, steps) {
    if (!outOfTownTrip(trip)) return steps;
    return [...steps].sort((a, b) => {
      const left = a.seniority_rank ?? 9999;
      const right = b.seniority_rank ?? 9999;
      if (left !== right) return left - right;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  return {
    date: day,
    mixed_hours: people.some((person) => person.utility) && people.some((person) => !person.utility),
    drivers: people.map((person) => ({
      driver_id: person.driver.driver_id,
      name: person.driver.name || person.driver.driver_id,
      seniority_rank: person.driver.seniority_rank ?? null,
      hire_date: person.driver.hire_date || null,
      preference: person.preference,
      mode: person.mode,
      regular_minutes: person.regular,
      weekly_minutes: person.weekly,
      utility: person.utility,
      lines: driverLines.get(person.driver.driver_id) || [],
    })),
    trips: dayTrips.map((trip) => {
      const win = awarded.get(trip.id) || null;
      return {
        id: trip.id,
        trip_number: cleanToken(trip.trip_number),
        destination: trip.destination || '',
        school: trip.school || '',
        signup_count: (trip.bids || []).length,
        hold_reason: holds.get(trip.id)?.reason || null,
        winner: win
          ? {
              driver_id: win.driver.driver_id,
              name: win.driver.name || win.driver.driver_id,
              seniority_rank: win.driver.seniority_rank ?? null,
              hire_date: win.driver.hire_date || null,
              reason: win.reason,
            }
          : null,
        steps: orderedSteps(trip, tripSteps.get(trip.id) || []),
      };
    }),
  };
}

/**
 * Clock text stored on a late-work interest mark. Empty when the time is not a clock.
 * @param {unknown} value
 * @returns {string}
 */
function clockText(value) {
  const minutes = parseMinutes(value);
  if (minutes == null) return '';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Keep up to eight ranges with an end after the start.
 * @param {unknown} raw
 * @returns {Array<{ start: string, end: string }>}
 */
export function normalizeTimeRanges(raw) {
  const ranges = [];
  for (const row of Array.isArray(raw) ? raw : []) {
    const source = row && typeof row === 'object' ? row : {};
    const start = clockText(source.start);
    const end = clockText(source.end);
    if (!start || !end || parseMinutes(end) <= parseMinutes(start)) continue;
    if (ranges.some((range) => range.start === start && range.end === end)) continue;
    ranges.push({ start, end });
    if (ranges.length >= 8) break;
  }
  ranges.sort((a, b) => parseMinutes(a.start) - parseMinutes(b.start));
  return ranges;
}

/** Repeating late-work days, Monday first. */
export const AVAIL_WEEKDAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

const WEEKDAY_KEY = {
  SUN: 'sun',
  MON: 'mon',
  TUE: 'tue',
  WED: 'wed',
  THU: 'thu',
  FRI: 'fri',
  SAT: 'sat',
};

/**
 * @param {string} iso
 * @returns {'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | ''}
 */
export function weekdayKey(iso) {
  return WEEKDAY_KEY[sheetWeekday(iso)] || '';
}

/** Shown when a day is open for any late addition, with no clock window. */
export const OPEN_MIDDAY_LABEL = 'Totally open on my mid-day';

/** @returns {Record<string, { ranges: Array<{ start: string, end: string }>, note: string, same_as: string, open: boolean }>} */
export function emptyAvailabilityWeek() {
  return Object.fromEntries(
    AVAIL_WEEKDAYS.map((day) => [day.key, { ranges: [], note: '', same_as: '', open: false }])
  );
}

/**
 * Times for one repeating weekday, following "same as" links.
 * A circle yields no times.
 * @param {Record<string, { ranges?: unknown, same_as?: string }> | null | undefined} weekdays
 * @param {string} key
 * @param {Set<string>} [seen]
 */
export function weekdayEntryRanges(weekdays, key, seen = new Set()) {
  if (!key || seen.has(key)) return [];
  seen.add(key);
  const entry = weekdays?.[key];
  if (!entry || typeof entry !== 'object') return [];
  const same = String(entry.same_as || '');
  if (same) return weekdayEntryRanges(weekdays, same, seen);
  return normalizeTimeRanges(Array.isArray(entry) ? entry : entry.ranges);
}

/**
 * True when weekday links follow each other in a circle.
 * @param {Record<string, { same_as?: string }> | null | undefined} weekdays
 */
export function sameAsCycle(weekdays) {
  for (const day of AVAIL_WEEKDAYS) {
    const seen = new Set();
    let key = day.key;
    while (key) {
      if (seen.has(key)) return true;
      seen.add(key);
      key = String(weekdays?.[key]?.same_as || '');
    }
  }
  return false;
}

/**
 * True when a repeating weekday is totally open, following "same as" links.
 * A circle is not open.
 * @param {Record<string, { open?: boolean, same_as?: string }> | null | undefined} weekdays
 * @param {string} key
 * @param {Set<string>} [seen]
 */
export function weekdayEntryOpen(weekdays, key, seen = new Set()) {
  if (!key || seen.has(key)) return false;
  seen.add(key);
  const entry = weekdays?.[key];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const same = String(entry.same_as || '');
  if (same) return weekdayEntryOpen(weekdays, same, seen);
  return entry.open === true;
}

/**
 * Times that apply on one calendar date.
 * An exception replaces that weekday, and an empty exception means not available.
 * A totally open day has no clock window; use dayIsOpenOnSchedule for that.
 * @param {{ weekdays?: Record<string, { ranges?: unknown, same_as?: string }>, exceptions?: Array<{ date?: string, ranges?: unknown }> } | null | undefined} schedule
 * @param {string} iso
 */
export function rangesOnSchedule(schedule, iso) {
  if (!schedule || !iso) return [];
  const exception = (schedule.exceptions || []).find((row) => row?.date === iso);
  if (exception) return exception.open === true ? [] : normalizeTimeRanges(exception.ranges);
  if (weekdayEntryOpen(schedule.weekdays, weekdayKey(iso))) return [];
  return weekdayEntryRanges(schedule.weekdays, weekdayKey(iso));
}

/**
 * True when this date is totally open and no clock window should limit it.
 * An exception replaces the weekday, including an exception that is not open.
 * @param {{ weekdays?: Record<string, { open?: boolean, same_as?: string }>, exceptions?: Array<{ date?: string, open?: boolean }> } | null | undefined} schedule
 * @param {string} iso
 */
export function dayIsOpenOnSchedule(schedule, iso) {
  if (!schedule || !iso) return false;
  const exception = (schedule.exceptions || []).find((row) => row?.date === iso);
  if (exception) return exception.open === true;
  return weekdayEntryOpen(schedule.weekdays, weekdayKey(iso));
}

/**
 * The trip fits inside the driver's available time, including ranges that meet.
 * @param {unknown} ranges
 * @param {{ start: number, end: number }} interval
 */
export function rangeCovers(ranges, interval) {
  if (!interval) return false;
  const blocks = normalizeTimeRanges(ranges)
    .map((range) => ({ start: parseMinutes(range.start), end: parseMinutes(range.end) }))
    .filter((range) => range.start != null && range.end != null);
  const merged = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (!last || block.start > last.end) merged.push({ ...block });
    else last.end = Math.max(last.end, block.end);
  }
  return merged.some((block) => block.start <= interval.start && block.end >= interval.end);
}

/**
 * Hours a driver would write for one day's request.
 * The driver enters the trip order. Regular route time is already known.
 * No parentheses counts the first trip that fits. Parentheses counts every
 * trip in each group that fits. Overtime is the part of that day past 8 hours.
 * @param {{
 *   preference?: string,
 *   trips?: Array<{ trip_number?: string, times?: Record<string, string> }>,
 *   bars?: Array<{ start: number, end: number }>,
 * }} input
 */
export function requestedDayLoad({ preference = '', trips = [], bars = [] } = {}) {
  const parsed = parsePreference(preference);
  const byNumber = new Map();
  for (const trip of trips) {
    const token = cleanToken(trip?.trip_number);
    if (token && !byNumber.has(token)) byNumber.set(token, trip);
  }
  const taken = [];
  const fits = (trip) => {
    const interval = tripInterval(trip.times);
    if (!interval) return null;
    if (overlappingBars(interval, bars).length) return null;
    if (taken.some((item) => item.start < interval.end && interval.start < item.end)) return null;
    return interval;
  };
  const consider = (tokens, stopAfterOne) => {
    for (const token of tokens) {
      const trip = byNumber.get(cleanToken(token));
      const interval = trip ? fits(trip) : null;
      if (!interval) continue;
      taken.push(interval);
      if (stopAfterOne) return;
    }
  };
  if (parsed.mode === 'many') {
    for (const group of parsed.groups) consider(group, false);
  } else {
    consider(parsed.groups[0] || [], true);
  }
  const regular = (bars || []).reduce((sum, bar) => sum + Math.max(0, bar.end - bar.start), 0);
  const tripMinutes = taken.reduce((sum, item) => sum + (item.end - item.start), 0);
  const total = regular + tripMinutes;
  return {
    regular,
    tripMinutes,
    total,
    ot: Math.max(0, total - DAY_LIMIT),
  };
}

/**
 * Minutes of an interval that are not already covered.
 * @param {{ start: number, end: number }} interval
 * @param {Array<{ start: number, end: number }>} blocked
 */
function uncoveredMinutes(interval, blocked) {
  let pieces = [{ start: interval.start, end: interval.end }];
  for (const block of blocked) {
    if (!block || block.end <= block.start) continue;
    const next = [];
    for (const piece of pieces) {
      if (block.end <= piece.start || block.start >= piece.end) {
        next.push(piece);
        continue;
      }
      if (block.start > piece.start) next.push({ start: piece.start, end: block.start });
      if (block.end < piece.end) next.push({ start: block.end, end: piece.end });
    }
    pieces = next;
  }
  return pieces.reduce((sum, piece) => sum + (piece.end - piece.start), 0);
}

/**
 * Overtime from the jobs currently on a driver's row.
 * Regular route time is already known. Each placed trip adds only the minutes
 * that are not already on the route or on another placed trip.
 * Overtime is the part of that day past 8 hours.
 * @param {{
 *   intervals?: Array<{ start: number, end: number } | null>,
 *   bars?: Array<{ start: number, end: number }>,
 * }} input
 */
export function assignedDayLoad({ intervals = [], bars = [] } = {}) {
  const blocked = (bars || [])
    .filter((bar) => bar && bar.end > bar.start)
    .map((bar) => ({ start: bar.start, end: bar.end }));
  let tripMinutes = 0;
  const placed = intervals
    .filter((interval) => interval && interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  for (const interval of placed) {
    tripMinutes += uncoveredMinutes(interval, blocked);
    blocked.push({ start: interval.start, end: interval.end });
  }
  const regular = (bars || []).reduce((sum, bar) => sum + Math.max(0, bar.end - bar.start), 0);
  const total = regular + tripMinutes;
  return {
    regular,
    tripMinutes,
    total,
    ot: Math.max(0, total - DAY_LIMIT),
  };
}

/**
 * Drivers who marked a time that covers this late job, most senior first.
 * @param {{
 *   drivers?: Array<{ driver_id?: string, name?: string, seniority_rank?: number | null }>,
 *   marks?: Array<{ date?: string, driver_id?: string, ranges?: unknown, open?: boolean }>,
 *   date?: string,
 *   interval?: { start: number, end: number } | null,
 * }} input
 */
export function lateInterestList({ drivers = [], marks = [], date = '', interval = null } = {}) {
  if (!date || !interval) return [];
  const rows = [];
  for (const driver of drivers) {
    const mark = (marks || []).find((row) => row?.date === date && row?.driver_id === driver.driver_id);
    const open = mark?.open === true;
    if (!mark || (!open && !rangeCovers(mark.ranges, interval))) continue;
    rows.push({ driver, ranges: open ? [] : normalizeTimeRanges(mark.ranges), open });
  }
  rows.sort((a, b) => {
    const left = a.driver.seniority_rank ?? 9999;
    const right = b.driver.seniority_rank ?? 9999;
    if (left !== right) return left - right;
    return String(a.driver.name || '').localeCompare(String(b.driver.name || ''));
  });
  return rows;
}

/**
 * Short reason for a trip the walk does not award.
 * @param {{ steps?: Array<{ outcome?: string, reason?: string, name?: string }> }} trip
 */
function stepPhrase(step) {
  const name = cleanToken(step?.name) || 'A driver';
  if (step?.seniority_rank == null) return `${name} (no seniority number)`;
  return `${name} (seniority ${step.seniority_rank})`;
}

function withSubstitute(text) {
  const sentence = 'Assign the remaining work to a substitute.';
  if (!text) return sentence;
  if (/substitute/i.test(text)) return text;
  return `${text} ${sentence}`;
}

export function noWinnerText(trip) {
  if (trip?.hold_reason) return trip.hold_reason;
  const steps = trip?.steps || [];
  if (!steps.length) {
    return withSubstitute('Nobody signed up for this trip, so there is no seniority order to walk and nobody to suggest.');
  }
  const later = steps.filter((step) => step.outcome === 'later');
  const passed = steps.filter((step) => step.outcome === 'passed');
  if (later.length && passed.length + later.length === steps.length) {
    const names = later.map((step) => step.name).filter(Boolean).join(', ');
    const taken =
      later.length === 1
        ? `${names} already took the one trip in that request.`
        : `${names} already took the one trip in their requests.`;
    const crosses = passed.every((step) => String(step.reason || '').startsWith('Crosses'));
    const rest = crosses
      ? 'Everyone else who signed up would have to give up a regular run.'
      : 'Everyone else who signed up would have to give up a regular run or go past one hour of overtime.';
    const checked = [...later, ...passed].map((step) => stepPhrase(step)).join('; ');
    return withSubstitute(`${taken} ${rest} Checked as ${checked}.`);
  }
  const crosses = passed.filter((step) => String(step.reason || '').startsWith('Crosses')).length;
  const overtime = passed.filter((step) => String(step.reason || '').includes('overtime')).length;
  const who = steps.map((step) => stepPhrase(step)).join('; ');
  if (crosses && crosses === steps.length) {
    return withSubstitute(`Each driver who signed up would have to give up a regular run. That is ${who}.`);
  }
  if (crosses && overtime) {
    return withSubstitute(`The drivers who signed up either keep a regular run or would go past one hour of overtime. That is ${who}.`);
  }
  return withSubstitute(passed[0]?.reason || `No signed-up driver can take this. The drivers checked are ${who}.`);
}
