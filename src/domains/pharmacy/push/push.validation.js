const Joi = require('joi');

const registerPushTokenSchema = Joi.object({
  token: Joi.string().trim().max(255).required(),
  platform: Joi.string().valid('ios', 'android').required(),
});

const pushTokenParamSchema = Joi.object({
  token: Joi.string().trim().max(255).required(),
});

function validateRegisterPushToken(data) {
  return registerPushTokenSchema.validate(data, { abortEarly: false });
}

function validatePushTokenParam(data) {
  return pushTokenParamSchema.validate(data, { abortEarly: false });
}

module.exports = { validateRegisterPushToken, validatePushTokenParam };
