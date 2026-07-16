const test = require('node:test');
const assert = require('node:assert/strict');

// Requiring updateChecker from plain Node resolves Electron to its executable
// path, so isolate the pure comparator here through the exported function.
const { compareVersions } = require('../updateChecker');

test('compares stable semantic versions', () => {
    assert.equal(compareVersions('1.0.0', '1.0.1'), true);
    assert.equal(compareVersions('1.2.0', '1.1.9'), false);
    assert.equal(compareVersions('1.0.0', '1.0.0'), false);
});

test('compares the project beta pre-release format safely', () => {
    assert.equal(compareVersions('1.0.1-BETA-PreR2', '1.0.1-BETA-PreR3'), true);
    assert.equal(compareVersions('1.0.1-BETA-PreR2', '1.0.1-BETA-PreR1'), false);
    assert.equal(compareVersions('1.0.1-BETA-PreR2', '1.0.1'), true);
    assert.equal(compareVersions('1.0.1-BETA-PreR2', '0.6.0'), false);
});

test('does not report malformed release tags as updates', () => {
    assert.equal(compareVersions('1.0.1-BETA-PreR2', undefined), false);
    assert.equal(compareVersions('1.0.1', 'nightly'), false);
});
