function formatDisplayName(med) {
  return `${med.name}${med.dosage ? ` ${med.dosage}` : ''}${med.form ? ` (${med.form})` : ''}`;
}

module.exports = { formatDisplayName };