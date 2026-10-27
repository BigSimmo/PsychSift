/**
 * The email address the sign-in form fills in for you, kept in this browser only.
 *
 * Only the address is kept, and only while "Remember my email on this device" is
 * ticked; unticking it removes the address at once. Passwords are never written
 * here: the browser's own password manager is the place for those. Nothing in this
 * key reaches PsychSift's servers.
 */

export const REMEMBERED_EMAIL_KEY = "psychsift:remembered-email";

/** Generous ceiling well above any real address; anything longer is not ours. */
const MAX_EMAIL_LENGTH = 320;

function looksLikeEmail(value: string) {
  return value.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+$/.test(value);
}

export function readRememberedEmail(): string | null {
  try {
    const value = window.localStorage.getItem(REMEMBERED_EMAIL_KEY)?.trim();
    return value && looksLikeEmail(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberEmail(email: string) {
  const value = email.trim();
  if (!looksLikeEmail(value)) return;
  try {
    window.localStorage.setItem(REMEMBERED_EMAIL_KEY, value);
  } catch {
    // Private mode or blocked storage: the form simply starts empty next time.
  }
}

export function forgetRememberedEmail() {
  try {
    window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
  } catch {
    // Nothing stored, nothing to remove.
  }
}
