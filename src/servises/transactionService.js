// paymentService.js
import axios from 'axios';
import crypto from 'crypto';
import Transaction from './../models/TransactionModal.js'
import Wallet from './../models/Wallet/Wallet.js'


const PHONEPE_API_URL = process.env.PHONEPE_API_URL || 'https://api-preprod.phonepe.com/apis/pg-sandbox';
const SALT_KEY = process.env.SALT_KEY;
const SALT_INDEX = process.env.SALT_INDEX;

export const verifyPhonePePayment = async (merchantId, merchantTransactionId) => {
  try {
    const url = `/v3/transaction/${merchantId}/${merchantTransactionId}/status`;
    const stringToHash = `/pg/v1/status/${merchantId}/${merchantTransactionId}${SALT_KEY}`;
    const checksum = crypto.createHash('sha256')
      .update(stringToHash)
      .digest('hex') + '###' + SALT_INDEX;

    const response = await axios.get(`${PHONEPE_API_URL}${url}`, {
      headers: {
        'X-VERIFY': checksum,
        'Content-Type': 'application/json'
      }
    });

    return response.data;
  } catch (error) {
    throw new Error(`PhonePe verification failed: ${error.message}`);
  }
};


// transactionService.js


export const updateTransaction = async (transactionData) => {
  const transaction = new Transaction(transactionData);
  await transaction.save();
};

export const updateWalletBalance = async (userId, amount) => {
  await Wallet.findOneAndUpdate(
    { userId },
    { $inc: { balance: amount } },
    { new: true }
  );
};
