const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const EventSubClient = require('./eventSubClient');
const AuthManager = require('./authManager');
const fs = require('fs');
const TimerManager = require('./timerManager');
const { checkForUpdates } = require('./updateChecker');
const Logger = require('./logger');
const { CachedFontDetector } = require('./fontDetector');


// Twitch OAuth Configuration
const TWITCH_CLIENT_ID = 'zgq7tnjrd473cvia9xb2bn5s1v41i3';
const TWITCH_SCOPES = ['user:read:email', 'channel:read:subscriptions', 'bits:read'];
const TOKEN_VALIDATION_INTERVAL = 60 * 60 * 1000;

let mainWindow = null;
let twitchAccessToken = null;
let twitchUser = null;
let eventSubClient = null;
let authManager = null;
let timerManager = null;
let overlayPath = null;
let logger = null;
let fontDetector = null;
let authAttempt = null;
let tokenValidationTimer = null;

// Timer Settings Management
let timerSettings = {
    bitsTimeIncrement: 0.01,
    tier1SubTime: 5,
    tier2SubTime: 10,
    tier3SubTime: 15
};

let themeSettings = {
    overlayBackground: '#1f1f1f',
    overlayTransparent: false,
    overlayText: '#ffffff',
    overlayFont: 'ui-monospace',
    overlayFontSize: 48
};

function finiteNumber(value, fallback) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}




    
function ensureOverlayFile() {
    const userDataPath = app.getPath('userData');
    const overlayDir = path.join(userDataPath, 'overlay');
    const targetPath = path.join(overlayDir, 'websocket-client.html');

    // Create overlay directory if it doesn't exist
    if (!fs.existsSync(overlayDir)) {
        fs.mkdirSync(overlayDir, { recursive: true });
    }

    // Delete overlay file if it already exists
    if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
    }

    // Copy overlay file if it doesn't exist or if we're in development
    const sourceFile = path.join(__dirname, 'views', 'websocket-client.html');
    if (!fs.existsSync(targetPath) || !app.isPackaged) {
        fs.copyFileSync(sourceFile, targetPath);
    }

    overlayPath = targetPath;
    return targetPath;
}

function createWindow() {
    // Ensure overlay file is extracted
    ensureOverlayFile();

    // Load saved settings before creating window
    loadSavedSettings();

    mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        minWidth: 860,
        minHeight: 640,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            devTools: !app.isPackaged
        }, 
        frame: false,
        title: "Twitch Marathon Timer",
        autoHideMenuBar: true,
        titleBarStyle: 'hidden',
        titleBarOverlay: false,
        resizable: true,
        icon: path.join(__dirname, 'build/icon.ico')
    });

    mainWindow.loadFile(path.join(__dirname, 'views/index.html'));
    if (logger){
        logger.info('App started! Twitch Martahon Timer is now online!');
    } else {
        logger = new Logger();
        logger.info('App started! Twitch Martahon Timer is now online!');
    }

    // Initialize AuthManager with user data path
    const userDataPath = app.getPath('userData');
    authManager = new AuthManager(userDataPath, logger, mainWindow, {
        clientId: TWITCH_CLIENT_ID,
        requiredScopes: TWITCH_SCOPES
    });
    timerManager = new TimerManager(logger);
    timerManager.setMainWindow(mainWindow);
    timerManager.loadTimerState();
    fontDetector = new CachedFontDetector({ cacheDir: app.getPath('userData') });


    
    

    // Check for updates when the app starts (silently)
    checkForUpdates(mainWindow, true, logger);

    // Check for existing valid token
    checkStoredToken();

    mainWindow.on('closed', () => {
        cancelAuthAttempt();
        clearInterval(tokenValidationTimer);
        if (eventSubClient) {
            eventSubClient.disconnect();
        }
        if (timerManager) {
            timerManager.pauseTimer();
        }
        if (timerManager.wsServer && timerManager.wsServer.wss) {
            timerManager.wsServer.wss.close(() => {
                logger.info('WebSocket server closed');
            });
        }
        mainWindow = null;
    });
}

// Twitch OAuth Functions
const wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

function sendToRenderer(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

function cancelAuthAttempt() {
    if (authAttempt) {
        authAttempt.cancelled = true;
        authAttempt = null;
    }
}

function toPublicTwitchUser(user) {
    return {
        id: user.id,
        login: user.login,
        display_name: user.display_name,
        profile_image_url: user.profile_image_url,
        email: user.email,
        expiresAt: user.expiresAt
    };
}

async function connectTwitchSession(user, tokenData) {
    twitchAccessToken = tokenData.access_token;
    twitchUser = toPublicTwitchUser({ ...user, expiresAt: tokenData.expiresAt });
    sendToRenderer('twitch-auth-success', twitchUser);

    if (eventSubClient) {
        try {
            await eventSubClient.disconnect();
        } catch (error) {
            logger.warn('Unable to close the previous Twitch EventSub session:', error);
        }
    }

    eventSubClient = new EventSubClient(logger);
    eventSubClient.updateToken(twitchAccessToken, twitchUser.id);
    eventSubClient.connect(mainWindow);
    startTokenValidation();
}

async function pollDeviceAuthorization(attempt) {
    try {
        while (!attempt.cancelled && authAttempt === attempt && Date.now() < attempt.expiresAt) {
            await wait(attempt.interval * 1000);
            if (attempt.cancelled || authAttempt !== attempt) return;

            const result = await authManager.exchangeDeviceCode(attempt.deviceCode, TWITCH_SCOPES);
            if (attempt.cancelled || authAttempt !== attempt) return;
            if (result.pending) continue;

            const user = await authManager.fetchUser(result.tokenData.access_token);
            const tokenData = {
                ...user,
                ...result.tokenData
            };
            const saved = await authManager.saveToken(tokenData);
            if (!saved) {
                throw new Error('Twitch returned a session without all required permissions. Please reconnect and approve each permission.');
            }

            await connectTwitchSession(user, tokenData);
            authAttempt = null;
            return;
        }

        if (authAttempt === attempt && !attempt.cancelled) {
            authAttempt = null;
            sendToRenderer('twitch-auth-error', { message: 'The Twitch login code expired. Please try again.' });
        }
    } catch (error) {
        if (authAttempt === attempt && !attempt.cancelled) {
            authAttempt = null;
            logger.error('Twitch device authorization failed:', error);
            sendToRenderer('twitch-auth-error', { message: error.message });
        }
    }
}

async function startTwitchLogin() {
    cancelAuthAttempt();

    try {
        const deviceAuthorization = await authManager.startDeviceAuthorization(TWITCH_SCOPES);
        const attempt = {
            cancelled: false,
            deviceCode: deviceAuthorization.device_code,
            userCode: deviceAuthorization.user_code,
            verificationUri: deviceAuthorization.verification_uri,
            interval: Math.max(5, Number(deviceAuthorization.interval) || 5),
            expiresAt: Date.now() + Number(deviceAuthorization.expires_in) * 1000
        };
        authAttempt = attempt;

        shell.openExternal(attempt.verificationUri).catch(error => {
            logger.warn('Unable to open the Twitch activation page:', error);
        });
        pollDeviceAuthorization(attempt);

        return {
            success: true,
            userCode: attempt.userCode,
            verificationUri: attempt.verificationUri,
            expiresIn: deviceAuthorization.expires_in
        };
    } catch (error) {
        logger.error('Unable to start Twitch login:', error);
        return { success: false, error: error.message };
    }
}

function startTokenValidation() {
    clearInterval(tokenValidationTimer);
    tokenValidationTimer = setInterval(async () => {
        const storedToken = await authManager.getStoredToken();
        if (!storedToken) {
            if (eventSubClient) await eventSubClient.disconnect();
            eventSubClient = null;
            twitchAccessToken = null;
            twitchUser = null;
            sendToRenderer('twitch-auth-logout');
            sendToRenderer('twitch-auth-error', { message: 'Your Twitch session ended. Please reconnect.' });
            clearInterval(tokenValidationTimer);
            return;
        }

        twitchAccessToken = storedToken.access_token;
        twitchUser = toPublicTwitchUser(storedToken);
        if (eventSubClient) {
            eventSubClient.updateToken(twitchAccessToken, twitchUser.id);
        }
    }, TOKEN_VALIDATION_INTERVAL);
    tokenValidationTimer.unref?.();
}

async function checkStoredToken() {
    try {
        const storedToken = await authManager.getStoredToken();
        if (storedToken) {
            await connectTwitchSession(storedToken, storedToken);
        }
    } catch (error) {
        logger.error('Error checking stored token:', error);
        mainWindow.webContents.send('twitch-auth-error', { message: 'Failed to validate token' });
    }
}

// IPC Handlers
ipcMain.handle('twitch-logout', async () => {
    try {
        cancelAuthAttempt();
        clearInterval(tokenValidationTimer);
        if (eventSubClient) {
            try {
                await eventSubClient.disconnect();
            } catch (error) {
                logger.warn('Unable to close Twitch EventSub during logout:', error);
            }
            eventSubClient = null;
        }
        await authManager.revokeToken(twitchAccessToken);
        authManager.clearToken();
        twitchAccessToken = null;
        twitchUser = null;
        sendToRenderer('twitch-auth-logout');
        return { success: true };
    } catch (error) {
        logger.error('Error during logout:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.on('request-user-info', (event) => {
    if (twitchUser) {
        event.reply('user-info', twitchUser);
    } else {
        event.reply('user-info', null);
    }
});

ipcMain.handle('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
    if (!mainWindow) return false;

    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
        return false;
    }

    mainWindow.maximize();
    return true;
});

ipcMain.handle('window-close', async () => {
    if (mainWindow) {
        if (eventSubClient) {
           await eventSubClient.disconnect();
        }
        await mainWindow.close();
    
    }
});

ipcMain.handle('twitch-login', () => startTwitchLogin());

ipcMain.handle('twitch-cancel-login', () => {
    cancelAuthAttempt();
    return { success: true };
});

ipcMain.handle('twitch-open-activation', async () => {
    if (!authAttempt?.verificationUri) {
        return { success: false, error: 'There is no active Twitch login.' };
    }

    try {
        await shell.openExternal(authAttempt.verificationUri);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('twitch-get-user', () => {
    return twitchUser;
});

//Testing Line

// IPC Handler for updating timer settings
ipcMain.on('update-timer-settings', (event, settings) => {
    // Save settings to local storage
    const settingsPath = path.join(app.getPath('userData'), 'timer_settings.json');

    
    // Update timer settings
    timerSettings = {
        bitsTimeIncrement: finiteNumber(settings.bitsTimeIncrement, 0.01),
        tier1SubTime: finiteNumber(settings.tier1SubTime, 5),
        tier2SubTime: finiteNumber(settings.tier2SubTime, 10),
        tier3SubTime: finiteNumber(settings.tier3SubTime, 15)
    };
    fs.writeFileSync(settingsPath, JSON.stringify(timerSettings), 'utf-8');

    themeSettings = {
        ...themeSettings,
        ...settings
    };

    // Update theme if theme-related settings are present
    if (timerManager.wsServer) {
        logger.info('Updating theme settings');
        timerManager.wsServer.updateTheme(themeSettings);
    }
});

// IPC Handler to get current timer settings
ipcMain.handle('get-timer-settings', () => {
    return timerSettings;
});

ipcMain.handle('get-fonts', async () => {
    if (!fontDetector) {
        fontDetector = new CachedFontDetector({ cacheDir: app.getPath('userData') });
    }

    return fontDetector.getFonts();
});

// IPC Handler to get overlay path
ipcMain.handle('get-overlay-path', () => {
    return overlayPath;
});

// Add update checker IPC handler
ipcMain.handle('check-for-updates', () => {
    checkForUpdates(mainWindow, false, logger);
});

ipcMain.handle('get-update-settings', () => {
    const { getSettings } = require('./updateChecker');
    return getSettings();
});

ipcMain.handle('set-pre-release-check', (event, enabled) => {
    const { setPreReleaseCheck } = require('./updateChecker');
    setPreReleaseCheck(enabled);
});

// Load saved settings on app startup
function loadSavedSettings() {
    try {
        const settingsPath = path.join(app.getPath('userData'), 'timer_settings.json');
        if (fs.existsSync(settingsPath)) {
            const savedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            timerSettings = {
                bitsTimeIncrement: finiteNumber(savedSettings.bitsTimeIncrement, 0.01),
                tier1SubTime: finiteNumber(savedSettings.tier1SubTime, 5),
                tier2SubTime: finiteNumber(savedSettings.tier2SubTime, 10),
                tier3SubTime: finiteNumber(savedSettings.tier3SubTime, 15)
            };
        }
    } catch (error) {
        (logger || console).error('Error loading timer settings:', error);
    }
}


// Timer IPC handlers
ipcMain.on('set-timer-time', (event, time) => {
    if (timerManager) {
        timerManager.setTime(time);
    }
});

ipcMain.on('start-timer', () => {
    if (timerManager) {
        timerManager.startTimer();
    }
});

ipcMain.on('pause-timer', () => {
    if (timerManager) {
        timerManager.pauseTimer();
    }
});

ipcMain.on('reset-timer', () => {
    if (timerManager) {
        timerManager.resetTimer();
    }
});

ipcMain.on('add-timer-time', (event, seconds) => {
    if (timerManager) {
        timerManager.addTime(seconds);
    }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
