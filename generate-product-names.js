const fs = require('fs');
const path = require('path');
const { auditDisplayName, createDisplayName } = require('./product-naming');

const catalogPath = path.join(__dirname, 'catalog.json');
const reportPath = path.join(__dirname, 'product-name-audit.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

const seen = new Map();
const duplicateCounts = new Map();
const report = [];
let updated = 0;

for (const category of catalog) {
  for (const item of category.items || []) {
    const current = item.displayName;
    let displayName = createDisplayName(item.name, category.category);
    const duplicateKey = displayName.toLowerCase();
    const existing = seen.get(duplicateKey);

    if (existing) {
      const count = (duplicateCounts.get(duplicateKey) || 1) + 1;
      duplicateCounts.set(duplicateKey, count);
      displayName = `${displayName} Variant ${count}`;
    } else {
      duplicateCounts.set(duplicateKey, 1);
    }

    seen.set(displayName.toLowerCase(), `${category.category}/${item.name}`);

    if (current !== displayName) {
      item.displayName = displayName;
      updated++;
    }

    report.push({
      category: category.category,
      sourceName: item.name,
      file: item.file,
      displayName,
      issues: auditDisplayName(item.name, displayName),
      duplicateOf: existing || null,
    });
  }
}

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

const issueCount = report.filter(row => row.issues.length || row.duplicateOf).length;
console.log(`Updated ${updated} catalog display names.`);
console.log(`Wrote ${report.length} audit rows to ${path.basename(reportPath)}.`);
console.log(`${issueCount} rows need a closer look.`);
