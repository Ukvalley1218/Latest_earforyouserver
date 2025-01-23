import mongoose from 'mongoose';

const zohoTokenSchema = new mongoose.Schema({
    reason: { type: String, required: true },
    token: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
});

const ZohoToken = mongoose.model('ZohoToken', zohoTokenSchema);

export default ZohoToken;
