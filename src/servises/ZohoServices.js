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
const addToMailingList = async (email) => {
    try {
        let accessToken = await getAccessToken();

        if (!accessToken) {
            const tokens = await generateTokens();
            accessToken = tokens.access_token;
        }

        const data = {
            listkey: process.env.ZOHO_LIST_KEY,
            emailids: email,
            source: "web"
        };

        const url = 'https://campaigns.zoho.in/api/v1.1/json/listsubscribe';

        try {
            const response = await axios.post(url, data, {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            // Verify successful addition
            if (response.data.status === 'success') {
                console.log(`Email ${email} successfully added to mailing list`);

                // Query to verify subscription
                const verifyUrl = 'https://campaigns.zoho.in/api/v1.1/json/listsubscribedetails';
                const verifyResponse = await axios.get(verifyUrl, {
                    params: {
                        listkey: process.env.ZOHO_LIST_KEY,
                        email: email
                    },
                    headers: {
                        'Authorization': `Zoho-oauthtoken ${accessToken}`
                    }
                });

                if (verifyResponse.data.list_subscribe_details?.subscribed === true) {
                    return {
                        success: true,
                        message: 'Email successfully added and verified',
                        details: verifyResponse.data.list_subscribe_details
                    };
                }

                throw new Error('Email addition could not be verified');
            }

            throw new Error('Failed to add email to mailing list');

        } catch (error) {
            if (error.response?.data?.message === 'Unauthorized request.') {
                console.warn('Token expired, refreshing...');
                const tokens = await refreshAccessToken();
                accessToken = tokens.access_token;

                const retryResponse = await axios.post(url, data, {
                    headers: {
                        'Authorization': `Zoho-oauthtoken ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                });

                // Verify retry success
                if (retryResponse.data.status === 'success') {
                    return {
                        success: true,
                        message: 'Email added after token refresh',
                        details: retryResponse.data
                    };
                }
            }
            throw error;
        }
    } catch (error) {
        console.error('Mailing list operation failed:', error);
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
