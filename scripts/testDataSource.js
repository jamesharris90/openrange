require("dotenv").config();
require("dotenv").config({ path: require("path").resolve(__dirname, "../server/.env") });
const fetchImpl = global.fetch
  ? global.fetch.bind(global)
  : (...args) => import("node-fetch").then((m) => m.default(...args));

(async () => {
  const url = `https://financialmodelingprep.com/stable/quote?symbol=AAPL,TSLA,SPY&apikey=${process.env.FMP_API_KEY}`;

  const res = await fetchImpl(url);
  const data = await res.json();

  console.log("DATA SOURCE RESPONSE:");
  console.log(data);
})();
