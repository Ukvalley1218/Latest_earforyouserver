import { addRating, getAllRatings, getMyRating, updateRating } from '../../controllers/LeaderBord/Apprate.js';
import { protect } from '../../middlewares/auth/authMiddleware.js';
import express from 'express';
const router = express.Router();

router.post('/comment',protect, addRating);
router.get('/',protect, getAllRatings);
router.get('/my',protect, getMyRating);
router.put('/',protect, updateRating);

export default router;
