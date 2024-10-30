import Notification from '../../models/Notification.Modal.js';

// Controller function to get notificationsx
export const getNotifications = async (req, res) => {
  try {
    // Find all notifications and populate the user's name
    const notifications = await Notification.find().populate('userId', 'name') // Populate the user's name from the User schema
    .select('title messageBody userId createdAt'); // Select only the required fields

    // Map the notifications to include the user's name, title, message body, and formatted date
    const formattedNotifications = notifications.map(notification => {
      const createdAt = new Date(notification.createdAt); // Create a new Date object for each notification

      const options = {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      };
      const formattedDate = createdAt.toLocaleDateString('en-US', options);
      return {
        name: notification.userId.name,
        title: notification.title,
        messageBody: notification.messageBody,
        date: formattedDate
      };
    });

    // Send the formatted response
    res.status(200).json(formattedNotifications);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: 'Error fetching notifications'
    });
  }
};