import express from 'express';
import { getUserById, filterByReview, getUsersByServiceType } from '../../controllers/LeaderBord/userController.js';
import { protect } from '../../middlewares/auth/authMiddleware.js'; // Assuming user authentication

const router = express.Router();

// Route to get users by serviceType (Mechanic or Tower) and Google Maps filtering
router.get('/users', protect, getUsersByServiceType);
router.get('/user/:id', protect, getUserById);
router.get('/fillterbyreviwe', filterByReview);
export default router;