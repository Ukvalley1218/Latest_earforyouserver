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

export const getAllRatings = async (req, res) => {
  try {
    const ratings = await AppRating.find()
      .populate("user", "name email")
      .sort({ createdAt: -1 });

    if (!ratings.length) {
      return res.status(404).json({
        message: "No ratings found",
        ratings: [],
      });
    }

    return res.status(200).json({
      message: "Ratings fetched successfully",
      total: ratings.length,
      ratings,
    });
  } catch (error) {
    console.error("Error fetching ratings:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
};

export const getMyRating = async (req, res) => {
  try {
    const userId = req.user._id;

    const rating = await AppRating.findOne({ user: userId });

    if (!rating) {
      return res.status(404).json({
        message: "You have not rated the app yet",
      });
    }

    return res.status(200).json({
      message: "Rating fetched successfully",
      rating,
    });
  } catch (error) {
    console.error("Error fetching user rating:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
export const updateRating = async (req, res) => {
  try {
    const userId = req.user._id;
    const { comment } = req.body;

    const rating = await AppRating.findOne({ user: userId });
    if (!rating) {
      return res.status(404).json({
        message: "Rating not found",
      });
    }

    rating.comment = comment ?? rating.comment;
    await rating.save();

    return res.status(200).json({
      message: "Rating updated successfully",
      rating,
    });
  } catch (error) {
    console.error("Error updating rating:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
