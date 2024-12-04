const WebSocket = require('ws');
const { ipcMain } = require('electron');

class EventSubClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.mainWindow = null;
        this.currentSessionId = null;
    }

    connect(mainWindow) {
        this.mainWindow = mainWindow;
        try {
            this.ws = new WebSocket('ws://localhost:8080/ws');

            this.ws.on('open', () => {
                console.log('Connected to mock EventSub WebSocket server');
                this.isConnected = true;
                this.reconnectAttempts = 0;                
            });

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            });

            this.ws.on('close', () => {
                console.log('Disconnected from mock EventSub WebSocket server');
                this.isConnected = false;
                this.attemptReconnect();
            });

            this.ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.isConnected = false;
            });

        } catch (error) {
            console.error('Error connecting to WebSocket:', error);
            this.attemptReconnect();
        }
    }

    handleMessage(message) {
        // console.log('Received EventSub message:', JSON.stringify(message, null, 2));
        
        // Handle session reconnect message
        if (message.metadata && message.metadata.message_type === 'session_reconnect') {
            this.handleSessionReconnect(message);
            return;
        }

        // Send other events to the renderer process
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('twitch-event', message);
        }
    }

    handleSessionReconnect(message) {
        const reconnectUrl = message.payload.session.reconnect_url;
        this.currentSessionId = message.payload.session.id;

        console.log('Received session reconnect. Reconnecting to:', reconnectUrl);

        // Close current connection
        if (this.ws) {
            this.ws.close();
        }

        // Reconnect to the new WebSocket URL
        try {
            this.ws = new WebSocket(reconnectUrl);

            this.ws.on('open', () => {
                console.log('Reconnected to EventSub WebSocket server');
                this.isConnected = true;
                this.reconnectAttempts = 0;
            });

            // Reattach existing event listeners
            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            });

            this.ws.on('close', () => {
                console.log('Disconnected during session reconnect');
                this.isConnected = false;
                this.attemptReconnect();
            });

            this.ws.on('error', (error) => {
                console.error('WebSocket error during reconnect:', error);
                this.isConnected = false;
            });

        } catch (error) {
            console.error('Error reconnecting to WebSocket:', error);
            this.attemptReconnect();
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            console.log(`Attempting to reconnect in ${delay/1000} seconds...`);
            setTimeout(() => this.connect(this.mainWindow), delay);
        } else {
            console.error('Max reconnection attempts reached');
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

module.exports = EventSubClient;
