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