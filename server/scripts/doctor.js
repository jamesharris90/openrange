const { execSync } = require("child_process");
const fs = require("fs");
require("dotenv").config();

console.log("\n🔎 OpenRange Doctor\n");

const required = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "JWT_SECRET"
];

let missing = [];

required.forEach((key) => {
  if (!process.env[key]) missing.push(key);
});

if (missing.length) {
  console.log("❌ Missing env vars:", missing.join(", "));
} else {
  console.log("✅ Environment variables OK");
}

console.log("\n🔧 Checking node modules...");

try {
  execSync("npm install", { stdio: "inherit" });
  console.log("✅ Node modules installed");
} catch (e) {
  console.log("❌ npm install failed");
}

console.log("\n🔧 Checking MCP module...");

try {
  require("@modelcontextprotocol/sdk");
  console.log("✅ MCP module installed");
} catch {
  console.log("Installing MCP SDK...");
  execSync("npm install @modelcontextprotocol/sdk", { stdio: "inherit" });
}

console.log("\n🔧 Testing database connection...");

const pool = require("../db/pool");

async function testDB() {
  try {
    await pool.query("SELECT NOW() AS now");
    console.log("✅ Database connection successful");
  } catch (err) {
    console.log("❌ Database connection failed");
    console.log(err.message);
  } finally {
    await pool.end().catch(() => {});
  }
}

testDB().then(() => {
  console.log("\n🚀 Doctor finished\n");
});
