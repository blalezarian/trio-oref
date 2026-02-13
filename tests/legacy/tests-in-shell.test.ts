// Runner for unit tests which are written in bash. For each file in the
// oref0/tests directory whose name ends in .sh, generates a separate test
// which runs it and asserts that it exits with status 0 (success).

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import child_process from 'child_process';

describe('shell-script tests', { timeout: 120000 }, () => {
    // These shell tests require oref0 Linux CLI tools (ns-status,
    // oref0-log-shortcuts, readlink -f, /etc/skel/.profile) that only
    // exist on OpenAPS rig hardware. They are not applicable to the
    // Trio iOS fork which only uses the JS algorithm modules.
    const skipFiles = [
        'bash-util-functions.test.sh',
        'command-behavior.tests.sh',
    ];

    const bashUnitTestFiles: string[] = [];
    fs.readdirSync('tests').forEach((filename) => {
        if (filename.endsWith('.sh') && !skipFiles.includes(filename))
            bashUnitTestFiles.push(path.join('tests', filename));
    });

    bashUnitTestFiles.forEach((testFile) => {
        it(testFile, () => {
            const utilProcess = child_process.spawnSync(testFile, [], {
                timeout: 120000, //milliseconds
                encoding: 'UTF-8',
            });

            expect(utilProcess.status).toBe(0); // Bash unit test returned failure
        });
    });
});
