const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const WebSocketServer = require('./websocketServer');

class TimerManager {
    constructor(logger) {
        this.timerState = {
            totalSeconds: 0,
            remainingSeconds: 0,
            isRunning: false,
            lastUpdated: Date.now()
        };
        this.timerInterval = null;
        this.mainWindow = null;
        this.wsServer = new WebSocketServer(42069, logger);
        this.loadTimerState();
        this.logger = logger;

    }

    setMainWindow(window) {
        this.mainWindow = window;
        // Send initial state to renderer
        this.updateRendererTime();
        
        // Listen for settings updates
        window.webContents.on('update-timer-settings', (event, settings) => {
            this.wsServer.updateTheme(settings);
        });
    }

    loadTimerState() {
        try {
            const timerPath = path.join(app.getPath('userData'), 'timer_state.json');
            if (fs.existsSync(timerPath)) {
                const savedState = JSON.parse(fs.readFileSync(timerPath, 'utf-8'));
                this.timerState = {
                    ...savedState,
                    isRunning: false, // Always start paused
                    lastUpdated: Date.now()
                };
                this.updateRendererTime();
                
            }
        } catch (error) {
            this.logger.error('Error loading timer state:', error);
        }
    }

    saveTimerState() {
        try {
            const timerPath = path.join(app.getPath('userData'), 'timer_state.json');
            this.timerState.lastUpdated = Date.now();
            fs.writeFileSync(timerPath, JSON.stringify(this.timerState), 'utf-8');
        } catch (error) {
            this.logger.error('Error saving timer state:', error);
        }
    }

    setTime(seconds) {
        this.timerState.totalSeconds = seconds;
        this.timerState.remainingSeconds = seconds;
        this.timerState.isRunning = false;
        clearInterval(this.timerInterval);
        this.saveTimerState();
        this.updateRendererTime();
    }

    addTime(seconds) {
        this.timerState.remainingSeconds += seconds;
        this.saveTimerState();
        this.updateRendererTime();
    }

    startTimer() {
        if (!this.timerState.isRunning && this.timerState.remainingSeconds > 0) {
            this.timerState.isRunning = true;
            this.timerInterval = setInterval(() => {
                if (this.timerState.remainingSeconds > 0) {
                    this.timerState.remainingSeconds--;
                    this.updateRendererTime();
                    this.saveTimerState();
                } else {
                    this.stopTimer();
                }
            }, 990);
            this.saveTimerState();
            this.updateRendererTime();
        }
    }

    pauseTimer() {
        this.timerState.isRunning = false;
        clearInterval(this.timerInterval);
        this.saveTimerState();
        this.updateRendererTime();
    }

    resetTimer() {
        this.timerState.remainingSeconds = this.timerState.totalSeconds;
        this.timerState.isRunning = false;
        clearInterval(this.timerInterval);
        this.saveTimerState();
        this.updateRendererTime();
    }

    updateRendererTime() {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('timer-update', {
                remainingSeconds: this.timerState.remainingSeconds,
                isRunning: this.timerState.isRunning
            });
            // Broadcast to WebSocket clients
            this.wsServer.broadcastTimerState(this.timerState);
        }
    }

    getState() {
        return this.timerState;
    }
}

module.exports = TimerManager;
