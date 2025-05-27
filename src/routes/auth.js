const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const z = require('zod');
const router = express.Router();
const prisma = new PrismaClient();
const geoData = require('../../data/full.json'); // Load full.json


const registerSchema = z.object({
    pharmacy: z.object({
    name: z.string().min(1, 'Pharmacy name required'),
    address: z.string().min(1, 'Address required'),
    lga: z.string().min(1, 'LGA required'),
    state: z.string().min(1, 'State required'),
    ward: z.string().min(1, 'Ward required'),
    latitude: z.number().min(-90).max(90, 'Invalid latitude'),
    longitude: z.number().min(-180).max(180, 'Invalid longitude'),
    phone: z.string().regex(/^\+?\d{10,15}$/, 'Invalid phone number'),
    licenseNumber: z.string().min(1, 'License number required'),
    logoUrl: z.string().url('Invalid URL').optional(),
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
    ward: z.string().min(1, 'Ward required'),
    latitude: z.number().min(-90).max(90, 'Invalid latitude'),
    longitude: z.number().min(-180).max(180, 'Invalid longitude'),
    phone: z.string().regex(/^\+?\d{10,15}$/, 'Invalid phone number'),
    logoUrl: z.string().url('Invalid URL').optional(),
    }),
});
    const adminRegisterSchema = z.object({
    name: z.string().min(1, 'Name required'),
    email: z.string().email('Invalid email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
});
const adminLoginSchema = z.object({
    email: z.string().email('Invalid email'),
    password: z.string().min(1, 'Password required'),
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
    req.user = decoded; // { userId, pharmacyId, role } or { adminId, role }
    console.log('Token verified:', { userId: decoded.userId, adminId: decoded.adminId, pharmacyId: decoded.pharmacyId });       next();
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

// Middleware to verify admin role
const authenticateAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
    console.error('Unauthorized: Not an admin', { adminId: req.user.adminId });
    return res.status(403).json({ message: 'Only admins can perform this action' });
    }
    next();
};

// Validate state, LGA, and ward against full.json
const validateLocation = (state, lga, ward, latitude, longitude) => {
    const stateData = geoData.find(s => s.state.toLowerCase() === state.toLowerCase());
    if (!stateData) {
        throw new Error('Invalid state');
    }
    const lgaData = stateData.lgas.find(l => l.name.toLowerCase() === lga.toLowerCase());
    if (!lgaData) {
        throw new Error('Invalid LGA for selected state');
    }
    const wardData = lgaData.wards.find(w => w.name.toLowerCase() === ward.toLowerCase());
    if (!wardData) {
        throw new Error('Invalid ward for selected LGA');
    }
    // Allow small tolerance for floating-point precision
    const latDiff = Math.abs(wardData.latitude - latitude);
    const lngDiff = Math.abs(wardData.longitude - longitude);
    if (latDiff > 0.0001 || lngDiff > 0.0001) {
        throw new Error('Coordinates do not match selected ward');
    }
    return { latitude: wardData.latitude, longitude: wardData.longitude };
};


// Register pharmacy and user
router.post('/register', async (req, res) => {
    try {
    const { pharmacy, user } = registerSchema.parse(req.body);
    console.log('Registering pharmacy:', { pharmacyName: pharmacy.name, userEmail: user.email });
    
   // Validate location
      validateLocation(pharmacy.state, pharmacy.lga, pharmacy.ward, pharmacy.latitude, 
        pharmacy.longitude);

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

    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(user.password, salt);

    // Create pharmacy and user in a transaction
    const result = await prisma.$transaction(async (prisma) => {
    const logoUrl = pharmacy.logoUrl || null;

    // Insert pharmacy with raw SQL to handle geometry
    const [newPharmacy] = await prisma.$queryRaw`
    INSERT INTO "Pharmacy" (name, location, address, lga, state, ward, phone, "licenseNumber", status, "logoUrl")
    VALUES (
        ${pharmacy.name},
        ST_SetSRID(ST_MakePoint(${pharmacy.longitude}, ${pharmacy.latitude}), 4326),
        ${pharmacy.address},
        ${pharmacy.lga},
        ${pharmacy.state},
        ${pharmacy.ward},
        ${pharmacy.phone},
        ${pharmacy.licenseNumber},
        'pending',
        ${logoUrl}
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

    // Register admin
router.post('/admin/register', async (req, res) => {
    try {
    const { name, email, password } = adminRegisterSchema.parse(req.body);
    console.log('Registering admin:', { email });
    const existingAdmin = await prisma.adminUser.findUnique({
        where: { email },
    });
    if (existingAdmin) {
        console.error('Admin email exists:', { email });
        return res.status(400).json({ message: 'Email already registered' });
    }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const newAdmin = await prisma.adminUser.create({
        data: {
        name,
        email,
        password: hashedPassword,
        role: 'admin',
        },
    });
    console.log('Admin registered:', { adminId: newAdmin.id });
    const token = jwt.sign(
        { adminId: newAdmin.id, role: newAdmin.role },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
    );
    res.status(201).json({
        message: 'Admin registration successful',
        token,
        admin: { id: newAdmin.id, name, email, role: newAdmin.role },
    });
    } catch (error) {
    console.error('Admin registration error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Login admin
router.post('/admin/login', async (req, res) => {
    try {
    const { email, password } = adminLoginSchema.parse(req.body);
    console.log('Logging in admin:', { email });
    const admin = await prisma.adminUser.findUnique({
        where: { email },
    });
    if (!admin) {
        console.error('Admin not found:', { email });
        return res.status(401).json({ message: 'Invalid email or password' });
    }
    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
        console.error('Invalid password for admin:', { email });
        return res.status(401).json({ message: 'Invalid email or password' });
    }
    console.log('Admin authenticated:', { adminId: admin.id });
    const token = jwt.sign(
        { adminId: admin.id, role: admin.role },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
    );
    res.status(200).json({
        message: 'Admin login successful',
        token,
        admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    });
    } catch (error) {
    console.error('Admin login error:', { message: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Add new user to pharmacy (manager only)
router.post('/add-user', authenticate, authenticateManager, async (req, res) => {
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
router.patch('/users/:userId', authenticate, authenticateManager, async (req, res) => {
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
router.delete('/users/:userId', authenticate, authenticateManager, async (req, res) => {
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
        select: { id: true, name: true, address: true, lga: true, state: true, ward: true, phone: true, licenseNumber: true, status: true, logoUrl: true },
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

    // Validate location
     validateLocation(pharmacy.state, pharmacy.lga, pharmacy.ward, pharmacy.latitude, pharmacy.longitude);

    if (user.email !== (await prisma.pharmacyUser.findUnique({ where: { id: userId } })).email) {
        const existingUser = await prisma.pharmacyUser.findUnique({
        where: { email: user.email },
        });
        if (existingUser) {
        console.error('Email already in use:', { email: user.email });
        return res.status(400).json({ message: 'Email already registered' });
        }
    }

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
            ward: pharmacy.ward,
            phone: pharmacy.phone,
            logoUrl: pharmacy.logoUrl || null, // Update logoUrl if provided, else null
        },
        });
        await prisma.$queryRaw`
        UPDATE "Pharmacy"
        SET location = ST_SetSRID(ST_MakePoint(${pharmacy.longitude}, ${pharmacy.latitude}), 4326)
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
        ward: result.pharmacy.ward,
        phone: result.pharmacy.phone,
        licenseNumber: result.pharmacy.licenseNumber,
        logoUrl: result.pharmacy.logoUrl, // Include logoUrl in response
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