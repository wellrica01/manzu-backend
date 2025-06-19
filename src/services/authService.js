const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validateLocation } = require('../utils/location');
const prisma = new PrismaClient();

async function registerPharmacyAndUser({ pharmacy, user }) {
  validateLocation(pharmacy.state, pharmacy.lga, pharmacy.ward, pharmacy.latitude, pharmacy.longitude);

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
  const hashedPassword = await bcrypt.hash(user.password, salt);

  const result = await prisma.$transaction(async (prisma) => {
    const logoUrl = pharmacy.logoUrl || null;
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

  const token = jwt.sign(
    { userId: result.user.id, pharmacyId: result.pharmacy.id, role: result.user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return { token, user: result.user, pharmacy: result.pharmacy };
}

async function loginUser({ email, password }) {
  const user = await prisma.pharmacyUser.findUnique({
    where: { email },
    include: { pharmacy: true },
  });
  if (!user) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }

  console.log('User authenticated:', { userId: user.id, pharmacyId: user.pharmacyId });

  const token = jwt.sign(
    { userId: user.id, pharmacyId: user.pharmacyId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return { token, user, pharmacy: user.pharmacy };
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
      role: 'admin',
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

async function addPharmacyUser({ name, email, password, role, pharmacyId }) {
  const existingUser = await prisma.pharmacyUser.findUnique({
    where: { email },
  });
  if (existingUser) {
    const error = new Error('Email already registered');
    error.status = 400;
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

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

  return newUser;
}

async function editPharmacyUser(userId, { name, email, password }, managerId, pharmacyId) {
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
  if (password) {
    const salt = await bcrypt.genSalt(10);
    updateData.password = await bcrypt.hash(password, salt);
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

async function getProfile(userId, pharmacyId) {
  const user = await prisma.pharmacyUser.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: { id: true, name: true, address: true, lga: true, state: true, ward: true, phone: true, licenseNumber: true, status: true, logoUrl: true },
  });
  if (!pharmacy) {
    const error = new Error('Pharmacy not found');
    error.status = 404;
    throw error;
  }

  console.log('Profile fetched:', { userId, pharmacyId });

  return { user, pharmacy };
}

async function editProfile({ user, pharmacy }, userId, pharmacyId) {
  validateLocation(pharmacy.state, pharmacy.lga, pharmacy.ward, pharmacy.latitude, pharmacy.longitude);

  const existingUser = await prisma.pharmacyUser.findUnique({
    where: { id: userId },
  });
  if (user.email !== existingUser.email) {
    const emailConflict = await prisma.pharmacyUser.findUnique({
      where: { email: user.email },
    });
    if (emailConflict) {
      const error = new Error('Email already registered');
      error.status = 400;
      throw error;
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
        logoUrl: pharmacy.logoUrl || null,
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

  return { updatedUser: result.user, updatedPharmacy: result.pharmacy };
}

module.exports = {
  registerPharmacyAndUser,
  loginUser,
  registerAdmin,
  loginAdmin,
  addPharmacyUser,
  editPharmacyUser,
  deletePharmacyUser,
  getProfile,
  editProfile,
};