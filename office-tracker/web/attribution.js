export function attributionForChange(account, comment) {
  const name = String(account?.name ?? '').trim();
  const id = String(account?.id ?? '').trim();
  return {
    note: String(comment ?? '').trim(),
    entered_by: name,
    entered_by_user_id: id || null,
  };
}
