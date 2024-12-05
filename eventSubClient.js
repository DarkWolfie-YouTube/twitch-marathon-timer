const WebSocket = require('ws');
const crypto = require('crypto');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

class EventSubClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.mainWindow = null;
        this.sessionId = null;
        this.subscriptions = new Set();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.closedByUser = false;

        // Default timer settings
        this.timerSettings = {
            bitsTimeIncrement: 1,
            tier1SubTime: 5,
            tier2SubTime: 10,
            tier3SubTime: 15
        };
    }

    async connect(mainWindow) {
        try {
            this.mainWindow = mainWindow;
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
                if (!this.closedByUser) {
                    this.attemptReconnect();
                }
            });

            this.ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.isConnected = false;
            });

        } catch (error) {
            console.error('Error connecting to EventSub:', error);
            this.isConnected = false;
        }
    }

    async handleMessage(message) {
        console.log(message)
        switch (message.metadata.message_type) {
            case 'session_welcome':
                this.sessionId = message.payload.session.id;
                console.log('Session established:', this.sessionId);
                await this.createSubscriptions();
                break;

            case 'session_keepalive':
                // Keep connection alive
                break;

            case 'notification':
                await this.handleNotification(message.payload);
                break;

            case 'session_reconnect':
                // Reconnect with new URL
                if (message.payload.session.reconnect_url) {
                    this.reconnectToNewSession(message.payload.session.reconnect_url);
                }
                break;

            case 'revocation':
                console.log('Subscription revoked:', message.payload);
                this.subscriptions.delete(message.payload.subscription.id);
                break;
        }
    }

    async createSubscriptions() {
        if (!this.sessionId) {
            console.error('No session ID available for creating subscriptions');
            return;
        }

        const subscriptionTypes = [
            {
                type: 'channel.subscribe',
                version: '1',
                condition: {
                    broadcaster_user_id: this.broadcasterId
                }
            },
            {
                type: 'channel.subscription.gift',
                version: '1',
                condition: {
                    broadcaster_user_id: this.broadcasterId
                }
            },
            {
                type: 'channel.cheer',
                version: '1',
                condition: {
                    broadcaster_user_id: this.broadcasterId
                }
            }
        ];

        for (const subscription of subscriptionTypes) {
            try {
                const response = await fetch('http://localhost:8080/eventsub/subscriptions', {
                    method: 'POST',
                    headers: {
                        'Client-ID': process.env.TWITCH_CLIENT_ID,
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        type: subscription.type,
                        version: subscription.version,
                        condition: subscription.condition,
                        transport: {
                            method: 'websocket',
                            session_id: this.sessionId
                        }
                    })
                });

                if (!response.ok) {
                    const error = await response.json();
                    console.error(`Failed to create subscription for ${subscription.type}:`, error);
                    continue;
                }

                const data = await response.json();
                this.subscriptions.add(data.data[0].id);
                console.log(`Successfully subscribed to ${subscription.type}`);

            } catch (error) {
                console.error(`Error creating subscription for ${subscription.type}:`, error);
            }
        }
    }

    async handleNotification(payload) {
        const { subscription, event } = payload;

        switch (subscription.type) {
            case 'channel.subscribe':
                await this.handleSubscription(event);
                break;

            case 'channel.subscription.gift':
                await this.handleSubscriptionGift(event);
                break;

            case 'channel.cheer':
                await this.handleCheer(event);
                break;
        }
    }

    async handleSubscription(event) {
        let timeToAdd = 0;
        const isResub = event.is_gift ? false : (event.message && event.message.length > 0);
        
        switch (event.tier) {
            case '1000': // Tier 1
                timeToAdd = this.timerSettings.tier1SubTime;
                break;
            case '2000': // Tier 2
                timeToAdd = this.timerSettings.tier2SubTime;
                break;
            case '3000': // Tier 3
                timeToAdd = this.timerSettings.tier3SubTime;
                break;
        }

        if (timeToAdd > 0) {
            const months = event.cumulative_months || 1;
            const eventType = isResub ? 'Resub' : 'Subscription';
            this.mainWindow.webContents.send('timer-increment', {
                timeToAdd: timeToAdd,
                reason: `${eventType}: ${event.user_name} (Tier ${event.tier}) - ${months} month${months > 1 ? 's' : ''}`
            });
        }
    }

    async handleSubscriptionGift(event) {
        let timeToAdd = 0;
        const totalGifts = event.total;
        
        switch (event.tier) {
            case '1000': // Tier 1
                timeToAdd = this.timerSettings.tier1SubTime * totalGifts;
                break;
            case '2000': // Tier 2
                timeToAdd = this.timerSettings.tier2SubTime * totalGifts;
                break;
            case '3000': // Tier 3
                timeToAdd = this.timerSettings.tier3SubTime * totalGifts;
                break;
        }

        if (timeToAdd > 0) {
            this.mainWindow.webContents.send('timer-increment', {
                timeToAdd: timeToAdd,
                reason: `Gift Subs: ${event.user_name} (${totalGifts}x Tier ${event.tier})`
            });
        }
    }

    async handleCheer(event) {
        const timeToAdd = this.timerSettings.bitsTimeIncrement * event.bits;
        
        this.mainWindow.webContents.send('timer-increment', {
            timeToAdd: timeToAdd,
            reason: `Bits: ${event.user_name} (${event.bits} bits)`
        });
    }

    async reconnectToNewSession(newUrl) {
        this.ws.close();
        this.ws = new WebSocket(newUrl);
        // Reattach event handlers
        this.setupWebSocketHandlers();
    }

    setupWebSocketHandlers() {
        this.ws.on('open', () => {
            console.log('Reconnected to Twitch EventSub WebSocket');
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
            console.log('Disconnected from Twitch EventSub WebSocket');
            this.isConnected = false;
            if (!this.closedByUser) {
                this.attemptReconnect();
            }
        });

        this.ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            this.isConnected = false;
        });
    }

    async attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
        
        setTimeout(() => {
            this.connect(this.mainWindow);
        }, delay);
    }

    updateSettings(settings) {
        this.timerSettings = {
            ...this.timerSettings,
            ...settings
        };
    }

    disconnect() {
        if (this.ws) {
            this.closedByUser = true;
            this.ws.close();
        }
    }
}

module.exports = EventSubClient;
