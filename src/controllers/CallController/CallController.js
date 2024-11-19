import createService from '../../servises/CallServices.js'
import logger from '../../logger/winston.logger.js';
import CallLog from '../../models/Talk-to-friend/callLogModel.js';
import User from '../../models/Users.js';



// export const getRecentCalls = async (req, res) => {
//     try {
//       const { callerId } = req.params; // Assuming you pass callerId in the request parameters
  
//       console.log('Fetching calls for callerId:', callerId);
  
//       // Retrieve recent call logs, sorting by the most recent calls first
//       const recentCalls = await CallLog.find({ callerId })
//         .sort({ createdAt: -1 }) // Sorting by the `createdAt` field in descending order (most recent first)
//         .limit(10)
//         .populate(callerId)
//         .exec(); 
  
//       if (recentCalls.length === 0) {
//         return res.status(404).json({ message: 'No call history found.' });
//       }
  
//       return res.status(200).json({ recentCalls });
//     } catch (error) {
//       console.error('Error fetching recent call history:', error); // Corrected typo
//       return res.status(500).json({ message: 'Server error, unable to fetch call history.' });
//     }
//   };
  



export const getRecentCalls = async (req, res) => {
  try {
    const { userId } = req.params;

    console.log('Fetching calls for userId:', userId);

    // First, verify if userId exists and is valid
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required.' });
    }

    // Retrieve recent call logs with proper error handling for null references
    const recentCalls = await CallLog.find({
      $or: [{ caller: userId }, { receiver: userId }],
    })
      .sort({ startTime: -1 })
      .limit(10)
      .populate('caller', 'username userType userCategory phone avatarUrl') // Added avatarUrl
      .populate('receiver', 'username userType userCategory phone avatarUrl') // Added avatarUrl
      .lean() // Convert to plain JavaScript objects
      .exec();

    if (!recentCalls || recentCalls.length === 0) {
      return res.status(404).json({ message: 'No call history found.' });
    }

    // Filter out invalid calls and handle null references
    const validCalls = recentCalls.filter(call => {
      return call.caller && call.receiver && // Check if both caller and receiver exist
             call.caller._id && call.receiver._id; // Check if both have _id properties
    });

    // Remove duplicate calls
    const uniqueCalls = [];
    const seen = new Set();

    for (const call of validCalls) {
      try {
        const callerId = call.caller._id.toString();
        const receiverId = call.receiver._id.toString();
        const callKey = [callerId, receiverId].sort().join('-');

        if (!seen.has(callKey)) {
          seen.add(callKey);
          uniqueCalls.push({
            ...call,
            caller: {
              ...call.caller,
              avatarUrl: call.caller.avatarUrl || null, // Handle missing avatarUrl
              username: call.caller.username || 'Unknown User'
            },
            receiver: {
              ...call.receiver,
              avatarUrl: call.receiver.avatarUrl || null, // Handle missing avatarUrl
              username: call.receiver.username || 'Unknown User'
            }
          });
        }
      } catch (err) {
        console.warn('Skipping invalid call record:', err);
        continue;
      }
    }

    // If all calls were invalid, return appropriate message
    if (uniqueCalls.length === 0) {
      return res.status(404).json({ 
        message: 'No valid call history found.',
        details: 'All retrieved calls contained invalid or missing user references.'
      });
    }

    return res.status(200).json({ 
      recentCalls: uniqueCalls,
      totalCalls: uniqueCalls.length
    });

  } catch (error) {
    console.error('Error fetching recent call history:', error);
    
    // Provide more specific error messages based on error type
    if (error.name === 'CastError') {
      return res.status(400).json({ 
        message: 'Invalid user ID format.',
        details: error.message 
      });
    }

    return res.status(500).json({ 
      message: 'Server error, unable to fetch call history.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


/**
 * Initiates a call.
 */
export const initiateCall = async (req, res) => {
    const { callerId, receiverId } = req.body;

    if (!callerId || !receiverId) {
        logger.error('Caller ID or Receiver ID missing in request body');
        return res.status(400).json({ error: 'Caller ID and Receiver ID are required' });
    }

    try {
        const response = await createService.initiateCall(callerId, receiverId);

        if (!response.success) {
            // Handle case where the receiver is busy
            return res.status(409).json({ error: response.message });
        }

        res.json(response);
    } catch (error) {
        logger.error(`Error initiating call between caller ${callerId} and receiver ${receiverId}: ${error.message}`);
        res.status(500).json({ error: 'Error initiating call' });
    }
};

/**
 * Accepts an incoming call.
 */
export const acceptCall = async (req, res) => {
    const { receiverId, callerId } = req.body;

    if (!receiverId || !callerId) {
        logger.error('Caller ID or Receiver ID missing in request body');
        return res.status(400).json({ error: 'Caller ID and Receiver ID are required' });
    }

    try {
        const response = await createService.acceptCall(receiverId, callerId);
        res.json(response);
    } catch (error) {
        logger.error(`Error accepting call between caller ${callerId} and receiver ${receiverId}: ${error.message}`);
        res.status(500).json({ error: 'Error accepting call' });
    }
};

/**
 * Rejects an incoming call or logs a missed call if the receiver is unavailable.
 */
export const rejectCall = async (req, res) => {
    const { receiverId, callerId } = req.body;

    if (!receiverId || !callerId) {
        logger.error('Caller ID or Receiver ID missing in request body');
        return res.status(400).json({ error: 'Caller ID and Receiver ID are required' });
    }

    try {
        const response = await createService.rejectCall(receiverId, callerId);
        res.json(response);
    } catch (error) {
        logger.error(`Error rejecting call between caller ${callerId} and receiver ${receiverId}: ${error.message}`);
        res.status(500).json({ error: 'Error rejecting call' });
    }
};

/**
 * Ends an ongoing call.
 */
export const endCall = async (req, res) => {
    const { callerId, receiverId } = req.body;

    if (!callerId || !receiverId) {
        logger.error('Caller ID or Receiver ID missing in request body');
        return res.status(400).json({ error: 'Caller ID and Receiver ID are required' });
    }

    try {
        const response = await createService.endCall(callerId, receiverId);
        res.json(response);
    } catch (error) {
        logger.error(`Error ending call between caller ${callerId} and receiver ${receiverId}: ${error.message}`);
        res.status(500).json({ error: 'Error ending call' });
    }
};

/**
 * Handles missed calls.
 */
export const handleMissedCall = async (req, res) => {
    const { callerId, receiverId } = req.body;

    if (!callerId || !receiverId) {
        logger.error('Caller ID or Receiver ID missing in request body');
        return res.status(400).json({ error: 'Caller ID and Receiver ID are required' });
    }

    try {
        const response = await createService.handleMissedCall(callerId, receiverId);
        res.json(response);
    } catch (error) {
        logger.error(`Error handling missed call between caller ${callerId} and receiver ${receiverId}: ${error.message}`);
        res.status(500).json({ error: 'Error handling missed call' });
    }
};


