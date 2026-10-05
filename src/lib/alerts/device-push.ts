/**
 * Removes THIS device's phone-alert subscription: from the browser first (so
 * nothing more can reach this device, even offline), then from the account
 * (so the server stops sending; a row left behind by a failed request is
 * dropped the next time a send is refused). Used by the Alerts page's "off" and by sign-out, so a signed-out
 * device, a shared ward computer above all, gets nothing more. Never throws:
 * sign-out must finish whatever happens here.
 */
export async function removeThisDevicePushSubscription(timeoutMs = 3000): Promise<void> {
  // Poor ward wifi must never hold a sign-out open: give up after a few seconds.
  await Promise.race([removeSubscription(), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

async function removeSubscription(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    const { endpoint } = subscription;
    // The browser first: that alone stops anything reaching this device, and it
    // needs no network. Then the account, so the server stops trying.
    await subscription.unsubscribe().catch(() => undefined);
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
