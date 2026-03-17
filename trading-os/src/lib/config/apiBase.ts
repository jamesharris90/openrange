const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.API_BASE ||
  "http://localhost:3000";

if (!API_BASE) {
  console.error("❌ API BASE NOT CONFIGURED");
}

console.log("🌐 API BASE:", API_BASE);

export { API_BASE };
export default API_BASE;
