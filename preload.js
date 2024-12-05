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
    }
});
