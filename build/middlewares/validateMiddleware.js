import Joi from 'joi';
const serviceSchema = Joi.object({
  serviceType: Joi.string().valid('User', 'Carrier', 'Mechanic', 'Towing').required(),
  name: Joi.string().required(),
  phone: Joi.string().required(),
  email: Joi.string().email().required(),
  companyName: Joi.string().optional(),
  companyAddress: Joi.string().optional()
});
const validateService = (req, res, next) => {
  const {
    error
  } = serviceSchema.validate(req.body);
  if (error) return res.status(400).json({
    error: error.details[0].message
  });
  next();
};
export { validateService };