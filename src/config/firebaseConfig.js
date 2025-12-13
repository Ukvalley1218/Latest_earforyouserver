import admin from "firebase-admin";
import { serviceAccount } from "./service_accountkey.js";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export default admin;
