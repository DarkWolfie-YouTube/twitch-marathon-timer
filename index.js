const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const{ initialize, enable } = require('@electron/remote/main');
const path = require('node:path');
const fs = require('node:fs');
initialize();

async function createWindow() {
    const window = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }, 
        frame: false,
        title: "Twitch Marathon Timer",
        autoHideMenuBar: true,
        titleBarStyle: 'hidden',
        titleBarOverlay: false,
        resizable: false
    });

    window.loadFile(path.join(__dirname, 'views/index.html'));

}


app.whenReady().then(() => {
    createWindow();
    const mainWindow = BrowserWindow.getAllWindows()[0];
    enable(mainWindow.webContents);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
            const mainWindow = BrowserWindow.getAllWindows()[0];
            enable(mainWindow.webContents);
        }
    });
});


app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});