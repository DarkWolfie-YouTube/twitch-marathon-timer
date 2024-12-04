require('dotenv').config();
const builder = require('electron-builder');

builder.build({
    config: {
        appId: "com.darkwolfie.twitchmarathontimer",
        productName: "Twitch Marathon Timer",
        directories: {
            output: "dist"
        },
        win: {
            target: ["nsis", "portable"],
            icon: "build/icon.ico",
            certificateFile: "./build/cert.pfx",
            certificatePassword: process.env.CERT_PASSWORD,
            publisherName: "DarkWolfieVT",
            signingHashAlgorithms: ["sha256"]
        },
        nsis: {
            oneClick: false,
            allowToChangeInstallationDirectory: true,
            createDesktopShortcut: true
        }
    }
});
