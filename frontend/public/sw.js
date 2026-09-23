// SKYNET's service worker — deliberately minimal. This is an authenticated,
// dynamic dashboard, so there's no offline caching strategy here (caching
// responses risks serving stale or private data to the wrong session).
// The only job here is Web Push, which requires a registered service
// worker with no way around it.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "SKYNET", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "SKYNET";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/dashboard" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      return clients.openWindow(url);
    }),
  );
});
