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
    enum: ['completed', 'missed', 'failed', 'rejected',],
    
  },
});


callLogSchema.index({ caller: 1, receiver: 1, startTime: -1 });

const CallLog = mongoose.model('CallLog', callLogSchema);

export default CallLog;
