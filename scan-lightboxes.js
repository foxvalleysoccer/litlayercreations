const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUTPUT = path.join(ROOT, "catalog.json");

function isMediaFile(file) {
  return /\.(jpg|jpeg|png|gif|mp4)$/i.test(file);
}

function scanCategory(categoryPath, categoryName) {
  const items = [];

  const files = fs.readdirSync(categoryPath, { withFileTypes: true });

  // Find the actual media folder name (case-insensitive)
  const categoryFiles = fs.readdirSync(categoryPath, { withFileTypes: true });
  const mediaFolder = categoryFiles.find(d => d.isDirectory() && d.name.toLowerCase() === "media");
  const mediaFolderName = mediaFolder ? mediaFolder.name : "media";

  files.forEach(dirent => {
    if (dirent.isFile() && dirent.name.endsWith(".3mf")) {
      const baseName = dirent.name.replace(".3mf", "");

      const mediaDir = path.join(categoryPath, mediaFolderName, baseName);
      let media = [];

      if (fs.existsSync(mediaDir)) {
        media = fs
          .readdirSync(mediaDir)
          .filter(isMediaFile)
          .map(f => path.join(
            categoryName,
            mediaFolderName,
            baseName,
            f
          ).replace(/\\/g, "/"));
      }

      items.push({
        name: baseName,
        file: path.join(categoryName, dirent.name).replace(/\\/g, "/"),
        media
      });
    }
  });

  return items;
}

const catalog = [];

fs.readdirSync(ROOT, { withFileTypes: true }).forEach(dirent => {
  if (dirent.isDirectory()) {
    const categoryName = dirent.name;
    const categoryPath = path.join(ROOT, categoryName);

    // Check for media folder (case-insensitive)
    const hasMediaFolder = fs.readdirSync(categoryPath, { withFileTypes: true })
      .some(d => d.isDirectory() && d.name.toLowerCase() === "media");

    if (hasMediaFolder) {
      const items = scanCategory(categoryPath, categoryName);
      if (items.length) {
        catalog.push({
          category: categoryName,
          items
        });
      }
    }
  }
});

fs.writeFileSync(OUTPUT, JSON.stringify(catalog, null, 2));
console.log("✅ catalog.json generated");
