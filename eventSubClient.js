const WebSocket = require('ws');
const crypto = require('crypto');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const userDataPath = app.getPath('userData');
const TWITCH_CLIENT_ID = 'zgq7tnjrd473cvia9xb2bn5s1v41i3';


class EventSubClient {
    constructor(Logger) {
        this.logger = Logger;
        this.ws = null;
        this.isConnected = false;
        this.mainWindow = null;
        this.sessionId = null;
        this.subscriptions = new Set();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.closedByUser = false;
        this.accessToken = null;
        this.broadcasterId = null;    
        // Default timer settings
        this.timerSettings = JSON.parse(fs.readFileSync(path.join(userDataPath, 'timer_settings.json'), 'utf-8'));
    }

    async connect(mainWindow) {
        try {
            this.mainWindow = mainWindow;
            this.ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');


            this.ws.on('open', () => {
                this.logger.info('Connected to EventSub WebSocket server');
                this.isConnected = true;
                this.reconnectAttempts = 0;
            });

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    this.handleMessage(message);
                } catch (error) {
                    this.logger.error('Error parsing WebSocket message:', error);
                }
            });

            this.ws.on('close', () => {
                this.logger.info('Disconnected from EventSub WebSocket server');
                this.isConnected = false;
                if (!this.closedByUser) {
                    this.attemptReconnect();
                }
            });

            this.ws.on('error', (error) => {
                this.logger.error('WebSocket error:', error);
                this.isConnected = false;
            });

        } catch (error) {
            this.logger.error('Error connecting to EventSub:', error);
            this.isConnected = false;
        }
    }

    async handleMessage(message) {
        switch (message.metadata.message_type) {
            case 'session_welcome':
                this.sessionId = message.payload.session.id;
                this.logger.info('Session established:', this.sessionId);
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
                this.logger.info('Subscription revoked:', message.payload);
                this.subscriptions.delete(message.payload.subscription.id);
                break;
        }
    }

    async createSubscriptions() {
        if (!this.sessionId) {
            this.logger.error('No session ID available for creating subscriptions');
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
                const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
                    method: 'POST',
                    headers: {
                        'Client-ID': TWITCH_CLIENT_ID,
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
                    this.logger.error(`Failed to create subscription for ${subscription.type}:`, error);
                    continue;
                }

                const data = await response.json();
                this.subscriptions.add(data.data[0].id);
                this.logger.info(`Successfully subscribed to ${subscription.type}`);

            } catch (error) {
                this.logger.error(`Error creating subscription for ${subscription.type}:`, error);
            }
        }
    }

    async handleNotification(payload) {
        const subscription = payload.subscription;
        const event = payload.event;

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
                timeToAdd = this.timerSettings.tier1SubTime * 60;
                break;
            case '2000': // Tier 2
                timeToAdd = this.timerSettings.tier2SubTime * 60;
                break;
            case '3000': // Tier 3
                timeToAdd = this.timerSettings.tier3SubTime * 60;
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
                timeToAdd = (this.timerSettings.tier1SubTime * totalGifts) * 60;
                break;
            case '2000': // Tier 2
                timeToAdd = (this.timerSettings.tier2SubTime * totalGifts) * 60;
                break;
            case '3000': // Tier 3
                timeToAdd = (this.timerSettings.tier3SubTime * totalGifts) * 60;
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
        const timeToAdd = (this.timerSettings.bitsTimeIncrement * event.bits) * 60;
        
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
            this.logger.info('Reconnected to Twitch EventSub WebSocket');
            this.isConnected = true;
            this.reconnectAttempts = 0;
        });

        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                this.handleMessage(message);
            } catch (error) {
                this.logger.error('Error parsing WebSocket message:', error);
            }
        });

        this.ws.on('close', () => {
            this.logger.info('Disconnected from Twitch EventSub WebSocket');
            this.isConnected = false;
            if (!this.closedByUser) {
                this.attemptReconnect();
            }
        });

        this.ws.on('error', (error) => {
            this.logger.error('WebSocket error:', error);
            this.isConnected = false;
        });
    }

    async attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.logger.error('Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        this.logger.info(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
        
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

    async disconnect() {
        if (this.ws) {
            this.closedByUser = true;
            await this.removeSubscriptions();
            await this.ws.close();
        }
    }

    updateToken(token, id){
        this.accessToken = token;
        this.broadcasterId = id;
    }

    async removeSubscriptions() {
        if (this.sessionId) {
            return new Promise(async (resolve, reject) => {
            for (const subscriptionId of this.subscriptions) {
                const statusa = await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${subscriptionId}`, {
                    method: 'DELETE',
                    headers: {
                        'Client-ID': TWITCH_CLIENT_ID,
                        'Authorization': `Bearer ${this.accessToken}`
                    }
                });
                if (statusa.status === 204) {
                    this.subscriptions.delete(subscriptionId);
                    this.logger.info(`Removed subscription ${subscriptionId}`);
                } else {
                    this.logger.error(`Failed to remove subscription ${subscriptionId}`);
                }
            }

            resolve();  
        })
     }
    }
}

module.exports = EventSubClient;
