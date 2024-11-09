import mongoose from "mongoose";

// Define the schema for app ratings
const appRatingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true, // User who is rating the app
    },
    comment: {
      type: String,
      required: true, // The comment provided by the user
    },
  },
  { timestamps: true } // Automatically add createdAt and updatedAt fields
);

// Create an index to ensure one rating per user
appRatingSchema.index({ user: 1 }, { unique: true }); // Ensures a user can only have one rating

// Create and export the model
const AppRating = mongoose.model("AppRating", appRatingSchema);

export default AppRating;
