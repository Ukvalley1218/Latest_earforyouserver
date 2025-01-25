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
        const params = {
            refresh_token: '1000.bec60de8f76f4ec9f1e3958f182f2d18.d3500c440f9d90b07f6d7eb51266d3fd',
            client_id: '1000.M9PNU2DDSI2RFY2K2HVLTCY4153HTN',
            client_secret: 'c1217b89fccf397a715ddb7a1b56df5d068494db4c',
            grant_type: 'refresh_token'
        };

        const response = await axios.post(
            'https://accounts.zoho.in/oauth/v2/token',
            null,
            {
                params,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );

        console.log('Token Response:', response.data);

        if (response.data.error) {
            throw new Error(`Zoho API error: ${response.data.error}`);
        }

        // Store the new access token
        const newToken = await ZohoToken.create({
            reason: 'access_token',
            token: response.data.access_token
        });

        // Store the refresh token if it's not already stored
        const existingRefreshToken = await ZohoToken.findOne({ reason: 'refresh_token' });
        if (!existingRefreshToken) {
            await ZohoToken.create({
                reason: 'refresh_token',
                token: params.refresh_token
            });
        }

        return {
            success: true,
            message: 'Token generated and stored successfully',
            accessToken: newToken.token
        };

    } catch (error) {
        console.error('Token generation error:', error.message);
        return {
            success: false,
            message: error.message,
            error: error
        };
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
        // Log the list key value
        console.log('ZOHO_LIST_KEY:', process.env.ZOHO_LIST_KEY);

        // Always refresh token before making request
        const tokenResponse = await refreshAccessToken();
        console.log('Token Response:', tokenResponse.access_token);

        // if (!tokenResponse || !tokenResponse.access_token) {
        //     throw new Error('Failed to obtain access token');
        // }

        const access_token = tokenResponse.access_token;
        console.log("access_token",access_token);

        const url = 'https://campaigns.zoho.in/api/v1.1/json/listsubscribe';

        const requestBody = {
            listkey: process.env.ZOHO_LIST_KEY,
            resfmt: 'JSON',
            source: 'web',
            contactinfo: {
                'Contact Email': email,
                'Email': email
            }
        };

        // Log the complete request details
        console.log('Request URL:', url);
        console.log('Request Body:', JSON.stringify(requestBody, null, 2));
        console.log('Authorization Token Present:', !!access_token);

        const response = await axios.post(url, requestBody, {
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('Full Zoho Response:', response.data);

        if (response.data.status === 'success') {
            return { success: true, message: 'Email added successfully' };
        } else {
            throw new Error(response.data.message || 'Failed to add email');
        }
    } catch (error) {
        console.error('Mailing List Error:', error.message);
        return {
            success: false,
            message: error.message
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