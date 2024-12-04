const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    minimize: () => ipcRenderer.invoke('window-minimize'),
    close: () => ipcRenderer.invoke('window-close'),
    // Twitch Auth
    login: () => ipcRenderer.invoke('twitch-login'),
    logout: () => ipcRenderer.invoke('twitch-logout'),
    getUser: () => ipcRenderer.invoke('twitch-get-user'),
    requestUserInfo: () => {
        return new Promise((resolve) => {
            ipcRenderer.send('request-user-info');
            ipcRenderer.once('user-info', (event, userInfo) => {
                resolve(userInfo);
            });
        });
    },
    onAuthSuccess: (callback) => ipcRenderer.on('twitch-auth-success', (event, user) => callback(user)),
    onAuthLogout: (callback) => ipcRenderer.on('twitch-auth-logout', () => callback()),
    // Twitch Events
    onTwitchEvent: (callback) => ipcRenderer.on('twitch-event', (_, eventData) => callback(eventData))
});
