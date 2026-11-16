'use strict';

// Keeps the version the same in every file that carries it.
//   node scripts/versions.js check   → fails if the versions differ (used by CI)
//   node scripts/versions.js sync    → sets VERSION everywhere and adds CHANGELOG to CHANGELOG.md
//                                      (used by the Release workflow; env VERSION, CHANGELOG)

const fs = require('fs');

const FILES = ['.homeycompose/app.json', 'app.json', 'package.json'];
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));

const mode = process.argv[2];

if (mode === 'check') {
  const versions = Object.fromEntries(FILES.map(f => [f, readJson(f).version]));
  const unique = new Set(Object.values(versions));
  if (unique.size !== 1) {
    console.error('Versions differ:', versions);
    process.exit(1);
  }
  const [version] = unique;
  if (!fs.readFileSync('CHANGELOG.md', 'utf8').includes(`## ${version}\n`)) {
    console.error(`CHANGELOG.md has no "## ${version}" section`);
    process.exit(1);
  }
  console.log(`All versions are ${version}`);
} else if (mode === 'sync') {
  const version = process.env.VERSION;
  const note = (process.env.CHANGELOG || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error(`Not a version: "${version}"`);
  for (const f of FILES) {
    if (readJson(f).version === version) continue;
    // Replace only the top-level "version" line, so the rest of the file keeps its formatting
    const text = fs.readFileSync(f, 'utf8');
    const updated = text.replace(/^(\s{2}"version"\s*:\s*")[^"]*(")/m, `$1${version}$2`);
    if (updated === text) throw new Error(`No "version" line found in ${f}`);
    fs.writeFileSync(f, updated);
  }
  let md = fs.readFileSync('CHANGELOG.md', 'utf8');
  if (!md.includes(`## ${version}\n`)) {
    md = md.replace(/^# Changelog\s*\n/, `# Changelog\n\n## ${version}\n- ${note || 'No details.'}\n\n`);
    fs.writeFileSync('CHANGELOG.md', md.replace(/\n{3,}/g, '\n\n'));
  }
  console.log(`Set version ${version}`);
} else {
  console.error('Usage: node scripts/versions.js check|sync');
  process.exit(2);
}
