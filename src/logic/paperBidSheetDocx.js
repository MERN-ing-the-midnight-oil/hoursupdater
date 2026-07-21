/**
 * Build a .docx buffer for a paper bid sign-up sheet.
 *
 * Uses a single flat table (no nested tables) so Apple Pages and similar
 * importers keep the initial boxes — nested tables are flattened to text.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { fitPaperBidNameFontPx } from './paperBidSignup.js';

/** @typedef {ReturnType<import('./paperBidSignup.js').buildPaperBidSheet>} PaperBidSheet */

const THIN = { style: BorderStyle.SINGLE, size: 4, color: '666666' };
const THICK = { style: BorderStyle.SINGLE, size: 12, color: '1C2430' };
const BOX = { style: BorderStyle.SINGLE, size: 8, color: '1C2430' };
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

/** Page content width at 0.75" margins on letter (approx). */
const PAGE_CONTENT_DXA = 9360;
const COL_GAP_DXA = 160;
const COL_COUNT = 3;
const COL_WIDTH_DXA = Math.floor(
  (PAGE_CONTENT_DXA - COL_GAP_DXA * (COL_COUNT - 1)) / COL_COUNT
);
const RANK_DXA = 420;
const INITIALS_DXA = 720;
const NAME_DXA = COL_WIDTH_DXA - RANK_DXA - INITIALS_DXA;

/**
 * @param {string} routeId
 * @returns {string}
 */
export function paperBidSheetDocxFilename(routeId) {
  const safe = String(routeId || 'route')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `paper-bid-signup_${safe || 'route'}.docx`;
}

/**
 * docx half-points from CSS-ish px (approx 1px ≈ 1.5 half-points at 96dpi / 72pt).
 * @param {number} px
 * @returns {number}
 */
function pxToHalfPoints(px) {
  return Math.max(14, Math.round(px * 1.5));
}

/**
 * @param {string} label
 * @param {string} value
 * @returns {Paragraph}
 */
function metaLine(label, value) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 26 }),
      new TextRun({ text: value || '—', size: 26 }),
    ],
  });
}

/**
 * @param {number} size
 * @returns {TableCell}
 */
function gapCell(size = COL_GAP_DXA) {
  return new TableCell({
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
    width: { size, type: WidthType.DXA },
    children: [new Paragraph({ children: [] })],
  });
}

/**
 * @param {string} label
 * @param {number} width
 * @returns {TableCell}
 */
function headerCell(label, width) {
  return new TableCell({
    borders: {
      top: NONE,
      left: NONE,
      right: NONE,
      bottom: THICK,
    },
    width: { size: width, type: WidthType.DXA },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: label,
            bold: true,
            size: 18,
            allCaps: true,
          }),
        ],
      }),
    ],
  });
}

/**
 * @param {import('./paperBidSignup.js').PaperBidSheetDriver | null | undefined} driver
 * @returns {TableCell[]}
 */
function driverCells(driver) {
  if (!driver) {
    return [
      new TableCell({
        borders: { top: NONE, left: NONE, right: NONE, bottom: NONE },
        width: { size: RANK_DXA, type: WidthType.DXA },
        children: [new Paragraph({ children: [] })],
      }),
      new TableCell({
        borders: { top: NONE, left: NONE, right: NONE, bottom: NONE },
        width: { size: NAME_DXA, type: WidthType.DXA },
        children: [new Paragraph({ children: [] })],
      }),
      new TableCell({
        borders: { top: NONE, left: NONE, right: NONE, bottom: NONE },
        width: { size: INITIALS_DXA, type: WidthType.DXA },
        children: [new Paragraph({ children: [] })],
      }),
    ];
  }

  const rank =
    driver.seniority_rank != null ? String(driver.seniority_rank) : '—';
  const namePx = fitPaperBidNameFontPx(driver.name, {
    basePx: 15,
    minPx: 9,
    maxCharsAtBase: 11,
  });

  return [
    new TableCell({
      borders: { top: NONE, left: NONE, right: NONE, bottom: THIN },
      width: { size: RANK_DXA, type: WidthType.DXA },
      children: [
        new Paragraph({
          children: [
            new TextRun({ text: rank, size: 20, color: '5C6673' }),
          ],
        }),
      ],
    }),
    new TableCell({
      borders: { top: NONE, left: NONE, right: NONE, bottom: THIN },
      width: { size: NAME_DXA, type: WidthType.DXA },
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text: driver.name || '—',
              size: pxToHalfPoints(namePx),
              bold: driver.more_senior_than_holder === true,
            }),
          ],
        }),
      ],
    }),
    new TableCell({
      borders: { top: BOX, left: BOX, right: BOX, bottom: BOX },
      width: { size: INITIALS_DXA, type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      children: [
        // Non-breaking space so empty bordered cells keep height in Pages/Word.
        new Paragraph({
          children: [new TextRun({ text: '\u00A0', size: 20 })],
        }),
      ],
    }),
  ];
}

/**
 * Flat 3-column roster table (no nested tables).
 * @param {import('./paperBidSignup.js').PaperBidSheetDriver[][]} columns
 * @returns {Table}
 */
function rosterTable(columns) {
  const cols = columns.slice(0, COL_COUNT);
  while (cols.length < COL_COUNT) cols.push([]);
  const rowCount = Math.max(0, ...cols.map((c) => c.length));

  /** @type {number[]} */
  const columnWidths = [];
  for (let i = 0; i < COL_COUNT; i += 1) {
    if (i > 0) columnWidths.push(COL_GAP_DXA);
    columnWidths.push(RANK_DXA, NAME_DXA, INITIALS_DXA);
  }

  const headerChildren = [];
  for (let i = 0; i < COL_COUNT; i += 1) {
    if (i > 0) headerChildren.push(gapCell());
    headerChildren.push(
      headerCell('#', RANK_DXA),
      headerCell('Driver', NAME_DXA),
      headerCell('Initials', INITIALS_DXA)
    );
  }

  /** @type {TableRow[]} */
  const rows = [new TableRow({ children: headerChildren })];

  for (let r = 0; r < rowCount; r += 1) {
    /** @type {TableCell[]} */
    const cells = [];
    for (let i = 0; i < COL_COUNT; i += 1) {
      if (i > 0) cells.push(gapCell());
      cells.push(...driverCells(cols[i][r]));
    }
    rows.push(new TableRow({ children: cells }));
  }

  return new Table({
    width: { size: PAGE_CONTENT_DXA, type: WidthType.DXA },
    columnWidths,
    rows,
  });
}

/**
 * @param {PaperBidSheet} sheet
 * @returns {import('./paperBidSignup.js').PaperBidSheetDriver[][]}
 */
function columnsFromSheet(sheet) {
  if (Array.isArray(sheet.columns) && sheet.columns.length) {
    return sheet.columns;
  }
  const cols = [];
  if (Array.isArray(sheet.left_column)) cols.push(sheet.left_column);
  if (Array.isArray(sheet.middle_column)) cols.push(sheet.middle_column);
  if (Array.isArray(sheet.right_column)) cols.push(sheet.right_column);
  while (cols.length < COL_COUNT) cols.push([]);
  return cols;
}

/**
 * @param {PaperBidSheet} sheet
 * @returns {Promise<Buffer>}
 */
export async function buildPaperBidSheetDocxBuffer(sheet) {
  const title = sheet.template?.title || 'Open Bid Sign-Up Sheet';
  const intro = sheet.template?.intro || '';
  const footer = sheet.template?.footer || '';
  const columns = columnsFromSheet(sheet);

  /** @type {import('docx').FileChild[]} */
  const children = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 240 },
      children: [new TextRun({ text: title, bold: true, size: 36 })],
    }),
    metaLine('Route', sheet.route_id),
    metaLine('Schedule', sheet.schedule),
    metaLine('Start date', sheet.paper_bid_start_date || '—'),
    metaLine('Current holder', sheet.driver_name || 'Unassigned'),
    metaLine('Sign-up due', sheet.bid_response_due_date || '—'),
  ];

  if (intro) {
    children.push(
      new Paragraph({
        spacing: { before: 180, after: 220 },
        children: [new TextRun({ text: intro, size: 24 })],
      })
    );
  }

  children.push(rosterTable(columns));

  if (footer) {
    children.push(
      new Paragraph({
        spacing: { before: 280 },
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text: footer, size: 22, italics: true })],
      })
    );
  }

  const doc = new Document({
    creator: 'Teamster Tracker',
    title,
    description: `Paper bid sign-up sheet for route ${sheet.route_id}`,
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 720,
              right: 720,
              bottom: 720,
              left: 720,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
