const fs = require('fs');
const path = require('path');

const coverageDir = path.join(__dirname, '..', 'coverage');
const jsonFile = path.join(coverageDir, 'coverage-final.json');

if (!fs.existsSync(jsonFile)) {
  console.log('No coverage-final.json found. Run with --coverage first.');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
const key = Object.keys(data).find(k => k.includes('determine-basal/determine-basal.js'));

if (!key) {
  console.log('determine-basal.js not found in coverage data');
  process.exit(1);
}

const entry = data[key];

// Uncovered statements
const stmts = entry.statementMap;
const stmtCounts = entry.s;
const uncoveredStmts = Object.keys(stmtCounts)
  .filter(k => stmtCounts[k] === 0)
  .map(k => stmts[k].start.line);
console.log('Uncovered statement lines:', [...new Set(uncoveredStmts)].sort((a, b) => a - b).join(', '));

// Uncovered branches
const branches = entry.branchMap;
const branchCounts = entry.b;
const uncoveredBranches = [];
for (const [id, counts] of Object.entries(branchCounts)) {
  counts.forEach((c, i) => {
    if (c === 0) uncoveredBranches.push(branches[id].locations[i].start.line);
  });
}
console.log('Uncovered branch lines:', [...new Set(uncoveredBranches)].sort((a, b) => a - b).join(', '));

// Coverage stats
const totalStmts = Object.keys(stmtCounts).length;
const coveredStmts = Object.values(stmtCounts).filter(c => c > 0).length;
const totalBranches = Object.values(branchCounts).reduce((sum, arr) => sum + arr.length, 0);
const coveredBranches = Object.values(branchCounts).reduce((sum, arr) => sum + arr.filter(c => c > 0).length, 0);
console.log(`Stmts: ${coveredStmts}/${totalStmts} (${(100 * coveredStmts / totalStmts).toFixed(2)}%)`);
console.log(`Branches: ${coveredBranches}/${totalBranches} (${(100 * coveredBranches / totalBranches).toFixed(2)}%)`);
