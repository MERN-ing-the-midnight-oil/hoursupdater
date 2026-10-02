import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { officeStateFromDriverTimesCsv } from '../office-tracker/src/driverTimesSheet.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scripts/import-driver-times.js <driver-times.csv>');
  process.exit(1);
}

const state = officeStateFromDriverTimesCsv(readFileSync(csvPath, 'utf8'));
const dir = path.join(root, 'employee-data');
mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'office-state.json');
writeFileSync(out, `${JSON.stringify(state, null, 2)}\n`);

const profiles = Object.values(state.profiles);
const runs = profiles.flatMap((profile) => profile.changeLog.map((event) => event.segment));
console.log(`Wrote ${profiles.length} routes and ${state.drivers.length} drivers to ${out}`);
console.log(
  `Runs: ${runs.filter((run) => run === 'AM').length} AM, ${runs.filter((run) => run === 'MIDDAY').length} midday, ${runs.filter((run) => run === 'PM').length} PM`
);
console.log(
  profiles
    .filter((profile) => profile.note && /Shop|Office|Utility|No driver|3 days|4 hr|minimum/i.test(profile.note))
    .map((profile) => `${profile.name}: ${profile.note}`)
    .join('\n')
);
