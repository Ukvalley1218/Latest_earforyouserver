import mongoose from 'mongoose';

const zohoTokenSchema = new mongoose.Schema({
  reason: { 
    type: String, 
    required: true, 
    enum: ['access_token', 'refresh_token']
  },
  token: { 
    type: String, 
    required: true
  }
}, {
  timestamps: true
});

const ZohoToken = mongoose.models.ZohoToken || mongoose.model('ZohoToken', zohoTokenSchema);

export default ZohoToken;