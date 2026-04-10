#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'logs', 'build_validation_report.json');

const ALLOWED_LOCALHOST_PORTS = new Set(['3000', '3007']);
const FORBIDDEN_EXPLICIT = ['localhost:3001', 'localhost:3016'];

const SCAN_EXTENSIONS = new Set(['.js', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.env']);
const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.tmp',
  'node_modules',
  'logs',
  'coverage',
  'dist',
  'build',
  'tmp',
  'memories',
  'docs',
  'reports',
  'tests',
  'scripts',
  'playwright-report',
  'test-results',
]);
const SKIP_FILE_SUFFIXES = ['.md', '.csv', '.txt', '.bak', '.png', '.jpg', '.jpeg', '.webp', '.gif'];

function shouldScanFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (SCAN_EXTENSIONS.has(ext)) return true;
  return path.basename(filePath).toLowerCase() === '.env.local';
}

function shouldSkipFile(filePath) {
  const lower = filePath.toLowerCase();
  return SKIP_FILE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function walk(dirPath, results) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(absolutePath, results);
      continue;
    }

    if (!entry.isFile()) continue;
    if (shouldSkipFile(absolutePath)) continue;
    if (!shouldScanFile(absolutePath)) continue;

    results.push(absolutePath);
  }
}

function findViolations(content, relativePath) {
  const violations = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNumber = i + 1;

    for (const forbidden of FORBIDDEN_EXPLICIT) {
      if (line.includes(forbidden)) {
        violations.push({
          file: relativePath,
          line: lineNumber,
          type: 'forbidden_explicit',
          value: forbidden,
        });
      }
    }

    const matches = line.matchAll(/localhost:(\d{2,5})/g);
    for (const match of matches) {
      const port = match[1];
      if (!ALLOWED_LOCALHOST_PORTS.has(port)) {
        violations.push({
          file: relativePath,
          line: lineNumber,
          type: 'forbidden_port',
          value: `localhost:${port}`,
        });
      }
    }
  }

  return violations;
}

function main() {
  const scanRoots = [
    path.join(ROOT, 'server'),
    path.join(ROOT, 'trading-os', 'src'),
  ];

  const files = [];
  for (const scanRoot of scanRoots) {
    if (fs.existsSync(scanRoot)) {
      walk(scanRoot, files);
    }
  }

  const explicitFiles = [
    path.join(ROOT, 'trading-os', '.env.local'),
    path.join(ROOT, 'server', 'index.js'),
    path.join(ROOT, 'trading-os', 'src', 'lib', 'apiBase.ts'),
    path.join(ROOT, 'trading-os', 'src', 'components', 'app-shell.tsx'),
  ];

  for (const filePath of explicitFiles) {
    if (fs.existsSync(filePath)) {
      files.push(filePath);
    }
  }

  const dedupedFiles = [...new Set(files)];

  const violations = [];
  for (const filePath of dedupedFiles) {
    const relativePath = path.relative(ROOT, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath, 'utf8');
    violations.push(...findViolations(content, relativePath));
  }

  const requiredChecks = [
    {
      name: 'server_lock_port_constant',
      pass: fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8').includes('const PORT = 3007;'),
    },
    {
      name: 'frontend_api_base_lock',
      pass: fs.readFileSync(path.join(ROOT, 'trading-os', 'src', 'lib', 'apiBase.ts'), 'utf8').includes('http://localhost:3007'),
    },
    {
      name: 'frontend_startup_health_check',
      pass: fs.readFileSync(path.join(ROOT, 'trading-os', 'src', 'components', 'app-shell.tsx'), 'utf8').includes('http://localhost:3007/api/health'),
    },
  ];

  const requiredFailures = requiredChecks.filter((check) => !check.pass);
  const passed = violations.length === 0 && requiredFailures.length === 0;

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        passed,
        scannedFiles: dedupedFiles.length,
        violations,
        requiredChecks,
      },
      null,
      2
    )
  );

  if (!passed) {
    console.error('BUILD FAILED - FIX REQUIRED');
    if (requiredFailures.length > 0) {
      console.error('Missing required lock checks:', requiredFailures.map((item) => item.name).join(', '));
    }
    if (violations.length > 0) {
      console.error(`Found ${violations.length} forbidden localhost reference(s).`);
      for (const violation of violations.slice(0, 20)) {
        console.error(` - ${violation.file}:${violation.line} -> ${violation.value}`);
      }
      if (violations.length > 20) {
        console.error(` - ... and ${violations.length - 20} more`);
      }
    }
    process.exit(1);
  }

  console.log('BUILD VALIDATED - SAFE TO DEPLOY');
}

main();
