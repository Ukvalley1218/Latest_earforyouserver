import axios from 'axios';
import ZohoToken from '../models/TokenStore.js';
import dotenv from 'dotenv';

dotenv.config();

// Function to generate authorization URL for Zoho OAuth
const getAuthorizationCode = () => {
    const authUrl = new URL('https://accounts.zoho.in/oauth/v2/auth');
    const params = {
        client_id: process.env.ZOHO_CLIENT_ID,
        response_type: 'code',
        scope: 'ZohoMail.contacts.CREATE',
        redirect_uri: process.env.ZOHO_REDIRECT_URI,
        access_type: 'offline',
        prompt: 'consent'
    };

    Object.entries(params).forEach(([key, value]) => {
        authUrl.searchParams.append(key, value || '');
    });

    return authUrl.toString();
};

// Function to handle Zoho OAuth callback and store tokens
const handleCallback = async (code) => {
    try {
        const params = new URLSearchParams({
            code,
            client_id: process.env.ZOHO_CLIENT_ID,
            client_secret: process.env.ZOHO_CLIENT_SECRET,
            redirect_uri: process.env.ZOHO_REDIRECT_URI,
            grant_type: 'authorization_code'
        });

        const response = await axios.post(
            'https://accounts.zoho.in/oauth/v2/token',
            params.toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        if (response.data.error) {
            throw new Error(`Zoho API error: ${response.data.error}`);
        }

        // Store tokens securely in DB
        await ZohoToken.create({
            reason: 'access_token',
            token: response.data.access_token
        });

        if (response.data.refresh_token) {
            process.env.ZOHO_REFRESH_TOKEN = response.data.refresh_token;
        }

        console.log('OAuth response:', response.data);
        return response.data;
    } catch (error) {
        console.error('Callback error:', error);
        throw error;
    }
};

// Function to obtain new access token using refresh token
const getNewToken = async () => {
    try {
        if (!process.env.ZOHO_REFRESH_TOKEN) {
            throw new Error('Missing Zoho refresh token');
        }

        const params = new URLSearchParams({
            client_id: process.env.ZOHO_CLIENT_ID,
            client_secret: process.env.ZOHO_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: process.env.ZOHO_REFRESH_TOKEN,
            scope: 'ZohoMail.partner.organization.UPDATE'
        });

        const response = await axios.post(
            'https://accounts.zoho.in/oauth/v2/token',
            params.toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        if (response.data.error) {
            throw new Error(`Zoho API error: ${response.data.error}`);
        }

        await ZohoToken.create({
            reason: 'access_token',
            token: response.data.access_token
        });

        return response.data.access_token;
    } catch (error) {
        console.error('Error getting new token:', error.message);
        throw error;
    }
};

// Function to check if access token exists or generate a new one
const generateTokens = async () => {
    try {
        const existingToken = await ZohoToken.findOne({ reason: 'access_token' }).sort({ createdAt: -1 });
        if (existingToken) {
            return { access_token: existingToken.token };
        }

        const access_token = await getNewToken();
        return { access_token };
    } catch (error) {
        console.error('Token generation failed:', error);
        throw error;
    }
};

// Function to retrieve the latest access token from the database
const getAccessToken = async () => {
    try {
        const token = await ZohoToken.findOne({ reason: 'access_token' }).sort({ createdAt: -1 });
        return token ? token.token : null;
    } catch (error) {
        console.error('Error retrieving token:', error);
        throw error;
    }
};

// Function to refresh the Zoho access token using refresh token
const refreshAccessToken = async () => {
    try {
        if (!process.env.ZOHO_REFRESH_TOKEN) {
            throw new Error('Missing Zoho refresh token');
        }

        const params = new URLSearchParams({
            client_id: process.env.ZOHO_CLIENT_ID,
            client_secret: process.env.ZOHO_CLIENT_SECRET,
            refresh_token: process.env.ZOHO_REFRESH_TOKEN,
            grant_type: 'refresh_token',
            scope: 'ZohoMail.partner.organization.UPDATE'
        });

        const response = await axios.post(
            'https://accounts.zoho.in/oauth/v2/token',
            params.toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        if (response.data.error) {
            throw new Error(`Zoho API error: ${response.data.error}`);
        }

        const newToken = await ZohoToken.create({
            reason: 'access_token',
            token: response.data.access_token
        });

        return { access_token: newToken.token };
    } catch (error) {
        console.error('Token refresh failed:', error.message);
        throw error;
    }
};

// Function to add an email to Zoho mailing list
// Debug logger
const debugLog = (message, data) => {
    console.log(`[DEBUG] ${message}:`, JSON.stringify(data, null, 2));
};

// Token validation with debug
const validateToken = async (accessToken) => {
    debugLog('Validating token', { accessToken: accessToken?.substring(0, 10) + '...' });

    try {
        const testUrl = 'https://campaigns.zoho.in/api/v1.1/json/listsubscribedetails';
        debugLog('Making validation request to', { url: testUrl });

        const response = await axios.get(testUrl, {
            params: {
                listkey: process.env.ZOHO_LIST_KEY
            },
            headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`
            }
        });

        debugLog('Validation response', {
            status: response.status,
            headers: response.headers,
            data: response.data
        });

        return response.status === 200;
    } catch (error) {
        debugLog('Validation error', {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status
        });

        if (error.response?.data?.message === 'Unauthorized request.') {
            return false;
        }
        throw error;
    }
};

const addToMailingList = async (email) => {
    debugLog('Starting mailing list operation', { email });

    try {
        let accessToken = await getAccessToken();
        debugLog('Initial access token', {
            exists: !!accessToken,
            token: accessToken ? accessToken.substring(0, 10) + '...' : null
        });

        // Token validation
        const isValid = await validateToken(accessToken);
        debugLog('Token validation result', { isValid });

        if (!accessToken || !isValid) {
            debugLog('Generating new tokens');
            const tokens = await generateTokens();
            accessToken = tokens.access_token;
            debugLog('New token generated', {
                token: accessToken.substring(0, 10) + '...',
                tokenInfo: tokens
            });
        }

        const data = {
            listkey: process.env.ZOHO_LIST_KEY,
            emailids: email,
            source: "web"
        };
        debugLog('Request payload', data);

        const url = 'https://campaigns.zoho.in/api/v1.1/json/listsubscribe';

        try {
            debugLog('Making subscription request', { url });
            const response = await axios.post(url, data, {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            debugLog('Subscription response', {
                status: response.status,
                data: response.data
            });

            if (response.data.status !== 'success') {
                throw new Error('Failed to add email to mailing list');
            }

            return await verifySubscription(email, accessToken);

        } catch (error) {
            debugLog('Subscription error', {
                message: error.message,
                response: error.response?.data,
                stack: error.stack
            });

            if (error.response?.data?.message === 'Unauthorized request.') {
                debugLog('Token expired, refreshing');
                const tokens = await refreshAccessToken();
                return await retrySubscription(email, tokens.access_token);
            }
            throw error;
        }
    } catch (error) {
        debugLog('Operation failed', {
            message: error.message,
            stack: error.stack,
            response: error.response?.data
        });

        return {
            success: false,
            message: error.message,
            error: error
        };
    }
};

const verifySubscription = async (email, accessToken) => {
    debugLog('Verifying subscription', { email });

    const verifyUrl = 'https://campaigns.zoho.in/api/v1.1/json/listsubscribedetails';
    debugLog('Making verification request', { url: verifyUrl });

    const verifyResponse = await axios.get(verifyUrl, {
        params: {
            listkey: process.env.ZOHO_LIST_KEY,
            email: email
        },
        headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`
        }
    });

    debugLog('Verification response', {
        status: verifyResponse.status,
        data: verifyResponse.data
    });

    if (verifyResponse.data.list_subscribe_details?.subscribed === true) {
        return {
            success: true,
            message: 'Email successfully added and verified',
            details: verifyResponse.data.list_subscribe_details
        };
    }
    throw new Error('Email addition could not be verified');
};

const retrySubscription = async (email, newAccessToken) => {
    debugLog('Retrying subscription', {
        email,
        newToken: newAccessToken.substring(0, 10) + '...'
    });

    const data = {
        listkey: process.env.ZOHO_LIST_KEY,
        emailids: email,
        source: "web"
    };

    const url = 'https://campaigns.zoho.in/api/v1.1/json/listsubscribe';
    debugLog('Making retry request', { url, data });

    const retryResponse = await axios.post(url, data, {
        headers: {
            'Authorization': `Zoho-oauthtoken ${newAccessToken}`,
            'Content-Type': 'application/json'
        }
    });

    debugLog('Retry response', {
        status: retryResponse.status,
        data: retryResponse.data
    });

    if (retryResponse.data.status === 'success') {
        return {
            success: true,
            message: 'Email added after token refresh',
            details: retryResponse.data
        };
    }
    throw new Error('Retry failed after token refresh');
};

export {
    generateTokens,
    getAccessToken,
    refreshAccessToken,
    addToMailingList,
    getAuthorizationCode,
    handleCallback
};
