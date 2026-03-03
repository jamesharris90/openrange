const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { createRequire } = require('module');

const tsModuleCache = new Map();

function resolveImportPath(fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.js`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function loadTsModule(filePath) {
  if (tsModuleCache.has(filePath)) {
    return tsModuleCache.get(filePath);
  }

  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;

  const moduleLike = { exports: {} };
  tsModuleCache.set(filePath, moduleLike.exports);

  const nodeRequire = createRequire(filePath);
  const customRequire = (request) => {
    if (request.startsWith('.')) {
      const resolved = resolveImportPath(filePath, request);
      if (resolved && resolved.endsWith('.ts')) {
        return loadTsModule(resolved);
      }
      if (resolved) return nodeRequire(resolved);
    }
    return nodeRequire(request);
  };

  const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', transpiled);
  fn(customRequire, moduleLike, moduleLike.exports, path.dirname(filePath), filePath);
  tsModuleCache.set(filePath, moduleLike.exports);
  return moduleLike.exports;
}

function loadTsNamedExport(filePath, exportName) {
  const loadedModule = loadTsModule(filePath);

  const loaded = loadedModule?.[exportName];
  if (typeof loaded !== 'function') {
    throw new Error(`${exportName} not found in ${filePath}`);
  }

  return loaded;
}

const buildEarningsRouter = loadTsNamedExport(
  path.join(__dirname, '../services/earnings/earningsRoutes.ts'),
  'buildEarningsRouter',
);

module.exports = buildEarningsRouter();
