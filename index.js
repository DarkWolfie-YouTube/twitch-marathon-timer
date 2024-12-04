const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

// Twitch OAuth Configuration
const TWITCH_CLIENT_ID = 'si2tmmp70ies0z61129yafy7no821p';
const TWITCH_REDIRECT_URI = 'http://localhost:3000';
const TWITCH_SCOPES = ['user:read:email', 'channel:read:subscriptions'];

let mainWindow = null;
let authWindow = null;
let twitchAccessToken = null;
let twitchUser = null;

function createWindow() {
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
}

// Twitch OAuth Functions
function createAuthWindow() {
    authWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${TWITCH_CLIENT_ID}&redirect_uri=${TWITCH_REDIRECT_URI}&response_type=token&scope=${TWITCH_SCOPES.join('+')}`;
    authWindow.loadURL(authUrl);

    authWindow.webContents.on('will-navigate', handleAuthCallback);
    authWindow.webContents.on('did-navigate', handleAuthCallback);

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
        } catch (error) {
            console.error('Error fetching user data:', error);
        }

        if (authWindow) {
            authWindow.close();
        }
    }
}

// IPC Handlers
ipcMain.handle('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-close', () => {
    if (mainWindow) mainWindow.close();
});

ipcMain.handle('twitch-login', () => {
    if (!twitchAccessToken) {
        createAuthWindow();
    }
    return !!twitchAccessToken;
});

ipcMain.handle('twitch-logout', () => {
    twitchAccessToken = null;
    twitchUser = null;
    return true;
});

ipcMain.handle('twitch-get-user', () => {
    return twitchUser;
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});