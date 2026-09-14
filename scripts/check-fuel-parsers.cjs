#!/usr/bin/env node
// Regression check for the England/Pilot price-sheet parsers.
//
//   node scripts/check-fuel-parsers.cjs <dir-with-vendor-files>
//
// Runs every .xls/.xlsx in <dir> through the parser its filename implies
// (Loves* -> parseLovesXlsx, TAPetro* -> parseTaXls, cp*.xls -> parsePilotXls)
// and fails if any file parses to fewer than MIN_STATIONS rows. Vendors rename
// header columns without notice (7/15, 7/20, 7/24, 8/24 "Loves Store",
// 9/8 "Fuel Price") and each rename silently starves a brand for days — keep
// a folder of recent real files around and run this before shipping any
// parser change. Vendor files are confidential: keep them OUT of the repo.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Module = require('module')

const MIN_STATIONS = { loves: 300, ta: 200, pfj: 300 }

function loadParse() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'fuel', 'parse.ts')
  const src = fs.readFileSync(file, 'utf8')
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  const m = new Module(file, module)
  m.filename = file
  m.paths = Module._nodeModulePaths(path.dirname(file))
  m._compile(js, file)
  return m.exports
}

const dir = process.argv[2]
if (!dir) { console.error('usage: node scripts/check-fuel-parsers.cjs <dir>'); process.exit(2) }
const { parseLovesXlsx, parseTaXls, parsePilotXls } = loadParse()

let failures = 0
for (const f of fs.readdirSync(dir).filter(f => /\.(xls|xlsx)$/i.test(f)).sort()) {
  const buf = fs.readFileSync(path.join(dir, f))
  let brand, parser
  if (/loves/i.test(f)) { brand = 'loves'; parser = parseLovesXlsx }
  else if (/ta\s?petro|tapetro/i.test(f)) { brand = 'ta'; parser = parseTaXls }
  else if (/^(\d{8}_)?cp\d+\.xls$/i.test(f)) { brand = 'pfj'; parser = parsePilotXls }
  else { console.log(`SKIP  ${f} (unknown vendor)`); continue }
  try {
    const rows = parser(buf)
    const withRetail = rows.filter(r => r.retailPrice > 0).length
    const ok = rows.length >= MIN_STATIONS[brand]
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${f}: ${rows.length} ${brand} stations (${withRetail} with retail)`)
  } catch (e) {
    failures++
    console.log(`FAIL  ${f}: ${String(e.message || e).slice(0, 300)}`)
  }
}
console.log(failures ? `\n${failures} failure(s)` : '\nall parsers OK')
process.exit(failures ? 1 : 0)
