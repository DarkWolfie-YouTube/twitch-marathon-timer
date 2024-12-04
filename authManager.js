const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

    // Save token to file
    saveToken(tokenData) {
        try {
            // Add expiration timestamp
            const tokenWithExpiry = {
                ...tokenData,
                expiresAt: Date.now() + (tokenData.expires_in * 1000) // convert to absolute timestamp
            };

            // Encrypt the access token
            const encryptedToken = this.encrypt(tokenData.access_token);
            
            const secureTokenData = {
                // User details
                id: tokenData.id,
                login: tokenData.login,
                display_name: tokenData.display_name,
                profile_image_url: tokenData.profile_image_url,
                email: tokenData.email,

                // Token details
                scopes: tokenData.scopes,
                expiresAt: tokenWithExpiry.expiresAt,
                encryptedToken: encryptedToken
            };

            // Ensure directory exists
            const dir = path.dirname(this.tokenFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Write to file
            fs.writeFileSync(this.tokenFilePath, JSON.stringify(secureTokenData, null, 2));
            
            return true;
        } catch (error) {
            console.error('Error saving token:', error);
            return false;
        }
    }

    // Retrieve and validate token
    getStoredToken() {
        try {
            // Check if file exists
            if (!fs.existsSync(this.tokenFilePath)) {
                return null;
            }

            // Read token data
            const tokenData = JSON.parse(fs.readFileSync(this.tokenFilePath, 'utf8'));

            // Check if token is expired
            if (tokenData.expiresAt < Date.now()) {
                this.clearToken();
                return null;
            }

            // Decrypt the token
            const accessToken = this.decrypt(
                tokenData.encryptedToken.content, 
                tokenData.encryptedToken.key, 
                tokenData.encryptedToken.iv
            );

            return {
                // User details
                id: tokenData.id,
                login: tokenData.login,
                display_name: tokenData.display_name,
                profile_image_url: tokenData.profile_image_url,
                email: tokenData.email,

                // Token details
                access_token: accessToken,
                scopes: tokenData.scopes,
                expires_in: Math.floor((tokenData.expiresAt - Date.now()) / 1000)
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
    hasValidToken() {
        const token = this.getStoredToken();
        return token !== null;
    }
}

module.exports = AuthManager;
