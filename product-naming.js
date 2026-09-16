const PRODUCT_WORDS = /\b(led|light|box|sign|custom|usb|powered|remote|decor|decoration)\b/gi;

const PHRASE_FIXES = [
  [/\bBWM\b/gi, 'BMW'],
  [/\bBow Tie\b/gi, 'Bowtie'],
  [/\bGuy Fawkes\b/gi, 'Guy Fawkes'],
  [/\bBilly Clown Saw\b/gi, 'Billy Clown Saw'],
  [/\bSpiderman\b/gi, 'Spider-Man'],
  [/\bThefast And The Furious\b/gi, 'The Fast and the Furious'],
  [/\bThefast\b/gi, 'The Fast'],
  [/\bKnomes\b/gi, 'Gnomes'],
  [/\bKerby\b/gi, 'Kirby'],
  [/\bMidwest Wheels Of Soul\b/gi, 'Midwest Wheels of Soul'],
  [/\bMopar\b/gi, 'Mopar'],
  [/\bPacky Packer\b/gi, 'Packy Packer'],
  [/\bCity Chevy\b/gi, 'City Chevrolet'],
  [/\bBadgers Wisconsin Helmet\b/gi, 'Wisconsin Badgers Helmet'],
  [/\bChevy Bowtie Bigger Red\b/gi, 'Red Chevy Bowtie'],
  [/\bChevy Bowtie Bigger\b/gi, 'Chevy Bowtie'],
  [/\bHarley Colored\b/gi, 'Harley-Davidson Color'],
  [/\bHarley Black and White\b/gi, 'Black and White Harley-Davidson'],
  [/\bGm Retro\b/gi, 'GM Retro'],
  [/\bGmc\b/gi, 'GMC'],
  [/\bJvc\b/gi, 'JVC'],
  [/\bF1\b/gi, 'F1'],
  [/\bRt\b/g, 'RT'],
  [/\bAo\b/g, 'AO'],
];

const ACRONYMS = new Set([
  'AMC', 'AMS', 'AO', 'BMW', 'CB', 'ELI', 'F1', 'GM', 'GMC', 'JVC', 'KBL', 'MLB',
  'NBA', 'NCAA', 'NFL', 'NHL', 'RAD', 'RT', 'TPU', 'USB', 'WFFW'
]);

const SMALL_WORDS = new Set(['and', 'of', 'the', 'vs', 'with']);

function splitFileName(value) {
  return String(value || '')
    .replace(/\.[^.]+$/, '')
    .replace(/\(\s*\d+\s*\)/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value) {
  return value.split(/\s+/).map((word, index) => {
    const clean = word.replace(/[^A-Za-z0-9]/g, '');
    const upper = clean.toUpperCase();
    if (ACRONYMS.has(upper)) return word.replace(clean, upper);
    if (index > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

function applyPhraseFixes(value) {
  return PHRASE_FIXES.reduce((result, [pattern, replacement]) => {
    return result.replace(pattern, replacement);
  }, value);
}

function cleanBaseName(rawName) {
  let name = splitFileName(rawName);
  name = name.replace(PRODUCT_WORDS, ' ');
  name = name.replace(/\blg\b/gi, 'Large');
  name = name.replace(/\bsm\b/gi, 'Small');
  name = name.replace(/\s+/g, ' ').trim();
  name = titleCase(name);
  name = applyPhraseFixes(name);
  return name.replace(/\s+/g, ' ').trim();
}

function categorySuffix(baseName, category) {
  const cat = String(category || '').toLowerCase().replace(/\s+/g, '');
  const lower = baseName.toLowerCase();

  if (lower.includes('helmet')) return 'LED Helmet Sign';
  if (cat === 'christmas') return lower.includes('christmas') ? 'LED Light Box Decor' : 'Christmas LED Light Box Decor';
  if (cat === 'halloween') return lower.includes('halloween') ? 'LED Light Box Decor' : 'Halloween LED Light Box Decor';
  if (cat === 'sports') return 'Fan LED Light Box Sign';
  if (cat === 'automotive') return 'Garage LED Light Box Sign';
  if (cat === 'bands') return 'Music LED Light Box Sign';
  if (cat === 'fishing') return 'Fishing LED Light Box Sign';
  if (cat === 'customrequests') return 'Custom LED Light Box Sign';
  if (cat === 'anime' || cat === 'popculture') return 'LED Light Box Sign';
  return 'LED Light Box Sign';
}

function createDisplayName(rawName, category) {
  const baseName = cleanBaseName(rawName);
  const suffix = categorySuffix(baseName, category);
  return `${baseName} ${suffix}`.replace(/\s+/g, ' ').trim();
}

function nameLooksLikeFile(value) {
  return /[_]/.test(value)
    || /[a-z][A-Z]/.test(value)
    || /\(\d+\)/.test(value)
    || /\b(lg|sm)\b/i.test(value)
    || !/\s/.test(value);
}

function auditDisplayName(rawName, displayName) {
  const issues = [];
  if (nameLooksLikeFile(rawName)) issues.push('source-name-looks-file-like');
  if (nameLooksLikeFile(displayName)) issues.push('display-name-looks-file-like');
  if (displayName.length > 95) issues.push('display-name-long');
  if (displayName.length < 18) issues.push('display-name-short');
  if (/  +/.test(displayName)) issues.push('extra-spaces');
  return issues;
}

function getDisplayName(item, category) {
  return item.displayName || createDisplayName(item.name, category);
}

module.exports = {
  auditDisplayName,
  cleanBaseName,
  createDisplayName,
  getDisplayName,
};
