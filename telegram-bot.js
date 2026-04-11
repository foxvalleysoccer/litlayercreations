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
// Required env vars:
//   $env:ANTHROPIC_API_KEY="sk-ant-..."   ← used for /order image reading (Claude vision)
//
// Optional env vars:
//   $env:LIGHTBOX_ROOT="C:\Users\josh\Desktop\Prints\Prints\LightBoxes"
//   $env:OLLAMA_HOST="http://127.0.0.1:11434"
//   $env:OLLAMA_LISTING_MODEL="llama3.1:8b"
//   $env:OLLAMA_CHAT_MODEL="llama3.1:8b"

const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
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

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.warn('Warning: ANTHROPIC_API_KEY not set — /order image reading will not work.');
}
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const ROOT = process.env.LIGHTBOX_ROOT || 'C:\\Users\\josh\\Desktop\\Prints\\Prints\\LightBoxes';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const LISTING_MODEL = process.env.OLLAMA_LISTING_MODEL || 'deepseek-v3.1:671b-cloud';
const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'minicpm-v';
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'deepseek-v3.1:671b-cloud';
const MEMORY_PATH = path.join(ROOT, 'memory.json');
const PRODUCTS_PATH = path.join(ROOT, '..', 'products.json'); // C:\Users\josh\Desktop\Prints\Prints\products.json
const TODO_PATH = process.env.TODO_PATH || 'C:\\Users\\josh\\shared\\todo.json';

// ── Shared Todo List ─────────────────────────────────────────────────
function loadTodos() {
  try {
    if (fs.existsSync(TODO_PATH)) {
      return JSON.parse(fs.readFileSync(TODO_PATH, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveTodos(todos) {
  const dir = path.dirname(TODO_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TODO_PATH, JSON.stringify(todos, null, 2), 'utf8');
}

function formatTodos(todos) {
  if (todos.length === 0) return '📋 Todo list is empty.';
  const open = todos.filter(t => !t.done);
  const done = todos.filter(t => t.done);
  let msg = '📋 Todo List\n\n';
  if (open.length > 0) {
    open.forEach(t => {
      const num = todos.indexOf(t) + 1;
      msg += `${num}. [ ] ${t.text}`;
      if (t.addedBy) msg += ` (${t.addedBy})`;
      msg += '\n';
    });
  }
  if (done.length > 0) {
    msg += '\nDone:\n';
    done.forEach(t => {
      const num = todos.indexOf(t) + 1;
      msg += `${num}. [x] ${t.text}\n`;
    });
  }
  return msg;
}

// ── Product catalog helpers ───────────────────────────────────────────
function loadProducts() {
  try {
    if (fs.existsSync(PRODUCTS_PATH)) {
      return JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('Could not load products.json:', e.message);
  }
  // Fallback: build from catalog.json in the LightBoxes root
  // Structure: [{category, items: [{name, file, media}]}]
  try {
    const catalogPath = path.join(ROOT, 'catalog.json');
    if (fs.existsSync(catalogPath)) {
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      const products = {};
      for (const catEntry of catalog) {
        const cat = catEntry.category || 'Other';
        for (const item of (catEntry.items || [])) {
          const name = item.name || item.id;
          if (name) {
            if (!products[cat]) products[cat] = [];
            products[cat].push(name);
          }
        }
      }
      return products;
    }
  } catch (e) {
    console.warn('Could not load catalog.json:', e.message);
  }
  return {};
}

// Flatten products into [{category, name}] list
function getFlatProductList() {
  const products = loadProducts();
  const flat = [];
  for (const [category, items] of Object.entries(products)) {
    for (const item of items) {
      flat.push({ category, name: item });
    }
  }
  return flat;
}

// Fuzzy score: compact substring bonus + word matching
function fuzzyScore(query, name, category = '') {
  const compact = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const toWords = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

  const qc = compact(query);
  const nc = compact(name);
  const qw = toWords(query);
  const nw = toWords(name);

  let score = 0;

  // Strongest signal: catalog name (no spaces/punctuation) is a substring of the query
  if (nc.length > 2 && qc.includes(nc)) score += 10;

  // Word-level matching on the catalog name (not category, to avoid "Automotive" matching "auto")
  for (const w of nw) {
    if (w.length < 2) continue;
    if (qw.includes(w)) score += 3;                                           // exact word match
    else if (qw.some(qw2 => qw2.includes(w) || w.includes(qw2))) score += 1; // partial
  }

  return score;
}

// Return top N matches for a query string
function findTopMatches(query, n = 4) {
  const flat = getFlatProductList();
  const scored = flat.map(p => ({
    ...p,
    score: fuzzyScore(query, p.name, p.category)
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.filter(p => p.score > 0).slice(0, n);
}

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
    business: 'Lit Layer Creations — custom 3D-printed LED light boxes sold on Etsy, Facebook Marketplace, and eBay.',
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

async function downloadTelegramVideoToTemp(videoFileId, chatId) {
  const fileLink = await bot.getFileLink(videoFileId);
  const incomingDir = path.join(ROOT, '_incoming');
  await ensureDir(incomingDir);
  const fileName = `telegram_vid_${chatId}_${Date.now()}.mp4`;
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

function buildListingPrompt({ category, productName, visionDesc, platform = 'facebook' }) {
  const visionHint = visionDesc
    ? `PHOTO NOTES (use for mood/lighting details only — the product name below is the authoritative subject):\n${visionDesc}\n`
    : '';

  if (platform === 'etsy') {
    return (
      `You are writing an Etsy product listing for Josh's custom LED light box business "Lit Layer Creations" based in Neenah, Wisconsin.\n\n` +
      `PRODUCT NAME: ${productName}\n` +
      `CATEGORY: ${category}\n` +
      `${visionHint}\n` +
      `Etsy format: enthusiastic but professional tone. Emphasize handmade, custom, unique, and gift potential. Use relevant keywords naturally. Include a bulleted details section.\n\n` +
      `Write the listing now using EXACTLY this structure. Output nothing else:\n\n` +
      `${productName} LED Light Box – Custom Handmade Neon-Style Night Light\n\n` +
      `Write 2-3 sentences describing the ${productName} light box — how it looks lit up, the mood it creates, why fans will love it as a gift or display piece.\n\n` +
      `✨ PRODUCT DETAILS:\n` +
      `▸ Approximately 9 inches wide\n` +
      `▸ Bright multi-color LED lighting with smooth glow effect\n` +
      `▸ Freestanding or wall-mountable display\n` +
      `▸ Lightweight — easy to place on shelves, desks, or display areas\n` +
      `▸ USB powered (cable included)\n` +
      `▸ 5 ft USB extension cord included\n\n` +
      `Write a "Perfect gift for..." sentence naming 2-3 fan audiences or occasions for ${productName}.\n\n` +
      `🚚 Ships from Neenah, Wisconsin.\n\n` +
      `🏷️ TAGS:\n` +
      `Write exactly 13 comma-separated Etsy tags for ${productName}. Mix specific (the character/brand name, fandom) and broad (led light box, neon sign alternative, man cave decor, gamer gift, handmade gift, night light, custom light box, desk decor). Each tag max 20 characters. No hashtags.\n\n` +
      `RULES: Output ONLY the finished listing text. Replace all instruction lines with real written content. Keep all ▸ bullet lines exactly as shown. The tags section must appear exactly as: 🏷️ TAGS: followed by a newline and the 13 comma-separated tags. No extra commentary.\n`
    );
  }

  if (platform === 'ebay') {
    return (
      `You are writing an eBay product listing for Josh's custom LED light box business "Lit Layer Creations" based in Neenah, Wisconsin.\n\n` +
      `PRODUCT NAME: ${productName}\n` +
      `CATEGORY: ${category}\n` +
      `${visionHint}\n` +
      `eBay format: clear, descriptive, keyword-rich. Buyers are searching specifically for this item. Lead with the title, then a short description, then bullet specs. Professional but approachable tone.\n\n` +
      `Write the listing now using EXACTLY this structure. Output nothing else:\n\n` +
      `${productName} LED Light Box – Custom Handmade Neon-Style Night Light\n\n` +
      `Write 2-3 sentences describing the ${productName} light box — what it looks like lit up, who it's perfect for, and why it makes a great display piece or gift.\n\n` +
      `ITEM SPECIFICS:\n` +
      `• Approximately 9 inches wide\n` +
      `• Bright multi-color LED lighting with smooth glow effect\n` +
      `[If remote controlled, add: • Remote Controlled]\n` +
      `[If sound reactive, add: • Sound Reactive]\n` +
      `• Freestanding or wall-mountable\n` +
      `• USB powered — 5 ft cord included\n` +
      `• Handmade in Neenah, Wisconsin\n\n` +
      `Write a "Perfect for..." sentence naming 2-3 specific audiences or room types for ${productName}.\n\n` +
      `Ships from Neenah, WI. Combined shipping available.\n\n` +
      `RULES: Output ONLY the finished listing text. Replace instruction lines in [brackets] with the actual bullet if applicable, or omit if not. Replace all other placeholder lines with real written content. Keep all fixed bullet lines exactly as shown. No hashtags. No extra commentary.\n`
    );
  }

  // Default: Facebook Marketplace
  return (
    `You are writing a Facebook Marketplace listing for Josh's custom LED light box business "Lit Layer Creations" based in Neenah, Wisconsin.\n\n` +
    `PRODUCT NAME: ${productName}\n` +
    `CATEGORY: ${category}\n` +
    `${visionHint}\n` +
    `The product name is the subject of this listing. Always write about "${productName}" specifically.\n\n` +
    `Write the listing now using EXACTLY this structure. Output nothing else — no intro, no explanation, no angle brackets, no labels:\n\n` +
    `${productName} LED Light Box\n\n` +
    `Write 2-3 vivid sentences here describing the ${productName} light box specifically — how it looks lit up, the mood it creates, why fans will love it. Do NOT start with the product name. Start with action or atmosphere.\n\n` +
    `✅ Approximately 9 inches wide\n` +
    `✅ Bright multi-color LED lighting with smooth glow effect\n` +
    `[If this product has a remote control, add: ✅ Remote Controlled]\n` +
    `[If this product has sound reactive lighting, add: ✅ Sound Reactive Lights]\n` +
    `✅ Freestanding display design or can be hung on a wall\n` +
    `✅ Lightweight and easy to place on shelves, desks, or display areas\n` +
    `✅ USB powered\n\n` +
    `Write a "Perfect for..." sentence naming 2-3 specific room types or fan audiences for ${productName}.\n\n` +
    `5 foot USB extension cord +$3\n\n` +
    `📍 Porch pickup in Neenah or shipping available\n\n` +
    `📩 Message me if interested or if you'd like a custom character, automotive, sports, or themed light box!\n\n` +
    `www.litlayercreations.com\n\n` +
    `RULES: Output ONLY the finished listing text. Replace instruction lines in [brackets] with the actual ✅ line if applicable, or omit them entirely if not. Replace all other placeholder instruction lines with real written content. Keep all fixed ✅ lines exactly as shown. No hashtags. No extra commentary.\n`
  );
}

// ----------------------------
// AD WORKFLOW — generate marketplace listing only, no file save
// ----------------------------
async function runAdWorkflow(chatId) {
  const s = getState(chatId);
  if (s.stage === 'running') return;
  s.stage = 'running';

  const category = s.adCategory;
  const productName = s.adProductName;
  const platform = s.adPlatform || 'facebook';

  const platformLabels = { facebook: 'Facebook Marketplace', etsy: 'Etsy', ebay: 'eBay' };
  const label = platformLabels[platform] || 'Facebook Marketplace';

  try {
    // Vision — use already-captured desc from name confirmation step, or run fresh if missing
    let visionDesc = s.adVisionDesc || '';
    if (!visionDesc) {
      const firstImage = s.pendingImages.find(p => /\.(jpg|jpeg|png|webp)$/i.test(p.tempPath));
      if (VISION_MODEL && firstImage) {
        try {
          await bot.sendMessage(chatId, `🔍 Analyzing image...`);
          const b64 = await imageToBase64(firstImage.tempPath);
          visionDesc = await ollamaGenerate({
            model: VISION_MODEL,
            prompt: 'Describe what this LED light box depicts. Read any text or words shown exactly as written. Identify any band names, brand logos, sports teams, musicians, movie/TV characters, or pop culture references by their real name. Describe colors, lighting style, and overall theme. Be specific and accurate.',
            imagesBase64: [b64],
            options: { num_ctx: 1024, num_predict: 250 },
          });
        } catch {
          visionDesc = '';
        }
      }
    }

    // Generate listing
    await bot.sendMessage(chatId, `✍️ Writing ${label} ad...`);
    const listingPrompt = buildListingPrompt({ category, productName, visionDesc, platform });
    const listing = await ollamaGenerate({
      model: LISTING_MODEL,
      prompt: listingPrompt,
      options: { num_ctx: 2048, num_predict: 500 },
    });

    // Save to memory
    addRecentListing(productName, category, listing);
    await saveMemory();

    await bot.sendMessage(chatId, `📄 ${label} listing for ${productName}:\n\n${listing}`);

    // Clean up temp files
    for (const item of s.pendingImages) {
      try { await fsp.unlink(item.tempPath); } catch { /* ignore */ }
    }

  } catch (err) {
    await bot.sendMessage(chatId, `❌ Ad generation failed:\n${err && err.message ? err.message : String(err)}\n\nSend /reset to start over.`);
  } finally {
    resetWorkflow(chatId);
  }
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
    let imgCount = 0;
    let vidCount = 0;
    for (const item of s.pendingImages) {
      const { tempPath, fileType } = item;
      let destName;
      if (fileType === 'video') {
        vidCount++;
        destName = `vid_${String(vidCount).padStart(2, '0')}.mp4`;
      } else {
        imgCount++;
        destName = `img_${String(imgCount).padStart(2, '0')}.jpg`;
      }
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

    // STEP 5 — Vision (images only — bakllava cannot analyze video)
    let visionDesc = '';
    const firstImagePath = movedPaths.find(p => /\.(jpg|jpeg|png|webp)$/i.test(p));
    if (VISION_MODEL && firstImagePath) {
      try {
        await bot.sendMessage(chatId, `🔍 Analyzing image...`);
        const b64 = await imageToBase64(firstImagePath);
        visionDesc = await ollamaGenerate({
          model: VISION_MODEL,
          prompt: 'Describe what this LED light box depicts. Read any text or words shown exactly as written. Identify any band names, brand logos, sports teams, musicians, movie/TV characters, or pop culture references by their real name. Describe colors, lighting style, and overall theme. Be specific and accurate.',
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
      `✅ Media saved to: ${mediaDir}\n` +
      `   (${imgCount} image(s), ${vidCount} video(s))\n` +
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

    // Backup old images/videos instead of deleting them
    const backupDir = path.join(ROOT, '_backup', `${productName}_${Date.now()}`);
    await ensureDir(backupDir);
    const existingFiles = await fsp.readdir(mediaDir);
    const oldMedia = existingFiles.filter(f => /\.(jpg|jpeg|png|webp|mp4|mov|webm)$/i.test(f));
    for (const f of oldMedia) {
      await fsp.rename(path.join(mediaDir, f), path.join(backupDir, f));
    }

    // Save new images/videos
    const movedPaths = [];
    let imgCount = 0;
    let vidCount = 0;
    for (const item of s.pendingImages) {
      const { tempPath, fileType } = item;
      let destName;
      if (fileType === 'video') {
        vidCount++;
        destName = `vid_${String(vidCount).padStart(2, '0')}.mp4`;
      } else {
        imgCount++;
        destName = `img_${String(imgCount).padStart(2, '0')}.jpg`;
      }
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
      `Replaced ${oldMedia.length} old file(s) with ${movedPaths.length} new file(s)\n` +
      `✅ Catalog regenerated\n\n` +
      `Media saved to:\n${mediaDir}`
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
    await bot.sendMessage(chatId, `Hey Josh! ${memory.botName} here. Send a photo or video to start a listing, or just chat.\n\nType /help for commands.`);
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
  await bot.sendMessage(chatId, `Reset ✅ — send a photo or video to start a new listing.`);
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
    `Status:\n- Stage: ${s.stage}\n- Category: ${s.category || '(none)'}\n- Product: ${s.productName || '(none)'}\n- Files buffered: ${s.pendingImages.length} (${s.pendingImages.filter(f => f.fileType === 'video').length} video, ${s.pendingImages.filter(f => f.fileType !== 'video').length} image)\n- Listing model: ${LISTING_MODEL}\n- Vision model: ${VISION_MODEL}\n- Chat model: ${CHAT_MODEL}`
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
    `Commands:\n/reset — start a new listing\n/cancel — cancel current listing\n/order — log a sale from a screenshot\n/audit — check for broken/missing images\n/rescan — rebuild catalog from disk\n/status — show current state\n/memory — show what I remember\n/help — this menu\n\nSend a photo or video anytime to start a listing.\nOr just chat — I'm here for both.`
  );
});


// ── TODO COMMAND ─────────────────────────────────────────────────────
bot.onText(/\/todo(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const args = (match[1] || '').trim();

  // /todo — show list
  if (!args) {
    const todos = loadTodos();
    await bot.sendMessage(chatId, formatTodos(todos));
    return;
  }

  // /todo add some task
  if (args.toLowerCase().startsWith('add ')) {
    const text = args.slice(4).trim();
    if (!text) { await bot.sendMessage(chatId, 'Usage: /todo add your task here'); return; }
    const todos = loadTodos();
    todos.push({ text, done: false, addedBy: 'Flux', addedAt: new Date().toISOString() });
    saveTodos(todos);
    await bot.sendMessage(chatId, `✅ Added: "${text}"

${formatTodos(todos)}`);
    return;
  }

  // /todo done 2
  if (args.toLowerCase().startsWith('done ')) {
    const num = parseInt(args.slice(5).trim());
    const todos = loadTodos();
    if (isNaN(num) || num < 1 || num > todos.length) {
      await bot.sendMessage(chatId, `Invalid number. Use /todo to see the list.`);
      return;
    }
    todos[num - 1].done = true;
    todos[num - 1].doneAt = new Date().toISOString();
    saveTodos(todos);
    await bot.sendMessage(chatId, `✅ Marked done: "${todos[num - 1].text}"

${formatTodos(todos)}`);
    return;
  }

  // /todo delete 2
  if (args.toLowerCase().startsWith('delete ') || args.toLowerCase().startsWith('del ')) {
    const num = parseInt(args.split(' ')[1]);
    const todos = loadTodos();
    if (isNaN(num) || num < 1 || num > todos.length) {
      await bot.sendMessage(chatId, `Invalid number. Use /todo to see the list.`);
      return;
    }
    const removed = todos.splice(num - 1, 1)[0];
    saveTodos(todos);
    await bot.sendMessage(chatId, `🗑 Deleted: "${removed.text}"

${formatTodos(todos)}`);
    return;
  }

  // /todo clear — remove all done items
  if (args.toLowerCase() === 'clear') {
    let todos = loadTodos();
    const before = todos.length;
    todos = todos.filter(t => !t.done);
    saveTodos(todos);
    await bot.sendMessage(chatId, `🧹 Cleared ${before - todos.length} done item(s).

${formatTodos(todos)}`);
    return;
  }

  await bot.sendMessage(chatId,
    `Todo commands:
/todo — show list
/todo add [task] — add item
/todo done [#] — mark complete
/todo delete [#] — remove item
/todo clear — remove all done items`
  );
});

// Add restock todos for all items in an order
function addRestockTodos(order) {
  const todos = loadTodos();
  const items = order.items || [];
  items.forEach(item => {
    const name = item.name || 'Unknown item';
    const text = `Build new ${name} (sold to ${order.customer})`;
    todos.push({
      text,
      done: false,
      addedBy: 'Flux',
      addedAt: new Date().toISOString(),
      type: 'restock'
    });
  });
  saveTodos(todos);
  return items.length;
}

// ── ORDER COMMAND ────────────────────────────────────────────────────
const ORDER_SERVER = 'http://localhost:3000';

async function extractOrderFromImage(imagePath) {
  const imageBuffer = await fsp.readFile(imagePath);
  const base64Image = imageBuffer.toString('base64');

  // Detect image type from file extension
  const ext = path.extname(imagePath).toLowerCase();
  const mediaType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64Image }
        },
        {
          type: 'text',
          text: `Read this Facebook Marketplace order screenshot and output ONLY a JSON object.
Replace every placeholder with the actual value from the image:
{"customer":"<BUYER_NAME>","orderType":"<shipping or local>","items":[{"name":"<EXACT_ITEM_NAME>","qty":<QTY_NUMBER>,"price":<PRICE_NUMBER>}],"shippingCollected":<SHIPPING_COST_NUMBER>,"marketplaceFee":<FEE_NUMBER>,"notes":"<ORDER_NUMBER>"}

Rules:
- orderType is "shipping" if a shipping address is visible, otherwise "local"
- All numbers must be numeric (no $ signs), use 0 if not visible
- marketplaceFee is the "Selling fee" amount
- shippingCollected is the buyer shipping cost
- notes should contain the order number
- Output ONLY the JSON, no markdown, no backticks, nothing else`
        }
      ]
    }]
  });

  const rawText = (response.content[0].text || '').trim();
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Claude could not parse the order image. Got: ${rawText.slice(0, 100)}`);
  return JSON.parse(jsonMatch[0]);
}

async function postOrderToServer(order) {
  const response = await fetch(`${ORDER_SERVER}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order)
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Server error: ${err}`);
  }
  return response.json();
}

function formatOrderSummary(order) {
  const itemLines = (order.items || []).map(i => `  • ${i.name} x${i.qty} — $${Number(i.price).toFixed(2)}`).join('\n');
  const total = (order.items || []).reduce((sum, i) => sum + (i.qty * i.price), 0);
  let summary = `📋 Order Summary\n`;
  summary += `Customer: ${order.customer}\n`;
  summary += `Type: ${order.orderType === 'shipping' ? '📦 Shipping' : '🏠 Local Pickup'}\n`;
  summary += `Items:\n${itemLines}\n`;
  summary += `Item Total: $${total.toFixed(2)}\n`;
  if (order.shippingCollected > 0) summary += `Shipping Collected: $${Number(order.shippingCollected).toFixed(2)}\n`;
  if (order.marketplaceFee > 0) summary += `Marketplace Fee: $${Number(order.marketplaceFee).toFixed(2)}\n`;
  if (order.notes) summary += `Notes: ${order.notes}\n`;
  summary += `\nType YES to save or /cancel to discard.`;
  return summary;
}

// Order workflow state
const orderStates = {};

bot.onText(/\/order/, async (msg) => {
  const chatId = msg.chat.id;
  orderStates[chatId] = { stage: 'awaitingPhoto' };
  await bot.sendMessage(chatId, `📸 Send me a screenshot of the Facebook order and I'll extract the details.`);
});

// Handle order confirmation text
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const os = orderStates[chatId];
  if (!os) return;

  // Photo received while in order workflow
  if (msg.photo && os.stage === 'awaitingPhoto') {
    await bot.sendMessage(chatId, `🔍 Analyzing order...`);
    try {
      const photo = msg.photo[msg.photo.length - 1];
      const tempPath = await downloadTelegramPhotoToTemp(photo.file_id, chatId);
      const extracted = await extractOrderFromImage(tempPath);
      await fsp.unlink(tempPath).catch(() => {});

      os.order = {
        ...extracted,
        date: new Date().toISOString().split('T')[0],
        sonLights: 0,
        sonPaid: extracted.orderType === 'shipping' ? 'yes' : 'no',
        source: 'bot'
      };

      // Start item matching — work through each extracted item one at a time
      os.itemsToMatch = (os.order.items || []).map((item, i) => ({ ...item, index: i }));
      os.currentMatchIndex = 0;
      os.order.items = [...(os.order.items || [])]; // copy so we can patch names

      if (os.itemsToMatch.length > 0) {
        os.stage = 'awaitingItemPick';
        const first = os.itemsToMatch[0];
        const matches = findTopMatches(first.name);
        os.currentMatches = matches;
        let msg = `🔍 I read the item as:\n"${first.name}"\n\nBest matches from your catalog:\n`;
        matches.forEach((m, i) => {
          msg += `${i + 1}. ${m.name} (${m.category})\n`;
        });
        msg += `${matches.length + 1}. Keep original name\n\nReply with a number.`;
        await bot.sendMessage(chatId, msg);
      } else {
        os.stage = 'awaitingConfirm';
        await bot.sendMessage(chatId, formatOrderSummary(os.order));
      }
    } catch (err) {
      if (err.visionFailed) {
        os.stage = 'awaitingManualOrder';
        await bot.sendMessage(chatId,
          `📸 I couldn't read that screenshot (vision returned: "${err.visionSaw || 'nothing'}").\n\n` +
          `Type the order details and I'll parse them:\n\n` +
          `Example:\nJoe Glenn, SRT Hellcat $25, shipping $8, fee $3.48, order #847746844945364, shipping order`
        );
      } else {
        delete orderStates[chatId];
        await bot.sendMessage(chatId, `❌ Failed to read order: ${err.message}\nTry again with /order`);
      }
    }
    return;
  }

  // Manual order text entry fallback
  if (os.stage === 'awaitingManualOrder' && msg.text) {
    if (msg.text.startsWith('/cancel')) {
      delete orderStates[chatId];
      await bot.sendMessage(chatId, `Order discarded.`);
      return;
    }
    try {
      const manualPrompt = `Extract order details from this text and output ONLY a JSON object.
Text: "${msg.text}"

Replace every placeholder with the actual extracted value:
{"customer":"<BUYER_NAME>","orderType":"<shipping or local>","items":[{"name":"<EXACT_ITEM_NAME>","qty":<QTY_NUMBER>,"price":<PRICE_NUMBER>}],"shippingCollected":<SHIPPING_COST_NUMBER>,"marketplaceFee":<FEE_NUMBER>,"notes":"<ORDER_NUMBER>"}

Rules:
- orderType is "shipping" if a shipping address or "shipping order" was mentioned, otherwise "local"
- All numbers must be numeric (no $ signs), use 0 if unknown
- Output ONLY the JSON, nothing else`;

      const manualResponse = await fetch(`${OLLAMA_HOST}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: LISTING_MODEL, prompt: manualPrompt, stream: false })
      });
      const manualData = await manualResponse.json();
      const manualText = (manualData.response || '').trim();
      const manualMatch = manualText.match(/\{[\s\S]*\}/);
      if (!manualMatch) throw new Error('Could not parse your input. Try: Name, Item $price, shipping $X, fee $X, order #X');
      const extracted = JSON.parse(manualMatch[0]);

      os.order = {
        ...extracted,
        date: new Date().toISOString().split('T')[0],
        sonLights: 0,
        sonPaid: extracted.orderType === 'shipping' ? 'yes' : 'no',
        source: 'bot-manual'
      };
      os.itemsToMatch = (os.order.items || []).map((item, i) => ({ ...item, index: i }));
      os.currentMatchIndex = 0;
      os.order.items = [...(os.order.items || [])];

      if (os.itemsToMatch.length > 0) {
        os.stage = 'awaitingItemPick';
        const first = os.itemsToMatch[0];
        const matches = findTopMatches(first.name);
        os.currentMatches = matches;
        let reply = `🔍 I read the item as:\n"${first.name}"\n\nBest matches from your catalog:\n`;
        matches.forEach((m, i) => { reply += `${i + 1}. ${m.name} (${m.category})\n`; });
        reply += `${matches.length + 1}. Keep original name\n\nReply with a number.`;
        await bot.sendMessage(chatId, reply);
      } else {
        os.stage = 'awaitingConfirm';
        await bot.sendMessage(chatId, formatOrderSummary(os.order));
      }
    } catch (err) {
      delete orderStates[chatId];
      await bot.sendMessage(chatId, `❌ ${err.message}\n\nStart over with /order`);
    }
    return;
  }

  // Item pick list handler
  if (os.stage === 'awaitingItemPick' && msg.text) {
    if (msg.text.startsWith('/cancel')) {
      delete orderStates[chatId];
      await bot.sendMessage(chatId, `Order discarded.`);
      return;
    }

    const pick = parseInt(msg.text.trim());
    const matches = os.currentMatches || [];
    const currentItem = os.itemsToMatch[os.currentMatchIndex];

    if (isNaN(pick) || pick < 1 || pick > matches.length + 1) {
      await bot.sendMessage(chatId, `Please reply with a number between 1 and ${matches.length + 1}.`);
      return;
    }

    // Apply the pick
    if (pick <= matches.length) {
      const chosen = matches[pick - 1];
      os.order.items[currentItem.index].name = chosen.name;
      os.order.items[currentItem.index].category = chosen.category;
    }
    // If pick === matches.length + 1, keep original name

    // Move to next item or proceed to confirm
    os.currentMatchIndex++;
    if (os.currentMatchIndex < os.itemsToMatch.length) {
      const next = os.itemsToMatch[os.currentMatchIndex];
      const nextMatches = findTopMatches(next.name);
      os.currentMatches = nextMatches;
      let reply = `🔍 Next item:\n"${next.name}"\n\nBest matches:\n`;
      nextMatches.forEach((m, i) => {
        reply += `${i + 1}. ${m.name} (${m.category})\n`;
      });
      reply += `${nextMatches.length + 1}. Keep original name\n\nReply with a number.`;
      await bot.sendMessage(chatId, reply);
    } else {
      // All items matched — show summary
      os.stage = 'awaitingConfirm';
      await bot.sendMessage(chatId, formatOrderSummary(os.order));
    }
    return;
  }

  // Confirmation
  if (os.stage === 'awaitingConfirm' && msg.text) {
    if (msg.text.trim().toUpperCase() === 'YES') {
      // For shipping orders, ask for label cost and packaging cost before saving
      if (os.order.orderType === 'shipping') {
        os.stage = 'awaitingLabelCost';
        await bot.sendMessage(chatId, `📦 What was the shipping label cost? (enter 0 if none)`);
      } else {
        // Local pickup — save immediately
        try {
          await postOrderToServer(os.order);
          const restockCount2 = addRestockTodos(os.order);
          delete orderStates[chatId];
          await bot.sendMessage(chatId,
            `✅ Order saved for ${os.order.customer}!\n` +
            `📋 Added ${restockCount2} restock item(s) to your todo list.\n` +
            `It will appear in your order entry page next time you load it.`
          );
        } catch (err) {
          delete orderStates[chatId];
          await bot.sendMessage(chatId, `❌ Failed to save order: ${err.message}`);
        }
      }
    } else if (msg.text.startsWith('/cancel') || msg.text.toLowerCase() === 'no') {
      delete orderStates[chatId];
      await bot.sendMessage(chatId, `Order discarded.`);
    }
    return;
  }

  if (os.stage === 'awaitingLabelCost' && msg.text) {
    if (msg.text.startsWith('/cancel')) {
      delete orderStates[chatId];
      await bot.sendMessage(chatId, `Order discarded.`);
      return;
    }
    const val = parseFloat(msg.text.replace(/[^0-9.]/g, ''));
    os.order.shippingLabelCost = isNaN(val) ? 0 : val;
    os.stage = 'awaitingPackagingCost';
    await bot.sendMessage(chatId, `📦 What was the packaging cost? (enter 0 if none)`);
    return;
  }

  if (os.stage === 'awaitingPackagingCost' && msg.text) {
    if (msg.text.startsWith('/cancel')) {
      delete orderStates[chatId];
      await bot.sendMessage(chatId, `Order discarded.`);
      return;
    }
    const val = parseFloat(msg.text.replace(/[^0-9.]/g, ''));
    os.order.packagingCost = isNaN(val) ? 0 : val;
    try {
      await postOrderToServer(os.order);
      const restockCount = addRestockTodos(os.order);
      delete orderStates[chatId];
      await bot.sendMessage(chatId,
        `✅ Order saved for ${os.order.customer}!\n` +
        `Label: $${os.order.shippingLabelCost.toFixed(2)} | Packaging: $${os.order.packagingCost.toFixed(2)}\n` +
        `📋 Added ${restockCount} restock item(s) to your todo list.\n` +
        `It will appear in your order entry page next time you load it.`
      );
    } catch (err) {
      delete orderStates[chatId];
      await bot.sendMessage(chatId, `❌ Failed to save order: ${err.message}`);
    }
    return;
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const s = getState(chatId);

  if (msg.text && msg.text.startsWith('/')) return;

  // Don't let the chat/listing handler interfere with the order workflow
  if (orderStates[chatId]) return;

  // Initialize on first contact
  if (!memory.initialized && !msg.photo) {
    await initializeBot(chatId);
    return;
  }

  // Photo handler — skip if order workflow is active for this chat
  if (msg.photo && msg.photo.length > 0 && !orderStates[chatId]) {
    try {
      const photo = msg.photo[msg.photo.length - 1];
      const tempPath = await downloadTelegramPhotoToTemp(photo.file_id, chatId);

      if (s.stage === 'idle') {
        s.stage = 'awaitingMode';
        s.firstImageArrived = true;
        s.pendingImages.push({ tempPath, originalName: path.basename(tempPath), fileType: 'image' });
        await bot.sendMessage(
          chatId,
          `📸 Got it! Is this:\n\n1️⃣ new — New listing (save files + generate ad)\n2️⃣ update — Fix/replace media for existing product\n3️⃣ ad — Generate marketplace ad only (no file save)\n\nReply: new, update, or ad`
        );
        return;
      }

      if (s.stage === 'awaitingMode') {
        s.pendingImages.push({ tempPath, fileType: 'image' });
        await bot.sendMessage(chatId, `File buffered (${s.pendingImages.length}). Reply new or update to continue.`);
        return;
      }

      if (s.stage === 'awaitingMeta') {
        s.pendingImages.push({ tempPath, fileType: 'image' });
        await bot.sendMessage(chatId, `Image buffered (${s.pendingImages.length}). Still need Category + Name.`);
        return;
      }

      if (s.stage === 'awaitingUpdateMeta') {
        s.pendingImages.push({ tempPath, fileType: 'image' });
        await bot.sendMessage(chatId, `Image buffered (${s.pendingImages.length}). Still need the product name to update.`);
        return;
      }

      if (s.stage === 'collectingImages') {
        s.pendingImages.push({ tempPath, fileType: 'image' });
        await bot.sendMessage(chatId, `✅ Got it (${s.pendingImages.length} so far). Send more or type "done".`);
        return;
      }

      if (s.stage === 'collectingUpdateImages') {
        s.pendingImages.push({ tempPath, fileType: 'image' });
        await bot.sendMessage(chatId, `✅ Got it (${s.pendingImages.length} so far). Send more or type "done".`);
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

  // Document handler — fires when images are sent as files ("OPEN WITH") instead of compressed photos
  if (msg.document && !orderStates[chatId]) {
    const mime = msg.document.mime_type || '';
    if (/^image\/(jpeg|jpg|png|webp)$/i.test(mime)) {
      try {
        const tempPath = await downloadTelegramPhotoToTemp(msg.document.file_id, chatId);

        if (s.stage === 'idle') {
          s.stage = 'awaitingMode';
          s.firstImageArrived = true;
          s.pendingImages.push({ tempPath, originalName: msg.document.file_name || path.basename(tempPath), fileType: 'image' });
          await bot.sendMessage(
            chatId,
            `📸 Got it! Is this:\n\n1️⃣ new — New listing (save files + generate ad)\n2️⃣ update — Fix/replace media for existing product\n3️⃣ ad — Generate marketplace ad only (no file save)\n\nReply: new, update, or ad`
          );
          return;
        }

        if (s.stage === 'awaitingMode') {
          s.pendingImages.push({ tempPath, fileType: 'image' });
          await bot.sendMessage(chatId, `File buffered (${s.pendingImages.length}). Reply new, update, or ad to continue.`);
          return;
        }

        if (s.stage === 'awaitingMeta') {
          s.pendingImages.push({ tempPath, fileType: 'image' });
          await bot.sendMessage(chatId, `Image buffered (${s.pendingImages.length}). Still need Category + Name.`);
          return;
        }

        if (s.stage === 'awaitingUpdateMeta') {
          s.pendingImages.push({ tempPath, fileType: 'image' });
          await bot.sendMessage(chatId, `Image buffered (${s.pendingImages.length}). Still need the product name to update.`);
          return;
        }

        if (s.stage === 'awaitingAdMeta') {
          s.pendingImages.push({ tempPath, fileType: 'image' });
          await bot.sendMessage(chatId, `Image buffered (${s.pendingImages.length}). Still need Category + Name.`);
          return;
        }

        if (s.stage === 'collectingImages') {
          s.pendingImages.push({ tempPath, fileType: 'image' });
          await bot.sendMessage(chatId, `✅ Got it (${s.pendingImages.length} so far). Send more or type "done".`);
          return;
        }

        if (s.stage === 'collectingUpdateImages') {
          s.pendingImages.push({ tempPath, fileType: 'image' });
          await bot.sendMessage(chatId, `✅ Got it (${s.pendingImages.length} so far). Send more or type "done".`);
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
  }

  // Video handler
  if (msg.video) {
    try {
      const tempPath = await downloadTelegramVideoToTemp(msg.video.file_id, chatId);

      if (s.stage === 'idle') {
        s.stage = 'awaitingMode';
        s.firstImageArrived = true;
        s.pendingImages.push({ tempPath, originalName: path.basename(tempPath), fileType: 'video' });
        await bot.sendMessage(
          chatId,
          `🎥 Got it! Is this:\n\n1️⃣ new — New listing (save files + generate ad)\n2️⃣ update — Fix/replace media for existing product\n3️⃣ ad — Generate marketplace ad only (no file save)\n\nReply: new, update, or ad`
        );
        return;
      }

      if (s.stage === 'awaitingMode') {
        s.pendingImages.push({ tempPath, fileType: 'video' });
        await bot.sendMessage(chatId, `File buffered (${s.pendingImages.length}). Reply new or update to continue.`);
        return;
      }

      if (s.stage === 'awaitingMeta') {
        s.pendingImages.push({ tempPath, fileType: 'video' });
        await bot.sendMessage(chatId, `Video buffered (${s.pendingImages.length}). Still need Category + Name.`);
        return;
      }

      if (s.stage === 'awaitingUpdateMeta') {
        s.pendingImages.push({ tempPath, fileType: 'video' });
        await bot.sendMessage(chatId, `Video buffered (${s.pendingImages.length}). Still need the product name to update.`);
        return;
      }

      if (s.stage === 'collectingImages') {
        s.pendingImages.push({ tempPath, fileType: 'video' });
        await bot.sendMessage(chatId, `✅ Got it (${s.pendingImages.length} so far). Send more or type "done".`);
        return;
      }

      if (s.stage === 'collectingUpdateImages') {
        s.pendingImages.push({ tempPath, fileType: 'video' });
        await bot.sendMessage(chatId, `✅ Got it (${s.pendingImages.length} so far). Send more or type "done".`);
        return;
      }

      if (s.stage === 'running') {
        await bot.sendMessage(chatId, `Still working on the last one — hang tight.`);
        return;
      }

    } catch (err) {
      await bot.sendMessage(chatId, `❌ Video download failed:\n${err.message}`);
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
      } else if (lower === 'ad' || lower === '3') {
        s.mode = 'ad';
        s.stage = 'awaitingAdMeta';
        // Run vision immediately so the bot can suggest the product name
        const firstImage = s.pendingImages.find(p => p.fileType === 'image');
        if (VISION_MODEL && firstImage) {
          try {
            await bot.sendMessage(chatId, `🔍 Looking at the image...`);
            const b64 = await imageToBase64(firstImage.tempPath);
            const visionGuess = await ollamaGenerate({
              model: VISION_MODEL,
              prompt: 'In 5 words or less, what product or character is shown in this LED light box? Just name it — no explanation.',
              imagesBase64: [b64],
              options: { num_ctx: 1024, num_predict: 30 },
            });
            s.adVisionDesc = visionGuess;
            s.adVisionGuess = visionGuess.trim();
            await bot.sendMessage(chatId, `Looks like: ${s.adVisionGuess}\n\nWhat do you want to call it? (Just type the name, or "yes" if that's right)`);
          } catch {
            await bot.sendMessage(chatId, `What's this one called?`);
          }
        } else {
          await bot.sendMessage(chatId, `What's this one called?`);
        }
      } else {
        await bot.sendMessage(chatId, `Reply new, update, or ad.`);
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
      if (buffered > 0) {
        await bot.sendMessage(chatId, `✅ Found ${cleanedName} (${normalizedCat})\n\n${buffered} file(s) already buffered. Send more or type "done" to replace.`);
      } else {
        await bot.sendMessage(chatId, `✅ Found ${cleanedName} (${normalizedCat})\n\nSend photos/videos to replace existing ones, then type "done".`);
      }
      return;
    }

    if (s.stage === 'collectingUpdateImages') {
      if (/^(done|run|go)$/i.test(text)) {
        if (s.pendingImages.length < 1) {
          await bot.sendMessage(chatId, `No files yet — send a photo or video first.`);
          return;
        }
        // Require confirmation
        s.stage = 'confirmUpdate';
        await bot.sendMessage(chatId, `⚠️ Ready to replace ALL media in ${s.updateProductName} (${s.updateCategory}) with ${s.pendingImages.length} new file(s).\n\nOld files will be backed up to _backup folder.\n\nType YES to confirm or /cancel to abort.`);
        return;
      }
      await bot.sendMessage(chatId, `${s.pendingImages.length} file(s) buffered. Send more or type "done" to run.`);
      return;
    }

    if (s.stage === 'confirmUpdate') {
      if (text.trim().toUpperCase() === 'YES') {
        await bot.sendMessage(chatId, `Updating with ${s.pendingImages.length} file(s)...`);
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
      if (buffered > 0) {
        await bot.sendMessage(chatId, `✅ ${s.category} / ${s.productName}\n\n${buffered} file(s) already buffered. Send more or type "done" to run.`);
      } else {
        await bot.sendMessage(chatId, `✅ ${s.category} / ${s.productName}\n\nSend photos/videos, then type "done" when ready.`);
      }
      return;
    }

    if (s.stage === 'collectingImages') {
      if (/^(done|run|go)$/i.test(text)) {
        if (s.pendingImages.length < 1) {
          await bot.sendMessage(chatId, `No files yet — send a photo or video first.`);
          return;
        }
        await bot.sendMessage(chatId, `Running with ${s.pendingImages.length} file(s)...`);
        await runWorkflow(chatId);
        return;
      }
      await bot.sendMessage(chatId, `${s.pendingImages.length} file(s) buffered. Send more or type "done" to run.`);
      return;
    }

    if (s.stage === 'awaitingAdMeta') {
      // Accept "yes" to use the vision guess, or anything else as the product name
      const isYes = /^(yes|yep|yeah|yup|y)$/i.test(text.trim());
      const productName = isYes ? (s.adVisionGuess || text.trim()) : text.trim();

      if (!productName) {
        await bot.sendMessage(chatId, `Just type the name for this one.`);
        return;
      }

      s.adProductName = productName;
      s.adCategory = 'General';
      s.stage = 'awaitingAdPlatform';
      await bot.sendMessage(
        chatId,
        `✅ ${productName}\n\nWhich platform?\n\n1️⃣ facebook — Facebook Marketplace\n2️⃣ etsy — Etsy\n3️⃣ ebay — eBay\n\nReply: facebook, etsy, or ebay`
      );
      return;
    }

    if (s.stage === 'awaitingAdPlatform') {
      const lower = text.toLowerCase().trim();
      let platform = null;
      if (lower === 'facebook' || lower === 'fb' || lower === '1') platform = 'facebook';
      else if (lower === 'etsy' || lower === '2') platform = 'etsy';
      else if (lower === 'ebay' || lower === 'e bay' || lower === '3') platform = 'ebay';

      if (!platform) {
        await bot.sendMessage(chatId, `Reply facebook, etsy, or ebay.`);
        return;
      }

      s.adPlatform = platform;
      const platformLabels = { facebook: 'Facebook Marketplace', etsy: 'Etsy', ebay: 'eBay' };
      await bot.sendMessage(chatId, `⏳ Generating ${platformLabels[platform]} ad for ${s.adProductName}...`);
      await runAdWorkflow(chatId);
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