/**
 * Start Timeclock opens the driver screen and keeps this browser there
 * until the office lock code is entered. Driver PINs do not leave that screen.
 */

import QRCode from 'qrcode';
import { formatClockAmPm, formatDurationLabel, localDateString, toTimeInputValue } from '../../employee-tracker/src/clockTimes.js';
import { addReasonCode, assertNote, DEFAULT_KIOSK_CODE, driverClockPin, NOTE_MAX, removeReasonCode } from '../../src/logic/clockKiosk.js';
import {
  EARLY_RELEASE_DEFAULT_CLOCK,
  knownSchoolCodes,
  normalizeEarlyReleaseTimes,
} from '../../src/logic/earlyRelease.js';
import { dueClockInKeys, flashingClockInKeys, normalizeLateFlashMinutes } from '../../src/logic/lateClockFlash.js';
import { localDateKey, normalizePunchRun, punchRunLabel, replacedClockPunchIds, segmentForClock } from '../../src/logic/timesheets.js';
import {
  applyLeaveRequests,
  dropLeaveForClockIn,
  driverClockedIn,
  LEAVE_REQUESTS_ENABLED,
  leaveContractLead,
  leaveDateLabel,
  leaveFor,
  leaveMinuteLimit,
  leaveMinutesFromParts,
  leaveRequestLead,
  leaveTimeParts,
  missedClockInNote,
  runsAwaitingLeave,
  saveLeaveRequest,
} from '../src/leaveRequests.js';
import { setTimecardEntries } from '../src/officePunches.js';
import {
  formatTimecardMinutes,
  normalizeTimecardEntries,
  reasonNoteLine,
  payPeriodDeadline,
  payPeriodStillOpen,
  sessionForClockOut,
  timecardSummary,
} from '../src/timecardEntries.js';
import {
  IRREGULAR_WORK_TYPES,
  TRIP_TICKET_WORK_TYPE,
  applyWorkChunk,
  normalizeStoredWorkPortions,
  normalizeTripTicket,
  regularPairsForMarking,
  stampTripTicket,
  tripTicketLine,
  workTypeLabel,
} from '../../src/logic/workTypes.js';
import {
  CLOCK_IN_TYPES,
  DEFAULT_PAY_PERIODS,
  WHOLE_MONTH_PAY_PERIODS,
  driverPayStatusChoices,
  isExDriverOnly,
  normalizeClockPayDefaults,
  normalizeDriverPay,
  normalizePayPeriods,
  normalizePayStatusByRun,
  payStatusForClockIn,
} from '../src/driverPay.js';
import { buildMonthlyTimeSummary, buildMonthlySummaryMath, describePayPeriod, payPeriodsForClocks, payPeriodsForDriver, renderMonthlyTimeSummaryHtml } from '../src/monthlyTimeSummary.js';
import { normalizeOvertimeRules } from '../src/overtimeRules.js';
import { normalizePaperBackup } from '../src/paperClockBackup.js';
import { payPeriodInfoMarkup, renderMonthlySummaryMathHtml } from '../src/summaryMath.js';
import {
  DEFAULT_PUNCH_SOUND_IN,
  DEFAULT_PUNCH_SOUND_OUT,
  PUNCH_SOUNDS,
  playPunchSound,
  punchSoundFor,
} from './punchSounds.js';
import { ensureDriverClockLink } from './accounts.js';
import { clockShareUrl } from '../src/clockShare.js';
import { noteDayUrl } from '../src/noteShare.js';
import { driverPhotoSrc } from './driverPhotos.js';
import {
  compareRouteNumbers,
  clockRoundingMode,
  driversFromState,
  normalizeClockNameSize,
  normalizeClockRounding,
  saveDriver,
  saveTimeSummaryEdit,
} from './store.js';
import {
  isExternalTimeclockSearch,
  otherTimeclockScreens,
  timeclockScreenLabel,
  timeclockWantsFill,
  timeclockWindowBounds,
  timeclockWindowFeatures,
  timeclockWindowUrl,
} from './timeclockScreen.js';

const LOCK_KEY = 'teamster-timeclock-lock';
const LATE_ACK_KEY = 'teamster-timeclock-late-ack';
const NAME_COLOR_KEY = 'teamster-timeclock-name-colors';
/** One inch. A name button's long side stays at least this wide on a laptop. */
const NAME_BUTTON_MIN_PX = 96;
const ROSTER_GAP_PX = 6;
/** A name button is this many times as wide as it is tall. Taller than that is extra space. */
const NAME_BUTTON_RATIO = 1.9;

/**
 * Clock shown on the Timeclock right after a clock in or clock out.
 * This is the actual minute. Payroll rounding does not change it.
 * @param {Date} date
 */
export function punchDisplayClock(date) {
  const pad = (value) => String(value).padStart(2, '0');
  const clock = `${date.getHours()}:${pad(date.getMinutes())}`;
  return formatClockAmPm(clock);
}

/**
 * The clock in the timeclock header and on an unpunched Punch button.
 * @param {Date} date
 */
export function kioskLiveClock(date) {
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Time typed next to a reason.
 * A blank minutes field means no time yet. Minutes alone are a whole number up to 24 hours.
 * An hours value, when one is still stored, keeps minutes inside that hour.
 * @param {unknown} hours
 * @param {unknown} minutes
 * @returns {{ ok: true, minutes: number | null } | { ok: false }}
 */
export function reasonDurationMinutes(hours, minutes) {
  const hourText = String(hours ?? '').trim();
  const minuteText = String(minutes ?? '').trim();
  if (!hourText && !minuteText) return { ok: true, minutes: null };
  if ((hourText && !/^\d+$/.test(hourText)) || (minuteText && !/^\d+$/.test(minuteText))) {
    return { ok: false };
  }
  const hourValue = hourText ? Number(hourText) : 0;
  const minuteValue = minuteText ? Number(minuteText) : 0;
  if (!hourText) {
    if (minuteValue > 24 * 60) return { ok: false };
    return { ok: true, minutes: minuteValue };
  }
  if (hourValue > 24 || minuteValue > 59 || (hourValue === 24 && minuteValue > 0)) return { ok: false };
  return { ok: true, minutes: hourValue * 60 + minuteValue };
}

/**
 * Line after a driver's name on the timeclock.
 * A clock-in names the route they chose and the minute they punched.
 * A clock-out does not.
 * @param {'in' | 'out'} status
 * @param {{ run?: string, work_type?: string, punched_at?: string, punchedAt?: string }} [punch]
 */
export function clockedPhrase(status, punch = {}) {
  if (status !== 'in') return 'is Clocked Out';
  const run = normalizePunchRun(punch.run);
  const route = punchRunLabel(run);
  const work = run === 'OTHER' ? workTypeLabel(punch.work_type) : '';
  const when = clockedAtText(punch.punchedAt || punch.punched_at);
  const routeBit = work ? ` for ${work}` : run === 'OTHER' ? ' for Other' : route ? ` for the ${route}` : '';
  const timeBit = when ? ` at ${when}` : '';
  return `is Clocked In${routeBit}${timeBit}`;
}

/**
 * Status under the driver's name. A clock-out names the route they punched.
 * @param {'in' | 'out'} status
 * @param {{ run?: string, work_type?: string, punched_at?: string, punchedAt?: string }} [punch]
 */
export function clockedStatusLabel(status, punch = {}) {
  if (status === 'in') return clockedPhrase('in', punch).replace(/^is /, '');
  const run = normalizePunchRun(punch.run);
  const route = punchRunLabel(run);
  const work = run === 'OTHER' ? workTypeLabel(punch.work_type) : '';
  const named = work || route;
  const when = clockedAtText(punch.punchedAt || punch.punched_at);
  const routeBit = named ? ` for ${named}` : '';
  const timeBit = when ? ` at ${when}` : '';
  return `Clocked out${routeBit}${timeBit}`;
}

/**
 * @param {unknown} punchedAt
 */
function clockedAtText(punchedAt) {
  if (!punchedAt) return '';
  const date = new Date(String(punchedAt));
  if (Number.isNaN(date.getTime())) return '';
  return punchDisplayClock(date);
}

/** Standing rows on the clock card, earliest route segment first. */
const CLOCK_CARD_SLOTS = [
  { run: 'AM', action: 'in', label: 'AM IN' },
  { run: 'AM', action: 'out', label: 'AM OUT' },
  { run: 'MIDDAY', action: 'in', label: 'MID IN' },
  { run: 'MIDDAY', action: 'out', label: 'MID OUT' },
  { run: 'PM', action: 'in', label: 'PM IN' },
  { run: 'PM', action: 'out', label: 'PM OUT' },
];

/**
 * @param {{ run?: string, action?: string }} slot
 */
function clockCardSlotRank(slot) {
  const index = CLOCK_CARD_SLOTS.findIndex((item) => item.run === slot.run && item.action === slot.action);
  if (index >= 0) return index;
  return CLOCK_CARD_SLOTS.length + (slot.action === 'out' ? 1 : 0);
}

/**
 * Punch times for one route segment, oldest first.
 * @param {Array<{ run?: string, action?: string, punchedAt?: string }>} punches
 * @param {{ run: string, action: string }} slot
 */
function clockCardSlotTimes(punches, slot) {
  return punches
    .filter((punch) => normalizePunchRun(punch?.run) === slot.run && punch?.action === slot.action)
    .map((punch) => String(punch?.punchedAt || ''))
    .filter(Boolean)
    .sort();
}

/**
 * Rows for today's clock card.
 * Later route segments sit higher on the page. Earlier ones sit lower.
 * PM OUT is the first row. AM IN is the last.
 * Midday rows show when the driver has a midday contract, or already punched midday today.
 * A punched Other row sits under PM OUT. Other is not a standing row.
 * @param {{
 *   hasMidday?: boolean,
 *   punches?: Array<{ run?: string, action?: string, punchedAt?: string }>
 * }} [input]
 * @returns {Array<{ run: string, action: 'in' | 'out', label: string, punched: boolean, newestAt: string }>}
 */
export function clockCardRows(input = {}) {
  const hasMidday = input.hasMidday === true;
  const punches = Array.isArray(input.punches) ? input.punches : [];
  const showMidday = hasMidday || punches.some((punch) => normalizePunchRun(punch?.run) === 'MIDDAY');
  const standing = CLOCK_CARD_SLOTS.filter((slot) => showMidday || slot.run !== 'MIDDAY').map((slot) => {
    const times = clockCardSlotTimes(punches, slot);
    return {
      run: slot.run,
      action: /** @type {'in' | 'out'} */ (slot.action),
      label: slot.label,
      punched: times.length > 0,
      newestAt: times[times.length - 1] || '',
    };
  });
  standing.reverse();
  /** @type {typeof standing} */
  const other = [];
  for (const action of ['in', 'out']) {
    const slot = {
      run: 'OTHER',
      action: /** @type {'in' | 'out'} */ (action),
      label: action === 'in' ? 'OTHER IN' : 'OTHER OUT',
    };
    const times = clockCardSlotTimes(punches, slot);
    if (!times.length) continue;
    other.push({ ...slot, punched: true, newestAt: times[times.length - 1] });
  }
  other.sort((a, b) => b.newestAt.localeCompare(a.newestAt) || clockCardSlotRank(b) - clockCardSlotRank(a));
  const pmOut = standing.findIndex((row) => row.run === 'PM' && row.action === 'out');
  standing.splice(pmOut >= 0 ? pmOut + 1 : 0, 0, ...other);
  return standing;
}

/**
 * Type size for one name button, in pixels.
 * A landscape button can carry a larger name and route number.
 * Height still has to hold the name plus the route, so the type does not overflow a short button.
 * @param {number} btnW
 * @param {number} btnH
 */
export function rosterButtonFont(btnW, btnH) {
  const textW = Math.max(48, btnW * 0.7);
  const textH = Math.max(22, btnH - 18);
  return Math.max(12, Math.min(textH / 3.1, textW / 6.4, 48));
}

/**
 * Column and row counts that keep every name on screen.
 * Buttons stay landscape. Leftover vertical space is padding between the rows,
 * not a taller button.
 * Each button stays at least an inch wide when the screen can hold that.
 * @param {{ count: number, width: number, height: number, gap?: number, size?: string }} options
 * @returns {{ columns: number, rows: number, scroll: boolean, buttonHeight: number, rowGap: number } | null}
 */
export function kioskRosterLayout({ count, width, height, gap = ROSTER_GAP_PX, size = 'regular' }) {
  if (!Number.isFinite(count) || count < 1) return null;
  if (!(width > 0) || !(height > 0)) return null;
  const target = size === 'compact' ? 150 : size === 'large' ? 280 : 220;
  const minHeight = 44;
  /** @type {{ columns: number, rows: number, score: number, buttonHeight: number, rowGap: number } | null} */
  let best = null;
  const maxCols = Math.min(count, Math.max(0, Math.floor((width + gap) / (NAME_BUTTON_MIN_PX + gap))));
  for (let columns = 1; columns <= maxCols; columns += 1) {
    const rows = Math.ceil(count / columns);
    const btnW = (width - gap * (columns - 1)) / columns;
    if (btnW < NAME_BUTTON_MIN_PX) continue;
    const preferredH = btnW / NAME_BUTTON_RATIO;
    const maxH = (height - gap * (rows - 1)) / rows;
    if (maxH < minHeight) continue;
    const btnH = Math.min(preferredH, maxH, btnW);
    if (btnH < minHeight || btnH > btnW) continue;
    const rowGap = rows > 1 ? (height - btnH * rows) / (rows - 1) : gap;
    const ratio = btnW / btnH;
    const flat = ratio > 2.2 ? (ratio - 2.2) * 5 : 0;
    const score = rosterButtonFont(btnW, btnH) - flat - Math.abs(btnW - target) / 90;
    if (!best || score > best.score) best = { columns, rows, score, buttonHeight: btnH, rowGap };
  }
  if (best) {
    return {
      columns: best.columns,
      rows: best.rows,
      scroll: false,
      buttonHeight: best.buttonHeight,
      rowGap: best.rowGap,
    };
  }
  const columns = Math.max(1, Math.min(count, Math.floor((width + gap) / (NAME_BUTTON_MIN_PX + gap)) || 1));
  const btnW = (width - gap * (columns - 1)) / columns;
  const buttonHeight = Math.max(minHeight, Math.min(btnW / NAME_BUTTON_RATIO, 132));
  return { columns, rows: Math.ceil(count / columns), scroll: true, buttonHeight, rowGap: gap };
}

/**
 * @param {{
 *   readState: () => {
 *     punches?: object[],
 *     clockPins?: Record<string, string>,
 *     clockLockCode?: string,
 *     clockSubstituteDrivers?: Array<{ id: string, name: string }>,
 *     clockLateMinutes?: number | null,
 *     clockNameSize?: string,
 *     clockPunchSoundIn?: string,
 *     clockPunchSoundOut?: string,
 *   },
 *   writeState: (state: object) => void,
 *   listPeople: () => Array<{ id: string, name: string, routes: string[], clockIns?: string[], clockRuns?: string[] }>,
 *   contractedMinutes?: (driverName: string, dateKey: string) => Record<string, number | null>,
 * }} options
 */
export function mountTimeclock({ readState, writeState, listPeople, contractedMinutes }) {
  const startButton = document.querySelector('#start-timeclock');
  const screenButton = document.querySelector('#start-timeclock-screen');
  const screenChoices = document.querySelector('#timeclock-screen-choices');
  const screenList = document.querySelector('#timeclock-screen-list');
  const screenStatus = document.querySelector('#timeclock-screen-status');
  const kioskFill = document.querySelector('#kiosk-fill-screen');
  const lockForm = document.querySelector('#lock-form');
  const lockInput = document.querySelector('#lock-code');
  const pinForm = document.querySelector('#pin-form');
  const pinDriver = document.querySelector('#pin-driver');
  const pinValue = document.querySelector('#pin-value');
  const pinList = document.querySelector('#pin-list');
  const officeStatus = document.querySelector('#timeclock-settings-status');
  const kiosk = document.querySelector('#timeclock-kiosk');
  const kioskNow = document.querySelector('#kiosk-now');
  const kioskList = document.querySelector('#kiosk-list');
  const kioskDetail = document.querySelector('#kiosk-detail');
  const kioskSubstitutes = document.querySelector('#kiosk-substitutes');
  const kioskRoster = document.querySelector('#kiosk-roster');
  const kioskListStatus = document.querySelector('#kiosk-list-status');
  const kioskBack = document.querySelector('#kiosk-back');
  const kioskDriver = document.querySelector('#kiosk-driver');
  const kioskDriverPhoto = document.querySelector('#kiosk-driver-photo');
  const kioskRoutes = document.querySelector('#kiosk-routes');
  const kioskPinForm = document.querySelector('#kiosk-pin-form');
  const kioskPin = document.querySelector('#kiosk-pin');
  const kioskPinError = document.querySelector('#kiosk-pin-error');
  const kioskSubstitute = document.querySelector('#kiosk-substitute');
  const kioskSubstitutePanel = document.querySelector('#kiosk-substitute-panel');
  const kioskSubstituteList = document.querySelector('#kiosk-substitute-list');
  const kioskSubstituteEmpty = document.querySelector('#kiosk-substitute-empty');
  const kioskCovering = document.querySelector('#kiosk-covering');
  const kioskSubstituteWho = document.querySelector('#kiosk-substitute-who');
  const kioskActions = document.querySelector('#kiosk-actions');
  const kioskRunChoice = document.querySelector('#kiosk-run-choice');
  const kioskCard = document.querySelector('#kiosk-card');
  const kioskWork = document.querySelector('#kiosk-work');
  const kioskWorkOptions = document.querySelector('#kiosk-work-options');
  const kioskWorkBack = document.querySelector('#kiosk-work-back');
  const kioskTripTicketField = document.querySelector('#kiosk-trip-ticket-field');
  const kioskTripTicket = document.querySelector('#kiosk-trip-ticket');
  const kioskChunk = document.querySelector('#kiosk-chunk');
  const kioskChunkOpen = document.querySelector('#kiosk-chunk-open');
  const kioskChunkPanel = document.querySelector('#kiosk-chunk-panel');
  const kioskChunkBack = document.querySelector('#kiosk-chunk-back');
  const kioskChunkPairs = document.querySelector('#kiosk-chunk-pairs');
  const kioskChunkStart = document.querySelector('#kiosk-chunk-start');
  const kioskChunkEnd = document.querySelector('#kiosk-chunk-end');
  const kioskChunkTypes = document.querySelector('#kiosk-chunk-types');
  const kioskChunkTicketField = document.querySelector('#kiosk-chunk-ticket-field');
  const kioskChunkTicket = document.querySelector('#kiosk-chunk-ticket');
  const kioskChunkSave = document.querySelector('#kiosk-chunk-save');
  const kioskChunkError = document.querySelector('#kiosk-chunk-error');
  const kioskPunchLayout = document.querySelector('.kiosk-punch-layout');
  const kioskLeave = document.querySelector('#kiosk-leave');
  const kioskLeaveCode = document.querySelector('#kiosk-leave-code');
  const kioskLeaveError = document.querySelector('#kiosk-leave-error');
  const kioskLeaveBack = document.querySelector('#kiosk-leave-back');
  const kioskConfirm = document.querySelector('#kiosk-confirm');
  const kioskConfirmText = document.querySelector('#kiosk-confirm-text');
  const kioskClockQr = document.querySelector('#kiosk-clock-qr');
  const kioskClockQrCode = document.querySelector('#kiosk-clock-qr-code');
  const kioskDayQr = document.querySelector('#kiosk-day-qr');
  const kioskDayQrCode = document.querySelector('#kiosk-day-qr-code');
  if (
    !startButton ||
    !lockForm ||
    !lockInput ||
    !pinForm ||
    !pinDriver ||
    !pinValue ||
    !pinList ||
    !kiosk ||
    !kioskNow ||
    !kioskList ||
    !kioskDetail ||
    !kioskSubstitutes ||
    !kioskRoster ||
    !kioskPin ||
    !kioskActions ||
    !kioskLeave
  ) {
    return { refresh() {} };
  }

  /** @type {{ id: string, name: string, routes: string[], clockIns: string[], clockRuns: string[] } | null} */
  let selected = null;
  /** Name chosen from the office substitute list. Blank when this driver entered a PIN. */
  let substituteName = '';
  /** The open driver is who this substitute is covering. Otherwise they still pick a name. */
  let substituteCoversSelected = false;
  let unlocked = false;
  /** Clock in whose regular route is being marked as other work. */
  let chunkClockInId = '';
  /** @type {string[]} */
  let kioskReasonIds = [];
  /** Clock-out whose timecard codes are on screen. */
  let timecardPunchId = '';
  /** @type {'roster' | 'choices'} */
  let timecardReturn = 'roster';
  let timecardDoneMessage = '';
  /** @type {Array<{ id: string, hours: string, minutes: string, comment: string }>} */
  let timecardDraft = [];
  /** The missed-route prompt stays closed after Go back until this driver opens Leave Requested. */
  let leavePromptDismissed = false;
  /** Route and action chosen from a card. Other waits until the kind of work is chosen. */
  let pendingAction = '';
  let pendingRun = '';
  /** Comments typed on a card row before they are saved on the punch. */
  const noteDrafts = new Map();
  /** Reasons chosen on a card row before they are saved on the punch. */
  /** @type {Map<string, Array<{ id: string, label: string, hours: string, minutes: string }>>} */
  const reasonDrafts = new Map();
  /** Reason and time typed in the adder, before Add. */
  /** @type {Map<string, { id: string, hours: string, minutes: string }>} */
  const reasonPending = new Map();
  /** Phone link for each notes box, and the last revision applied on this clock. */
  /** @type {Map<string, string>} */
  const noteShareTokens = new Map();
  /** @type {Map<string, { revision: number, note: string, reasons: string }>} */
  const noteShareSeen = new Map();
  let noteShareSyncing = false;
  let applyingSharedNote = false;
  /** True while the card is being redrawn, so blur from the old row does not save. */
  let paintingCard = false;
  /** @type {{ action: 'in' | 'out', run: string } | null} */
  let replacePending = null;
  const reasonForm = document.querySelector('#reason-form');
  const reasonLabel = document.querySelector('#reason-label');
  const reasonList = document.querySelector('#reason-list');
  const kioskReason = document.querySelector('#kiosk-reason');
  const kioskReasonPicks = document.querySelector('#kiosk-reason-picks');
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let clockTimer;
  /** Calendar day the roster clock-ins were built for. */
  let rosterDate = '';

  const lateFlashForm = document.querySelector('#late-flash-form');
  const lateFlashMinutes = document.querySelector('#late-flash-minutes');
  const earlyReleaseForm = document.querySelector('#early-release-form');
  const earlyReleaseSchools = document.querySelector('#early-release-schools');
  const earlyReleaseEmpty = document.querySelector('#early-release-empty');
  const nameSizeForm = document.querySelector('#name-size-form');
  const nameSizeInput = document.querySelector('#name-size');
  const punchSoundForm = document.querySelector('#punch-sound-form');
  const punchSoundIn = document.querySelector('#punch-sound-in');
  const punchSoundOut = document.querySelector('#punch-sound-out');
  const quarterClockForms = document.querySelectorAll('[data-quarter-clock-form]');
  const overtimeForms = document.querySelectorAll('[data-overtime-form]');
  const payDefaultsForm = document.querySelector('#pay-defaults-form');
  const payJobTitle = document.querySelector('#pay-job-title');
  const payLocation = document.querySelector('#pay-location');
  const payBrowser = document.querySelector('#pay-browser');
  let payMode = 'driver';
  let payDriverId = '';
  let payType = 'serial';
  let payFind = '';
  /** @type {{ kind: 'serial' | 'account', driverId: string, lineId: string } | null} */
  let payEdit = null;
  const substituteForm = document.querySelector('#substitute-form');
  const substituteNameInput = document.querySelector('#substitute-name');
  const substituteList = document.querySelector('#substitute-list');

  startButton.addEventListener('click', () => {
    startKiosk();
  });
  screenButton?.addEventListener('click', onStartAnotherScreen);
  kioskFill?.addEventListener('click', onFillScreen);
  document.addEventListener('fullscreenchange', updateFillButton);
  lockForm.addEventListener('submit', onSaveLock);
  lateFlashForm?.addEventListener('submit', onSaveLateFlash);
  document.querySelector('#paper-backup-reminder-form')?.addEventListener('submit', onSavePaperBackupReminder);
  earlyReleaseForm?.addEventListener('submit', onSaveEarlyRelease);
  quarterClockForms.forEach((form) => form.addEventListener('submit', onSaveQuarterClocks));
  overtimeForms.forEach((form) => form.addEventListener('submit', onSaveOvertimeRules));
  nameSizeForm?.addEventListener('submit', onSaveNameSize);
  punchSoundForm?.addEventListener('submit', onSavePunchSounds);
  document.querySelector('#punch-sound-preview-in')?.addEventListener('click', () => {
    playPunchSound(punchSoundIn instanceof HTMLSelectElement ? punchSoundIn.value : '');
  });
  document.querySelector('#punch-sound-preview-out')?.addEventListener('click', () => {
    playPunchSound(punchSoundOut instanceof HTMLSelectElement ? punchSoundOut.value : '');
  });
  payDefaultsForm?.addEventListener('submit', onSavePayDefaults);
  pinForm.addEventListener('submit', onSavePin);
  substituteForm?.addEventListener('submit', onSaveSubstitute);
  substituteList?.addEventListener('click', onRemoveSubstitute);
  reasonForm?.addEventListener('submit', onSaveReason);
  reasonList?.addEventListener('click', onRemoveReason);
  document.querySelector('#kiosk-add-reason')?.addEventListener('click', () => {
    const id = kioskReason?.value || '';
    if (!id || kioskReasonIds.includes(id)) return;
    kioskReasonIds.push(id);
    renderKioskReasons();
  });
  kioskBack?.addEventListener('click', () => showList());
  document.querySelector('#kiosk-done')?.addEventListener('click', () => showList());
  document.querySelector('#kiosk-substitute-back')?.addEventListener('click', () => showList());
  kioskSubstitute?.addEventListener('click', onSubstituteHeader);
  kioskPin.addEventListener('input', onPinInput);
  kioskPinForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    checkPin(pinDigits(kioskPin.value));
  });
  kioskConfirm?.addEventListener('click', hidePunchConfirm);
  kioskRunChoice?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.kiosk-card-reason')) return;
    const button = target ? target.closest('[data-punch]') : null;
    if (!(button instanceof HTMLButtonElement)) return;
    beginPunch(button.dataset.action || '', button.dataset.punch || '');
  });
  document.querySelector('#kiosk-work')?.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-work-action]') : null;
    if (!(button instanceof HTMLButtonElement) || pendingRun !== 'OTHER') return;
    pendingAction = button.dataset.workAction === 'out' ? 'out' : 'in';
    punch(pendingAction, 'OTHER');
  });
  document.querySelector('#kiosk-other-open')?.addEventListener('click', openOtherWork);
  document.querySelector('#kiosk-replace-yes')?.addEventListener('click', () => {
    const pending = replacePending;
    closeReplaceConfirm();
    if (!pending) return;
    punch(pending.action, pending.run, true);
  });
  document.querySelector('#kiosk-replace-no')?.addEventListener('click', () => closeReplaceConfirm());
  const leaveRequestButton = document.querySelector('#kiosk-leave-request');
  if (leaveRequestButton) leaveRequestButton.hidden = !LEAVE_REQUESTS_ENABLED;
  leaveRequestButton?.addEventListener('click', () => openLeaveRequest(''));
  document.querySelector('#kiosk-leave-request-back')?.addEventListener('click', () => {
    leavePromptDismissed = true;
    closeLeaveRequest();
  });
  document.querySelector('#kiosk-leave-request-date')?.addEventListener('change', refreshLeaveForm);
  document.querySelector('#kiosk-leave-request-run')?.addEventListener('change', refreshLeaveForm);
  document.querySelector('#kiosk-leave-request-save')?.addEventListener('click', saveLeaveFromKiosk);
  document.querySelector('#kiosk-timecard-open')?.addEventListener('click', showTimecardChoices);
  document.querySelector('#kiosk-timecard-back')?.addEventListener('click', leaveTimecard);
  document.querySelector('#kiosk-timecard-add')?.addEventListener('click', addTimecardRow);
  document.querySelector('#kiosk-timecard-skip')?.addEventListener('click', skipTimecard);
  document.querySelector('#kiosk-timecard-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveTimecard();
  });
  kioskWorkBack?.addEventListener('click', hideWorkTypes);
  kioskChunkOpen?.addEventListener('click', () => showChunkPanel(true));
  kioskChunkBack?.addEventListener('click', () => showChunkPanel(false));
  kioskChunkPairs?.addEventListener('click', onChunkPairClick);
  kioskChunkSave?.addEventListener('click', saveWorkChunk);
  fillWorkTypeChoices();
  kioskRunChoice?.addEventListener('input', (event) => {
    const area = event.target;
    if (!(area instanceof HTMLTextAreaElement) || !area.dataset.noteFor || !area.dataset.noteAction) return;
    if (area.value.length > NOTE_MAX) area.value = area.value.slice(0, NOTE_MAX);
    noteDrafts.set(`${area.dataset.noteFor}:${area.dataset.noteAction}`, area.value);
  });
  kioskRunChoice?.addEventListener('focusout', onNoteBlur);
  kioskActions?.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const errorId = target.name === 'kiosk-work' || target.name === 'kiosk-chunk-work' ? '#kiosk-work-error' : '';
    const error = target.name === 'kiosk-chunk-work' ? kioskChunkError : errorId ? document.querySelector(errorId) : null;
    if (target.name === 'kiosk-work' || target.name === 'kiosk-chunk-work') {
      syncTripTicketFields();
      if (target.value === TRIP_TICKET_WORK_TYPE) {
        const field = target.name === 'kiosk-chunk-work' ? kioskChunkTicket : kioskTripTicket;
        if (field instanceof HTMLInputElement) field.focus();
      }
    }
    if (!error) return;
    error.hidden = true;
    error.textContent = '';
  });
  kioskLeave.addEventListener('submit', onLeave);
  kioskLeaveBack?.addEventListener('click', exitKiosk);

  function state() {
    return readState() || {};
  }

  function pins() {
    const saved = state().clockPins;
    return saved && typeof saved === 'object' ? { ...saved } : {};
  }

  function lockCode() {
    const saved = String(state().clockLockCode || '').trim();
    return saved || DEFAULT_KIOSK_CODE;
  }

  function people() {
    return listPeople()
      .map((person) => ({
        id: String(person.id || '').trim(),
        name: String(person.name || '').trim(),
        routes: Array.isArray(person.routes) ? person.routes.filter(Boolean) : [],
        clockIns: Array.isArray(person.clockIns)
          ? person.clockIns.map((item) => String(item || '').trim()).filter(Boolean)
          : [],
        clockRuns: Array.isArray(person.clockRuns)
          ? person.clockRuns.map((item) => normalizePunchRun(item)).filter((run) => run && run !== 'OTHER')
          : [],
      }))
      .filter((person) => person.id && person.name)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  }

  function setOfficeStatus(message, kind = '') {
    if (!officeStatus) return;
    officeStatus.hidden = !message;
    officeStatus.textContent = message || '';
    officeStatus.className = `status${kind ? ` is-${kind}` : ''}`;
  }

  function fillLockField() {
    if (document.activeElement === lockInput) return;
    lockInput.value = lockCode();
  }

  function fillPinDrivers() {
    const current = pinDriver.value;
    const roster = people();
    pinDriver.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Choose a driver';
    pinDriver.append(blank);
    for (const person of roster) {
      const option = document.createElement('option');
      option.value = person.id;
      option.textContent = person.name;
      pinDriver.append(option);
    }
    if (roster.some((person) => person.id === current)) pinDriver.value = current;
  }

  function pinFor(driverId) {
    return driverClockPin(pins(), driverId);
  }

  function renderPinList() {
    const roster = people();
    pinList.replaceChildren();
    if (!roster.length) {
      const item = document.createElement('li');
      item.className = 'pin-empty';
      item.textContent = 'No drivers yet.';
      pinList.append(item);
      return;
    }
    for (const person of roster) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = person.name;
      const code = document.createElement('span');
      code.textContent = pinFor(person.id);
      item.append(name, code);
      pinList.append(item);
    }
  }

  function onSaveLock(event) {
    event.preventDefault();
    const code = lockInput.value.trim();
    if (!/^[A-Za-z0-9]{4,64}$/.test(code)) {
      setOfficeStatus('The Admin Lock Code needs 4 to 64 letters or numbers.', 'error');
      return;
    }
    const next = state();
    next.clockLockCode = code;
    writeState(next);
    setOfficeStatus('Admin Lock Code saved.', 'ok');
  }

  function fillPaperBackupReminder() {
    const input = document.querySelector('#paper-backup-reminders-setting');
    if (!(input instanceof HTMLInputElement) || document.activeElement === input) return;
    input.checked = normalizePaperBackup(state().paperBackup).reminders;
  }

  function onSavePaperBackupReminder(event) {
    event.preventDefault();
    const input = document.querySelector('#paper-backup-reminders-setting');
    if (!(input instanceof HTMLInputElement)) return;
    const next = state();
    const current = normalizePaperBackup(next.paperBackup);
    next.paperBackup = { ...current, reminders: input.checked };
    writeState(next);
    setOfficeStatus(
      input.checked ? 'Paper record reminders are on.' : 'Paper record reminders are off.',
      'ok'
    );
  }

  function fillLateFlash() {
    if (!lateFlashMinutes || document.activeElement === lateFlashMinutes) return;
    const minutes = normalizeLateFlashMinutes(state().clockLateMinutes);
    lateFlashMinutes.value = minutes == null ? '' : String(minutes);
  }

  function onSaveLateFlash(event) {
    event.preventDefault();
    const raw = lateFlashMinutes?.value.trim() ?? '';
    if (raw !== '' && (!/^\d+$/.test(raw) || Number(raw) > 240)) {
      setOfficeStatus('Enter a whole number from 0 to 240, or leave the box blank to turn flashing off.', 'error');
      return;
    }
    const next = state();
    next.clockLateMinutes = raw === '' ? null : Number(raw);
    writeState(next);
    if (raw === '') setOfficeStatus('Driver names will stay steady.', 'ok');
    else if (raw === '0') setOfficeStatus('Names flash when a route clock-in time arrives and that driver has not clocked in.', 'ok');
    else setOfficeStatus(`Names flash ${raw} minutes after a route clock-in if that driver has not clocked in.`, 'ok');
    refresh();
  }

  function fillEarlyRelease() {
    if (!earlyReleaseSchools) return;
    if (earlyReleaseForm?.contains(document.activeElement)) return;
    const codes = knownSchoolCodes(state().profiles);
    const saved = normalizeEarlyReleaseTimes(state().clockEarlyReleaseTimes);
    earlyReleaseSchools.replaceChildren();
    if (earlyReleaseEmpty) earlyReleaseEmpty.hidden = codes.length > 0;
    for (const code of codes) {
      const field = document.createElement('div');
      field.className = 'early-release-school';
      const label = document.createElement('label');
      const inputId = `early-release-${code}`;
      label.htmlFor = inputId;
      label.textContent = code;
      const input = document.createElement('input');
      input.id = inputId;
      input.type = 'time';
      input.step = '60';
      input.required = true;
      input.dataset.schoolCode = code;
      input.value = toTimeInputValue(saved[code] || EARLY_RELEASE_DEFAULT_CLOCK);
      field.append(label, input);
      earlyReleaseSchools.append(field);
    }
  }

  function onSaveEarlyRelease(event) {
    event.preventDefault();
    /** @type {Record<string, string>} */
    const times = {};
    const inputs = earlyReleaseSchools?.querySelectorAll('[data-school-code]') ?? [];
    for (const input of inputs) {
      if (!(input instanceof HTMLInputElement)) continue;
      const code = input.dataset.schoolCode || '';
      const raw = input.value.trim();
      const saved = normalizeEarlyReleaseTimes({ [code]: raw || EARLY_RELEASE_DEFAULT_CLOCK });
      if (!saved[code]) {
        setOfficeStatus(`Enter a clock time for ${code}.`, 'error');
        return;
      }
      times[code] = saved[code];
    }
    const next = state();
    next.clockEarlyReleaseTimes = times;
    writeState(next);
    const count = Object.keys(times).length;
    setOfficeStatus(
      count
        ? `Early release times saved for ${count} schools. On those days, PM names flash from the first school on the route.`
        : 'Early release times saved.',
      'ok'
    );
    refresh();
  }

  function fillQuarterClocks() {
    const mode = clockRoundingMode(state());
    document.querySelectorAll('[data-quarter-clock-form]').forEach((form) => {
      if (!(form instanceof HTMLElement) || form.contains(document.activeElement)) return;
      const input = form.querySelector(`[data-quarter-clocks][value="${mode}"]`);
      if (input instanceof HTMLInputElement) input.checked = true;
    });
  }

  function onSaveQuarterClocks(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form instanceof HTMLElement ? form.querySelector('[data-quarter-clocks]:checked') : null;
    const mode = normalizeClockRounding(input instanceof HTMLInputElement ? input.value : 'snap');
    const next = state();
    next.clockRounding = mode;
    next.clockQuarterHourClocks = mode === 'snap';
    writeState(next);
    fillQuarterClocks();
    setFormStatus(form, clockRoundingStatus(mode), 'ok');
  }

  /**
   * @param {'snap' | 'daily' | 'separate'} mode
   */
  function clockRoundingStatus(mode) {
    if (mode === 'daily') {
      return 'Each clock stays on the minute it was punched. The daily total rounds to the nearest quarter hour.';
    }
    if (mode === 'separate') {
      return 'Each clock stays on the minute it was punched. Each clock span rounds to the nearest quarter hour.';
    }
    return 'Payroll minutes snap each clock to the nearest quarter hour. The Timeclock still shows the actual time.';
  }

  /**
   * Blank turns the rule off. Anything else must be a positive number up to max.
   * @param {HTMLInputElement | null} input
   * @param {number} max
   * @returns {number | null | undefined}
   */
  function readOvertimeHours(input, max) {
    const text = input?.value.trim() ?? '';
    if (!text) return null;
    const number = Number(text);
    if (!Number.isFinite(number) || number <= 0 || number > max) return undefined;
    return Math.round(number * 100) / 100;
  }

  /**
   * @param {ParentNode} form
   * @param {string} name
   */
  function overtimeField(form, name) {
    const field = form.querySelector(`[data-ot-${name}]`);
    return field instanceof HTMLInputElement ? field : null;
  }

  function fillOvertimeRules() {
    const rules = normalizeOvertimeRules(state().overtimeRules);
    const factor = String(rules.multiplier);
    document.querySelectorAll('[data-ot-rate]').forEach((option) => {
      if (!(option instanceof HTMLOptionElement)) return;
      option.value = factor;
      option.textContent = factor;
    });
    overtimeForms.forEach((form) => {
      if (!(form instanceof HTMLElement) || form.contains(document.activeElement)) return;
      const daily = overtimeField(form, 'daily');
      const weekly = overtimeField(form, 'weekly');
      const evening = overtimeField(form, 'evening');
      const morning = overtimeField(form, 'morning');
      const weekend = overtimeField(form, 'weekend');
      const holiday = overtimeField(form, 'holiday');
      const multiplier = overtimeField(form, 'multiplier');
      if (daily) daily.value = rules.dailyHours == null ? '' : String(rules.dailyHours);
      if (weekly) weekly.value = rules.weeklyHours == null ? '' : String(rules.weeklyHours);
      if (evening) evening.value = rules.eveningStart ? toTimeInputValue(rules.eveningStart) : '';
      if (morning) morning.value = rules.morningEnd ? toTimeInputValue(rules.morningEnd) : '';
      if (weekend) weekend.checked = rules.weekendOvertime;
      if (holiday) holiday.checked = rules.holidayOvertime;
      if (multiplier) multiplier.value = factor;
    });
  }

  function onSaveOvertimeRules(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const daily = overtimeField(form, 'daily');
    const weekly = overtimeField(form, 'weekly');
    const evening = overtimeField(form, 'evening');
    const morning = overtimeField(form, 'morning');
    const weekend = overtimeField(form, 'weekend');
    const holiday = overtimeField(form, 'holiday');
    const multiplier = overtimeField(form, 'multiplier');
    const dailyHours = readOvertimeHours(daily, 24);
    const weeklyHours = readOvertimeHours(weekly, 80);
    if (dailyHours === undefined || weeklyHours === undefined) {
      setFormStatus(form, 'Overtime hours need a positive number, or a blank box to turn that rule off.', 'error');
      return;
    }
    const typedMultiplier = Number(multiplier?.value.trim() ?? '');
    if (!Number.isFinite(typedMultiplier) || typedMultiplier < 1 || typedMultiplier > 3) {
      setFormStatus(form, 'The OT multiplier needs to be a number from 1 to 3.', 'error');
      return;
    }
    const rules = normalizeOvertimeRules({
      dailyHours,
      weeklyHours,
      eveningStart: evening?.value.trim() ?? '',
      morningEnd: morning?.value.trim() ?? '',
      weekendOvertime: Boolean(weekend?.checked),
      holidayOvertime: Boolean(holiday?.checked),
      multiplier: typedMultiplier,
    });
    const next = state();
    next.overtimeRules = rules;
    const defaults = normalizeClockPayDefaults(next.clockPayDefaults);
    defaults.lines = defaults.lines.map((line) => (line.otFactor > 0 ? { ...line, otFactor: rules.multiplier } : line));
    next.clockPayDefaults = defaults;
    writeState(next);
    fillOvertimeRules();
    setFormStatus(form, `Overtime rules saved. OT pay statuses use ${rules.multiplier}.`, 'ok');
    renderSummaryTools(true);
  }

  function fillPayDefaults() {
    const defaults = normalizeClockPayDefaults(state().clockPayDefaults);
    if (payJobTitle && document.activeElement !== payJobTitle) payJobTitle.value = defaults.jobTitle;
    if (payLocation && document.activeElement !== payLocation) payLocation.value = defaults.location;
  }

  function onSavePayDefaults(event) {
    event.preventDefault();
    const current = normalizeClockPayDefaults(state().clockPayDefaults);
    const next = state();
    next.clockPayDefaults = normalizeClockPayDefaults({
      jobTitle: payJobTitle?.value,
      location: payLocation?.value,
      lines: current.lines,
      periods: current.periods,
      periodEndsAt: current.periodEndsAt,
    });
    writeState(next);
    setOfficeStatus('Job title and location saved.', 'ok');
  }

  function payDrivers() {
    return driversFromState(state());
  }

  function payLineDefaults() {
    return normalizeClockPayDefaults(state().clockPayDefaults);
  }

  function visiblePayDrivers() {
    const needle = payFind.trim().toLowerCase();
    return payDrivers().filter((driver) => !needle || driver.name.toLowerCase().includes(needle));
  }

  function editingPay(kind, driverId = '', lineId = '') {
    return Boolean(
      payEdit && payEdit.kind === kind && payEdit.driverId === driverId && payEdit.lineId === lineId
    );
  }

  /**
   * @param {ReturnType<typeof payDrivers>[number]} driver
   * @param {{ serial?: string, rate?: string, account?: string, payStatuses?: string[], payStatusByRun?: object }} fields
   */
  function savePayIdentity(driver, fields) {
    saveDriver({
      id: driver.id,
      firstName: driver.firstName,
      lastName: driver.lastName,
      email: driver.email,
      phone: driver.phone,
      ...fields,
    });
  }

  /**
   * @param {string} name
   * @param {string} previous
   * @param {string} next
   */
  function confirmSerialChange(name, previous, next) {
    if (previous === next) return true;
    if (!next) return confirm(`Remove the serial number for ${name}${previous ? ` (${previous})` : ''}?`);
    if (!previous) return confirm(`Set the serial number for ${name} to ${next}?`);
    return confirm(`Change the serial number for ${name} from ${previous} to ${next}?`);
  }

  /**
   * @param {string} name
   * @param {string} previous
   * @param {string} next
   */
  function confirmAccountChange(name, previous, next) {
    if (previous === next) return true;
    if (!next) return confirm(`Remove the payroll account number for ${name}${previous ? ` (${previous})` : ''}?`);
    if (!previous) return confirm(`Set the payroll account number for ${name} to ${next}?`);
    return confirm(`Change the payroll account number for ${name} from ${previous} to ${next}?`);
  }

  /**
   * @param {'driver' | 'type'} mode
   * @param {string} label
   * @param {boolean} pressed
   */
  function modeButton(mode, label, pressed) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.dataset.payMode = mode;
    button.textContent = label;
    button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    return button;
  }

  /**
   * @param {string} type
   * @param {string} label
   * @param {boolean} pressed
   */
  function typeButton(type, label, pressed) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.dataset.payType = type;
    button.textContent = label;
    button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    return button;
  }

  /**
   * @param {string} kind
   * @param {string} driverId
   * @param {string} lineId
   * @param {string} label
   */
  function changeButton(kind, driverId, lineId, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.dataset.payChange = kind;
    button.dataset.driverId = driverId;
    button.dataset.lineId = lineId;
    button.textContent = label;
    return button;
  }

  /**
   * @param {'serial' | 'account'} kind
   * @param {string} driverId
   * @param {string} lineId
   * @param {string} current
   */
  function editForm(kind, driverId, lineId, current) {
    const form = document.createElement('form');
    form.className = 'pay-edit';
    form.dataset.paySave = kind;
    form.dataset.driverId = driverId;
    form.dataset.lineId = lineId;
    const input = document.createElement('input');
    input.name = 'value';
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = kind === 'serial' ? 20 : 40;
    input.value = current;
    input.setAttribute('aria-label', kind === 'serial' ? 'New serial number' : 'New payroll account number');
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = kind === 'serial' ? 'Save serial number' : 'Save payroll account number';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary';
    cancel.dataset.payCancel = '1';
    cancel.textContent = 'Cancel';
    form.append(input, save, cancel);
    return form;
  }

  /**
   * @param {ReturnType<typeof payDrivers>[number]} driver
   */
  function rateInput(driver) {
    const input = document.createElement('input');
    input.className = 'js-pay-rate';
    input.type = 'text';
    input.inputMode = 'decimal';
    input.maxLength = 7;
    input.autocomplete = 'off';
    input.dataset.driverId = driver.id;
    input.value = driver.pay?.rate || '';
    input.placeholder = '0.00';
    input.setAttribute('aria-label', `Hourly rate for ${driver.name}`);
    return input;
  }

  /**
   * @param {string} text
   */
  function valueText(text) {
    const node = document.createElement('span');
    node.className = 'pay-value';
    node.textContent = text || '—';
    return node;
  }

  function renderDriverPay(parent, driver) {
    const serial = document.createElement('div');
    serial.className = 'pay-fact';
    const serialHeading = document.createElement('h3');
    serialHeading.textContent = 'Serial number';
    serial.append(serialHeading);
    if (editingPay('serial', driver.id, '')) {
      serial.append(editForm('serial', driver.id, '', driver.pay?.serial || ''));
    } else {
      const row = document.createElement('div');
      row.className = 'pay-account-row';
      row.append(valueText(driver.pay?.serial || ''), changeButton('serial', driver.id, '', 'Change serial number'));
      serial.append(row);
    }
    const rate = document.createElement('div');
    rate.className = 'pay-fact';
    const rateHeading = document.createElement('h3');
    rateHeading.textContent = 'Hourly rate';
    rate.append(rateHeading, rateInput(driver));
    const statuses = document.createElement('div');
    statuses.className = 'pay-fact';
    const statusHeading = document.createElement('h3');
    statusHeading.textContent = 'Pay status';
    const statusNote = document.createElement('p');
    statusNote.className = 'field-hint';
    statusNote.textContent =
      'Check every pay status this driver can use. When more than one is checked, choose the pay status for each clock-in. One pay status is used for every clock-in.';
    const statusList = document.createElement('div');
    statusList.className = 'summary-statuses';
    const lines = payLineDefaults().lines;
    const chosen = new Set(driverPayStatusChoices(driver.payStatuses, lines).map((line) => line.id));
    for (const line of lines) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'js-driver-pay-status';
      input.dataset.driverId = driver.id;
      input.value = line.id;
      input.checked = chosen.has(line.id);
      label.append(input, document.createTextNode(` ${line.label}`));
      statusList.append(label);
    }
    statuses.append(statusHeading, statusNote, statusList);
    appendClockInPayMap(statuses, driver, driverPayStatusChoices(driver.payStatuses, lines));
    const account = document.createElement('div');
    account.className = 'pay-fact';
    const accountHeading = document.createElement('h3');
    accountHeading.textContent = 'Payroll account number';
    const accountNote = document.createElement('p');
    accountNote.className = 'field-hint';
    accountNote.textContent = "This number prints on this driver's Monthly Time Summary.";
    account.append(accountHeading, accountNote);
    if (editingPay('account', driver.id, '')) {
      account.append(editForm('account', driver.id, '', driver.pay?.account || ''));
    } else {
      const row = document.createElement('div');
      row.className = 'pay-account-row';
      row.append(
        valueText(driver.pay?.account || ''),
        changeButton('account', driver.id, '', 'Change payroll account number')
      );
      account.append(row);
    }
    parent.append(serial, rate, statuses, account);
  }

  function renderTypePay(parent) {
    const modes = document.createElement('div');
    modes.className = 'pay-modes';
    modes.append(
      typeButton('serial', 'Serial number', payType === 'serial'),
      typeButton('rate', 'Hourly rate', payType === 'rate'),
      typeButton('account', 'Payroll account number', payType === 'account')
    );
    parent.append(modes);
    if (payType === 'account') {
      const note = document.createElement('p');
      note.className = 'field-hint';
      note.textContent = "Each driver has one payroll account number. It prints on that driver's Monthly Time Summary.";
      parent.append(note);
    }
    const findLabel = document.createElement('label');
    findLabel.htmlFor = 'pay-find';
    findLabel.textContent = 'Find a driver';
    const find = document.createElement('input');
    find.id = 'pay-find';
    find.type = 'search';
    find.value = payFind;
    find.autocomplete = 'off';
    parent.append(findLabel, find);
    const drivers = visiblePayDrivers();
    const scroll = document.createElement('div');
    scroll.className = 'pay-scroll';
    const table = document.createElement('table');
    table.className = 'pay-type-sheet';
    const head = document.createElement('tr');
    const driverHead = document.createElement('th');
    driverHead.textContent = 'Driver';
    head.append(driverHead);
    const cell = document.createElement('th');
    cell.textContent =
      payType === 'rate' ? 'Hourly rate' : payType === 'account' ? 'Payroll account number' : 'Serial number';
    head.append(cell);
    if (payType === 'serial' || payType === 'account') {
      const action = document.createElement('th');
      action.textContent = '';
      head.append(action);
    }
    const thead = document.createElement('thead');
    thead.append(head);
    const body = document.createElement('tbody');
    if (!drivers.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = payType === 'rate' ? 2 : 3;
      cell.textContent = payFind.trim() ? 'No driver matches that name.' : 'No drivers on the list yet.';
      row.append(cell);
      body.append(row);
    }
    for (const driver of drivers) {
      const row = document.createElement('tr');
      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = driver.name;
      row.append(name);
      if (payType === 'rate') {
        const cell = document.createElement('td');
        cell.append(rateInput(driver));
        row.append(cell);
      } else {
        const kind = payType === 'account' ? 'account' : 'serial';
        const current = kind === 'account' ? driver.pay?.account || '' : driver.pay?.serial || '';
        const cell = document.createElement('td');
        const action = document.createElement('td');
        if (editingPay(kind, driver.id, '')) {
          cell.colSpan = 2;
          cell.append(editForm(kind, driver.id, '', current));
          row.append(cell);
        } else {
          cell.append(valueText(current));
          action.append(changeButton(kind, driver.id, '', 'Change'));
          row.append(cell, action);
        }
      }
      body.append(row);
    }
    table.append(thead, body);
    scroll.append(table);
    parent.append(scroll);
  }

  function renderPayBrowser(force = false) {
    if (!payBrowser) return;
    const active = document.activeElement;
    if (!force && payBrowser.contains(active) && active?.id !== 'pay-find') return;
    const findFocused = active?.id === 'pay-find';
    const caret = findFocused && active instanceof HTMLInputElement ? active.selectionStart : null;
    payBrowser.replaceChildren();
    const modes = document.createElement('div');
    modes.className = 'pay-modes';
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', 'How to look up pay details');
    modes.append(
      modeButton('driver', 'By driver', payMode === 'driver'),
      modeButton('type', 'By type', payMode === 'type')
    );
    payBrowser.append(modes);
    const drivers = payDrivers();
    if (!drivers.some((driver) => driver.id === payDriverId)) payDriverId = drivers[0]?.id || '';
    if (payMode === 'driver') {
      const field = document.createElement('div');
      field.className = 'field';
      const label = document.createElement('label');
      label.htmlFor = 'pay-driver';
      label.textContent = 'Driver';
      const select = document.createElement('select');
      select.id = 'pay-driver';
      for (const driver of drivers) {
        const option = document.createElement('option');
        option.value = driver.id;
        option.textContent = driver.name;
        select.append(option);
      }
      select.value = payDriverId;
      field.append(label, select);
      payBrowser.append(field);
      const driver = drivers.find((item) => item.id === payDriverId);
      if (driver) renderDriverPay(payBrowser, driver);
      else {
        const empty = document.createElement('p');
        empty.textContent = 'No drivers on the list yet.';
        payBrowser.append(empty);
      }
    } else {
      renderTypePay(payBrowser);
    }
    if (findFocused) {
      const find = payBrowser.querySelector('#pay-find');
      if (find instanceof HTMLInputElement) {
        find.focus();
        if (caret != null) find.setSelectionRange(caret, caret);
      }
    }
  }

  payBrowser?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const mode = target.closest('[data-pay-mode]');
    if (mode instanceof HTMLElement && mode.dataset.payMode) {
      payMode = mode.dataset.payMode === 'type' ? 'type' : 'driver';
      payEdit = null;
      renderPayBrowser(true);
      return;
    }
    const type = target.closest('[data-pay-type]');
    if (type instanceof HTMLElement && type.dataset.payType) {
      payType = type.dataset.payType;
      payEdit = null;
      renderPayBrowser(true);
      return;
    }
    if (target.closest('[data-pay-cancel]')) {
      payEdit = null;
      renderPayBrowser(true);
      return;
    }
    const change = target.closest('[data-pay-change]');
    if (change instanceof HTMLElement) {
      payEdit = {
        kind: change.dataset.payChange === 'account' ? 'account' : 'serial',
        driverId: change.dataset.driverId || '',
        lineId: change.dataset.lineId || '',
      };
      renderPayBrowser(true);
      payBrowser.querySelector('.pay-edit input')?.focus();
    }
  });

  payBrowser?.addEventListener('submit', (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.classList.contains('pay-edit')) return;
    event.preventDefault();
    const nextValue = form.querySelector('input')?.value.trim() || '';
    const kind = form.dataset.paySave === 'account' ? 'account' : 'serial';
    const driver = payDrivers().find((item) => item.id === form.dataset.driverId);
    if (!driver) return;
    const previous = (kind === 'account' ? driver.pay?.account : driver.pay?.serial) || '';
    const confirmed =
      kind === 'account'
        ? confirmAccountChange(driver.name, previous, nextValue)
        : confirmSerialChange(driver.name, previous, nextValue);
    if (nextValue === previous || !confirmed) {
      if (nextValue === previous) {
        payEdit = null;
        renderPayBrowser(true);
      }
      return;
    }
    try {
      savePayIdentity(driver, kind === 'account' ? { account: nextValue } : { serial: nextValue });
    } catch (error) {
      setOfficeStatus(error.message, 'error');
      return;
    }
    payEdit = null;
    setOfficeStatus(
      kind === 'account'
        ? `Payroll account number saved for ${driver.name}.`
        : `Serial number saved for ${driver.name}.`,
      'ok'
    );
    renderPayBrowser(true);
  });

  payBrowser?.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === 'pay-driver' && target instanceof HTMLSelectElement) {
      payDriverId = target.value;
      payEdit = null;
      renderPayBrowser(true);
      return;
    }
    if (!target.classList.contains('js-pay-rate') || !(target instanceof HTMLInputElement)) return;
    const driver = payDrivers().find((item) => item.id === target.dataset.driverId);
    if (!driver) return;
    const raw = target.value.trim();
    const cleaned = normalizeDriverPay({ rate: raw }).rate;
    if (raw && !cleaned) {
      setOfficeStatus('Enter an hourly rate like 37.74.', 'error');
      target.value = driver.pay?.rate || '';
      return;
    }
    if (cleaned === (driver.pay?.rate || '')) return;
    try {
      savePayIdentity(driver, { rate: cleaned });
    } catch (error) {
      setOfficeStatus(error.message, 'error');
      return;
    }
    setOfficeStatus(`Hourly rate saved for ${driver.name}.`, 'ok');
  });

  payBrowser?.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.id !== 'pay-find') return;
    payFind = target.value;
    renderPayBrowser(true);
  });

  payBrowser?.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && savePayStatusRun(target)) return;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('js-driver-pay-status')) return;
    const driver = payDrivers().find((item) => item.id === target.dataset.driverId);
    if (!driver) return;
    const lines = payLineDefaults().lines;
    const current = new Set(driverPayStatusChoices(driver.payStatuses, lines).map((line) => line.id));
    if (target.checked) current.add(target.value);
    else current.delete(target.value);
    const next = lines.map((line) => line.id).filter((id) => current.has(id));
    if (!next.length) {
      target.checked = true;
      setOfficeStatus('Leave at least one pay status for this driver.', 'error');
      return;
    }
    try {
      savePayIdentity(driver, { payStatuses: next });
    } catch (error) {
      setOfficeStatus(error instanceof Error ? error.message : 'Could not save that pay status.', 'error');
      renderPayBrowser(true);
      return;
    }
    const labels = lines.filter((line) => next.includes(line.id)).map((line) => line.label);
    setOfficeStatus(payStatusSavedMessage(driver.name, labels), 'ok');
    renderPayBrowser(true);
    renderClockingDriverStatuses(true);
  });
  document.querySelector('#clocking-driver-statuses')?.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && savePayStatusRun(target)) return;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('js-driver-pay-status')) return;
    const driver = payDrivers().find((item) => item.id === target.dataset.driverId);
    if (!driver) return;
    const lines = payLineDefaults().lines;
    const current = new Set(driverPayStatusChoices(driver.payStatuses, lines).map((line) => line.id));
    if (target.checked) current.add(target.value);
    else current.delete(target.value);
    const next = lines.map((line) => line.id).filter((id) => current.has(id));
    if (!next.length) {
      target.checked = true;
      setOfficeStatus('Leave at least one pay status for this driver.', 'error');
      return;
    }
    try {
      savePayIdentity(driver, { payStatuses: next });
    } catch (error) {
      setOfficeStatus(error instanceof Error ? error.message : 'Could not save that pay status.', 'error');
      renderPayBrowser(true);
      renderClockingDriverStatuses(true);
      return;
    }
    const labels = lines.filter((line) => next.includes(line.id)).map((line) => line.label);
    setOfficeStatus(payStatusSavedMessage(driver.name, labels), 'ok');
    renderPayBrowser(true);
    renderClockingDriverStatuses(true);
  });

  const summaryForm = document.querySelector('#summary-maker-form');
  const summaryDriver = document.querySelector('#summary-driver');
  const summaryMonth = document.querySelector('#summary-month');
  const summaryPeriod = document.querySelector('#summary-period');
  const summaryStatuses = document.querySelector('#summary-statuses');
  const summaryStatus = document.querySelector('#summary-maker-status');
  const mathForm = document.querySelector('#math-maker-form');
  const mathDriver = document.querySelector('#math-driver');
  const mathPeriod = document.querySelector('#math-period');
  const mathStatus = document.querySelector('#math-maker-status');
  const mathButton = document.querySelector('#summary-math');
  const generateButton = document.querySelector('#summary-generate');
  let summaryDriverId = '';
  let summaryPeriodKey = '';
  let mathDriverId = '';
  let mathPeriodKey = '';
  /** @type {Set<string> | null} */
  let summaryChecked = null;
  const knownStatusIds = new Set();
  let summaryChecksReady = false;

  /**
   * @param {string} message
   * @param {'ok' | 'error'} [kind]
   */
  function setSummaryStatus(message, kind = 'ok') {
    if (!(summaryStatus instanceof HTMLElement)) return;
    summaryStatus.hidden = !message;
    summaryStatus.textContent = message || '';
    summaryStatus.classList.toggle('is-error', kind === 'error');
    summaryStatus.classList.toggle('is-ok', kind === 'ok' && Boolean(message));
  }

  /**
   * @param {string} message
   * @param {'ok' | 'error'} [kind]
   */
  function setMathStatus(message, kind = 'ok') {
    if (!(mathStatus instanceof HTMLElement)) return;
    mathStatus.hidden = !message;
    mathStatus.textContent = message || '';
    mathStatus.classList.toggle('is-error', kind === 'error');
    mathStatus.classList.toggle('is-ok', kind === 'ok' && Boolean(message));
  }

  /**
   * @param {EventTarget | null} form
   * @param {string} message
   * @param {'ok' | 'error'} [kind]
   */
  function setFormStatus(form, message, kind = 'ok') {
    const el = form instanceof HTMLElement ? form.querySelector('[data-form-status]') : null;
    if (!(el instanceof HTMLElement)) return;
    el.hidden = !message;
    el.textContent = message || '';
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-ok', kind === 'ok' && Boolean(message));
  }

  /**
   * @param {Element} host
   * @param {boolean} force
   */
  function skipHost(host, force) {
    const active = document.activeElement;
    return !force && (active instanceof HTMLInputElement || active instanceof HTMLSelectElement) && host.contains(active);
  }

  /**
   * @param {string} name
   * @param {string[]} labels
   */
  function payStatusSavedMessage(name, labels) {
    if (labels.length === 1) return `${name} uses ${labels[0]} for every clock-in.`;
    return `${name} can use ${labels.join(', ')}. Choose which clock-in uses each one.`;
  }

  /**
   * @param {HTMLElement} parent
   * @param {{ id: string, name: string, payStatusByRun?: object }} driver
   * @param {Array<{ id: string, label: string }>} choices
   */
  function appendClockInPayMap(parent, driver, choices) {
    if (choices.length < 2) {
      const note = document.createElement('p');
      note.className = 'field-hint';
      note.textContent = `Every clock-in uses ${choices[0]?.label || 'that pay status'}.`;
      parent.append(note);
      return;
    }
    const map = normalizePayStatusByRun(
      driver.payStatusByRun,
      choices.map((line) => line.id)
    );
    const grid = document.createElement('div');
    grid.className = 'pay-run-map';
    for (const type of CLOCK_IN_TYPES) {
      const label = document.createElement('label');
      label.append(document.createTextNode(type.label));
      const select = document.createElement('select');
      select.className = 'js-pay-status-run';
      select.dataset.driverId = driver.id;
      select.dataset.payRun = type.id;
      select.setAttribute('aria-label', `${type.label} pay status for ${driver.name}`);
      for (const line of choices) {
        const option = document.createElement('option');
        option.value = line.id;
        option.textContent = line.label;
        select.append(option);
      }
      select.value = map[type.id] || choices[0].id;
      label.append(select);
      grid.append(label);
    }
    parent.append(grid);
  }

  /**
   * @param {HTMLSelectElement} select
   */
  function savePayStatusRun(select) {
    if (!select.classList.contains('js-pay-status-run')) return false;
    const driver = payDrivers().find((item) => item.id === select.dataset.driverId);
    if (!driver) return true;
    const lines = payLineDefaults().lines;
    const choices = driverPayStatusChoices(driver.payStatuses, lines);
    const run = select.dataset.payRun || '';
    const type = CLOCK_IN_TYPES.find((item) => item.id === run);
    if (choices.length < 2 || !type || !choices.some((line) => line.id === select.value)) return true;
    const map = normalizePayStatusByRun(
      driver.payStatusByRun,
      choices.map((line) => line.id)
    );
    map[run] = select.value;
    try {
      savePayIdentity(driver, { payStatusByRun: map });
    } catch (error) {
      setOfficeStatus(error instanceof Error ? error.message : 'Could not save that pay status.', 'error');
      renderPayBrowser(true);
      renderClockingDriverStatuses(true);
      return true;
    }
    const line = choices.find((item) => item.id === select.value);
    setOfficeStatus(`${type.label} for ${driver.name} uses ${line?.label || 'that pay status'}.`, 'ok');
    return true;
  }

  /**
   * @param {Date} [date]
   */
  function monthValue(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * @param {Element | null} input
   */
  function monthPartsFrom(input) {
    const value = input instanceof HTMLInputElement ? input.value : '';
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    if (!Number.isInteger(year) || monthIndex < 0 || monthIndex > 11) return null;
    return { year, monthIndex };
  }

  function selectedMonthParts() {
    return monthPartsFrom(summaryMonth);
  }

  /**
   * @param {string} key
   */
  function periodKeyParts(key) {
    const match = /^(\d{4})-(\d{2})-([1-9])$/.exec(key);
    if (!match) return null;
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11) return null;
    return { year, monthIndex, periodId: match[3] };
  }

  /**
   * @param {Date} date
   * @param {Array<{ id: string, startDay: number, endDay: number }>} periods
   */
  function periodKeyForDate(date, periods) {
    const day = date.getDate();
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const period = periods.find((item) => day >= item.startDay && day <= Math.min(item.endDay, lastDay));
    if (!period) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${period.id}`;
  }

  /**
   * @param {string} key
   */
  /**
   * @param {Element | null} input
   * @param {string} key
   */
  function syncMonthInput(input, key) {
    const parts = periodKeyParts(key);
    if (!parts || !(input instanceof HTMLInputElement)) return;
    input.value = `${parts.year}-${String(parts.monthIndex + 1).padStart(2, '0')}`;
  }

  function syncSummaryMonth(key) {
    syncMonthInput(summaryMonth, key);
  }

  /**
   * Pay periods from this driver's first clock through the current month.
   * Pass a month to also include that month when it sits outside the clocks.
   * @param {{ name?: string } | undefined} driver
   * @param {Array<{ id: string, startDay: number, endDay: number }>} periods
   * @param {{ year: number, monthIndex: number } | null} [monthParts]
   */
  function summaryPeriodChoices(driver, periods, monthParts) {
    const name = String(driver?.name || '').trim().toLowerCase();
    const punches = name
      ? (state().punches || []).filter((punch) => String(punch.driver_name || '').trim().toLowerCase() === name)
      : [];
    const choices = payPeriodsForClocks(punches, periods, new Date());
    const parts = monthParts === undefined ? selectedMonthParts() : monthParts;
    if (parts) {
      for (const period of periods) {
        const row = describePayPeriod(parts.year, parts.monthIndex, period);
        if (row && !choices.some((choice) => choice.key === row.key)) choices.push(row);
      }
      choices.sort((left, right) => (left.key < right.key ? 1 : left.key > right.key ? -1 : 0));
    }
    return choices;
  }

  /**
   * @param {ReturnType<typeof payLineDefaults>['lines']} lines
   */
  function renderStatusChoices(lines) {
    if (!summaryStatuses) return;
    if (!summaryChecked) summaryChecked = new Set();
    const ids = new Set(lines.map((line) => line.id));
    if (!summaryChecksReady) {
      for (const id of ids) summaryChecked.add(id);
      summaryChecksReady = true;
    } else {
      for (const id of ids) {
        if (!knownStatusIds.has(id)) summaryChecked.add(id);
      }
      for (const id of [...summaryChecked]) {
        if (!ids.has(id)) summaryChecked.delete(id);
      }
    }
    knownStatusIds.clear();
    for (const id of ids) knownStatusIds.add(id);
    summaryStatuses.replaceChildren();
    for (const line of lines) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = line.id;
      input.checked = summaryChecked.has(line.id);
      label.append(input, document.createTextNode(line.label));
      summaryStatuses.append(label);
    }
  }

  /**
   * @param {ReturnType<typeof payLineDefaults>} defaults
   */
  function renderSummaryChoices(defaults) {
    const drivers = payDrivers();
    if (!drivers.some((driver) => driver.id === summaryDriverId)) summaryDriverId = drivers[0]?.id || '';
    if (summaryDriver instanceof HTMLSelectElement) {
      summaryDriver.replaceChildren();
      for (const driver of drivers) {
        const option = document.createElement('option');
        option.value = driver.id;
        option.textContent = driver.name;
        summaryDriver.append(option);
      }
      if (!drivers.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No drivers on the list yet';
        summaryDriver.append(option);
      }
      summaryDriver.value = summaryDriverId;
    }
    if (summaryMonth instanceof HTMLInputElement && !summaryMonth.value) summaryMonth.value = monthValue();
    if (summaryPeriod instanceof HTMLSelectElement) {
      const driver = drivers.find((item) => item.id === summaryDriverId);
      const choices = summaryPeriodChoices(driver, defaults.periods);
      if (!choices.some((choice) => choice.key === summaryPeriodKey)) {
        const todayKey = periodKeyForDate(new Date(), defaults.periods);
        summaryPeriodKey = choices.some((choice) => choice.key === todayKey) ? todayKey : choices[0]?.key || '';
      }
      summaryPeriod.replaceChildren();
      for (const choice of choices) {
        const option = document.createElement('option');
        option.value = choice.key;
        option.textContent = choice.label;
        summaryPeriod.append(option);
      }
      if (!choices.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No days in that period';
        summaryPeriod.append(option);
      }
      summaryPeriod.value = summaryPeriodKey;
      syncSummaryMonth(summaryPeriodKey);
    }
    renderStatusChoices(defaults.lines);
  }

  function exDriverOnlyDrivers() {
    const lines = payLineDefaults().lines;
    return payDrivers().filter((driver) => isExDriverOnly(driver.payStatuses, lines));
  }

  /**
   * @param {ReturnType<typeof payLineDefaults>} defaults
   */
  function renderMathChoices(defaults) {
    const drivers = exDriverOnlyDrivers();
    if (!drivers.some((driver) => driver.id === mathDriverId)) mathDriverId = drivers[0]?.id || '';
    if (mathDriver instanceof HTMLSelectElement) {
      mathDriver.replaceChildren();
      for (const driver of drivers) {
        const option = document.createElement('option');
        option.value = driver.id;
        option.textContent = driver.name;
        mathDriver.append(option);
      }
      if (!drivers.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No driver has only EX DRIVER';
        mathDriver.append(option);
      }
      mathDriver.value = mathDriverId;
    }
    const summaryReady = drivers.length > 0;
    if (mathButton instanceof HTMLButtonElement) mathButton.disabled = !summaryReady;
    if (generateButton instanceof HTMLButtonElement) generateButton.disabled = !summaryReady;
    if (mathPeriod instanceof HTMLSelectElement) {
      // This driver's clocks, route start, and contract changes, through this month.
      const driver = drivers.find((item) => item.id === mathDriverId);
      const choices = payPeriodsForDriver(state(), driver?.name || '', defaults.periods, new Date());
      if (!choices.some((choice) => choice.key === mathPeriodKey)) {
        const todayKey = periodKeyForDate(new Date(), defaults.periods);
        mathPeriodKey = choices.some((choice) => choice.key === todayKey) ? todayKey : choices[0]?.key || '';
      }
      mathPeriod.replaceChildren();
      for (const choice of choices) {
        const option = document.createElement('option');
        option.value = choice.key;
        option.textContent = choice.label;
        mathPeriod.append(option);
      }
      if (!choices.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No pay periods yet';
        mathPeriod.append(option);
      }
      mathPeriod.value = mathPeriodKey;
    }
    renderPayPeriodInfo();
  }

  function renderPayPeriodInfo() {
    const host = document.querySelector('#pay-period-info');
    if (!host) return;
    const drivers = exDriverOnlyDrivers();
    const driver = drivers.find((item) => item.id === mathDriverId);
    const picked = periodKeyParts(mathPeriodKey);
    const defaults = payLineDefaults();
    const period = picked ? defaults.periods.find((item) => item.id === picked.periodId) : null;
    if (!driver || !picked || !period) {
      host.textContent = drivers.length
        ? 'Choose a pay period.'
        : 'Driver Pay period info is only for a driver whose only pay status is EX DRIVER.';
      return;
    }
    const { options } = summaryOptions({ driver, picked, defaults, period }, ['ex-driver']);
    const math = buildMonthlySummaryMath(options);
    host.innerHTML = math.periods.length
      ? payPeriodInfoMarkup(math)
      : 'That pay period has no days in this month.';
  }

  /**
   * @param {ReturnType<typeof payLineDefaults>} defaults
   */
  /**
   * @param {ReturnType<typeof payLineDefaults>} defaults
   * @param {boolean} [force]
   */
  function renderPayPeriodRows(defaults, force = false) {
    document.querySelectorAll('[data-pay-period-rows]').forEach((host) => {
      if (skipHost(host, force)) return;
      host.replaceChildren();
      defaults.periods.forEach((period, index) => {
        const row = document.createElement('div');
        row.className = 'pay-period-row';
        row.dataset.periodId = period.id;
        const name = document.createElement('span');
        name.textContent = `Pay period ${index + 1}`;
        const startLabel = document.createElement('label');
        startLabel.append(document.createTextNode('From day '));
        const start = document.createElement('input');
        start.type = 'number';
        start.min = '1';
        start.max = '31';
        start.step = '1';
        start.name = 'start';
        start.value = String(period.startDay);
        start.setAttribute('aria-label', `Pay period ${index + 1} start day`);
        startLabel.append(start);
        const endLabel = document.createElement('label');
        endLabel.append(document.createTextNode('through day '));
        const end = document.createElement('input');
        end.type = 'number';
        end.min = '1';
        end.max = '31';
        end.step = '1';
        end.name = 'end';
        end.value = String(period.endDay);
        end.setAttribute('aria-label', `Pay period ${index + 1} end day`);
        endLabel.append(end);
        row.append(name, startLabel, endLabel);
        if (defaults.periods.length > 1) {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'secondary';
          remove.dataset.removePeriod = period.id;
          remove.textContent = 'Remove';
          row.append(remove);
        }
        host.append(row);
      });
    });
    document.querySelectorAll('[data-pay-period-ends-at]').forEach((input) => {
      if (!(input instanceof HTMLInputElement) || document.activeElement === input) return;
      input.value = defaults.periodEndsAt;
    });
  }

  /**
   * @param {ReturnType<typeof payLineDefaults>} defaults
   * @param {boolean} [force]
   */
  function renderPayStatusCatalog(defaults, force = false) {
    document.querySelectorAll('[data-pay-status-catalog]').forEach((catalog) => {
      if (skipHost(catalog, force)) return;
      catalog.replaceChildren();
      for (const line of defaults.lines) {
        const item = document.createElement('li');
        const name = document.createElement('strong');
        name.textContent = line.label;
        const detail = document.createElement('span');
        detail.textContent = `OT ${line.otFactor}`;
        item.append(name, detail);
        if (line.custom) {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'secondary';
          remove.dataset.removeStatus = line.id;
          remove.textContent = 'Remove';
          item.append(remove);
        }
        catalog.append(item);
      }
    });
  }

  /**
   * @param {boolean} [force]
   */
  function renderClockingDriverStatuses(force = false) {
    const host = document.querySelector('#clocking-driver-statuses');
    if (!host || skipHost(host, force)) return;
    host.replaceChildren();
    const lines = payLineDefaults().lines;
    for (const driver of payDrivers()) {
      const block = document.createElement('div');
      block.className = 'pay-fact';
      const heading = document.createElement('h3');
      heading.textContent = driver.name;
      const list = document.createElement('div');
      list.className = 'summary-statuses';
      const chosen = new Set(driverPayStatusChoices(driver.payStatuses, lines).map((line) => line.id));
      for (const line of lines) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'js-driver-pay-status';
        input.dataset.driverId = driver.id;
        input.value = line.id;
        input.checked = chosen.has(line.id);
        label.append(input, document.createTextNode(` ${line.label}`));
        list.append(label);
      }
      block.append(heading, list);
      appendClockInPayMap(block, driver, driverPayStatusChoices(driver.payStatuses, lines));
      host.append(block);
    }
  }

  /**
   * @param {boolean} [force]
   */
  function renderSummaryTools(force = false) {
    if (!summaryForm && !mathForm) return;
    const active = document.activeElement;
    const summaryBusy = !force && active instanceof HTMLInputElement && Boolean(summaryForm?.contains(active));
    const mathBusy = !force && active instanceof HTMLInputElement && Boolean(mathForm?.contains(active));
    const defaults = payLineDefaults();
    if (!summaryBusy) renderSummaryChoices(defaults);
    if (!mathBusy) renderMathChoices(defaults);
    renderPayPeriodRows(defaults, force);
    renderPayStatusCatalog(defaults, force);
    renderClockingDriverStatuses(force);
  }

  /**
   * @param {Element | null} host
   */
  function readPayPeriodRows(host) {
    /** @type {Array<{ id: string, startDay: number, endDay: number }>} */
    const rows = [];
    host?.querySelectorAll('.pay-period-row').forEach((row) => {
      if (!(row instanceof HTMLElement)) return;
      const start = row.querySelector('[name="start"]');
      const end = row.querySelector('[name="end"]');
      rows.push({
        id: row.dataset.periodId || '',
        startDay: start instanceof HTMLInputElement ? Number(start.value) : 0,
        endDay: end instanceof HTMLInputElement ? Number(end.value) : 0,
      });
    });
    return rows;
  }

  /**
   * @param {Array<{ id?: string, startDay: number, endDay: number }>} periods
   */
  function payPeriodError(periods) {
    if (!periods.length) return 'Add at least one pay period.';
    if (periods.length > 6) return 'Six pay periods is the limit.';
    let cursor = 1;
    for (const period of periods) {
      const start = Number(period.startDay);
      const end = Number(period.endDay);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 31 || end < start) {
        return 'Each pay period needs a start day and an end day from 1 to 31.';
      }
      if (start < cursor) return 'Pay periods have to follow one another without overlapping days.';
      cursor = end + 1;
    }
    return '';
  }

  /**
   * @param {Array<{ id?: string, startDay: number, endDay: number }>} periods
   * @param {string} message
   * @param {EventTarget | null} [form]
   */
  function savePayPeriods(periods, message, form) {
    const problem = payPeriodError(periods);
    if (problem) {
      setFormStatus(form, problem, 'error');
      return;
    }
    const current = payLineDefaults();
    const endsInput = form instanceof HTMLFormElement ? form.querySelector('[data-pay-period-ends-at]') : null;
    const next = state();
    next.clockPayDefaults = normalizeClockPayDefaults({
      ...current,
      periods: normalizePayPeriods(periods),
      periodEndsAt: endsInput instanceof HTMLInputElement ? endsInput.value : current.periodEndsAt,
    });
    writeState(next);
    setFormStatus(form, message, 'ok');
    renderSummaryTools(true);
  }

  function summarySelection() {
    const drivers = payDrivers();
    const driver = drivers.find((item) => item.id === summaryDriverId);
    if (!driver) {
      setSummaryStatus('Choose a driver.', 'error');
      return null;
    }
    const picked = periodKeyParts(summaryPeriodKey);
    if (!picked) {
      setSummaryStatus('Choose a pay period.', 'error');
      return null;
    }
    const defaults = payLineDefaults();
    const period = defaults.periods.find((item) => item.id === picked.periodId);
    if (!period) {
      setSummaryStatus('Choose a pay period.', 'error');
      return null;
    }
    return { driver, picked, defaults, period };
  }

  /**
   * @param {{ driver: { name: string, id: string, email?: string, pay?: object }, picked: { year: number, monthIndex: number }, defaults: object, period: { id: string } }} selection
   * @param {string[] | undefined} lineIds
   */
  function summaryOptions(selection, lineIds) {
    const saved = state();
    return {
      saved,
      options: {
        driverName: selection.driver.name,
        driverId: selection.driver.id,
        email: selection.driver.email,
        pay: selection.driver.pay,
        defaults: selection.defaults,
        edits: saved.timeSummaryEdits,
        punches: saved.punches,
        officeState: saved,
        rounding: clockRoundingMode(saved),
        roundClocks: clockRoundingMode(saved),
        overtimeRules: saved.overtimeRules,
        focus: {
          year: selection.picked.year,
          monthIndex: selection.picked.monthIndex,
          periodId: selection.period.id,
          ...(lineIds ? { lineIds } : {}),
        },
      },
    };
  }

  function onMakeSummary(event) {
    event.preventDefault();
    const selection = summarySelection();
    if (!selection) return;
    const lineIds = [...(summaryChecked || [])].filter((id) => selection.defaults.lines.some((line) => line.id === id));
    if (!lineIds.length) {
      setSummaryStatus('Choose at least one pay status.', 'error');
      return;
    }
    const { options } = summaryOptions(selection, lineIds);
    const summary = buildMonthlyTimeSummary(options);
    if (!summary.periods.length) {
      setSummaryStatus('That pay period has no days in this month.', 'error');
      return;
    }
    sessionStorage.setItem('teamster-monthly-summary', renderMonthlyTimeSummaryHtml(summary));
    const opened = window.open('monthly-summary.html', 'teamster-monthly-summary');
    if (!opened) {
      setSummaryStatus('Allow pop-up windows for this site, then make the summary again.', 'error');
      return;
    }
    setSummaryStatus(`Opened the Monthly Time Summary for ${selection.driver.name}.`, 'ok');
  }

  function mathSelection() {
    const drivers = exDriverOnlyDrivers();
    const driver = drivers.find((item) => item.id === mathDriverId);
    if (!driver || !isExDriverOnly(driver.payStatuses, payLineDefaults().lines)) {
      setMathStatus(
        drivers.length
          ? 'Choose a driver whose only pay status is EX DRIVER.'
          : 'Driver Pay period info is only for a driver whose only pay status is EX DRIVER.',
        'error'
      );
      return null;
    }
    const picked = periodKeyParts(mathPeriodKey);
    if (!picked) {
      setMathStatus('Choose a pay period.', 'error');
      return null;
    }
    const defaults = payLineDefaults();
    const period = defaults.periods.find((item) => item.id === picked.periodId);
    if (!period) {
      setMathStatus('Choose a pay period.', 'error');
      return null;
    }
    return { driver, picked, defaults, period };
  }

  function onMakeSummaryMath(event) {
    event.preventDefault();
    const selection = mathSelection();
    if (!selection) return;
    const { options } = summaryOptions(selection, ['ex-driver']);
    const math = buildMonthlySummaryMath(options);
    if (!math.periods.length) {
      setMathStatus('That pay period has no days in this month.', 'error');
      return;
    }
    const mathHtml = renderMonthlySummaryMathHtml(math);
    localStorage.setItem('teamster-monthly-summary-math-model', JSON.stringify(math));
    localStorage.setItem('teamster-monthly-summary-math', mathHtml);
    sessionStorage.setItem('teamster-monthly-summary-math', mathHtml);
    const opened = window.open(
      `monthly-summary-math.html?t=${Date.now()}`,
      'teamster-monthly-summary-math'
    );
    if (!opened) {
      setMathStatus('Allow pop-up windows for this site, then open Driver Pay period info again.', 'error');
      return;
    }
    setMathStatus(`Opened Driver Pay period info for ${selection.driver.name}.`, 'ok');
  }

  function onGenerateSummary(event) {
    event.preventDefault();
    const selection = mathSelection();
    if (!selection) return;
    const lineIds = driverPayStatusChoices(selection.driver.payStatuses, selection.defaults.lines).map((line) => line.id);
    if (!lineIds.length) {
      setMathStatus('That driver has no pay status.', 'error');
      return;
    }
    const { options } = summaryOptions(selection, lineIds);
    const summary = buildMonthlyTimeSummary(options);
    if (!summary.periods.length) {
      setMathStatus('That pay period has no days in this month.', 'error');
      return;
    }
    const summaryHtml = renderMonthlyTimeSummaryHtml(summary);
    localStorage.setItem('teamster-monthly-summary', summaryHtml);
    sessionStorage.setItem('teamster-monthly-summary', summaryHtml);
    const opened = window.open(`monthly-summary.html?t=${Date.now()}`, 'teamster-monthly-summary');
    if (!opened) {
      setMathStatus('Allow pop-up windows for this site, then generate the summary again.', 'error');
      return;
    }
    setMathStatus(`Opened the Monthly Time Summary for ${selection.driver.name}.`, 'ok');
  }

  summaryDriver?.addEventListener('change', () => {
    if (summaryDriver instanceof HTMLSelectElement) summaryDriverId = summaryDriver.value;
    summaryPeriodKey = '';
    renderSummaryChoices(payLineDefaults());
  });
  summaryMonth?.addEventListener('change', () => {
    const parts = selectedMonthParts();
    const defaults = payLineDefaults();
    if (parts) summaryPeriodKey = `${parts.year}-${String(parts.monthIndex + 1).padStart(2, '0')}-${defaults.periods[0]?.id || '1'}`;
    renderSummaryTools(true);
  });
  summaryPeriod?.addEventListener('change', () => {
    if (summaryPeriod instanceof HTMLSelectElement) summaryPeriodKey = summaryPeriod.value;
    syncSummaryMonth(summaryPeriodKey);
  });
  summaryStatuses?.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !summaryChecked) return;
    if (input.checked) summaryChecked.add(input.value);
    else summaryChecked.delete(input.value);
  });
  summaryForm?.addEventListener('submit', onMakeSummary);
  mathDriver?.addEventListener('change', () => {
    if (mathDriver instanceof HTMLSelectElement) mathDriverId = mathDriver.value;
    mathPeriodKey = '';
    renderMathChoices(payLineDefaults());
  });
  mathPeriod?.addEventListener('change', () => {
    if (mathPeriod instanceof HTMLSelectElement) mathPeriodKey = mathPeriod.value;
    renderMathChoices(payLineDefaults());
  });
  mathForm?.addEventListener('submit', (event) => {
    const submitter = event.submitter;
    if (submitter instanceof HTMLButtonElement && submitter.id === 'summary-generate') {
      onGenerateSummary(event);
      return;
    }
    onMakeSummaryMath(event);
  });
  document.querySelectorAll('[data-pay-period-form]').forEach((form) => {
    form.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !(form instanceof HTMLFormElement)) return;
      const host = form.querySelector('[data-pay-period-rows]');
      if (target.closest('[data-pay-period-split]')) {
        savePayPeriods(
          DEFAULT_PAY_PERIODS,
          'Pay periods are days 1–15 and days 16 through the end of the month.',
          form
        );
        return;
      }
      if (target.closest('[data-pay-period-month]')) {
        savePayPeriods(WHOLE_MONTH_PAY_PERIODS, 'The pay period is days 1 through the end of the month.', form);
        return;
      }
      if (target.closest('[data-pay-period-add]')) {
        const rows = readPayPeriodRows(host);
        const last = rows[rows.length - 1];
        if (!last || Number(last.endDay) >= 31) {
          setFormStatus(form, 'The last pay period already runs through day 31.', 'error');
          return;
        }
        rows.push({ id: '', startDay: Number(last.endDay) + 1, endDay: 31 });
        savePayPeriods(rows, 'Pay period added.', form);
        return;
      }
      const remove = target.closest('[data-remove-period]');
      if (!(remove instanceof HTMLElement)) return;
      const rows = readPayPeriodRows(host).filter((row) => row.id !== remove.dataset.removePeriod);
      savePayPeriods(rows, 'Pay period removed.', form);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!(form instanceof HTMLFormElement)) return;
      savePayPeriods(readPayPeriodRows(form.querySelector('[data-pay-period-rows]')), 'Pay period dates saved.', form);
    });
  });
  document.querySelectorAll('[data-pay-status-form]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!(form instanceof HTMLFormElement)) return;
      const labelInput = form.querySelector('[data-pay-status-label]');
      const otInput = form.querySelector('[data-pay-status-ot]');
      const label = labelInput instanceof HTMLInputElement ? labelInput.value.trim() : '';
      if (!label) {
        setFormStatus(form, 'Enter a name for the pay status.', 'error');
        return;
      }
      const defaults = payLineDefaults();
      if (defaults.lines.some((line) => line.label.toLowerCase() === label.toLowerCase())) {
        setFormStatus(form, `${label} is already a pay status.`, 'error');
        return;
      }
      const otFactor = otInput instanceof HTMLSelectElement ? otInput.value : '0';
      const next = state();
      next.clockPayDefaults = normalizeClockPayDefaults({
        ...defaults,
        lines: [...defaults.lines, { label, otFactor }],
      });
      writeState(next);
      if (labelInput instanceof HTMLInputElement) labelInput.value = '';
      if (otInput instanceof HTMLSelectElement) otInput.value = '0';
      setFormStatus(form, `${label} added. Choose it when you make a Monthly Time Summary.`, 'ok');
      renderSummaryTools(true);
    });
  });
  document.querySelector('#payroll-tools')?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('[data-payroll-tool]');
    if (!(button instanceof HTMLButtonElement)) return;
    const opening = button.getAttribute('aria-expanded') !== 'true';
    document.querySelectorAll('[data-payroll-tool]').forEach((item) => {
      if (!(item instanceof HTMLButtonElement)) return;
      const panel = document.getElementById(item.getAttribute('aria-controls') || '');
      const selected = opening && item === button;
      item.setAttribute('aria-expanded', selected ? 'true' : 'false');
      if (panel) panel.hidden = !selected;
    });
  });
  document.querySelectorAll('[data-pay-status-catalog]').forEach((catalog) => {
    catalog.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest('[data-remove-status]');
      if (!(button instanceof HTMLElement)) return;
      const defaults = payLineDefaults();
      const line = defaults.lines.find((item) => item.id === button.dataset.removeStatus);
      if (!line?.custom) return;
      if (!confirm(`Remove the ${line.label} pay status?`)) return;
      const next = state();
      next.clockPayDefaults = normalizeClockPayDefaults({
        ...defaults,
        lines: defaults.lines.filter((item) => item.id !== line.id),
      });
      writeState(next);
      const panel = catalog.closest('.payroll-tool-panel, #timeclock-settings-view');
      setFormStatus(panel?.querySelector('[data-pay-status-form]') || null, `${line.label} removed.`, 'ok');
      renderSummaryTools(true);
    });
  });
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.type !== 'teamster-time-summary') return;
    saveTimeSummaryEdit({
      driverId: data.driverId,
      periodKey: data.periodKey,
      lineId: data.lineId,
      kind: data.kind,
      day: data.day,
      hours: data.hours,
      comment: data.comment,
    });
  });

  function fillNameSize() {
    if (!nameSizeInput || document.activeElement === nameSizeInput) return;
    nameSizeInput.value = normalizeClockNameSize(state().clockNameSize) || 'regular';
  }

  function applyNameSize() {
    const size = normalizeClockNameSize(state().clockNameSize) || 'regular';
    kioskRoster.classList.toggle('is-compact', size === 'compact');
    kioskRoster.classList.toggle('is-large', size === 'large');
  }

  let rosterFitKey = '';

  function fitRoster() {
    if (kiosk.hidden || kioskList.hidden) return;
    const count = kioskRoster.querySelectorAll('.kiosk-name').length;
    if (!count) {
      rosterFitKey = '';
      kioskRoster.classList.remove('is-fitted', 'is-scroll');
      kioskRoster.style.removeProperty('grid-template-columns');
      kioskRoster.style.removeProperty('grid-template-rows');
      kioskRoster.style.removeProperty('grid-auto-rows');
      kioskRoster.style.removeProperty('column-gap');
      kioskRoster.style.removeProperty('row-gap');
      kioskRoster.style.removeProperty('align-content');
      kioskRoster.style.removeProperty('font-size');
      return;
    }
    const width = kioskRoster.clientWidth;
    const height = kioskRoster.clientHeight;
    if (width < 40 || height < 40) return;
    const size = normalizeClockNameSize(state().clockNameSize) || 'regular';
    const layout = kioskRosterLayout({
      count,
      width,
      height,
      gap: ROSTER_GAP_PX,
      size,
    });
    if (!layout) return;
    const fitKey = `${size}:${count}:${layout.columns}:${layout.rows}:${layout.scroll}:${Math.round(layout.buttonHeight)}:${Math.round(layout.rowGap)}:${Math.round(width)}x${Math.round(height)}`;
    if (fitKey !== rosterFitKey) {
      rosterFitKey = fitKey;
      kioskRoster.classList.add('is-fitted');
      kioskRoster.classList.toggle('is-scroll', layout.scroll);
      kioskRoster.style.columnGap = `${ROSTER_GAP_PX}px`;
      kioskRoster.style.rowGap = `${layout.rowGap}px`;
      kioskRoster.style.alignContent = 'start';
      if (layout.scroll) {
        const btnW = (width - ROSTER_GAP_PX * (layout.columns - 1)) / layout.columns;
        kioskRoster.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(1in, 1fr))`;
        kioskRoster.style.gridTemplateRows = 'none';
        kioskRoster.style.gridAutoRows = `${Math.round(layout.buttonHeight)}px`;
        kioskRoster.style.fontSize = `${Math.round(rosterButtonFont(btnW, layout.buttonHeight))}px`;
      } else {
        kioskRoster.style.removeProperty('grid-auto-rows');
        kioskRoster.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(0, 1fr))`;
        kioskRoster.style.gridTemplateRows = `repeat(${layout.rows}, ${layout.buttonHeight}px)`;
        const btnW = (kioskRoster.clientWidth - ROSTER_GAP_PX * (layout.columns - 1)) / layout.columns;
        kioskRoster.style.fontSize = `${Math.round(rosterButtonFont(btnW, layout.buttonHeight))}px`;
      }
    }
    fitNameButtons();
  }

  function fitNameButtons() {
    for (const button of kioskRoster.querySelectorAll('.kiosk-name')) {
      if (!(button instanceof HTMLButtonElement)) continue;
      const label = button.querySelector('.kiosk-name-label');
      const name = button.querySelector('.kiosk-name-regular');
      if (!(label instanceof HTMLElement) || !(name instanceof HTMLElement)) continue;
      name.style.fontSize = '';
      const extras = [...label.querySelectorAll('.kiosk-name-sub, .kiosk-name-route')];
      const gap = Number.parseFloat(getComputedStyle(label).rowGap) || 0;
      const extraHeight =
        extras.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0) + gap * extras.length;
      const available = label.clientHeight - extraHeight;
      if (available <= 4) continue;
      const inherited = Math.round(Number.parseFloat(getComputedStyle(name).fontSize) || 14);
      let size = inherited;
      const min = 10;
      name.style.display = 'block';
      name.style.webkitLineClamp = 'unset';
      name.style.overflow = 'visible';
      while (size > min && name.scrollHeight > available + 1) {
        size -= 1;
        name.style.fontSize = `${size}px`;
      }
      name.style.display = '';
      name.style.webkitLineClamp = '';
      name.style.overflow = '';
      while (size > min && (name.scrollHeight > name.clientHeight + 1 || name.scrollWidth > name.clientWidth + 1)) {
        size -= 1;
        name.style.fontSize = `${size}px`;
      }
      if (size === inherited) name.style.fontSize = '';
    }
  }

  function fillPunchSoundSelect(select, chosen) {
    if (!(select instanceof HTMLSelectElement) || document.activeElement === select) return;
    if (select.options.length !== PUNCH_SOUNDS.length + 1) {
      select.replaceChildren();
      const silent = document.createElement('option');
      silent.value = 'off';
      silent.textContent = 'Silent';
      select.append(silent);
      /** @type {Map<string, HTMLOptGroupElement>} */
      const groups = new Map();
      for (const sound of PUNCH_SOUNDS) {
        let group = groups.get(sound.group);
        if (!group) {
          group = document.createElement('optgroup');
          group.label = sound.group;
          select.append(group);
          groups.set(sound.group, group);
        }
        const option = document.createElement('option');
        option.value = sound.id;
        option.textContent = sound.label;
        group.append(option);
      }
    }
    select.value = chosen;
  }

  function fillPunchSounds() {
    const current = state();
    fillPunchSoundSelect(punchSoundIn, punchSoundFor(current.clockPunchSoundIn, DEFAULT_PUNCH_SOUND_IN));
    fillPunchSoundSelect(punchSoundOut, punchSoundFor(current.clockPunchSoundOut, DEFAULT_PUNCH_SOUND_OUT));
  }

  function onSavePunchSounds(event) {
    event.preventDefault();
    if (!(punchSoundIn instanceof HTMLSelectElement) || !(punchSoundOut instanceof HTMLSelectElement)) return;
    const next = state();
    next.clockPunchSoundIn = punchSoundFor(punchSoundIn.value, DEFAULT_PUNCH_SOUND_IN);
    next.clockPunchSoundOut = punchSoundFor(punchSoundOut.value, DEFAULT_PUNCH_SOUND_OUT);
    writeState(next);
    const inLabel = punchSoundIn.selectedOptions[0]?.textContent || 'Clock in';
    const outLabel = punchSoundOut.selectedOptions[0]?.textContent || 'Clock out';
    setOfficeStatus(`Punch sounds saved. Clock in plays ${inLabel}. Clock out plays ${outLabel}.`, 'ok');
  }

  function onSaveNameSize(event) {
    event.preventDefault();
    const size = normalizeClockNameSize(nameSizeInput?.value);
    if (!size) {
      setOfficeStatus('Choose a name badge size.', 'error');
      return;
    }
    const next = state();
    next.clockNameSize = size;
    writeState(next);
    applyNameSize();
    setOfficeStatus('Name badge size saved.', 'ok');
  }

  function catalog() {
    const saved = state().clockReasonCodes;
    return Array.isArray(saved) ? saved : [];
  }

  function renderReasonList() {
    if (!reasonList) return;
    reasonList.replaceChildren();
    const codes = catalog();
    if (!codes.length) {
      const item = document.createElement('li');
      item.className = 'pin-empty';
      item.textContent = 'No reason codes yet.';
      reasonList.append(item);
      return;
    }
    for (const code of codes) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = code.label;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.dataset.reasonId = code.id;
      remove.textContent = 'Remove';
      item.append(name, remove);
      reasonList.append(item);
    }
  }

  function fillKioskReasons() {
    if (!kioskReason) return;
    const current = kioskReason.value;
    kioskReason.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Choose a reason';
    kioskReason.append(blank);
    for (const code of catalog()) {
      const option = document.createElement('option');
      option.value = code.id;
      option.textContent = code.label;
      kioskReason.append(option);
    }
    if ([...kioskReason.options].some((option) => option.value === current)) {
      kioskReason.value = current;
    }
  }

  function renderKioskReasons() {
    if (!kioskReasonPicks) return;
    const labels = new Map(catalog().map((code) => [code.id, code.label]));
    kioskReasonPicks.replaceChildren();
    for (const id of kioskReasonIds) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = labels.get(id) || id;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        kioskReasonIds = kioskReasonIds.filter((itemId) => itemId !== id);
        renderKioskReasons();
      });
      item.append(name, remove);
      kioskReasonPicks.append(item);
    }
  }

  function onSaveReason(event) {
    event.preventDefault();
    const label = reasonLabel?.value.trim() || '';
    try {
      const next = state();
      next.clockReasonCodes = addReasonCode(catalog(), label);
      writeState(next);
      if (reasonLabel) reasonLabel.value = '';
      setOfficeStatus('Reason code added.', 'ok');
      refresh();
    } catch (error) {
      setOfficeStatus(error instanceof Error ? error.message : 'Could not add that reason code.', 'error');
    }
  }

  /**
   * @param {Event} event
   */
  function onRemoveReason(event) {
    const button = event.target instanceof Element ? event.target.closest('[data-reason-id]') : null;
    if (!button) return;
    const id = button.getAttribute('data-reason-id') || '';
    try {
      const next = state();
      next.clockReasonCodes = removeReasonCode(catalog(), id);
      writeState(next);
      setOfficeStatus('Reason code removed.', 'ok');
      refresh();
    } catch (error) {
      setOfficeStatus(error instanceof Error ? error.message : 'Could not remove that reason code.', 'error');
    }
  }

  function onSavePin(event) {
    event.preventDefault();
    const driverId = pinDriver.value.trim();
    const pin = pinValue.value.trim();
    const person = people().find((item) => item.id === driverId);
    if (!person) {
      setOfficeStatus('Choose a driver.', 'error');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setOfficeStatus('PIN must be 4 digits.', 'error');
      return;
    }
    const next = state();
    next.clockPins = { ...pins(), [driverId]: pin };
    writeState(next);
    pinValue.value = '';
    setOfficeStatus(`PIN saved for ${person.name}.`, 'ok');
    refresh();
  }

  function substituteDrivers() {
    const saved = state().clockSubstituteDrivers;
    return Array.isArray(saved) ? saved : [];
  }

  function renderSubstituteList() {
    if (!substituteList) return;
    const roster = [...substituteDrivers()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    );
    substituteList.replaceChildren();
    if (!roster.length) {
      const item = document.createElement('li');
      item.className = 'pin-empty';
      item.textContent = 'No substitute drivers yet.';
      substituteList.append(item);
      return;
    }
    for (const person of roster) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = person.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.dataset.substituteId = person.id;
      remove.textContent = 'Remove';
      item.append(name, remove);
      substituteList.append(item);
    }
  }

  function onSaveSubstitute(event) {
    event.preventDefault();
    const name = substituteNameInput?.value.trim() || '';
    if (!name || name.length > 80) {
      setOfficeStatus('Enter a name.', 'error');
      return;
    }
    if (substituteDrivers().some((person) => person.name.toLowerCase() === name.toLowerCase())) {
      setOfficeStatus('That name is already on the substitute list.', 'error');
      return;
    }
    const next = state();
    next.clockSubstituteDrivers = [...substituteDrivers(), { id: crypto.randomUUID(), name }];
    writeState(next);
    if (substituteNameInput) substituteNameInput.value = '';
    setOfficeStatus(`${name} can clock in as a substitute.`, 'ok');
    refresh();
  }

  /**
   * @param {Event} event
   */
  function onRemoveSubstitute(event) {
    const button = event.target instanceof Element ? event.target.closest('[data-substitute-id]') : null;
    if (!button) return;
    const id = button.getAttribute('data-substitute-id') || '';
    const next = state();
    next.clockSubstituteDrivers = substituteDrivers().filter((person) => person.id !== id);
    writeState(next);
    setOfficeStatus('Substitute driver removed.', 'ok');
    refresh();
  }

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let confirmTimer;

  /**
   * @param {string} name
   * @param {string} detail
   */
  function showPunchConfirm(name, detail) {
    if (!kioskConfirm || !kioskConfirmText) return;
    clearTimeout(confirmTimer);
    kioskConfirmText.replaceChildren();
    const nameLine = document.createElement('span');
    nameLine.className = 'kiosk-confirm-name';
    nameLine.textContent = name;
    const detailLine = document.createElement('span');
    detailLine.className = 'kiosk-confirm-detail';
    detailLine.textContent = detail;
    kioskConfirmText.append(nameLine, detailLine);
    kioskConfirm.hidden = false;
    confirmTimer = setTimeout(hidePunchConfirm, 2000);
  }

  function hidePunchConfirm() {
    clearTimeout(confirmTimer);
    if (kioskConfirm) kioskConfirm.hidden = true;
  }

  function pinDigits(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 4);
  }

  /** @type {Promise<string> | null} */
  let shareOriginPromise = null;
  let clockQrRequest = 0;
  let clockQrUrl = '';
  let noteDayToken = '';
  let noteDayUrlSeen = '';

  function loadShareOrigin() {
    if (!shareOriginPromise) {
      shareOriginPromise = fetch('/api/clock-share-origin')
        .then((response) => (response.ok ? response.json() : { origin: '' }))
        .then((body) => String(body?.origin || '').replace(/\/$/, ''))
        .catch(() => '');
    }
    return shareOriginPromise;
  }

  function hideClockQr() {
    clockQrRequest += 1;
    if (kioskClockQr) kioskClockQr.hidden = true;
    hideDayQr();
  }

  function hideDayQr() {
    noteDayUrlSeen = '';
    if (kioskDayQr) kioskDayQr.hidden = true;
  }

  /**
   * @param {{ id: string, name: string }} person
   */
  async function paintClockQr(person) {
    const request = ++clockQrRequest;
    if (!kioskClockQr || !(kioskClockQrCode instanceof HTMLCanvasElement) || !person?.name) {
      hideClockQr();
      return;
    }
    kioskClockQr.hidden = true;
    let origin = '';
    let token = '';
    try {
      [origin, token] = await Promise.all([
        loadShareOrigin(),
        ensureDriverClockLink(person.name),
      ]);
    } catch {
      origin = '';
      token = '';
    }
    if (request !== clockQrRequest) return;
    if (!selected || selected.id !== person.id || kioskActions.hidden) return;
    const url = clockShareUrl(origin, token);
    if (!url) return;
    if (clockQrUrl !== url) {
      try {
      await QRCode.toCanvas(kioskClockQrCode, url, {
        width: 288,
        margin: 1,
        color: { dark: '#102824', light: '#ffffff' },
      });
      } catch {
        return;
      }
      if (request !== clockQrRequest) return;
      clockQrUrl = url;
    }
    kioskClockQr.hidden = false;
  }

  function showList(message = '') {
    closeReplaceConfirm();
    if (selected) rememberLateVisit(selected);
    selected = null;
    substituteName = '';
    unlocked = false;
    kiosk.classList.remove('is-detail');
    kioskList.hidden = false;
    kioskDetail.hidden = true;
    kioskActions.hidden = true;
    hideClockQr();
    if (kioskCovering) kioskCovering.hidden = true;
    if (kioskSubstituteWho) kioskSubstituteWho.hidden = true;
    kioskPin.value = '';
    kioskReasonIds = [];
    clearKioskRun();
    clearKioskNote();
    closeChunkPanel();
    closeLeaveRequest();
    renderKioskReasons();
    if (kioskPinError) kioskPinError.textContent = '';
    if (kioskListStatus) kioskListStatus.textContent = message;
    if (kioskSubstitutes) kioskSubstitutes.hidden = true;
    syncSubstituteHeader();
    renderRoster();
  }

  function renderRoster() {
    rosterDate = localDateString();
    applyNameSize();
    const roster = people();
    kioskRoster.replaceChildren();
    if (!roster.length) {
      const empty = document.createElement('p');
      empty.className = 'kiosk-empty';
      empty.textContent = 'No drivers.';
      kioskRoster.append(empty);
      fitRoster();
      return;
    }
    const colors = ensureNameColors(people());
    for (const person of roster) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'kiosk-name';
      button.dataset.driverId = person.id;
      button.dataset.driverName = person.name;
      button.dataset.clockIns = person.clockIns.join(',');
      button.dataset.clockRuns = person.clockRuns.join(',');
      const paint = nameButtonColors(colors.get(person.id) ?? 0);
      button.dataset.frame = paint.look;
      button.style.setProperty('--name-bg', paint.background);
      button.style.setProperty('--name-border', paint.border);
      button.style.setProperty('--name-border-alt', paint.alt);
      button.style.setProperty('--name-frame', paint.frame);
      button.style.setProperty('--name-frame-2', paint.frame2);
      const covering = activeSubstitute(person.name);
      const latest = latestPunch(person.name);
      const status = latest?.action === 'in' ? 'in' : 'out';
      const label = document.createElement('span');
      label.className = 'kiosk-name-label';
      fillNameLabel(label, person, covering);
      button.dataset.spoken = spokenName(person, covering, status, latest);
      const badge = document.createElement('span');
      badge.className = `kiosk-status is-${status}`;
      badge.textContent = status === 'in' ? 'IN' : 'OUT';
      button.append(label, badge);
      paintLate(button, person);
      button.addEventListener('click', () => openDriver(person));
      kioskRoster.append(button);
    }
    fitRoster();
  }

  /**
   * Latest punch for this route driver. A substitute punch stays on that driver's name.
   * @param {string} name
   */
  function latestPunch(name) {
    const wanted = name.trim().toLowerCase();
    let latest = null;
    for (const punch of Array.isArray(state().punches) ? state().punches : []) {
      if (punch?.removed === true) continue;
      if (String(punch?.driver_name || '').trim().toLowerCase() !== wanted) continue;
      if (!latest || String(punch.punched_at) > String(latest.punched_at)) latest = punch;
    }
    return latest;
  }

  /**
   * The substitute covering this route, while their clock-in is still the latest punch.
   * @param {string} name
   */
  function activeSubstitute(name) {
    const latest = latestPunch(name);
    if (latest?.action !== 'in') return '';
    return String(latest.substitute_name || '').trim();
  }

  /**
   * @param {string} driverId
   */
  function acknowledgements(driverId) {
    const all = readLateAcks();
    const list = all[driverId];
    return Array.isArray(list) ? list.map((item) => String(item)) : [];
  }

  function readLateAcks() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(LATE_ACK_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed;
    } catch {
      return {};
    }
  }

  /**
   * Opening this driver and coming back clears every clock-in that is already late.
   * A later run can still flash when its own clock-in passes.
   * @param {{ id: string, name: string, clockIns: string[] }} person
   */
  function rememberLateVisit(person) {
    const current = people().find((item) => item.id === person.id) || person;
    const keys = dueClockInKeys({
      now: new Date(),
      graceMinutes: state().clockLateMinutes,
      clockIns: current.clockIns,
    });
    if (!keys.length) return;
    const today = keys[0].slice(0, 10);
    const all = readLateAcks();
    const prior = acknowledgements(person.id).filter((key) => key.startsWith(`${today}|`));
    all[person.id] = [...new Set([...prior, ...keys])];
    sessionStorage.setItem(LATE_ACK_KEY, JSON.stringify(all));
  }

  /**
   * @param {HTMLButtonElement} button
   * @param {{ id: string, name: string, clockIns: string[] }} person
   */
  function paintLate(button, person) {
    const late =
      flashingClockInKeys({
        now: new Date(),
        graceMinutes: state().clockLateMinutes,
        clockIns: person.clockIns,
        clockRuns: person.clockRuns,
        punches: Array.isArray(state().punches) ? state().punches : [],
        driverName: person.name,
        acknowledged: acknowledgements(person.id),
      }).length > 0;
    button.classList.toggle('is-late', late);
    const spoken = button.dataset.spoken || person.name;
    button.setAttribute('aria-label', late ? `${spoken}, late to clock in` : spoken);
  }

  function paintRosterLate() {
    if (kiosk.hidden || kioskList.hidden) return;
    const punches = Array.isArray(state().punches) ? state().punches : [];
    const graceMinutes = state().clockLateMinutes;
    const now = new Date();
    for (const button of kioskRoster.querySelectorAll('.kiosk-name')) {
      if (!(button instanceof HTMLButtonElement)) continue;
      const name = button.dataset.driverName || '';
      const next =
        flashingClockInKeys({
          now,
          graceMinutes,
          clockIns: (button.dataset.clockIns || '').split(',').filter(Boolean),
          clockRuns: (button.dataset.clockRuns || '').split(',').filter(Boolean),
          punches,
          driverName: name,
          acknowledged: acknowledgements(button.dataset.driverId || ''),
        }).length > 0;
      const spoken = button.dataset.spoken || name;
      const label = next ? `${spoken}, late to clock in` : spoken;
      if (button.classList.contains('is-late') === next && button.getAttribute('aria-label') === label) continue;
      button.classList.toggle('is-late', next);
      button.setAttribute('aria-label', label);
    }
  }

  /**
   * Portrait under the clocked-in or clocked-out line. Hidden when this driver has none.
   * @param {string} name
   */
  function paintDriverPhoto(name) {
    if (!(kioskDriverPhoto instanceof HTMLImageElement)) return;
    const src = driverPhotoSrc(name);
    kioskDriverPhoto.dataset.photo = src;
    if (!src) {
      kioskDriverPhoto.hidden = true;
      kioskDriverPhoto.removeAttribute('src');
      return;
    }
    kioskDriverPhoto.alt = '';
    kioskDriverPhoto.onerror = () => {
      if (kioskDriverPhoto.dataset.photo !== src) return;
      kioskDriverPhoto.hidden = true;
    };
    kioskDriverPhoto.src = src;
    kioskDriverPhoto.hidden = false;
  }

  /**
   * @param {{ id: string, name: string, routes: string[] }} person
   */
  function openDriver(person) {
    const coveringAs = substituteName;
    selected = person;
    if (!coveringAs) substituteName = '';
    unlocked = false;
    hidePunchConfirm();
    kiosk.classList.add('is-detail');
    kioskList.hidden = true;
    kioskDetail.hidden = false;
    if (kioskSubstitutes) kioskSubstitutes.hidden = true;
    paintDriverHeading(person);
    paintDriverPhoto(person.name);
    const routes = sortedRoutes(person.routes);
    if (kioskRoutes) {
      kioskRoutes.textContent = routes.length ? `Route ${routes.join(', ')}` : '';
    }
    const covering = activeSubstitute(person.name);
    if (kioskCovering) {
      kioskCovering.hidden = !covering;
      kioskCovering.textContent = covering ? `${covering} is clocked in for this route.` : '';
    }
    kioskPin.value = '';
    kioskReasonIds = [];
    renderKioskReasons();
    if (kioskPinError) kioskPinError.textContent = '';
    if (coveringAs) {
      substituteName = coveringAs;
      showPunchStep();
      return;
    }
    showPinStep();
    kioskPin.focus();
  }

  function syncSubstituteHeader() {
    if (!(kioskSubstitute instanceof HTMLButtonElement)) return;
    kioskSubstitute.hidden = false;
    const pickerOpen = Boolean(kioskSubstitutes && !kioskSubstitutes.hidden);
    const waiting = Boolean(substituteName) && !kioskList.hidden;
    if (pickerOpen) kioskSubstitute.textContent = 'Driver list';
    else if (waiting) kioskSubstitute.textContent = 'Cancel substitute';
    else kioskSubstitute.textContent = 'Substitute Drivers';
  }

  function onSubstituteHeader() {
    const pickerOpen = Boolean(kioskSubstitutes && !kioskSubstitutes.hidden);
    const waiting = Boolean(substituteName) && !kioskList.hidden;
    if (pickerOpen || waiting) {
      showList();
      return;
    }
    substituteCoversSelected = Boolean(selected) && !kioskDetail.hidden;
    if (!substituteCoversSelected) {
      selected = null;
      unlocked = false;
    }
    kioskList.hidden = true;
    kioskDetail.hidden = true;
    kioskActions.hidden = true;
    hideClockQr();
    kiosk.classList.remove('is-detail');
    if (kioskSubstitutes) kioskSubstitutes.hidden = false;
    renderSubstituteChoices();
    syncSubstituteHeader();
    const first = kioskSubstituteList?.querySelector('button');
    if (first instanceof HTMLElement) first.focus();
  }

  function showPinStep() {
    if (kioskPinForm) kioskPinForm.hidden = false;
    if (kioskSubstitutes) kioskSubstitutes.hidden = true;
    if (kioskSubstituteWho) kioskSubstituteWho.hidden = true;
    kioskActions.hidden = true;
    hideClockQr();
    unlocked = false;
    syncSubstituteHeader();
  }

  function renderSubstituteChoices() {
    if (!kioskSubstituteList) return;
    const roster = [...substituteDrivers()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    );
    kioskSubstituteList.replaceChildren();
    if (kioskSubstituteEmpty) kioskSubstituteEmpty.hidden = roster.length > 0;
    for (const person of roster) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = person.name;
      button.addEventListener('click', () => chooseSubstitute(person.name));
      kioskSubstituteList.append(button);
    }
  }

  /**
   * @param {string} name
   */
  function chooseSubstitute(name) {
    substituteName = name;
    if (kioskSubstitutes) kioskSubstitutes.hidden = true;
    if (substituteCoversSelected && selected) {
      kiosk.classList.add('is-detail');
      kioskList.hidden = true;
      kioskDetail.hidden = false;
      showPunchStep();
      return;
    }
    selected = null;
    unlocked = false;
    kiosk.classList.remove('is-detail');
    kioskList.hidden = false;
    kioskDetail.hidden = true;
    kioskActions.hidden = true;
    hideClockQr();
    if (kioskListStatus) {
      kioskListStatus.textContent = `${name}, tap the driver whose route you are covering.`;
    }
    renderRoster();
    syncSubstituteHeader();
  }

  function showPunchStep() {
    unlocked = true;
    if (kioskPinForm) kioskPinForm.hidden = true;
    if (kioskSubstitutes) kioskSubstitutes.hidden = true;
    if (kioskCovering) kioskCovering.hidden = true;
    if (kioskSubstituteWho) {
      kioskSubstituteWho.hidden = !substituteName;
      kioskSubstituteWho.textContent = substituteName ? `Substitute: ${substituteName}` : '';
    }
    kioskReasonIds = [];
    clearKioskRun();
    clearKioskNote();
    closeChunkPanel();
    fillKioskReasons();
    renderKioskReasons();
    kioskActions.hidden = false;
    hideTimecard();
    closeLeaveRequest();
    refreshTimecardButton();
    syncSubstituteHeader();
    if (selected) paintClockQr(selected);
    paintLeaveNote();
    paintRouteCards();
    focusNextPunch();
  }

  function paintLeaveNote() {
    const note = document.querySelector('#kiosk-leave-note');
    if (!note) return;
    if (!LEAVE_REQUESTS_ENABLED) {
      note.hidden = true;
      note.textContent = '';
      return;
    }
    const now = new Date();
    const awaiting =
      !selected || substituteName
        ? []
        : runsAwaitingLeave({
            clockByRun: clockByRunFor(selected),
            punches: Array.isArray(state().punches) ? state().punches : [],
            requests: state().leaveRequests,
            driverName: selected.name,
            now,
          });
    const text = missedClockInNote(awaiting, now);
    note.hidden = !text;
    note.textContent = text;
  }

  function paintDriverHeading(person) {
    const latest = latestPunch(person.name);
    const status = latest?.action === 'in' ? 'in' : 'out';
    if (kioskDriver) kioskDriver.textContent = person.name;
    const stateLine = document.querySelector('#kiosk-clock-state');
    if (stateLine) {
      stateLine.textContent = clockedStatusLabel(status, latest || {});
      stateLine.className = `kiosk-clock-state is-${status}`;
    }
    paintLeaveNote();
  }

  function openClock() {
    if (!selected) return null;
    const latest = latestPunch(selected.name);
    if (latest?.action !== 'in') return null;
    const run = normalizePunchRun(latest.run);
    if (!run) return null;
    return {
      run,
      when: clockedAtText(latest.punched_at),
      work: run === 'OTHER' ? workTypeLabel(latest.work_type) : '',
    };
  }

  /**
   * Today's clock-ins and clock-outs for each route, oldest first.
   * A time replaced by a later punch is marked so it can stay struck through.
   * @param {string} name
   */
  function todaysRunTimes(name) {
    const today = localDateString(new Date());
    const wanted = name.trim().toLowerCase();
    const punches = Array.isArray(state().punches) ? state().punches : [];
    const replaced = replacedClockPunchIds(punches);
    /** @type {Record<string, { in: Array<{ id: string, clock: string, replaced: boolean, note: string, workType: string, punchedAt: string }>, out: Array<{ id: string, clock: string, replaced: boolean, note: string, workType: string, punchedAt: string }> }>} */
    const byRun = {};
    const rows = punches
      .filter((punch) => {
        if (punch?.removed === true) return false;
        if (String(punch?.driver_name || '').trim().toLowerCase() !== wanted) return false;
        const when = new Date(punch.punched_at);
        return !Number.isNaN(when.getTime()) && localDateString(when) === today;
      })
      .sort((a, b) => String(a.punched_at).localeCompare(String(b.punched_at)));
    for (const punch of rows) {
      const run = normalizePunchRun(punch.run);
      const action = punch.action === 'in' || punch.action === 'out' ? punch.action : '';
      const clock = clockedAtText(punch.punched_at);
      if (!run || !action || !clock) continue;
      if (!byRun[run]) byRun[run] = { in: [], out: [] };
      byRun[run][action].push({
        id: String(punch.id || ''),
        clock,
        replaced: replaced.has(String(punch.id || '')),
        note: String(punch.note || ''),
        workType: String(punch.work_type || ''),
        punchedAt: String(punch.punched_at || ''),
        reasonCodes: Array.isArray(punch.reason_codes) ? punch.reason_codes : [],
      });
    }
    return byRun;
  }

  /**
   * @param {ReturnType<typeof todaysRunTimes>} times
   */
  function cardPunchesFromTimes(times) {
    /** @type {Array<{ run: string, action: 'in' | 'out', punchedAt: string }>} */
    const punches = [];
    for (const [run, actions] of Object.entries(times)) {
      for (const action of ['in', 'out']) {
        for (const item of actions[action] || []) {
          punches.push({ run, action, punchedAt: item.punchedAt });
        }
      }
    }
    return punches;
  }

  function paintRouteCards() {
    if (!(kioskCard instanceof HTMLElement)) return;
    const active = document.activeElement;
    const activeKey =
      active instanceof HTMLTextAreaElement && active.dataset.noteFor && active.dataset.noteAction
        ? `${active.dataset.noteFor}:${active.dataset.noteAction}`
        : '';
    const selectionStart = active instanceof HTMLTextAreaElement ? active.selectionStart : 0;
    const reasonFocus =
      active instanceof HTMLInputElement && active.dataset.reasonField
        ? {
            run: active.dataset.reasonFor || '',
            action: active.dataset.reasonAction || '',
            id: active.dataset.reasonId || '',
            field: active.dataset.reasonField,
            start: active.selectionStart,
          }
        : null;
    const open = openClock();
    const times = selected ? todaysRunTimes(selected.name) : {};
    const hasMidday = contractedFor(localDateString(new Date())).MIDDAY != null;
    const rows = clockCardRows({ hasMidday, punches: cardPunchesFromTimes(times) });
    paintingCard = true;
    kioskCard.replaceChildren();
    for (const slot of rows) {
      const runTimes = (times[slot.run] && times[slot.run][slot.action]) || [];
      kioskCard.append(renderCardRow(slot, runTimes, open));
    }
    paintingCard = false;
    if (reasonFocus) {
      const nextReason = kioskCard.querySelector(
        `[data-reason-for="${reasonFocus.run}"][data-reason-action="${reasonFocus.action}"][data-reason-id="${reasonFocus.id}"][data-reason-field="${reasonFocus.field}"]`
      );
      if (nextReason instanceof HTMLInputElement) {
        nextReason.focus();
        const caret = Math.min(reasonFocus.start ?? 0, nextReason.value.length);
        nextReason.setSelectionRange(caret, caret);
        return;
      }
    }
    if (activeKey) {
      const [run, action] = activeKey.split(':');
      const next = routeNoteField(run, action);
      if (next instanceof HTMLTextAreaElement) {
        next.focus();
        const caret = Math.min(selectionStart ?? 0, next.value.length);
        next.setSelectionRange(caret, caret);
      }
    }
    lockNoteEditors();
    if (!applyingSharedNote) void syncNoteShares();
  }

  /**
   * @param {unknown} codes
   * @returns {Array<{ id: string, label: string, hours: string, minutes: string }>}
   */
  function reasonsToDraft(codes) {
    if (!Array.isArray(codes)) return [];
    /** @type {Array<{ id: string, label: string, hours: string, minutes: string }>} */
    const draft = [];
    for (const code of codes) {
      const id = String(code?.id || '').trim();
      const label = String(code?.label || '').trim();
      if (!id || !label) continue;
      const minutes = Number(code?.minutes);
      const known = Number.isInteger(minutes) && minutes >= 0 && minutes <= 24 * 60;
      draft.push({
        id,
        label,
        hours: '',
        minutes: known ? String(minutes) : '',
      });
    }
    return draft;
  }

  /**
   * @param {Array<{ id: string, label: string, hours: string, minutes: string }>} draft
   * @returns {{ ok: boolean, codes: Array<{ id: string, label: string, minutes?: number }> }}
   */
  function reasonCodesFromDraft(draft) {
    /** @type {Array<{ id: string, label: string, minutes?: number }>} */
    const codes = [];
    let ok = true;
    for (const item of draft) {
      const id = String(item.id || '').trim();
      if (!id) continue;
      const live = catalog().find((code) => code.id === id);
      const label = String(live?.label || item.label || '').trim();
      if (!label) continue;
      const parsed = reasonDurationMinutes(item.hours, item.minutes);
      if (!parsed.ok) ok = false;
      /** @type {{ id: string, label: string, minutes?: number }} */
      const code = { id, label };
      if (parsed.ok && parsed.minutes != null) code.minutes = parsed.minutes;
      codes.push(code);
    }
    return { ok, codes };
  }

  /**
   * @param {string} run
   * @param {string} action
   */
  function kioskReasonCodes(run, action) {
    const draft = reasonDrafts.get(`${run}:${action}`);
    if (draft) return reasonCodesFromDraft(draft).codes;
    const host = kioskCard?.querySelector(`[data-reason-for="${run}"][data-reason-action="${action}"]`);
    const root = host instanceof HTMLElement ? host.closest('.kiosk-card-row') || host : null;
    if (!(root instanceof HTMLElement)) return [];
    return reasonCodesFromDraft(readReasonDraft(root)).codes;
  }

  /**
   * Saved reason lines on this card row. The adder's pending fields are left out.
   * @param {HTMLElement} root
   */
  function readReasonDraft(root) {
    /** @type {Array<{ id: string, label: string, hours: string, minutes: string }>} */
    const draft = [];
    for (const item of root.querySelectorAll('[data-reason-id]')) {
      if (!(item instanceof HTMLElement)) continue;
      const id = item.dataset.reasonId || '';
      if (!id || id === 'pending') continue;
      const hours = item.querySelector('[data-reason-field="hours"]');
      const minutes = item.querySelector('[data-reason-field="minutes"]');
      draft.push({
        id,
        label: item.dataset.reasonLabel || '',
        hours: hours instanceof HTMLInputElement ? hours.value : item.dataset.reasonHours || '',
        minutes: minutes instanceof HTMLInputElement ? minutes.value : item.dataset.reasonMinutes || '',
      });
    }
    return draft;
  }

  /**
   * @param {{ label: string, hours: string, minutes: string }} item
   */
  function reasonLine(item) {
    const parsed = reasonDurationMinutes(item.hours, item.minutes);
    if (parsed.ok && parsed.minutes != null) {
      const line = reasonNoteLine({ label: item.label, minutes: parsed.minutes });
      if (line) return line;
    }
    return item.label;
  }

  /**
   * @param {string} punchId
   * @param {Array<{ id: string, label: string, minutes?: number }>} codes
   */
  function savePunchReasons(punchId, codes) {
    if (!punchId) return;
    const next = state();
    const punches = Array.isArray(next.punches) ? next.punches : [];
    const punch = punches.find((item) => item.id === punchId);
    if (!punch) return;
    const current = JSON.stringify(Array.isArray(punch.reason_codes) ? punch.reason_codes : []);
    if (current === JSON.stringify(codes)) return;
    next.punches = punches.map((item) => (item.id === punchId ? { ...item, reason_codes: codes } : item));
    writeState(next);
  }

  /**
   * @param {HTMLElement} box
   */
  function persistReasonBox(box) {
    const key = `${box.dataset.reasonFor || ''}:${box.dataset.reasonAction || ''}`;
    const root = box.closest('.kiosk-card-row') || box;
    const draft = reasonDrafts.get(key) || readReasonDraft(root);
    reasonDrafts.set(key, draft);
    const built = reasonCodesFromDraft(draft);
    if (!built.ok) return;
    savePunchReasons(box.dataset.punchId || '', built.codes);
    const run = box.dataset.reasonFor || '';
    const action = box.dataset.reasonAction || '';
    if (run && (action === 'in' || action === 'out')) void publishNoteShare(run, action);
  }

  /**
   * Saved reasons, one line each, under the notes for this row.
   * @param {HTMLElement} list
   * @param {Array<{ id: string, label: string, hours: string, minutes: string }>} draft
   * @param {(item: { id: string, label: string, hours: string, minutes: string }) => void} onRemove
   */
  function paintReasonNotes(list, draft, onRemove) {
    list.replaceChildren();
    list.hidden = draft.length === 0;
    for (const item of draft) {
      const row = document.createElement('li');
      row.dataset.reasonId = item.id;
      row.dataset.reasonLabel = item.label;
      row.dataset.reasonHours = item.hours;
      row.dataset.reasonMinutes = item.minutes;
      const text = document.createElement('span');
      text.textContent = reasonLine(item);
      text.title = text.textContent;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${item.label}`);
      remove.addEventListener('click', () => onRemove(item));
      row.append(text, remove);
      list.append(row);
    }
  }

  /**
   * The reason stays a small adder. A reason and a time become a notes line.
   * @param {{ run: string, action: 'in' | 'out', label: string }} slot
   * @param {string} punchId
   * @param {Array<{ id: string, label: string, hours: string, minutes: string }>} draft
   * @param {HTMLElement} notes
   */
  function renderCardReason(slot, punchId, draft, notes) {
    const key = `${slot.run}:${slot.action}`;
    const pending = reasonPending.get(key) || { id: '', hours: '', minutes: '' };
    const box = document.createElement('div');
    box.className = 'kiosk-card-reason';
    box.dataset.reasonFor = slot.run;
    box.dataset.reasonAction = slot.action;
    if (punchId) box.dataset.punchId = punchId;
    const caption = document.createElement('span');
    caption.textContent = 'Reason';
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Reason for ${slot.label}`);
    const time = document.createElement('div');
    time.className = 'kiosk-card-reason-time';
    const minutesLabel = document.createElement('label');
    const minutes = document.createElement('input');
    minutes.type = 'number';
    minutes.min = '0';
    minutes.max = String(24 * 60);
    minutes.step = '1';
    minutes.inputMode = 'numeric';
    minutes.value = pending.minutes;
    minutes.dataset.reasonFor = slot.run;
    minutes.dataset.reasonAction = slot.action;
    minutes.dataset.reasonId = 'pending';
    minutes.dataset.reasonField = 'minutes';
    minutes.setAttribute('aria-label', `Minutes for ${slot.label}`);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'secondary';
    add.textContent = 'Add';
    const hint = document.createElement('p');
    hint.className = 'kiosk-card-reason-hint';
    hint.hidden = true;
    hint.setAttribute('role', 'status');
    minutesLabel.append('Minutes', minutes);
    time.append(minutesLabel, add);
    box.append(caption, select, time, hint);

    const rememberPending = () => {
      reasonPending.set(key, { id: select.value, hours: '', minutes: minutes.value });
    };

    const fillSelect = () => {
      const taken = new Set(draft.map((item) => item.id));
      const current = select.value || pending.id;
      select.replaceChildren();
      const blank = document.createElement('option');
      blank.value = '';
      const available = catalog().filter((code) => !taken.has(code.id));
      blank.textContent = catalog().length ? (available.length ? 'Choose a reason' : 'All reasons added') : 'No reasons yet';
      select.append(blank);
      for (const code of available) {
        const option = document.createElement('option');
        option.value = code.id;
        option.textContent = code.label;
        select.append(option);
      }
      select.disabled = available.length === 0;
      add.disabled = available.length === 0;
      minutes.disabled = available.length === 0;
      if (available.some((code) => code.id === current)) select.value = current;
    };

    const paintNotes = () => {
      paintReasonNotes(notes, draft, (item) => {
        const index = draft.indexOf(item);
        if (index >= 0) draft.splice(index, 1);
        reasonDrafts.set(key, draft);
        paintNotes();
        fillSelect();
        persistReasonBox(box);
      });
    };

    const commit = () => {
      if (!noteEditingOpen()) return;
      const id = select.value;
      const code = catalog().find((item) => item.id === id);
      const parsed = reasonDurationMinutes('', minutes.value);
      const ready = parsed.ok && parsed.minutes != null && parsed.minutes >= 1;
      minutes.setAttribute('aria-invalid', ready ? 'false' : 'true');
      if (!code || draft.some((item) => item.id === code.id)) {
        hint.hidden = false;
        hint.textContent = 'Choose a reason.';
        select.focus();
        return;
      }
      if (!parsed.ok) {
        hint.hidden = false;
        hint.textContent = 'Use whole minutes, up to 1440.';
        minutes.focus();
        return;
      }
      if (parsed.minutes == null || parsed.minutes < 1) {
        hint.hidden = false;
        hint.textContent = 'Enter the minutes.';
        minutes.focus();
        return;
      }
      draft.push({
        id: code.id,
        label: code.label,
        hours: '',
        minutes: String(parsed.minutes),
      });
      reasonDrafts.set(key, draft);
      reasonPending.delete(key);
      pending.id = '';
      pending.hours = '';
      pending.minutes = '';
      select.value = '';
      minutes.value = '';
      minutes.setAttribute('aria-invalid', 'false');
      hint.hidden = true;
      hint.textContent = '';
      paintNotes();
      fillSelect();
      persistReasonBox(box);
      if (!select.disabled) select.focus();
    };

    select.addEventListener('change', () => {
      hint.hidden = true;
      rememberPending();
    });
    minutes.addEventListener('input', () => {
      hint.hidden = true;
      minutes.setAttribute('aria-invalid', reasonDurationMinutes('', minutes.value).ok ? 'false' : 'true');
      rememberPending();
    });
    minutes.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      commit();
    });
    add.addEventListener('click', commit);

    fillSelect();
    paintNotes();
    return box;
  }

  /**
   * @param {{ run: string, action: 'in' | 'out', label: string, punched: boolean }} slot
   * @param {Array<{ id?: string, clock: string, replaced: boolean, note: string, workType: string, punchedAt: string, reasonCodes?: object[] }>} times
   * @param {{ run: string } | null} open
   */
  function renderCardRow(slot, times, open) {
    const row = document.createElement('div');
    row.className = 'kiosk-card-row';
    if (open?.run === slot.run && slot.action === 'in') row.classList.add('is-open');
    const current = [...times].reverse().find((item) => !item.replaced) || times[times.length - 1];
    const key = `${slot.run}:${slot.action}`;
    const notesCol = document.createElement('div');
    notesCol.className = 'kiosk-card-notes-col';
    const noteLine = document.createElement('div');
    noteLine.className = 'kiosk-card-note-line';
    const comment = document.createElement('label');
    comment.className = 'kiosk-card-comment';
    const caption = document.createElement('span');
    caption.textContent = 'Notes';
    const area = document.createElement('textarea');
    area.dataset.noteFor = slot.run;
    area.dataset.noteAction = slot.action;
    area.maxLength = NOTE_MAX;
    area.rows = 3;
    area.autocomplete = 'off';
    area.autocorrect = 'off';
    area.autocapitalize = 'off';
    area.spellcheck = false;
    area.setAttribute('aria-label', `Notes for ${slot.label}`);
    area.value = noteDrafts.has(key) ? noteDrafts.get(key) || '' : current?.note || '';
    comment.append(caption, area);
    const reasonNotes = document.createElement('ul');
    reasonNotes.className = 'kiosk-card-notes';
    reasonNotes.hidden = true;
    noteLine.append(comment);
    notesCol.append(noteLine, reasonNotes);
    const reasonDraft = reasonDrafts.has(key) ? reasonDrafts.get(key) || [] : reasonsToDraft(current?.reasonCodes);
    if (!reasonDrafts.has(key)) reasonDrafts.set(key, reasonDraft);
    const reason = renderCardReason(slot, current?.id || '', reasonDraft, reasonNotes);
    const kind = document.createElement('p');
    kind.className = 'kiosk-card-kind';
    kind.append(slot.label);
    const work = slot.run === 'OTHER' ? workTypeLabel(current?.workType) : '';
    if (work) {
      const detail = document.createElement('span');
      detail.textContent = work;
      kind.append(detail);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.punch = slot.run;
    button.dataset.action = slot.action;
    if (times.length) {
      button.className = 'kiosk-card-stamp';
      const timeLine = document.createElement('span');
      timeLine.className = 'kiosk-punch-time';
      const spoken = [];
      for (const item of [...times].reverse()) {
        const stamp = document.createElement(item.replaced ? 's' : 'span');
        stamp.textContent = item.clock;
        timeLine.append(stamp);
        spoken.push(item.replaced ? `${item.clock}, replaced` : item.clock);
      }
      button.append(timeLine);
      button.setAttribute('aria-label', `${slot.label} at ${spoken.join(' and ')}`);
    } else {
      button.className = 'kiosk-card-punch';
      const word = document.createElement('span');
      word.className = 'kiosk-punch-word';
      word.textContent = 'Punch';
      const live = document.createElement('span');
      live.className = 'kiosk-punch-live';
      live.textContent = kioskLiveClock(new Date());
      button.append(word, live);
    }
    row.append(notesCol, reason, kind, button);
    return row;
  }

  function focusNextPunch() {
    if (!selected || !unlocked || kioskPunchLayout?.hidden) return;
    const open = openClock();
    let run = open?.run || '';
    let action = 'out';
    if (!run) {
      const segment = segmentForClock(new Date());
      run = segment === 'am' ? 'AM' : segment === 'midday' ? 'MIDDAY' : 'PM';
      action = 'in';
    }
    const match = kioskCard?.querySelector(`[data-punch="${run}"][data-action="${action}"].kiosk-card-punch`);
    const button = match instanceof HTMLElement ? match : kioskCard?.querySelector('.kiosk-card-punch');
    if (button instanceof HTMLElement) button.focus();
  }

  function openOtherWork() {
    if (!selected || !unlocked) return;
    pendingAction = 'in';
    pendingRun = 'OTHER';
    clearWorkType();
    const area = document.querySelector('#kiosk-note-OTHER');
    if (area instanceof HTMLTextAreaElement) area.value = '';
    syncPunchPanels();
    const first = kioskWorkOptions?.querySelector('input');
    if (first instanceof HTMLElement) first.focus();
  }

  /**
   * @param {string} action
   * @param {string} run
   */
  function beginPunch(action, run) {
    if (!selected || !unlocked) return;
    const chosen = normalizePunchRun(run);
    if ((action !== 'in' && action !== 'out') || !chosen) return;
    if (chosen === 'OTHER') {
      pendingAction = action;
      pendingRun = 'OTHER';
      clearWorkType();
      syncPunchPanels();
      const first = kioskWorkOptions?.querySelector('input');
      if (first instanceof HTMLElement) first.focus();
      return;
    }
    punch(action, chosen);
  }

  /**
   * Punches already saved today for this route and this clock in or clock out.
   * @param {'in' | 'out'} action
   * @param {string} run
   */
  function punchesAlreadyThere(action, run) {
    if (!selected) return [];
    const today = localDateKey(new Date());
    const wanted = selected.name.trim().toLowerCase();
    return (Array.isArray(state().punches) ? state().punches : [])
      .filter((punch) => {
        if (punch?.removed === true || punch.action !== action) return false;
        if (String(punch.driver_name || '').trim().toLowerCase() !== wanted) return false;
        if (normalizePunchRun(punch.run) !== run) return false;
        const when = new Date(punch.punched_at);
        return !Number.isNaN(when.getTime()) && localDateKey(when) === today;
      })
      .sort((a, b) => String(a.punched_at).localeCompare(String(b.punched_at)));
  }

  /**
   * @param {'in' | 'out'} action
   * @param {string} run
   * @param {object[]} existing
   */
  function openReplaceConfirm(action, run, existing) {
    const panel = document.querySelector('#kiosk-replace-confirm');
    const text = document.querySelector('#kiosk-replace-confirm-text');
    if (!panel || !text) {
      punch(action, run, true);
      return;
    }
    const verb = action === 'in' ? 'clocked in' : 'clocked out';
    const route = run === 'OTHER' ? 'Other' : `the ${punchRunLabel(run)}`;
    const times = existing.map((punch) => clockedAtText(punch.punched_at)).filter(Boolean);
    const when =
      times.length <= 1
        ? times[0] || ''
        : `${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}`;
    text.textContent = when
      ? `You already ${verb} for ${route} at ${when}. Are you sure?`
      : `You already ${verb} for ${route}. Are you sure?`;
    replacePending = { action, run };
    panel.hidden = false;
    const yes = document.querySelector('#kiosk-replace-yes');
    if (yes instanceof HTMLElement) yes.focus();
  }

  function closeReplaceConfirm() {
    replacePending = null;
    const panel = document.querySelector('#kiosk-replace-confirm');
    if (panel) panel.hidden = true;
  }

  function payStatusForSelected(run) {
    if (!selected) return '';
    const driver = driversFromState(state()).find((item) => item.id === selected.id);
    return payStatusForClockIn(driver?.payStatuses, driver?.payStatusByRun, run, payLineDefaults().lines);
  }

  function clearKioskRun() {
    pendingAction = '';
    pendingRun = '';
    clearWorkType();
    const error = document.querySelector('#kiosk-run-error');
    if (error) {
      error.hidden = true;
      error.textContent = '';
    }
    syncPunchPanels();
  }

  function workTypeInputs(name) {
    return [...document.querySelectorAll(`input[name="${name}"]`)];
  }

  function chosenWorkType(name = 'kiosk-work') {
    const checked = workTypeInputs(name).find((input) => input instanceof HTMLInputElement && input.checked);
    return checked instanceof HTMLInputElement ? checked.value : '';
  }

  function clearWorkType() {
    for (const input of workTypeInputs('kiosk-work')) {
      if (input instanceof HTMLInputElement) input.checked = false;
    }
    const error = document.querySelector('#kiosk-work-error');
    if (error) {
      error.hidden = true;
      error.textContent = '';
    }
    if (kioskTripTicket instanceof HTMLInputElement) kioskTripTicket.value = '';
    syncTripTicketFields();
  }

  function syncTripTicketFields() {
    if (kioskTripTicketField) kioskTripTicketField.hidden = chosenWorkType('kiosk-work') !== TRIP_TICKET_WORK_TYPE;
    if (kioskChunkTicketField) {
      kioskChunkTicketField.hidden = chosenWorkType('kiosk-chunk-work') !== TRIP_TICKET_WORK_TYPE;
    }
  }

  function fillWorkTypeChoices() {
    fillWorkTypeGroup(kioskWorkOptions, 'kiosk-work');
    fillWorkTypeGroup(kioskChunkTypes, 'kiosk-chunk-work');
  }

  /**
   * @param {Element | null} container
   * @param {string} name
   */
  function fillWorkTypeGroup(container, name) {
    if (!container) return;
    container.replaceChildren();
    let group = '';
    for (const type of IRREGULAR_WORK_TYPES) {
      if (type.group !== group) {
        group = type.group;
        const heading = document.createElement('p');
        heading.className = 'kiosk-work-group';
        heading.textContent = group;
        container.append(heading);
      }
      const label = document.createElement('label');
      label.className = 'kiosk-run-option kiosk-work-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = name;
      input.value = type.id;
      const text = document.createElement('span');
      text.textContent = type.label;
      label.append(input, text);
      container.append(label);
    }
  }

  function hideWorkTypes() {
    clearKioskRun();
    paintRouteCards();
    focusNextPunch();
  }

  function syncPunchPanels() {
    const chunkOpen = kioskChunkPanel?.hidden === false;
    const leaveOpen = leaveRequestPanel()?.hidden === false;
    const otherOpen = pendingRun === 'OTHER' && !chunkOpen && !leaveOpen;
    if (kioskWork) kioskWork.hidden = !otherOpen;
    if (kioskPunchLayout) kioskPunchLayout.hidden = chunkOpen || leaveOpen || otherOpen;
    const heading = document.querySelector('#kiosk-work-heading');
    if (heading) heading.textContent = 'Other work';
    const lead = document.querySelector('#kiosk-work-lead');
    if (lead) lead.textContent = 'Choose the kind of work, then clock in or out.';
    if (!kioskPunchLayout?.hidden) paintRouteCards();
    syncChunkButton();
  }

  function timeInputFromDate(date) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function markingPairs() {
    if (!selected) return [];
    return regularPairsForMarking(Array.isArray(state().punches) ? state().punches : [], selected.name);
  }

  function syncChunkButton() {
    if (!(kioskChunkOpen instanceof HTMLButtonElement)) return;
    const open = kioskChunkPanel?.hidden === false;
    const leaveOpen = leaveRequestPanel()?.hidden === false;
    kioskChunkOpen.hidden = leaveOpen || open || markingPairs().length === 0;
  }

  function closeChunkPanel() {
    const wasOpen = kioskChunkPanel?.hidden === false;
    chunkClockInId = '';
    if (kioskChunkPanel) kioskChunkPanel.hidden = true;
    document.querySelector('.kiosk-reason-row')?.setAttribute('hidden', '');
    document.querySelector('#kiosk-reason-picks')?.setAttribute('hidden', '');
    if (kioskChunkError) {
      kioskChunkError.hidden = true;
      kioskChunkError.textContent = '';
    }
    if (kioskChunkTicket instanceof HTMLInputElement) kioskChunkTicket.value = '';
    syncTripTicketFields();
    syncPunchPanels();
    if (wasOpen) focusNextPunch();
  }

  /**
   * @param {boolean} open
   */
  function showChunkPanel(open) {
    if (!open) {
      closeChunkPanel();
      return;
    }
    pendingAction = '';
    pendingRun = '';
    if (kioskWork) kioskWork.hidden = true;
    document.querySelector('.kiosk-reason-row')?.setAttribute('hidden', '');
    document.querySelector('#kiosk-reason-picks')?.setAttribute('hidden', '');
    if (kioskChunkPanel) kioskChunkPanel.hidden = false;
    syncPunchPanels();
    renderChunkPairs();
  }

  function renderChunkPairs() {
    if (!kioskChunkPairs) return;
    const pairs = markingPairs();
    if (!pairs.some((pair) => pair.clockIn?.id === chunkClockInId)) {
      chunkClockInId = pairs[0]?.clockIn?.id || '';
    }
    kioskChunkPairs.replaceChildren();
    for (const pair of pairs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.chunkIn = pair.clockIn.id;
      const run = punchRunLabel(normalizePunchRun(pair.clockIn.run));
      const day = pair.start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      const portions = normalizeStoredWorkPortions(pair.clockIn.work_portions)
        .map((portion) => workTypeLabel(portion.work_type))
        .filter(Boolean);
      const marked = portions.length ? ` · already ${portions.join(', ')}` : '';
      button.textContent = `${day} · ${run} · ${punchDisplayClock(pair.start)}–${punchDisplayClock(pair.end)}${marked}`;
      if (pair.clockIn.id === chunkClockInId) button.classList.add('is-selected');
      kioskChunkPairs.append(button);
    }
    const chosen = pairs.find((pair) => pair.clockIn?.id === chunkClockInId);
    if (chosen && kioskChunkStart instanceof HTMLInputElement && kioskChunkEnd instanceof HTMLInputElement) {
      kioskChunkStart.value = timeInputFromDate(chosen.start);
      kioskChunkEnd.value = timeInputFromDate(chosen.end);
    }
  }

  /**
   * @param {Event} event
   */
  function onChunkPairClick(event) {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    const id = button instanceof HTMLButtonElement ? button.dataset.chunkIn || '' : '';
    if (!id) return;
    chunkClockInId = id;
    renderChunkPairs();
  }

  function saveWorkChunk() {
    if (!selected || !chunkClockInId) return;
    if (kioskChunkError) {
      kioskChunkError.hidden = true;
      kioskChunkError.textContent = '';
    }
    const workType = chosenWorkType('kiosk-chunk-work');
    const startClock = kioskChunkStart instanceof HTMLInputElement ? kioskChunkStart.value : '';
    const endClock = kioskChunkEnd instanceof HTMLInputElement ? kioskChunkEnd.value : '';
    const tripTicket = normalizeTripTicket(kioskChunkTicket instanceof HTMLInputElement ? kioskChunkTicket.value : '');
    const name = selected.name;
    try {
      const next = state();
      next.punches = applyWorkChunk(Array.isArray(next.punches) ? next.punches : [], chunkClockInId, {
        workType,
        startClock,
        endClock,
        tripTicket,
      });
      writeState(next);
      const label = workTypeLabel(workType);
      const ticket = tripTicketLine(tripTicket);
      showList();
      showPunchConfirm(
        name,
        `Marked ${label}, ${punchDisplayClock(clockFromInput(startClock))}–${punchDisplayClock(clockFromInput(endClock))}${ticket ? ` · ${ticket}` : ''}`
      );
    } catch (error) {
      if (!kioskChunkError) return;
      kioskChunkError.hidden = false;
      kioskChunkError.textContent = error instanceof Error ? error.message : 'That part could not be saved.';
    }
  }

  /**
   * @param {string} clock
   */
  function clockFromInput(clock) {
    const [hours, minutes] = clock.split(':').map(Number);
    return new Date(2026, 0, 1, hours || 0, minutes || 0);
  }

  /**
   * @param {string} run
   * @param {string} action
   */
  function routeNoteField(run, action) {
    const area = kioskCard?.querySelector(`textarea[data-note-for="${run}"][data-note-action="${action}"]`);
    return area instanceof HTMLTextAreaElement ? area : null;
  }

  /**
   * @param {FocusEvent} event
   */
  function onNoteBlur(event) {
    if (paintingCard) return;
    const area = event.target;
    if (!(area instanceof HTMLTextAreaElement)) return;
    const run = area.dataset.noteFor || '';
    const action = area.dataset.noteAction || '';
    if (!run || (action !== 'in' && action !== 'out')) return;
    if (!noteEditingOpen()) return;
    if (area.value.length > NOTE_MAX) area.value = area.value.slice(0, NOTE_MAX);
    noteDrafts.set(`${run}:${action}`, area.value);
    if (selected) savePunchNote(run, action, area.value);
    if (selected) void publishNoteShare(run, action);
  }

  /**
   * @param {string} run
   * @param {string} action
   * @param {string} raw
   */
  function savePunchNote(run, action, raw) {
    if (!selected || (action !== 'in' && action !== 'out')) return;
    const note = assertNote(String(raw || '').slice(0, NOTE_MAX));
    const existing = punchesAlreadyThere(action, run);
    const punch = existing[existing.length - 1];
    if (!punch || String(punch.note || '') === note) return;
    const next = state();
    next.punches = (Array.isArray(next.punches) ? next.punches : []).map((item) =>
      item.id === punch.id ? { ...item, note } : item
    );
    writeState(next);
  }

  function clearKioskNote() {
    noteDrafts.clear();
    reasonDrafts.clear();
    reasonPending.clear();
    const panel = document.querySelector('#kiosk-note-OTHER');
    if (panel instanceof HTMLTextAreaElement) {
      panel.maxLength = NOTE_MAX;
      panel.value = '';
    }
  }

  /**
   * @param {string} run
   * @param {string} action
   */
  function kioskNoteText(run, action) {
    const panelOpen = run === 'OTHER' && kioskWork instanceof HTMLElement && kioskWork.hidden === false;
    const panel = document.querySelector('#kiosk-note-OTHER');
    if (panelOpen && panel instanceof HTMLTextAreaElement) {
      return assertNote(panel.value.slice(0, NOTE_MAX));
    }
    const area = routeNoteField(run, action);
    if (area) return assertNote(area.value.slice(0, NOTE_MAX));
    const draft = noteDrafts.get(`${run}:${action}`);
    return draft ? assertNote(draft.slice(0, NOTE_MAX)) : '';
  }

  /**
   * @param {Array<{ id: string, label: string, minutes?: number }>} reasons
   */
  function reasonShareKey(reasons) {
    return JSON.stringify(
      reasons.map((reason) => ({
        id: reason.id,
        minutes: reason.minutes == null ? null : reason.minutes,
      }))
    );
  }

  /**
   * @param {string} run
   * @param {'in' | 'out'} action
   */
  function rowIsBeingEdited(run, action) {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !(kioskCard instanceof HTMLElement)) return false;
    if (active instanceof HTMLTextAreaElement && active.dataset.noteFor === run && active.dataset.noteAction === action) {
      return true;
    }
    const box = kioskCard.querySelector(`[data-reason-for="${run}"][data-reason-action="${action}"]`);
    return box instanceof HTMLElement && box.contains(active);
  }

  function noteEditingOpen(date = new Date()) {
    const defaults = payLineDefaults();
    return payPeriodStillOpen(date, defaults.periods, new Date(), defaults.periodEndsAt);
  }

  function noteEditDeadline() {
    const defaults = payLineDefaults();
    const deadline = payPeriodDeadline(new Date(), defaults.periods, defaults.periodEndsAt);
    return deadline ? deadline.toISOString() : new Date(0).toISOString();
  }

  function lockNoteEditors() {
    const open = noteEditingOpen();
    if (!(kioskCard instanceof HTMLElement)) return;
    const controls = kioskCard.querySelectorAll(
      'textarea[data-note-for], .kiosk-card-reason select, .kiosk-card-reason input, .kiosk-card-reason button, .kiosk-card-notes button'
    );
    for (const control of controls) {
      if (
        !(
          control instanceof HTMLInputElement ||
          control instanceof HTMLTextAreaElement ||
          control instanceof HTMLSelectElement ||
          control instanceof HTMLButtonElement
        )
      ) {
        continue;
      }
      control.disabled = !open;
      control.title = open ? '' : 'This pay period has ended.';
    }
  }

  /**
   * @param {string} run
   * @param {'in' | 'out'} action
   */
  async function openNoteShare(run, action) {
    if (!selected) return null;
    const response = await fetch('/api/clock-note', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driverName: selected.name,
        run,
        action,
        date: localDateString(new Date()),
        editableUntil: noteEditDeadline(),
        note: kioskNoteText(run, action),
        reasons: kioskReasonCodes(run, action),
        catalog: catalog().map((code) => ({ id: code.id, label: code.label })),
      }),
    });
    if (!response.ok) return null;
    return response.json();
  }

  /**
   * @param {string} run
   * @param {'in' | 'out'} action
   * @param {{ note?: string, reasons?: Array<{ id: string, label: string, minutes?: number }> }} slot
   */
  function applySharedNote(run, action, slot) {
    const key = `${run}:${action}`;
    const note = String(slot.note || '');
    noteDrafts.set(key, note);
    const area = routeNoteField(run, action);
    if (area && area.value !== note) area.value = note;
    savePunchNote(run, action, note);
    const reasons = Array.isArray(slot.reasons) ? slot.reasons : [];
    const previous = reasonShareKey(kioskReasonCodes(run, action));
    reasonDrafts.set(key, reasonsToDraft(reasons));
    reasonPending.delete(key);
    const box = kioskCard?.querySelector(`[data-reason-for="${run}"][data-reason-action="${action}"]`);
    const punchId = box instanceof HTMLElement ? box.dataset.punchId || '' : '';
    savePunchReasons(punchId, reasons);
    return previous !== reasonShareKey(reasons);
  }

  /**
   * Punched rows on the open card, in the order the driver sees them.
   * @returns {Array<{ run: string, action: 'in' | 'out', clock: string }>}
   */
  function punchedNoteRows() {
    if (!(kioskCard instanceof HTMLElement)) return [];
    /** @type {Array<{ run: string, action: 'in' | 'out', clock: string }>} */
    const rows = [];
    for (const row of kioskCard.querySelectorAll('.kiosk-card-row')) {
      const stamp = row.querySelector('.kiosk-card-stamp');
      const area = row.querySelector('textarea[data-note-for]');
      if (!(stamp instanceof HTMLElement) || !(area instanceof HTMLTextAreaElement)) continue;
      const run = area.dataset.noteFor || '';
      const action = area.dataset.noteAction || '';
      if (!run || (action !== 'in' && action !== 'out')) continue;
      const clocks = [...stamp.querySelectorAll('.kiosk-punch-time span, .kiosk-punch-time s')]
        .map((item) => item.textContent?.trim() || '')
        .filter(Boolean);
      rows.push({ run, action: action === 'in' ? 'in' : 'out', clock: clocks.join(', ') });
    }
    return rows;
  }

  async function paintDayQr(token) {
    if (!(kioskDayQrCode instanceof HTMLCanvasElement) || !kioskDayQr) return;
    const link = String(token || '').trim();
    if (!link) {
      hideDayQr();
      return;
    }
    let origin = '';
    try {
      origin = await loadShareOrigin();
    } catch {
      origin = '';
    }
    if (!origin && location.origin) origin = location.origin;
    const url = noteDayUrl(origin, link);
    if (!url) {
      hideDayQr();
      return;
    }
    if (noteDayUrlSeen !== url) {
      try {
        await QRCode.toCanvas(kioskDayQrCode, url, {
          width: 288,
          margin: 1,
          color: { dark: '#102824', light: '#ffffff' },
        });
        noteDayUrlSeen = url;
        kioskDayQrCode.dataset.dayUrl = url;
      } catch {
        hideDayQr();
        return;
      }
    }
    kioskDayQr.hidden = false;
  }

  /**
   * @param {Array<{ run: string, action: 'in' | 'out', clock: string }>} rows
   */
  async function openDayShare(rows) {
    if (!selected) return null;
    const response = await fetch('/api/clock-note-day', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driverName: selected.name,
        date: localDateString(new Date()),
        editableUntil: noteEditDeadline(),
        catalog: catalog().map((code) => ({ id: code.id, label: code.label })),
        rows: rows.map((row) => ({
          run: row.run,
          action: row.action,
          clock: row.clock,
          note: kioskNoteText(row.run, row.action),
          reasons: kioskReasonCodes(row.run, row.action),
        })),
      }),
    });
    if (!response.ok) return null;
    return response.json();
  }

  async function syncNoteShares() {
    if (noteShareSyncing || applyingSharedNote || paintingCard) return;
    if (!selected || kiosk.hidden || kioskActions.hidden || !(kioskCard instanceof HTMLElement)) return;
    const slots = punchedNoteRows();
    noteShareSyncing = true;
    let reasonsChanged = false;
    try {
      for (const slot of slots) {
        const opened = await openNoteShare(slot.run, slot.action);
        if (!selected) return;
        if (!opened) continue;
        const key = `${slot.run}:${slot.action}`;
        noteShareTokens.set(key, String(opened.token || ''));
        const remoteReasons = Array.isArray(opened.reasons) ? opened.reasons : [];
        const same =
          kioskNoteText(slot.run, slot.action) === String(opened.note || '') &&
          reasonShareKey(kioskReasonCodes(slot.run, slot.action)) === reasonShareKey(remoteReasons);
        if (same || rowIsBeingEdited(slot.run, slot.action)) {
          if (same) {
            noteShareSeen.set(key, {
              revision: Number(opened.revision) || 1,
              note: String(opened.note || ''),
              reasons: reasonShareKey(remoteReasons),
            });
          }
          continue;
        }
        if (applySharedNote(slot.run, slot.action, opened)) reasonsChanged = true;
        noteShareSeen.set(key, {
          revision: Number(opened.revision) || 1,
          note: String(opened.note || ''),
          reasons: reasonShareKey(remoteReasons),
        });
      }
      if (reasonsChanged) {
        applyingSharedNote = true;
        paintRouteCards();
        applyingSharedNote = false;
      }
      const day = await openDayShare(slots);
      if (day?.token) {
        noteDayToken = String(day.token);
        await paintDayQr(noteDayToken);
      }
      lockNoteEditors();
    } catch {
      // The clock keeps working when the phone link is unavailable.
    } finally {
      noteShareSyncing = false;
      applyingSharedNote = false;
    }
  }

  /**
   * @param {string} run
   * @param {string} action
   */
  async function publishNoteShare(run, action) {
    if (!selected || paintingCard || applyingSharedNote || (action !== 'in' && action !== 'out')) return;
    if (!noteEditingOpen()) return;
    const key = `${run}:${action}`;
    const note = kioskNoteText(run, action);
    const reasons = kioskReasonCodes(run, action);
    const seen = noteShareSeen.get(key);
    if (seen && seen.note === note && seen.reasons === reasonShareKey(reasons)) return;
    try {
      const opened = await openNoteShare(run, action);
      if (!opened?.token) return;
      noteShareTokens.set(key, String(opened.token));
      const send = (revision) =>
        fetch(`/api/clock-note/${encodeURIComponent(opened.token)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ revision, note, reasons }),
        });
      let response = await send(Number(opened.revision) || 1);
      let body = await response.json().catch(() => null);
      if (response.status === 409 && body?.revision != null) {
        response = await send(body.revision);
        body = await response.json().catch(() => null);
      }
      if (!response.ok || !body) return;
      noteShareSeen.set(key, {
        revision: Number(body.revision) || 1,
        note: String(body.note || ''),
        reasons: reasonShareKey(Array.isArray(body.reasons) ? body.reasons : []),
      });
    } catch {
      // A missed phone update can be sent again the next time the note changes.
    }
  }

  function onPinInput() {
    const entered = pinDigits(kioskPin.value);
    if (kioskPin.value !== entered) kioskPin.value = entered;
    if (kioskPinError) kioskPinError.textContent = '';
    if (entered.length === 4) checkPin(entered);
  }

  /**
   * @param {string} entered
   */
  function checkPin(entered) {
    if (!selected || unlocked || !/^\d{4}$/.test(entered)) return;
    if (pinFor(selected.id) !== entered) {
      kioskPin.value = '';
      if (kioskPinError) kioskPinError.textContent = 'That PIN does not match.';
      kioskPin.focus();
      return;
    }
    substituteName = '';
    showPunchStep();
  }

  function payPeriods() {
    return normalizeClockPayDefaults(state().clockPayDefaults).periods;
  }

  function timecardPanel() {
    return document.querySelector('#kiosk-timecard');
  }

  function hideTimecard() {
    timecardPunchId = '';
    timecardDraft = [];
    const panel = timecardPanel();
    if (panel) panel.hidden = true;
    const choices = document.querySelector('#kiosk-timecard-choices');
    const form = document.querySelector('#kiosk-timecard-form');
    if (choices) choices.hidden = true;
    if (form) form.hidden = true;
    if (kioskActions) kioskActions.hidden = false;
  }

  function openClockOuts() {
    if (!selected) return [];
    const punches = Array.isArray(state().punches) ? state().punches : [];
    const driver = selected.name.trim().toLowerCase();
    const now = new Date();
    return punches
      .filter((punch) => {
        if (punch?.action !== 'out' || punch.removed === true) return false;
        if (String(punch.driver_name || '').trim().toLowerCase() !== driver) return false;
        const when = new Date(punch.punched_at);
        return (
          payPeriodStillOpen(when, payPeriods(), now, payLineDefaults().periodEndsAt) &&
          sessionForClockOut(punches, punch.id)
        );
      })
      .sort((a, b) => String(b.punched_at).localeCompare(String(a.punched_at)));
  }

  function refreshTimecardButton() {
    const button = document.querySelector('#kiosk-timecard-open');
    if (!(button instanceof HTMLButtonElement)) return;
    button.hidden = openClockOuts().length === 0;
  }

  function showTimecardChoices() {
    const panel = timecardPanel();
    const choices = document.querySelector('#kiosk-timecard-choices');
    const form = document.querySelector('#kiosk-timecard-form');
    const list = document.querySelector('#kiosk-timecard-choice-list');
    if (!panel || !choices || !list) return;
    timecardReturn = 'choices';
    if (kioskActions) kioskActions.hidden = true;
    panel.hidden = false;
    choices.hidden = false;
    if (form) form.hidden = true;
    list.replaceChildren();
    const punches = Array.isArray(state().punches) ? state().punches : [];
    for (const punch of openClockOuts()) {
      const session = sessionForClockOut(punches, punch.id);
      const button = document.createElement('button');
      button.type = 'button';
      const when = new Date(punch.punched_at);
      const day = when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      const range = session
        ? `${punchDisplayClock(session.start)}–${punchDisplayClock(session.end)}`
        : punchDisplayClock(when);
      const codes = normalizeTimecardEntries(punch.timecard_entries);
      const marked = codes.length ? ` · ${codes.map((entry) => entry.label).join(', ')}` : ' · No codes';
      button.textContent = `${day} · ${range}${marked}`;
      button.addEventListener('click', () => openTimecardForm(punch.id, 'choices'));
      list.append(button);
    }
  }

  /**
   * @param {string} punchId
   * @param {'roster' | 'choices'} back
   */
  function openTimecardForm(punchId, back) {
    const punches = Array.isArray(state().punches) ? state().punches : [];
    const punch = punches.find((item) => item?.id === punchId);
    const session = sessionForClockOut(punches, punchId);
    const panel = timecardPanel();
    const form = document.querySelector('#kiosk-timecard-form');
    const choices = document.querySelector('#kiosk-timecard-choices');
    const lead = document.querySelector('#kiosk-timecard-lead');
    const skip = document.querySelector('#kiosk-timecard-skip');
    if (!punch || !session || !panel || !form) return;
    timecardPunchId = punchId;
    timecardReturn = back;
    timecardDraft = normalizeTimecardEntries(punch.timecard_entries).map((entry) => ({
      id: entry.id,
      hours: String(Math.floor(entry.minutes / 60)),
      minutes: String(entry.minutes % 60),
      comment: entry.comment,
      ticket: '',
    }));
    const savedTicket = normalizeTripTicket(punch.trip_ticket);
    if (savedTicket && !timecardDraft.some((entry) => entry.id === TRIP_TICKET_WORK_TYPE)) {
      timecardDraft.unshift({
        id: TRIP_TICKET_WORK_TYPE,
        hours: '',
        minutes: '',
        comment: '',
        ticket: savedTicket,
      });
    }
    if (kioskActions) kioskActions.hidden = true;
    panel.hidden = false;
    form.hidden = false;
    if (choices) choices.hidden = true;
    if (skip instanceof HTMLButtonElement) skip.hidden = back !== 'roster';
    if (lead) {
      lead.textContent = `${punchDisplayClock(session.start)}–${punchDisplayClock(session.end)}. Optional. The times can add up to ${formatTimecardMinutes(session.minutes)} or less.`;
    }
    const error = document.querySelector('#kiosk-timecard-error');
    if (error) {
      error.hidden = true;
      error.textContent = '';
    }
    renderTimecardRows();
  }

  function renderTimecardRows() {
    const host = document.querySelector('#kiosk-timecard-rows');
    if (!host) return;
    host.replaceChildren();
    const codes = catalog();
    timecardDraft.forEach((row, index) => {
      const block = document.createElement('div');
      block.className = 'kiosk-timecard-row';
      const select = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Choose a code';
      select.append(blank);
      for (const code of codes) {
        const option = document.createElement('option');
        option.value = code.id;
        option.textContent = code.label;
        select.append(option);
      }
      if (codes.some((code) => code.id === row.id)) select.value = row.id;
      select.addEventListener('change', () => {
        timecardDraft[index].id = select.value;
        renderTimecardRows();
      });
      const hours = document.createElement('input');
      hours.type = 'number';
      hours.min = '0';
      hours.max = '24';
      hours.inputMode = 'numeric';
      hours.value = row.hours;
      hours.addEventListener('input', () => {
        timecardDraft[index].hours = hours.value;
      });
      const minutes = document.createElement('input');
      minutes.type = 'number';
      minutes.min = '0';
      minutes.max = '59';
      minutes.inputMode = 'numeric';
      minutes.value = row.minutes;
      minutes.addEventListener('input', () => {
        timecardDraft[index].minutes = minutes.value;
      });
      const time = document.createElement('div');
      time.className = 'kiosk-timecard-time';
      const hoursLabel = document.createElement('label');
      hoursLabel.append('Hours', hours);
      const minutesLabel = document.createElement('label');
      minutesLabel.append('Minutes', minutes);
      time.append(hoursLabel, minutesLabel);
      const comment = document.createElement('textarea');
      comment.rows = 2;
      comment.maxLength = 200;
      comment.placeholder = 'Comment, if you want one';
      comment.value = row.comment;
      comment.addEventListener('input', () => {
        timecardDraft[index].comment = comment.value;
      });
      const ticket = document.createElement('input');
      ticket.type = 'text';
      ticket.maxLength = 40;
      ticket.placeholder = 'Trip ticket number';
      ticket.autocomplete = 'off';
      ticket.value = row.ticket || '';
      ticket.addEventListener('input', () => {
        timecardDraft[index].ticket = ticket.value;
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Remove code';
      remove.addEventListener('click', () => {
        timecardDraft.splice(index, 1);
        renderTimecardRows();
      });
      if (row.id === TRIP_TICKET_WORK_TYPE) {
        const ticketLabel = document.createElement('label');
        ticketLabel.append('Trip ticket number', ticket);
        block.append(select, ticketLabel, remove);
      } else {
        block.append(select, time, comment, remove);
      }
      host.append(block);
    });
  }

  function addTimecardRow() {
    timecardDraft.push({ id: '', hours: '', minutes: '', comment: '', ticket: '' });
    renderTimecardRows();
  }

  function timecardMinutes(row) {
    const hours = Number(row.hours);
    const minutes = Number(row.minutes);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || minutes < 0 || minutes > 59) {
      return null;
    }
    return hours * 60 + minutes;
  }

  function setTimecardError(message) {
    const error = document.querySelector('#kiosk-timecard-error');
    if (!error) return;
    error.hidden = !message;
    error.textContent = message || '';
  }

  /**
   * Stay on this driver's punch card after a punch or timecard.
   * @param {string} [message]
   */
  function returnToPunchCard(message) {
    hideTimecard();
    if (!selected) {
      showList();
      if (message) showPunchConfirm(substituteName, message);
      return;
    }
    clearKioskRun();
    paintLeaveNote();
    refreshTimecardButton();
    paintDriverHeading(selected);
    if (message) showPunchConfirm(substituteName || selected.name, message);
    focusNextPunch();
  }

  function finishTimecard(message) {
    returnToPunchCard(message);
  }

  function leaveTimecard() {
    if (timecardReturn === 'choices' && document.querySelector('#kiosk-timecard-form')?.hidden === false) {
      showTimecardChoices();
      return;
    }
    if (timecardReturn === 'roster') {
      returnToPunchCard(timecardDoneMessage || 'Clocked out');
      return;
    }
    hideTimecard();
  }

  function skipTimecard() {
    returnToPunchCard(timecardDoneMessage || 'Clocked out');
  }

  function saveTimecard() {
    if (!timecardPunchId) return;
    const entries = [];
    let tripTicket = '';
    for (const row of timecardDraft) {
      if (!row.id && !row.hours && !row.minutes && !row.comment.trim() && !String(row.ticket || '').trim()) continue;
      if (row.id === TRIP_TICKET_WORK_TYPE) {
        tripTicket = normalizeTripTicket(row.ticket);
        if (!tripTicket) {
          setTimecardError('Enter the trip ticket number.');
          return;
        }
        continue;
      }
      const minutes = timecardMinutes(row);
      if (minutes == null || minutes < 1) {
        setTimecardError('Enter the time for each code.');
        return;
      }
      entries.push({ id: row.id, minutes, comment: row.comment });
    }
    try {
      const next = state();
      next.punches = stampTripTicket(
        setTimecardEntries(Array.isArray(next.punches) ? next.punches : [], timecardPunchId, {
          entries,
          catalog: catalog(),
          periods: payPeriods(),
          periodEndsAt: payLineDefaults().periodEndsAt,
        }),
        timecardPunchId,
        tripTicket
      );
      writeState(next);
    } catch (error) {
      setTimecardError(error instanceof Error ? error.message : 'Could not save those codes.');
      return;
    }
    const summary = timecardSummary(normalizeTimecardEntries(entries, catalog()));
    const ticket = tripTicketLine(tripTicket);
    finishTimecard([summary, ticket].filter(Boolean).join('\n') || 'Timecard codes cleared.');
  }

  function leaveRequestPanel() {
    return document.querySelector('#kiosk-leave-request-panel');
  }

  /**
   * @param {{ clockRuns?: string[], clockIns?: string[] } | null | undefined} person
   */
  function clockByRunFor(person) {
    /** @type {Record<string, string>} */
    const clocks = {};
    const runs = Array.isArray(person?.clockRuns) ? person.clockRuns : [];
    const times = Array.isArray(person?.clockIns) ? person.clockIns : [];
    runs.forEach((run, index) => {
      const clock = String(times[index] || '').trim();
      if (run && clock) clocks[run] = clock;
    });
    return clocks;
  }

  /**
   * @param {string} dateKey
   * @returns {Record<'AM' | 'MIDDAY' | 'PM', number | null>}
   */
  function contractedFor(dateKey) {
    /** @type {Record<'AM' | 'MIDDAY' | 'PM', number | null>} */
    const empty = { AM: null, MIDDAY: null, PM: null };
    if (!selected || typeof contractedMinutes !== 'function') return empty;
    try {
      const result = contractedMinutes(selected.name, dateKey) || {};
      for (const run of ['AM', 'MIDDAY', 'PM']) {
        const minutes = Number(result[run]);
        empty[run] = Number.isInteger(minutes) && minutes > 0 ? minutes : null;
      }
    } catch {
      return { AM: null, MIDDAY: null, PM: null };
    }
    return empty;
  }

  /**
   * @param {string} message
   */
  function setLeaveRequestError(message) {
    const error = document.querySelector('#kiosk-leave-request-error');
    if (!error) return;
    error.hidden = !message;
    error.textContent = message || '';
  }

  /**
   * @param {number} minutes
   */
  function fillLeaveHours(minutes) {
    const parts = leaveTimeParts(minutes);
    const hours = document.querySelector('#kiosk-leave-request-hours');
    const mins = document.querySelector('#kiosk-leave-request-minutes');
    if (hours instanceof HTMLInputElement) hours.value = parts.hours ? String(parts.hours) : minutes ? '0' : '';
    if (mins instanceof HTMLInputElement) mins.value = minutes ? String(parts.minutes) : '';
  }

  function leaveSelection() {
    const date = document.querySelector('#kiosk-leave-request-date');
    const run = document.querySelector('#kiosk-leave-request-run');
    return {
      date: date instanceof HTMLInputElement ? date.value : '',
      run: run instanceof HTMLSelectElement ? run.value : '',
    };
  }

  function refreshLeaveForm() {
    if (!selected) return;
    const { date, run } = leaveSelection();
    const today = localDateString();
    const punches = Array.isArray(state().punches) ? state().punches : [];
    const clockedIn = Boolean(date && run && driverClockedIn(punches, selected.name, date, run));
    const contracted = date && (run === 'AM' || run === 'MIDDAY' || run === 'PM') ? contractedFor(date)[run] : null;
    const existing = date && run ? leaveFor(state().leaveRequests, selected.name, date, run) : null;
    const lead = document.querySelector('#kiosk-leave-request-lead');
    if (lead) lead.textContent = leaveRequestLead({ run, date, today, clockedIn });
    const contract = document.querySelector('#kiosk-leave-request-contract');
    const contractText = clockedIn ? '' : leaveContractLead(contracted);
    if (contract) {
      contract.hidden = !contractText;
      contract.textContent = contractText;
    }
    const time = document.querySelector('#kiosk-leave-request-time');
    if (time) time.hidden = clockedIn;
    const save = document.querySelector('#kiosk-leave-request-save');
    if (save instanceof HTMLButtonElement) save.disabled = clockedIn;
    const limit = leaveMinuteLimit(contracted);
    const hours = document.querySelector('#kiosk-leave-request-hours');
    if (hours instanceof HTMLInputElement) hours.max = String(Math.max(0, Math.floor(limit / 60)));
    fillLeaveHours(existing?.minutes || contracted || 0);
    setLeaveRequestError('');
  }

  function closeLeaveRequest() {
    const panel = leaveRequestPanel();
    const wasOpen = panel?.hidden === false;
    if (panel) panel.hidden = true;
    setLeaveRequestError('');
    syncPunchPanels();
    refreshTimecardButton();
    paintLeaveNote();
    if (wasOpen) focusNextPunch();
  }

  /**
   * @param {string} [run]
   */
  function openLeaveRequest(run) {
    if (!LEAVE_REQUESTS_ENABLED) return;
    const panel = leaveRequestPanel();
    if (!panel || !selected) return;
    closeChunkPanel();
    if (kioskWork) kioskWork.hidden = true;
    pendingAction = '';
    pendingRun = '';
    const timecardOpen = document.querySelector('#kiosk-timecard-open');
    if (timecardOpen) timecardOpen.hidden = true;
    panel.hidden = false;
    syncPunchPanels();
    const date = document.querySelector('#kiosk-leave-request-date');
    const select = document.querySelector('#kiosk-leave-request-run');
    const open = openClock();
    const fromOpen = open?.run === 'AM' || open?.run === 'MIDDAY' || open?.run === 'PM' ? open.run : '';
    const initialRun = run || fromOpen || 'AM';
    if (date instanceof HTMLInputElement) date.value = localDateString();
    if (select instanceof HTMLSelectElement) select.value = initialRun;
    refreshLeaveForm();
    const hours = document.querySelector('#kiosk-leave-request-hours');
    if (hours instanceof HTMLElement) hours.focus();
  }

  function saveLeaveFromKiosk() {
    if (!LEAVE_REQUESTS_ENABLED || !selected) return;
    const { date, run } = leaveSelection();
    const hours = document.querySelector('#kiosk-leave-request-hours');
    const mins = document.querySelector('#kiosk-leave-request-minutes');
    const minutes = leaveMinutesFromParts(
      hours instanceof HTMLInputElement ? hours.value : '',
      mins instanceof HTMLInputElement ? mins.value : ''
    );
    const contracted = run === 'AM' || run === 'MIDDAY' || run === 'PM' ? contractedFor(date)[run] : null;
    const next = state();
    try {
      next.leaveRequests = saveLeaveRequest(next.leaveRequests, {
        driver_name: selected.name,
        date,
        run,
        minutes: minutes || 0,
        contractedMinutes: contracted,
        punches: next.punches,
        substitute_name: substituteName,
      });
    } catch (error) {
      setLeaveRequestError(error instanceof Error ? error.message : 'Could not save that leave request.');
      return;
    }
    next.drivers = applyLeaveRequests(next.drivers, next.leaveRequests);
    writeState(next);
    const detail = `Leave requested for the ${punchRunLabel(run)} on ${leaveDateLabel(date)} · ${formatDurationLabel(minutes || 0)}`;
    const awaiting = runsAwaitingLeave({
      clockByRun: clockByRunFor(selected),
      punches: next.punches,
      requests: next.leaveRequests,
      driverName: selected.name,
      now: new Date(),
    });
    const name = substituteName || selected.name;
    if (date === localDateString() && awaiting.length) {
      const select = document.querySelector('#kiosk-leave-request-run');
      if (select instanceof HTMLSelectElement) select.value = awaiting[0];
      refreshLeaveForm();
      showPunchConfirm(name, detail);
      return;
    }
    showList();
    showPunchConfirm(name, detail);
  }

  /**
   * @param {'in' | 'out'} action
   * @param {string} run
   * @param {boolean} [confirmed]
   */
  function punch(action, run, confirmed = false) {
    if (!selected || !unlocked) return;
    const chosen = normalizePunchRun(run);
    const error = document.querySelector('#kiosk-run-error');
    const workError = document.querySelector('#kiosk-work-error');
    if (!chosen) {
      if (error) {
        error.hidden = false;
        error.textContent = 'Choose AM route, Mid day route, PM route, or Other.';
      }
      return;
    }
    const workType = chosen === 'OTHER' ? chosenWorkType() : '';
    if (chosen === 'OTHER' && !workType) {
      if (workError) {
        workError.hidden = false;
        workError.textContent = 'Choose the kind of work.';
      }
      return;
    }
    const tripTicket = workType === TRIP_TICKET_WORK_TYPE
      ? normalizeTripTicket(kioskTripTicket instanceof HTMLInputElement ? kioskTripTicket.value : '')
      : '';
    if (workType === TRIP_TICKET_WORK_TYPE && !tripTicket) {
      if (workError) {
        workError.hidden = false;
        workError.textContent = 'Enter the trip ticket number.';
      }
      if (kioskTripTicket instanceof HTMLInputElement) kioskTripTicket.focus();
      return;
    }
    const existing = punchesAlreadyThere(action, chosen);
    if (!confirmed && existing.length) {
      openReplaceConfirm(action, chosen, existing);
      return;
    }
    closeReplaceConfirm();
    const payStatus = payStatusForSelected(chosen);
    const next = state();
    const punches = Array.isArray(next.punches) ? next.punches : [];
    /** @type {{ id: string, driver_name: string, action: 'in' | 'out', punched_at: string, note: string, reason_codes: object[], run: 'AM' | 'MIDDAY' | 'PM' | 'OTHER', pay_status?: string, substitute_name?: string }} */
    const record = {
      id: crypto.randomUUID(),
      driver_name: selected.name,
      action,
      punched_at: new Date().toISOString(),
      note: kioskNoteText(chosen, action),
      reason_codes: kioskReasonCodes(chosen, action),
      run: chosen,
    };
    if (workType) record.work_type = workType;
    if (tripTicket) record.trip_ticket = tripTicket;
    if (payStatus) record.pay_status = payStatus;
    if (substituteName) record.substitute_name = substituteName;
    noteDrafts.delete(`${chosen}:${action}`);
    reasonDrafts.delete(`${chosen}:${action}`);
    reasonPending.delete(`${chosen}:${action}`);
    if (chosen === 'OTHER') {
      const panel = document.querySelector('#kiosk-note-OTHER');
      if (panel instanceof HTMLTextAreaElement) panel.value = '';
    }
    next.punches = [...punches, record];
    if (action === 'in' && (chosen === 'AM' || chosen === 'MIDDAY' || chosen === 'PM')) {
      next.leaveRequests = dropLeaveForClockIn(next.leaveRequests, {
        driver_name: selected.name,
        date: localDateString(new Date(record.punched_at)),
        run: chosen,
      });
      next.drivers = applyLeaveRequests(next.drivers, next.leaveRequests);
    }
    writeState(next);
    if (selected) paintDriverHeading(selected);
    playPunchSound(
      punchSoundFor(
        action === 'in' ? next.clockPunchSoundIn : next.clockPunchSoundOut,
        action === 'in' ? DEFAULT_PUNCH_SOUND_IN : DEFAULT_PUNCH_SOUND_OUT
      )
    );
    const displayName = substituteName || selected.name;
    const verb = action === 'in' ? 'Clocked in' : 'Clocked out';
    const when = punchDisplayClock(new Date(record.punched_at));
    const routeLabel = workType ? workTypeLabel(workType) : punchRunLabel(chosen);
    const ticketNote = tripTicketLine(tripTicket);
    const detailParts = ticketNote ? `${routeLabel} · ${ticketNote}` : routeLabel;
    const detail = substituteName
      ? `${verb} at ${when} for ${selected.name} · ${detailParts}`
      : `${verb} at ${when} · ${detailParts}`;
    if (action === 'out' && sessionForClockOut(next.punches, record.id)) {
      timecardDoneMessage = detail;
      openTimecardForm(record.id, 'roster');
      return;
    }
    returnToPunchCard(detail);
  }

  function tick() {
    const now = new Date();
    const dateLine = document.querySelector('#kiosk-now-date');
    const timeLine = document.querySelector('#kiosk-now-time');
    const dateText = now.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    const timeText = kioskLiveClock(now);
    if (dateLine) dateLine.textContent = dateText;
    if (timeLine) timeLine.textContent = timeText;
    if (kioskCard) {
      for (const live of kioskCard.querySelectorAll('.kiosk-punch-live')) live.textContent = timeText;
    }
    if (localDateString() !== rosterDate && !kiosk.hidden && !kioskList.hidden) renderRoster();
    paintRosterLate();
  }

  function holdBack() {
    history.pushState({ timeclock: true }, '', location.href);
  }

  function onPopState() {
    if (kiosk.hidden) return;
    holdBack();
  }

  /**
   * @param {string} message
   * @param {boolean} [isError]
   */
  function setScreenStatus(message, isError = false) {
    if (!screenStatus) return;
    screenStatus.hidden = !message;
    screenStatus.textContent = message || '';
    screenStatus.classList.toggle('is-error', isError);
  }

  function hideScreenChoices() {
    if (screenChoices) screenChoices.hidden = true;
    screenList?.replaceChildren();
  }

  function updateFillButton() {
    if (!(kioskFill instanceof HTMLButtonElement)) return;
    const external = isExternalTimeclockSearch(location.search);
    kioskFill.hidden = !external || kiosk.hidden || Boolean(document.fullscreenElement);
  }

  async function enterFullscreen() {
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (typeof request !== 'function') return false;
    try {
      await request.call(root);
      return true;
    } catch {
      return false;
    }
  }

  async function onFillScreen() {
    await enterFullscreen();
    updateFillButton();
  }

  /**
   * @param {object | null} screen
   */
  function openTimeclockWindow(screen) {
    const placed = Boolean(screen);
    const opened = window.open(
      timeclockWindowUrl(location.href, { fill: placed }),
      'teamster-timeclock',
      timeclockWindowFeatures(screen)
    );
    if (!opened) {
      setScreenStatus('Allow pop-up windows for this site, then choose On another screen again.', true);
      return;
    }
    const bounds = timeclockWindowBounds(screen);
    if (bounds) {
      try {
        opened.moveTo(bounds.left, bounds.top);
        opened.resizeTo(bounds.width, bounds.height);
      } catch {
        // The browser can refuse to move a window until it allows screen placement.
      }
    }
    opened.focus();
    const where = screen ? timeclockScreenLabel(screen) : '';
    setScreenStatus(
      where
        ? `The timeclock is open on ${where}. This window stays on Clocking. Choose Fill this screen there if you still see the browser around it.`
        : 'The timeclock opened in a new window. Drag it onto the other monitor, then choose Fill this screen.'
    );
  }

  /**
   * @param {object[]} screens
   */
  function showScreenChoices(screens) {
    if (!screenChoices || !screenList) {
      openTimeclockWindow(screens[0] || null);
      return;
    }
    screenList.replaceChildren();
    for (const screen of screens) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = timeclockScreenLabel(screen);
      button.addEventListener('click', () => {
        hideScreenChoices();
        openTimeclockWindow(screen);
      });
      screenList.append(button);
    }
    screenChoices.hidden = false;
    setScreenStatus('');
  }

  async function onStartAnotherScreen() {
    hideScreenChoices();
    setScreenStatus('');
    if (window.screen?.isExtended === false) {
      setScreenStatus(
        'This computer is using one screen. Connect the other monitor, set it to extend this desktop, then choose On another screen again.',
        true
      );
      return;
    }
    if (typeof window.getScreenDetails !== 'function') {
      openTimeclockWindow(null);
      return;
    }
    /** @type {{ screens?: object[], currentScreen?: object } | undefined} */
    let details;
    try {
      details = await window.getScreenDetails();
    } catch {
      openTimeclockWindow(null);
      return;
    }
    const others = otherTimeclockScreens(details);
    if (!others.length) {
      setScreenStatus(
        'This computer is using one screen. Connect the other monitor, set it to extend this desktop, then choose On another screen again.',
        true
      );
      return;
    }
    if (others.length === 1) {
      openTimeclockWindow(others[0]);
      return;
    }
    showScreenChoices(others);
  }

  /**
   * @param {{ fill?: boolean }} [options]
   */
  async function startKiosk({ fill = true } = {}) {
    sessionStorage.setItem(LOCK_KEY, '1');
    kiosk.hidden = false;
    document.body.classList.add('is-timeclock');
    if (isExternalTimeclockSearch(location.search)) document.title = 'Timeclock';
    showList();
    tick();
    clearInterval(clockTimer);
    clockTimer = setInterval(tick, 1000);
    holdBack();
    window.addEventListener('popstate', onPopState);
    if (fill) await enterFullscreen();
    updateFillButton();
  }

  function onLeave(event) {
    event.preventDefault();
    if (kioskLeaveError) kioskLeaveError.textContent = '';
    if (kioskLeaveCode.value.trim() !== lockCode()) {
      kioskLeaveCode.value = '';
      if (kioskLeaveError) kioskLeaveError.textContent = 'That Admin Lock Code does not match.';
      kioskLeaveCode.focus();
      return;
    }
    exitKiosk();
  }

  /** Temporary: Back skips the lock code while testing. */
  function exitKiosk() {
    const external = isExternalTimeclockSearch(location.search);
    sessionStorage.removeItem(LOCK_KEY);
    hidePunchConfirm();
    kiosk.hidden = true;
    document.body.classList.remove('is-timeclock');
    clearInterval(clockTimer);
    window.removeEventListener('popstate', onPopState);
    kioskLeaveCode.value = '';
    updateFillButton();
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    if (external) window.close();
  }

  function refresh() {
    fillLockField();
    fillPaperBackupReminder();
    fillLateFlash();
    fillEarlyRelease();
    fillQuarterClocks();
    fillOvertimeRules();
    fillPayDefaults();
    renderPayBrowser();
    renderSummaryTools();
    renderClockingDriverStatuses();
    fillNameSize();
    fillPunchSounds();
    applyNameSize();
    fillPinDrivers();
    renderPinList();
    renderSubstituteList();
    renderReasonList();
    fillKioskReasons();
    if (!kiosk.hidden && kioskDetail.hidden) renderRoster();
  }

  if (typeof ResizeObserver === 'function') {
    const rosterObserver = new ResizeObserver(() => fitRoster());
    rosterObserver.observe(kioskRoster);
  }

  if (sessionStorage.getItem(LOCK_KEY) === '1') {
    kiosk.hidden = false;
    document.body.classList.add('is-timeclock');
    if (isExternalTimeclockSearch(location.search)) document.title = 'Timeclock';
    showList();
    tick();
    clockTimer = setInterval(tick, 1000);
    window.addEventListener('popstate', onPopState);
    updateFillButton();
  } else if (isExternalTimeclockSearch(location.search)) {
    startKiosk({ fill: timeclockWantsFill(location.search) });
  }

  renderPayBrowser();
  renderSummaryTools();
  fillPunchSounds();
  setInterval(() => {
    void syncNoteShares();
  }, 2000);

  return { refresh };
}

/**
 * @param {string[]} routes
 */
function sortedRoutes(routes) {
  return [...routes].filter(Boolean).sort(compareRouteNumbers);
}

/**
 * @param {string[]} routes
 */
function routeParen(routes) {
  const names = sortedRoutes(routes);
  return names.length ? `(${names.join(', ')})` : '';
}

/**
 * @param {{ name: string, routes: string[] }} person
 * @param {string} substitute
 * @param {'in' | 'out'} status
 * @param {{ run?: string, punched_at?: string }} [punch]
 */
function spokenName(person, substitute, status, punch) {
  const routes = sortedRoutes(person.routes);
  const routeBit = routes.length ? `, route ${routes.join(', ')}` : '';
  const stateBit = ` ${clockedPhrase(status, punch)}`;
  if (substitute) return `${person.name}${stateBit}, substitute ${substitute}${routeBit}`;
  return `${person.name}${stateBit}${routeBit}`;
}

/**
 * @param {HTMLElement} label
 * @param {{ name: string, routes: string[] }} person
 * @param {string} substitute
 */
function fillNameLabel(label, person, substitute) {
  label.replaceChildren();
  const regular = document.createElement('span');
  regular.className = 'kiosk-name-regular';
  const name = document.createElement('span');
  if (substitute) name.classList.add('is-covered');
  name.textContent = person.name;
  regular.append(name);
  label.append(regular);
  if (substitute) {
    const sub = document.createElement('span');
    sub.className = 'kiosk-name-sub';
    sub.textContent = substitute;
    label.append(sub);
  }
  const paren = routeParen(person.routes);
  if (paren) {
    const route = document.createElement('span');
    route.className = 'kiosk-name-route';
    route.textContent = paren;
    label.append(route);
  }
}

/**
 * @param {number} a
 * @param {number} b
 */
function hueDistance(a, b) {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

/**
 * @param {{ background: string, look: string, border: string, alt: string }} paint
 */
function nameStyleKey(paint) {
  return `${paint.background}|${paint.look}|${paint.border}|${paint.alt}`;
}

/**
 * Pick an unused palette slot whose fill stays far from colors already in use,
 * and whose border drawing is not already paired with that fill.
 * @param {Set<number>} used
 */
function nextColorIndex(used) {
  const usedPaints = [...used].map((index) => nameButtonColors(index));
  const usedKeys = new Set(usedPaints.map((paint) => nameStyleKey(paint)));
  const limit = Math.max(used.size + 48, 24);
  let best = -1;
  let bestDistance = -1;
  for (let index = 0; index < limit; index += 1) {
    if (used.has(index)) continue;
    const paint = nameButtonColors(index);
    if (usedKeys.has(nameStyleKey(paint))) continue;
    let nearest = 180;
    for (const other of usedPaints) nearest = Math.min(nearest, hueDistance(paint.hue, other.hue));
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best = index;
    }
  }
  if (best >= 0) return best;
  for (let index = 0; index < limit + used.size + 8; index += 1) {
    if (used.has(index)) continue;
    const paint = nameButtonColors(index);
    if (!usedKeys.has(nameStyleKey(paint))) return index;
  }
  return 0;
}

/** Border drawings. The fill color stays on its own palette. */
const NAME_BORDER_LOOKS = [
  'solid',
  'double',
  'dashed',
  'dotted',
  'ridge',
  'groove',
  'stripe',
  'hash',
  'bands',
  'conic',
  'inset',
  'outset',
];

/** Bold pairs so a border does not just repeat the button's fill. */
const NAME_BORDER_PAIRS = [
  ['#1b3a4b', '#e85d04'],
  ['#3d1e6d', '#f4d35e'],
  ['#0b6e4f', '#d8f3dc'],
  ['#9b2226', '#ee9b00'],
  ['#1d3557', '#e63946'],
  ['#6a040f', '#ffba08'],
  ['#240046', '#c77dff'],
  ['#003049', '#f77f00'],
  ['#132a13', '#c6de41'],
  ['#370617', '#f72585'],
  ['#001219', '#94d2bd'],
  ['#3c096c', '#ff9e00'],
];

/**
 * Painted edge for stripe, hash, band, and conic borders.
 * @param {string} look
 * @param {string} border
 * @param {string} alt
 * @param {number} index
 */
function nameBorderFrame(look, border, alt, index) {
  const angle = 15 + (index % 8) * 18;
  const band = 4 + (index % 3);
  if (look === 'stripe') {
    return {
      image: `repeating-linear-gradient(${angle}deg, ${border} 0 ${band}px, ${alt} ${band}px ${band * 2}px)`,
      image2: 'none',
    };
  }
  if (look === 'bands') {
    const direction = index % 2 === 0 ? 90 : 0;
    const wide = band + 3;
    return {
      image: `repeating-linear-gradient(${direction}deg, ${border} 0 ${wide}px, ${alt} ${wide}px ${wide * 2}px)`,
      image2: 'none',
    };
  }
  if (look === 'conic') {
    return {
      image: `conic-gradient(from ${angle}deg, ${border} 0 25%, ${alt} 0 50%, ${border} 0 75%, ${alt} 0 100%)`,
      image2: 'none',
    };
  }
  if (look === 'hash') {
    return {
      image: `repeating-linear-gradient(${angle}deg, ${border} 0 3px, ${alt} 3px ${band + 6}px)`,
      image2: `repeating-linear-gradient(${angle + 90}deg, transparent 0 3px, ${border} 3px 7px)`,
    };
  }
  return { image: 'none', image2: 'none' };
}

/**
 * Each index gets its own fill and its own border colors plus drawing.
 * The same border drawing is not reused until every look and color pair has been used,
 * and then the fill is on the opposite side of the color wheel.
 * @param {number} index
 */
export function nameButtonColors(index) {
  const lookCount = NAME_BORDER_LOOKS.length;
  const pairCount = NAME_BORDER_PAIRS.length;
  const borderCount = lookCount * pairCount;
  const safe = Number.isInteger(index) && index >= 0 ? index : 0;
  const borderSlot = safe % borderCount;
  const hueCycle = Math.floor(safe / borderCount);
  const hue = (borderSlot * 47 + hueCycle * 180) % 360;
  const band = safe % 3;
  const saturation = [52, 64, 42][band];
  const lightness = [86, 80, 91][band];
  const look = NAME_BORDER_LOOKS[borderSlot % lookCount];
  const [border, alt] = NAME_BORDER_PAIRS[Math.floor(borderSlot / lookCount) % pairCount];
  const frame = nameBorderFrame(look, border, alt, safe);
  return {
    background: `hsl(${hue} ${saturation}% ${lightness}%)`,
    border,
    alt,
    look,
    hue,
    frame: frame.image,
    frame2: frame.image2,
  };
}

function readStoredNameColors() {
  try {
    const parsed = JSON.parse(localStorage.getItem(NAME_COLOR_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Keep a stable color for each driver. New people get a free color; saved ones stay put.
 * @param {Array<{ id: string, name: string }>} drivers
 */
function ensureNameColors(drivers) {
  const stored = readStoredNameColors();
  /** @type {Map<string, number>} */
  const assigned = new Map();
  const used = new Set();
  const usedKeys = new Set();
  const ordered = [...drivers].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  for (const driver of ordered) {
    const saved = stored[driver.id];
    if (!Number.isInteger(saved) || saved < 0 || used.has(saved)) continue;
    const key = nameStyleKey(nameButtonColors(saved));
    if (usedKeys.has(key)) continue;
    assigned.set(driver.id, saved);
    used.add(saved);
    usedKeys.add(key);
  }
  let changed = false;
  for (const driver of ordered) {
    if (assigned.has(driver.id)) continue;
    const index = nextColorIndex(used);
    assigned.set(driver.id, index);
    used.add(index);
    stored[driver.id] = index;
    changed = true;
  }
  if (changed) {
    try {
      localStorage.setItem(NAME_COLOR_KEY, JSON.stringify(stored));
    } catch {
      // The colors still apply for this visit when storage is blocked.
    }
  }
  return assigned;
}
