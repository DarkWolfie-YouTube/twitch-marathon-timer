const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const EventSubClient = require('./eventSubClient');
const AuthManager = require('./authManager');
const fs = require('fs');
const TimerManager = require('./timerManager');
const { checkForUpdates } = require('./updateChecker');

// Twitch OAuth Configuration
const TWITCH_CLIENT_ID = 'zgq7tnjrd473cvia9xb2bn5s1v41i3';
const TWITCH_REDIRECT_URI = 'http://localhost:3000';
const TWITCH_SCOPES = ['user:read:email', 'channel:read:subscriptions', "bits:read"];

let mainWindow = null;
let authWindow = null;
let twitchAccessToken = null;
let twitchUser = null;
let eventSubClient = null;
let authManager = null;
let timerManager = null;
let overlayPath = null;

// Timer Settings Management
let timerSettings = {
    bitsTimeIncrement: 0.01,
    tier1SubTime: 5,
    tier2SubTime: 10,
    tier3SubTime: 15
};

let themeSettings = {
    overlayBackground: '#1f1f1f',
    overlayText: '#ffffff',
    overlayFont: 'Courier New',
    overlayFontSize: 48
};

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
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }, 
        frame: false,
        title: "Twitch Marathon Timer",
        autoHideMenuBar: true,
        titleBarStyle: 'hidden',
        titleBarOverlay: false,
        resizable: false,
        icon: path.join(__dirname, 'build/icon.ico')
    });

    mainWindow.loadFile(path.join(__dirname, 'views/index.html'));

    // Initialize AuthManager with user data path
    const userDataPath = app.getPath('userData');
    authManager = new AuthManager(userDataPath);
    timerManager = new TimerManager();
    timerManager.setMainWindow(mainWindow);
    timerManager.loadTimerState();

    // Check for updates when the app starts (silently)
    checkForUpdates(mainWindow, false);

    // Check for existing valid token
    checkStoredToken();

    mainWindow.on('closed', () => {
        if (eventSubClient) {
            eventSubClient.disconnect();
        }
        if (timerManager) {
            timerManager.pauseTimer();
        }
        if (timerManager.wsServer && timerManager.wsServer.wss) {
            timerManager.wsServer.wss.close(() => {
                console.log('WebSocket server closed');
            });
        }
        mainWindow = null;
    });
}

// Twitch OAuth Functions
function createAuthWindow() {
    authWindow = new BrowserWindow({
        width: 600,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${TWITCH_CLIENT_ID}&redirect_uri=${TWITCH_REDIRECT_URI}&response_type=token&scope=${TWITCH_SCOPES.join('+')}`;
    authWindow.loadURL(authUrl);

    authWindow.webContents.on('will-navigate', (event, url) => {
        handleAuthCallback(event, url);
    });

    authWindow.webContents.on('did-navigate', (event, url) => {
        handleAuthCallback(event, url);
    });

    authWindow.on('closed', () => {
        authWindow = null;
    });
}

async function handleAuthCallback(event, url) {
    console.log('Navigated to:', url);
    if (url.includes('#access_token=')) {
        const token = url.split('#access_token=')[1].split('&')[0];
        twitchAccessToken = token;
        
        // Get user info
        try {
            const response = await fetch('https://api.twitch.tv/helix/users', {
                headers: {
                    'Client-ID': TWITCH_CLIENT_ID,
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();
            twitchUser = data.data[0];
            mainWindow.webContents.send('twitch-auth-success', twitchUser);
            console.log('User data:', twitchUser);  

            // Save token to file
            const tokenData = {
                access_token: token,
                id: twitchUser.id,
                login: twitchUser.login,
                display_name: twitchUser.display_name,
                profile_image_url: twitchUser.profile_image_url,
                email: twitchUser.email,
                scopes: TWITCH_SCOPES
            };
            await authManager.saveToken(tokenData);
            if (!eventSubClient) {
                eventSubClient = new EventSubClient();
                eventSubClient.updateToken(token, twitchUser.id);
                eventSubClient.connect(mainWindow);
            }
        } catch (error) {
            console.error('Error fetching user data:', error);
        }

        if (authWindow) {
            authWindow.close();
        }
    }
}

async function checkStoredToken() {
    try {
        const storedToken = await authManager.getStoredToken();
        if (storedToken) {
            twitchAccessToken = storedToken.access_token;
            twitchUser = storedToken;
            mainWindow.webContents.send('twitch-auth-success', twitchUser);

            
            // Initialize EventSub client after successful token validation
            if (!eventSubClient) {
                eventSubClient = new EventSubClient();
                eventSubClient.updateToken(twitchAccessToken, twitchUser.id);
                eventSubClient.connect(mainWindow);
            }
        }
    } catch (error) {
        console.error('Error checking stored token:', error);
        mainWindow.webContents.send('twitch-auth-error', { message: 'Failed to validate token' });
    }
}

// Global method to send auth success


// IPC Handlers
ipcMain.handle('save-twitch-token', async (event, tokenData) => {
    try {
        const success = await authManager.saveToken(tokenData);
        if (success) {
            twitchAccessToken = tokenData.access_token;
            twitchUser = tokenData;
            mainWindow.webContents.send('twitch-auth-success', twitchUser);
            
            // Initialize EventSub client after new token
            if (!eventSubClient) {
                eventSubClient = new EventSubClient();
                eventSubClient.connect(mainWindow);
            }
            return { success: true };
        } else {
            return { success: false, error: 'Failed to save token' };
        }
    } catch (error) {
        console.error('Error saving token:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('twitch-logout', async () => {
    try {
        if (eventSubClient) {
            eventSubClient.disconnect();
            eventSubClient = null;
        }
        authManager.clearToken();
        twitchAccessToken = null;
        twitchUser = null;
        mainWindow.webContents.send('twitch-auth-logout');
        return { success: true };
    } catch (error) {
        console.error('Error during logout:', error);
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

ipcMain.handle('window-close', async () => {
    if (mainWindow) {
        if (eventSubClient) {
           await eventSubClient.disconnect();
        }
        await mainWindow.close();
    
    }
});

ipcMain.handle('twitch-login', () => {
    createAuthWindow();
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
        bitsTimeIncrement: parseFloat(settings.bitsTimeIncrement) || 1,
        tier1SubTime: parseFloat(settings.tier1SubTime) || 5,
        tier2SubTime: parseFloat(settings.tier2SubTime) || 10,
        tier3SubTime: parseFloat(settings.tier3SubTime) || 15
    };
    fs.writeFileSync(settingsPath, JSON.stringify(timerSettings), 'utf-8');

    themeSettings = {
        ...themeSettings,
        ...settings
    };

    // Update theme if theme-related settings are present
    if (timerManager.wsServer) {
        console.log('Updating theme settings');
        timerManager.wsServer.updateTheme(themeSettings);
    }
});

// IPC Handler to get current timer settings
ipcMain.handle('get-timer-settings', () => {
    return timerSettings;
});

// IPC Handler to get overlay path
ipcMain.handle('get-overlay-path', () => {
    return overlayPath;
});

// Add update checker IPC handler
ipcMain.handle('check-for-updates', () => {
    checkForUpdates(mainWindow, false);
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
                bitsTimeIncrement: parseFloat(savedSettings.bitsTimeIncrement) || 0.01,
                tier1SubTime: parseFloat(savedSettings.tier1SubTime) || 5,
                tier2SubTime: parseFloat(savedSettings.tier2SubTime) || 10,
                tier3SubTime: parseFloat(savedSettings.tier3SubTime) || 15
            };
        }
    } catch (error) {
        console.error('Error loading timer settings:', error);
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