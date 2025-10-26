/**
 * PAYMENT RECONCILIATION SERVICE
 * 
 * Reconciles Paystack transactions with database orders
 * Detects and reports payment discrepancies
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const { reportError, ErrorCategory } = require('../utils/error-reporter');
const { createAuditLog, AUDIT_ACTIONS, ENTITY_TYPES } = require('../utils/audit-logger');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_API_BASE = 'https://api.paystack.co';

/**
 * Fetch Paystack transactions for date range
 */
async function fetchPaystackTransactions(startDate, endDate) {
  try {
    console.log(`📥 Fetching Paystack transactions from ${startDate} to ${endDate}...`);
    
    const transactions = [];
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      const response = await axios.get(`${PAYSTACK_API_BASE}/transaction`, {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        params: {
          perPage: 100,
          page: page,
          from: startDate,
          to: endDate,
          status: 'success' // Only successful transactions
        }
      });
      
      if (response.data.status && response.data.data) {
        transactions.push(...response.data.data);
        
        // Check if there are more pages
        const meta = response.data.meta;
        hasMore = meta && meta.pageCount > page;
        page++;
      } else {
        hasMore = false;
      }
    }
    
    console.log(`✅ Fetched ${transactions.length} Paystack transactions`);
    return transactions;
    
  } catch (error) {
    console.error('❌ Failed to fetch Paystack transactions:', error.message);
    throw new Error(`Paystack API error: ${error.message}`);
  }
}

/**
 * Fetch database orders for date range
 */
async function fetchDatabaseOrders(startDate, endDate) {
  try {
    console.log(`📥 Fetching database orders from ${startDate} to ${endDate}...`);
    
    const orders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        },
        paymentStatus: 'PAID'
      },
      select: {
        id: true,
        paymentReference: true,
        totalPrice: true,
        paymentStatus: true,
        createdAt: true,
        email: true,
        trackingCode: true
      }
    });
    
    console.log(`✅ Fetched ${orders.length} paid orders from database`);
    return orders;
    
  } catch (error) {
    console.error('❌ Failed to fetch database orders:', error.message);
    throw error;
  }
}

/**
 * Compare and identify discrepancies
 */
function compareTransactions(paystackTxns, databaseOrders) {
  console.log('🔍 Comparing transactions...');
  
  const discrepancies = {
    paystackNotInDb: [],      // Paid in Paystack but not marked paid in DB
    dbNotInPaystack: [],      // Marked paid in DB but no Paystack record
    amountMismatch: [],       // Payment amounts don't match
    duplicate: []             // Duplicate payment references
  };
  
  // Create maps for quick lookup
  const paystackMap = new Map();
  const dbMap = new Map();
  
  // Build Paystack map
  paystackTxns.forEach(txn => {
    const reference = txn.reference;
    if (paystackMap.has(reference)) {
      // Duplicate in Paystack
      discrepancies.duplicate.push({
        reference,
        source: 'PAYSTACK',
        amount: txn.amount / 100, // Paystack uses kobo
        date: txn.paid_at
      });
    }
    paystackMap.set(reference, txn);
  });
  
  // Build database map
  databaseOrders.forEach(order => {
    const reference = order.paymentReference;
    if (dbMap.has(reference)) {
      // Duplicate in database
      discrepancies.duplicate.push({
        reference,
        source: 'DATABASE',
        orderId: order.id,
        amount: parseFloat(order.totalPrice),
        date: order.createdAt
      });
    }
    dbMap.set(reference, order);
  });
  
  // Check Paystack transactions against database
  paystackTxns.forEach(txn => {
    const reference = txn.reference;
    const paystackAmount = txn.amount / 100; // Convert kobo to naira
    
    const dbOrder = dbMap.get(reference);
    
    if (!dbOrder) {
      // Paid in Paystack but not in database
      discrepancies.paystackNotInDb.push({
        reference,
        paystackAmount,
        paystackDate: txn.paid_at,
        paystackEmail: txn.customer?.email,
        paystackStatus: txn.status
      });
    } else {
      // Check amount match
      const dbAmount = parseFloat(dbOrder.totalPrice);
      const difference = Math.abs(paystackAmount - dbAmount);
      
      // Allow 1 kobo difference due to rounding
      if (difference > 0.01) {
        discrepancies.amountMismatch.push({
          reference,
          orderId: dbOrder.id,
          trackingCode: dbOrder.trackingCode,
          paystackAmount,
          databaseAmount: dbAmount,
          difference,
          email: dbOrder.email
        });
      }
    }
  });
  
  // Check database orders against Paystack
  databaseOrders.forEach(order => {
    const reference = order.paymentReference;
    
    if (!paystackMap.has(reference)) {
      // Marked paid in database but no Paystack record
      discrepancies.dbNotInPaystack.push({
        reference,
        orderId: order.id,
        trackingCode: order.trackingCode,
        databaseAmount: parseFloat(order.totalPrice),
        orderDate: order.createdAt,
        email: order.email
      });
    }
  });
  
  const totalDiscrepancies = 
    discrepancies.paystackNotInDb.length +
    discrepancies.dbNotInPaystack.length +
    discrepancies.amountMismatch.length +
    discrepancies.duplicate.length;
  
  console.log(`📊 Comparison complete: ${totalDiscrepancies} discrepancies found`);
  
  return discrepancies;
}

/**
 * Calculate financial totals
 */
function calculateTotals(paystackTxns, databaseOrders, discrepancies) {
  const paystackTotal = paystackTxns.reduce((sum, txn) => sum + (txn.amount / 100), 0);
  const databaseTotal = databaseOrders.reduce((sum, order) => sum + parseFloat(order.totalPrice), 0);
  
  let discrepancyAmount = 0;
  
  // Add amounts from discrepancies
  discrepancies.paystackNotInDb.forEach(d => {
    discrepancyAmount += d.paystackAmount;
  });
  
  discrepancies.dbNotInPaystack.forEach(d => {
    discrepancyAmount += d.databaseAmount;
  });
  
  discrepancies.amountMismatch.forEach(d => {
    discrepancyAmount += Math.abs(d.difference);
  });
  
  return {
    paystackTotal: paystackTotal.toFixed(2),
    databaseTotal: databaseTotal.toFixed(2),
    discrepancyAmount: discrepancyAmount.toFixed(2),
    difference: Math.abs(paystackTotal - databaseTotal).toFixed(2)
  };
}

/**
 * Perform reconciliation for date range
 */
async function reconcile(startDate, endDate, triggeredBy = 'MANUAL') {
  const startTime = Date.now();
  
  try {
    console.log('\n' + '='.repeat(60));
    console.log('🔄 STARTING PAYMENT RECONCILIATION');
    console.log('='.repeat(60));
    console.log(`📅 Date Range: ${startDate} to ${endDate}`);
    console.log(`👤 Triggered By: ${triggeredBy}\n`);
    
    // Create report record
    const report = await prisma.reconciliationReport.create({
      data: {
        reconciliationDate: new Date(),
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        status: 'IN_PROGRESS',
        triggeredBy,
        totalPaystackTxns: 0,
        totalDatabaseOrders: 0,
        matchedCount: 0,
        mismatchCount: 0,
        paystackTotalAmount: 0,
        databaseTotalAmount: 0,
        discrepancyAmount: 0
      }
    });
    
    console.log(`📝 Report ID: ${report.id}\n`);
    
    // Fetch data from both sources
    const [paystackTxns, databaseOrders] = await Promise.all([
      fetchPaystackTransactions(startDate, endDate),
      fetchDatabaseOrders(startDate, endDate)
    ]);
    
    // Compare and find discrepancies
    const discrepancies = compareTransactions(paystackTxns, databaseOrders);
    
    // Calculate totals
    const totals = calculateTotals(paystackTxns, databaseOrders, discrepancies);
    
    // Calculate matched count
    const totalDiscrepancies = 
      discrepancies.paystackNotInDb.length +
      discrepancies.dbNotInPaystack.length +
      discrepancies.amountMismatch.length +
      discrepancies.duplicate.length;
    
    const matchedCount = Math.min(paystackTxns.length, databaseOrders.length) - totalDiscrepancies;
    
    // Update report
    const executionTime = Date.now() - startTime;
    
    const updatedReport = await prisma.reconciliationReport.update({
      where: { id: report.id },
      data: {
        status: 'COMPLETED',
        totalPaystackTxns: paystackTxns.length,
        totalDatabaseOrders: databaseOrders.length,
        matchedCount: Math.max(0, matchedCount),
        mismatchCount: totalDiscrepancies,
        paystackTotalAmount: totals.paystackTotal,
        databaseTotalAmount: totals.databaseTotal,
        discrepancyAmount: totals.discrepancyAmount,
        discrepancies: discrepancies,
        executionTimeMs: executionTime
      }
    });
    
    // Create audit log
    await createAuditLog({
      action: 'RECONCILIATION_COMPLETED',
      entityType: 'System',
      entityId: report.id,
      details: {
        startDate,
        endDate,
        totalDiscrepancies,
        executionTimeMs: executionTime,
        triggeredBy
      }
    }).catch(err => console.warn('Failed to create audit log:', err));
    
    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ RECONCILIATION COMPLETE');
    console.log('='.repeat(60));
    console.log(`📊 Summary:`);
    console.log(`   Paystack Transactions: ${paystackTxns.length}`);
    console.log(`   Database Orders: ${databaseOrders.length}`);
    console.log(`   Matched: ${Math.max(0, matchedCount)}`);
    console.log(`   Discrepancies: ${totalDiscrepancies}`);
    console.log(`\n💰 Financial:`);
    console.log(`   Paystack Total: ₦${totals.paystackTotal}`);
    console.log(`   Database Total: ₦${totals.databaseTotal}`);
    console.log(`   Difference: ₦${totals.difference}`);
    console.log(`\n⏱️  Execution Time: ${executionTime}ms`);
    console.log('='.repeat(60) + '\n');
    
    // Alert if discrepancies found
    if (totalDiscrepancies > 0) {
      console.warn(`⚠️  ${totalDiscrepancies} discrepancies detected!`);
      await sendReconciliationAlert(updatedReport, discrepancies);
    }
    
    return updatedReport;
    
  } catch (error) {
    const executionTime = Date.now() - startTime;
    
    console.error('\n' + '='.repeat(60));
    console.error('❌ RECONCILIATION FAILED');
    console.error('='.repeat(60));
    console.error(`Error: ${error.message}\n`);
    
    // Update report with error
    if (report) {
      await prisma.reconciliationReport.update({
        where: { id: report.id },
        data: {
          status: 'FAILED',
          errorMessage: error.message,
          executionTimeMs: executionTime
        }
      }).catch(err => console.error('Failed to update report:', err));
    }
    
    // Report error to Sentry
    await reportError(error, {
      category: ErrorCategory.BUSINESS_LOGIC,
      context: { startDate, endDate, triggeredBy }
    });
    
    throw error;
  }
}

/**
 * Send alert email for discrepancies
 */
async function sendReconciliationAlert(report, discrepancies) {
  try {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    
    const adminEmail = process.env.ADMIN_EMAIL || process.env.SENDGRID_FROM_EMAIL;
    
    const totalDiscrepancies = report.mismatchCount;
    const criticalIssues = 
      discrepancies.paystackNotInDb.length +
      discrepancies.dbNotInPaystack.length;
    
    // Build email content
    let emailBody = `
      <h2 style="color: #d32f2f;">⚠️ Payment Reconciliation Alert</h2>
      <p><strong>Report ID:</strong> ${report.id}</p>
      <p><strong>Date Range:</strong> ${report.startDate.toISOString().split('T')[0]} to ${report.endDate.toISOString().split('T')[0]}</p>
      
      <h3>Summary</h3>
      <ul>
        <li>Total Discrepancies: <strong>${totalDiscrepancies}</strong></li>
        <li>Paystack Transactions: ${report.totalPaystackTxns}</li>
        <li>Database Orders: ${report.totalDatabaseOrders}</li>
        <li>Matched: ${report.matchedCount}</li>
      </ul>
      
      <h3>Financial</h3>
      <ul>
        <li>Paystack Total: ₦${report.paystackTotalAmount}</li>
        <li>Database Total: ₦${report.databaseTotalAmount}</li>
        <li>Discrepancy Amount: <strong style="color: #d32f2f;">₦${report.discrepancyAmount}</strong></li>
      </ul>
    `;
    
    // Add critical issues
    if (discrepancies.paystackNotInDb.length > 0) {
      emailBody += `
        <h3 style="color: #d32f2f;">🚨 Paid in Paystack but NOT in Database (${discrepancies.paystackNotInDb.length})</h3>
        <ul>
      `;
      discrepancies.paystackNotInDb.slice(0, 10).forEach(d => {
        emailBody += `<li>Ref: ${d.reference} - ₦${d.paystackAmount} - ${d.paystackEmail}</li>`;
      });
      if (discrepancies.paystackNotInDb.length > 10) {
        emailBody += `<li><em>...and ${discrepancies.paystackNotInDb.length - 10} more</em></li>`;
      }
      emailBody += `</ul>`;
    }
    
    if (discrepancies.dbNotInPaystack.length > 0) {
      emailBody += `
        <h3 style="color: #d32f2f;">🚨 Marked Paid in Database but NO Paystack Record (${discrepancies.dbNotInPaystack.length})</h3>
        <ul>
      `;
      discrepancies.dbNotInPaystack.slice(0, 10).forEach(d => {
        emailBody += `<li>Order #${d.trackingCode} - Ref: ${d.reference} - ₦${d.databaseAmount}</li>`;
      });
      if (discrepancies.dbNotInPaystack.length > 10) {
        emailBody += `<li><em>...and ${discrepancies.dbNotInPaystack.length - 10} more</em></li>`;
      }
      emailBody += `</ul>`;
    }
    
    if (discrepancies.amountMismatch.length > 0) {
      emailBody += `
        <h3 style="color: #ff9800;">⚠️ Amount Mismatches (${discrepancies.amountMismatch.length})</h3>
        <ul>
      `;
      discrepancies.amountMismatch.slice(0, 10).forEach(d => {
        emailBody += `<li>Order #${d.trackingCode} - Paystack: ₦${d.paystackAmount} vs DB: ₦${d.databaseAmount} (Diff: ₦${d.difference})</li>`;
      });
      if (discrepancies.amountMismatch.length > 10) {
        emailBody += `<li><em>...and ${discrepancies.amountMismatch.length - 10} more</em></li>`;
      }
      emailBody += `</ul>`;
    }
    
    emailBody += `
      <p style="margin-top: 30px;">
        <a href="${process.env.BACKEND_URL}/api/admin/reconciliation/${report.id}" 
           style="background: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
          View Full Report
        </a>
      </p>
      
      <p style="color: #666; margin-top: 30px; font-size: 12px;">
        This is an automated alert from the Payment Reconciliation System.
      </p>
    `;
    
    const message = {
      to: adminEmail,
      from: process.env.SENDGRID_FROM_EMAIL,
      subject: `🚨 Payment Reconciliation Alert: ${totalDiscrepancies} Discrepancies Found`,
      html: emailBody
    };
    
    await sgMail.send(message);
    console.log(`✅ Alert email sent to ${adminEmail}`);
    
    // Also report to Sentry if critical issues
    if (criticalIssues > 0) {
      await reportError(new Error(`Payment reconciliation found ${criticalIssues} critical discrepancies`), {
        category: ErrorCategory.BUSINESS_LOGIC,
        context: {
          reportId: report.id,
          totalDiscrepancies,
          criticalIssues,
          paystackNotInDb: discrepancies.paystackNotInDb.length,
          dbNotInPaystack: discrepancies.dbNotInPaystack.length
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Failed to send reconciliation alert:', error.message);
    // Don't throw - alert failure shouldn't stop reconciliation
  }
}

/**
 * Reconcile previous day's transactions
 */
async function reconcilePreviousDay() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  
  const startDate = yesterday.toISOString().split('T')[0];
  
  const endOfYesterday = new Date(yesterday);
  endOfYesterday.setHours(23, 59, 59, 999);
  const endDate = endOfYesterday.toISOString().split('T')[0];
  
  return reconcile(startDate, endDate, 'CRON');
}

/**
 * Get reconciliation report by ID
 */
async function getReport(reportId) {
  return prisma.reconciliationReport.findUnique({
    where: { id: reportId }
  });
}

/**
 * Get recent reconciliation reports
 */
async function getRecentReports(limit = 30) {
  return prisma.reconciliationReport.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit
  });
}

module.exports = {
  reconcile,
  reconcilePreviousDay,
  getReport,
  getRecentReports,
  fetchPaystackTransactions,
  fetchDatabaseOrders
};