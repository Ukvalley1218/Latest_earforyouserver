import CallLog from '../models/Talk-to-friend/callLogModel.js';
import User from '../models/Users.js';
import sendNotification from '../utils/sendNotification.js';
const activeCalls = {};
const initiateCall = async (callerId, receiverId) => {
  const receiver = await User.findById(receiverId);
  const caller = await User.findById(callerId);
  if (!receiver) {
    throw new Error('Receiver not found');
  }

  // Check if receiver is already in a call
  if (activeCalls[receiverId]) {
    // Return a message to indicate the user is busy
    return {
      success: false,
      message: 'User is busy in another call'
    };
  }

  // Store active call
  activeCalls[callerId] = receiverId;
  activeCalls[receiverId] = callerId;

  // Send push notification to the receiver
  if (receiver.deviceToken) {
    const title = 'Incoming Call';
    const message = `${caller.username} is calling you!`;
    await sendNotification(receiver.deviceToken, title, message);
  }
  return {
    success: true,
    message: 'Call initiated'
  };
};
const acceptCall = async (receiverId, callerId) => {
  if (!activeCalls[callerId] || activeCalls[callerId] !== receiverId) {
    throw new Error('No active call found or invalid call data');
  }
  return {
    success: true,
    message: 'Call accepted'
  };
};
const rejectCall = async (receiverId, callerId) => {
  if (activeCalls[callerId] === receiverId) {
    await CallLog.create({
      caller: callerId,
      receiver: receiverId,
      startTime: new Date(),
      endTime: new Date(),
      duration: 0,
      status: 'rejected'
    });
    delete activeCalls[callerId];
    delete activeCalls[receiverId];
  } else {
    // Log missed call
    await CallLog.create({
      caller: callerId,
      receiver: receiverId,
      startTime: new Date(),
      status: 'missed'
    });
  }
  return {
    success: true,
    message: 'Call rejected or marked as missed'
  };
};
const endCall = async (callerId, receiverId) => {
  if (activeCalls[callerId] === receiverId) {
    const endTime = new Date();
    const startTime = endTime; // Adjust according to actual call start time
    const duration = Math.floor((endTime - startTime) / 1000);
    await CallLog.create({
      caller: callerId,
      receiver: receiverId,
      startTime,
      endTime,
      duration,
      status: 'completed'
    });
    delete activeCalls[callerId];
    delete activeCalls[receiverId];
    return {
      success: true,
      message: 'Call ended',
      duration
    };
  } else {
    throw new Error('No active call found');
  }
};

// Handle missed calls in case of unavailability or disconnection
const handleMissedCall = async (callerId, receiverId) => {
  await CallLog.create({
    caller: callerId,
    receiver: receiverId,
    startTime: new Date(),
    status: 'missed'
  });

  // Send notification to the caller about the missed call
  const caller = await User.findById(callerId);
  if (caller && caller.deviceToken) {
    const title = 'Missed Call';
    const message = `You missed a call to ${receiverId}.`;
    await sendNotification(caller.deviceToken, title, message);
  }
  return {
    success: true,
    message: 'Missed call logged and notification sent'
  };
};
export default {
  initiateCall,
  acceptCall,
  rejectCall,
  endCall,
  handleMissedCall // Export missed call handler
};