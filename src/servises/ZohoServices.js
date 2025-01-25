import axios from 'axios';
import ZohoToken from '../models/TokenStore.js';
import dotenv from 'dotenv';

dotenv.config();

const ZOHO_SCOPES = 'ZohoMail.contacts.CREATE,ZohoMail.partner.organization.UPDATE,ZohoCampaigns.contact.CREATE';

const debugLog = (message, data) => {
    console.log(`[DEBUG] ${message}:`, JSON.stringify(data, null, 2));
};

const getAuthorizationCode = () => {
    const authUrl = new URL('https://accounts.zoho.in/oauth/v2/auth');
    const params = {
        client_id: process.env.ZOHO_CLIENT_ID,
        response_type: 'code',
        scope: ZOHO_SCOPES,
        redirect_uri: process.env.ZOHO_REDIRECT_URI,
        access_type: 'offline',
        prompt: 'consent'
    };

    Object.entries(params).forEach(([key, value]) => {
        authUrl.searchParams.append(key, value || '');
    });

    return authUrl.toString();
};

const handleCallback = async (code) => {
    try {
        const params = new URLSearchParams({
            code,
            client_id: process.env.ZOHO_CLIENT_ID,
            client_secret: process.env.ZOHO_CLIENT_SECRET,
            redirect_uri: process.env.ZOHO_REDIRECT_URI,
            grant_type: 'authorization_code',
            scope: ZOHO_SCOPES
        });

        const response = await axios.post(
            'https://accounts.zoho.in/oauth/v2/token',
            params.toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );

        if (response.data.error) throw new Error(`Zoho API error: ${response.data.error}`);

        await ZohoToken.create({
            reason: 'access_token',
            token: response.data.access_token
        });

        if (response.data.refresh_token) {
            process.env.ZOHO_REFRESH_TOKEN = response.data.refresh_token;
        }

        debugLog('OAuth success', response.data);
        return response.data;
    } catch (error) {
        debugLog('OAuth error', error);
        throw error;
    }
};

const refreshAccessToken = async () => {
    try {
        if (!process.env.ZOHO_REFRESH_TOKEN) throw new Error('Missing refresh token');

        const params = new URLSearchParams({
            client_id: process.env.ZOHO_CLIENT_ID,
            client_secret: process.env.ZOHO_CLIENT_SECRET,
            refresh_token: process.env.ZOHO_REFRESH_TOKEN,
            grant_type: 'refresh_token',
            scope: ZOHO_SCOPES
        });

        const response = await axios.post(
            'https://accounts.zoho.in/oauth/v2/token',
            params.toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );

        if (response.data.error) throw new Error(`Zoho API error: ${response.data.error}`);

        const newToken = await ZohoToken.create({
            reason: 'access_token',
            token: response.data.access_token
        });

        debugLog('Token refreshed', { newToken: newToken.token?.substring(0, 10) + '...' });
        return { access_token: newToken.token };
    } catch (error) {
        debugLog('Token refresh failed', error);
        throw error;
    }
};

const getAccessToken = async () => {
    try {
        const token = await ZohoToken.findOne({ reason: 'access_token' }).sort({ createdAt: -1 });
        return token ? token.token : null;
    } catch (error) {
        debugLog('Token retrieval failed', error);
        throw error;
    }
};

const generateTokens = async () => {
    try {
        const existingToken = await ZohoToken.findOne({ reason: 'access_token' }).sort({ createdAt: -1 });
        if (existingToken) return { access_token: existingToken.token };

        const access_token = await refreshAccessToken();
        return access_token;
    } catch (error) {
        debugLog('Token generation failed', error);
        throw error;
    }
};

const addToMailingList = async (email) => {
    try {
        debugLog('Starting mailing list operation', { email });
        let accessToken = await getAccessToken();
        debugLog('Initial token', { token: accessToken?.substring(0, 10) + '...' });

        const data = {
            listkey: process.env.ZOHO_LIST_KEY,
            emailids: email,
            source: "web"
        };

        const url = 'https://campaigns.zoho.in/api/v1.1/json/listsubscribe';

        const makeRequest = async (token) => {
            const response = await axios.post(url, data, {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                transformResponse: [(data) => {
                    const match = data.match(/<message>(.*?)<\/message>/);
                    const status = data.match(/<status>(.*?)<\/status>/)?.[1];
                    return {
                        status,
                        message: match?.[1] || 'Unknown error',
                        rawResponse: data
                    };
                }]
            });
            debugLog('Response', { status: response.status, data: response.data });
            return response;
        };

        try {
            const response = await makeRequest(accessToken);

            if (response.data.message === 'Unauthorized request') {

                debugLog('Token expired, refreshing');
                const tokens = await refreshAccessToken();
                const retryResponse = await makeRequest(tokens.access_token);

                if (retryResponse.data.status === 'success') {
                    return {
                        success: true,
                        message: 'Email added after token refresh',
                        data: retryResponse.data
                    };
                }

                throw new Error(response.data.message);
            }

            return {
                success: true,
                message: 'Email successfully added',
                data: response.data
            };

        } catch (error) {
            debugLog('Request error', error);
            throw error;
        }
    } catch (error) {
        debugLog('Operation failed', error);
        return {
            success: false,
            message: error.message,
            error: error
        };
    }
};

export {
    generateTokens,
    getAccessToken,
    refreshAccessToken,
    addToMailingList,
    getAuthorizationCode,
    handleCallback
};