/**
 * ADMIN USERS REPOSITORY
 * 
 * Database access layer for admin user management
 */

const prisma = require('../../../core/database/prisma');

/**
 * Find admin users with filters and pagination
 */
async function findAdminUsers({ skip, limit, where }) {
  return await prisma.$transaction([
    prisma.adminUser.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
      take: limit,
      skip,
    }),
    prisma.adminUser.count({ where }),
  ]);
}

/**
 * Find admin user by ID
 */
async function findAdminUserById(id) {
  return await prisma.adminUser.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });
}

/**
 * Find pharmacy users with filters and pagination
 */
async function findPharmacyUsers({ skip, limit, where }) {
  return await prisma.$transaction([
    prisma.pharmacyUser.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        pharmacy: {
          select: { id: true, name: true },
        },
      },
      take: limit,
      skip,
    }),
    prisma.pharmacyUser.count({ where }),
  ]);
}

/**
 * Find pharmacy user by ID
 */
async function findPharmacyUserById(id) {
  return await prisma.pharmacyUser.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      lastLogin: true,
      pharmacy: {
        select: { id: true, name: true },
      },
    },
  });
}

module.exports = {
  findAdminUsers,
  findAdminUserById,
  findPharmacyUsers,
  findPharmacyUserById,
};