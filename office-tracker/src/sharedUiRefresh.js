// Whether a shared-office reload should wait so Route clock times edits keep focus.
export function shouldDeferSharedUiRefresh(ui = {}) {
  if (ui.startEditOpen || ui.changeEditOpen || ui.changeDialogOpen) return true;
  if (ui.focusInScheduleHistory) return true;
  if (ui.focusInStartEdit || ui.focusInChangeEdit) return true;
  if (ui.setupVisible && ui.focusInSetup) return true;
  return false;
}
