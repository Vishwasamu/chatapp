const crypto = require('crypto');

function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

function hashCode(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

module.exports = { generateOtp, hashCode };