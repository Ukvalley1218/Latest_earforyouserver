import User from "../../models/Users.js";
import Review from "../../models/LeaderBoard/Review.js";
import axios from "axios"; // For Google Maps API calls
import dotenv from 'dotenv';
import mongoose from "mongoose";


dotenv.config();

// Helper function to calculate distance using Google Maps API
const getUsersByProximity = async (address, radius, serviceType, currentUserId) => {
  try {
    // Get coordinates for the provided address
    const geoResponse = await axios.get(
      `https://maps.googleapis.com/maps/api/geocode/json`,
      {
        params: {
          address,
          key: process.env.GOOGLE_MAPS_API_KEY,
        },
      }
    );

    if (geoResponse.data.status !== "OK") {
      throw new Error("Failed to get coordinates from Google Maps API.");
    }

    const location = geoResponse.data.results[0].geometry.location;
    const userLocation = [location.lng, location.lat]; // [longitude, latitude]

    const geoNearOptions = {
      near: { type: "Point", coordinates: userLocation },
      distanceField: "distance",
      spherical: true,
      query: { serviceType },
    };

    // Apply maxDistance only if radius is provided
    if (radius) {
      geoNearOptions.maxDistance = radius * 1000; // Convert radius from km to meters
    }

    // Find users within radius
    const users = await User.aggregate([
      { $geoNear: geoNearOptions },
      {
        $lookup: {
          from: "reviews",
          localField: "_id",
          foreignField: "user",
          as: "reviews",
        },
      },
      {
        $addFields: {
          averageRating: { $avg: "$reviews.rating" }, // Calculate average rating
          userRating: {
            $filter: {
              input: "$reviews",
              as: "review",
              cond: { $eq: ["$$review.reviewer", new mongoose.Types.ObjectId(currentUserId)] }, // Use `new` to create an instance
            },
          }, // Find if the current user has rated the provider
        },
      },
      {
        $sort: { averageRating: -1 }, // Sort by highest rating first
      },
    ]);

    return users;
  } catch (error) {
    console.error("Error in getUsersByProximity:", error);
    throw new Error("Failed to retrieve users by proximity.");
  }
};


export const getUsersByServiceType = async (req, res) => {
  try {
    const { serviceType, address, radius, page = 1, limit = 10, rating, addresses } = req.query;
    const validServiceTypes = ["Mechanic", "Tower"];
    const currentUserId = req.user._id; // Assuming you have middleware to get the logged-in user

    

    // Validate serviceType
    if (!validServiceTypes.includes(serviceType)) {
      return res.status(400).json({
        message: "Invalid service type. Only Mechanic or Tower is allowed.",
      });
    }

    // Pagination calculation
    const skip = (page - 1) * limit;

    let users;
    let matchQuery = { serviceType };

    console.log("Initial matchQuery:", matchQuery);

    // If addresses array is provided, use it for filtering
    if (addresses) {
      const addressArray = Array.isArray(addresses) ? addresses : [addresses];
      if (addressArray.length > 0) {
        matchQuery.address = { $in: addressArray };
        console.log("matchQuery after adding address filter:", matchQuery);
      }
    }

    // If address is provided, use proximity-based filtering
    if (address) {
      console.log("Using proximity-based filtering");
      users = await getUsersByProximity(address, parseFloat(radius), serviceType, currentUserId);
      console.log("Users found by proximity:", users.length);
      
      // Apply address filter if provided
      if (addresses) {
        const addressArray = Array.isArray(addresses) ? addresses : [addresses];
        users = users.filter(user => addressArray.includes(user.address));
      }

      console.log("Users after filtering:", users.length);

      // Custom sorting based on rating filter
      if (rating === 'low') {
        users.sort((a, b) => a.averageRating - b.averageRating);
      } else if (rating === 'medium') {
        users.sort((a, b) => {
          if (a.averageRating >= 3 && a.averageRating < 4 && (b.averageRating < 3 || b.averageRating >= 4)) return -1;
          if (b.averageRating >= 3 && b.averageRating < 4 && (a.averageRating < 3 || a.averageRating >= 4)) return 1;
          return b.averageRating - a.averageRating;
        });
      } else {
        users.sort((a, b) => b.averageRating - a.averageRating);
      }

      // Apply pagination
      users = users.slice(skip, skip + parseInt(limit));
      console.log("Users after pagination:", users.length);
    } else {
      console.log("Using aggregation pipeline");
      // If no address is provided, use aggregation pipeline
      const pipeline = [
        { $match: matchQuery },
        {
          $lookup: {
            from: "reviews",
            localField: "_id",
            foreignField: "user",
            as: "reviews",
          },
        },
        {
          $addFields: {
            averageRating: { $avg: "$reviews.rating" },
            userRating: {
              $filter: {
                input: "$reviews",
                as: "review",
                cond: { $eq: ["$$review.reviewer", new mongoose.Types.ObjectId(currentUserId)] },
              },
            },
          },
        },
      ];

      // Add custom sorting based on rating filter
      if (rating === 'medium') {
        pipeline.push({
          $addFields: {
            mediumFirst: {
              $cond: [
                { $and: [{ $gte: ["$averageRating", 3] }, { $lt: ["$averageRating", 4] }] },
                1,
                0
              ]
            }
          }
        });
      }

      pipeline.push(
        { $sort: getSortOrder(rating) },
        { $skip: skip },
        { $limit: parseInt(limit) }
      );

      console.log("Aggregation pipeline:", JSON.stringify(pipeline, null, 2));

      users = await User.aggregate(pipeline);
      console.log("Users found by aggregation:", users.length);
    }

    // Format user ratings properly
    users = users.map((user) => ({
      ...user,
      userHasRated: user.userRating && user.userRating.length > 0 ? user.userRating[0] : null,
    }));

    console.log("Final users count:", users.length);

    res.status(200).json({ success: true, users, page, limit });
  } catch (error) {
    console.error("Error in getUsersByServiceType:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

const getRatingFilter = (rating) => {
  switch (rating) {
    case 'high':
      return { $gte: 4 };
    case 'medium':
      return { $gte: 3, $lt: 4 };
    case 'low':
      return { $lt: 3 };
    default:
      return {}; // No filter
  }
};

// Helper function to get sort order based on rating filter
const getSortOrder = (rating) => {
  switch (rating) {
    case 'low':
      return { averageRating: 1 }; // Ascending order
    case 'medium':
      return {
        mediumFirst: -1, // Custom field for sorting medium first
        averageRating: -1
      };
    case 'high':
    default:
      return { averageRating: -1 }; // Descending order
  }
};

// Controller function to get users based on serviceType, address, and rating



export const getUserById = async (req, res) => {
  const { id } = req.params;

  // Check if ID is provided
  if (!id) {
    return res.status(400).json({ message: "User ID is required" });
  }

  try {
    // Validate if the provided ID is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }

    // Fetch the user by ID
    const user = await User.findById(id);

    // If no user is found, return a 404 status
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return the user data with a 200 status code
    return res.status(200).json({ user });

  } catch (error) {
    // Log the error for future debugging or send it to a monitoring service
    console.error("Error fetching user:", error);

    // Return a generic error message to the client
    return res.status(500).json({
      message: "An error occurred while fetching the user",
      error: error.message,
    });
  }
};


// Fillter by Reviwe

export const filterByReview = async (req, res) => {
  try {
    const { ratingCategory, Address, serviceType, page = 1, limit = 10 } = req.query;

    if (!ratingCategory && !Address) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one filter: "Address", "ratingCategory", or "serviceType".'
      });
    }

    let query = {};
    let sort = {};

    if (ratingCategory) {
      if (!['low', 'medium', 'high'].includes(ratingCategory)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid rating category provided. Please choose "low", "medium", or "high".'
        });
      }

      if (ratingCategory === 'low') {
        sort = { rating: 1 }; // Low to high
      } else if (ratingCategory === 'high') {
        sort = { rating: -1 }; // High to low
      }
    }

    console.log('Query:', query);

    // Count total documents matching the query before applying pagination
    let totalDocuments = await Review.countDocuments(query);

    let filteredReviews = await Review.find(query)
      .sort(sort)
      .populate({
        path: 'user',
        select: '-password', // Exclude sensitive information like password if present
      })
      .lean();

    // Filter reviews based on Address if specified
    if (Address) {
      const addresses = Array.isArray(Address) ? Address : Address.split(',');
      filteredReviews = filteredReviews.filter(review =>
        addresses.includes(review.user.companyAddress)
      );
    }

    // Filter reviews based on serviceType if specified
    if (serviceType) {
      const serviceTypes = Array.isArray(serviceType) ? serviceType : serviceType.split(',');
      filteredReviews = filteredReviews.filter(review =>
        serviceTypes.includes(review.user.serviceType)
      );
    }

    // If the ratingCategory is 'medium', apply the sorting logic in-memory
    if (ratingCategory === 'medium') {
      filteredReviews.sort((a, b) => {
        const distanceA = Math.abs(a.rating - 3);
        const distanceB = Math.abs(b.rating - 3);
        if (distanceA === distanceB) {
          return b.rating - a.rating; // If equidistant, higher rating first
        }
        return distanceA - distanceB;
      });
    }

    // Calculate total documents after in-memory filtering (if Address or serviceType filtering was applied)
    totalDocuments = filteredReviews.length;

    // Apply pagination after filtering
    const startIndex = (page - 1) * limit;
    const paginatedReviews = filteredReviews.slice(startIndex, startIndex + parseInt(limit));

    const totalRating = filteredReviews.reduce((sum, review) => sum + review.rating, 0);
    const averageRating = totalDocuments > 0 ? (totalRating / totalDocuments).toFixed(2) : 0;

    // Calculate total pages
    const totalPages = Math.ceil(totalDocuments / limit);

    if (!paginatedReviews.length) {
      return res.status(404).json({
        success: false,
        message: 'No reviews found matching the specified criteria. Please try a different category, Address, or serviceType.'
      });
    }

    // Map response data to include all user details
    const responseData = paginatedReviews.map(review => ({
      id: review._id,
      rating: review.rating,
      comment: review.comment,
      user: review.user, // Return the entire user object
    }));

    res.status(200).json({ success: true, data: responseData, totalPages,page,limit });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching reviews. Please try again later.',
      error: error.message,
    });
  }
};
