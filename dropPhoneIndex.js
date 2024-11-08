import mongoose from 'mongoose';

import User from './src/models/Users.js';

import connectDB from './src/config/db.js';
 export const dropPhoneIndex = async  ()=> {
  try {
    // Establish DB connection
     connectDB();
    console.log('Database connected successfully.');

    // Drop the phone index if it exists
    const result = await User.collection.dropIndex('phone_1');
    console.log('Index removed successfully:', result);
  } catch (err) {
    console.error('Error removing index:', err);
  } finally {
    // Disconnect from the database
    try {
      await mongoose.disconnect();
      console.log('Database disconnected successfully.');
    } catch (err) {
      console.error('Error disconnecting from the database:', err);
    }
  }
}

dropPhoneIndex();
