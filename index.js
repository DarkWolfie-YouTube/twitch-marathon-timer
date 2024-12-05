const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const EventSubClient = require('./eventSubClient');
const AuthManager = require('./authManager');
const fs = require('fs');
const TimerManager = require('./timerManager');

// Twitch OAuth Configuration
const TWITCH_CLIENT_ID = 'si2tmmp70ies0z61129yafy7no821p';
const TWITCH_CLIENT_SECRET = '';
const TWITCH_REDIRECT_URI = 'http://localhost:3000';
const TWITCH_SCOPES = ['user:read:email', 'channel:read:subscriptions'];

let mainWindow = null;
let authWindow = null;
let twitchAccessToken = null;
let twitchUser = null;
let eventSubClient = null;
let authManager = null;
let timerManager = null;

// Timer Settings Management
let timerSettings = {
    bitsTimeIncrement: 0.01,
    tier1SubTime: 5,
    tier2SubTime: 10,
    tier3SubTime: 15
};

function createWindow() {
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
        resizable: false
    });

    mainWindow.loadFile(path.join(__dirname, 'views/index.html'));

    // Initialize AuthManager with user data path
    const userDataPath = app.getPath('userData');
    authManager = new AuthManager(userDataPath);
    timerManager = new TimerManager();
    timerManager.setMainWindow(mainWindow);
    timerManager.loadTimerState();
    
    // Check for existing valid token
    const storedToken = authManager.getStoredToken();
    if (storedToken) {
        twitchAccessToken = storedToken.access_token;
        twitchUser = storedToken;
        mainWindow.webContents.send('twitch-auth-success', twitchUser);
        console.log('User data:', twitchUser);
    }
    // Initialize EventSub client
    eventSubClient = new EventSubClient();
    eventSubClient.connect(mainWindow);

    mainWindow.on('closed', () => {
        if (eventSubClient) {
            eventSubClient.disconnect();
        }
        if (timerManager) {
            timerManager.pauseTimer();
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
                scopes: TWITCH_SCOPES,
                expires_in: 3600 // 1 hour
            };
            authManager.saveToken(tokenData);
        } catch (error) {
            console.error('Error fetching user data:', error);
        }

        if (authWindow) {
            authWindow.close();
        }
    }
}

// Global method to send auth success


// IPC Handlers
ipcMain.handle('twitch-auth-success', (event, user) => {
    console.log('Handling auth success:', user);
    return user;
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

ipcMain.handle('window-close', () => {
    if (mainWindow) mainWindow.close();
});

ipcMain.handle('twitch-login', () => {
    createAuthWindow();
});

ipcMain.handle('twitch-logout', () => {
    // Clear stored token
    authManager.clearToken();
    
    // Reset authentication state
    twitchAccessToken = null;
    twitchUser = null;
    
    // Notify renderer
    mainWindow.webContents.send('twitch-auth-logout');
});

ipcMain.handle('twitch-get-user', () => {
    return twitchUser;
});

// IPC Handler for updating timer settings
ipcMain.on('update-timer-settings', (event, settings) => {
    // Validate and update settings
    timerSettings = {
        bitsTimeIncrement: parseFloat(settings.bitsTimeIncrement) || 0.01,
        tier1SubTime: parseFloat(settings.tier1SubTime) || 5,
        tier2SubTime: parseFloat(settings.tier2SubTime) || 10,
        tier3SubTime: parseFloat(settings.tier3SubTime) || 15
    };
    
    // Optional: Persist settings to a file or database
    try {
        const settingsPath = path.join(app.getPath('userData'), 'timer_settings.json');
        fs.writeFileSync(settingsPath, JSON.stringify(timerSettings), 'utf-8');
    } catch (error) {
        console.error('Error saving timer settings:', error);
    }
});

// IPC Handler to get current timer settings
ipcMain.handle('get-timer-settings', () => {
    return timerSettings;
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