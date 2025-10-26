/**
 * SAFE QUERY UTILITIES
 * 
 * Wrappers for safe raw SQL queries with automatic validation
 * Use these when you need raw SQL but want extra safety
 */

const { PrismaClient } = require('@prisma/client');
const { sanitizeString, validateNoSQLKeywords } = require('../middleware/input-sanitizer');

const prisma = new PrismaClient();

/**
 * Safe raw query with automatic parameterization
 * 
 * Usage:
 * const results = await safeQueryRaw`
 *   SELECT * FROM "User" WHERE email = ${email}
 * `;
 */
async function safeQueryRaw(strings, ...values) {
  // Validate all string values
  for (let i = 0; i < values.length; i++) {
    if (typeof values[i] === 'string') {
      // Check for SQL keywords
      if (!validateNoSQLKeywords(values[i])) {
        throw new Error(`Suspicious SQL keyword detected in parameter ${i}: ${values[i].substring(0, 50)}`);
      }
      
      // Sanitize the value
      values[i] = sanitizeString(values[i]);
    }
  }
  
  // Use Prisma's safe $queryRaw with tagged template
  return prisma.$queryRaw(strings, ...values);
}

/**
 * Safe execute raw with validation
 */
async function safeExecuteRaw(strings, ...values) {
  // Validate all string values
  for (let i = 0; i < values.length; i++) {
    if (typeof values[i] === 'string') {
      if (!validateNoSQLKeywords(values[i])) {
        throw new Error(`Suspicious SQL keyword detected in parameter ${i}`);
      }
      values[i] = sanitizeString(values[i]);
    }
  }
  
  return prisma.$executeRaw(strings, ...values);
}

/**
 * Validate and sanitize WHERE clause parameters
 */
function validateWhereParams(params) {
  const validated = {};
  
  for (const key in params) {
    const value = params[key];
    
    // Validate key (column name)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      throw new Error(`Invalid column name: ${key}`);
    }
    
    // Validate value
    if (typeof value === 'string') {
      if (!validateNoSQLKeywords(value)) {
        throw new Error(`Suspicious value for ${key}: ${value}`);
      }
      validated[key] = sanitizeString(value);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      validated[key] = value;
    } else if (value === null) {
      validated[key] = null;
    } else {
      throw new Error(`Invalid value type for ${key}: ${typeof value}`);
    }
  }
  
  return validated;
}

/**
 * Validate ORDER BY clause
 */
function validateOrderBy(column, direction = 'ASC') {
  // Validate column name (alphanumeric and underscore only)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) {
    throw new Error(`Invalid column name for ORDER BY: ${column}`);
  }
  
  // Validate direction (whitelist)
  const validDirections = ['ASC', 'DESC', 'asc', 'desc'];
  if (!validDirections.includes(direction)) {
    throw new Error(`Invalid ORDER BY direction: ${direction}`);
  }
  
  return { column, direction: direction.toUpperCase() };
}

/**
 * Validate LIMIT and OFFSET
 */
function validatePagination(limit, offset = 0) {
  // Ensure they are positive integers
  const validLimit = parseInt(limit, 10);
  const validOffset = parseInt(offset, 10);
  
  if (isNaN(validLimit) || validLimit < 1 || validLimit > 1000) {
    throw new Error(`Invalid LIMIT: ${limit}`);
  }
  
  if (isNaN(validOffset) || validOffset < 0) {
    throw new Error(`Invalid OFFSET: ${offset}`);
  }
  
  return { limit: validLimit, offset: validOffset };
}

/**
 * Build safe WHERE clause for Prisma
 */
function buildSafeWhere(filters) {
  const where = {};
  
  for (const key in filters) {
    const value = filters[key];
    
    // Validate key
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      continue; // Skip invalid keys
    }
    
    // Handle different value types
    if (value === null) {
      where[key] = null;
    } else if (typeof value === 'string') {
      // For strings, use contains for search
      where[key] = {
        contains: sanitizeString(value),
        mode: 'insensitive'
      };
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      where[key] = value;
    } else if (typeof value === 'object' && value.operator) {
      // Handle operators like gt, lt, gte, lte
      const validOperators = ['gt', 'gte', 'lt', 'lte', 'not', 'in', 'notIn'];
      if (validOperators.includes(value.operator)) {
        where[key] = { [value.operator]: value.value };
      }
    }
  }
  
  return where;
}

/**
 * Safe search query builder
 */
function buildSafeSearch(searchTerm, searchFields) {
  if (!searchTerm || typeof searchTerm !== 'string') {
    return {};
  }
  
  // Sanitize search term
  const sanitized = sanitizeString(searchTerm);
  
  if (sanitized.length === 0) {
    return {};
  }
  
  // Build OR conditions for multiple fields
  const OR = searchFields.map(field => {
    // Validate field name
    if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(field)) {
      throw new Error(`Invalid search field: ${field}`);
    }
    
    // Handle nested fields (e.g., "User.email")
    const parts = field.split('.');
    if (parts.length === 1) {
      return {
        [field]: {
          contains: sanitized,
          mode: 'insensitive'
        }
      };
    } else {
      // Nested field
      const [relation, nestedField] = parts;
      return {
        [relation]: {
          [nestedField]: {
            contains: sanitized,
            mode: 'insensitive'
          }
        }
      };
    }
  });
  
  return { OR };
}

/**
 * Validate table name (for dynamic queries)
 */
function validateTableName(tableName) {
  // Only allow alphanumeric and underscore
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  
  // Whitelist of allowed tables (optional - add your tables here)
  const allowedTables = [
    'User',
    'Pharmacy',
    'Medication',
    'Order',
    'OrderItem',
    'Prescription',
    'MedicationAvailability'
  ];
  
  if (!allowedTables.includes(tableName)) {
    throw new Error(`Table not in whitelist: ${tableName}`);
  }
  
  return tableName;
}

/**
 * Validate column name
 */
function validateColumnName(columnName) {
  // Only allow alphanumeric and underscore
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(columnName)) {
    throw new Error(`Invalid column name: ${columnName}`);
  }
  
  return columnName;
}

/**
 * Example: Safe dynamic query builder
 */
async function safeDynamicQuery({ table, columns = ['*'], where = {}, orderBy, limit, offset }) {
  // Validate table
  const validTable = validateTableName(table);
  
  // Validate columns
  const validColumns = columns.map(col => {
    if (col === '*') return '*';
    return validateColumnName(col);
  });
  
  // Validate WHERE parameters
  const validWhere = validateWhereParams(where);
  
  // Validate ORDER BY
  let orderByClause = '';
  if (orderBy) {
    const { column, direction } = validateOrderBy(orderBy.column, orderBy.direction);
    orderByClause = `ORDER BY "${column}" ${direction}`;
  }
  
  // Validate pagination
  let paginationClause = '';
  if (limit) {
    const { limit: validLimit, offset: validOffset } = validatePagination(limit, offset);
    paginationClause = `LIMIT ${validLimit} OFFSET ${validOffset}`;
  }
  
  // Build WHERE clause
  const whereConditions = Object.entries(validWhere).map(([key, value]) => {
    return `"${key}" = ${typeof value === 'string' ? `'${value}'` : value}`;
  });
  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
  
  // Build query (still use parameterized queries!)
  const query = `
    SELECT ${validColumns.join(', ')}
    FROM "${validTable}"
    ${whereClause}
    ${orderByClause}
    ${paginationClause}
  `;
  
  console.log('Safe dynamic query:', query);
  
  // Execute with Prisma (this is just an example - prefer Prisma's type-safe queries)
  return prisma.$queryRawUnsafe(query);
}

module.exports = {
  safeQueryRaw,
  safeExecuteRaw,
  validateWhereParams,
  validateOrderBy,
  validatePagination,
  buildSafeWhere,
  buildSafeSearch,
  validateTableName,
  validateColumnName,
  safeDynamicQuery
};
