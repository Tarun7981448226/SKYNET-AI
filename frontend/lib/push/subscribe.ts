// Web Push's subscribe() call needs the VAPID public key as a raw
// Uint8Array, not the base64url string it's naturally exchanged as.
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Called from SiriOrb.tsx's orb click — the one real user gesture the
// dashboard has, needed because Notification.requestPermission() won't
// reliably prompt outside a trusted user-gesture context (a voice command
// doesn't count). Silent and best-effort: no visible UI, matches the
// dashboard's "no visible chrome" design (see SiriOrb.tsx's own header
// comment) — a denied/unsupported/already-subscribed case just no-ops.
export async function ensurePushSubscription(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (Notification.permission === "denied") return;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast needed: TS's current DOM lib types applicationServerKey as
        // BufferSource<ArrayBuffer> specifically, stricter than the
        // Uint8Array<ArrayBufferLike> a plain `new Uint8Array(...)`
        // produces — a real runtime Uint8Array satisfies the actual
        // browser API regardless.
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }
    await fetch("/api/dashboard/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
  } catch {
    // Best-effort — a failed subscription attempt just means no push
    // notifications this session, not a broken app.
  }
}
