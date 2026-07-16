const test = require('node:test');
const assert = require('node:assert/strict');
const { FontDetector } = require('../fontDetector');

test('normalizes, de-duplicates, and sorts font family names', () => {
    const detector = new FontDetector({ platform: 'win32' });
    const fonts = detector.formatFontList([
        '"Courier New"',
        ' Arial ',
        'courier new',
        '',
        null,
        "'Segoe UI'"
    ]);

    assert.deepEqual(fonts, ['Arial', 'Courier New', 'Segoe UI']);
});

test('parses the macOS system_profiler fallback format', async () => {
    const detector = new FontDetector({
        platform: 'darwin',
        execFile: async () => ({
            stdout: JSON.stringify({
                SPFontsDataType: [
                    { Fonts: [{ _name: 'Menlo Regular', family: 'Menlo' }, { family: 'Helvetica Neue' }] },
                    { _name: 'Monaco' }
                ]
            })
        })
    });

    assert.deepEqual(await detector.getMacFontsFallback(), ['Helvetica Neue', 'Menlo', 'Monaco']);
});

test('parses the Windows PowerShell fallback format without headers', async () => {
    const detector = new FontDetector({
        platform: 'win32',
        execFile: async () => ({ stdout: 'Segoe UI\r\nConsolas\r\nArial\r\n' })
    });

    assert.deepEqual(await detector.getWindowsFontsFallback(), ['Arial', 'Consolas', 'Segoe UI']);
});
