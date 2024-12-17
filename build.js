require('dotenv').config();
const builder = require('electron-builder');
const Platform = builder.Platform;
const os = require('os');

// Configuration for the build
const config = {
    appId: 'com.darkwolfie.twitchmarathontimer',
    productName: 'Twitch Marathon Timer',
    directories: {
        output: 'dist'
    },
    files: [
        "**/*",
        "!**/*.ts",
        "!*.code-workspace",
        "!LICENSE.md",
        "!package.json",
        "!package-lock.json",
        "!src/",
        "!e2e/",
        "!hooks/",
        "!.angular/",
        "!*.map",
        "!*.md"
    ],
    win: {
        target: [{
            target: 'nsis',
            arch: ['x64']
        }],
        icon: 'build/icon.ico',
        // Only include certificate settings if CERT_PASSWORD is present
        ...(process.env.CERT_PASSWORD && {
            signtoolOptions: {
                certificateFile: 'C:/Users/DarkWolfie/Desktop/backup/Twitch Marathon Timer/build/cert.pfx',
                certificatePassword: process.env.CERT_PASSWORD,
                publisherName: 'DarkWolfieVT',
                signingHashAlgorithms: ['sha256']
            }
        })
    },
    nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: "Twitch Marathon Timer"
    },
    publish: {
        provider: 'github',
        releaseType: 'draft'
    }
};

async function build() {
    console.log('Starting build process...');
    
    try {
        // Check if running in GitHub Actions
        const isGithubAction = process.env.GITHUB_ACTIONS === 'true';
        
        // If in GitHub Actions, always build for Windows
        // If not, build for current platform
        const buildConfig = {
            targets: Platform.WINDOWS.createTarget(),
            config: config,
            publish: isGithubAction ? 'always' : 'never'
        };

        await builder.build(buildConfig);
        console.log('Build completed successfully');
    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

build();
