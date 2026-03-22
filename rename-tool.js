/**
 * rename-tool.js
 *
 * STEP 1 - Generate proposed renames:
 *   node rename-tool.js
 *   → creates rename-plan.json, review and edit it
 *
 * STEP 2 - Apply renames:
 *   node rename-tool.js --apply
 *   → renames .3mf files, media folders, updates catalog.json
 *   → also creates missing media folders for every item
 */

const fs   = require('fs');
const path = require('path');

const ROOT         = __dirname;
const CATALOG_PATH = path.join(ROOT, 'catalog.json');
const PLAN_PATH    = path.join(ROOT, 'rename-plan.json');

// ── Auto-clean a raw name into a readable title ────────────────────────────
function autoClean(name) {
  let s = name;
  // Replace underscores / hyphens with spaces
  s = s.replace(/[_\-]+/g, ' ');
  // Split camelCase / PascalCase  (e.g. "AmericanMotors" → "American Motors")
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
  // Handle runs of caps followed by a cap+lower (e.g. "BWMStripes" → "BWM Stripes")
  s = s.replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2');
  // ── Strip size/dimension noise ──────────────────────────────────────────
  // Remove "30mm thick", "40mm Thick", "40mmbase", "225 Width" etc.
  s = s.replace(/\b\d+\s*mm\s*(thick|thin|wide|width|tall|base|wbase)?\b/gi, '');
  // Remove trailing standalone numbers that are clearly sizes (e.g. "grinch 194", "santa 210")
  // but only when preceded by letters — keeps a bare "67" intact
  s = s.replace(/(?<=[a-zA-Z])\s+\d+(\s+\d+)*\s*$/g, '');
  // Remove inline size qualifiers like "170Tall", "225Tall"
  s = s.replace(/\b\d+(Tall|Wide|Base|WBase|mm)\b/gi, '');
  // ────────────────────────────────────────────────────────────────────────
  // Collapse multiple spaces
  s = s.replace(/\s+/g, ' ').trim();
  // Title-case every word
  s = s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return s;
}

// ── Load catalog ───────────────────────────────────────────────────────────
function loadCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

// ── STEP 1: Generate rename-plan.json ─────────────────────────────────────
function generatePlan() {
  const catalog = loadCatalog();
  const plan = [];

  for (const group of catalog) {
    for (const item of group.items) {
      const oldName  = item.name;
      const proposed = autoClean(oldName);
      plan.push({
        category : group.category,
        oldName,
        newName  : proposed   // <-- edit this column to whatever you want
      });
    }
  }

  fs.writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));
  console.log(`\n✅ Generated rename-plan.json with ${plan.length} items.`);
  console.log('   Review and edit "newName" for each entry.');
  console.log('   When ready, run:  node rename-tool.js --apply\n');
}

// ── STEP 2: Apply renames ──────────────────────────────────────────────────
function applyPlan() {
  if (!fs.existsSync(PLAN_PATH)) {
    console.error('rename-plan.json not found — run without --apply first.');
    process.exit(1);
  }

  const plan    = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));
  const catalog = loadCatalog();

  let renamed = 0;
  let skipped = 0;
  let created = 0;
  let errors  = 0;

  // ── Pass 1: renames ──────────────────────────────────────────────────────
  for (const entry of plan) {
    const { category, oldName, newName } = entry;

    if (!newName || newName.trim() === '') {
      console.warn(`  ⚠  Skipping empty newName for "${oldName}"`);
      skipped++;
      continue;
    }

    if (oldName === newName) {
      skipped++;
      continue;
    }

    // Find the item in catalog
    const group = catalog.find(g => g.category === category);
    if (!group) { console.warn(`  ⚠  Category not found: ${category}`); errors++; continue; }
    const item = group.items.find(i => i.name === oldName);
    if (!item)  { console.warn(`  ⚠  Item not found: "${oldName}" in ${category}`); errors++; continue; }

    const catDir        = path.join(ROOT, category);
    const oldBasename   = path.basename(item.file, '.3mf');   // e.g. "AmericanMotors"
    const oldFilePath   = path.join(ROOT, item.file);
    const newFilePath   = path.join(catDir, newName + '.3mf');
    const oldMediaDir   = path.join(catDir, 'media', oldBasename);
    const newMediaDir   = path.join(catDir, 'media', newName);

    // Rename .3mf file
    if (fs.existsSync(oldFilePath)) {
      try {
        fs.renameSync(oldFilePath, newFilePath);
        console.log(`  📄 Renamed file:  ${oldBasename}.3mf  →  ${newName}.3mf`);
        renamed++;
      } catch (e) {
        console.error(`  ❌ Could not rename file: ${e.message}`);
        errors++;
        continue;
      }
    } else {
      console.warn(`  ⚠  .3mf not found on disk: ${item.file} (catalog will still update)`);
    }

    // Rename media folder (if it exists under old name)
    if (fs.existsSync(oldMediaDir)) {
      try {
        fs.renameSync(oldMediaDir, newMediaDir);
        console.log(`  📁 Renamed media: ${oldBasename}/  →  ${newName}/`);
      } catch (e) {
        console.error(`  ❌ Could not rename media folder: ${e.message}`);
      }
    }

    // Update catalog entry
    item.name = newName;
    item.file = `${category}/${newName}.3mf`;
    item.media = item.media.map(m =>
      m.replace(
        `${category}/media/${oldBasename}/`,
        `${category}/media/${newName}/`
      )
    );
  }

  // ── Pass 2: create missing media folders for ALL items ──────────────────
  console.log('\n  Checking for missing media folders…');
  for (const group of catalog) {
    for (const item of group.items) {
      const basename  = path.basename(item.file, '.3mf');
      const mediaDir  = path.join(ROOT, group.category, 'media', basename);
      if (!fs.existsSync(mediaDir)) {
        try {
          fs.mkdirSync(mediaDir, { recursive: true });
          console.log(`  ➕ Created: ${group.category}/media/${basename}/`);
          created++;
        } catch (e) {
          console.error(`  ❌ Could not create folder: ${e.message}`);
        }
      }
    }
  }

  // ── Save updated catalog ─────────────────────────────────────────────────
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));

  console.log(`
✅ Done!
   Renamed : ${renamed} items
   Skipped : ${skipped} (no change needed)
   Created : ${created} new media folders
   Errors  : ${errors}

catalog.json has been updated.
`);
}

// ── Entry point ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--apply')) {
  applyPlan();
} else {
  generatePlan();
}
