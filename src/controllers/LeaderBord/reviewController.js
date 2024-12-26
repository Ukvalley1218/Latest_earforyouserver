import Review from "../../models/LeaderBoard/Review.js";
import User from "../../models/Users.js";
import mongoose from "mongoose";
import CallLog from "../../models/Talk-to-friend/callLogModel.js";

// export const createReview = async (req, res) => {
//   try {
//     const { rating, comment,userId,reviewerId } = req.body;
  
//     console.log("rating:", rating, "Comment:", comment, "User ID:", userId, "Reviewer ID:", reviewerId);

//     // Validate request body
//     if (!userId) {
//       return res.status(400).json({ message: "User ID is required." });
//     }

//     // Check if the recipient exists
//     const recipient = await User.findById(userId);
//     if (!recipient) {
//       return res.status(404).json({ message: "User not found." });
//     }

//     // Check if a review with a rating already exists for the reviewer and recipient
//     let existingReview = await Review.findOne({ user: userId, reviewer: reviewerId });

//     if (existingReview) {
//       if (rating) {
//         return res.status(400).json({ message: "You have already rated this user. Only comments/replies are allowed." });
//       }

//       // Add a comment/reply if only a comment is being posted
//       if (comment) {
//         existingReview.comments.push({ text: comment, commenter: reviewerId });
//         await existingReview.save();
//         return res.status(200).json({ success: true, message: "Comment added.", review: existingReview });
//       } else {
//         return res.status(400).json({ message: "Comment is required when no rating is provided." });
//       }
//     }

//     // Create a new review if no existing review with a rating was found
    
//     const review = new Review({
//       user: userId, // The recipient
//       reviewer: reviewerId, // The one giving the review
//       rating: rating || null,
//       comments: comment ? [{ text: comment, commenter: reviewerId }] : [] // Initialize comments array
//     });

//     await review.save();

//     res.status(201).json({
//       success: true, review, recipient: {
//         name: recipient.name,
        
//       }
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Server error." });
//   }
// };
//Nesting of Comments Controller 



export const createReview = async (req, res) => {
  try {
    const { rating, comment, userId, reviewerId } = req.body;

    // Validate request body
    if (!userId || !reviewerId) {
      
      return res.status(400).json({ message: "User ID and Reviewer ID are required." });
    }

    // Check if the recipient (user being reviewed) exists
    const recipient = await User.findById(userId);
    if (!recipient) {
      return res.status(404).json({ message: "User not found." });
    }

    // Check if a review with a rating already exists for this reviewer and recipient
    let existingReview = await Review.findOne({ user: userId, reviewer: reviewerId });

    if (existingReview) {
      // If a rating exists, prevent another rating but allow comments
      if (existingReview.rating && rating) {
        return res.status(400).json({
          message: "You have already rated this user. Only comments are allowed."
        });
      }

      // If no rating is provided, allow only comments to be added
      if (comment) {
        existingReview.comments.push({ text: comment, commenter: reviewerId });
        await existingReview.save();
        return res.status(200).json({
          success: true,
          message: "Comment added.",
          review: existingReview,
        });
      } 
    }

    // Create a new review if no existing review with a rating is found
    const review = new Review({
      user: userId, // The recipient
      reviewer: reviewerId, // The one giving the review
      rating: rating || null,
      comments: comment ? [{ text: comment, commenter: reviewerId }] : [], // Initialize comments array
    });

    await review.save();

    res.status(201).json({
      success: true,
      review,
      recipient: {
        name: recipient.name,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};
  

export const addCommentToReview = async (req, res) => {
  try {
    console.log("req.user:", req.user);
    const { comment } = req.body;
    const reviewId = req.params.reviewId; // Get the reviewId from params
    const reviewerId = req.user._id; // Get the logged-in user's ID
     // Validate request body
    if (!comment) {
      return res.status(400).json({ message: "Comment is required." });
    }

    // Find the review by reviewId
    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ message: "Review not found." });
    }

    // Ensure comments is initialized as an array
    if (!Array.isArray(review.comments)) {
      review.comments = [];
    }

    // Add the new comment to the review
    review.comments.push({ text: comment, commenter: reviewerId });
    await review.save();

    res.status(200).json({ success: true, message: "Comment added.", review });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};
//GET USER Reviews


export const getUserReviews = async (req, res) => {
  try {
    const { user } = req.params;

    // Convert the user parameter to an ObjectId
    const userId = new mongoose.Types.ObjectId(user);

    // Find reviews for the specified user
    const reviews = await Review.find({ user: userId })
      .populate({
        path: 'reviewer',
        select: 'username email avatar',
      })
      .populate({
        path: 'comments.commenter',
        select: 'username avatar',
      });

    if (!reviews.length) {
      return res.status(404).json({ success: false, message: "No reviews found for this user." });
    }

    // Map reviews to include necessary data
    const result = reviews.map(review => ({
      _id: review._id,
      user: review.user,
      reviewer: review.reviewer._id,
      rating: review.rating,
      review: review.review,
      comments: review.comments.map(comment => ({
        text: comment.text,
        commenter: {
          _id: comment.commenter._id,
          username: comment.commenter.username,
          avatar: comment.commenter && comment.commenter.avatar ? comment.commenter.avatar.url : null,

        },
      })),
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      reviewerInfo: {
        username: review.reviewer.username,
        email: review.reviewer.email,
        avatar: review.reviewer && review.reviewer.avatar ? review.reviewer.avatar.url : null,

      },
    }));

    res.status(200).json({ success: true, reviews: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server Error"});
  }
};




// Update an existing review
export const updateReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { rating, comment } = req.body;

    // Find and update the review
    const review = await Review.findByIdAndUpdate(
      reviewId,
      { rating, comment },
      { new: true }
    );

    if (!review) {
      return res.status(404).json({ message: "Review not found." });
    }

    res.status(200).json({ success: true, review });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

// Delete a review
export const deleteReview = async (req, res) => {
  try {
    const userId = req.user._id; // Assuming user ID is set by the protect middleware

    const review = await Review.findByIdAndDelete(userId);

    if (!review) {
      return res.status(404).json({ message: "Review not found." });
    }

    res
      .status(200)
      .json({ success: true, message: "Review deleted successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

// Get all reviews for a specific user (service provider)
// export const getUserReviews = async (req, res) => {
//   try {
//     const userId = req.user._id; // Assuming user ID is set by the protect middleware

//     const reviews = await Review.find({ user: userId }).populate("replies");

//     res.status(200).json({ success: true, reviews });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Server error." });
//   }
// };

