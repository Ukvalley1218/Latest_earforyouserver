import axios from 'axios';
import ZohoToken from '../models/TokenStore'; // Ensure this path is correct based on your folder structure
import dotenv from 'dotenv';

dotenv.config();

// Get the latest Zoho access token from the DB
export const getZohoAccessToken = async () => {
    try {
        const token = await ZohoToken.findOne({ reason: 'access_token' }).sort({ createdAt: -1 });
        return token ? token.token : null;
    } catch (error) {
        console.error('Error retrieving Zoho access token:', error.message);
        throw error;
    }
};

// Refresh Zoho Access Token
export const refreshZohoAccessToken = async () => {
    try {
        const refreshToken = await ZohoToken.findOne({ reason: 'refresh_token' }).sort({ createdAt: -1 });

        if (!refreshToken) {
            throw new Error('Refresh token not found in the database.');
        }

        const tokenUrl = `https://accounts.zoho.in/oauth/v2/token?client_id=${process.env.ZOHO_CLIENT_ID}&client_secret=${process.env.ZOHO_CLIENT_SECRET}&grant_type=refresh_token&refresh_token=${refreshToken.token}`;

        const response = await axios.post(tokenUrl);

        const { access_token } = response.data;

        if (access_token) {
            await ZohoToken.create({ reason: 'access_token', token: access_token });
            console.log('Zoho Access Token Refreshed');
            return access_token;
        }

        throw new Error('Access token not returned from Zoho');
    } catch (error) {
        console.error('Failed to refresh access token:', error.message);
        throw error;
    }
};

// Add user to Zoho mailing list
export const addUserToMailingList = async (name, lastname, email) => {
    try {
        let accessToken = await getZohoAccessToken();

        if (!accessToken) {
            console.log('Access token missing, refreshing...');
            accessToken = await refreshZohoAccessToken();
        }

        const contactInfo = encodeURIComponent(
            JSON.stringify({
                'First Name': name,
                'Last Name': lastname,
                'Contact Email': email,
            })
        );

        const url = `${process.env.ZOHO_API_URL}?resfmt=JSON&listkey=${process.env.ZOHO_LIST_KEY}&contactinfo=${contactInfo}&source=web`;

        const response = await axios.get(url, {
            headers: {
                Authorization: `Zoho-oauthtoken ${accessToken}`,
            },
        });

        if (response.data.message === 'Unauthorized request.') {
            console.log('Access token expired, refreshing...');
            accessToken = await refreshZohoAccessToken();
            return addUserToMailingList(name, lastname, email); // Retry with new token
        }

        return response.data;
    } catch (error) {
        console.error('Error adding user to Zoho mailing list:', error.message);
        throw error;
    }
};
