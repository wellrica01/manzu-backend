const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validateLocation } = require('../utils/location');
const prisma = new PrismaClient();

async function registerProviderAndUser({ provider, user }) {
  validateLocation(provider.state, provider.lga, provider.ward, provider.latitude, provider.longitude);

  if (provider.licenseNumber) {
    const existingProvider = await prisma.provider.findUnique({
      where: { licenseNumber: provider.licenseNumber },
    });
    if (existingProvider) {
      const error = new Error('Provider license number already exists');
      error.status = 400;
      throw error;
    }
  }

  const existingUser = await prisma.providerUser.findUnique({
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
    const logoUrl = provider.logoUrl || null;
    const [newProvider] = await prisma.$queryRaw`
      INSERT INTO "Provider" (name, address, lga, state, ward, phone, "licenseNumber", status, "logoUrl", "isActive", "homeCollectionAvailable", location)
      VALUES (
        ${provider.name},
        ${provider.address},
        ${provider.lga},
        ${provider.state},
        ${provider.ward},
        ${provider.phone},
        ${provider.licenseNumber || null},
        'pending',
        ${logoUrl},
        false,
        ${provider.homeCollectionAvailable || false},
        ST_SetSRID(ST_MakePoint(${provider.longitude}, ${provider.latitude}), 4326)
      )
      RETURNING id, name
    `;

    const newUser = await prisma.providerUser.create({
      data: {
        email: user.email,
        password: hashedPassword,
        name: user.name,
        role: 'manager',
        providerId: newProvider.id,
      },
    });

    return { provider: newProvider, user: newUser };
  });

  console.log('Provider and user registered:', { providerId: result.provider.id, userId: result.user.id });

  const token = jwt.sign(
    { userId: result.user.id, providerId: result.provider.id, role: 'manager' },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return { token, user: result.user, provider: result.provider };
}

async function loginProviderUser({ email, password }) {
  const user = await prisma.providerUser.findUnique({
    where: { email },
    include: { provider: true },
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

  console.log('Provider user authenticated:', { userId: user.id, providerId: user.providerId });

  const token = jwt.sign(
    { userId: user.id, providerId: user.providerId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return { token, user, provider: user.provider };
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

async function addProviderUser({ name, email, password, role, providerId }) {
  const existingUser = await prisma.providerUser.findUnique({
    where: { email },
  });
  if (existingUser) {
    const error = new Error('Email already registered');
    error.status = 400;
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const newUser = await prisma.providerUser.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role,
      providerId,
    },
  });

  console.log('Provider user added:', { userId: newUser.id, providerId });

  return newUser;
}

async function editProviderUser(userId, { name, email, password }, managerId, providerId) {
  if (userId === managerId) {
    const error = new Error('Cannot edit your own account');
    error.status = 403;
    throw error;
  }

  const user = await prisma.providerUser.findFirst({
    where: { id: userId, providerId },
  });
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  if (email !== user.email) {
    const existingUser = await prisma.providerUser.findUnique({
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

  const updatedUser = await prisma.providerUser.update({
    where: { id: userId },
    data: updateData,
  });

  console.log('Provider user updated:', { userId: updatedUser.id, providerId });

  return updatedUser;
}

async function deleteProviderUser(userId, managerId, providerId) {
  if (userId === managerId) {
    const error = new Error('Cannot delete your own account');
    error.status = 403;
    throw error;
  }

  const user = await prisma.providerUser.findFirst({
    where: { id: userId, providerId },
  });
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  await prisma.providerUser.delete({
    where: { id: userId },
  });

  console.log('Provider user deleted:', { userId, providerId });
}

async function getProviderProfile(userId, providerId) {
  const user = await prisma.providerUser.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      name: true,
      address: true,
      lga: true,
      state: true,
      ward: true,
      phone: true,
      licenseNumber: true,
      status: true,
      logoUrl: true,
      homeCollectionAvailable: true,
    },
  });
  if (!provider) {
    const error = new Error('Provider not found');
    error.status = 404;
    throw error;
  }

  console.log('Provider profile fetched:', { userId, providerId });

  return { user, provider };
}

async function editProviderProfile({ user, provider }, userId, providerId) {
  validateLocation(provider.state, provider.lga, provider.ward, provider.latitude, provider.longitude);

  const existingUser = await prisma.providerUser.findUnique({
    where: { id: userId },
  });
  if (user.email !== existingUser.email) {
    const emailConflict = await prisma.providerUser.findUnique({
      where: { email: user.email },
    });
    if (emailConflict) {
      const error = new Error('Email already registered');
      error.status = 400;
      throw error;
    }
  }

  if (provider.licenseNumber && provider.licenseNumber !== (await prisma.provider.findUnique({ where: { id: providerId } }))?.licenseNumber) {
    const licenseConflict = await prisma.provider.findUnique({
      where: { licenseNumber: provider.licenseNumber },
    });
    if (licenseConflict) {
      const error = new Error('License number already registered');
      error.status = 400;
      throw error;
    }
  }

  const result = await prisma.$transaction(async (prisma) => {
    const updatedUser = await prisma.providerUser.update({
      where: { id: userId },
      data: { name: user.name, email: user.email },
    });

    const updatedProvider = await prisma.provider.update({
      where: { id: providerId },
      data: {
        name: provider.name,
        address: provider.address,
        lga: provider.lga,
        state: provider.state,
        ward: provider.ward,
        phone: provider.phone,
        licenseNumber: provider.licenseNumber || null,
        logoUrl: provider.logoUrl || null,
        homeCollectionAvailable: provider.homeCollectionAvailable,
      },
    });

    await prisma.$queryRaw`
      UPDATE "Provider"
      SET location = ST_SetSRID(ST_MakePoint(${provider.longitude}, ${provider.latitude}), 4326)
      WHERE id = ${providerId}
    `;

    return { user: updatedUser, provider: updatedProvider };
  });

  console.log('Provider profile updated:', { userId, providerId });

  return { updatedUser: result.user, updatedProvider: result.provider };
}

module.exports = {
  registerProviderAndUser,
  loginProviderUser,
  registerAdmin,
  loginAdmin,
  addProviderUser,
  editProviderUser,
  deleteProviderUser,
  getProviderProfile,
  editProviderProfile,
};