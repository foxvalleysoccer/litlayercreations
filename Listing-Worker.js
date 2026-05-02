// listing-worker.js
// Lit Layer Creations — Auto Listing Draft Generator
//
// Watches D:\ClaudeCowork\listing_queue.json for new listing requests
// written by the morning briefing task, then calls Ollama (using the
// same models and prompts as telegram-bot.js) to generate eBay,
// Facebook Marketplace, and Etsy drafts for each item.
//
// Drafts are saved to:
//   D:\ClaudeCowork\listing-drafts\YYYY-MM-DD\ProductName\
//     ProductName-ebay.txt
//     ProductName-facebook.txt
//     ProductName-etsy.txt
//
// Run alongside telegram-bot.js (separate terminal):
//   node listing-worker.js
//
// Required env vars (same as telegram-bot.js):
//   TELEGRAM_BOT_TOKEN   — used to send you a Telegram notification when drafts are ready
//   TELEGRAM_CHAT_ID     — your personal Telegram chat ID (get it from @userinfobot)
//
// Optional env vars:
//   OLLAMA_HOST              — default: http://127.0.0.1:11434
//   OLLAMA_LISTING_MODEL     — default: deepseek-v3.1:671b-cloud
//   COWORK_DIR               — default: C:\Users\josh\shared\ClaudeCowork (or auto-detected)
//   POLL_INTERVAL_MS         — how often to check for queue file, default: 30000 (30s)

'use strict';

const axios  = require('axios');
const fs     = require('fs');
const fsp    = fs.promises;
const path   = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const OLLAMA_HOST     = process.env.OLLAMA_HOST          || 'http://127.0.0.1:11434';
const LISTING_MODEL   = process.env.OLLAMA_LISTING_MODEL || 'deepseek-v3.1:671b-cloud';
const BOT_TOKEN       = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID         = process.env.TELEGRAM_CHAT_ID;
const POLL_MS         = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10);

// Resolve the ClaudeCowork folder — try env var first, then common locations
function resolveCoworkDir() {
  if (process.env.COWORK_DIR) return process.env.COWORK_DIR;
  const candidates = [
    'C:\\Users\\josh\\Desktop\\ClaudeCowork',
    'C:\\ClaudeCowork',
    'D:\\ClaudeCowork',
    path.join(process.env.USERPROFILE || 'C:\\Users\\josh', 'ClaudeCowork'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Fall back to first candidate and let mkdir handle it
  return candidates[0];
}

const COWORK_DIR   = resolveCoworkDir();
const QUEUE_FILE   = path.join(COWORK_DIR, 'listing_queue.json');
const DRAFTS_DIR   = path.join(COWORK_DIR, 'listing-drafts');
const ARCHIVE_DIR  = path.join(COWORK_DIR, 'listing-drafts', '_archive');

// ── Ollama ────────────────────────────────────────────────────────────────────

async function ollamaGenerate({ prompt, options = {} }) {
  const body = { model: LISTING_MODEL, prompt, stream: false, options };
  const res  = await axios.post(`${OLLAMA_HOST}/api/generate`, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 0,
  });
  if (!res.data || typeof res.data.response !== 'string') {
    throw new Error(`Unexpected Ollama response: ${JSON.stringify(res.data).slice(0, 300)}`);
  }
  return res.data.response.trim();
}

// ── Listing Prompts (identical to telegram-bot.js) ────────────────────────────

function buildListingPrompt({ productName, category, platform, visionDesc = '' }) {
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

// ── Telegram Notification ─────────────────────────────────────────────────────

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
    });
  } catch (err) {
    console.warn('[notify] Telegram send failed:', err.message);
  }
}

// ── Queue Processing ──────────────────────────────────────────────────────────

async function processQueue(queueData) {
  const { items = [], date = new Date().toISOString().slice(0, 10) } = queueData;

  if (items.length === 0) {
    console.log('[worker] Queue is empty — nothing to do.');
    return;
  }

  const dateStr   = new Date().toISOString().slice(0, 10);
  const outputDir = path.join(DRAFTS_DIR, dateStr);
  await fsp.mkdir(outputDir, { recursive: true });

  const results = [];

  for (const item of items) {
    const { productName, category, platforms = ['ebay', 'facebook', 'etsy'], reason = '' } = item;

    if (!productName || !category) {
      console.warn('[worker] Skipping item missing productName or category:', item);
      continue;
    }

    console.log(`\n[worker] Generating listings for: ${productName} (${category})`);
    if (reason) console.log(`         Reason: ${reason}`);

    // Make a safe folder name
    const safeName  = productName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, '_');
    const itemDir   = path.join(outputDir, safeName);
    await fsp.mkdir(itemDir, { recursive: true });

    const generated = [];

    for (const platform of platforms) {
      const label = { ebay: 'eBay', facebook: 'Facebook Marketplace', etsy: 'Etsy' }[platform] || platform;
      console.log(`  → Writing ${label} listing...`);

      try {
        const prompt  = buildListingPrompt({ productName, category, platform });
        const listing = await ollamaGenerate({
          prompt,
          options: { num_ctx: 2048, num_predict: 600 },
        });

        const fileName = `${safeName}-${platform}.txt`;
        const filePath = path.join(itemDir, fileName);
        const header   = `# ${productName} — ${label} Listing Draft\n# Generated: ${new Date().toLocaleString()}\n# Reason: ${reason || 'Morning briefing recommendation'}\n\n`;
        await fsp.writeFile(filePath, header + listing, 'utf8');

        console.log(`     ✅ Saved: ${fileName}`);
        generated.push({ platform: label, file: filePath });

      } catch (err) {
        console.error(`     ❌ Failed for ${label}:`, err.message);
        generated.push({ platform: label, error: err.message });
      }
    }

    results.push({ productName, category, reason, generated });
  }

  // Write a summary index file
  const summaryPath = path.join(outputDir, '_summary.txt');
  let summary = `Listing Drafts — ${dateStr}\nGenerated by listing-worker.js\n${'─'.repeat(50)}\n\n`;
  for (const r of results) {
    summary += `📦 ${r.productName} (${r.category})\n`;
    if (r.reason) summary += `   Why: ${r.reason}\n`;
    for (const g of r.generated) {
      summary += g.error
        ? `   ❌ ${g.platform}: ERROR — ${g.error}\n`
        : `   ✅ ${g.platform}: ${path.basename(g.file)}\n`;
    }
    summary += '\n';
  }
  await fsp.writeFile(summaryPath, summary, 'utf8');

  // Send Telegram notification
  const successCount = results.reduce((n, r) => n + r.generated.filter(g => !g.error).length, 0);
  const tgLines = results.map(r => `• <b>${r.productName}</b> — eBay, Facebook, Etsy`).join('\n');
  await sendTelegram(
    `🖊️ <b>Listing drafts ready!</b>\n\n` +
    `${tgLines}\n\n` +
    `${successCount} draft${successCount !== 1 ? 's' : ''} saved to:\n` +
    `<code>D:\\ClaudeCowork\\listing-drafts\\${dateStr}\\</code>\n\n` +
    `Review and post when your prints are done.`
  );

  console.log(`\n[worker] Done. ${successCount} drafts saved to: ${outputDir}`);
  return results;
}

// ── Queue File Watcher ────────────────────────────────────────────────────────

let lastQueueMtime = 0;
let processing     = false;

async function checkAndProcess() {
  if (processing) return;

  try {
    const stat = await fsp.stat(QUEUE_FILE);
    if (stat.mtimeMs <= lastQueueMtime) return; // Not changed since last check

    processing     = true;
    lastQueueMtime = stat.mtimeMs;

    console.log(`\n[worker] Queue file changed — reading ${QUEUE_FILE}`);
    const raw   = await fsp.readFile(QUEUE_FILE, 'utf8');
    const queue = JSON.parse(raw);

    // Archive the queue file before processing so we don't double-process on restart
    await fsp.mkdir(ARCHIVE_DIR, { recursive: true });
    const archiveName = `listing_queue_${Date.now()}.json`;
    await fsp.copyFile(QUEUE_FILE, path.join(ARCHIVE_DIR, archiveName));
    await fsp.unlink(QUEUE_FILE);
    console.log(`[worker] Queue archived as: ${archiveName}`);

    await processQueue(queue);

  } catch (err) {
    if (err.code !== 'ENOENT') {
      // ENOENT = file doesn't exist yet, which is normal
      console.error('[worker] Error:', err.message);
    }
  } finally {
    processing = false;
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   Lit Layer Creations — Listing Worker        ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`Watching:  ${QUEUE_FILE}`);
  console.log(`Drafts to: ${DRAFTS_DIR}`);
  console.log(`Ollama:    ${OLLAMA_HOST} (${LISTING_MODEL})`);
  console.log(`Telegram:  ${BOT_TOKEN ? '✅ notifications enabled' : '⚠️  no TELEGRAM_BOT_TOKEN set — notifications off'}`);
  if (BOT_TOKEN && !CHAT_ID) {
    console.warn('           ⚠️  TELEGRAM_CHAT_ID not set — get your ID from @userinfobot on Telegram');
  }
  console.log(`Poll:      every ${POLL_MS / 1000}s\n`);

  // Ensure output dirs exist
  await fsp.mkdir(DRAFTS_DIR,  { recursive: true });
  await fsp.mkdir(ARCHIVE_DIR, { recursive: true });

  // Check immediately on startup (in case queue was dropped while we were off)
  await checkAndProcess();

  // Then poll on interval
  setInterval(checkAndProcess, POLL_MS);
  console.log('[worker] Running. Press Ctrl+C to stop.\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});