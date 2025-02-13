import { getAuthorizationCode, handleCallback } from "../../servises/ZohoServices.js";

const generateAuthCode = (req, res) => {
    try {
        const authUrl = getAuthorizationCode();
        res.json({ authUrl });
    } catch (error) {
        console.error('Error generating auth code:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Controller to handle Zoho OAuth callback
const processCallback = async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) {
            return res.status(400).json({ error: 'Authorization code is required' });
        }
        const tokenResponse = await handleCallback(code);
        res.json({ message: 'Authorization successful', tokens: tokenResponse });
    } catch (error) {
        console.error('Callback processing error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export { generateAuthCode, processCallback };