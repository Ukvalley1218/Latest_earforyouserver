import mongoose from 'mongoose';

const callLogSchema = new mongoose.Schema({
  caller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,

  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,

  },
  startTime: {
    type: Date,
    default: Date.now,
    
  },
  endTime: {
    type: Date,
    
  },
  duration: {
    type: Number,
    
  }, // Duration in seconds
  status: {
    type: String,
    enum: ['completed', 'missed', 'failed', 'rejected'],
    
  },
});



const CallLog = mongoose.model('CallLog', callLogSchema);

export default CallLog;
