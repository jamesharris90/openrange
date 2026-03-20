const BACKEND = process.env.BACKEND_URL || 'https://openrange-backend-production.up.railway.app';

async function run() {
  console.log('========================');
  console.log('SYSTEM CHECK START');
  console.log('Backend:', BACKEND);

  try {
    const res = await fetch(`${BACKEND}/api/health`);
    const data = await res.json();

    console.log('STATUS:', data.status);
    console.log('ENV:', data.env);
    console.log('ALLOWED ORIGINS:', data.allowedOrigins);
  } catch (err) {
    console.error('FAILED TO CONNECT TO BACKEND');
    console.error(err.message);
    process.exitCode = 1;
  }

  console.log('========================');
}

run();
