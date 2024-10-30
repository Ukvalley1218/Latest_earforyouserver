import mongoose from 'mongoose';
const refreshTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 604800
  } // Token expires in 1 week
});
const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
export default RefreshToken;