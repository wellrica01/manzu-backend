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
      INSERT INTO "Pharmacy" (name, location, latitude, longitude, address, lga, state, ward, phone, "licenseNumber", status, "logoUrl")
      VALUES (
        ${pharmacy.name},
        ST_SetSRID(ST_MakePoint(${pharmacy.longitude}, ${pharmacy.latitude}), 4326),
        ${pharmacy.latitude},
        ${pharmacy.longitude},
        ${pharmacy.address},
        ${pharmacy.lga},
        ${pharmacy.state},
        ${pharmacy.ward},
        ${pharmacy.phone},
        ${pharmacy.licenseNumber},
        'PENDING',
        ${logoUrl}
      )
      RETURNING id, name
    `;

    const newUser = await prisma.pharmacyUser.create({
      data: {
        email: user.email,
        password: hashedPassword,
        name: user.name,
        role: 'MANAGER',
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

async function registerLabAndUser({ lab, user }) {
  validateLocation(lab.state, lab.lga, lab.ward, lab.latitude, lab.longitude);

  const existingUser = await prisma.labUser.findUnique({
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
    const logoUrl = lab.logoUrl || null;
    const [newLab] = await prisma.$queryRaw`
      INSERT INTO "Lab" (name, location, address, lga, state, ward, phone, status, "logoUrl")
      VALUES (
        ${lab.name},
        ST_SetSRID(ST_MakePoint(${lab.longitude}, ${lab.latitude}), 4326),
        ${lab.address},
        ${lab.lga},
        ${lab.state},
        ${lab.ward},
        ${lab.phone},
        'pending',
        ${logoUrl}
      )
      RETURNING id, name
    `;

    const newUser = await prisma.labUser.create({
      data: {
        email: user.email,
        password: hashedPassword,
        name: user.name,
        role: 'manager',
        labId: newLab.id,
      },
    });

    return { lab: newLab, user: newUser };
  });

  console.log('Lab and user registered:', { labId: result.lab.id, userId: result.user.id });

  const token = jwt.sign(
    { userId: result.user.id, labId: result.lab.id, role: result.user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return { token, user: result.user, lab: result.lab };
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

async function loginLabUser({ email, password }) {
  const user = await prisma.labUser.findUnique({
    where: { email },
    include: { lab: true },
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

  console.log('Lab user authenticated:', { userId: user.id, labId: user.labId });

  const token = jwt.sign(
    { userId: user.id, labId: user.labId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return { token, user, lab: user.lab };
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
      role: role.toUpperCase(),
      pharmacyId,
    },
  });

  console.log('User added:', { userId: newUser.id, pharmacyId });

  return newUser;
}

async function addLabUser({ name, email, password, role, labId }) {
  const existingUser = await prisma.labUser.findUnique({
    where: { email },
  });
  if (existingUser) {
    const error = new Error('Email already registered');
    error.status = 400;
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const newUser = await prisma.labUser.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role,
      labId,
    },
  });

  console.log('Lab user added:', { userId: newUser.id, labId });

  return newUser;
}

async function editPharmacyUser(userId, { name, email, password, role }, managerId, pharmacyId) {
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
  // If role is present in the update, uppercase it
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

async function editLabUser(userId, { name, email, password }, managerId, labId) {
  if (userId === managerId) {
    const error = new Error('Cannot edit your own account');
    error.status = 403;
    throw error;
  }

  const user = await prisma.labUser.findFirst({
    where: { id: userId, labId },
  });
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  if (email !== user.email) {
    const existingUser = await prisma.labUser.findUnique({
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

  const updatedUser = await prisma.labUser.update({
    where: { id: userId },
    data: updateData,
  });

  console.log('Lab user updated:', { userId: updatedUser.id, labId });

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

async function deleteLabUser(userId, managerId, labId) {
  if (userId === managerId) {
    const error = new Error('Cannot delete your own account');
    error.status = 403;
    throw error;
  }

  const user = await prisma.labUser.findFirst({
    where: { id: userId, labId },
  });
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  await prisma.labUser.delete({
    where: { id: userId },
  });

  console.log('Lab user deleted:', { userId, labId });
}

async function getLabProfile(userId, labId) {
  const user = await prisma.labUser.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  const lab = await prisma.lab.findUnique({
    where: { id: labId },
    select: { id: true, name: true, address: true, lga: true, state: true, ward: true, phone: true, status: true, logoUrl: true },
  });
  if (!lab) {
    const error = new Error('Lab not found');
    error.status = 404;
    throw error;
  }

  console.log('Lab profile fetched:', { userId, labId });

  return { user, lab };
}

async function editLabProfile({ user, lab }, userId, labId) {
  validateLocation(lab.state, lab.lga, lab.ward, lab.latitude, lab.longitude);

  const existingUser = await prisma.labUser.findUnique({
    where: { id: userId },
  });
  if (user.email !== existingUser.email) {
    const emailConflict = await prisma.labUser.findUnique({
      where: { email: user.email },
    });
    if (emailConflict) {
      const error = new Error('Email already registered');
      error.status = 400;
      throw error;
    }
  }

  const result = await prisma.$transaction(async (prisma) => {
    const updatedUser = await prisma.labUser.update({
      where: { id: userId },
      data: { name: user.name, email: user.email },
    });

    const updatedLab = await prisma.lab.update({
      where: { id: labId },
      data: {
        name: lab.name,
        address: lab.address,
        lga: lab.lga,
        state: lab.state,
        ward: lab.ward,
        phone: lab.phone,
        logoUrl: lab.logoUrl || null,
      },
    });

    await prisma.$queryRaw`
      UPDATE "Lab"
      SET location = ST_SetSRID(ST_MakePoint(${lab.longitude}, ${lab.latitude}), 4326)
      WHERE id = ${labId}
    `;

    return { user: updatedUser, lab: updatedLab };
  });

  console.log('Lab profile updated:', { userId, labId });

  return { updatedUser: result.user, updatedLab: result.lab };
}

async function changePharmacyUserPassword(userId, currentPassword, newPassword) {
  const user = await prisma.pharmacyUser.findUnique({ where: { id: userId } });
  if (!user) {
    return { success: false, message: 'User not found' };
  }
  const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
  if (!isPasswordValid) {
    return { success: false, message: 'Current password is incorrect' };
  }
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);
  await prisma.pharmacyUser.update({ where: { id: userId }, data: { password: hashedPassword } });
  return { success: true };
}

module.exports = {
  registerPharmacyAndUser,
  registerLabAndUser,
  loginUser,
  loginLabUser,
  registerAdmin,
  loginAdmin,
  addPharmacyUser,
  addLabUser,
  editPharmacyUser,
  editLabUser,
  deletePharmacyUser,
  deleteLabUser,
  changePharmacyUserPassword,
};