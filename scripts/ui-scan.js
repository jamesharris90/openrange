const fs = require('fs');
const path = require('path');

const SRC = './client/src';
const issues = [];

function scanFile(file) {
  const content = fs.readFileSync(file, 'utf8');

  if (content.includes('useEffect(') && !content.includes('[]')) {
    issues.push({ file, issue: 'useEffect missing dependency array' });
  }

  if (content.includes('fetch(') && !content.includes('try')) {
    issues.push({ file, issue: 'fetch without try/catch' });
  }

  if (content.includes('.map(') && !content.includes('?.map')) {
    issues.push({ file, issue: 'map without null guard' });
  }

  if (content.includes('data.') && !content.includes('data?.')) {
    issues.push({ file, issue: 'unsafe data access' });
  }
}

function walk(dir) {
  fs.readdirSync(dir).forEach((file) => {
    const full = path.join(dir, file);

    if (fs.statSync(full).isDirectory()) {
      walk(full);
    } else if (file.endsWith('.jsx') || file.endsWith('.tsx')) {
      scanFile(full);
    }
  });
}

walk(SRC);

fs.writeFileSync('ui-health-report.json', JSON.stringify(issues, null, 2));

console.log('UI scan complete');
console.log('Issues found:', issues.length);
