const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class TimerManager {
    constructor() {
        this.timerState = {
            totalSeconds: 0,
            remainingSeconds: 0,
            isRunning: false,
            lastUpdated: Date.now()
        };
        this.timerInterval = null;
        this.mainWindow = null;
        this.loadTimerState();
    }

    setMainWindow(window) {
        this.mainWindow = window;
        // Send initial state to renderer
        this.updateRendererTime();
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
            console.error('Error loading timer state:', error);
        }
    }

    saveTimerState() {
        try {
            const timerPath = path.join(app.getPath('userData'), 'timer_state.json');
            this.timerState.lastUpdated = Date.now();
            fs.writeFileSync(timerPath, JSON.stringify(this.timerState), 'utf-8');
        } catch (error) {
            console.error('Error saving timer state:', error);
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
        }
    }

    getState() {
        return this.timerState;
    }
}

module.exports = TimerManager;
