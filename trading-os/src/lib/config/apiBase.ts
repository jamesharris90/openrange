const API_BASE =
  process.env.BACKEND_API_BASE ||
  process.env.SERVER_API_BASE ||
  process.env.API_BASE ||
  "http://localhost:3001";

if (!API_BASE) {
  console.error("❌ API BASE NOT CONFIGURED");
}

console.log("API BASE:", API_BASE);

export { API_BASE };
export default API_BASE;
