const { platform } = require('os');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const { app, BrowserWindow, ipcMain } = require('electron');
const userDataPath = app.getPath('userData');

class FontDetector {
    constructor() {
        this.platform = platform();
        
        // Only load the packages if we're on the respective platforms
        if (this.platform === 'darwin') {
            this.SystemFonts = require('system-font-families');
        } else if (this.platform === 'win32') {
            this.fontList = require('font-list');
        }
    }

    async getFonts() {
        try {
            switch (this.platform) {
                case 'darwin':
                    return await this.getMacFonts();
                case 'win32':
                    return await this.getWindowsFonts();
                default:
                    throw new Error(`Unsupported platform: ${this.platform}`);
            }
        } catch (error) {
            console.error('Error detecting fonts:', error);
            return [];
        }
    }

    async getMacFonts() {
        try {
            const systemFonts = new this.SystemFonts();
            const fonts = await systemFonts.getFonts();
            return this.formatFontList(fonts);
        } catch (error) {
            console.error('Error getting Mac fonts:', error);
            // Fallback to system_profiler if the package fails
            return this.getMacFontsFallback();
        }
    }

    async getMacFontsFallback() {
        try {
            const { stdout } = await exec('system_profiler SPFontsDataType -json');
            const fontData = JSON.parse(stdout);
            const fonts = fontData.SPFontsDataType[0].Fonts.map(font => font._name);
            return this.formatFontList(fonts);
        } catch (error) {
            console.error('Error getting Mac fonts using fallback:', error);
            return [];
        }
    }

    async getWindowsFonts() {
        try {
            const fonts = await this.fontList.getFonts();
            return this.formatFontList(fonts);
        } catch (error) {
            console.error('Error getting Windows fonts:', error);
            // Fallback to PowerShell if the package fails
            return this.getWindowsFontsFallback();
        }
    }

    async getWindowsFontsFallback() {
        try {
            const { stdout } = await exec('powershell -command "[System.Drawing.FontFamily]::Families | Select-Object Name"');
            const fonts = stdout.split('\n')
                .filter(line => line.trim())
                .map(line => line.trim());
            return this.formatFontList(fonts);
        } catch (error) {
            console.error('Error getting Windows fonts using fallback:', error);
            return [];
        }
    }

    formatFontList(fonts) {
        // Remove duplicates and sort
        return [...new Set(fonts)]
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
    }

    async analyzeFonts() {
        const fonts = await this.getFonts();
        
        return {
            totalFonts: fonts.length,
            fonts: fonts,
            analysis: {
                systemInfo: {
                    platform: this.platform,
                    method: this.platform === 'darwin' ? 'system-font-families' : 'font-list'
                },
                statistics: {
                    total: fonts.length,
                    // Group fonts by first letter
                    byFirstLetter: fonts.reduce((acc, font) => {
                        const firstLetter = font.charAt(0).toUpperCase();
                        acc[firstLetter] = (acc[firstLetter] || 0) + 1;
                        return acc;
                    }, {})
                }
            }
        };
    }
}

// Example usage with caching
class CachedFontDetector extends FontDetector {
    constructor(cacheTime = 24 * 60 * 60 * 1000) { // 24 hours default
        super();
        this.fs = require('fs').promises;
        this.path = require('path');
        this.cacheFile = this.path.join(userDataPath, `.font-cache-${this.platform}.json`);
        this.cacheTime = cacheTime;
    }

    async getFonts() {
        // Try to get from cache first
        const cached = await this.getFromCache();
        if (cached) return cached;

        // If no cache, get fresh data
        const fonts = await super.getFonts();
        await this.saveToCache(fonts);
        return fonts;
    }

    async getFromCache() {
        try {
            const data = await this.fs.readFile(this.cacheFile, 'utf8');
            const cache = JSON.parse(data);
            
            if (Date.now() - cache.timestamp < this.cacheTime) {
                return cache.fonts;
            }
        } catch (error) {
            return null;
        }
    }

    async saveToCache(fonts) {
        const cache = {
            timestamp: Date.now(),
            fonts
        };
        await this.fs.writeFile(
            this.cacheFile, 
            JSON.stringify(cache, null, 2)
        );
    }
}

// Usage example
async function main() {
    const fontDetector = new CachedFontDetector();
    
    try {
        console.log('Analyzing fonts...');
        const analysis = await fontDetector.analyzeFonts();
        
        console.log('\nFont Analysis Results:');
        console.log('====================');
        console.log(`Platform: ${analysis.analysis.systemInfo.platform}`);
        console.log(`Detection Method: ${analysis.analysis.systemInfo.method}`);
        console.log(`Total Fonts: ${analysis.totalFonts}`);
        
        console.log('\nFirst Letter Distribution:');
        Object.entries(analysis.analysis.statistics.byFirstLetter)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .forEach(([letter, count]) => {
                console.log(`${letter}: ${count} fonts`);
            });

        // Uncomment to see full font list
        // console.log('\nAll Fonts:');
        // analysis.fonts.forEach(font => console.log(font));
        
    } catch (error) {
        console.error('Error in font analysis:', error);
    }
}

// Run the analysis


// Export the class for use in other files
module.exports = {
    FontDetector,
    CachedFontDetector, 
    main
};