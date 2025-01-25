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
        // Comprehensive scope definition


        // Validate critical environment variables
        const requiredVars = [
            'ZOHO_CLIENT_ID',
            'ZOHO_CLIENT_SECRET',
            'ZOHO_REFRESH_TOKEN'
        ];

        requiredVars.forEach(varName => {
            if (!process.env[varName]) {
                throw new Error(`Missing environment variable: ${varName}`);
            }
        });

        // Prepare request parameters
        const params = new URLSearchParams({
            refresh_token: process.env.ZOHO_REFRESH_TOKEN,
            client_id: process.env.ZOHO_CLIENT_ID,
            client_secret: process.env.ZOHO_CLIENT_SECRET,
            grant_type: 'refresh_token',
            scope: 'ZohoMail.contacts.CREAT'
        });

        // Detailed pre-request logging
        console.log('Token Refresh Attempt', {
            clientIdPartial: process.env.ZOHO_CLIENT_ID?.substring(0, 5) + '...',
            refreshTokenLength: process.env.ZOHO_REFRESH_TOKEN?.length,
            scopes: FULL_SCOPES
        });

        // Make token refresh request
        const response = await axios.post(
            'https://accounts.zoho.in/oauth/v2/token?refresh_token=1000.bec60de8f76f4ec9f1e3958f182f2d18.d3500c440f9d90b07f6d7eb51266d3fd&client_id=1000.M9PNU2DDSI2RFY2K2HVLTCY4153HTN&client_secret=c1217b89fccf397a715ddb7a1b56df5d068494db4c&grant_type=refresh_token',
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'YourAppName/1.0'
                },
                timeout: 10000 // 10 second timeout
            }
        );

        // Comprehensive response validation
        if (response.data.error) {
            console.error('Zoho API Token Error:', response.data);
            throw new Error(`Zoho API Error: ${response.data.error}`);
        }

        // Store new access token
        const newToken = await ZohoToken.create({
            reason: 'access_token',
            token: response.data.access_token
        });

        // Success logging
        console.log('Token Refresh Success', {
            newTokenPartial: newToken.token?.substring(0, 10) + '...',
            tokenExpiresIn: response.data.expires_in
        });

        return {
            access_token: newToken.token,
            expires_in: response.data.expires_in
        };

    } catch (error) {
        // Extremely detailed error logging
        console.error('Token Refresh Failure', {
            errorType: error.constructor.name,
            errorMessage: error.message,
            errorCode: error.code,
            responseStatus: error.response?.status,
            responseData: JSON.stringify(error.response?.data),
            fullError: error
        });

        // Comprehensive error handling
        if (error.response) {
            switch (error.response.status) {
                case 400:
                    throw new Error(`Invalid request: ${error.response.data.error}`);
                case 401:
                    throw new Error('Authentication failed - verify credentials');
                case 403:
                    throw new Error('Access forbidden - check permissions');
                default:
                    throw new Error(`Token refresh failed: ${error.message}`);
            }
        }

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

// const addToMailingList = async (email) => {
//     try {
//         // Always refresh token before making request
//         const { access_token } = await refreshAccessToken();

//         const url = 'https://campaigns.zoho.in/api/v1.1/json/listsubscribe';

//         const response = await axios.get(url, {
//             params: {
//                 listkey: process.env.ZOHO_LIST_KEY,
//                 contactinfo: JSON.stringify({
//                     'Contact Email': email,
//                     'Email': email
//                 }),
//                 resfmt: 'JSON',
//                 source: 'web'
//             },
//             headers: {
//                 'Authorization': `Zoho-oauthtoken ${access_token}`,
//                 'Content-Type': 'application/json'
//             }
//         });

//         // Detailed logging
//         console.log('Full Zoho Response:', response.data);

//         if (response.data.status === 'success') {
//             return { success: true, message: 'Email added successfully' };
//         } else {
//             throw new Error(response.data.message || 'Failed to add email');
//         }
//     } catch (error) {
//         console.error('Mailing List Error:', error.response?.data || error.message);
//         return { 
//             success: false, 
//             message: error.response?.data?.message || error.message 
//         };
//     }
// };

const addToMailingList = async (email) => {
    const debugInfo = {
        timestamp: new Date().toISOString(),
        email,
        steps: []
    };

    try {
        // Detailed token retrieval logging
        debugInfo.steps.push({
            stage: 'Token Retrieval',
            startTime: Date.now()
        });

        const { access_token } = await refreshAccessToken();

        debugInfo.steps[debugInfo.steps.length - 1].endTime = Date.now();
        debugInfo.steps[debugInfo.steps.length - 1].duration =
            debugInfo.steps[debugInfo.steps.length - 1].endTime -
            debugInfo.steps[debugInfo.steps.length - 1].startTime;

        // Comprehensive request configuration logging
        const requestConfig = {
            url: 'https://campaigns.zoho.in/api/v1.1/json/listsubscribe',
            method: 'GET',
            params: {
                listkey: process.env.ZOHO_LIST_KEY,
                contactinfo: JSON.stringify({
                    'Contact Email': email,
                    'Email': email,
                    'First Name': email.split('@')[0]
                }),
                resfmt: 'JSON',
                source: 'web'
            },
            headers: {
                'Authorization': `Zoho-oauthtoken ${access_token}`,
                'Content-Type': 'application/json'
            }
        };

        debugInfo.steps.push({
            stage: 'Request Configuration',
            requestDetails: {
                url: requestConfig.url,
                params: Object.keys(requestConfig.params),
                headersSet: Object.keys(requestConfig.headers)
            }
        });

        // Performance tracking for API call
        const startTime = Date.now();
        const response = await axios.get(
            requestConfig.url,
            {
                params: requestConfig.params,
                headers: requestConfig.headers
            }
        );
        const endTime = Date.now();

        debugInfo.steps.push({
            stage: 'API Response',
            responseTime: endTime - startTime,
            statusCode: response.status,
            responseData: response.data
        });

        // Comprehensive response handling
        if (response.data.status === 'success') {
            debugInfo.result = 'Success';
            console.log(JSON.stringify({
                type: 'ZOHO_MAILING_LIST_SUCCESS',
                ...debugInfo
            }, null, 2));

            return {
                success: true,
                message: 'Email added successfully',
                debugInfo
            };
        } else {
            throw new Error(response.data.message || 'Failed to add email');
        }
    } catch (error) {
        debugInfo.result = 'Failure';
        debugInfo.errorDetails = {
            message: error.message,
            code: error.code,
            responseData: error.response?.data
        };

        console.error(JSON.stringify({
            type: 'ZOHO_MAILING_LIST_ERROR',
            ...debugInfo
        }, null, 2));

        return {
            success: false,
            message: error.response?.data?.message || error.message,
            debugInfo
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