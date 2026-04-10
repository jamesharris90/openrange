#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const JOB_DIR = path.join(__dirname, '..', 'logs', 'backtests', 'jobs');
const STATUS_FILE = path.join(JOB_DIR, 'phase2-backfill-status.json');
const STDOUT_FILE = path.join(JOB_DIR, 'phase2-backfill.stdout.log');

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function writeJsonFile(filePath, payload) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function main() {
  ensureDirectory(JOB_DIR);

  const existingStatus = readJsonFile(STATUS_FILE);
  if (existingStatus && existingStatus.pid && isProcessAlive(Number(existingStatus.pid)) && existingStatus.status === 'running') {
    console.log(JSON.stringify({
      launched: false,
      reason: 'already_running',
      pid: existingStatus.pid,
      statusFile: STATUS_FILE,
      stdoutFile: STDOUT_FILE,
    }, null, 2));
    return;
  }

  const passthroughArgs = process.argv.slice(2);
  const childArgs = [
    '--expose-gc',
    path.join(__dirname, 'runBackfill.js'),
    ...passthroughArgs,
    `--status-file=${STATUS_FILE}`,
  ];

  const stdoutFd = fs.openSync(STDOUT_FILE, 'a');
  const child = spawn(process.execPath, childArgs, {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    detached: true,
    stdio: ['ignore', stdoutFd, stdoutFd],
  });

  child.unref();
  fs.closeSync(stdoutFd);

  writeJsonFile(STATUS_FILE, {
    job: 'phase2-backfill',
    status: 'running',
    pid: child.pid,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    command: [process.execPath, ...childArgs].join(' '),
    cwd: path.join(__dirname, '..'),
    stdoutFile: STDOUT_FILE,
  });

  console.log(JSON.stringify({
    launched: true,
    pid: child.pid,
    statusFile: STATUS_FILE,
    stdoutFile: STDOUT_FILE,
  }, null, 2));
}

main();