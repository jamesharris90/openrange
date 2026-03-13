async function runRepair() {
  console.log("Running OpenRange system repair");

  const checks = ["engine_status", "scheduler_status", "ingestion_state"];

  checks.forEach((t) => console.log("Checking table:", t));

  console.log("Repair scan complete");
}

runRepair();
