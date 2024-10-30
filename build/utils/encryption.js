import crypto from 'crypto';

// Encryption and decryption methods
const encryptMessage = (message, publicKey) => {
  const buffer = Buffer.from(message, 'utf8');
  const encrypted = crypto.publicEncrypt(publicKey, buffer);
  return encrypted.toString('base64');
};
const decryptMessage = (encryptedMessage, privateKey) => {
  const buffer = Buffer.from(encryptedMessage, 'base64');
  const decrypted = crypto.privateDecrypt(privateKey, buffer);
  return decrypted.toString('utf8');
};
export { encryptMessage, decryptMessage };