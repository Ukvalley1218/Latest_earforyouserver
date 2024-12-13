import mongoose from 'mongoose';

const withdrawalRequestSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    amount: {
        type: Number,
        required: true,
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'rejected'],
        default: 'pending',
    },
    requestedAt: {
        type: Date,
        default: Date.now,
    },
    processedAt: {
        type: Date,
    },
});

const WithdrawalRequest = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);

export default WithdrawalRequest;
