const fs = require('fs');
const path = require('path');

const BASE = 'https://www.litlayercreations.com';
const CANONICAL_HOST = 'litlayercreations.com';
const MAX_PAGES = 1200;
const CONCURRENCY = 8;

function absolutize(value, pageUrl) {
  try {
    return new URL(value, pageUrl).href;
  } catch {
    return null;
  }
}

function sameSite(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'www.litlayercreations.com' || parsed.hostname === 'litlayercreations.com';
  } catch {
    return false;
  }
}

function cleanUrl(url) {
  const parsed = new URL(url);
  if (sameSite(parsed.href)) parsed.hostname = CANONICAL_HOST;
  parsed.hash = '';
  return parsed.href;
}

function textOfTag(html, tagRegex) {
  const match = html.match(tagRegex);
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

function attrValues(html, tag, attr) {
  const values = [];
  const tagRegex = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  for (const tagMatch of html.matchAll(tagRegex)) {
    const attrRegex = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i');
    const attrMatch = tagMatch[0].match(attrRegex);
    if (attrMatch) values.push(attrMatch[1]);
  }
  return values;
}

async function fetchStatus(url) {
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (res.status === 405 || res.status === 403) {
      res = await fetch(url, { method: 'GET', redirect: 'follow' });
    }
    return {
      url,
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      finalUrl: res.url
    };
  } catch (error) {
    return { url, ok: false, status: 0, error: error.message, contentType: '', finalUrl: '' };
  }
}

async function getHtml(url) {
  const res = await fetch(url, { redirect: 'follow' });
  const html = await res.text();
  return { res, html };
}

async function runLimited(items, worker) {
  const results = [];
  let index = 0;
  async function next() {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, next));
  return results;
}

async function sitemapUrls() {
  const candidates = [`${BASE}/sitemap.xml`, 'https://litlayercreations.com/sitemap.xml'];
  for (const url of candidates) {
    try {
      const { res, html } = await getHtml(url);
      if (!res.ok) continue;
      const urls = [...html.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(match => cleanUrl(match[1]));
      if (urls.length) return [...new Set([BASE + '/', ...urls])];
    } catch {
      // try next candidate
    }
  }
  return [BASE + '/'];
}

async function main() {
  const queue = (await sitemapUrls()).slice(0, MAX_PAGES);
  const queued = new Set(queue);
  const pageResults = [];
  const assetUrls = new Map();
  const linkRefs = new Map();

  for (let i = 0; i < queue.length && i < MAX_PAGES; i++) {
    const pageUrl = queue[i];
    try {
      const { res, html } = await getHtml(pageUrl);
      const title = textOfTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
      const description = textOfTag(html, /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
        || textOfTag(html, /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
      const canonical = textOfTag(html, /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i);
      const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(match => match[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
      const images = attrValues(html, 'img', 'src').map(src => absolutize(src, pageUrl)).filter(Boolean);
      const anchors = attrValues(html, 'a', 'href').map(href => absolutize(href, pageUrl)).filter(Boolean);
      const videos = attrValues(html, 'source', 'src').concat(attrValues(html, 'video', 'src')).map(src => absolutize(src, pageUrl)).filter(Boolean);

      pageResults.push({
        url: pageUrl,
        ok: res.ok,
        status: res.status,
        title,
        description,
        canonical,
        h1s,
        imageCount: images.length,
        videoCount: videos.length,
        linkCount: anchors.length
      });

      for (const asset of images.concat(videos)) {
        if (!assetUrls.has(asset)) assetUrls.set(asset, new Set());
        assetUrls.get(asset).add(pageUrl);
      }

      for (const link of anchors) {
        if (link.startsWith('mailto:') || link.startsWith('tel:') || link.startsWith('sms:')) continue;
        if (!linkRefs.has(link)) linkRefs.set(link, new Set());
        linkRefs.get(link).add(pageUrl);
        if (sameSite(link)) {
          const cleaned = cleanUrl(link);
          if (!queued.has(cleaned) && queue.length < MAX_PAGES) {
            queued.add(cleaned);
            queue.push(cleaned);
          }
        }
      }
    } catch (error) {
      pageResults.push({ url: pageUrl, ok: false, status: 0, error: error.message, title: '', description: '', h1s: [], imageCount: 0, videoCount: 0, linkCount: 0 });
    }
  }

  const internalLinks = [...linkRefs.keys()].filter(sameSite).map(cleanUrl);
  const externalLinks = [...linkRefs.keys()].filter(url => !sameSite(url) && /^https?:\/\//i.test(url));
  const internalStatuses = await runLimited([...new Set(internalLinks)], fetchStatus);
  const externalStatuses = await runLimited([...new Set(externalLinks)], fetchStatus);
  const assetStatuses = await runLimited([...assetUrls.keys()], fetchStatus);

  const titleGroups = {};
  const descGroups = {};
  for (const page of pageResults) {
    if (page.title) (titleGroups[page.title] ||= []).push(page.url);
    if (page.description) (descGroups[page.description] ||= []).push(page.url);
  }

  const productPages = pageResults.filter(page => /\/products\//.test(page.url));
  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    crawledPages: pageResults.length,
    productPages: productPages.length,
    brokenInternalLinks: internalStatuses.filter(item => !item.ok),
    brokenExternalLinks: externalStatuses.filter(item => !item.ok),
    brokenAssets: assetStatuses.filter(item => !item.ok),
    pagesWithoutTitle: pageResults.filter(page => !page.title).map(page => page.url),
    pagesWithoutDescription: pageResults.filter(page => !page.description).map(page => page.url),
    pagesWithShortDescriptions: pageResults.filter(page => page.description && page.description.length < 80).map(page => ({ url: page.url, description: page.description })),
    pagesWithMultipleH1: pageResults.filter(page => page.h1s.length !== 1).map(page => ({ url: page.url, h1s: page.h1s })),
    duplicateTitles: Object.entries(titleGroups).filter(([, urls]) => urls.length > 1).map(([title, urls]) => ({ title, urls })),
    duplicateDescriptions: Object.entries(descGroups).filter(([, urls]) => urls.length > 1).map(([description, urls]) => ({ description, urls })),
    productPagesWithNoImages: productPages.filter(page => page.imageCount === 0).map(page => page.url),
    productPagesWithOneImage: productPages.filter(page => page.imageCount === 1).map(page => page.url),
    pageResults
  };

  fs.writeFileSync(path.join(__dirname, 'live-site-audit.json'), JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    crawledPages: report.crawledPages,
    productPages: report.productPages,
    brokenInternalLinks: report.brokenInternalLinks.length,
    brokenExternalLinks: report.brokenExternalLinks.length,
    brokenAssets: report.brokenAssets.length,
    pagesWithoutTitle: report.pagesWithoutTitle.length,
    pagesWithoutDescription: report.pagesWithoutDescription.length,
    duplicateTitles: report.duplicateTitles.length,
    duplicateDescriptions: report.duplicateDescriptions.length,
    productPagesWithNoImages: report.productPagesWithNoImages.length,
    productPagesWithOneImage: report.productPagesWithOneImage.length
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
