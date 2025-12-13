import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { serviceAccount } from './service_accountkey.js';
dotenv.config();

// Parse the service account JSON from environment variable
// const serviceAccount1 = JSON.parse(serviceAccount);

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export default admin;
