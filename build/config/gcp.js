import { Storage } from '@google-cloud/storage';
import dotenv from 'dotenv';

// Load environment variables from the .env file
dotenv.config();

// Ensure the service account key is loaded
const gcpServiceAccountKey = process.env.GCP_SERVICE_ACCOUNT_KEY || '';
if (!gcpServiceAccountKey) {
  throw new Error('GCP_SERVICE_ACCOUNT_KEY is not defined in environment variables');
}

// Decode the base64-encoded service account key
const serviceAccountKey = Buffer.from(gcpServiceAccountKey, 'base64').toString('utf-8');
const key = JSON.parse(serviceAccountKey);

// Initialize Google Cloud Storage using the parsed key JSON
const storage = new Storage({
  credentials: key,
  projectId: process.env.GCP_PROJECT_ID
});
const bucketName = process.env.GCP_BUCKET_NAME;
if (!bucketName) {
  throw new Error('GCP_BUCKET_NAME is not defined in environment variables');
}
const bucket = storage.bucket(bucketName);
export { bucket };