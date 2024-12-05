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
        this.timerSettings = {
            bitsTimeIncrement: 0.01,
            tier1SubTime: 5,
            tier2SubTime: 10,
            tier3SubTime: 15
        };
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

    updateTimerSettings(settings) {
        this.timerSettings = {
            bitsTimeIncrement: parseFloat(settings.bitsTimeIncrement) || 0.01,
            tier1SubTime: parseFloat(settings.tier1SubTime) || 5,
            tier2SubTime: parseFloat(settings.tier2SubTime) || 10,
            tier3SubTime: parseFloat(settings.tier3SubTime) || 15
        };
    }

    processEvent(eventType, eventData) {
        let timeToAdd = 0;

        switch (eventType) {
            case 'bits':
                // Calculate time based on bits amount
                timeToAdd = (eventData.bits || 0) * this.timerSettings.bitsTimeIncrement;
                break;
            
            case 'subscription':
                // Calculate time based on subscription tier
                switch (eventData.tier) {
                    case '1000': // Tier 1 / Prime
                        timeToAdd = this.timerSettings.tier1SubTime;
                        break;
                    case '2000': // Tier 2
                        timeToAdd = this.timerSettings.tier2SubTime;
                        break;
                    case '3000': // Tier 3
                        timeToAdd = this.timerSettings.tier3SubTime;
                        break;
                }
                break;
        }

        // Send time increment to main window
        if (timeToAdd > 0 && this.mainWindow) {
            this.mainWindow.webContents.send('timer-increment', {
                eventType,
                timeToAdd
            });
        }
    }

    handleMessage(message) {
        // console.log('Received EventSub message:', JSON.stringify(message, null, 2));
        
        // Handle session reconnect message
        if (message.metadata && message.metadata.message_type === 'session_reconnect') {
            this.handleSessionReconnect(message);
            return;
        }

        // Process different event types
        switch (message.metadata.message_type) {
            case 'notification':
                const eventType = message.metadata.subscription_type;
                const eventData = message.payload.event;

                // Process event and calculate timer increment
                this.processEvent(eventType, eventData);
                break;
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
