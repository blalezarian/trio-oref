#!/usr/bin/env npx tsx
/**
 * Validates that all vi.mock() paths in test files resolve to existing files.
 *
 * Run: pnpm validate:mocks
 *
 * This helps catch stale mock paths after refactoring file locations.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TESTS_DIR = path.join(__dirname, '../tests');

interface MockPathIssue {
    testFile: string;
    mockPath: string;
    resolvedPath: string;
}

function findTestFiles(): string[] {
    return fs
        .readdirSync(TESTS_DIR, { recursive: true })
        .map(String)
        .filter((f) => f.endsWith('.test.ts'))
        .map((f) => path.join(TESTS_DIR, f));
}

function extractMockPaths(fileContent: string): string[] {
    const mockRegex = /vi\.mock\s*\(\s*['"]([^'"]+)['"]/g;
    const paths: string[] = [];
    let match;
    while ((match = mockRegex.exec(fileContent)) !== null) {
        paths.push(match[1]);
    }
    return paths;
}

function isRelativePath(mockPath: string): boolean {
    return mockPath.startsWith('.');
}

function resolveAndCheckPath(
    mockPath: string,
    testFileDir: string,
): { resolved: string; exists: boolean } {
    const resolved = path.resolve(testFileDir, mockPath);

    const possiblePaths = [
        resolved,
        `${resolved}.ts`,
        `${resolved}.js`,
        `${resolved}/index.ts`,
        `${resolved}/index.js`,
    ];

    const exists = possiblePaths.some((p) => fs.existsSync(p));
    return { resolved, exists };
}

function validateMockPaths(): void {
    const testFiles = findTestFiles();
    const issues: MockPathIssue[] = [];

    for (const testFile of testFiles) {
        const content = fs.readFileSync(testFile, 'utf-8');
        const mockPaths = extractMockPaths(content);
        const testFileDir = path.dirname(testFile);

        for (const mockPath of mockPaths) {
            if (!isRelativePath(mockPath)) {
                continue;
            }

            const { resolved, exists } = resolveAndCheckPath(mockPath, testFileDir);

            if (!exists) {
                issues.push({
                    testFile: path.relative(TESTS_DIR, testFile),
                    mockPath,
                    resolvedPath: path.relative(process.cwd(), resolved),
                });
            }
        }
    }

    if (issues.length > 0) {
        console.error('\nFound invalid mock paths:\n');

        for (const issue of issues) {
            console.error(`  ${issue.testFile}`);
            console.error(`    Mock path: ${issue.mockPath}`);
            console.error(`    Resolved to: ${issue.resolvedPath} (not found)\n`);
        }

        console.error(`Total: ${issues.length} invalid mock path(s) found.`);
        console.error(
            'These mocks will silently fail, causing tests to use real implementations.\n',
        );
        process.exit(1);
    } else {
        console.log('All mock paths are valid.');
    }
}

validateMockPaths();
