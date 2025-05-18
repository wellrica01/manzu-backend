const express = require('express');
   const { PrismaClient } = require('@prisma/client');
   const z = require('zod');
   const NodeGeocoder = require('node-geocoder');
   const jwt = require('jsonwebtoken');
   const router = express.Router();
   const prisma = new PrismaClient();
   const geocoder = NodeGeocoder({
     provider: 'opencage',
     apiKey: process.env.OPENCAGE_API_KEY,
   });
   const editPharmacySchema = z.object({
     name: z.string().min(1, 'Pharmacy name required'),
     address: z.string().min(1, 'Address required'),
     lga: z.string().min(1, 'LGA required'),
     state: z.string().min(1, 'State required'),
     phone: z.string().regex(/^\+?\d{10,15}$/, 'Invalid phone number'),
     licenseNumber: z.string().min(1, 'License number required'),
     status: z.enum(['pending', 'verified', 'rejected']),
     logoUrl: z.string().url('Invalid URL').optional(),
     isActive: z.boolean(),
   });
   // Middleware to verify JWT and admin role
   const authenticate = (req, res, next) => {
     const authHeader = req.headers.authorization;
     if (!authHeader || !authHeader.startsWith('Bearer ')) {
       console.error('No token provided');
       return res.status(401).json({ message: 'No token provided' });
     }
     const token = authHeader.split(' ')[1];
     try {
       const decoded = jwt.verify(token, process.env.JWT_SECRET);
       req.user = decoded;
       console.log('Token verified:', { adminId: decoded.adminId, role: decoded.role });
       next();
     } catch (error) {
       console.error('Invalid token:', { message: error.message });
       return res.status(401).json({ message: 'Invalid token' });
     }
   };
   const authenticateAdmin = (req, res, next) => {
     if (req.user.role !== 'admin') {
       console.error('Unauthorized: Not an admin', { adminId: req.user.adminId });
       return res.status(403).json({ message: 'Only admins can perform this action' });
     }
     next();
   };
   // Get all pharmacies
 router.get('/pharmacies', authenticate, authenticateAdmin, async (req, res) => {
     try {
       console.log('Received request for /api/admin/pharmacies');
       const pharmacies = await prisma.pharmacy.findMany({
         select: {
           id: true,
           name: true,
           address: true,
           lga: true,
           state: true,
           phone: true,
           licenseNumber: true,
           status: true,
           logoUrl: true,
           isActive: true,
         },
       });
       console.log('Pharmacies fetched:', { count: pharmacies.length });
       res.status(200).json({ message: 'Pharmacies fetched successfully', pharmacies });
     } catch (error) {
       console.error('Fetch pharmacies error:', { message: error.message });
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
   // Edit pharmacy
router.patch('/pharmacies/:id', authenticate, authenticateAdmin, async (req, res) => {
     try {
       const { id } = req.params;
       const parsedId = parseInt(id);
       const data = editPharmacySchema.parse(req.body);
       console.log('Editing pharmacy:', { pharmacyId: parsedId });
       const existingPharmacy = await prisma.pharmacy.findUnique({
         where: { id: parsedId },
       });
       if (!existingPharmacy) {
         console.error('Pharmacy not found:', { pharmacyId: parsedId });
         return res.status(404).json({ message: 'Pharmacy not found' });
       }
       if (data.licenseNumber !== existingPharmacy.licenseNumber) {
         const licenseConflict = await prisma.pharmacy.findUnique({
           where: { licenseNumber: data.licenseNumber },
         });
         if (licenseConflict) {
           console.error('License number already in use:', { licenseNumber: data.licenseNumber });
           return res.status(400).json({ message: 'License number already exists' });
         }
       }
       const addressString = `${data.address}, ${data.lga}, ${data.state}, Nigeria`;
       const geoResult = await geocoder.geocode(addressString);
       if (!geoResult.length) {
         console.error('Geocoding failed:', { address: addressString });
         return res.status(400).json({ message: 'Invalid address: unable to geocode' });
       }
       const { latitude, longitude } = geoResult[0];
       const updatedPharmacy = await prisma.$transaction(async (prisma) => {
         const pharmacy = await prisma.pharmacy.update({
           where: { id: parsedId },
           data: {
             name: data.name,
             address: data.address,
             lga: data.lga,
             state: data.state,
             phone: data.phone,
             licenseNumber: data.licenseNumber,
             status: data.status,
             logoUrl: data.logoUrl,
             isActive: data.isActive,
           },
         });
         await prisma.$queryRaw`
           UPDATE "Pharmacy"
           SET location = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
           WHERE id = ${parsedId}
         `;
         return pharmacy;
       });
       console.log('Pharmacy updated:', { pharmacyId: parsedId });
       res.status(200).json({
         message: 'Pharmacy updated successfully',
         pharmacy: {
           id: updatedPharmacy.id,
           name: updatedPharmacy.name,
           address: updatedPharmacy.address,
           lga: updatedPharmacy.lga,
           state: updatedPharmacy.state,
           phone: updatedPharmacy.phone,
           licenseNumber: updatedPharmacy.licenseNumber,
           status: updatedPharmacy.status,
           logoUrl: updatedPharmacy.logoUrl,
           isActive: updatedPharmacy.isActive,
         },
       });
     } catch (error) {
       console.error('Edit pharmacy error:', { message: error.message });
       if (error instanceof z.ZodError) {
         return res.status(400).json({ message: 'Validation error', errors: error.errors });
       }
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
   // Delete pharmacy
   router.delete('/pharmacies/:id', authenticate, authenticateAdmin, async (req, res) => {
     try {
       const { id } = req.params;
       const parsedId = parseInt(id);
       console.log('Deleting pharmacy:', { pharmacyId: parsedId });
       const existingPharmacy = await prisma.pharmacy.findUnique({
         where: { id: parsedId },
       });
       if (!existingPharmacy) {
         console.error('Pharmacy not found:', { pharmacyId: parsedId });
         return res.status(404).json({ message: 'Pharmacy not found' });
       }
       await prisma.pharmacy.delete({
         where: { id: parsedId },
       });
       console.log('Pharmacy deleted:', { pharmacyId: parsedId });
       res.status(200).json({ message: 'Pharmacy deleted successfully' });
     } catch (error) {
       console.error('Delete pharmacy error:', { message: error.message });
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
   // Get all users
   router.get('/users', authenticate, authenticateAdmin, async (req, res) => {
     try {
       console.log('Received request for /api/admin/users');
       const users = await prisma.pharmacyUser.findMany({
         select: {
           id: true,
           name: true,
           email: true,
           role: true,
           pharmacy: { select: { id: true, name: true } },
         },
       });
       console.log('Users fetched:', { count: users.length });
       res.status(200).json({ message: 'Users fetched successfully', users });
     } catch (error) {
       console.error('Fetch users error:', { message: error.message });
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
   // Get all orders
   router.get('/orders', authenticate, authenticateAdmin, async (req, res) => {
     try {
       console.log('Received request for /api/admin/orders');
       const orders = await prisma.order.findMany({
         select: {
           id: true,
           trackingCode: true,
           patientIdentifier: true,
           totalPrice: true,
           status: true,
           deliveryMethod: true,
           address: true,
           paymentReference: true,
           paymentStatus: true,
           createdAt: true,
           items: {
             select: {
               id: true,
               quantity: true,
               price: true,
               pharmacyMedication: {
                 select: {
                   medication: { select: { id: true, name: true } },
                   pharmacy: { select: { id: true, name: true } },
                 },
               },
             },
           },
           createdAt: true,
         },
       });
       console.log('Orders fetched:', { count: orders.length });
       res.status(200).json({ message: 'Orders fetched successfully', orders });
     } catch (error) {
       console.error('Fetch orders error:', { message: error.message });
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });

module.exports = router;