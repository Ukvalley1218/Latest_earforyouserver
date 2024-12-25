// import cron from 'node-cron';
// import Wallet from '../../models/Wallet/Wallet.js'; // Adjust the path as needed
// import admin from 'firebase-admin';

// // Initialize Firebase Admin SDK
// if (!admin.apps.length) {
//   admin.initializeApp({
//     credential: admin.credential.applicationDefault(), // Use your Firebase credentials
//   });
// }

// const cleanExpiredRecharges = async () => {
//   try {
//     const now = new Date();
//     const wallets = await Wallet.find().populate('userId'); 

//     for (const wallet of wallets) {
//       let totalDeduction = 0;
//       const expiredRecharges = [];

//       // Filter expired recharges and calculate deduction
//       wallet.recharges = wallet.recharges.filter(recharge => {
//         if (recharge.ExpiryDate <= now) {
//           totalDeduction += recharge.amount;
//           expiredRecharges.push(recharge); // Track expired recharges for notification
//           return false; // Remove expired recharge
//         }
//         return true;
//       });

//       // Deduct expired balance from wallet
//       wallet.balance -= totalDeduction;
//       wallet.talkTime = Math.max(wallet.talkTime - totalDeduction, 0); // Adjust talk time
//       if (wallet.balance < 0) wallet.balance = 0; // Ensure non-negative balance

//       wallet.lastUpdated = now;
//       await wallet.save();

//       // Send FCM notification for each expired recharge
//       if (expiredRecharges.length > 0 && wallet.userId?.deviceToken) {
//         const message = {
//           notification: {
//             title: 'Recharge Expired',
//             body: `One or more recharges have expired. Your balance has been adjusted.`,
//           },
//           token: wallet.userId.deviceToken, // Assuming the `deviceToken` field exists in the user model
//         };

//         try {
//           await admin.messaging().send(message);
//           console.log(`Notification sent to user ${wallet.userId._id}`);
//         } catch (err) {
//           console.error(`Failed to send notification to user ${wallet.userId._id}:`, err);
//         }
//       }
//     }

//     console.log(`Wallets cleaned up at ${now.toISOString()}`);
//   } catch (error) {
//     console.error("Error in cleanExpiredRecharges cron job:", error);
//   }
// };

// // Schedule the cron job to run every day at midnight
// cron.schedule('0 0 * * *', cleanExpiredRecharges, {
//   scheduled: true,
//   timezone: "UTC", // Adjust timezone if necessary
// });

// export default cleanExpiredRecharges;
