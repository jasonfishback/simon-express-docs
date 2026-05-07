const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GEOCODIO_API_KEY || 'ccdfdcf39ec2c5d6696e9def5e52ff666fc323f';

const INPUT_PATH  = path.join(__dirname, '..', 'public', 'fuel-data.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'lib', 'fuel', 'station-coords.json');
const FAILURES    = path.join(__dirname, '..', 'src', 'lib', 'fuel', 'geocode-failures.txt');

function buildQuery(s) {
  if (s.address && s.zip) return `${s.address}, ${s.city}, ${s.state} ${s.zip}`;
  if (s.address)          return `${s.address}, ${s.city}, ${s.state}`;
  if (s.zip)              return `${s.city}, ${s.state} ${s.zip}`;
  return `${s.city}, ${s.state}`;
}

(async () => {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`ERROR: ${INPUT_PATH} not found`);
    process.exit(1);
  }

  const stations = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8')).stations;
  console.log(`Geocoding ${stations.length} stations via Geocodio batch API...`);

  const queries = stations.map(buildQuery);
  const startTime = Date.now();

  const res = await fetch(`https://api.geocod.io/v1.7/geocode?api_key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(queries),
  });

  if (!res.ok) {
    console.error(`ERROR: Geocodio returned HTTP ${res.status}`);
    console.error((await res.text()).substring(0, 500));
    process.exit(1);
  }

  const json = await res.json();
  console.log(`Batch response received in ${Math.round((Date.now() - startTime) / 1000)}s`);
  console.log(`Results: ${json.results.length}`);

  const out = {};
  let success = 0, failed = 0;
  const failures = [];
  const goodTypes = ['rooftop', 'point', 'range_interpolation', 'nearest_rooftop_match', 'street_center', 'place'];

  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    const key = `${s.site}|${s.state}`;
    const result = json.results[i];

    if (result && result.response && result.response.results && result.response.results.length > 0) {
      const best = result.response.results[0];
      out[key] = {
        lat: Math.round(best.location.lat * 10000) / 10000,
        lng: Math.round(best.location.lng * 10000) / 10000,
        address: s.address || '',
        zip: s.zip || '',
        phone: s.phone || '',
      };
      if (goodTypes.includes(best.accuracy_type) && best.accuracy >= 0.5) {
        success++;
      } else {
        failed++;
        failures.push(`${key}\t${s.city}, ${s.state}\taccuracy=${best.accuracy}\ttype=${best.accuracy_type}`);
      }
    } else {
      failed++;
      failures.push(`${key}\t${s.city}, ${s.state}\tNO RESULT\tquery="${queries[i]}"`);
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out));
  console.log(`\nWrote ${Object.keys(out).length} stations to ${OUTPUT_PATH}`);

  if (failures.length > 0) {
    fs.writeFileSync(FAILURES, 'site|state\tcity, state\taccuracy\ttype\n' + failures.join('\n'));
    console.log(`${failures.length} low-confidence results logged`);
  }

  console.log(`\nSummary: ${success} high-confidence, ${failed} low-confidence`);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});