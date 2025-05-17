const express = require('express');
   const bcrypt = require('bcrypt');
   const jwt = require('jsonwebtoken');
   const { PrismaClient } = require('@prisma/client');
   const z = require('zod');
   const NodeGeocoder = require('node-geocoder');
   const router = express.Router();
   const prisma = new PrismaClient();
   const geocoder = NodeGeocoder({
     provider: 'opencage',
     apiKey: process.env.OPENCAGE_API_KEY,
   });
   const registerSchema = z.object({
     pharmacy: z.object({
       name: z.string().min(1, 'Pharmacy name required'),
       address: z.string().min(1, 'Address required'),
       lga: z.string().min(1, 'LGA required'),
       state: z.string().min(1, 'State required'),
       phone: z.string().regex(/^\+?\d{10,15}$/, 'Invalid phone number'),
       licenseNumber: z.string().min(1, 'License number required'),
     }),
     user: z.object({
       name: z.string().min(1, 'User name required'),
       email: z.string().email('Invalid email'),
       password: z.string().min(8, 'Password must be at least 8 characters'),
     }),
   });
   const loginSchema = z.object({
     email: z.string().email('Invalid email'),
     password: z.string().min(1, 'Password required'),
   });
   const addUserSchema = z.object({
     name: z.string().min(1, 'User name required'),
     email: z.string().email('Invalid email'),
     password: z.string().min(8, 'Password must be at least 8 characters'),
     role: z.enum(['pharmacist'], 'Role must be pharmacist'),
   });
   const editUserSchema = z.object({
     name: z.string().min(1, 'User name required'),
     email: z.string().email('Invalid email'),
     password: z.string().min(8, 'Password must be at least 8 characters').optional(),
   });
   const editProfileSchema = z.object({
     user: z.object({
       name: z.string().min(1, 'User name required'),
       email: z.string().email('Invalid email'),
     }),
     pharmacy: z.object({
       name: z.string().min(1, 'Pharmacy name required'),
       address: z.string().min(1, 'Address required'),
       lga: z.string().min(1, 'LGA required'),
       state: z.string().min(1, 'State required'),
       phone: z.string().regex(/^\+?\d{10,15}$/, 'Invalid phone number'),
     }),
   });
  // Middleware to verify JWT
   const authenticate = (req, res, next) => {
     const authHeader = req.headers.authorization;
     if (!authHeader || !authHeader.startsWith('Bearer ')) {
       console.error('No token provided');
       return res.status(401).json({ message: 'No token provided' });
     }
     const token = authHeader.split(' ')[1];
     try {
       const decoded = jwt.verify(token, process.env.JWT_SECRET);
       req.user = decoded; // { userId, pharmacyId, role }
       console.log('Token verified:', { userId: decoded.userId, pharmacyId: decoded.pharmacyId });
       next();
     } catch (error) {
       console.error('Invalid token:', { message: error.message });
       return res.status(401).json({ message: 'Invalid token' });
     }
   };
   // Middleware to verify manager role
   const authenticateManager = (req, res, next) => {
     if (req.user.role !== 'manager') {
       console.error('Unauthorized: Not a manager', { userId: req.user.userId });
       return res.status(403).json({ message: 'Only managers can perform this action' });
     }
     next();
   };
   // Register pharmacy and user
   router.post('/register', async (req, res) => {
     try {
       const { pharmacy, user } = registerSchema.parse(req.body);
       console.log('Registering pharmacy:', { pharmacyName: pharmacy.name, userEmail: user.email });
       // Check for existing pharmacy license
       const existingPharmacy = await prisma.pharmacy.findUnique({
         where: { licenseNumber: pharmacy.licenseNumber },
       });
       if (existingPharmacy) {
         console.error('Pharmacy license exists:', { licenseNumber: pharmacy.licenseNumber });
         return res.status(400).json({ message: 'Pharmacy license number already exists' });
       }
       // Check for existing user email
       const existingUser = await prisma.pharmacyUser.findUnique({
         where: { email: user.email },
       });
       if (existingUser) {
         console.error('User email exists:', { email: user.email });
         return res.status(400).json({ message: 'Email already registered' });
       }
       // Geocode address
       const addressString = `${pharmacy.address}, ${pharmacy.lga}, ${pharmacy.state}, Nigeria`;
       const geoResult = await geocoder.geocode(addressString);
       if (!geoResult.length) {
         console.error('Geocoding failed:', { address: addressString });
         return res.status(400).json({ message: 'Invalid address: unable to geocode' });
       }
       const { latitude, longitude } = geoResult[0];
       // Hash password
       const salt = await bcrypt.genSalt(10);
       const hashedPassword = await bcrypt.hash(user.password, salt);
       // Create pharmacy and user in a transaction
       const result = await prisma.$transaction(async (prisma) => {
         // Insert pharmacy with raw SQL to handle geometry
         const [newPharmacy] = await prisma.$queryRaw`
           INSERT INTO "Pharmacy" (name, location, address, lga, state, phone, "licenseNumber")
           VALUES (
             ${pharmacy.name},
             ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326),
             ${pharmacy.address},
             ${pharmacy.lga},
             ${pharmacy.state},
             ${pharmacy.phone},
             ${pharmacy.licenseNumber}
           )
           RETURNING id, name
         `;
         const newUser = await prisma.pharmacyUser.create({
           data: {
             email: user.email,
             password: hashedPassword,
             name: user.name,
             role: 'manager',
             pharmacyId: newPharmacy.id,
           },
         });
         return { pharmacy: newPharmacy, user: newUser };
       });
       console.log('Pharmacy and user registered:', { pharmacyId: result.pharmacy.id, userId: result.user.id });
       // Generate JWT
       const token = jwt.sign(
         { userId: result.user.id, pharmacyId: result.pharmacy.id, role: result.user.role },
         process.env.JWT_SECRET,
         { expiresIn: '1d' }
       );
       res.status(201).json({
         message: 'Registration successful',
         token,
         user: { id: result.user.id, email: user.email, name: user.name, role: result.user.role },
         pharmacy: { id: result.pharmacy.id, name: result.pharmacy.name },
       });
     } catch (error) {
       console.error('Registration error:', { message: error.message, stack: error.stack });
       if (error instanceof z.ZodError) {
         return res.status(400).json({ message: 'Validation error', errors: error.errors });
       }
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
   // Login user
   router.post('/login', async (req, res) => {
     try {
       const { email, password } = loginSchema.parse(req.body);
       console.log('Logging in user:', { email });
       const user = await prisma.pharmacyUser.findUnique({
         where: { email },
         include: { pharmacy: true },
       });
       if (!user) {
         console.error('User not found:', { email });
         return res.status(401).json({ message: 'Invalid email or password' });
       }
       const isPasswordValid = await bcrypt.compare(password, user.password);
       if (!isPasswordValid) {
         console.error('Invalid password for user:', { email });
         return res.status(401).json({ message: 'Invalid email or password' });
       }
       console.log('User authenticated:', { userId: user.id, pharmacyId: user.pharmacyId });
       const token = jwt.sign(
         { userId: user.id, pharmacyId: user.pharmacyId, role: user.role },
         process.env.JWT_SECRET,
         { expiresIn: '1d' }
       );
       res.status(200).json({
         message: 'Login successful',
         token,
         user: { id: user.id, email: user.email, name: user.name, role: user.role },
         pharmacy: { id: user.pharmacy.id, name: user.pharmacy.name },
       });
     } catch (error) {
       console.error('Login error:', { message: error.message, stack: error.stack });
       if (error instanceof z.ZodError) {
         return res.status(400).json({ message: 'Validation error', errors: error.errors });
       }
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });

  // Add new user to pharmacy (manager only)
   router.post('/add-user', authenticateManager, async (req, res) => {
     try {
       const { name, email, password, role } = addUserSchema.parse(req.body);
       const pharmacyId = req.user.pharmacyId;
       console.log('Adding user to pharmacy:', { email, pharmacyId });
       // Check for existing user email
       const existingUser = await prisma.pharmacyUser.findUnique({
         where: { email },
       });
       if (existingUser) {
         console.error('User email exists:', { email });
         return res.status(400).json({ message: 'Email already registered' });
       }
       // Hash password
       const salt = await bcrypt.genSalt(10);
       const hashedPassword = await bcrypt.hash(password, salt);
       // Create new user
       const newUser = await prisma.pharmacyUser.create({
         data: {
           name,
           email,
           password: hashedPassword,
           role,
           pharmacyId,
         },
       });
       console.log('User added:', { userId: newUser.id, pharmacyId });
       res.status(201).json({
         message: 'User added successfully',
         user: { id: newUser.id, name, email, role },
       });
     } catch (error) {
       console.error('Add user error:', { message: error.message, stack: error.stack });
       if (error instanceof z.ZodError) {
         return res.status(400).json({ message: 'Validation error', errors: error.errors });
       }
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
     // Edit user (manager only)
   router.patch('/users/:userId', authenticateManager, async (req, res) => {
     try {
       const { userId } = req.params;
       const parsedUserId = parseInt(userId);
       const { name, email, password } = editUserSchema.parse(req.body);
       const managerId = req.user.userId;
       const pharmacyId = req.user.pharmacyId;
       console.log('Editing user:', { userId, email, pharmacyId });
       // Prevent self-editing
       if (parsedUserId === managerId) {
         console.error('Cannot edit self:', { userId, managerId });
         return res.status(403).json({ message: 'Cannot edit your own account' });
       }
       // Check if user exists and belongs to pharmacy
       const user = await prisma.pharmacyUser.findFirst({
         where: { id: parsedUserId, pharmacyId },
       });
       if (!user) {
         console.error('User not found or not in pharmacy:', { userId, pharmacyId });
         return res.status(404).json({ message: 'User not found' });
       }
       // Check for email conflict
       if (email !== user.email) {
         const existingUser = await prisma.pharmacyUser.findUnique({
           where: { email },
         });
         if (existingUser) {
           console.error('Email already in use:', { email });
           return res.status(400).json({ message: 'Email already registered' });
         }
       }
       // Prepare update data
       const updateData = { name, email };
       if (password) {
         const salt = await bcrypt.genSalt(10);
         updateData.password = await bcrypt.hash(password, salt);
       }
       // Update user
       const updatedUser = await prisma.pharmacyUser.update({
         where: { id: parsedUserId },
         data: updateData,
       });
       console.log('User updated:', { userId: updatedUser.id, pharmacyId });
       res.status(200).json({
         message: 'User updated successfully',
         user: { id: updatedUser.id, name: updatedUser.name, email: updatedUser.email, role: updatedUser.role },
       });
     } catch (error) {
       console.error('Edit user error:', { message: error.message, stack: error.stack });
       if (error instanceof z.ZodError) {
         return res.status(400).json({ message: 'Validation error', errors: error.errors });
       }
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
   // Delete user (manager only)
   router.delete('/users/:userId', authenticateManager, async (req, res) => {
     try {
       const { userId } = req.params;
       const parsedUserId = parseInt(userId);
       const managerId = req.user.userId;
       const pharmacyId = req.user.pharmacyId;
       console.log('Deleting user:', { userId, pharmacyId });
       // Prevent self-deletion
       if (parsedUserId === managerId) {
         console.error('Cannot delete self:', { userId, managerId });
         return res.status(403).json({ message: 'Cannot delete your own account' });
       }
       // Check if user exists and belongs to pharmacy
       const user = await prisma.pharmacyUser.findFirst({
         where: { id: parsedUserId, pharmacyId },
       });
       if (!user) {
         console.error('User not found or not in pharmacy:', { userId, pharmacyId });
         return res.status(404).json({ message: 'User not found' });
       }
       // Delete user
       await prisma.pharmacyUser.delete({
         where: { id: parsedUserId },
       });
       console.log('User deleted:', { userId, pharmacyId });
       res.status(200).json({ message: 'User deleted successfully' });
     } catch (error) {
       console.error('Delete user error:', { message: error.message, stack: error.stack });
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
  
      // Get profile details
   router.get('/profile', authenticate, async (req, res) => {
     try {
       const { userId, pharmacyId } = req.user;
       console.log('Fetching profile:', { userId, pharmacyId });
       const user = await prisma.pharmacyUser.findUnique({
         where: { id: userId },
         select: { id: true, name: true, email: true, role: true },
       });
       if (!user) {
         console.error('User not found:', { userId });
         return res.status(404).json({ message: 'User not found' });
       }
       const pharmacy = await prisma.pharmacy.findUnique({
         where: { id: pharmacyId },
         select: { id: true, name: true, address: true, lga: true, state: true, phone: true, licenseNumber: true },
       });
       if (!pharmacy) {
         console.error('Pharmacy not found:', { pharmacyId });
         return res.status(404).json({ message: 'Pharmacy not found' });
       }
       console.log('Profile fetched:', { userId, pharmacyId });
       res.status(200).json({
         message: 'Profile fetched successfully',
         user,
         pharmacy,
       });
     } catch (error) {
       console.error('Fetch profile error:', { message: error.message, stack: error.stack });
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
   // Edit profile (manager only)
   router.patch('/profile', authenticate, authenticateManager, async (req, res) => {
     try {
       const { user, pharmacy } = editProfileSchema.parse(req.body);
       const { userId, pharmacyId } = req.user;
       console.log('Editing profile:', { userId, pharmacyId, userEmail: user.email });
       if (user.email !== (await prisma.pharmacyUser.findUnique({ where: { id: userId } })).email) {
         const existingUser = await prisma.pharmacyUser.findUnique({
           where: { email: user.email },
         });
         if (existingUser) {
           console.error('Email already in use:', { email: user.email });
           return res.status(400).json({ message: 'Email already registered' });
         }
       }
       const addressString = `${pharmacy.address}, ${pharmacy.lga}, ${pharmacy.state}, Nigeria`;
       const geoResult = await geocoder.geocode(addressString);
       if (!geoResult.length) {
         console.error('Geocoding failed:', { address: addressString });
         return res.status(400).json({ message: 'Invalid address: unable to geocode' });
       }
       const { latitude, longitude } = geoResult[0];
       const result = await prisma.$transaction(async (prisma) => {
         const updatedUser = await prisma.pharmacyUser.update({
           where: { id: userId },
           data: { name: user.name, email: user.email },
         });
         const updatedPharmacy = await prisma.pharmacy.update({
           where: { id: pharmacyId },
           data: {
             name: pharmacy.name,
             address: pharmacy.address,
             lga: pharmacy.lga,
             state: pharmacy.state,
             phone: pharmacy.phone,
           },
         });
         await prisma.$queryRaw`
           UPDATE "Pharmacy"
           SET location = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
           WHERE id = ${pharmacyId}
         `;
         return { user: updatedUser, pharmacy: updatedPharmacy };
       });
       console.log('Profile updated:', { userId, pharmacyId });
       res.status(200).json({
         message: 'Profile updated successfully',
         user: { id: result.user.id, name: result.user.name, email: result.user.email, role: result.user.role },
         pharmacy: {
           id: result.pharmacy.id,
           name: result.pharmacy.name,
           address: result.pharmacy.address,
           lga: result.pharmacy.lga,
           state: result.pharmacy.state,
           phone: result.pharmacy.phone,
           licenseNumber: result.pharmacy.licenseNumber,
         },
       });
     } catch (error) {
       console.error('Edit profile error:', { message: error.message, stack: error.stack });
       if (error instanceof z.ZodError) {
         return res.status(400).json({ message: 'Validation error', errors: error.errors });
       }
       res.status(500).json({ message: 'Server error', error: error.message });
     }
   });
   

   module.exports = router;