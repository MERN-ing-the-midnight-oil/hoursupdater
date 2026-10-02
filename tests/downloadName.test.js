import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filenameFromDisposition,
  payrollCreationStamp,
  payrollWorkbookFilename,
  stampedWorkbookFilename,
  workbookCreationStamp,
  workbookTitleFromFilename,
} from '../office-tracker/src/downloadName.js';

describe('spreadsheet download names', () => {
  it('names a payroll file with the weekday, date, and 24-hour time', () => {
    const created = new Date(2023, 10, 17, 14, 52);
    assert.equal(created.getDay(), 5);
    assert.equal(payrollCreationStamp(created), 'Friday_Nov_17_1452');
    assert.equal(
      payrollWorkbookFilename(created),
      'Payroll Driver Times Friday_Nov_17_1452.xlsx'
    );
    assert.equal(
      workbookTitleFromFilename(payrollWorkbookFilename(created)),
      'Payroll Driver Times Friday_Nov_17_1452'
    );
  });

  it('pads the payroll clock and keeps a single-digit day', () => {
    const created = new Date(2026, 0, 5, 9, 5);
    assert.equal(created.getDay(), 1);
    assert.equal(payrollCreationStamp(created), 'Monday_Jan_5_0905');
  });

  it('appends the local creation date and time', () => {
    const created = new Date(2026, 9, 15, 14, 25);
    assert.equal(workbookCreationStamp(created), 'OCT15_14:25');
    assert.equal(
      stampedWorkbookFilename('Payroll_Driver_Times', created),
      'Payroll_Driver_Times_OCT15_14:25.xlsx'
    );
    assert.equal(
      stampedWorkbookFilename('Current_Route_Data', created),
      'Current_Route_Data_OCT15_14:25.xlsx'
    );
  });

  it('keeps a single-digit day and pads the clock', () => {
    const created = new Date(2026, 0, 5, 9, 5);
    assert.equal(workbookCreationStamp(created), 'JAN5_09:05');
  });

  it('reads the download name the server sends', () => {
    const header = 'attachment; filename="Payroll_Driver_Times_OCT15_14:25.xlsx"';
    assert.equal(
      filenameFromDisposition(header),
      'Payroll_Driver_Times_OCT15_14:25.xlsx'
    );
    assert.equal(
      workbookTitleFromFilename('Payroll_Driver_Times_OCT15_14:25.xlsx'),
      'Payroll_Driver_Times_OCT15_14:25'
    );
  });
});
