import Service from "../models/Service.js";
const createService = async (req, res, next) => {
  try {
    const {
      serviceType,
      name,
      phone,
      email,
      companyName,
      companyAddress
    } = req.body;
    if (!serviceType) {
      console.log("serviceType iS Require");
      return;
    }
    if (!name) {
      console.log("name iS Require");
      return;
    }
    if (!phone) {
      console.log("phone iS Require");
      return;
    }
    if (!email) {
      console.log("email iS Require");
      return;
    }
    if (!companyName) {
      console.log("companyName iS Require");
      return;
    }
    if (!companyAddress) {
      console.log("companyAddress iS Require");
      return;
    }
    // Validate data here or use middleware for validation
    const newService = new Service({
      serviceType,
      name,
      phone,
      email,
      companyName,
      companyAddress
    });
    await newService.save();
    res.status(201).json({
      message: 'Service created successfully',
      data: newService
    });
  } catch (error) {
    next(error);
  }
};
export { createService };