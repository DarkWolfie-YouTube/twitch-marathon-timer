const { app, dialog } = require('electron');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const currentVersion = require('./package.json').version;
const fs = require('fs');
const path = require('path');

let settings = {
    checkPreReleases: false
};

// Load settings
function loadSettings() {
    try {
        const settingsPath = path.join(app.getPath('userData'), 'update-settings.json');
        if (fs.existsSync(settingsPath)) {
            const data = fs.readFileSync(settingsPath, 'utf8');
            settings = { ...settings, ...JSON.parse(data) };
        }
    } catch (error) {
        console.error('Error loading update settings:', error);
    }
}

// Save settings
function saveSettings() {
    try {
        const settingsPath = path.join(app.getPath('userData'), 'update-settings.json');
        fs.writeFileSync(settingsPath, JSON.stringify(settings), 'utf8');
    } catch (error) {
        console.error('Error saving update settings:', error);
    }
}

async function checkForUpdates(window, silent = false, logger) {
    try {
        // Load current settings
        logger.info('Checking for updates...');
        loadSettings();

        // Determine which endpoint to use based on settings
        const endpoint = settings.checkPreReleases ? 
            'https://api.github.com/repos/DarkWolfie-YouTube/twitch-marathon-timer/releases' :
            'https://api.github.com/repos/DarkWolfie-YouTube/twitch-marathon-timer/releases/latest';

        const response = await fetch(endpoint);
        const data = await response.json();

        // Handle array response for pre-releases
        const latestRelease = settings.checkPreReleases ? 
            data.find(release => settings.checkPreReleases || !release.prerelease) :
            data;

        if (!latestRelease || !latestRelease.tag_name) {
            if (!silent) {
                dialog.showMessageBox(window, {
                    type: 'info',
                    title: 'Update Check Failed',
                    message: 'Unable to check for updates at this time.',
                    buttons: ['OK']
                });
                logger.warn("Unable to check for updates at this time.");
            }
            return;
        }

        const latestVersion = latestRelease.tag_name.replace('v', '');
        const updateAvailable = compareVersions(currentVersion, latestVersion);

        if (updateAvailable) {
            const releaseType = latestRelease.prerelease ? 'pre-release' : 'release';
            const choice = await dialog.showMessageBox(window, {
                type: 'info',
                title: 'Update Available',
                message: `A new ${releaseType} (${latestVersion}) is available!\n\nCurrent version: ${currentVersion}`,
                detail: latestRelease.body || 'No release notes available.',
                buttons: ['Download', 'Later'],
                defaultId: 0
            });

            logger.info(`Update available: ${latestVersion}`);

            if (choice.response === 0) {
                require('electron').shell.openExternal(latestRelease.html_url);
            }
        } else if (!silent) {
            dialog.showMessageBox(window, {
                type: 'info',
                title: 'No Updates Available',
                message: `You're running the latest version (${currentVersion}).`,
                buttons: ['OK']
            });
            logger.info(`No updates available: ${currentVersion}`);
        } else {
            logger.info(`No updates available: ${currentVersion}`);
        }
    } catch (error) {
        console.error('Update check failed:', error);
        if (!silent) {
            dialog.showMessageBox(window, {
                type: 'error',
                title: 'Update Check Failed',
                message: 'Unable to check for updates at this time.',
                detail: error.message,
                buttons: ['OK']
            });
        }
    }
}

function compareVersions(current, latest) {
    const parseVersion = (version) => {
        const match = String(version).trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
        if (!match) return null;

        return {
            core: match.slice(1, 4).map(Number),
            prerelease: match[4] || null
        };
    };

    const currentVersion = parseVersion(current);
    const latestVersion = parseVersion(latest);
    if (!currentVersion || !latestVersion) {
        return false;
    }

    for (let i = 0; i < 3; i++) {
        if (latestVersion.core[i] > currentVersion.core[i]) return true;
        if (latestVersion.core[i] < currentVersion.core[i]) return false;
    }

    // For the same core version, a stable release is newer than a pre-release.
    if (currentVersion.prerelease && !latestVersion.prerelease) return true;
    if (!currentVersion.prerelease || !latestVersion.prerelease) return false;

    const currentParts = currentVersion.prerelease.match(/[A-Za-z]+|\d+/g) || [];
    const latestParts = latestVersion.prerelease.match(/[A-Za-z]+|\d+/g) || [];
    const partCount = Math.max(currentParts.length, latestParts.length);

    for (let i = 0; i < partCount; i++) {
        const currentPart = currentParts[i];
        const latestPart = latestParts[i];
        if (currentPart === undefined) return true;
        if (latestPart === undefined) return false;

        const currentNumber = Number(currentPart);
        const latestNumber = Number(latestPart);
        const bothNumeric = Number.isFinite(currentNumber) && Number.isFinite(latestNumber);
        const comparison = bothNumeric
            ? latestNumber - currentNumber
            : latestPart.localeCompare(currentPart, undefined, { sensitivity: 'base' });

        if (comparison > 0) return true;
        if (comparison < 0) return false;
    }

    return false;
}

function setPreReleaseCheck(enabled) {
    settings.checkPreReleases = enabled;
    saveSettings();
}

function getSettings() {
    loadSettings();
    return settings;
}

module.exports = { checkForUpdates, compareVersions, setPreReleaseCheck, getSettings };
