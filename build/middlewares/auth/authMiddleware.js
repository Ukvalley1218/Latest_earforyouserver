import jwt from 'jsonwebtoken';
import User from '../../models/Users.js';
export const protect = async (req, res, next) => {
  let token;

  // Check for token in Authorization header or cookies
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }
  if (!token) {
    return res.status(401).json({
      message: 'Not authorized, no token'
    });
  }
  try {
    // Verify the token
    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const user = await User.findById(decodedToken._id).select('-password -refreshToken');
    if (!user) {
      return res.status(401).json({
        message: 'Invalid access token'
      });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      message: error.message || 'Invalid access token'
    });
  }
};