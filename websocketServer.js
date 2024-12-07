const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const net = require('net');

class WebSocketServer {
    constructor(port) {
        this.port = port;
        this.wss = null;
        this.clients = new Set(); // Initialize clients Set in constructor
        this.lastTimerState = null;
        
        // Load theme settings from file
        this.themeSettings = this.loadThemeSettings();

        this.initServer();
    }

    initServer() {
        // First, check if the port is available
        const server = net.createServer();
        
        server.listen(this.port, () => {
            // Port is available, close this test server
            server.close(() => {
                // Create WebSocket server
                this.initWSServer();
            });
        }).on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`Port ${this.port} is already in use. Attempting to close existing connections.`);
                // Optionally, you could implement logic to find an alternative port
            } else {
                console.error('Error starting server:', err);
            }
        });
    }

    initWSServer() {
        this.wss = new WebSocket.Server({ port: this.port });

        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            console.log('New client connected');
            console.log(`Total clients connected: ${this.clients.size}`);

            // Send the current timer state and theme to the new client
            if (this.lastTimerState) {
                ws.send(JSON.stringify(this.lastTimerState));
            }

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    if (data.type === 'getTheme') {
                        console.log('Received getTheme message');
                        ws.send(JSON.stringify({
                            type: 'theme',
                            settings: this.themeSettings
                        }));
                    }
                } catch (error) {
                    console.error('Error parsing message:', error);
                }
            });

            ws.on('close', () => {
                this.clients.delete(ws);
                console.log('Client disconnected');
                console.log(`Total clients connected: ${this.clients.size}`);
            });

            ws.on('error', (error) => {
                console.error('WebSocket Client Error:', error);
                this.clients.delete(ws);
            });
        });

        this.wss.on('error', (error) => {
            console.error('WebSocket Server Error:', error);
        });

        console.log(`WebSocket server started on port ${this.port}`);
    }

    loadThemeSettings() {
        try {
            const themePath = path.join(app.getPath('userData'), 'theme_settings.json');
            if (fs.existsSync(themePath)) {
                const savedTheme = JSON.parse(fs.readFileSync(themePath, 'utf-8'));
                return {
                    background: savedTheme.background || '#1f1f1f',
                    text: savedTheme.text || '#ffffff',
                    font: savedTheme.font || 'Courier New',
                    fontSize: savedTheme.fontSize || '48px'
                };
            }
        } catch (error) {
            console.error('Error loading theme settings:', error);
        }
        
        // Default theme settings
        return {
            background: '#1f1f1f',
            text: '#ffffff',
            font: 'Courier New',
            fontSize: '48px'
        };
    }

    saveThemeSettings(settings) {
        try {
            const themePath = path.join(app.getPath('userData'), 'theme_settings.json');
            fs.writeFileSync(themePath, JSON.stringify(settings), 'utf-8');
        } catch (error) {
            console.error('Error saving theme settings:', error);
        }
    }

    broadcastTimerState(timerState) {
        this.lastTimerState = timerState;
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(timerState));
            }
        });
    }

    updateTheme(settings) {
        // Directly use the settings object from the UI
        this.themeSettings = {
            background: settings.overlayBackground || '#1f1f1f',
            text: settings.overlayText || '#ffffff',
            font: settings.overlayFont || 'Courier New',
            fontSize: `${settings.overlayFontSize || 48}px`
        };

        // Save theme settings to file
        this.saveThemeSettings(this.themeSettings);
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'theme',
                    settings: this.themeSettings
                }));
            }
        });
    }

    handleSettingsUpdate(settings) {
        // Check if theme-related settings are present
        if (settings.overlayBackground || 
            settings.overlayText || 
            settings.overlayFont || 
            settings.overlayFontSize) {
            this.updateTheme(settings);
        }
    }
}

module.exports = WebSocketServer;
