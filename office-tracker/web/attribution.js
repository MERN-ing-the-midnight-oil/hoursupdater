/**
 * Who saved a clock-time change, taken from the signed-in account.
 * The comment is optional and is not used as a signature.
 * @param {{ id?: string, name?: string } | null | undefined} account
 * @param {unknown} comment
 */
export function attributionForChange(account, comment) {
  const name = String(account?.name ?? '').trim();
  const id = String(account?.id ?? '').trim();
  return {
    note: String(comment ?? '').trim(),
    entered_by: name,
    entered_by_user_id: id || null,
  };
}
