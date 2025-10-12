// utils/location.js
const STATE_LGA_MAP = require('../../data/stateLga.json');

function validateLocation(state, lga, latitude, longitude) {
  // Validate state exists
  if (!STATE_LGA_MAP[state]) {
    const error = new Error(`Invalid state: ${state}`);
    error.status = 400;
    throw error;
  }

  // Validate LGA exists in state
  if (!STATE_LGA_MAP[state].includes(lga)) {
    const error = new Error(`Invalid LGA: ${lga} for state: ${state}`);
    error.status = 400;
    throw error;
  }

  // Validate coordinates are within Nigeria's bounds
  // Nigeria approximate bounds: lat 4-14°N, lng 3-15°E
  if (latitude < 4 || latitude > 14) {
    const error = new Error('Latitude must be within Nigeria (4°N to 14°N)');
    error.status = 400;
    throw error;
  }

  if (longitude < 3 || longitude > 15) {
    const error = new Error('Longitude must be within Nigeria (3°E to 15°E)');
    error.status = 400;
    throw error;
  }

  // Optional: Add more specific state-based validation
  // You could check if coordinates roughly match the state's known bounds

  return true;
}

module.exports = { validateLocation };