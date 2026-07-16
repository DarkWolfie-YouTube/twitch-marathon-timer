const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    minimize: () => ipcRenderer.invoke('window-minimize'),
    maximize: () => ipcRenderer.invoke('window-maximize'),
    close: () => ipcRenderer.invoke('window-close'),
    // Twitch Auth
    login: () => ipcRenderer.invoke('twitch-login'),
    cancelLogin: () => ipcRenderer.invoke('twitch-cancel-login'),
    openTwitchActivation: () => ipcRenderer.invoke('twitch-open-activation'),
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
    onAuthError: (callback) => ipcRenderer.on('twitch-auth-error', (event, error) => callback(error)),
    // Twitch Events
    onTwitchEvent: (callback) => ipcRenderer.on('twitch-event', (_, eventData) => callback(eventData)),
    sendSettingsUpdate: (settings) => {
        ipcRenderer.send('update-timer-settings', settings);
    },
    getTimerSettings: () => {
        return ipcRenderer.invoke('get-timer-settings');
    },
    // Timer Events
    onTimerIncrement: (callback) => ipcRenderer.on('timer-increment', (_, data) => callback(data)),
    // Timer Controls
    setTimerTime: (seconds) => {
        ipcRenderer.send('set-timer-time', seconds);
    },
    startTimer: () => {
        ipcRenderer.send('start-timer');
    },
    pauseTimer: () => {
        ipcRenderer.send('pause-timer');
    },
    resetTimer: () => {
        ipcRenderer.send('reset-timer');
    },
    addTimerTime: (seconds) => {
        ipcRenderer.send('add-timer-time', seconds);
    },
    onTimerUpdate: (callback) => {
        ipcRenderer.on('timer-update', (_, data) => callback(data));
    },
    // Overlay Path
    getOverlayPath: () => ipcRenderer.invoke('get-overlay-path'),
    // Update checker
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    getUpdateSettings: () => ipcRenderer.invoke('get-update-settings'),
    setPreReleaseCheck: (enabled) => ipcRenderer.invoke('set-pre-release-check', enabled),
    getFonts: () => ipcRenderer.invoke('get-fonts')
});
