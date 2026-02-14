/**
 * Branch analysis script for original JS files.
 *
 * Uses acorn to parse each original JS file and count/list all conditional
 * branches (if/else, switch, ternary, &&/|| short-circuits).
 *
 * Usage: node scripts/analyze-branches.js
 */

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const LIB_ROOT = path.join(__dirname, '..', 'tmp', 'original-lib', 'lib');

const FILES = [
    'determine-basal/determine-basal.js',
    'determine-basal/autosens.js',
    'determine-basal/cob.js',
    'iob/index.js',
    'iob/total.js',
    'iob/calculate.js',
    'iob/history.js',
    'meal/index.js',
    'meal/total.js',
    'meal/history.js',
    'profile/index.js',
    'profile/basal.js',
    'profile/targets.js',
    'profile/isf.js',
    'profile/carbs.js',
    'glucose-get-last.js',
    'basal-set-temp.js',
    'autotune-prep/index.js',
    'autotune/index.js',
];

function analyzeFile(filePath) {
    const code = fs.readFileSync(filePath, 'utf8');
    let ast;
    try {
        ast = acorn.parse(code, {
            ecmaVersion: 2020,
            sourceType: 'script',
            locations: true,
        });
    } catch (e) {
        return { error: e.message, branches: [] };
    }

    const branches = [];

    walk.simple(ast, {
        IfStatement(node) {
            branches.push({
                type: 'if',
                line: node.loc.start.line,
                condition: code.slice(node.test.start, node.test.end).slice(0, 120),
                hasElse: !!node.alternate,
            });
        },
        ConditionalExpression(node) {
            branches.push({
                type: 'ternary',
                line: node.loc.start.line,
                condition: code.slice(node.test.start, node.test.end).slice(0, 120),
            });
        },
        SwitchStatement(node) {
            const cases = node.cases.map(c =>
                c.test
                    ? code.slice(c.test.start, c.test.end).slice(0, 60)
                    : 'default'
            );
            branches.push({
                type: 'switch',
                line: node.loc.start.line,
                cases,
                caseCount: cases.length,
            });
        },
        LogicalExpression(node) {
            // Only count top-level &&/|| (not nested inside other LogicalExpression)
            if (node.operator === '&&' || node.operator === '||') {
                branches.push({
                    type: `logical-${node.operator}`,
                    line: node.loc.start.line,
                    condition: code.slice(node.start, node.end).slice(0, 120),
                });
            }
        },
    });

    return { branches };
}

// Main
console.log('=== Original JS Branch Analysis ===\n');

let totalBranches = 0;
const summary = [];

for (const file of FILES) {
    const filePath = path.join(LIB_ROOT, file);
    if (!fs.existsSync(filePath)) {
        console.log(`SKIP: ${file} (not found)`);
        continue;
    }

    const result = analyzeFile(filePath);
    if (result.error) {
        console.log(`ERROR: ${file} — ${result.error}`);
        continue;
    }

    const ifCount = result.branches.filter(b => b.type === 'if').length;
    const ternaryCount = result.branches.filter(b => b.type === 'ternary').length;
    const switchCount = result.branches.filter(b => b.type === 'switch').length;
    const logicalCount = result.branches.filter(b => b.type.startsWith('logical')).length;
    const total = ifCount + ternaryCount + switchCount + logicalCount;

    summary.push({ file, ifCount, ternaryCount, switchCount, logicalCount, total });
    totalBranches += total;

    console.log(`${file}:`);
    console.log(`  if: ${ifCount}, ternary: ${ternaryCount}, switch: ${switchCount}, logical: ${logicalCount} → total: ${total}`);

    // Print if-statements with conditions for the most critical files
    if (process.argv.includes('--detail') || process.argv.includes('-d')) {
        for (const b of result.branches) {
            if (b.type === 'if') {
                console.log(`    L${b.line}: if (${b.condition})${b.hasElse ? ' [+else]' : ''}`);
            } else if (b.type === 'switch') {
                console.log(`    L${b.line}: switch (${b.caseCount} cases: ${b.cases.join(', ')})`);
            } else if (b.type === 'ternary') {
                console.log(`    L${b.line}: ternary: ${b.condition}`);
            }
        }
    }
    console.log();
}

console.log('=== Summary ===');
console.log(`Total branch points across all files: ${totalBranches}`);
console.log();
console.log('File                                    | if  | ?:  | sw  | &&/|| | Total');
console.log('----------------------------------------|-----|-----|-----|-------|------');
for (const s of summary) {
    const name = s.file.padEnd(40);
    console.log(`${name}| ${String(s.ifCount).padStart(3)} | ${String(s.ternaryCount).padStart(3)} | ${String(s.switchCount).padStart(3)} | ${String(s.logicalCount).padStart(5)} | ${String(s.total).padStart(5)}`);
}
