
import express from 'express';
import { generateAuthCode,processCallback } from '../../controllers/Zoho/ZohoController.js';

const router = express.Router();

// Route to generate Zoho authorization code URL
router.get('/generate-auth-code', generateAuthCode);

// Route to handle Zoho OAuth callback
router.get('/callback', processCallback);

export default router;
