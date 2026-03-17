const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  process.env.OPENRANGE_API_BASE ||
  process.env.BACKEND_API_BASE ||
  process.env.SERVER_API_BASE;

if (!API_BASE) {
  throw new Error("Backend API base not configured");
}

export { API_BASE };
