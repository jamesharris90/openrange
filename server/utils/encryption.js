const crypto = require('crypto');

const ENCRYPTION_KEY = (process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex')).slice(0, 32);
const IV_LENGTH = 16; // AES block size

function encrypt(plainText) {
  if (!plainText) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(plainText, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(cipherText) {
  if (!cipherText) return null;
  try {
    const [ivHex, ...rest] = cipherText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encryptedText = Buffer.from(rest.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    return null;
  }
}

module.exports = {
  encrypt,
  decrypt
};
