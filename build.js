/**
 * build.js — Lit Layer Creations static site generator
 *
 * Run: node build.js
 *
 * Generates:
 *   1. index.html          — fully static, all products baked in (no JS fetch needed)
 *   2. products/*.html     — one page per product with full SEO + gallery
 *   3. sitemap.xml         — updated with all product URLs
 */

const fs   = require('fs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const BASE_URL        = 'https://litlayercreations.com';
const FB_PROFILE      = 'https://www.facebook.com/marketplace/profile/208200551/';
const PAYPAL_EMAIL    = 'foxvalleysoccer@gmail.com';
const CASHAPP_TAG     = '$itsmejoshj';
const CASHAPP_URL     = 'https://cash.app/$itsmejoshj';
const WHATSAPP_URL    = '';   // ← add WhatsApp Business short link when ready (wa.me/message/XXXXX)
const PHONE           = '';
const DEFAULT_PRICE   = '30';
const SHIPPING_COST   = '9';
const PRODUCTS_DIR    = path.join(__dirname, 'products');
// ──────────────────────────────────────────────────────────────────────────────

const catalog = JSON.parse(fs.readFileSync('catalog.json', 'utf8'));

if (!fs.existsSync(PRODUCTS_DIR)) fs.mkdirSync(PRODUCTS_DIR);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSlug(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function getSlug(category, name) {
  return `${toSlug(category)}-${toSlug(name)}`;
}

function getProductPath(category, name) {
  return `products/${getSlug(category, name)}.html`;
}

function paypalBuyNowButton(itemName, btnClass) {
  return `<form action="https://www.paypal.com/cgi-bin/webscr" method="post" target="_blank" class="paypal-form">
        <input type="hidden" name="cmd" value="_xclick">
        <input type="hidden" name="business" value="${PAYPAL_EMAIL}">
        <input type="hidden" name="item_name" value="${itemName} LED Light Box">
        <input type="hidden" name="amount" value="${DEFAULT_PRICE}.00">
        <input type="hidden" name="shipping" value="${SHIPPING_COST}.00">
        <input type="hidden" name="currency_code" value="USD">
        <input type="submit" class="${btnClass || 'btn btn-paypal'}" value="🅿️ Buy Now – PayPal">
      </form>`;
}

function featureListHtml() {
  return `<ul class="feature-list">
        <li class="fl-size">📏 About 9" at the largest dimension</li>
        <li class="fl-usb">🔌 USB powered</li>
        <li class="fl-remote">📡 Full remote control</li>
        <li class="fl-sound">🎵 Sound-reactive mode</li>
        <li class="fl-fade">🌈 Smooth fade effects</li>
      </ul>`;
}

function generateDescription(name, category) {
  const cat = category.toLowerCase().replace(/\s+/g, '');
  const suffix = 'About 9 inches at the largest dimension. USB powered with full remote control — color-changing LEDs, sound-reactive mode, and smooth fade effects. Made to order in Neenah, Wisconsin. Ships nationwide.';
  const map = {
    automotive:     `Custom 3D-printed ${name} LED light box. ${suffix}`,
    sports:         `Custom 3D-printed ${name} LED light box. Show your team pride with this handcrafted display. ${suffix}`,
    popculture:     `Custom 3D-printed ${name} LED light box. A unique display piece for fans and collectors. ${suffix}`,
    bands:          `Custom 3D-printed ${name} LED light box. A handcrafted display for music fans. ${suffix}`,
    christmas:      `Custom 3D-printed ${name} LED light box. A festive handcrafted holiday display. ${suffix}`,
    halloween:      `Custom 3D-printed ${name} LED light box. A spooky handcrafted display for Halloween fans. ${suffix}`,
    customrequests: `Custom 3D-printed ${name} LED light box. A one-of-a-kind handcrafted display made to order. ${suffix}`,
  };
  return map[cat] || `Custom 3D-printed ${name} LED light box. ${suffix}`;
}

// Shared CSS used by both index.html and product pages
const sharedStyles = `
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, sans-serif;
    background: #0b1220;
    color: #fff;
    margin: 0;
    padding: 20px;
  }
  header { text-align: center; margin-bottom: 40px; }
  h1 { margin-bottom: 10px; color: #00d4ff; }
  a { color: #00d4ff; }
  .btn {
    background: #00d4ff;
    color: #000;
    border: none;
    padding: 8px 14px;
    border-radius: 5px;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
    font-size: 14px;
    font-weight: bold;
  }
  .btn:hover { background: #0099cc; color: #fff; }
  .btn-cashapp   { background: #00D632; color: #000; }
  .btn-cashapp:hover { background: #00b029; color: #000; }
  .btn-whatsapp  { background: #25D366; color: #000; }
  .btn-whatsapp:hover { background: #1ebe5d; color: #000; }
  .btn-paypal    { background: #0070ba; color: #fff; border: none; font-family: inherit; }
  .btn-paypal:hover { background: #003087; color: #fff; }
  .paypal-form   { display: inline-block; margin: 0; }
  .payment-strip {
    display: flex; flex-wrap: wrap; justify-content: center;
    align-items: center; gap: 10px; margin: 12px 0 4px;
    font-size: 13px; color: #aaa;
  }
  .payment-strip a, .payment-strip span.ps-paypal {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 5px 12px; border-radius: 20px;
    font-weight: bold; font-size: 13px; text-decoration: none;
  }
  .payment-strip .ps-cashapp   { background: #00D632; color: #000; }
  .payment-strip .ps-whatsapp  { background: #25D366; color: #000; }
  .payment-strip .ps-paypal    { background: #003087; color: #fff; }
  .feature-list { list-style: disc; margin: 12px 0; padding-left: 22px; }
  .feature-list li { margin: 6px 0; font-size: 14px; color: #ddd; font-weight: 600; }
  .fl-size::marker   { color: #8ecfff; }
  .fl-usb::marker    { color: #ffd54a; }
  .fl-remote::marker { color: #c792ff; }
  .fl-sound::marker  { color: #ff7ab8; }
  .fl-fade::marker   { color: #47cf73; }
  .fl-fade {
    background: linear-gradient(90deg, #ff5f6d, #ffc371, #47cf73, #2196f3, #9b59b6);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
`;

const catalogStyles = `
  .category { margin-top: 40px; }
  .category h2 {
    border-bottom: 2px solid #00d4ff;
    padding-bottom: 10px;
    cursor: pointer;
    user-select: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .category h2::after { content: '▼'; font-size: 14px; transition: transform 0.3s; }
  .category.collapsed h2::after { transform: rotate(-90deg); }
  .category .items { transition: max-height 0.3s ease-out, opacity 0.3s ease-out; overflow: hidden; }
  .category.collapsed .items { max-height: 0 !important; opacity: 0; margin: 0; }
  .items { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
  .card {
    background: #141c2f;
    border-radius: 10px;
    padding: 15px;
    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
    transition: transform 0.2s;
    display: flex;
    flex-direction: column;
  }
  .card:hover { transform: translateY(-5px); }
  .card h3 { margin: 0 0 8px; color: #00d4ff; }
  .card p { margin: 4px 0; font-size: 14px; flex-grow: 1; }
  .card-footer { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
  .media {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin: 10px 0;
    max-height: 258px;
    overflow: hidden;
  }
  .media.has-more { flex-wrap: nowrap; overflow-x: auto; max-height: none; padding-bottom: 8px; }
  .media.has-more::-webkit-scrollbar { height: 6px; }
  .media.has-more::-webkit-scrollbar-track { background: #0b1220; border-radius: 3px; }
  .media.has-more::-webkit-scrollbar-thumb { background: #00d4ff; border-radius: 3px; }
  .media img, .media video { width: 80px; height: 80px; object-fit: cover; border-radius: 6px; cursor: pointer; flex-shrink: 0; }
`;

const productPageStyles = `
  body { max-width: 1200px; margin: 0 auto; padding: 20px; }
  .back-link { display: inline-block; margin-bottom: 20px; color: #00d4ff; text-decoration: none; }
  .back-link:hover { text-decoration: underline; }
  .breadcrumb { font-size: 13px; margin-bottom: 20px; color: #aaa; }
  .breadcrumb a { color: #00d4ff; text-decoration: none; }
  .breadcrumb span { margin: 0 6px; }
  .product-details { display: flex; gap: 40px; margin-bottom: 40px; flex-wrap: wrap; }
  .media-gallery { flex: 1; min-width: 280px; }
  .main-media-wrap { margin-bottom: 12px; }
  .main-image, .main-video {
    width: 100%;
    max-width: 500px;
    height: auto;
    border-radius: 10px;
    display: block;
  }
  .no-image {
    width: 100%;
    max-width: 500px;
    height: 300px;
    background: #141c2f;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #00d4ff;
    font-size: 18px;
  }
  .thumbnails { display: flex; gap: 8px; flex-wrap: wrap; }
  .thumbnail {
    width: 80px;
    height: 80px;
    object-fit: cover;
    border-radius: 6px;
    cursor: pointer;
    border: 2px solid transparent;
    flex-shrink: 0;
  }
  .thumbnail.active { border-color: #00d4ff; }
  .details { flex: 1; min-width: 280px; }
  .details h2 { color: #00d4ff; margin-top: 0; }
  .details p { line-height: 1.6; }
  .price { font-size: 28px; font-weight: bold; color: #ffcc00; margin: 16px 0; }
  .options { margin: 20px 0; }
  .options label { display: block; margin: 12px 0 4px; color: #aaa; font-size: 14px; }
  .options select {
    padding: 8px 12px;
    background: #141c2f;
    color: #fff;
    border: 1px solid #00d4ff;
    border-radius: 5px;
    width: 200px;
  }
  .cta-buttons { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 24px; }
  .cta-buttons .btn { padding: 12px 20px; font-size: 15px; }
  .shipping-note { font-size: 13px; color: #aaa; margin-top: 16px; }
  @media (max-width: 600px) {
    .product-details { flex-direction: column; }
  }
`;

// ─── Generate individual product page ─────────────────────────────────────────

function generateProductPage(item, category) {
  const slug       = getSlug(category, item.name);
  const pageUrl    = `${BASE_URL}/products/${slug}.html`;
  const description = item.description || generateDescription(item.name, category);
  const catSlug    = toSlug(category);

  const allMedia   = (item.media || []);
  const firstImage = allMedia.find(m => !m.endsWith('.mp4'));
  const ogImage    = firstImage ? `${BASE_URL}/${firstImage}` : `${BASE_URL}/Images/Logo.png`;

  // Build thumbnail HTML
  const thumbsHtml = allMedia.map((src, i) => {
    const isVideo  = src.endsWith('.mp4');
    const fromRoot = `../${src}`;
    const active   = i === 0 ? ' active' : '';
    if (isVideo) {
      return `<video class="thumbnail${active}" src="${fromRoot}" onclick="changeMedia(this, true)" title="${item.name} LED light box video – Lit Layer Creations"></video>`;
    }
    return `<img class="thumbnail${active}" src="${fromRoot}" onclick="changeMedia(this, false)" alt="${item.name} LED light box photo ${i + 1} – Lit Layer Creations" loading="lazy">`;
  }).join('\n      ');

  // Main media element
  let mainMediaHtml;
  if (firstImage) {
    mainMediaHtml = `<img id="main-media" class="main-image" src="../${firstImage}" alt="${item.name} LED light box – custom 3D printed – Lit Layer Creations">`;
  } else if (allMedia.length > 0) {
    mainMediaHtml = `<video id="main-media" class="main-video" controls><source src="../${allMedia[0]}" type="video/mp4"></video>`;
  } else {
    mainMediaHtml = `<div class="no-image">No photo yet — coming soon</div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${item.name} LED Light Box | Custom 3D Printed | Lit Layer Creations</title>
<meta name="description" content="${description}" />
<link rel="canonical" href="${pageUrl}" />

<!-- Open Graph -->
<meta property="og:type" content="product" />
<meta property="og:url" content="${pageUrl}" />
<meta property="og:title" content="${item.name} LED Light Box – Lit Layer Creations" />
<meta property="og:description" content="${description}" />
<meta property="og:image" content="${ogImage}" />
<meta property="og:site_name" content="Lit Layer Creations" />

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${item.name} LED Light Box – Lit Layer Creations" />
<meta name="twitter:description" content="${description}" />
<meta name="twitter:image" content="${ogImage}" />

<!-- Structured Data: Product -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "${item.name} LED Light Box",
  "description": "${description.replace(/"/g, '\\"')}",
  "image": "${ogImage}",
  "brand": { "@type": "Brand", "name": "Lit Layer Creations" },
  "offers": {
    "@type": "Offer",
    "price": "${DEFAULT_PRICE}.00",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock",
    "url": "${pageUrl}",
    "seller": {
      "@type": "LocalBusiness",
      "name": "Lit Layer Creations",
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "Neenah",
        "addressRegion": "WI",
        "addressCountry": "US"
      }
    }
  }
}
</script>

<!-- Breadcrumb -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "${BASE_URL}/" },
    { "@type": "ListItem", "position": 2, "name": "${category}", "item": "${BASE_URL}/#${catSlug}" },
    { "@type": "ListItem", "position": 3, "name": "${item.name} LED Light Box", "item": "${pageUrl}" }
  ]
}
</script>

<style>
${sharedStyles}
${productPageStyles}
</style>
</head>
<body>

<nav class="breadcrumb">
  <a href="../index.html">Home</a>
  <span>›</span>
  <a href="../index.html#${catSlug}">${category}</a>
  <span>›</span>
  ${item.name} LED Light Box
</nav>

<header>
  <a href="../index.html"><img src="../Images/Logo.png" alt="Lit Layer Creations Logo" style="max-width:160px;height:auto;margin-bottom:8px;"></a>
  <h1>Lit Layer Creations</h1>
  <div class="payment-strip">
    <span>💳 We accept:</span>
    <span class="ps-paypal">🅿️ PayPal</span>
    <a href="${CASHAPP_URL}" target="_blank" class="ps-cashapp">💵 Cash App ${CASHAPP_TAG}</a>
  </div>
</header>

<div class="product-details">
  <div class="media-gallery">
    <div class="main-media-wrap">
      ${mainMediaHtml}
    </div>
    <div class="thumbnails">
      ${thumbsHtml}
    </div>
  </div>

  <div class="details">
    <h2>${item.name} LED Light Box</h2>
    <p>${description}</p>
    ${featureListHtml()}
    <div class="price">$${DEFAULT_PRICE}.00 <span style="font-size:14px;color:#aaa;">+ $${SHIPPING_COST} shipping</span></div>

    <div class="cta-buttons">
      ${paypalBuyNowButton(item.name)}
      <a href="${CASHAPP_URL}" target="_blank" class="btn btn-cashapp">💵 Pay with Cash App</a>
    </div>

    <p class="shipping-note">
      Local pickup available in Neenah, WI · Ships nationwide
    </p>
  </div>
</div>

<script>
function changeMedia(thumb, isVideo) {
  const wrap = document.querySelector('.main-media-wrap');
  if (isVideo) {
    wrap.innerHTML = '<video id="main-media" class="main-video" controls autoplay><source src="' + thumb.src + '" type="video/mp4"></video>';
  } else {
    wrap.innerHTML = '<img id="main-media" class="main-image" src="' + thumb.src + '" alt="${item.name} LED light box – Lit Layer Creations">';
  }
  document.querySelectorAll('.thumbnail').forEach(t => t.classList.remove('active'));
  thumb.classList.add('active');
}
</script>

</body>
</html>`;
}

// ─── Generate static index.html ───────────────────────────────────────────────

function generateIndex() {
  let catalogHtml = '';

  catalog.forEach(cat => {
    if (['Old Labels'].includes(cat.category)) return; // internal — skip entirely
    const catSlug = toSlug(cat.category);
    let itemsHtml = '';

    cat.items.filter(item => (item.media || []).some(m => !m.endsWith('.mp4'))).forEach(item => {
      const productPath = getProductPath(cat.category, item.name);
      const description = item.description || generateDescription(item.name, cat.category);
      const allMedia = (item.media || []);
      const maxVisible = 9;
      const hasMore = allMedia.length > maxVisible;
      const mediaClass = hasMore ? 'media has-more' : 'media';

      let mediaHtml = '';
      allMedia.forEach((src, index) => {
        if (!hasMore && index >= maxVisible) return;
        if (src.endsWith('.mp4')) {
          mediaHtml += `\n          <video src="${src}" controls title="${item.name} LED light box – Lit Layer Creations"></video>`;
        } else {
          mediaHtml += `\n          <img src="${src}" alt="${item.name} LED light box – custom 3D printed – Lit Layer Creations" onclick="window.open('${src}','_blank')" loading="lazy">`;
        }
      });

      itemsHtml += `
      <div class="card">
        <h3>${item.name}</h3>
        <p>${description}</p>
        ${featureListHtml()}
        <div class="${mediaClass}">${mediaHtml}
        </div>
        <div class="card-footer">
          <a href="${productPath}" class="btn">View Details</a>
          ${paypalBuyNowButton(item.name, 'btn btn-paypal')}
        </div>
      </div>`;
    });

    catalogHtml += `
  <section class="category" id="${catSlug}">
    <h2>${cat.category}</h2>
    <div class="items">${itemsHtml}
    </div>
  </section>`;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-Z2NFK2Z8Q3"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-Z2NFK2Z8Q3');
  </script>

  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Custom LED Light Boxes | Automotive, Sports &amp; Pop Culture | Lit Layer Creations – Neenah, WI</title>
  <meta name="description" content="Custom 3D-printed LED light boxes for cars, sports teams, and pop culture. Ghostbusters, Milwaukee Bucks, Corvette, Batman, and 150+ more designs. Made to order in Neenah, Wisconsin. Starting at $${DEFAULT_PRICE}." />
  <meta name="keywords" content="custom LED light box, 3D printed light box, custom neon sign, Milwaukee Bucks light, Ghostbusters LED light, Corvette light box, custom car light, Neenah Wisconsin, Lit Layer Creations" />
  <link rel="canonical" href="${BASE_URL}/" />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${BASE_URL}/" />
  <meta property="og:title" content="Lit Layer Creations – Custom 3D Printed LED Light Boxes" />
  <meta property="og:description" content="Custom LED light boxes for cars, sports teams, and pop culture. 150+ designs. Made to order in Neenah, WI. Starting at $${DEFAULT_PRICE}." />
  <meta property="og:image" content="${BASE_URL}/Images/Logo.png" />
  <meta property="og:site_name" content="Lit Layer Creations" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Lit Layer Creations – Custom 3D Printed LED Light Boxes" />
  <meta name="twitter:description" content="Custom LED light boxes for cars, sports teams, and pop culture. 150+ designs. Made to order in Neenah, WI." />
  <meta name="twitter:image" content="${BASE_URL}/Images/Logo.png" />

  <!-- Structured Data: Local Business -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "Lit Layer Creations",
    "description": "Custom 3D-printed LED light boxes for automotive, sports, and pop culture themes. Made to order in Neenah, Wisconsin. Ships nationwide.",
    "url": "${BASE_URL}",
    "image": "${BASE_URL}/Images/Logo.png",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Neenah",
      "addressRegion": "WI",
      "addressCountry": "US"
    },
    "priceRange": "$${DEFAULT_PRICE}–$65",
    "currenciesAccepted": "USD",
    "paymentAccepted": "PayPal, Cash App",
    "areaServed": "US",
    "sameAs": ["${FB_PROFILE}"]
  }
  </script>

  <style>
${sharedStyles}
${catalogStyles}
  </style>
</head>
<body>

<header>
  <img src="Images/Logo.png" alt="Lit Layer Creations Logo" style="max-width:200px;height:auto;margin-bottom:10px;">
  <h1>Lit Layer Creations</h1>
  <p>Custom 3D Printed LED Light Boxes · Neenah, WI · Ships Nationwide</p>
  <div class="payment-strip">
    <span>💳 We accept:</span>
    <span class="ps-paypal">🅿️ PayPal</span>
    <a href="${CASHAPP_URL}" target="_blank" class="ps-cashapp">💵 Cash App ${CASHAPP_TAG}</a>
  </div>
</header>

<div id="catalog">
${catalogHtml}
</div>

<script>
  // Category collapse/expand
  document.querySelectorAll('.category h2').forEach(h2 => {
    h2.addEventListener('click', () => {
      h2.closest('.category').classList.toggle('collapsed');
    });
  });
</script>

</body>
</html>`;
}

// ─── Generate sitemap.xml ─────────────────────────────────────────────────────

function generateSitemap(productSlugs) {
  const today = new Date().toISOString().split('T')[0];
  let urls = `  <url>
    <loc>${BASE_URL}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>\n`;

  productSlugs.forEach(({ category, name }) => {
    const slug = getSlug(category, name);
    urls += `  <url>
    <loc>${BASE_URL}/products/${slug}.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>\n`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}</urlset>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('Building Lit Layer Creations...\n');

const productSlugs = [];
let pageCount = 0;
let skippedCount = 0;

// Generate product pages
catalog.forEach(cat => {
  // Skip utility/internal categories from getting public pages
  const skip = ['Old Labels'].includes(cat.category);

  cat.items.filter(item => (item.media || []).some(m => !m.endsWith('.mp4'))).forEach(item => {
    productSlugs.push({ category: cat.category, name: item.name });

    if (!skip) {
      const html     = generateProductPage(item, cat.category);
      const slug     = getSlug(cat.category, item.name);
      const filePath = path.join(PRODUCTS_DIR, `${slug}.html`);
      fs.writeFileSync(filePath, html, 'utf8');
      pageCount++;
    } else {
      skippedCount++;
    }
  });
});

console.log(`✅ Generated ${pageCount} product pages (${skippedCount} internal items skipped)`);

// Generate index.html
const indexHtml = generateIndex();
fs.writeFileSync(path.join(__dirname, 'index.html'), indexHtml, 'utf8');
console.log('✅ Generated index.html (fully static, no JS fetch)');

// Generate sitemap.xml
const sitemapXml = generateSitemap(productSlugs.filter(p =>
  !['Old Labels'].includes(p.category)
));
fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), sitemapXml, 'utf8');
console.log('✅ Generated sitemap.xml');

console.log(`\n🚀 Done! ${pageCount + 1} pages total (${pageCount} products + 1 index)`);
console.log('   Run: git add -A && git commit && git push\n');
