const z = require('zod');

const registerDeviceSchema = z.object({
  deviceToken: z.string().min(1, 'Device token required'),
  pharmacyId: z.number().int().positive('Invalid pharmacy ID'),
});

module.exports = { registerDeviceSchema };