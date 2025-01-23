import mongoose from 'mongoose';

// Define the schema for Zoho tokens
const zohoTokenSchema = new mongoose.Schema(
  {
    reason: { 
      type: String, 
      required: true, 
      enum: ['access_token', 'refresh_token'], // You can specify valid values for 'reason' field if needed
    },
    token: { 
      type: String, 
      required: true, 
    },
    createdAt: { 
      type: Date, 
      default: Date.now 
    },
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt
  }
);

// Create the ZohoToken model based on the schema
const ZohoToken = mongoose.model('ZohoToken', zohoTokenSchema);

export default ZohoToken;
