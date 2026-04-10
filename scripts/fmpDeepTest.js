require("dotenv").config();
const fetch = require("node-fetch");

const key = process.env.FMP_API_KEY;

const endpoints = [
  `https://financialmodelingprep.com/api/v3/quote/AAPL?apikey=${key}`,
  `https://financialmodelingprep.com/api/v3/actives?apikey=${key}`,
  `https://financialmodelingprep.com/api/v3/gainers?apikey=${key}`,
  `https://financialmodelingprep.com/api/v3/losers?apikey=${key}`
];

(async () => {
  console.log("TESTING FMP (v3 fallback endpoints)...\n");

  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      const data = await res.json();

      console.log("URL:", url);
      console.log("STATUS:", res.status);

      if (!data || data.length === 0) {
        console.log("EMPTY\n");
      } else {
        console.log("DATA:", data.slice(0, 2), "\n");
      }

    } catch (err) {
      console.error("ERROR:", err.message);
    }
  }
})();
