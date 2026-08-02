import { readFile, writeFile } from "node:fs/promises";

const sourcePath = process.argv[2];
const targetPath = process.argv[3] ?? "app/geo-data.ts";

if (!sourcePath) {
  throw new Error("Pass the source towns.csv path as the first argument.");
}

const districtNames = {
  "Центральный": "Центральный федеральный округ",
  "Северо-Западный": "Северо-Западный федеральный округ",
  "Южный": "Южный федеральный округ",
  "Северо-Кавказский": "Северо-Кавказский федеральный округ",
  "Приволжский": "Приволжский федеральный округ",
  "Уральский": "Уральский федеральный округ",
  "Сибирский": "Сибирский федеральный округ",
  "Дальневосточный": "Дальневосточный федеральный округ",
};

const districtOrder = Object.values(districtNames);
const rows = (await readFile(sourcePath, "utf8")).trim().split(/\r?\n/).slice(1);
const tree = new Map();

for (const row of rows) {
  const columns = row.split(",");
  const city = columns[0]?.trim();
  const region = (columns[5] || columns[4])?.trim();
  const district = districtNames[columns[7]?.trim()];
  if (!city || !region || !district) continue;

  if (!tree.has(district)) tree.set(district, new Map());
  const regions = tree.get(district);
  if (!regions.has(region)) regions.set(region, new Set());
  regions.get(region).add(city);
}

const collator = new Intl.Collator("ru");
const data = districtOrder
  .filter((district) => tree.has(district))
  .map((district) => ({
    name: district,
    regions: [...tree.get(district).entries()]
      .map(([name, cities]) => ({ name, cities: [...cities].sort(collator.compare) }))
      .sort((left, right) => collator.compare(left.name, right.name)),
  }));

const output = `// Generated from the Rosstat-based ru-cities dataset.\n// Regenerate with: node scripts/generate-geo-data.mjs <towns.csv> app/geo-data.ts\n\nexport type GeoRegionOption = {\n  name: string;\n  cities: string[];\n};\n\nexport type GeoDistrictOption = {\n  name: string;\n  regions: GeoRegionOption[];\n};\n\nexport const russianGeoTree: GeoDistrictOption[] = ${JSON.stringify(data, null, 2)};\n`;

await writeFile(targetPath, output, "utf8");
