function formatDisplayName(med) {
  // Use brandName, strengthValue, strengthUnit, form, and genericMedication.name if available
  const brand = med.brandName || med.name || '';
  const generic = med.genericMedication?.name ? ` [${med.genericMedication.name}]` : '';
  const strength = med.strengthValue ? ` ${med.strengthValue}${med.strengthUnit ? med.strengthUnit : ''}` : '';
  const form = med.form ? ` (${med.form})` : '';
  return `${brand}${strength}${form}${generic}`.trim();
}

module.exports = { formatDisplayName };