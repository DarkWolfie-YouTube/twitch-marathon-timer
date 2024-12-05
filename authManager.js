const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { profile } = require('console');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

class AuthManager {
    constructor(userDataPath) {
        // Use the provided user data path instead of app.getPath
        this.tokenFilePath = path.join(userDataPath, 'twitch_auth.json');
    }

    // Encrypt sensitive data
    encrypt(text) {
        const algorithm = 'aes-256-cbc';
        const key = crypto.randomBytes(32);
        const iv = crypto.randomBytes(16);
        
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return {
            key: key.toString('hex'),
            iv: iv.toString('hex'),
            content: encrypted
        };
    }

    // Decrypt sensitive data
    decrypt(encryptedData, key, iv) {
        const algorithm = 'aes-256-cbc';
        
        const decipher = crypto.createDecipheriv(
            algorithm, 
            Buffer.from(key, 'hex'), 
            Buffer.from(iv, 'hex')
        );
        
        let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }

    async validateToken(token) {
        try {
            const response = await fetch('https://id.twitch.tv/oauth2/validate', {
                headers: {
                    'Authorization': `OAuth ${token}`
                }
            });

            if (response.status === 200) {
                const data = await response.json();
                console.log(data)
                return {
                    valid: true,
                    data: data
                };
            } else {
                return {
                    valid: false,
                    error: `Token validation failed with status ${response.status}`
                };
            }
        } catch (error) {
            console.error('Token validation error:', error);
            return {
                valid: false,
                error: error.message
            };
        }
    }

    // Save token to file
    async saveToken(tokenData) {
        try {
            // Validate the token first
            const validationResult = await this.validateToken(tokenData.access_token);
            if (!validationResult.valid) {
                console.log('Token is invalid:', validationResult.error);
                return false;
            }

            // Add expiration timestamp from validation response
            const tokenWithExpiry = {
                ...tokenData,
                expiresAt: Date.now() + (validationResult.data.expires_in * 1000) // convert to absolute timestamp
            };

            // Encrypt the access token
            const encryptedToken = this.encrypt(tokenData.access_token);
            
            // Store the encrypted token and metadata
            const dataToStore = {
                id: tokenData.id,
                login: tokenData.login,
                email: tokenData.email,
                profile_image_url: tokenData.profile_image_url,
                display_name: tokenData.display_name,
                expiresAt: tokenWithExpiry.expiresAt,
                encryptedToken: encryptedToken
            };

            // Ensure directory exists
            const dir = path.dirname(this.tokenFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Write to file
            fs.writeFileSync(this.tokenFilePath, JSON.stringify(dataToStore, null, 2));
            
            return true;
        } catch (error) {
            console.error('Error saving token:', error);
            return false;
        }
    }

    // Retrieve and validate token
    async getStoredToken() {
        try {
            // Check if file exists
            if (!fs.existsSync(this.tokenFilePath)) {
                return null;
            }

            // Read and parse token data
            const tokenData = JSON.parse(fs.readFileSync(this.tokenFilePath, 'utf8'));

            // Check if token has expired
            if (tokenData.expiresAt < Date.now()) {
                console.log('Token has expired');
                this.clearToken();
                return null;
            }

            // Decrypt the access token
            const accessToken = this.decrypt(
                tokenData.encryptedToken.content,
                tokenData.encryptedToken.key,
                tokenData.encryptedToken.iv
            );

            // Validate the token
            const validationResult = await this.validateToken(accessToken);
            if (!validationResult.valid) {
                console.log('Stored token is invalid:', validationResult.error);
                this.clearToken();
                return null;
            }

            return {
                // User details
                id: tokenData.id,
                login: tokenData.login,
                email: tokenData.email,
                profile_image_url: tokenData.profile_image_url,
                display_name: tokenData.display_name,
                access_token: accessToken,
                expiresAt: tokenData.expiresAt
            };
        } catch (error) {
            console.error('Error retrieving token:', error);
            return null;
        }
    }

    // Clear stored token
    clearToken() {
        try {
            if (fs.existsSync(this.tokenFilePath)) {
                fs.unlinkSync(this.tokenFilePath);
            }
            return true;
        } catch (error) {
            console.error('Error clearing token:', error);
            return false;
        }
    }

    // Check if a valid token exists
    async hasValidToken() {
        const token = await this.getStoredToken();
        return token !== null;
    }
}

module.exports = AuthManager;
