const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AuthManager = require('../authManager');

const logger = {
    info() {},
    warn() {},
    error() {}
};

const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`protected:${value}`),
    decryptString: value => value.toString().replace(/^protected:/, '')
};

function response(status, data) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => data === undefined ? '' : JSON.stringify(data)
    };
}

test('starts Twitch device authorization with the required scopes', async () => {
    let request;
    const manager = new AuthManager(os.tmpdir(), logger, null, {
        clientId: 'client-id',
        requiredScopes: ['bits:read', 'user:read:email'],
        safeStorage,
        fetch: async (url, options) => {
            request = { url, options };
            return response(200, {
                device_code: 'device-secret',
                user_code: 'ABCD1234',
                verification_uri: 'https://www.twitch.tv/activate',
                expires_in: 1800,
                interval: 5
            });
        }
    });

    const result = await manager.startDeviceAuthorization();
    assert.equal(result.user_code, 'ABCD1234');
    assert.equal(request.url, 'https://id.twitch.tv/oauth2/device');
    assert.equal(request.options.body.get('client_id'), 'client-id');
    assert.equal(request.options.body.get('scopes'), 'bits:read user:read:email');
});

test('recognizes a pending device authorization response', async () => {
    const manager = new AuthManager(os.tmpdir(), logger, null, {
        clientId: 'client-id',
        requiredScopes: ['bits:read'],
        safeStorage,
        fetch: async () => response(400, { status: 400, message: 'authorization_pending' })
    });

    assert.deepEqual(await manager.exchangeDeviceCode('device-secret'), { pending: true });
});

test('stores access and refresh tokens using OS-backed encryption', async t => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-auth-test-'));
    t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

    const manager = new AuthManager(temporaryDirectory, logger, null, {
        clientId: 'client-id',
        requiredScopes: ['bits:read'],
        safeStorage,
        fetch: async () => response(200, {
            client_id: 'client-id',
            user_id: '123',
            login: 'streamer',
            scopes: ['bits:read'],
            expires_in: 3600
        })
    });

    const saved = await manager.saveToken({
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        id: '123',
        login: 'streamer',
        display_name: 'Streamer'
    });
    assert.equal(saved, true);

    const storedFile = fs.readFileSync(path.join(temporaryDirectory, 'twitch_auth.json'), 'utf8');
    assert.equal(storedFile.includes('access-secret'), false);
    assert.equal(storedFile.includes('refresh-secret'), false);
    assert.equal(JSON.parse(storedFile).encryptedToken.provider, 'safeStorage');

    const restored = await manager.getStoredToken();
    assert.equal(restored.access_token, 'access-secret');
    assert.equal(restored.refresh_token, 'refresh-secret');
});
