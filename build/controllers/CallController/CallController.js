import createService from '../../servises/CallServices.js';
import logger from '../../logger/winston.logger.js';

/**
 * Initiates a call.
 */
export const initiateCall = async (req, res) => {
  const {
    callerId,
    receiverId
  } = req.body;
  if (!callerId || !receiverId) {
    logger.error('Caller ID or Receiver ID missing in request body');
    return res.status(400).json({
      error: 'Caller ID and Receiver ID are required'
    });
  }
  try {
    const response = await createService.initiateCall(callerId, receiverId);
    if (!response.success) {
      // Handle case where the receiver is busy
      return res.status(409).json({
        error: response.message
      });
    }
    res.json(response);
  } catch (error) {
    logger.error(`Error initiating call between caller ${callerId} and receiver ${receiverId}: ${error.message}`);
    res.status(500).json({
      error: 'Error initiating call'
    });
  }
};

/**
 * Accepts an incoming call.
 */
export const acceptCall = async (req, res) => {
  const {
    receiverId,
    callerId
  } = req.body;
  if (!receiverId || !callerId) {
    logger.error('Caller ID or Receiver ID missing in request body');
    return res.status(400).json({
      error: 'Caller ID and Receiver ID are required'
    });
  }
  try {
    const response = await createService.acceptCall(receiverId, callerId);
    res.json(response);
  } catch (error) {
    logger.error(`Error accepting call between caller ${callerId} and receiver ${receiverId}: ${error.message}`);
    res.status(500).json({
      error: 'Error accepting call'
    });
  }
};

/**
 * Rejects an incoming call or logs a missed call if the receiver is unavailable.
 */
export const rejectCall = async (req, res) => {
  const {
    receiverId,
    callerId
  } = req.body;
  if (!receiverId || !callerId) {
    logger.error('Caller ID or Receiver ID missing in request body');
    return res.status(400).json({
      error: 'Caller ID and Receiver ID are required'
    });
  }
  try {
    const response = await createService.rejectCall(receiverId, callerId);
    res.json(response);
  } catch (error) {
    logger.error(`Error rejecting call between caller ${callerId} and receiver ${receiverId}: ${error.message}`);
    res.status(500).json({
      error: 'Error rejecting call'
    });
  }
};

/**
 * Ends an ongoing call.
 */
export const endCall = async (req, res) => {
  const {
    callerId,
    receiverId
  } = req.body;
  if (!callerId || !receiverId) {
    logger.error('Caller ID or Receiver ID missing in request body');
    return res.status(400).json({
      error: 'Caller ID and Receiver ID are required'
    });
  }
  try {
    const response = await createService.endCall(callerId, receiverId);
    res.json(response);
  } catch (error) {
    logger.error(`Error ending call between caller ${callerId} and receiver ${receiverId}: ${error.message}`);
    res.status(500).json({
      error: 'Error ending call'
    });
  }
};

/**
 * Handles missed calls.
 */
export const handleMissedCall = async (req, res) => {
  const {
    callerId,
    receiverId
  } = req.body;
  if (!callerId || !receiverId) {
    logger.error('Caller ID or Receiver ID missing in request body');
    return res.status(400).json({
      error: 'Caller ID and Receiver ID are required'
    });
  }
  try {
    const response = await createService.handleMissedCall(callerId, receiverId);
    res.json(response);
  } catch (error) {
    logger.error(`Error handling missed call between caller ${callerId} and receiver ${receiverId}: ${error.message}`);
    res.status(500).json({
      error: 'Error handling missed call'
    });
  }
};