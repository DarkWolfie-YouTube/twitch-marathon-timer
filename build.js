require('dotenv').config();
const builder = require('electron-builder');
const Platform = builder.Platform;
const os = require('os');

// Check current platform
const isMacOS = os.platform() === 'darwin';
const isWindows = os.platform() === 'win32';

// Configuration for the build
const config = {
    appId: 'com.darkwolfie.twitchmarathontimer',
    productName: 'Twitch Marathon Timer',
    directories: {
        output: 'dist'
    },
    win: {
        target: ['nsis', 'portable'],
        icon: 'build/icon.ico',
        certificateFile: './build/cert.pfx',
        certificatePassword: process.env.CERT_PASSWORD,
        publisherName: 'DarkWolfieVT',
        signingHashAlgorithms: ['sha256']
    },
    mac: {
        target: ['dmg', 'zip'],
        icon: 'build/icon.icns',
        category: 'public.app-category.utilities',
        darkModeSupport: true,
        hardenedRuntime: true,
        gatekeeperAssess: false,
        entitlements: 'build/entitlements.mac.plist',
        entitlementsInherit: 'build/entitlements.mac.plist'
    },
    dmg: {
        background: 'build/background.png',
        icon: 'build/icon.icns',
        iconSize: 128,
        contents: [
            {
                x: 380,
                y: 180,
                type: 'link',
                path: '/Applications'
            },
            {
                x: 130,
                y: 180,
                type: 'file'
            }
        ],
        window: {
            width: 540,
            height: 380
        }
    },
    nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true
    }
};

// Determine which platform to build for
const platform = process.argv[2] || 'current';

async function build() {
    console.log('Starting build process...');
    
    try {
        switch (platform.toLowerCase()) {
            case 'windows':
                if (!isWindows) {
                    console.warn('Warning: Building Windows target on non-Windows platform may have issues');
                }
                await builder.build({
                    targets: Platform.WINDOWS.createTarget(),
                    config: config
                });
                break;
                
            case 'mac':
                if (!isMacOS) {
                    console.error('Error: Building for macOS requires a macOS system');
                    console.log('To build for macOS, you need to:');
                    console.log('1. Use a macOS computer or virtual machine');
                    console.log('2. Install Xcode and Xcode Command Line Tools');
                    console.log('3. Run this build script on macOS');
                    process.exit(1);
                }
                await builder.build({
                    targets: Platform.MAC.createTarget(),
                    config: config
                });
                break;
                
            case 'all':
                if (!isMacOS) {
                    console.warn('Warning: Cannot build macOS target on non-macOS platform');
                    console.log('Building Windows target only...');
                    await builder.build({
                        targets: Platform.WINDOWS.createTarget(),
                        config: config
                    });
                } else {
                    await builder.build({
                        targets: Platform.MAC.createTarget().concat(Platform.WINDOWS.createTarget()),
                        config: config
                    });
                }
                break;
                
            case 'current':
            default:
                // Build for current platform only
                const platform = isWindows ? Platform.WINDOWS : Platform.MAC;
                await builder.build({
                    targets: platform.createTarget(),
                    config: config
                });
                break;
        }
        console.log('Build completed successfully');
    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

build();
