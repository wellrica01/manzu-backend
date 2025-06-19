const geoData = require('../../data/full.json');

function validateLocation(state, lga, ward, latitude, longitude) {
  const stateData = geoData.find(s => s.state.toLowerCase() === state.toLowerCase());
  if (!stateData) {
    throw new Error('Invalid state');
  }
  const lgaData = stateData.lgas.find(l => l.name.toLowerCase() === lga.toLowerCase());
  if (!lgaData) {
    throw new Error('Invalid LGA for selected state');
  }
  const wardData = lgaData.wards.find(w => w.name.toLowerCase() === ward.toLowerCase());
  if (!wardData) {
    throw new Error('Invalid ward for selected LGA');
  }
  const latDiff = Math.abs(wardData.latitude - latitude);
  const lngDiff = Math.abs(wardData.longitude - longitude);
  if (latDiff > 0.0001 || lngDiff > 0.0001) {
    throw new Error('Coordinates do not match selected ward');
  }
  return { latitude: wardData.latitude, longitude: wardData.longitude };
}

module.exports = { validateLocation };