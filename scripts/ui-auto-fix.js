const fs = require('fs');
const path = require('path');

const SRC = './client/src';

function ensureApiFetchImport(content) {
  if (content.includes("from '../utils/apiFetch'") || content.includes('from "../utils/apiFetch"')) {
    return content;
  }
  if (content.includes("from './utils/apiFetch'") || content.includes('from "./utils/apiFetch"')) {
    return content;
  }

  const importLine = "import { apiFetch } from '../utils/apiFetch';\n";
  if (content.includes("from 'react'")) {
    return content.replace(/import[^\n]*from 'react';\n/, (m) => `${m}${importLine}`);
  }
  return `${importLine}${content}`;
}

function fixFile(file) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  const mapPatched = content.replace(/(?<!\?)(\.map\()/g, '?.map(');
  if (mapPatched !== content) {
    content = mapPatched;
    changed = true;
  }

  const dataPatched = content.replace(/\bdata\.(\w+)/g, 'data?.$1');
  if (dataPatched !== content) {
    content = dataPatched;
    changed = true;
  }

  const fetchPatched = content
    .replace(/fetch\(\s*"\/api\//g, 'apiFetch("/api/')
    .replace(/fetch\(\s*'\/api\//g, "apiFetch('/api/");

  if (fetchPatched !== content) {
    content = ensureApiFetchImport(fetchPatched);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, content);
  }
}

function walk(dir) {
  fs.readdirSync(dir).forEach((file) => {
    const full = path.join(dir, file);

    if (fs.statSync(full).isDirectory()) {
      walk(full);
    } else if (file.endsWith('.jsx') || file.endsWith('.tsx')) {
      fixFile(full);
    }
  });
}

walk(SRC);

console.log('UI auto fixes applied');
