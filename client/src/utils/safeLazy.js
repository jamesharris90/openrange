import React from "react";

function isChunkLoadError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("loading chunk") ||
    message.includes("chunkloaderror")
  );
}

export default function safeLazy(importFn) {
	return React.lazy(() =>
		importFn().catch((err) => {
			if (typeof window !== "undefined" && isChunkLoadError(err)) {
				const alreadyReloaded = window.__chunk_reload_attempted === true;
				if (!alreadyReloaded) {
					window.__chunk_reload_attempted = true;
					window.location.reload();
					return new Promise(() => {});
				}
			}

			console.error("Lazy import failed:", err);
			return {
				default: () => React.createElement("div", null, "Component failed to load."),
			};
		})
	);
}
