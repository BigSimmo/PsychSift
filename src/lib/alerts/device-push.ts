/**
 * Removes THIS device's phone-alert subscription: from the browser first (so
 * nothing more can reach this device, even offline), then from the account
 * (so the server stops sending; a row left behind by a failed request is
 * dropped the next time a send is refused). Used by the Alerts page's "off" and by sign-out, so a signed-out
 * device, a shared ward computer above all, gets nothing more. Never throws:
 * sign-out must finish whatever happens here. Resolves true only when this
 * browser is known to hold no subscription any more, so a caller never shows
 * "Off" for a removal that did not happen.
 */
export async function removeThisDevicePushSubscription(timeoutMs = 3000): Promise<boolean> {
  // Poor ward wifi must never hold a sign-out open: give up after a few seconds.
  // Set the moment the browser half succeeds, so a slow server half cannot hide it.
  const progress = { removedHere: false };
  await Promise.race([removeSubscription(progress), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  return progress.removedHere;
}

/** Marks `removedHere` once this browser holds no subscription; the server half is best effort. */
async function removeSubscription(progress: { removedHere: boolean }): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      progress.removedHere = true;
      return;
    }
    const registration =
      typeof navigator.serviceWorker.getRegistration === "function"
        ? await navigator.serviceWorker.getRegistration()
        : await navigator.serviceWorker.ready;
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) {
      progress.removedHere = true;
      return;
    }
    const { endpoint } = subscription;
    // The browser first: that alone stops anything reaching this device, and it
    // needs no network. Then the account, so the server stops trying.
    if (!(await subscription.unsubscribe().catch(() => false))) return;
    progress.removedHere = true;
    await fetch("/api/roster/alerts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
      cache: "no-store",
    }).catch(() => undefined);
  } catch {
    // Nothing here may stop a sign-out.
  }
}
