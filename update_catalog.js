const fs = require('fs');
const path = require('path');

const BASE = __dirname;
const catalogPath = path.join(BASE, 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

// Media to inject: { category, name, media[] }
const updates = [
  {
    category: "Automotive", name: "Mitsubishi",
    media: [
      "Automotive/media/Mitsubishi/mitsubishi_light_front_1.jpg",
      "Automotive/media/Mitsubishi/mitsubishi_light_front_2.jpg",
      "Automotive/media/Mitsubishi/mitsubishi_light_front_3.jpg",
      "Automotive/media/Mitsubishi/mitsubishi_light_back.jpg"
    ]
  },
  {
    category: "Bands", name: "America",
    media: [
      "Bands/media/America/america_front_1.jpg",
      "Bands/media/America/america_front_2.jpg",
      "Bands/media/America/america_front_3.jpg",
      "Bands/media/America/america_angle_1.jpg",
      "Bands/media/America/america_back.jpg"
    ]
  },
  {
    category: "Old Labels", name: "Cobra CB",
    media: [
      "Old Labels/media/Cobra CB/cobra_cb_front_1.jpg"
    ]
  },
  {
    category: "Pop Culture", name: "BillyClownSaw",
    media: [
      "Pop Culture/media/BillyClownSaw/clown_front_1.jpg",
      "Pop Culture/media/BillyClownSaw/clown_front_2.jpg",
      "Pop Culture/media/BillyClownSaw/clown_angle_1.jpg",
      "Pop Culture/media/BillyClownSaw/clown_unlit.jpg",
      "Pop Culture/media/BillyClownSaw/clown_back.jpg"
    ]
  },
  {
    category: "Pop Culture", name: "Golden Axe Light Box",
    media: [
      "Pop Culture/media/Golden Axe Light Box/golden_axe_front_1.jpg",
      "Pop Culture/media/Golden Axe Light Box/golden_axe_front_2.jpg",
      "Pop Culture/media/Golden Axe Light Box/golden_axe_angle_1.jpg",
      "Pop Culture/media/Golden Axe Light Box/golden_axe_back.jpg"
    ]
  },
  {
    category: "Pop Culture", name: "GuyFawkes",
    media: [
      "Pop Culture/media/GuyFawkes/guyfawkes_front_1.jpg",
      "Pop Culture/media/GuyFawkes/guyfawkes_front_2.jpg",
      "Pop Culture/media/GuyFawkes/guyfawkes_front_3.jpg",
      "Pop Culture/media/GuyFawkes/guyfawkes_angle_1.jpg",
      "Pop Culture/media/GuyFawkes/guyfawkes_back.jpg"
    ]
  },
  {
    category: "Pop Culture", name: "Jurassic Park (1)",
    media: [
      "Pop Culture/media/Jurassic Park (1)/jurassic_park_front_1.jpg",
      "Pop Culture/media/Jurassic Park (1)/jurassic_park_front_2.jpg",
      "Pop Culture/media/Jurassic Park (1)/jurassic_park_angle_1.jpg",
      "Pop Culture/media/Jurassic Park (1)/jurassic_park_back.jpg"
    ]
  },
  {
    category: "Pop Culture", name: "Kerby",
    media: [
      "Pop Culture/media/Kerby/kirby_front_1.jpg",
      "Pop Culture/media/Kerby/kirby_front_2.jpg",
      "Pop Culture/media/Kerby/kirby_angle_1.jpg",
      "Pop Culture/media/Kerby/kirby_back.jpg"
    ]
  },
  {
    category: "Pop Culture", name: "Metal Gear Solid Light Box",
    media: [
      "Pop Culture/media/Metal Gear Solid Light Box/metal_gear_front_1.jpg",
      "Pop Culture/media/Metal Gear Solid Light Box/metal_gear_angle_1.jpg",
      "Pop Culture/media/Metal Gear Solid Light Box/metal_gear_angle_2.jpg",
      "Pop Culture/media/Metal Gear Solid Light Box/metal_gear_back.jpg"
    ]
  },
  {
    category: "Pop Culture", name: "Mini Trucking",
    media: [
      "Pop Culture/media/Mini Trucking/mini_trucking_front_1.jpg",
      "Pop Culture/media/Mini Trucking/mini_trucking_front_2.jpg",
      "Pop Culture/media/Mini Trucking/mini_trucking_angle_1.jpg",
      "Pop Culture/media/Mini Trucking/mini_trucking_back.jpg"
    ]
  },
  {
    category: "Pop Culture", name: "Spiderman Face",
    media: [
      "Pop Culture/media/Spiderman Face/spiderman_face_front_1.jpg",
      "Pop Culture/media/Spiderman Face/spiderman_face_front_2.jpg",
      "Pop Culture/media/Spiderman Face/spiderman_face_angle_1.jpg",
      "Pop Culture/media/Spiderman Face/spiderman_face_back.jpg"
    ]
  },
  {
    category: "Pop Culture", name: "Stranger Things",
    media: [
      "Pop Culture/media/Stranger Things/stranger_things_front_1.jpg",
      "Pop Culture/media/Stranger Things/stranger_things_front_2.jpg",
      "Pop Culture/media/Stranger Things/stranger_things_angle_1.jpg",
      "Pop Culture/media/Stranger Things/stranger_things_angle_2.jpg",
      "Pop Culture/media/Stranger Things/stranger_things_back.jpg"
    ]
  },
  {
    category: "Pop Culture", name: "Streets Of Rage Light Box",
    media: [
      "Pop Culture/media/Streets Of Rage Light Box/streets_of_rage_front_1.jpg",
      "Pop Culture/media/Streets Of Rage Light Box/streets_of_rage_front_2.jpg",
      "Pop Culture/media/Streets Of Rage Light Box/streets_of_rage_angle_1.jpg",
      "Pop Culture/media/Streets Of Rage Light Box/streets_of_rage_angle_2.jpg",
      "Pop Culture/media/Streets Of Rage Light Box/streets_of_rage_back.jpg"
    ]
  },
  {
    category: "Pop Culture", name: "Thefast And The Furious Light",
    media: [
      "Pop Culture/media/Thefast And The Furious Light/fast_furious_front_1.jpg",
      "Pop Culture/media/Thefast And The Furious Light/fast_furious_front_2.jpg",
      "Pop Culture/media/Thefast And The Furious Light/fast_furious_front_3.jpg",
      "Pop Culture/media/Thefast And The Furious Light/fast_furious_angle_1.jpg",
      "Pop Culture/media/Thefast And The Furious Light/fast_furious_back.jpg"
    ]
  },
  {
    category: "Sports", name: "Titleist",
    media: [
      "Sports/Media/Titleist/titleist_front_1.jpg",
      "Sports/Media/Titleist/titleist_angle_1.jpg",
      "Sports/Media/Titleist/titleist_angle_2.jpg",
      "Sports/Media/Titleist/titleist_back.jpg"
    ]
  }
];

let updatedCount = 0;
let notFound = [];

for (const update of updates) {
  const cat = catalog.find(c => c.category === update.category);
  if (!cat) { notFound.push(update.category + '/' + update.name + ' (category missing)'); continue; }
  const item = cat.items.find(i => i.name === update.name);
  if (!item) { notFound.push(update.category + '/' + update.name + ' (item missing)'); continue; }
  item.media = update.media;
  updatedCount++;
  console.log('✅ Updated: ' + update.category + ' / ' + update.name + ' (' + update.media.length + ' files)');
}

if (notFound.length) {
  console.log('\n❌ Not found in catalog:');
  notFound.forEach(n => console.log('  ' + n));
}

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
console.log('\n✅ catalog.json saved. ' + updatedCount + ' items updated.');
