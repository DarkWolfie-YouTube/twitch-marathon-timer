const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const electron = require('electron');

const defaultFetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

class AuthManager {
    constructor(userDataPath, logger, window, options = {}) {
        this.tokenFilePath = path.join(userDataPath, 'twitch_auth.json');
        this.logger = logger;
        this.window = window;
        this.clientId = options.clientId;
        this.requiredScopes = options.requiredScopes || [];
        this.fetch = options.fetch || defaultFetch;
        this.safeStorage = options.safeStorage || electron.safeStorage;
    }

    protectSecret(secret) {
        if (!secret) return null;

        if (this.safeStorage?.isEncryptionAvailable()) {
            return {
                provider: 'safeStorage',
                content: this.safeStorage.encryptString(secret).toString('base64')
            };
        }

        // Compatibility fallback for environments without an OS credential
        // store. Windows and macOS normally use safeStorage above.
        const key = crypto.randomBytes(32);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);

        return {
            provider: 'fallback',
            key: key.toString('base64'),
            iv: iv.toString('base64'),
            tag: cipher.getAuthTag().toString('base64'),
            content: encrypted.toString('base64')
        };
    }

    unprotectSecret(encryptedSecret) {
        if (!encryptedSecret) return null;

        if (encryptedSecret.provider === 'safeStorage') {
            if (!this.safeStorage?.isEncryptionAvailable()) {
                throw new Error('The operating system credential store is unavailable.');
            }
            return this.safeStorage.decryptString(Buffer.from(encryptedSecret.content, 'base64'));
        }

        if (encryptedSecret.provider === 'fallback') {
            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                Buffer.from(encryptedSecret.key, 'base64'),
                Buffer.from(encryptedSecret.iv, 'base64')
            );
            decipher.setAuthTag(Buffer.from(encryptedSecret.tag, 'base64'));
            return Buffer.concat([
                decipher.update(Buffer.from(encryptedSecret.content, 'base64')),
                decipher.final()
            ]).toString('utf8');
        }

        // Migrate the app's previous AES-CBC storage format.
        if (encryptedSecret.key && encryptedSecret.iv && encryptedSecret.content) {
            const decipher = crypto.createDecipheriv(
                'aes-256-cbc',
                Buffer.from(encryptedSecret.key, 'hex'),
                Buffer.from(encryptedSecret.iv, 'hex')
            );
            return decipher.update(encryptedSecret.content, 'hex', 'utf8') + decipher.final('utf8');
        }

        throw new Error('Unsupported stored token format.');
    }

    async parseResponse(response) {
        const text = await response.text();
        if (!text) return {};

        try {
            return JSON.parse(text);
        } catch {
            return { message: text };
        }
    }

    async startDeviceAuthorization(scopes = this.requiredScopes) {
        const body = new URLSearchParams({
            client_id: this.clientId,
            scopes: scopes.join(' ')
        });
        const response = await this.fetch('https://id.twitch.tv/oauth2/device', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
        });
        const data = await this.parseResponse(response);

        if (!response.ok || !data.device_code || !data.user_code || !data.verification_uri) {
            throw new Error(data.message || 'Twitch could not start device authorization.');
        }

        return data;
    }

    async exchangeDeviceCode(deviceCode, scopes = this.requiredScopes) {
        const body = new URLSearchParams({
            client_id: this.clientId,
            scopes: scopes.join(' '),
            device_code: deviceCode,
            grant_type: DEVICE_GRANT
        });
        const response = await this.fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
        });
        const data = await this.parseResponse(response);

        if (response.ok && data.access_token) {
            return { pending: false, tokenData: data };
        }

        if (response.status === 400 && data.message === 'authorization_pending') {
            return { pending: true };
        }

        throw new Error(data.message || 'Twitch authorization failed.');
    }

    async refreshAccessToken(refreshToken) {
        const body = new URLSearchParams({
            client_id: this.clientId,
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        });
        const response = await this.fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
        });
        const data = await this.parseResponse(response);

        if (!response.ok || !data.access_token) {
            const error = new Error(data.message || 'Twitch could not refresh the session.');
            error.status = response.status;
            throw error;
        }

        return data;
    }

    async fetchUser(accessToken) {
        const response = await this.fetch('https://api.twitch.tv/helix/users', {
            headers: {
                'Client-ID': this.clientId,
                'Authorization': `Bearer ${accessToken}`
            }
        });
        const data = await this.parseResponse(response);

        if (!response.ok || !Array.isArray(data.data) || !data.data[0]) {
            throw new Error(data.message || 'Twitch did not return an account profile.');
        }

        return data.data[0];
    }

    async validateToken(token) {
        try {
            const response = await this.fetch('https://id.twitch.tv/oauth2/validate', {
                headers: { 'Authorization': `OAuth ${token}` }
            });
            const data = await this.parseResponse(response);

            if (response.ok && data.client_id === this.clientId) {
                return { valid: true, data };
            }

            return {
                valid: false,
                error: data.message || `Token validation failed with status ${response.status}`
            };
        } catch (error) {
            this.logger.error('Token validation error:', error);
            return { valid: false, transient: true, error: error.message };
        }
    }

    hasRequiredScopes(scopes = []) {
        const grantedScopes = new Set(scopes);
        return this.requiredScopes.every(scope => grantedScopes.has(scope));
    }

    async saveToken(tokenData) {
        try {
            const validationResult = await this.validateToken(tokenData.access_token);
            if (!validationResult.valid) {
                this.logger.warn('Refusing to save an invalid Twitch token:', validationResult.error);
                return false;
            }

            if (!this.hasRequiredScopes(validationResult.data.scopes)) {
                this.logger.warn('The Twitch token is missing required scopes.');
                return false;
            }

            const dataToStore = {
                version: 2,
                id: tokenData.id,
                login: tokenData.login,
                email: tokenData.email,
                profile_image_url: tokenData.profile_image_url,
                display_name: tokenData.display_name,
                scopes: validationResult.data.scopes,
                expiresAt: Date.now() + validationResult.data.expires_in * 1000,
                encryptedToken: this.protectSecret(tokenData.access_token),
                encryptedRefreshToken: this.protectSecret(tokenData.refresh_token)
            };

            fs.mkdirSync(path.dirname(this.tokenFilePath), { recursive: true });
            const temporaryPath = `${this.tokenFilePath}.tmp`;
            fs.writeFileSync(temporaryPath, JSON.stringify(dataToStore, null, 2), { mode: 0o600 });
            fs.renameSync(temporaryPath, this.tokenFilePath);
            return true;
        } catch (error) {
            this.logger.error('Error saving Twitch token:', error);
            return false;
        }
    }

    async getStoredToken() {
        if (!fs.existsSync(this.tokenFilePath)) return null;

        try {
            const tokenData = JSON.parse(fs.readFileSync(this.tokenFilePath, 'utf8'));
            let accessToken = this.unprotectSecret(tokenData.encryptedToken);
            let refreshToken = this.unprotectSecret(tokenData.encryptedRefreshToken);
            const originalAccessToken = accessToken;
            let didRefresh = false;
            let validationResult = await this.validateToken(accessToken);

            if (validationResult.transient) {
                if (!this.hasRequiredScopes(tokenData.scopes)) return null;
                return {
                    id: tokenData.id,
                    login: tokenData.login,
                    email: tokenData.email,
                    profile_image_url: tokenData.profile_image_url,
                    display_name: tokenData.display_name,
                    access_token: accessToken,
                    refresh_token: refreshToken,
                    scopes: tokenData.scopes,
                    expiresAt: tokenData.expiresAt
                };
            }

            if (!validationResult.valid && refreshToken) {
                try {
                    const refreshed = await this.refreshAccessToken(refreshToken);
                    accessToken = refreshed.access_token;
                    refreshToken = refreshed.refresh_token || refreshToken;
                    didRefresh = true;
                    validationResult = await this.validateToken(accessToken);
                } catch (error) {
                    this.logger.warn('Unable to refresh the Twitch session:', error);
                    if (!error.status || error.status >= 500) {
                        return {
                            id: tokenData.id,
                            login: tokenData.login,
                            email: tokenData.email,
                            profile_image_url: tokenData.profile_image_url,
                            display_name: tokenData.display_name,
                            access_token: originalAccessToken,
                            refresh_token: refreshToken,
                            scopes: tokenData.scopes,
                            expiresAt: tokenData.expiresAt
                        };
                    }
                }
            }

            if (!validationResult.valid || !this.hasRequiredScopes(validationResult.data.scopes)) {
                this.clearToken();
                return null;
            }

            const result = {
                id: tokenData.id || validationResult.data.user_id,
                login: tokenData.login || validationResult.data.login,
                email: tokenData.email,
                profile_image_url: tokenData.profile_image_url,
                display_name: tokenData.display_name || tokenData.login || validationResult.data.login,
                access_token: accessToken,
                refresh_token: refreshToken,
                scopes: validationResult.data.scopes,
                expiresAt: Date.now() + validationResult.data.expires_in * 1000
            };

            // Refresh token rotation and migration from the previous storage
            // format are persisted atomically here.
            if (tokenData.version !== 2 || didRefresh || accessToken !== originalAccessToken) {
                await this.saveToken(result);
            }

            return result;
        } catch (error) {
            this.logger.error('Error retrieving Twitch token:', error);
            this.clearToken();
            return null;
        }
    }

    async revokeToken(token) {
        if (!token) return true;

        try {
            const response = await this.fetch('https://id.twitch.tv/oauth2/revoke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ client_id: this.clientId, token })
            });
            return response.ok;
        } catch (error) {
            this.logger.warn('Unable to revoke the Twitch token:', error);
            return false;
        }
    }

    clearToken() {
        try {
            if (fs.existsSync(this.tokenFilePath)) {
                fs.unlinkSync(this.tokenFilePath);
            }
            return true;
        } catch (error) {
            this.logger.error('Error clearing Twitch token:', error);
            return false;
        }
    }
}

module.exports = AuthManager;
