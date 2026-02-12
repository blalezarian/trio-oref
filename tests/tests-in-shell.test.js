// Runner for unit tests which are written in bash. For each file in the
// oref0/tests directory whose name ends in .sh, generates a separate test
// which runs it and asserts that it exits with status 0 (success).
"use strict"

var should = require('should');
var fs = require("fs");
var path = require("path");
var child_process = require("child_process");

before(function() {
    this.timeout(120000);
});

describe("shell-script tests", function() {
    this.timeout(120000);

    // These shell tests require oref0 Linux CLI tools (ns-status,
    // oref0-log-shortcuts, readlink -f, /etc/skel/.profile) that only
    // exist on OpenAPS rig hardware. They are not applicable to the
    // Trio iOS fork which only uses the JS algorithm modules.
    var skipFiles = [
        "bash-util-functions.test.sh",
        "command-behavior.tests.sh"
    ];

    var bashUnitTestFiles = [];
    fs.readdirSync("tests").forEach(function(filename) {
        if(filename.endsWith(".sh") && skipFiles.indexOf(filename) === -1)
            bashUnitTestFiles.push(path.join("tests", filename));
    });
    
    bashUnitTestFiles.forEach(function(testFile) {
        it(testFile, function() {
            var utilProcess = child_process.spawnSync(testFile, [], {
                timeout: 120000, //milliseconds
                encoding: "UTF-8",
            });
            
            //console.error("=================");
            //console.error(testFile);
            //console.error("=================");
            //console.error(testFile + "stdout: \n", utilProcess.stdout);
            //console.error(testFile + "stderr: \n", utilProcess.stderr);
            //console.error(utilProcess.error);
            should.equal(utilProcess.status, 0, "Bash unit test returned failure: run " + testFile + " manually for details.");
        });
    });
});
