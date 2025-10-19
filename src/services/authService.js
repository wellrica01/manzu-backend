const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validateLocation } = require('../utils/location');
const prisma = new PrismaClient();

async function registerPharmacyAndUser({ pharmacy, user }) {
  // Validate location (state, lga, and GPS bounds)
  validateLocation(pharmacy.state, pharmacy.lga, pharmacy.latitude, pharmacy.longitude);

  const existingPharmacy = await prisma.pharmacy.findUnique({
    where: { licenseNumber: pharmacy.licenseNumber },
  });
  if (existingPharmacy) {
    const error = new Error('Pharmacy license number already exists');
    error.status = 400;
    throw error;
  }

  const existingUser = await prisma.pharmacyUser.findUnique({
    where: { email: user.email },
  });
  if (existingUser) {
    const error = new Error('Email already registered');
    error.status = 400;
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPin = await bcrypt.hash(user.pin, salt);

  const result = await prisma.$transaction(async (prisma) => {
    const logoUrl = pharmacy.logoUrl || null;
    const locationAccuracy = pharmacy.locationAccuracy || null;
    const locationCapturedAt = new Date();

    // Insert pharmacy with precise GPS coordinates
    const [newPharmacy] = await prisma.$queryRaw`
      INSERT INTO "Pharmacy" (
        name, 
        location, 
        latitude,
        longitude,
        "locationAccuracy",
        "locationCapturedAt",
        address, 
        lga, 
        state, 
        phone, 
        "licenseNumber", 
        status, 
        "logoUrl"
      )
      VALUES (
        ${pharmacy.name},
        ST_SetSRID(ST_MakePoint(${pharmacy.longitude}, ${pharmacy.latitude}), 4326),
        ${pharmacy.latitude},
        ${pharmacy.longitude},
        ${locationAccuracy},
        ${locationCapturedAt},
        ${pharmacy.address},
        ${pharmacy.lga},
        ${pharmacy.state},
        ${pharmacy.phone},
        ${pharmacy.licenseNumber},
        'PENDING',
        ${logoUrl}
      )
      RETURNING id, name, latitude, longitude, "locationAccuracy"
    `;

    const newUser = await prisma.pharmacyUser.create({
      data: {
        email: user.email,
        password: hashedPin,
        name: user.name,
        role: 'MANAGER',
        pharmacyId: newPharmacy.id,
      },
    });

    return { pharmacy: newPharmacy, user: newUser };
  });

  console.log('Pharmacy registered with GPS:', { 
    pharmacyId: result.pharmacy.id, 
    lat: result.pharmacy.latitude,
    lng: result.pharmacy.longitude,
    accuracy: result.pharmacy.locationAccuracy
  });

  const token = jwt.sign(
    { userId: result.user.id, pharmacyId: result.pharmacy.id, role: result.user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return { token, user: result.user, pharmacy: result.pharmacy };
}

async function loginUser({ email, pin }) {
  const user = await prisma.pharmacyUser.findUnique({
    where: { email },
    include: { Pharmacy: true },
  });
  if (!user) {
    const error = new Error('Invalid email or PIN');
    error.status = 401;
    throw error;
  }

  const isPinValid = await bcrypt.compare(pin, user.password);
  if (!isPinValid) {
    const error = new Error('Invalid email or PIN');
    error.status = 401;
    throw error;
  }

  console.log('User authenticated with PIN:', { userId: user.id, pharmacyId: user.pharmacyId });

  const token = jwt.sign(
    { userId: user.id, pharmacyId: user.pharmacyId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return { token, user, pharmacy: user.Pharmacy };
}


async function registerAdmin({ name, email, password }) {
  const existingAdmin = await prisma.adminUser.findUnique({
    where: { email },
  });
  if (existingAdmin) {
    const error = new Error('Email already registered');
    error.status = 400;
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const newAdmin = await prisma.adminUser.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role: 'ADMIN',
    },
  });

  console.log('Admin registered:', { adminId: newAdmin.id });

  const token = jwt.sign(
    { adminId: newAdmin.id, role: newAdmin.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return { token, admin: newAdmin };
}

async function loginAdmin({ email, password }) {
  const admin = await prisma.adminUser.findUnique({
    where: { email },
  });
  if (!admin) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }

  const isPasswordValid = await bcrypt.compare(password, admin.password);
  if (!isPasswordValid) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }

  console.log('Admin authenticated:', { adminId: admin.id });

  const token = jwt.sign(
    { adminId: admin.id, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return { token, admin };
}


async function addPharmacyUser({ name, email, pin, role, pharmacyId }) {
  const existingUser = await prisma.pharmacyUser.findUnique({
    where: { email },
  });
  if (existingUser) {
    const error = new Error('Email already registered');
    error.status = 400;
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPin = await bcrypt.hash(pin, salt);

  const newUser = await prisma.pharmacyUser.create({
    data: {
      name,
      email,
      password: hashedPin,
      role: role.toUpperCase(),
      pharmacyId,
    },
  });

  console.log('User added with PIN:', { userId: newUser.id, pharmacyId });

  return newUser;
}

async function editPharmacyUser(userId, { name, email, pin, role }, managerId, pharmacyId) {
  if (userId === managerId) {
    const error = new Error('Cannot edit your own account');
    error.status = 403;
    throw error;
  }

  const user = await prisma.pharmacyUser.findFirst({
    where: { id: userId, pharmacyId },
  });
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  if (email !== user.email) {
    const existingUser = await prisma.pharmacyUser.findUnique({
      where: { email },
    });
    if (existingUser) {
      const error = new Error('Email already registered');
      error.status = 400;
      throw error;
    }
  }

  const updateData = { name, email };
  if (pin) {
    const salt = await bcrypt.genSalt(10);
    updateData.password = await bcrypt.hash(pin, salt);
  }
  if (typeof role !== 'undefined') {
    updateData.role = role.toUpperCase();
  }

  const updatedUser = await prisma.pharmacyUser.update({
    where: { id: userId },
    data: updateData,
  });

  console.log('User updated:', { userId: updatedUser.id, pharmacyId });

  return updatedUser;
}


async function deletePharmacyUser(userId, managerId, pharmacyId) {
  if (userId === managerId) {
    const error = new Error('Cannot delete your own account');
    error.status = 403;
    throw error;
  }

  const user = await prisma.pharmacyUser.findFirst({
    where: { id: userId, pharmacyId },
  });
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  await prisma.pharmacyUser.delete({
    where: { id: userId },
  });

  console.log('User deleted:', { userId, pharmacyId });
}


async function changePharmacyUserPin(userId, currentPin, newPin) {
  const user = await prisma.pharmacyUser.findUnique({ where: { id: userId } });
  if (!user) {
    return { success: false, message: 'User not found' };
  }

  // Compare entered PIN with stored hashed password
  const isPinValid = await bcrypt.compare(currentPin, user.password);
  if (!isPinValid) {
    return { success: false, message: 'Current PIN is incorrect' };
  }

  // Hash new PIN before saving
  const salt = await bcrypt.genSalt(10);
  const hashedPin = await bcrypt.hash(newPin, salt);

  await prisma.pharmacyUser.update({
    where: { id: userId },
    data: { password: hashedPin },
  });

  return { success: true };
}

module.exports = {
  registerPharmacyAndUser,
  loginUser,
  registerAdmin,
  loginAdmin,
  addPharmacyUser,
  editPharmacyUser,
  deletePharmacyUser,
  changePharmacyUserPin,
};