const fs = require('fs');
const path = require('path');

const BASE = __dirname;
const catalog = JSON.parse(fs.readFileSync(path.join(BASE, 'catalog.json'), 'utf8'));

let missing = [];
let caseMismatches = [];
let found = 0;
let noMedia = [];

function findCaseMismatch(relativePath) {
  let currentPath = BASE;

  for (const segment of relativePath.replace(/\\/g, '/').split('/')) {
    const entries = fs.readdirSync(currentPath);
    if (!entries.includes(segment)) {
      const actualName = entries.find(entry => entry.toLowerCase() === segment.toLowerCase());
      return actualName ? { expected: segment, actual: actualName } : null;
    }
    currentPath = path.join(currentPath, segment);
  }

  return null;
}

for (const cat of catalog) {
  for (const item of cat.items) {
    if (!item.media || item.media.length === 0) {
      noMedia.push({ category: cat.category, name: item.name });
      continue;
    }
    for (const mediaPath of item.media) {
      const fullPath = path.join(BASE, mediaPath);
      if (!fs.existsSync(fullPath)) {
        missing.push({ category: cat.category, item: item.name, path: mediaPath });
      } else {
        const mismatch = findCaseMismatch(mediaPath);
        if (mismatch) {
          caseMismatches.push({ category: cat.category, item: item.name, path: mediaPath, ...mismatch });
        }
        found++;
      }
    }
  }
}

const result = { found, missing, caseMismatches, noMedia };
fs.writeFileSync(path.join(BASE, 'scan_results.json'), JSON.stringify(result, null, 2));
console.log('FOUND:' + found + ' MISSING:' + missing.length + ' CASE_MISMATCHES:' + caseMismatches.length + ' NOMEDIA:' + noMedia.length);
if (missing.length || caseMismatches.length) process.exitCode = 1;
