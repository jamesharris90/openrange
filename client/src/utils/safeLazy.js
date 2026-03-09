import React from "react";

export default function safeLazy(importFn) {
	return React.lazy(() =>
		importFn().catch((err) => {
			console.error("Lazy import failed:", err);
			return {
				default: () => React.createElement("div", null, "Component failed to load."),
			};
		})
	);
}
