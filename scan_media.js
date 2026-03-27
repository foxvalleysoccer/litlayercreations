const fs = require('fs');
const path = require('path');

const BASE = __dirname;
const catalog = JSON.parse(fs.readFileSync(path.join(BASE, 'catalog.json'), 'utf8'));

let missing = [];
let found = 0;
let noMedia = [];

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
        found++;
      }
    }
  }
}

const result = { found, missing, noMedia };
fs.writeFileSync(path.join(BASE, 'scan_results.json'), JSON.stringify(result, null, 2));
console.log('FOUND:' + found + ' MISSING:' + missing.length + ' NOMEDIA:' + noMedia.length);
