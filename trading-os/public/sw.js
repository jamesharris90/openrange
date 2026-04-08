self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.registration.unregister();
      } catch {
        // Ignore unregister failures.
      }

      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch {
        // Ignore cache cleanup failures.
      }

      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      await Promise.all(
        clients.map((client) => {
          if ("navigate" in client) {
            return client.navigate(client.url);
          }
          return Promise.resolve(undefined);
        })
      );
    })()
  );
});

self.addEventListener("fetch", () => {
  // Intentionally empty. This file exists only to evict the legacy client service worker.
});