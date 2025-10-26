const express = require('express');
const supabase = require('../utils/supabaseClient')
const upload = require('../utils/upload')
const { normalizeMedicationFields, handleImageUpload } = require('../utils/medicationUtils')
const z = require('zod');
const reconciliationService = require('../services/reconciliationService');
const adminPrescriptionsService = require('../domains/admin/prescriptions/admin-prescriptions.service');
const adminOrdersService = require('../domains/admin/orders/admin-orders.service');
const adminUsersService = require('../domains/admin/users/admin-users.service');
const adminMedicationsService = require('../domains/admin/medications/admin-medications.service');
const adminPharmaciesService = require('../domains/admin/pharmacies/admin-pharmacies.service');
const adminDashboardService = require('../domains/admin/dashboard/admin-dashboard.service');
const atcClassificationsService = require('../domains/admin/atc-classifications/atc-classifications.service');
const genericNamesService = require('../domains/admin/generic-names/generic-names.service');
const activeSubstancesService = require('../domains/admin/active-substances/active-substances.service');
const medicationIngredientsService = require('../domains/admin/medication-ingredients/medication-ingredients.service');
const manufacturersService = require('../domains/admin/manufacturers/manufacturers.service');
const indicationsService = require('../domains/admin/indications/indications.service');


const { queryAuditLogs, getAuditTrail } = require('../utils/audit-logger');
const {
  // Core
  paginationSchema,

  // Pharmacy
  editPharmacySchema,
  registerSchema,
  editProfileSchema,

  // Medications
  createMedicationSchema,
  updateMedicationSchema,
  medicationFilterSchema,

  // Filters
  prescriptionFilterSchema,
  orderFilterSchema,
  adminUserFilterSchema,
  pharmacyUserFilterSchema,

  // Manufacturers & Indications
  manufacturerSchema,
  indicationSchema,

  // Generic Names
  GenericNameSchema,
  GenericNameUpdateSchema,

  // Active Substances
  ActiveSubstanceSchema,
  ActiveSubstanceUpdateSchema,

  // Medication Ingredients
  MedicationIngredientSchema,
  MedicationIngredientUpdateSchema,

  // ATC Classification
  AnatomicalClassSchema,
  AnatomicalClassUpdateSchema,
  TherapeuticClassSchema,
  TherapeuticClassUpdateSchema,
  PharmacologicalClassSchema,
  PharmacologicalClassUpdateSchema,
  ChemicalClassSchema,
  ChemicalClassUpdateSchema,
  ChemicalSubstanceSchema,
  ChemicalSubstanceUpdateSchema,
} = require('../utils/adminValidation');

const { handleError } = require('../utils/handleError');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const router = express.Router();

console.log('Loaded admin.js version: 2025-07-15-v3 (new schema)');

// ==================== UTILITY FUNCTIONS ====================
const parseId = (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ success: false, message: 'Invalid ID parameter' });
    return null;
  }
  return id;
};

const standardResponse = (res, status, message, data = null, pagination = null) => {
  const response = { success: status < 400, message };
  if (data) response.data = data;
  if (pagination) response.pagination = pagination;
  return res.status(status).json(response);
};

// ==================== DASHBOARD ====================
router.get('/dashboard', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const summary = await adminDashboardService.getDashboardOverview();
    standardResponse(res, 200, 'Dashboard data fetched successfully', { summary });
  } catch (error) {
    console.error('Fetch dashboard error:', { message: error.message });
    standardResponse(res, 500, 'Server error', null);
  }
});

// ==================== PHARMACIES ====================
router.get('/pharmacies', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const query = {
      ...paginationSchema.parse(req.query),
      status: req.query.status,
      state: req.query.state,
      name: req.query.name,
    };
    const { pharmacies, pagination } = await adminPharmaciesService.getPharmacies(query);
    standardResponse(res, 200, 'Pharmacies fetched successfully', { pharmacies }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/pharmacies/simple', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const simplePharmacies = await adminPharmaciesService.getSimplePharmacies();
    standardResponse(res, 200, 'Pharmacies fetched successfully', { simplePharmacies });
  } catch (error) {
    console.error('Fetch pharmacies error:', { message: error.message });
    standardResponse(res, 500, 'Server error');
  }
});

router.get('/pharmacies/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const pharmacy = await adminPharmaciesService.getPharmacy(id);
    standardResponse(res, 200, 'Pharmacy fetched successfully', { pharmacy });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch('/pharmacies/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const data = { 
      ...editPharmacySchema.parse(req.body), 
      status: req.body.status?.toUpperCase() 
    };
    const pharmacy = await adminPharmaciesService.updatePharmacy(id, data);
    standardResponse(res, 200, 'Pharmacy updated successfully', { pharmacy });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete('/pharmacies/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    await adminPharmaciesService.deletePharmacy(id);
    standardResponse(res, 200, 'Pharmacy deleted successfully');
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== GET MEDICATIONS ====================
router.get('/medications', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const query = medicationFilterSchema.parse(req.query);
    const { medications, pagination } = await adminMedicationsService.getMedications(query);
    standardResponse(res, 200, 'Medications fetched successfully', { medications }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/medications/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const medication = await adminMedicationsService.getMedication(id);
    standardResponse(res, 200, 'Medication fetched successfully', { medication });
  } catch (error) {
    handleError(res, error);
  }
});

// CREATE MEDICATION
router.post(
  '/medications',
  authenticate,
  authorizeRoles('ADMIN', 'SUPER_ADMIN'),
  upload.single('image'),
  normalizeMedicationFields,
  async (req, res) => {
    try {
      const data = createMedicationSchema.parse(req.normalizedFields);

      if (req.file) {
        data.imageUrl = await handleImageUpload(req.file, supabase);
      }

      const medication = await adminMedicationsService.createMedication(data);
      return res.status(201).json({ success: true, message: 'Medication created successfully', medication });
    } catch (error) {
      handleError(res, error);
    }
  }
);

// UPDATE MEDICATION
router.patch(
  '/medications/:id',
  authenticate,
  authorizeRoles('ADMIN', 'SUPER_ADMIN'),
  upload.single('image'),
  normalizeMedicationFields,
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return standardResponse(res, 400, 'Invalid medication ID');

      const validatedData = updateMedicationSchema.parse(req.normalizedFields);

      if (req.file) {
        validatedData.imageUrl = await handleImageUpload(req.file, supabase);
      }

      const medication = await adminMedicationsService.updateMedication(id, validatedData);
      return standardResponse(res, 200, 'Medication updated successfully', { medication });
    } catch (error) {
      handleError(res, error);
    }
  }
);


// ==================== DELETE MEDICATION ====================
router.delete(
  '/medications/:id',
  authenticate,
  authorizeRoles('ADMIN', 'SUPER_ADMIN'),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return standardResponse(res, 400, 'Invalid medication ID');

      await adminMedicationsService.deleteMedication(id);

      return standardResponse(res, 200, 'Medication deleted successfully');
    } catch (error) {
      if (error.status === 404) {
        return standardResponse(res, 404, error.message);
      }
      handleError(res, error);
    }
  }
);

// ==================== PRESCRIPTIONS ====================
router.get('/prescriptions', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const query = prescriptionFilterSchema.parse(req.query);
    const { prescriptions, pagination } = await adminPrescriptionsService.getPrescriptions(query);
    standardResponse(res, 200, 'Prescriptions fetched successfully', { prescriptions }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/prescriptions/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const prescription = await adminPrescriptionsService.getPrescription(id);
    standardResponse(res, 200, 'Prescription fetched successfully', { prescription });
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== ORDERS ====================
router.get('/orders', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const query = orderFilterSchema.parse(req.query);
    const { orders, pagination } = await adminOrdersService.getOrders(query);
    standardResponse(res, 200, 'Orders fetched successfully', { orders }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/orders/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const order = await adminOrdersService.getOrder(id);
    standardResponse(res, 200, 'Order fetched successfully', { order });
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== USER MANAGEMENT ====================
router.get('/admin-users', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const query = adminUserFilterSchema.parse(req.query);
    const { users, pagination } = await adminUsersService.getAdminUsers(query);
    standardResponse(res, 200, 'Admin users fetched successfully', { users }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/admin-users/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const user = await adminUsersService.getAdminUser(id);
    standardResponse(res, 200, 'Admin user fetched successfully', { user });
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/pharmacy-users', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const query = pharmacyUserFilterSchema.parse(req.query);
    const { users, pagination } = await adminUsersService.getPharmacyUsers(query);
    standardResponse(res, 200, 'Pharmacy users fetched successfully', { users }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/pharmacy-users/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const user = await adminUsersService.getPharmacyUser(id);
    standardResponse(res, 200, 'Pharmacy user fetched successfully', { user });
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== ATC CLASSIFICATION ====================

// ANATOMICAL CLASSES
router.get('/anatomical-classes', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { items: anatomicalClasses, pagination } = await atcClassificationsService.getAnatomicalClasses(req.query);
    standardResponse(res, 200, 'Anatomical classes fetched successfully', { anatomicalClasses }, pagination);
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/anatomical-classes/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const anatomicalClass = await atcClassificationsService.getAnatomicalClass(id);
    standardResponse(res, 200, 'Anatomical class fetched successfully', { anatomicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.post('/anatomical-classes', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const data = AnatomicalClassSchema.parse(req.body);
    const anatomicalClass = await atcClassificationsService.createAnatomicalClass(data);
    standardResponse(res, 201, 'Anatomical class created successfully', { anatomicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.patch('/anatomical-classes/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const data = AnatomicalClassUpdateSchema.parse(req.body);
    const anatomicalClass = await atcClassificationsService.updateAnatomicalClass(id, data);
    standardResponse(res, 200, 'Anatomical class updated successfully', { anatomicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.delete('/anatomical-classes/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    await atcClassificationsService.deleteAnatomicalClass(id);
    standardResponse(res, 200, 'Anatomical class deleted successfully');
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/anatomical-classes/:id/children', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const children = await atcClassificationsService.getTherapeuticClassesByAnatomical(id);
    standardResponse(res, 200, 'Child classes fetched successfully', { children });
  } catch (error) { 
    handleError(res, error); 
  }
});

// THERAPEUTIC CLASSES
router.get('/therapeutic-classes', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { items: therapeuticClasses, pagination } = await atcClassificationsService.getTherapeuticClasses(req.query);
    standardResponse(res, 200, 'Therapeutic classes fetched successfully', { therapeuticClasses }, pagination);
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/therapeutic-classes/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const therapeuticClass = await atcClassificationsService.getTherapeuticClass(id);
    standardResponse(res, 200, 'Therapeutic class fetched successfully', { therapeuticClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.post('/therapeutic-classes', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const data = TherapeuticClassSchema.parse(req.body);
    const therapeuticClass = await atcClassificationsService.createTherapeuticClass(data);
    standardResponse(res, 201, 'Therapeutic class created successfully', { therapeuticClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.patch('/therapeutic-classes/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const data = TherapeuticClassUpdateSchema.parse(req.body);
    const therapeuticClass = await atcClassificationsService.updateTherapeuticClass(id, data);
    standardResponse(res, 200, 'Therapeutic class updated successfully', { therapeuticClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.delete('/therapeutic-classes/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    await atcClassificationsService.deleteTherapeuticClass(id);
    standardResponse(res, 200, 'Therapeutic class deleted successfully');
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/therapeutic-classes/:id/children', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const children = await atcClassificationsService.getPharmacologicalClassesByTherapeutic(id);
    standardResponse(res, 200, 'Child classes fetched successfully', { children });
  } catch (error) { 
    handleError(res, error); 
  }
});

// PHARMACOLOGICAL CLASSES
router.get('/pharmacological-classes', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { items: pharmacologicalClasses, pagination } = await atcClassificationsService.getPharmacologicalClasses(req.query);
    standardResponse(res, 200, 'Pharmacological classes fetched successfully', { pharmacologicalClasses }, pagination);
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/pharmacological-classes/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const pharmacologicalClass = await atcClassificationsService.getPharmacologicalClass(id);
    standardResponse(res, 200, 'Pharmacological class fetched successfully', { pharmacologicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.post('/pharmacological-classes', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const data = PharmacologicalClassSchema.parse(req.body);
    const pharmacologicalClass = await atcClassificationsService.createPharmacologicalClass(data);
    standardResponse(res, 201, 'Pharmacological class created successfully', { pharmacologicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.patch('/pharmacological-classes/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const data = PharmacologicalClassUpdateSchema.parse(req.body);
    const pharmacologicalClass = await atcClassificationsService.updatePharmacologicalClass(id, data);
    standardResponse(res, 200, 'Pharmacological class updated successfully', { pharmacologicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.delete('/pharmacological-classes/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    await atcClassificationsService.deletePharmacologicalClass(id);
    standardResponse(res, 200, 'Pharmacological class deleted successfully');
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/pharmacological-classes/:id/children', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const children = await atcClassificationsService.getChemicalClassesByPharmacological(id);
    standardResponse(res, 200, 'Child classes fetched successfully', { children });
  } catch (error) { 
    handleError(res, error); 
  }
});

// CHEMICAL CLASSES
router.get('/chemical-classes', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { items: chemicalClasses, pagination } = await atcClassificationsService.getChemicalClasses(req.query);
    standardResponse(res, 200, 'Chemical classes fetched successfully', { chemicalClasses }, pagination);
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/chemical-classes/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const chemicalClass = await atcClassificationsService.getChemicalClass(id);
    standardResponse(res, 200, 'Chemical class fetched successfully', { chemicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.post('/chemical-classes', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const data = ChemicalClassSchema.parse(req.body);
    const chemicalClass = await atcClassificationsService.createChemicalClass(data);
    standardResponse(res, 201, 'Chemical class created successfully', { chemicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.patch('/chemical-classes/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const data = ChemicalClassUpdateSchema.parse(req.body);
    const chemicalClass = await atcClassificationsService.updateChemicalClass(id, data);
    standardResponse(res, 200, 'Chemical class updated successfully', { chemicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.delete('/chemical-classes/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    await atcClassificationsService.deleteChemicalClass(id);
    standardResponse(res, 200, 'Chemical class deleted successfully');
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/chemical-classes/:id/children', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const children = await atcClassificationsService.getChemicalSubstancesByChemical(id);
    standardResponse(res, 200, 'Child substances fetched successfully', { children });
  } catch (error) { 
    handleError(res, error); 
  }
});

// CHEMICAL SUBSTANCES
router.get('/chemical-substances', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { items: chemicalSubstances, pagination } = await atcClassificationsService.getChemicalSubstances(req.query);
    standardResponse(res, 200, 'Chemical substances fetched successfully', { chemicalSubstances }, pagination);
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/chemical-substances/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const chemicalSubstance = await atcClassificationsService.getChemicalSubstance(id);
    standardResponse(res, 200, 'Chemical substance fetched successfully', { chemicalSubstance });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.post('/chemical-substances', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const data = ChemicalSubstanceSchema.parse(req.body);
    const chemicalSubstance = await atcClassificationsService.createChemicalSubstance(data);
    standardResponse(res, 201, 'Chemical substance created successfully', { chemicalSubstance });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.patch('/chemical-substances/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const data = ChemicalSubstanceUpdateSchema.parse(req.body);
    const chemicalSubstance = await atcClassificationsService.updateChemicalSubstance(id, data);
    standardResponse(res, 200, 'Chemical substance updated successfully', { chemicalSubstance });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.delete('/chemical-substances/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    await atcClassificationsService.deleteChemicalSubstance(id);
    standardResponse(res, 200, 'Chemical substance deleted successfully');
  } catch (error) { 
    handleError(res, error); 
  }
});

// ==================== GENERIC NAMES ====================
router.get('/generic-names', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { genericNames, pagination } = await genericNamesService.getGenericNames(req.query);
    standardResponse(res, 200, 'Generic names fetched successfully', { genericNames }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/generic-names/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const genericName = await genericNamesService.getGenericName(id);
    standardResponse(res, 200, 'Generic name fetched successfully', { genericName });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/generic-names', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const data = GenericNameSchema.parse(req.body);
    const genericName = await genericNamesService.createGenericName(data);
    standardResponse(res, 201, 'Generic name created successfully', { genericName });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch('/generic-names/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const data = GenericNameUpdateSchema.parse(req.body);
    const genericName = await genericNamesService.updateGenericName(id, data);
    standardResponse(res, 200, 'Generic name updated successfully', { genericName });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete('/generic-names/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    await genericNamesService.deleteGenericName(id);
    standardResponse(res, 200, 'Generic name deleted successfully');
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== ACTIVE SUBSTANCES ====================
router.get('/active-substances', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { activeSubstances, pagination } = await activeSubstancesService.getActiveSubstances(req.query);
    standardResponse(res, 200, 'Active substances fetched successfully', { activeSubstances }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/active-substances/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const activeSubstance = await activeSubstancesService.getActiveSubstance(id);
    standardResponse(res, 200, 'Active substance fetched successfully', { activeSubstance });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/active-substances', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const data = ActiveSubstanceSchema.parse(req.body);
    const activeSubstance = await activeSubstancesService.createActiveSubstance(data);
    standardResponse(res, 201, 'Active substance created successfully', { activeSubstance });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch('/active-substances/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const data = ActiveSubstanceUpdateSchema.parse(req.body);
    const activeSubstance = await activeSubstancesService.updateActiveSubstance(id, data);
    standardResponse(res, 200, 'Active substance updated successfully', { activeSubstance });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete('/active-substances/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    await activeSubstancesService.deleteActiveSubstance(id);
    standardResponse(res, 200, 'Active substance deleted successfully');
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== MEDICATION INGREDIENTS ====================
router.get('/medication-ingredients', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { medicationIngredients, pagination } = await medicationIngredientsService.getMedicationIngredients(req.query);
    standardResponse(res, 200, 'Medication ingredients fetched successfully', { medicationIngredients }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/medication-ingredients/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const medicationIngredient = await medicationIngredientsService.getMedicationIngredient(id);
    standardResponse(res, 200, 'Medication ingredient fetched successfully', { medicationIngredient });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/medication-ingredients', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const data = MedicationIngredientSchema.parse(req.body);
    const medicationIngredient = await medicationIngredientsService.createMedicationIngredient(data);
    standardResponse(res, 201, 'Medication ingredient created successfully', { medicationIngredient });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch('/medication-ingredients/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const data = MedicationIngredientUpdateSchema.parse(req.body);
    const medicationIngredient = await medicationIngredientsService.updateMedicationIngredient(id, data);
    standardResponse(res, 200, 'Medication ingredient updated successfully', { medicationIngredient });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete('/medication-ingredients/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    await medicationIngredientsService.deleteMedicationIngredient(id);
    standardResponse(res, 200, 'Medication ingredient deleted successfully');
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== MANUFACTURERS ====================
router.get('/manufacturers', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { manufacturers, pagination } = await manufacturersService.getManufacturers(req.query);
    standardResponse(res, 200, 'Manufacturers fetched successfully', { manufacturers }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/manufacturers/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const manufacturer = await manufacturersService.getManufacturer(id);
    standardResponse(res, 200, 'Manufacturer fetched successfully', { manufacturer });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/manufacturers', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const data = manufacturerSchema.parse(req.body);
    const manufacturer = await manufacturersService.createManufacturer(data);
    standardResponse(res, 201, 'Manufacturer created successfully', { manufacturer });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch('/manufacturers/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const data = manufacturerSchema.parse(req.body);
    const manufacturer = await manufacturersService.updateManufacturer(id, data);
    standardResponse(res, 200, 'Manufacturer updated successfully', { manufacturer });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete('/manufacturers/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    await manufacturersService.deleteManufacturer(id);
    standardResponse(res, 200, 'Manufacturer deleted successfully');
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== INDICATIONS ====================
router.get('/indications', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { indications, pagination } = await indicationsService.getIndications(req.query);
    standardResponse(res, 200, 'Indications fetched successfully', { indications }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/indications/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const indication = await indicationsService.getIndication(id);
    standardResponse(res, 200, 'Indication fetched successfully', { indication });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/indications', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const data = indicationSchema.parse(req.body);
    const indication = await indicationsService.createIndication(data);
    standardResponse(res, 201, 'Indication created successfully', { indication });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch('/indications/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const data = indicationSchema.parse(req.body);
    const indication = await indicationsService.updateIndication(id, data);
    standardResponse(res, 200, 'Indication updated successfully', { indication });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete('/indications/:id', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    await indicationsService.deleteIndication(id);
    standardResponse(res, 200, 'Indication deleted successfully');
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== AUDIT LOG ROUTES ====================

router.get('/audit-logs', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const {
      entityType,
      entityId,
      action,
      userId,
      startDate,
      endDate,
      limit = 100,
      offset = 0
    } = req.query;

    const logs = await queryAuditLogs({
      entityType,
      entityId: entityId ? parseInt(entityId) : null,
      action,
      userId: userId ? parseInt(userId) : null,
      startDate,
      endDate,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    standardResponse(res, 200, 'Audit logs fetched successfully', { logs, count: logs.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/audit-logs/:entityType/:entityId', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const trail = await getAuditTrail(entityType, parseInt(entityId));
    standardResponse(res, 200, 'Audit trail fetched successfully', { trail, count: trail.length });
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== SEARCH FILTER ROUTES ====================

router.get('/search/active-substances', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { search, limit = 20 } = req.query;
    const result = await activeSubstancesService.searchActiveSubstances({ search, limit: parseInt(limit) });
    standardResponse(res, 200, 'Active substances fetched successfully', { result });
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/search/medication-ingredients', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { search, limit = 20 } = req.query;
    const result = await medicationIngredientsService.searchMedicationIngredients({ search, limit: parseInt(limit) });
    standardResponse(res, 200, 'Medication ingredients fetched successfully', { result });
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/search/manufacturers', authenticate, authorizeRoles('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { search, limit = 20 } = req.query;
    const result = await manufacturersService.searchManufacturers({ search, limit: parseInt(limit) });
    standardResponse(res, 200, 'Manufacturers fetched successfully', { result });
  } catch (error) {
    handleError(res, error);
  }
});

/**
 * Trigger manual reconciliation
 */
router.post(
  '/reconciliation/trigger',
  authenticate,
  authorizeRoles('ADMIN', 'SUPER_ADMIN'),
  async (req, res) => {
    try {
      const { startDate, endDate } = req.body;
      
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: 'startDate and endDate are required (YYYY-MM-DD format)'
        });
      }
      
      const report = await reconciliationService.reconcile(
        startDate,
        endDate,
        `ADMIN_${req.user.id}`
      );
      
      res.json({
        success: true,
        message: 'Reconciliation completed',
        data: report
      });
      
    } catch (error) {
      console.error('Reconciliation error:', error);
      res.status(500).json({
        success: false,
        message: 'Reconciliation failed',
        error: error.message
      });
    }
  }
);

/**
 * Get reconciliation report by ID
 */
router.get(
  '/reconciliation/:id',
  authenticate,
  authorizeRoles('ADMIN', 'SUPER_ADMIN'),
  async (req, res) => {
    try {
      const reportId = parseInt(req.params.id);
      
      const report = await reconciliationService.getReport(reportId);
      
      if (!report) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }
      
      res.json({
        success: true,
        data: report
      });
      
    } catch (error) {
      console.error('Get report error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch report',
        error: error.message
      });
    }
  }
);

/**
 * Get recent reconciliation reports
 */
router.get(
  '/reconciliation',
  authenticate,
  authorizeRoles('ADMIN', 'SUPER_ADMIN'),
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 30;
      
      const reports = await reconciliationService.getRecentReports(limit);
      
      res.json({
        success: true,
        data: reports,
        count: reports.length
      });
      
    } catch (error) {
      console.error('Get reports error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch reports',
        error: error.message
      });
    }
  }
);

module.exports = router;