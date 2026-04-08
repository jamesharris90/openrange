"use client";

import { useEffect } from "react";

const CLEANUP_FLAG = "openrange-legacy-sw-cleanup-v1";

async function cleanupLegacyCaches() {
  let changed = false;

  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      const unregistered = await registration.unregister();
      changed = changed || unregistered;
    }
  }

  if ("caches" in window) {
    const keys = await window.caches.keys();
    if (keys.length > 0) {
      await Promise.all(keys.map((key) => window.caches.delete(key)));
      changed = true;
    }
  }

  return changed;
}

export function LegacyServiceWorkerCleanup() {
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const changed = await cleanupLegacyCaches();
        if (cancelled) return;

        if (changed && window.sessionStorage.getItem(CLEANUP_FLAG) !== "done") {
          window.sessionStorage.setItem(CLEANUP_FLAG, "done");
          window.location.reload();
          return;
        }

        window.sessionStorage.setItem(CLEANUP_FLAG, "done");
      } catch {
        // Ignore cleanup failures and allow the app to continue rendering.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}