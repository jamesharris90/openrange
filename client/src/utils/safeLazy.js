import React from "react";

export default function safeLazy(importFn) {
  return React.lazy(() =>
    importFn()
      .catch(() => importFn())
      .catch((err) => {
        console.error("Lazy import failed:", err);
        return {
          default: () => React.createElement("div", { className: "p-4 text-sm text-rose-200" }, "Component failed to load."),
        };
      })
  );
}
