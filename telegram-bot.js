// telegram-bot.js
// Lit Layer Creations — Telegram Bot
// Root folder: C:\Users\josh\Desktop\Prints\Prints\LightBoxes
//
// Requirements:
//   npm i node-telegram-bot-api axios
//
// Run:
//   $env:TELEGRAM_BOT_TOKEN="YOUR_TOKEN_HERE"
//   node telegram-bot.js
//
// Optional env vars:
//   $env:LIGHTBOX_ROOT="C:\Users\josh\Desktop\Prints\Prints\LightBoxes"
//   $env:OLLAMA_HOST="http://127.0.0.1:11434"
//   $env:OLLAMA_LISTING_MODEL="llama3.1:8b"
//   $env:OLLAMA_VISION_MODEL="bakllava"
//   $env:OLLAMA_CHAT_MODEL="llama3.1:8b"

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN env var.');
  process.exit(1);
}

const ROOT = process.env.LIGHTBOX_ROOT || 'C:\\Users\\josh\\Desktop\\Prints\\Prints\\LightBoxes';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const LISTING_MODEL = process.env.OLLAMA_LISTING_MODEL || 'llama3.1:8b';
const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'bakllava';
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'llama3.1:8b';
const MEMORY_PATH = path.join(ROOT, 'memory.json');

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// ----------------------------
// Memory System
// ----------------------------
const DEFAULT_MEMORY = {
  botName: null,
  botPersonality: null,
  initialized: false,
  user: {
    name: 'Josh',
    location: 'Neenah, Wisconsin',
    business: 'Lit Layer Creations — custom 3D-printed LED light boxes sold on Etsy, Facebook Marketplace, and TikTok Shop.',
    otherProjects: [
      'VR/XR developer at a technical college — builds Unity simulations and Meta Quest training apps',
      'Custom fishing bait designer and YouTube content creator (bigbitecrankbaits.com)',
      '3D printing enthusiast',
    ],
    preferences: 'Direct, practical responses. Honest over positive. Prefers complete answers.',
  },
  recentListings: [],
  notes: [],
};

let memory = { ...DEFAULT_MEMORY };

async function loadMemory() {
  try {
    const raw = await fsp.readFile(MEMORY_PATH, 'utf8');
    memory = { ...DEFAULT_MEMORY, ...JSON.parse(raw) };
    console.log(`Memory loaded. Bot name: ${memory.botName || '(not set yet)'}`);
  } catch {
    memory = { ...DEFAULT_MEMORY };
    console.log('No memory file found — starting fresh.');
  }
}

async function saveMemory() {
  try {
    await fsp.writeFile(MEMORY_PATH, JSON.stringify(memory, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save memory:', err.message);
  }
}

function addRecentListing(productName, category, listing) {
  memory.recentListings.unshift({
    productName,
    category,
    date: new Date().toLocaleDateString(),
    listingPreview: listing.slice(0, 120) + '...',
  });
  if (memory.recentListings.length > 20) memory.recentListings = memory.recentListings.slice(0, 20);
}

// ----------------------------
// Conversation State (per chat)
// ----------------------------
const state = new Map();

function getState(chatId) {
  if (!state.has(chatId)) {
    state.set(chatId, {
      stage: 'idle',
      mode: null,              // 'new' or 'update'
      category: null,
      productName: null,
      updateProductName: null, // for update mode: existing product name
      updateCategory: null,    // for update mode: existing product category
      pendingImages: [],
      firstImageArrived: false,
      chatHistory: [],
    });
  }
  return state.get(chatId);
}

function resetWorkflow(chatId) {
  const s = getState(chatId);
  s.stage = 'idle';
  s.mode = null;
  s.category = null;
  s.productName = null;
  s.updateProductName = null;
  s.updateCategory = null;
  s.pendingImages = [];
  s.firstImageArrived = false;
  // Keep chatHistory so conversation memory persists within session
}

const ALLOWED_CATEGORIES = [
  'Sports',
  'Pop Culture',
  'Halloween',
  'Christmas',
  'Automotive',
  'CustomRequests',
];

function normalizeCategory(input) {
  if (!input) return null;
  const raw = input.trim();
  const direct = ALLOWED_CATEGORIES.find(c => c.toLowerCase() === raw.toLowerCase());
  if (direct) return direct;
  if (raw.toLowerCase().replace(/\s+/g, '') === 'popculture') return 'Pop Culture';
  if (raw.toLowerCase().replace(/\s+/g, '') === 'customrequests') return 'CustomRequests';
  return null;
}

function isValidProductName(name) {
  if (!name) return false;
  if (/\s/.test(name)) return false;
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) return false;
  return true;
}

function safeBasename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

// ----------------------------
// Ollama Helpers
// ----------------------------
async function ollamaChat({ model, messages, options = {} }) {
  const url = `${OLLAMA_HOST}/api/chat`;
  const body = { model, messages, stream: false, options };
  const res = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000,
  });
  if (!res.data || !res.data.message || typeof res.data.message.content !== 'string') {
    throw new Error(`Unexpected Ollama chat response: ${JSON.stringify(res.data).slice(0, 500)}`);
  }
  return res.data.message.content.trim();
}

async function ollamaGenerate({ model, prompt, imagesBase64 = null, options = {} }) {
  const body = { model, prompt, stream: false, options };
  if (imagesBase64 && Array.isArray(imagesBase64) && imagesBase64.length > 0) {
    body.images = imagesBase64;
  }
  const url = `${OLLAMA_HOST}/api/generate`;
  const res = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 0,
  });
  if (!res.data || typeof res.data.response !== 'string') {
    throw new Error(`Unexpected Ollama response: ${JSON.stringify(res.data).slice(0, 500)}`);
  }
  return res.data.response.trim();
}

async function imageToBase64(filePath) {
  const bytes = await fsp.readFile(filePath);
  return Buffer.from(bytes).toString('base64');
}

// ----------------------------
// Bot Initialization — Self-naming
// ----------------------------
async function initializeBot(chatId) {
  await bot.sendMessage(chatId, `Just a moment — setting myself up for the first time...`);

  const initPrompt = `You are an AI assistant being set up for the first time to help Josh with his LED light box business "Lit Layer Creations" and be a general assistant.

Josh is a maker, VR developer, fisherman, and entrepreneur based in Neenah, Wisconsin.

Choose a name for yourself. Pick something that fits a creative, maker-focused assistant — not generic. One word. Then write a short introduction (2-3 sentences) as that character, in first person. Tell Josh your name, your vibe, and that you're ready to help with listings and whatever else he needs.

Format your response as:
NAME: [your chosen name]
INTRO: [your 2-3 sentence introduction]`;

  try {
    const response = await ollamaGenerate({
      model: CHAT_MODEL,
      prompt: initPrompt,
      options: { num_ctx: 1024, num_predict: 200 },
    });

    const nameMatch = response.match(/NAME:\s*(.+)/i);
    const introMatch = response.match(/INTRO:\s*([\s\S]+)/i);

    memory.botName = nameMatch ? nameMatch[1].trim().split(' ')[0] : 'Ember';
    memory.botPersonality = `Your name is ${memory.botName}. You are a direct, creative, maker-focused assistant for Josh's LED light box business Lit Layer Creations. You help with listings, business ideas, and general conversation. You are not overly formal. You know Josh well — he's a VR developer, fisherman, and entrepreneur in Neenah, Wisconsin.`;
    memory.initialized = true;

    await saveMemory();

    const intro = introMatch ? introMatch[1].trim() : `Hey Josh — I'm ${memory.botName}. Ready to help with listings and anything else you need.`;
    await bot.sendMessage(chatId, intro);
    await bot.sendMessage(chatId, `Send me a photo of a light box anytime to start a listing, or just chat. Type /help to see commands.`);

  } catch (err) {
    memory.botName = 'Ember';
    memory.botPersonality = `Your name is Ember. You are a direct, creative, maker-focused assistant for Josh's LED light box business Lit Layer Creations.`;
    memory.initialized = true;
    await saveMemory();
    await bot.sendMessage(chatId, `Hey Josh — I'm Ember. Ready to help with listings and anything else. Send a photo to start a listing, or just chat.`);
  }
}

// ----------------------------
// General Chat Handler
// ----------------------------
function buildSystemPrompt() {
  const recentListingsSummary = memory.recentListings.length > 0
    ? `Recent listings created:\n${memory.recentListings.slice(0, 5).map(l => `- ${l.productName} (${l.category}) on ${l.date}`).join('\n')}`
    : 'No listings created yet.';

  const notesSummary = memory.notes.length > 0
    ? `Notes about Josh:\n${memory.notes.slice(0, 10).join('\n')}`
    : '';

  return `${memory.botPersonality || 'You are a helpful assistant named Ember.'}

About Josh:
- Name: ${memory.user.name}
- Location: ${memory.user.location}
- Business: ${memory.user.business}
- Other projects: ${memory.user.otherProjects.join('; ')}
- Preferences: ${memory.user.preferences}

${recentListingsSummary}
${notesSummary}

Keep responses concise and natural. You are talking via Telegram so avoid long walls of text. If Josh tells you something new about himself, acknowledge it. If he asks about a recent listing, refer to the history above.`;
}

async function handleChat(chatId, userMessage) {
  const s = getState(chatId);

  s.chatHistory.push({ role: 'user', content: userMessage });
  if (s.chatHistory.length > 20) s.chatHistory = s.chatHistory.slice(-20);

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...s.chatHistory,
  ];

  try {
    const reply = await ollamaChat({
      model: CHAT_MODEL,
      messages,
      options: { num_ctx: 4096, num_predict: 300 },
    });

    s.chatHistory.push({ role: 'assistant', content: reply });

    // Save notable things Josh mentions to memory notes
    const lowerMsg = userMessage.toLowerCase();
    if (lowerMsg.includes('remember') || lowerMsg.includes('note that') || lowerMsg.includes('by the way')) {
      memory.notes.push(`[${new Date().toLocaleDateString()}] ${userMessage}`);
      if (memory.notes.length > 20) memory.notes = memory.notes.slice(-20);
      await saveMemory();
    }

    return reply;
  } catch (err) {
    return `Sorry, I had trouble thinking. Try again? (${err.message})`;
  }
}

// ----------------------------
// Workflow Helpers
// ----------------------------
async function downloadTelegramPhotoToTemp(photoFileId, chatId) {
  const fileLink = await bot.getFileLink(photoFileId);
  const incomingDir = path.join(ROOT, '_incoming');
  await ensureDir(incomingDir);
  const fileName = `telegram_${chatId}_${Date.now()}.jpg`;
  const savePath = path.join(incomingDir, fileName);
  const response = await axios({ method: 'GET', url: fileLink, responseType: 'stream' });
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(savePath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
  return savePath;
}

function runNodeScript(scriptPath, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath], {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d.toString()));
    child.stderr.on('data', d => (stderr += d.toString()));
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`node exited with code ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
    child.on('error', err => reject(err));
  });
}

async function findBestMatching3mf(categoryDir, productName) {
  const entries = await fsp.readdir(categoryDir, { withFileTypes: true });
  const files = entries
    .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.3mf'))
    .map(e => e.name);

  if (files.length === 0) return null;

  const target = productName.toLowerCase().replace(/[^a-z0-9]/g, '');
  let best = null;
  let bestScore = -1;

  for (const f of files) {
    const base = f.replace(/\.3mf$/i, '');
    const cand = base.toLowerCase().replace(/[^a-z0-9]/g, '');
    let score = 0;
    if (cand === target) score += 100;
    if (cand.startsWith(target) || target.startsWith(cand)) score += 40;
    const freq = {};
    for (const ch of cand) freq[ch] = (freq[ch] || 0) + 1;
    let shared = 0;
    for (const ch of target) {
      if (freq[ch]) { shared++; freq[ch]--; }
    }
    score += shared;
    score += Math.max(0, 10 - Math.abs(cand.length - target.length));
    if (score > bestScore) { bestScore = score; best = f; }
  }

  const minScore = Math.max(18, Math.min(35, target.length + 8));
  if (bestScore < minScore) return null;
  return best;
}

async function appendTodo(productName, category) {
  const todoPath = path.join(ROOT, 'TODO.md');
  const line = `- [ ] Post ${productName} (${category}) to Facebook Marketplace — listing ready\n`;
  try {
    await fsp.access(todoPath, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(todoPath, '# TODO\n\n', 'utf8');
  }
  await fsp.appendFile(todoPath, line, 'utf8');
}

function buildListingPrompt({ category, productName, visionDesc }) {
  const openingGuidance = visionDesc
    ? `Use ONLY the following photo description to write the opening. Do not invent anything not mentioned.\nPHOTO DESCRIPTION:\n${visionDesc}\n`
    : `No photo description available. Keep the opening vivid but general — do NOT invent specific characters or logos.\n`;

  return (
    `You are writing a Facebook Marketplace listing for Josh's custom LED light box business "Lit Layer Creations" based in Neenah, Wisconsin.\n\n` +
    `${openingGuidance}\n` +
    `Category: ${category}\n` +
    `Product name: ${productName}\n\n` +
    `Write the listing using EXACTLY this format:\n\n` +
    `[2-3 sentence punchy opening — vivid, specific to the light box, describes what it depicts, the mood, and how it looks lit up]\n\n` +
    `✅ Approximately 9 inches wide\n` +
    `✅ Bright multi-color LED lighting with smooth glow effect\n` +
    `✅ Freestanding display design or can be hung on a wall\n` +
    `✅ Lightweight and easy to place on shelves, desks, or display areas\n` +
    `✅ USB powered\n\n` +
    `Perfect for [2-3 relevant room types or fan audiences based on the theme].\n\n` +
    `5 foot USB extension cord +$3\n\n` +
    `📍 Porch pickup in Neenah or shipping available\n` +
    `📩 Message me if interested or if you'd like a custom character, automotive, sports, or themed light box!\n\n` +
    `www.litlayercreations.com\n\n` +
    `RULES: Output ONLY the listing. No intro or explanation. Keep checklist items exactly as shown. No hashtags. No assembly info.\n`
  );
}

// ----------------------------
// WORKFLOW
// ----------------------------
async function runWorkflow(chatId) {
  const s = getState(chatId);
  if (s.stage === 'running') return;
  s.stage = 'running';

  const category = s.category;
  const productName = s.productName;

  try {
    const categoryDir = path.join(ROOT, category);
    try {
      const st = await fsp.stat(categoryDir);
      if (!st.isDirectory()) throw new Error();
    } catch {
      await bot.sendMessage(chatId, `⚠️ Category folder not found:\n${categoryDir}\n\nCreate it first, then /reset and try again.`);
      resetWorkflow(chatId);
      return;
    }

    // STEP 2 — Save images
    const mediaDir = path.join(categoryDir, 'media', productName);
    await ensureDir(mediaDir);

    const movedPaths = [];
    for (let i = 0; i < s.pendingImages.length; i++) {
      const tempPath = s.pendingImages[i].tempPath;
      const destName = `img_${String(i + 1).padStart(2, '0')}.jpg`;
      const destPath = path.join(mediaDir, destName);
      try {
        await fsp.rename(tempPath, destPath);
      } catch {
        await fsp.copyFile(tempPath, destPath);
        await fsp.unlink(tempPath);
      }
      movedPaths.push(destPath);
    }

    // STEP 3 — Fix .3mf
    const match = await findBestMatching3mf(categoryDir, productName);
    let renameNote = '';
    if (!match) {
      renameNote = `⚠️ No matching .3mf found in ${categoryDir} (continuing anyway)`;
    } else {
      const oldPath = path.join(categoryDir, match);
      const newPath = path.join(categoryDir, `${productName}.3mf`);
      if (path.basename(oldPath).toLowerCase() === path.basename(newPath).toLowerCase()) {
        renameNote = `✅ .3mf already correct: ${productName}.3mf`;
      } else {
        await fsp.rename(oldPath, newPath);
        renameNote = `✅ Renamed: ${match} → ${productName}.3mf`;
      }
    }

    // STEP 4 — Regenerate catalog
    const scanScript = path.join(ROOT, 'scan-lightboxes.js');
    try {
      await fsp.access(scanScript, fs.constants.F_OK);
    } catch {
      await bot.sendMessage(chatId, `⚠️ scan-lightboxes.js not found at ${scanScript}`);
      resetWorkflow(chatId);
      return;
    }

    await bot.sendMessage(chatId, `⏳ Scanning catalog...`);
    await runNodeScript(scanScript, ROOT);

    // STEP 5 — Vision
    let visionDesc = '';
    if (VISION_MODEL && movedPaths.length > 0) {
      try {
        await bot.sendMessage(chatId, `🔍 Analyzing image...`);
        const b64 = await imageToBase64(movedPaths[0]);
        visionDesc = await ollamaGenerate({
          model: VISION_MODEL,
          prompt: 'Describe what this LED light box depicts. Name any characters, logos, text, colors, and overall theme. Be specific.',
          imagesBase64: [b64],
          options: { num_ctx: 1024, num_predict: 250 },
        });
      } catch {
        visionDesc = '';
      }
    }

    // STEP 5 cont — Generate listing
    await bot.sendMessage(chatId, `✍️ Writing listing...`);
    const listingPrompt = buildListingPrompt({ category, productName, visionDesc });
    const listing = await ollamaGenerate({
      model: LISTING_MODEL,
      prompt: listingPrompt,
      options: { num_ctx: 2048, num_predict: 500 },
    });

    // STEP 6 — TODO
    await appendTodo(productName, category);

    // Save to memory
    addRecentListing(productName, category, listing);
    await saveMemory();

    // STEP 7 — Report
    const summary =
      `✅ Images saved to: ${mediaDir}\n` +
      `${renameNote}\n` +
      `✅ Catalog updated\n` +
      `✅ TODO.md updated\n\n` +
      `📄 Facebook Marketplace listing:\n\n${listing}`;

    await bot.sendMessage(chatId, summary);

  } catch (err) {
    await bot.sendMessage(chatId, `❌ Workflow failed:\n${err && err.message ? err.message : String(err)}\n\nSend /reset to start over.`);
  } finally {
    resetWorkflow(chatId);
  }
}

// ----------------------------
// UPDATE WORKFLOW — fix/replace images for existing product
// ----------------------------
async function runUpdateWorkflow(chatId) {
  const s = getState(chatId);
  if (s.stage === 'running') return;
  s.stage = 'running';

  const productName = s.updateProductName;
  const category = s.updateCategory;

  try {
    const mediaDir = path.join(ROOT, category, 'media', productName);

    // Check media folder exists
    try {
      await fsp.stat(mediaDir);
    } catch {
      await bot.sendMessage(chatId, `⚠️ Media folder not found:\n${mediaDir}\n\nCheck the product name and category, then /reset and try again.`);
      resetWorkflow(chatId);
      return;
    }

    // Backup old images instead of deleting them
    const backupDir = path.join(ROOT, '_backup', `${productName}_${Date.now()}`);
    await ensureDir(backupDir);
    const existingFiles = await fsp.readdir(mediaDir);
    const oldImages = existingFiles.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
    for (const f of oldImages) {
      await fsp.rename(path.join(mediaDir, f), path.join(backupDir, f));
    }

    // Save new images
    const movedPaths = [];
    for (let i = 0; i < s.pendingImages.length; i++) {
      const tempPath = s.pendingImages[i].tempPath;
      const destName = `img_${String(i + 1).padStart(2, '0')}.jpg`;
      const destPath = path.join(mediaDir, destName);
      try {
        await fsp.rename(tempPath, destPath);
      } catch {
        await fsp.copyFile(tempPath, destPath);
        await fsp.unlink(tempPath);
      }
      movedPaths.push(destPath);
    }

    // Regenerate catalog
    const scanScript = path.join(ROOT, 'scan-lightboxes.js');
    await bot.sendMessage(chatId, `⏳ Rescanning catalog...`);
    await runNodeScript(scanScript, ROOT);

    await bot.sendMessage(
      chatId,
      `✅ Updated ${productName} (${category})\n` +
      `Replaced ${oldImages.length} old image(s) with ${movedPaths.length} new image(s)\n` +
      `✅ Catalog regenerated\n\n` +
      `Images saved to:\n${mediaDir}`
    );

  } catch (err) {
    await bot.sendMessage(chatId, `❌ Update failed:\n${err && err.message ? err.message : String(err)}\n\nSend /reset to start over.`);
  } finally {
    resetWorkflow(chatId);
  }
}

// ----------------------------
// AUDIT — check all images exist on disk
// ----------------------------
async function runAudit(chatId) {
  await bot.sendMessage(chatId, `🔍 Auditing catalog and folders...`);

  const catalogPath = path.join(ROOT, 'catalog.json');
  let catalog = [];

  try {
    const raw = await fsp.readFile(catalogPath, 'utf8');
    catalog = JSON.parse(raw);
  } catch {
    await bot.sendMessage(chatId, `❌ Could not read catalog.json at ${catalogPath}`);
    return;
  }

  const broken = [];
  const missing = [];
  const ok = [];

  for (const product of catalog) {
    const productName = product.name || product.id || '(unknown)';
    const category = product.category || '(unknown)';

    // Check images array
    const images = product.images || [];
    if (images.length === 0) {
      missing.push(`${productName} (${category}) — no images in catalog`);
      continue;
    }

    let productOk = true;
    for (const imgPath of images) {
      // imgPath may be relative like "Pop Culture/media/Slimer/img_01.jpg"
      // or absolute — normalize to absolute
      const absPath = path.isAbsolute(imgPath)
        ? imgPath
        : path.join(ROOT, imgPath);

      try {
        await fsp.access(absPath, fs.constants.F_OK);
      } catch {
        broken.push(`${productName} (${category})\n  Missing: ${imgPath}`);
        productOk = false;
      }
    }

    if (productOk) ok.push(`${productName} (${category})`);
  }

  // Also scan folders for products NOT in catalog
  const uncataloged = [];
  for (const cat of ALLOWED_CATEGORIES) {
    const mediaDir = path.join(ROOT, cat, 'media');
    try {
      const products = await fsp.readdir(mediaDir, { withFileTypes: true });
      for (const p of products.filter(e => e.isDirectory())) {
        const inCatalog = catalog.some(c =>
          (c.name || c.id || '').toLowerCase() === p.name.toLowerCase()
        );
        if (!inCatalog) {
          uncataloged.push(`${p.name} (${cat}) — folder exists but not in catalog`);
        }
      }
    } catch {
      // category has no media folder, skip
    }
  }

  let report = `📋 Audit complete\n\n`;
  report += `✅ OK: ${ok.length} product(s)\n`;
  report += `❌ Broken images: ${broken.length}\n`;
  report += `⚠️ Missing from catalog: ${uncataloged.length}\n\n`;

  if (broken.length > 0) {
    report += `❌ BROKEN IMAGE PATHS:\n${broken.join('\n')}\n\n`;
  }
  if (uncataloged.length > 0) {
    report += `⚠️ IN FOLDERS BUT NOT CATALOGED:\n${uncataloged.join('\n')}\n\n`;
  }
  if (missing.length > 0) {
    report += `⚠️ NO IMAGES IN CATALOG:\n${missing.join('\n')}\n\n`;
  }

  if (broken.length > 0 || uncataloged.length > 0) {
    report += `Run /rescan to rebuild catalog from what's on disk.`;
  } else {
    report += `Everything looks good!`;
  }

  // Telegram has 4096 char limit — split if needed
  if (report.length > 4000) {
    await bot.sendMessage(chatId, report.slice(0, 4000));
    await bot.sendMessage(chatId, report.slice(4000));
  } else {
    await bot.sendMessage(chatId, report);
  }
}

// ----------------------------
// Telegram Handlers
// ----------------------------
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  resetWorkflow(chatId);
  if (!memory.initialized) {
    await initializeBot(chatId);
  } else {
    await bot.sendMessage(chatId, `Hey Josh! ${memory.botName} here. Send a photo to start a listing, or just chat.\n\nType /help for commands.`);
  }
});

bot.onText(/\/audit/, async (msg) => {
  await runAudit(msg.chat.id);
});

bot.onText(/\/rescan/, async (msg) => {
  const chatId = msg.chat.id;
  const scanScript = path.join(ROOT, 'scan-lightboxes.js');
  try {
    await bot.sendMessage(chatId, `⏳ Rescanning catalog from disk...`);
    await runNodeScript(scanScript, ROOT);
    await bot.sendMessage(chatId, `✅ Catalog rebuilt. Run /audit to verify.`);
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Rescan failed:\n${err.message}`);
  }
});

bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id;
  resetWorkflow(chatId);
  await bot.sendMessage(chatId, `Reset ✅ — send a photo to start a new listing.`);
});

bot.onText(/\/cancel/, async (msg) => {
  const chatId = msg.chat.id;
  resetWorkflow(chatId);
  await bot.sendMessage(chatId, `Cancelled ✅`);
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const s = getState(chatId);
  await bot.sendMessage(
    chatId,
    `Status:\n- Stage: ${s.stage}\n- Category: ${s.category || '(none)'}\n- Product: ${s.productName || '(none)'}\n- Images buffered: ${s.pendingImages.length}\n- Listing model: ${LISTING_MODEL}\n- Vision model: ${VISION_MODEL}\n- Chat model: ${CHAT_MODEL}`
  );
});

bot.onText(/\/memory/, async (msg) => {
  const chatId = msg.chat.id;
  const recent = memory.recentListings.slice(0, 5).map(l => `• ${l.productName} (${l.category}) — ${l.date}`).join('\n') || 'None yet';
  const notes = memory.notes.slice(0, 5).join('\n') || 'None';
  await bot.sendMessage(chatId, `🧠 Memory:\nBot name: ${memory.botName || '(not set)'}\n\nRecent listings:\n${recent}\n\nNotes:\n${notes}`);
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    `Commands:\n/reset — start a new listing\n/cancel — cancel current listing\n/audit — check for broken/missing images\n/rescan — rebuild catalog from disk\n/status — show current state\n/memory — show what I remember\n/help — this menu\n\nSend a photo anytime to start a listing.\nOr just chat — I'm here for both.`
  );
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const s = getState(chatId);

  if (msg.text && msg.text.startsWith('/')) return;

  // Initialize on first contact
  if (!memory.initialized && !msg.photo) {
    await initializeBot(chatId);
    return;
  }

  // Photo handler
  if (msg.photo && msg.photo.length > 0) {
    try {
      const photo = msg.photo[msg.photo.length - 1];
      const tempPath = await downloadTelegramPhotoToTemp(photo.file_id, chatId);

      if (s.stage === 'idle') {
        s.stage = 'awaitingMode';
        s.firstImageArrived = true;
        s.pendingImages.push({ tempPath, originalName: path.basename(tempPath) });
        await bot.sendMessage(
          chatId,
          `📸 Got it! Is this:\n\n1️⃣ new — New listing\n2️⃣ update — Fix/replace images for existing product\n\nReply: new or update`
        );
        return;
      }

      if (s.stage === 'awaitingMode') {
        s.pendingImages.push({ tempPath });
        await bot.sendMessage(chatId, `Image buffered (${s.pendingImages.length}). Reply new or update to continue.`);
        return;
      }

      if (s.stage === 'awaitingMeta') {
        s.pendingImages.push({ tempPath });
        await bot.sendMessage(chatId, `Image buffered (${s.pendingImages.length}). Still need Category + Name.`);
        return;
      }

      if (s.stage === 'awaitingUpdateMeta') {
        s.pendingImages.push({ tempPath });
        await bot.sendMessage(chatId, `Image buffered (${s.pendingImages.length}). Still need the product name to update.`);
        return;
      }

      if (s.stage === 'collectingImages') {
        s.pendingImages.push({ tempPath });
        const remaining = Math.max(0, 4 - s.pendingImages.length);
        if (remaining > 0) {
          await bot.sendMessage(chatId, `✅ Got it (${s.pendingImages.length}/4). Send ${remaining} more, or type "done".`);
          return;
        }
        await bot.sendMessage(chatId, `✅ Got 4 images. Running workflow...`);
        await runWorkflow(chatId);
        return;
      }

      if (s.stage === 'collectingUpdateImages') {
        s.pendingImages.push({ tempPath });
        const remaining = Math.max(0, 4 - s.pendingImages.length);
        if (remaining > 0) {
          await bot.sendMessage(chatId, `✅ Got it (${s.pendingImages.length}/4). Send ${remaining} more, or type "done".`);
          return;
        }
        // Require confirmation before replacing
        s.stage = 'confirmUpdate';
        await bot.sendMessage(chatId, `⚠️ Ready to replace ALL images in ${s.updateProductName} (${s.updateCategory}) with ${s.pendingImages.length} new image(s).\n\nOld images will be backed up to _backup folder.\n\nType YES to confirm or /cancel to abort.`);
        return;
      }

      if (s.stage === 'running') {
        await bot.sendMessage(chatId, `Still working on the last one — hang tight.`);
        return;
      }

    } catch (err) {
      await bot.sendMessage(chatId, `❌ Image download failed:\n${err.message}`);
    }
    return;
  }

  // Text handler
  if (typeof msg.text === 'string' && msg.text.trim().length > 0) {
    const text = msg.text.trim();

    if (!memory.initialized) {
      await initializeBot(chatId);
      return;
    }

    if (s.stage === 'awaitingMode') {
      const lower = text.toLowerCase().trim();
      if (lower === 'new' || lower === '1') {
        s.mode = 'new';
        s.stage = 'awaitingMeta';
        await bot.sendMessage(
          chatId,
          `New listing ✅\n\nTell me:\n1) Category: (${ALLOWED_CATEGORIES.join(', ')})\n2) Product name: (PascalCase, no spaces — e.g. RaccoonMario)\n\nReply like:\nCategory: Pop Culture\nName: RaccoonMario`
        );
      } else if (lower === 'update' || lower === '2') {
        s.mode = 'update';
        s.stage = 'awaitingUpdateMeta';
        await bot.sendMessage(
          chatId,
          `Update existing product ✅\n\nWhich product? Reply with:\nCategory: Pop Culture\nName: SpaceInvaders`
        );
      } else {
        await bot.sendMessage(chatId, `Reply new or update.`);
      }
      return;
    }

    if (s.stage === 'awaitingUpdateMeta') {
      let cat = null;
      let name = null;
      const catMatch = text.match(/category\s*:\s*([^\n\r]+)/i);
      const nameMatch = text.match(/name\s*:\s*([^\n\r]+)/i);
      if (catMatch) cat = catMatch[1].trim();
      if (nameMatch) name = nameMatch[1].trim();
      if (!cat || !name) {
        // Try matching known multi-word categories first
        const matched = ALLOWED_CATEGORIES.find(c => text.toLowerCase().startsWith(c.toLowerCase()));
        if (matched) {
          cat = cat || matched;
          name = name || text.slice(matched.length).replace(/[,\s]+/, '').trim();
        } else {
          const parts = text.split(/[\s,]+/).filter(Boolean);
          if (parts.length >= 2) { cat = cat || parts[0]; name = name || parts[parts.length - 1]; }
        }
      }

      const normalizedCat = normalizeCategory(cat);
      const cleanedName = safeBasename(name || '');

      if (!normalizedCat) {
        await bot.sendMessage(chatId, `⚠️ Invalid category. Use one of:\n${ALLOWED_CATEGORIES.join(', ')}`);
        return;
      }
      if (!isValidProductName(cleanedName)) {
        await bot.sendMessage(chatId, `⚠️ Invalid product name. PascalCase, one word.\nExample: SpaceInvaders`);
        return;
      }

      const checkDir = path.join(ROOT, normalizedCat, 'media', cleanedName);
      try {
        await fsp.stat(checkDir);
      } catch {
        await bot.sendMessage(chatId, `⚠️ No media folder found for ${cleanedName} in ${normalizedCat}.\nCheck spelling and try again.`);
        return;
      }

      s.updateCategory = normalizedCat;
      s.updateProductName = cleanedName;
      s.stage = 'collectingUpdateImages';

      const buffered = s.pendingImages.length;
      const remaining = Math.max(0, 4 - buffered);

      if (remaining > 0) {
        await bot.sendMessage(chatId, `✅ Found ${cleanedName} (${normalizedCat})\n\nSend ${remaining} more image(s) to replace existing ones, or type "done" to run now.`);
      } else {
        s.stage = 'confirmUpdate';
        await bot.sendMessage(chatId, `⚠️ Ready to replace ALL images in ${cleanedName} (${normalizedCat}) with ${s.pendingImages.length} new image(s).\n\nOld images will be backed up.\n\nType YES to confirm or /cancel to abort.`);
      }
      return;
    }

    if (s.stage === 'collectingUpdateImages') {
      if (/^(done|run|go)$/i.test(text)) {
        if (s.pendingImages.length < 1) {
          await bot.sendMessage(chatId, `No images yet — send a photo first.`);
          return;
        }
        // Require confirmation
        s.stage = 'confirmUpdate';
        await bot.sendMessage(chatId, `⚠️ Ready to replace ALL images in ${s.updateProductName} (${s.updateCategory}) with ${s.pendingImages.length} new image(s).\n\nOld images will be backed up to _backup folder.\n\nType YES to confirm or /cancel to abort.`);
        return;
      }
      const remaining = Math.max(0, 4 - s.pendingImages.length);
      await bot.sendMessage(chatId, `Send ${remaining} more image(s), or type "done" to run now.`);
      return;
    }

    if (s.stage === 'confirmUpdate') {
      if (text.trim().toUpperCase() === 'YES') {
        await bot.sendMessage(chatId, `Updating with ${s.pendingImages.length} image(s)...`);
        await runUpdateWorkflow(chatId);
      } else {
        await bot.sendMessage(chatId, `Update cancelled. Type /reset to start over.`);
        resetWorkflow(chatId);
      }
      return;
    }

    if (s.stage === 'awaitingMeta') {
      let cat = null;
      let name = null;
      const catMatch = text.match(/category\s*:\s*([^\n\r]+)/i);
      const nameMatch = text.match(/name\s*:\s*([^\n\r]+)/i);
      if (catMatch) cat = catMatch[1].trim();
      if (nameMatch) name = nameMatch[1].trim();
      if (!cat || !name) {
        const matched = ALLOWED_CATEGORIES.find(c => text.toLowerCase().startsWith(c.toLowerCase()));
        if (matched) {
          cat = cat || matched;
          name = name || text.slice(matched.length).replace(/[,\s]+/, '').trim();
        } else {
          const parts = text.split(/[\s,]+/).filter(Boolean);
          if (parts.length >= 2) { cat = cat || parts[0]; name = name || parts[parts.length - 1]; }
        }
      }

      const normalizedCat = normalizeCategory(cat);
      const cleanedName = safeBasename(name || '');

      if (!normalizedCat) {
        await bot.sendMessage(chatId, `⚠️ Invalid category. Use one of:\n${ALLOWED_CATEGORIES.join(', ')}`);
        return;
      }
      if (!isValidProductName(cleanedName)) {
        await bot.sendMessage(chatId, `⚠️ Invalid product name. PascalCase, one word, no spaces.\nExample: RaccoonMario`);
        return;
      }

      s.category = normalizedCat;
      s.productName = cleanedName;
      s.stage = 'collectingImages';

      const buffered = s.pendingImages.length;
      const remaining = Math.max(0, 4 - buffered);

      if (remaining > 0) {
        await bot.sendMessage(chatId, `✅ ${s.category} / ${s.productName}\n\nSend ${remaining} more image(s), or type "done" to run now.`);
      } else {
        await bot.sendMessage(chatId, `✅ Got it. Running workflow...`);
        await runWorkflow(chatId);
      }
      return;
    }

    if (s.stage === 'collectingImages') {
      if (/^(done|run|go)$/i.test(text)) {
        if (s.pendingImages.length < 1) {
          await bot.sendMessage(chatId, `No images yet — send a photo first.`);
          return;
        }
        await bot.sendMessage(chatId, `Running with ${s.pendingImages.length} image(s)...`);
        await runWorkflow(chatId);
        return;
      }
      const remaining = Math.max(0, 4 - s.pendingImages.length);
      await bot.sendMessage(chatId, `Send ${remaining} more image(s), or type "done" to run now.`);
      return;
    }

    if (s.stage === 'running') {
      await bot.sendMessage(chatId, `Still working — hang on.`);
      return;
    }

    // General chat
    if (s.stage === 'idle') {
      try {
        const reply = await handleChat(chatId, text);
        await bot.sendMessage(chatId, reply);
      } catch (err) {
        await bot.sendMessage(chatId, `Something went wrong: ${err.message}`);
      }
      return;
    }
  }
});

// ----------------------------
// Startup
// ----------------------------
loadMemory().then(() => {
  console.log(`🦞 Lit Layer Creations Bot running`);
  console.log(`ROOT: ${ROOT}`);
  console.log(`Ollama: ${OLLAMA_HOST}`);
  console.log(`Chat model: ${CHAT_MODEL}`);
  console.log(`Listing model: ${LISTING_MODEL}`);
  console.log(`Vision model: ${VISION_MODEL}`);
  console.log(`Bot name: ${memory.botName || '(will self-name on first contact)'}`);
});