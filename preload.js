const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    minimize: () => ipcRenderer.invoke('window-minimize'),
    close: () => ipcRenderer.invoke('window-close'),
    // Twitch Auth
    login: () => ipcRenderer.invoke('twitch-login'),
    logout: () => ipcRenderer.invoke('twitch-logout'),
    getUser: () => ipcRenderer.invoke('twitch-get-user'),
    onAuthSuccess: (callback) => ipcRenderer.on('twitch-auth-success', (_, user) => callback(user))
});
