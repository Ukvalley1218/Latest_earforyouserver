import axios from 'axios';
import TokenStore from './TokenStore.js';
import dotenv from 'dotenv';

dotenv.config();

const getNewToken = async () => {
    try {
        const tokenUrl = `https://accounts.zoho.in/oauth/v2/token?client_id=${process.env.ZOHO_CLIENT_ID}&client_secret=${process.env.ZOHO_CLIENT_SECRET}&grant_type=client_credentials&scope=ZohoMail.partner.organization.UPDATE`;

        const response = await axios.post(tokenUrl);

        if (!response.data.access_token) {
            throw new Error('No access token received from Zoho');
        }

        await TokenStore.create({
            reason: 'access_token',
            token: response.data.access_token
        });

        return response.data.access_token;
    } catch (error) {
        console.error('Error getting new token:', error);
        throw error;
    }
};

const generateTokens = async () => {
    try {
        const existingToken = await TokenStore.findOne({ reason: 'access_token' });
        if (existingToken) {
            return { access_token: existingToken.token };
        }

        const access_token = await getNewToken();
        if (!access_token) {
            throw new Error('Failed to generate access token');
        }
        return { access_token };
    } catch (error) {
        console.error('Token generation failed:', error);
        throw error;
    }
};

const getAccessToken = async () => {
    try {
        const token = await TokenStore.findOne({ reason: 'access_token' })
            .sort({ createdAt: -1 });
        return token ? token.token : null;
    } catch (error) {
        console.error('Error retrieving token:', error);
        throw error;
    }
};

const refreshAccessToken = async () => {
    try {
        const access_token = await getNewToken();
        if (!access_token) {
            throw new Error('Failed to refresh access token');
        }
        return { access_token };
    } catch (error) {
        console.error('Token refresh failed:', error);
        throw error;
    }
};

const addToMailingList = async (name, email) => {
    try {
        let accessToken = await getAccessToken();

        if (!accessToken) {
            const tokens = await generateTokens();
            accessToken = tokens.access_token;
        }

        if (!accessToken) {
            throw new Error('Unable to obtain access token');
        }

        const contactInfo = encodeURIComponent(
            JSON.stringify({
                'Name': name,
                'Email': email,
            })
        );

        const url = `${process.env.ZOHO_API_URL}?resfmt=JSON&listkey=${process.env.ZOHO_LIST_KEY}&contactinfo=${contactInfo}&source=web`;

        try {
            const response = await axios.get(url, {
                headers: {
                    Authorization: `Zoho-oauthtoken ${accessToken}`,
                },
            });
            return response.data;
        } catch (error) {
            if (error.response?.data?.message === 'Unauthorized request.') {
                const tokens = await refreshAccessToken();
                accessToken = tokens.access_token;

                if (!accessToken) {
                    throw new Error('Failed to refresh token');
                }

                const retryResponse = await axios.get(url, {
                    headers: {
                        Authorization: `Zoho-oauthtoken ${accessToken}`,
                    },
                });
                return retryResponse.data;
            }
            throw error;
        }
    } catch (error) {
        console.error('Mailing list operation failed:', error);
        throw error;
    }
};

export { generateTokens, getAccessToken, refreshAccessToken, addToMailingList };