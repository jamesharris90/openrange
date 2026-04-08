#!/usr/bin/env node

const { spawn } = require('child_process');

process.env.PORT = '3000';
console.log('✅ FRONTEND RUNNING ON PORT 3000');

const child = spawn('next', ['dev', '-p', '3000'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('❌ FAILED TO START PRIMARY FRONTEND', error.message);
  process.exit(1);
});
