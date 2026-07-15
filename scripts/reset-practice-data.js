#!/usr/bin/env node
/**
 * Wipe practice-data entirely and re-seed from scratch.
 * Refuses to run unless PRACTICE_MODE=true and DATA_DIR basename is practice-data.
 *
 * Usage: npm run reset:practice
 */
import fs from 'node:fs/promises';
import {
  assertPracticeSharedRoot,
  isPracticeMode,
} from '../src/config.js';
import { seedPracticeData } from './seed-practice-data.js';

if (!isPracticeMode()) {
  console.error(
    'PRACTICE_MODE is not set. Run via npm run reset:practice (loads .env.practice).'
  );
  process.exitCode = 1;
} else {
  try {
    const sharedRoot = assertPracticeSharedRoot();
    await fs.rm(sharedRoot, { recursive: true, force: true });
    console.log(`Wiped ${sharedRoot}`);
    await seedPracticeData({ force: true });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
