"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  console.error("Route Error:", error);

  return (
    <div style={{ padding: 40 }}>
      <h2>Something went wrong</h2>
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
        Try again
      </button>
    </div>
  );
}
