"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  console.error("Global Error:", error);

  return (
    <html>
      <body>
        <div style={{ padding: 60 }}>
          <h1>Application Error</h1>
          <p>{error.message}</p>

          <button
            onClick={() => reset()}
            style={{
              marginTop: 20,
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid #444",
            }}
          >
            Reload App
          </button>
        </div>
      </body>
    </html>
  );
}
