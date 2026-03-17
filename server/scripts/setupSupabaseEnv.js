const fs = require("fs");
const path = require("path");
const readline = require("readline");

const envPath = path.join(__dirname, "..", ".env");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log("\nOpenRange Supabase Setup\n");

rl.question("Paste your SUPABASE_SERVICE_ROLE_KEY: ", (serviceKey) => {

  const envContent = `
SUPABASE_URL=https://qyfxbuxuxyvdmwamzdtq.supabase.co
SUPABASE_SERVICE_ROLE_KEY=${serviceKey.trim()}
`;

  fs.writeFileSync(envPath, envContent);

  console.log("\n.env file created successfully.\n");
  console.log("Restart the backend with:\n");
  console.log("npm run dev\n");

  rl.close();
});
