import { bucket } from '../config/gcp.js';
const uploadFile = async file => {
  const {
    originalname,
    buffer
  } = file;
  const fileName = `${crypto.randomBytes(16).toString('hex')}-${originalname}`;
  const fileUpload = bucket.file(fileName);
  await fileUpload.save(buffer, {
    contentType: file.mimetype,
    public: true // Set to true if the file should be publicly accessible
  });
  return `https://storage.googleapis.com/${bucket.name}/${fileName}`;
};
const deleteFile = async fileUrl => {
  const fileName = fileUrl.split('/').pop();
  const file = bucket.file(fileName);
  await file.delete();
};
export { uploadFile, deleteFile };