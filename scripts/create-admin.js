#!/usr/bin/env node

require('dotenv').config();

const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function promptLine(question) {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new Error('A terminal is required for hidden password input. Set ADMIN_PASSWORD in the environment instead.'));
      return;
    }

    let password = '';

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();

    function restore() {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    }

    function onData(chunk) {
      const input = chunk.toString('utf8');

      for (const character of input) {
        if (character === '\u0003') {
          restore();
          reject(new Error('Cancelled.'));
          return;
        }

        if (character === '\r' || character === '\n') {
          restore();
          resolve(password);
          return;
        }

        if (character === '\u007f' || character === '\b') {
          password = password.slice(0, -1);
          continue;
        }

        if (character >= ' ') {
          password += character;
        }
      }
    }

    stdin.on('data', onData);
  });
}

async function main() {
  const name = process.env.ADMIN_NAME || await promptLine('Admin name: ');
  const email = (process.env.ADMIN_EMAIL || await promptLine('Admin email: ')).toLowerCase();

  let password = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;

  if (!password) {
    password = await promptHidden('Admin password (input hidden): ');
    const confirmation = await promptHidden('Confirm password: ');

    if (password !== confirmation) {
      throw new Error('Passwords do not match.');
    }
  }

  if (!name) {
    throw new Error('Admin name is required.');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid admin email address is required.');
  }

  if (password.length < 12) {
    throw new Error('Admin password must be at least 12 characters.');
  }

  const existingAdmin = await prisma.adminUser.findUnique({
    where: { email }
  });

  if (existingAdmin) {
    throw new Error('An admin with that email already exists.');
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const admin = await prisma.adminUser.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role: 'SUPER_ADMIN'
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true
    }
  });

  console.log('Admin account created successfully.');
  console.log(`Admin ID: ${admin.id}`);
  console.log(`Email: ${admin.email}`);
  console.log(`Role: ${admin.role}`);
}

main()
  .catch((error) => {
    console.error(`Admin provisioning failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
