const fs = require('node:fs').promises;
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { platform } = require('node:os');
const fontList = require('font-list');

const execFileAsync = promisify(execFile);
const CACHE_VERSION = 2;

class FontDetector {
    constructor(options = {}) {
        this.platform = options.platform || platform();
        this.execFile = options.execFile || execFileAsync;
    }

    async getFonts() {
        try {
            // font-list supports both macOS and Windows. disableQuoting keeps the
            // returned family names suitable for select values and CSSOM use.
            const fonts = await fontList.getFonts({ disableQuoting: true });
            const formattedFonts = this.formatFontList(fonts);

            if (formattedFonts.length > 0) {
                return formattedFonts;
            }
        } catch (error) {
            console.error('Primary font detection failed:', error);
        }

        return this.getFallbackFonts();
    }

    async getFallbackFonts() {
        try {
            if (this.platform === 'darwin') {
                return await this.getMacFontsFallback();
            }

            if (this.platform === 'win32') {
                return await this.getWindowsFontsFallback();
            }

            if (this.platform === 'linux') {
                return await this.getLinuxFontsFallback();
            }
        } catch (error) {
            console.error('Fallback font detection failed:', error);
        }

        return [];
    }

    async getMacFontsFallback() {
        const { stdout } = await this.execFile(
            'system_profiler',
            ['SPFontsDataType', '-json'],
            { maxBuffer: 32 * 1024 * 1024 }
        );
        const fontData = JSON.parse(stdout);
        const fonts = [];

        for (const fontFile of fontData.SPFontsDataType || []) {
            const faces = Array.isArray(fontFile.Fonts) ? fontFile.Fonts : [fontFile];
            for (const face of faces) {
                if (face && (face.family || face._name)) {
                    fonts.push(face.family || face._name);
                }
            }
        }

        return this.formatFontList(fonts);
    }

    async getWindowsFontsFallback() {
        const script = [
            'Add-Type -AssemblyName System.Drawing',
            '[System.Drawing.FontFamily]::Families | ForEach-Object { $_.Name }'
        ].join('; ');
        const { stdout } = await this.execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', script],
            { maxBuffer: 8 * 1024 * 1024 }
        );

        return this.formatFontList(stdout.split(/\r?\n/));
    }

    async getLinuxFontsFallback() {
        const { stdout } = await this.execFile(
            'fc-list',
            ['--format', '%{family}\n'],
            { maxBuffer: 8 * 1024 * 1024 }
        );

        return this.formatFontList(stdout.split(/\r?\n/).flatMap(font => font.split(',')));
    }

    formatFontList(fonts) {
        const uniqueFonts = new Map();

        for (const font of fonts || []) {
            if (typeof font !== 'string') continue;

            const normalized = String(font)
                .trim()
                .replace(/^(["'])(.*)\1$/, '$2')
                .replace(/[\u0000-\u001F\u007F]/g, '')
                .trim();

            if (!normalized) continue;

            const key = normalized.toLocaleLowerCase();
            if (!uniqueFonts.has(key)) {
                uniqueFonts.set(key, normalized);
            }
        }

        return [...uniqueFonts.values()].sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: 'base' })
        );
    }

    async analyzeFonts() {
        const fonts = await this.getFonts();

        return {
            totalFonts: fonts.length,
            fonts,
            analysis: {
                systemInfo: {
                    platform: this.platform,
                    method: 'font-list'
                },
                statistics: {
                    total: fonts.length,
                    byFirstLetter: fonts.reduce((counts, font) => {
                        const firstLetter = font.charAt(0).toUpperCase();
                        counts[firstLetter] = (counts[firstLetter] || 0) + 1;
                        return counts;
                    }, {})
                }
            }
        };
    }
}

class CachedFontDetector extends FontDetector {
    constructor(options = {}) {
        super(options);
        this.cacheTime = options.cacheTime || 24 * 60 * 60 * 1000;
        this.cacheFile = options.cacheDir
            ? path.join(options.cacheDir, `.font-cache-${this.platform}.json`)
            : null;
    }

    async getFonts() {
        const cached = await this.getFromCache();
        if (cached) return cached;

        const fonts = await super.getFonts();
        if (fonts.length > 0) {
            await this.saveToCache(fonts);
        }
        return fonts;
    }

    async getFromCache() {
        if (!this.cacheFile) return null;

        try {
            const cache = JSON.parse(await fs.readFile(this.cacheFile, 'utf8'));
            const isFresh = Date.now() - cache.timestamp < this.cacheTime;
            if (cache.version === CACHE_VERSION && isFresh && Array.isArray(cache.fonts) && cache.fonts.length > 0) {
                return this.formatFontList(cache.fonts);
            }
        } catch {
            // A missing, old, or malformed cache should simply be regenerated.
        }

        return null;
    }

    async saveToCache(fonts) {
        if (!this.cacheFile) return;

        try {
            await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
            await fs.writeFile(this.cacheFile, JSON.stringify({
                version: CACHE_VERSION,
                timestamp: Date.now(),
                fonts
            }, null, 2));
        } catch (error) {
            console.error('Unable to cache the font list:', error);
        }
    }
}

async function main(logger, options = {}) {
    const fontDetector = new CachedFontDetector(options);
    const analysis = await fontDetector.analyzeFonts();
    logger.info(`Detected ${analysis.totalFonts} fonts on ${analysis.analysis.systemInfo.platform}`);
    return analysis;
}

module.exports = {
    FontDetector,
    CachedFontDetector,
    main
};
