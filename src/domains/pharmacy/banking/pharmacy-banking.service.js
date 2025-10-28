/**
 * PHARMACY BANKING SERVICE
 * 
 * Business logic for pharmacy banking operations
 */

const repository = require('./pharmacy-banking.repository');
const prisma = require('../../../core/database/prisma');
const axios = require('axios');
const { createAuditLog } = require('../../../utils/audit-logger');

// Audit actions for banking
const AUDIT_ACTIONS = {
  BANKING_SETUP: 'BANKING_SETUP',
  BANKING_UPDATED: 'BANKING_UPDATED',
  BANKING_VERIFIED: 'BANKING_VERIFIED',
  BANKING_VERIFICATION_FAILED: 'BANKING_VERIFICATION_FAILED',
};

const ENTITY_TYPES = {
  PHARMACY: 'Pharmacy',
};

/**
 * Verify bank account with Paystack
 */
async function verifyBankAccount(accountNumber, bankCode) {
  try {
    const response = await axios.get(
      `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (response.data.status && response.data.data) {
      return {
        success: true,
        accountName: response.data.data.account_name,
        accountNumber: response.data.data.account_number,
      };
    }

    return { success: false, error: 'Account verification failed' };
  } catch (error) {
    console.error('Bank verification error:', error.message);
    return { 
      success: false, 
      error: error.response?.data?.message || 'Unable to verify account' 
    };
  }
}

/**
 * Create Paystack transfer recipient
 */
async function createTransferRecipient(pharmacyName, accountNumber, bankCode) {
  try {
    const response = await axios.post(
      'https://api.paystack.co/transferrecipient',
      {
        type: 'nuban',
        name: pharmacyName,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'NGN',
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (response.data.status && response.data.data) {
      return {
        success: true,
        recipientCode: response.data.data.recipient_code,
      };
    }

    return { success: false, error: 'Failed to create recipient' };
  } catch (error) {
    console.error('Create recipient error:', error.message);
    return { 
      success: false, 
      error: error.response?.data?.message || 'Unable to create recipient' 
    };
  }
}

/**
 * Setup pharmacy banking details
 */
async function setupBankAccount(pharmacyId, { accountNumber, bankCode, bankName }) {
  // Validate inputs
  if (!accountNumber || !bankCode || !bankName) {
    throw new Error('Account number, bank code, and bank name are required');
  }

  if (accountNumber.length !== 10) {
    throw new Error('Account number must be 10 digits');
  }

  // Get pharmacy details
  const pharmacy = await repository.findPharmacyBanking(pharmacyId);
  
  if (!pharmacy) {
    throw new Error('Pharmacy not found');
  }

  // Check if already has banking setup
  if (pharmacy.recipientCode) {
    throw new Error('Banking already configured. Use update endpoint to modify.');
  }

  // Step 1: Verify account with Paystack
  const verification = await verifyBankAccount(accountNumber, bankCode);
  
  if (!verification.success) {
    await createAuditLog({
      action: AUDIT_ACTIONS.BANKING_VERIFICATION_FAILED,
      entityType: ENTITY_TYPES.PHARMACY,
      entityId: pharmacyId,
      details: {
        accountNumber,
        bankCode,
        error: verification.error,
      },
    });
    
    throw new Error(verification.error);
  }

  // Step 2: Create Paystack transfer recipient
  const recipient = await createTransferRecipient(
    pharmacy.name,
    accountNumber,
    bankCode
  );

  if (!recipient.success) {
    await createAuditLog({
      action: AUDIT_ACTIONS.BANKING_VERIFICATION_FAILED,
      entityType: ENTITY_TYPES.PHARMACY,
      entityId: pharmacyId,
      details: {
        accountNumber,
        bankCode,
        accountName: verification.accountName,
        error: recipient.error,
      },
    });
    
    throw new Error(recipient.error);
  }

  // Step 3: Save to database
  const result = await prisma.$transaction(async (tx) => {
    const updated = await repository.updatePharmacyBanking(
      pharmacyId,
      {
        accountNumber,
        bankCode,
        bankName,
        accountName: verification.accountName,
        recipientCode: recipient.recipientCode,
      },
      tx
    );

    await createAuditLog({
      action: AUDIT_ACTIONS.BANKING_SETUP,
      entityType: ENTITY_TYPES.PHARMACY,
      entityId: pharmacyId,
      details: {
        accountNumber,
        bankCode,
        bankName,
        accountName: verification.accountName,
        recipientCode: recipient.recipientCode,
      },
      tx,
    });

    return updated;
  });

  console.log('Banking setup completed:', { pharmacyId });

  return {
    message: 'Banking setup successful',
    accountName: verification.accountName,
    accountNumber,
    bankName,
  };
}

/**
 * Update pharmacy banking details
 */
async function updateBankAccount(pharmacyId, { accountNumber, bankCode, bankName }) {
  // Similar to setup but allows overwriting existing
  const verification = await verifyBankAccount(accountNumber, bankCode);
  
  if (!verification.success) {
    throw new Error(verification.error);
  }

  const pharmacy = await repository.findPharmacyBanking(pharmacyId);
  
  const recipient = await createTransferRecipient(
    pharmacy.name,
    accountNumber,
    bankCode
  );

  if (!recipient.success) {
    throw new Error(recipient.error);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await repository.updatePharmacyBanking(
      pharmacyId,
      {
        accountNumber,
        bankCode,
        bankName,
        accountName: verification.accountName,
        recipientCode: recipient.recipientCode,
      },
      tx
    );

    await createAuditLog({
      action: AUDIT_ACTIONS.BANKING_UPDATED,
      entityType: ENTITY_TYPES.PHARMACY,
      entityId: pharmacyId,
      details: {
        accountNumber,
        bankCode,
        bankName,
        accountName: verification.accountName,
        oldRecipientCode: pharmacy.recipientCode,
        newRecipientCode: recipient.recipientCode,
      },
      tx,
    });

    return updated;
  });

  console.log('Banking updated:', { pharmacyId });

  return {
    message: 'Banking updated successfully',
    accountName: verification.accountName,
    accountNumber,
    bankName,
  };
}

/**
 * Get banking status
 */
async function getBankingStatus(pharmacyId) {
  const pharmacy = await repository.findPharmacyBanking(pharmacyId);
  
  if (!pharmacy) {
    throw new Error('Pharmacy not found');
  }

  const hasSetup = !!pharmacy.recipientCode;

  return {
    hasSetup,
    bankName: pharmacy.bankName || null,
    accountNumber: pharmacy.accountNumber ? 
      `****${pharmacy.accountNumber.slice(-4)}` : null,
    accountName: pharmacy.accountName || null,
  };
}

/**
 * Get list of Nigerian banks from Paystack
 */
async function getNigerianBanks() {
  try {
    const response = await axios.get(
      'https://api.paystack.co/bank?currency=NGN',
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
        timeout: 10000,
      }
    );

    if (response.data.status && response.data.data) {
      return response.data.data.map(bank => ({
        name: bank.name,
        code: bank.code,
        slug: bank.slug,
      }));
    }

    return [];
  } catch (error) {
    console.error('Fetch banks error:', error.message);
    return [];
  }
}

module.exports = {
  setupBankAccount,
  updateBankAccount,
  getBankingStatus,
  verifyBankAccount,
  getNigerianBanks,
};