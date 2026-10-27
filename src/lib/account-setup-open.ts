/**
 * Set on <html> while the sign-in window (AccountSetupDialog) is open, so the
 * install notice can step aside instead of covering the Sign in button on a phone.
 * Kept in its own module so the dialog does not pull in the PWA lifecycle code.
 */
export const ACCOUNT_SETUP_OPEN_ATTRIBUTE = "data-account-setup-open";
