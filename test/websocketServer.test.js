const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeThemeSettings } = require('../websocketServer');

test('creates a transparent OBS overlay theme when requested', () => {
    assert.deepEqual(normalizeThemeSettings({
        overlayBackground: '#123456',
        overlayTransparent: true,
        overlayText: '#fedcba',
        overlayFont: 'Consolas',
        overlayFontSize: 64
    }), {
        background: 'transparent',
        transparentBackground: true,
        text: '#fedcba',
        font: 'Consolas',
        fontSize: '64px'
    });
});

test('keeps the chosen OBS overlay background color when transparency is off', () => {
    assert.equal(normalizeThemeSettings({
        overlayBackground: '#123456',
        overlayTransparent: false
    }).background, '#123456');
});
