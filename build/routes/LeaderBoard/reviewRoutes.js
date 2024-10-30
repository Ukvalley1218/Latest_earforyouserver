import express from 'express';
import { createReview, updateReview, deleteReview, getUserReviews, addCommentToReview } from '../../controllers/LeaderBord/reviewController.js';
import { protect } from '../../middlewares/auth/authMiddleware.js';
const router = express.Router();

// Create a review
router.post('/reviews/:userId', protect, createReview);
//
router.post('/reviews/:reviewId/comment', protect, addCommentToReview);

// Update a review
router.put('/reviews/:reviewId', protect, updateReview);

// Delete a review
router.delete('/reviews/:reviewId', protect, deleteReview);

// Get all reviews for a specific user
router.get('/reviews/:user', protect, getUserReviews);
export default router;