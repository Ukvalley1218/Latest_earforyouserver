import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();
const googleMapsClient = axios.create({
  baseURL: 'https://maps.googleapis.com/maps/api',
  params: {
    key: process.env.GOOGLE_MAPS_API_KEY
  }
});
export const getDistanceBetweenLocations = async (origin, destination) => {
  try {
    const response = await googleMapsClient.get('/distancematrix/json', {
      params: {
        origins: origin,
        destinations: destination
      }
    });
    return response.data;
  } catch (error) {
    console.error(error);
    throw new Error('Error fetching distance from Google Maps API');
  }
};