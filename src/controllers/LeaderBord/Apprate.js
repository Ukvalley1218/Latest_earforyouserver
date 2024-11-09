
import AppRating from '../../models/LeaderBoard/Apprate.js'
import User from "../../models/Users.js";

// Controller function to add a comment
export const addRating = async (req, res) => {
  try {
    const { comment } = req.body;
    const userId = req.user._id; // Assuming you are using authentication middleware to set user in the request

    if (!comment) {
      return res.status(400).json({ error: "Comment is required" });
    }

    // Call the service to add the rating
    const newRating = await AppRating(userId, comment);

    return res.status(201).json({
      message: "Comment added successfully",
      rating: newRating,
    });
  } catch (error) {
    console.error("Error adding rating:", error);
    return res.status(400).json({
      error: error.message, // Return the specific error message (e.g., "You have already rated the app.")
    });
  }
};