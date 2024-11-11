import AppRating from '../../models/LeaderBoard/Apprate.js';
import User from "../../models/Users.js";

// Controller function to add a rating
export const addRating = async (req, res) => {
  try {
    const {  comment } = req.body;
    const userId = req.user._id; // Assuming you are using authentication middleware to set user in the request



    // Check if the user has already rated
    const existingRating = await AppRating.findOne({ user: userId });
    if (existingRating) {
      return res.status(400).json({ error: "You have already rated the app." });
    }

    // Create a new rating
    const newRating = new AppRating({
      user: userId,
      comment: comment || "", // Comment is optional, default to an empty string
    });

    // Save the new rating to the database
    await newRating.save();

    return res.status(201).json({
      message: "Rating added successfully",
      rating: newRating,
    });
  } catch (error) {
    console.error("Error adding rating:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
