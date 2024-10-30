import admin from "../config/firebaseConfig.js";
const sendNotification = async (deviceToken, title, message) => {
  const payload = {
    notification: {
      title: title,
      body: message
    },
    data: {
      click_action: "FLUTTER_NOTIFICATION_CLICK" // Change this as needed for your app
    }
  };
  try {
    const response = await admin.messaging().sendToDevice(deviceToken, payload);
    console.log("Notification sent successfully:", response);
  } catch (error) {
    console.error("Error sending notification:", error);
  }
};
export default sendNotification;