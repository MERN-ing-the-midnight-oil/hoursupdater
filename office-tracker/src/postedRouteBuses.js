import { savePostedBus, saveRouteBus } from './theBoard.js';

// Hallway posting "Route Bus Assignments 2026-2027", updated 11/13/26.
// Only the "By Route #" table, to the right of the black line. OPEN means no
// driver is posted; the bus is still the bus on that route. Routes 26–49 are
// not on that table. The Sped Spare and Reg Ed Spare boxes are a spare pool,
// not the bus assigned to the route.
export const POSTED_ROUTE_SHEET = '2026-11-13';

export const POSTED_ROUTE_BUSES = [
  { route: '1', bus: '60', driver: 'Shemeca' },
  { route: '2', bus: '79', driver: 'Karen' },
  { route: '3', bus: '87', driver: 'Cydney' },
  { route: '4', bus: '86', driver: 'Loriena' },
  { route: '5', bus: '85', driver: 'Charlie' },
  { route: '6', bus: '11', driver: 'Jeremy' },
  { route: '7', bus: '21', driver: 'David B' },
  { route: '8', bus: '50', driver: 'Sami' },
  { route: '9', bus: '37', driver: 'Connie' },
  { route: '10', bus: '61', driver: 'Rhys' },
  { route: '11', bus: '56', driver: 'Sheila' },
  { route: '12', bus: '49', driver: 'Masoud' },
  { route: '13', bus: '59', driver: 'Tammy' },
  { route: '14', bus: '51', driver: 'Terri' },
  { route: '15', bus: '47', driver: 'Ricardo' },
  { route: '16', bus: '88', driver: 'Aspi' },
  { route: '17', bus: '12', driver: 'Bonnie' },
  { route: '18', bus: '80', driver: 'Darcie' },
  { route: '19', bus: '10', driver: 'Nick' },
  { route: '20', bus: '55', driver: 'Natalia' },
  { route: '21', bus: '44', driver: 'Paul' },
  { route: '22', bus: '52', driver: '' },
  { route: '23', bus: '54', driver: '' },
  { route: '24', bus: '42', driver: '' },
  { route: '25', bus: '58', driver: '' },
  { route: '50', bus: '82', driver: 'Scott W' },
  { route: '51', bus: '3', driver: 'Lisa' },
  { route: '52', bus: '89', driver: 'Eduardo' },
  { route: '53', bus: '83', driver: 'Juan' },
  { route: '54', bus: '13', driver: 'Cody' },
  { route: '55', bus: '4', driver: 'Athena' },
  { route: '56', bus: '64', driver: '' },
  { route: '57', bus: '41', driver: 'Brian' },
  { route: '58', bus: '25', driver: 'Heather' },
  { route: '59', bus: '76', driver: 'Hundal' },
  { route: '60', bus: '17', driver: 'Danna' },
  { route: '61', bus: '34', driver: 'Dennis' },
  { route: '62', bus: '27', driver: 'Moana' },
  { route: '63', bus: '77', driver: 'Darryl' },
  { route: '64', bus: '29', driver: 'Mukhtiar' },
  { route: '65', bus: '31', driver: 'Becky' },
  { route: '66', bus: '32', driver: 'RaeAnne' },
  { route: '67', bus: '35', driver: 'Frosty' },
  { route: '68', bus: '1', driver: 'Angela' },
  { route: '69', bus: '33', driver: 'Zach' },
  { route: '70', bus: '90', driver: 'David S' },
  { route: '71', bus: '81', driver: 'Toni' },
  { route: '72', bus: '46', driver: 'Iqbal' },
  { route: '73', bus: '39', driver: 'Scott T' },
  { route: '74', bus: '84', driver: 'Graham' },
  { route: '75', bus: '19', driver: 'Khaled' },
  { route: '76', bus: '23', driver: 'Billa' },
  { route: '77', bus: '14', driver: 'Rick' },
  { route: '78', bus: '7', driver: 'Josh' },
  { route: '79', bus: '6', driver: 'Aaron' },
  { route: '80', bus: '78', driver: 'Tonia' },
  { route: '81', bus: '28', driver: 'Jaycob' },
  { route: '82', bus: '2', driver: 'Matt' },
  { route: '83', bus: '40', driver: 'Hanna' },
  { route: '84', bus: '30', driver: 'Lauren' },
  { route: '85', bus: '26', driver: 'Drew' },
  { route: '86', bus: '36', driver: 'Marjorie' },
  { route: '87', bus: '75', driver: 'Mark' },
  { route: '88', bus: '24', driver: 'Bob B' },
  { route: '89', bus: '62', driver: 'James' },
];

export const POSTED_SPED_SPARES = [
  { route: '38', spare: 'WC(2)' },
  { route: '15', spare: '36P' },
  { route: '45', spare: 'WC(0)' },
  { route: '18', spare: 'WC(2)' },
  { route: '16', spare: 'WC(1)' },
  { route: '57', spare: 'A-24P' },
];

export const POSTED_REG_ED_SPARES = [
  { bus: '9', kind: 'HDX 78P' },
  { bus: '22', kind: 'HDX 84P' },
  { bus: '63', kind: 'HDX 84P' },
  { bus: '66', kind: 'HDX 84P' },
  { bus: '70', kind: 'C2-77P' },
  { bus: '71', kind: 'C2-77P' },
  { bus: '72', kind: 'C2-77P' },
  { bus: '73', kind: 'C2-77P' },
  { bus: '74', kind: 'C2-77P' },
  { bus: '5', kind: 'C2-77P' },
  { bus: '8', kind: 'C2-77P' },
  { bus: '69', kind: 'C2-77P' },
];

// Add posted buses that are not already on the list. A saved AM, MID, or PM
// clock becomes its own row. A route with no saved clock is listed with its
// bus and does not alert. A route that is already present keeps its bus.
export function seedPostedRouteBuses(existing, clocksForRoute) {
  const clocksFor = typeof clocksForRoute === 'function' ? clocksForRoute : () => [];
  let next = Array.isArray(existing) ? existing : [];
  const present = new Set(next.map((row) => String(row?.route || '').trim().toLowerCase()).filter(Boolean));
  for (const assignment of POSTED_ROUTE_BUSES) {
    if (present.has(assignment.route.toLowerCase())) continue;
    let runs = [];
    try {
      runs = clocksFor(assignment.route) || [];
    } catch {
      runs = [];
    }
    const usable = runs.filter((run) => run?.clockIn && run?.run);
    if (!usable.length) {
      next = savePostedBus(next, assignment);
      present.add(assignment.route.toLowerCase());
      continue;
    }
    for (const run of usable) {
      next = saveRouteBus(next, {
        route: assignment.route,
        bus: assignment.bus,
        run: run.run,
        clockIn: run.clockIn,
        clockOut: run.clockOut || '',
      });
    }
    present.add(assignment.route.toLowerCase());
  }
  return next;
}
