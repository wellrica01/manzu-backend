function formatServiceDisplayName(service) {
  if (service.type === 'medication') {
    return `${service.name}${service.dosage ? ` ${service.dosage}` : ''}${service.form ? ` (${service.form})` : ''}`;
  } else {
    return `${service.name}${service.testType ? ` (${service.testType})` : ''}`;
  }
}

module.exports = { formatServiceDisplayName };