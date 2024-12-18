const fs = require('fs');
const path = require('path');
const app = require('electron').app;

class Logger {
    constructor() {
        this.logFolderPath = path.join(app.getPath('userData'), 'logs');
        this.logFilePath = path.join(this.logFolderPath, `log-${new Date().toISOString()}.txt`);
        this.logLevel = 'info';
        
        // Ensure logs directory exists
        const logDir = path.dirname(this.logFolderPath);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    /**
     * Format the log message with timestamp and level
     * @param {string} level - Log level (info, error, warn)
     * @param {string} message - Message to log
     * @returns {string} Formatted log message
     */
    formatLogMessage(level, message) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    }

    /**
     * Write to log file
     * @param {string} message - Formatted message to write
     */
    async writeToLog(message) {
        try {
            await fs.promises.appendFile(this.logFilePath, message);
        } catch (error) {
            console.error('Error writing to log file:', error);
        }
    }

    /**
     * Log info level message
     * @param {string} message - Message to log
     */
    info(message) {
        const formattedMessage = this.formatLogMessage('info', message);
        this.writeToLog(formattedMessage);
    }

    /**
     * Log error level message
     * @param {string} message - Message to log
     */
    error(message) {
        const formattedMessage = this.formatLogMessage('error', message);
        this.writeToLog(formattedMessage);
    }

    /**
     * Log warning level message
     * @param {string} message - Message to log
     */
    warn(message) {
        const formattedMessage = this.formatLogMessage('warn', message);
        this.writeToLog(formattedMessage);
    }

    /**
     * Clear the log file
     */
    async clearLogs() {
        try {
            await fs.promises.writeFile(this.logFilePath, '');
        } catch (error) {
            console.error('Error clearing log file:', error);
        }
    }
}

module.exports = Logger;