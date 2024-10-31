import { bucket } from '../config/gcp.js';

// Upload a file to GCP
export const uploadFileToGCP = async ({ buffer, mimetype }, fileName) => {
  const blob = bucket.file(fileName);  // Use the provided fileName instead of originalname
  const blobStream = blob.createWriteStream({
    resumable: false,
    metadata: {
      contentType: mimetype,  // Set the content type
    },
  });

  return new Promise((resolve, reject) => {
    blobStream
      .on('finish', () => {
        // Construct the public URL
        const publicUrl = `https://storage.googleapis.com/drivers-ethereal-honor-434516-c4/${bucket.name}/${fileName}`;
        resolve(publicUrl);
      })
      .on('error', (err) => {
        reject(err);
      })
      .end(buffer);
  });
};