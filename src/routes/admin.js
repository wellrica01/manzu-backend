const express = require('express');
const supabase = require('../utils/supabaseClient')
const upload = require('../utils/upload')
const z = require('zod');
const adminService = require('../services/adminService');
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
const { authenticate, authenticateAdmin } = require('../middleware/auth');
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
router.get('/dashboard', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const summary = await adminService.getDashboardOverview();
    standardResponse(res, 200, 'Dashboard data fetched successfully', { summary });
  } catch (error) {
    console.error('Fetch dashboard error:', { message: error.message });
    standardResponse(res, 500, 'Server error', null);
  }
});

// ==================== PHARMACIES ====================
router.get('/pharmacies', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const query = {
      ...paginationSchema.parse(req.query),
      status: req.query.status,
      state: req.query.state,
      name: req.query.name,
    };
    const { pharmacies, pagination } = await adminService.getPharmacies(query);
    standardResponse(res, 200, 'Pharmacies fetched successfully', { pharmacies }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/pharmacies/simple', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const simplePharmacies = await adminService.getSimplePharmacies();
    standardResponse(res, 200, 'Pharmacies fetched successfully', { simplePharmacies });
  } catch (error) {
    console.error('Fetch pharmacies error:', { message: error.message });
    standardResponse(res, 500, 'Server error');
  }
});

router.get('/pharmacies/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const pharmacy = await adminService.getPharmacy(id);
    standardResponse(res, 200, 'Pharmacy fetched successfully', { pharmacy });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch('/pharmacies/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const data = { 
      ...editPharmacySchema.parse(req.body), 
      status: req.body.status?.toUpperCase() 
    };
    const pharmacy = await adminService.updatePharmacy(id, data);
    standardResponse(res, 200, 'Pharmacy updated successfully', { pharmacy });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete('/pharmacies/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    await adminService.deletePharmacy(id);
    standardResponse(res, 200, 'Pharmacy deleted successfully');
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== MEDICATIONS ====================
router.get('/medications', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const query = medicationFilterSchema.parse(req.query);
    const { medications, pagination } = await adminService.getMedications(query);
    standardResponse(res, 200, 'Medications fetched successfully', { medications }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/medications/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const medication = await adminService.getMedication(id);
    standardResponse(res, 200, 'Medication fetched successfully', { medication });
  } catch (error) {
    handleError(res, error);
  }
});

// Fixed POST route for creating medications
router.post(
  '/medications',
  authenticate,
  authenticateAdmin,
  upload.single('image'),
  async (req, res) => {
    try {
      const formFields = { ...req.body };
      const image = req.file;

      // Convert numeric fields (FormData values are strings)
      formFields.manufacturerId = formFields.manufacturerId && formFields.manufacturerId !== '' 
        ? parseInt(formFields.manufacturerId, 10) 
        : undefined;
      
      formFields.packSizeQuantity = formFields.packSizeQuantity && formFields.packSizeQuantity !== ''
        ? parseInt(formFields.packSizeQuantity, 10) 
        : undefined;

      // Convert boolean fields (FormData booleans come as strings)
      formFields.prescriptionRequired = formFields.prescriptionRequired === 'true';

      // Parse ingredients JSON string into array
      if (!formFields.ingredients || formFields.ingredients === '') {
        formFields.ingredients = [];
      } else {
        try {
          formFields.ingredients = JSON.parse(formFields.ingredients);
        } catch (e) {
          return res.status(400).json({
            success: false,
            message: 'Invalid ingredients JSON',
          });
        }
      }

      // Image validation
      if (image) {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        const maxSize = 5 * 1024 * 1024; // 5MB

        if (!allowedTypes.includes(image.mimetype)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid file type. Only JPEG, PNG, WebP allowed.',
          });
        }

        if (image.size > maxSize) {
          return res.status(400).json({
            success: false,
            message: 'File too large. Max 5MB.',
          });
        }
      }

      // Validate all fields with Zod
      const data = createMedicationSchema.parse(formFields);

      // Upload image to Supabase if exists
      if (image) {
        const fileName = `medications/${Date.now()}-${image.originalname}`;
        const { error: uploadError } = await supabase.storage
          .from('medications')
          .upload(fileName, image.buffer, { contentType: image.mimetype });

        if (uploadError) throw new Error('Image upload failed: ' + uploadError.message);

        const { data: publicUrlData } = supabase.storage
          .from('medications')
          .getPublicUrl(fileName);

        data.imageUrl = publicUrlData.publicUrl;
      }

      console.log('Data being sent to service:', JSON.stringify(data, null, 2));
      console.log('Data keys:', Object.keys(data));

      // Create medication
      const medication = await adminService.createMedication(data);

      return res.status(201).json({
        success: true,
        message: 'Medication created successfully',
        medication,
      });

    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.errors,
        });
      }

      console.error('Error creating medication:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }
);

// Fixed PATCH route for updating medications
router.patch(
  '/medications/:id',
  authenticate,
  authenticateAdmin,
  upload.single('image'),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return standardResponse(res, 400, 'Invalid medication ID');

      const { body: formFields, file } = req;

      const data = {
        ...formFields,
        manufacturerId: formFields.manufacturerId && formFields.manufacturerId !== ''
          ? parseInt(formFields.manufacturerId, 10) 
          : undefined,
        packSizeQuantity: formFields.packSizeQuantity && formFields.packSizeQuantity !== ''
          ? parseInt(formFields.packSizeQuantity, 10) 
          : undefined,
        prescriptionRequired: formFields.prescriptionRequired === 'true' || formFields.prescriptionRequired === true,
      };

      // Handle ingredients
      if (formFields.ingredients && formFields.ingredients !== '') {
        try {
          data.ingredients = JSON.parse(formFields.ingredients);
        } catch (e) {
          return res.status(400).json({
            success: false,
            message: 'Invalid ingredients JSON',
          });
        }
      }

      // Validate with Zod
      const validatedData = updateMedicationSchema.parse(data);

      // Handle image update
      if (file) {
        const fileName = `medications/${Date.now()}-${file.originalname}`;
        const { error: uploadError } = await supabase.storage
          .from('medications')
          .upload(fileName, file.buffer, { contentType: file.mimetype });

        if (uploadError) throw new Error('Image upload failed: ' + uploadError.message);

        const { data: publicUrlData } = supabase.storage
          .from('medications')
          .getPublicUrl(fileName);

        validatedData.imageUrl = publicUrlData.publicUrl;
      }

      const medication = await adminService.updateMedication(id, validatedData);

      return standardResponse(res, 200, 'Medication updated successfully', { medication });
    } catch (error) {
      handleError(res, error);
    }
  }
);

// ==================== PRESCRIPTIONS ====================
router.get('/prescriptions', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const query = prescriptionFilterSchema.parse(req.query);
    const { prescriptions, pagination } = await adminService.getPrescriptions(query);
    standardResponse(res, 200, 'Prescriptions fetched successfully', { prescriptions }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/prescriptions/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const prescription = await adminService.getPrescription(id);
    standardResponse(res, 200, 'Prescription fetched successfully', { prescription });
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== ORDERS ====================
router.get('/orders', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const query = orderFilterSchema.parse(req.query);
    const { orders, pagination } = await adminService.getOrders(query);
    standardResponse(res, 200, 'Orders fetched successfully', { orders }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/orders/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const order = await adminService.getOrder(id);
    standardResponse(res, 200, 'Order fetched successfully', { order });
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== USER MANAGEMENT ====================
router.get('/admin-users', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const query = adminUserFilterSchema.parse(req.query);
    const { users, pagination } = await adminService.getAdminUsers(query);
    standardResponse(res, 200, 'Admin users fetched successfully', { users }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/admin-users/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const user = await adminService.getAdminUser(id);
    standardResponse(res, 200, 'Admin user fetched successfully', { user });
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/pharmacy-users', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const query = pharmacyUserFilterSchema.parse(req.query);
    const { users, pagination } = await adminService.getPharmacyUsers(query);
    standardResponse(res, 200, 'Pharmacy users fetched successfully', { users }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/pharmacy-users/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const user = await adminService.getPharmacyUser(id);
    standardResponse(res, 200, 'Pharmacy user fetched successfully', { user });
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== ATC CLASSIFICATION ====================

// ANATOMICAL CLASSES
router.get('/anatomical-classes', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { anatomicalClasses, pagination } = await adminService.getAnatomicalClasses(req.query);
    standardResponse(res, 200, 'Anatomical classes fetched successfully', { anatomicalClasses }, pagination);
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/anatomical-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const anatomicalClass = await adminService.getAnatomicalClass(id);
    standardResponse(res, 200, 'Anatomical class fetched successfully', { anatomicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.post('/anatomical-classes', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = AnatomicalClassSchema.parse(req.body);
    const anatomicalClass = await adminService.createAnatomicalClass(data);
    standardResponse(res, 201, 'Anatomical class created successfully', { anatomicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.patch('/anatomical-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const data = AnatomicalClassUpdateSchema.parse(req.body);
    const anatomicalClass = await adminService.updateAnatomicalClass(id, data);
    standardResponse(res, 200, 'Anatomical class updated successfully', { anatomicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.delete('/anatomical-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    await adminService.deleteAnatomicalClass(id);
    standardResponse(res, 200, 'Anatomical class deleted successfully');
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/anatomical-classes/:id/children', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const children = await adminService.getTherapeuticClassesByAnatomical(id);
    standardResponse(res, 200, 'Child classes fetched successfully', { children });
  } catch (error) { 
    handleError(res, error); 
  }
});

// THERAPEUTIC CLASSES
router.get('/therapeutic-classes', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { therapeuticClasses, pagination } = await adminService.getTherapeuticClasses(req.query);
    standardResponse(res, 200, 'Therapeutic classes fetched successfully', { therapeuticClasses }, pagination);
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/therapeutic-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const therapeuticClass = await adminService.getTherapeuticClass(id);
    standardResponse(res, 200, 'Therapeutic class fetched successfully', { therapeuticClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.post('/therapeutic-classes', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = TherapeuticClassSchema.parse(req.body);
    const therapeuticClass = await adminService.createTherapeuticClass(data);
    standardResponse(res, 201, 'Therapeutic class created successfully', { therapeuticClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.patch('/therapeutic-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const data = TherapeuticClassUpdateSchema.parse(req.body);
    const therapeuticClass = await adminService.updateTherapeuticClass(id, data);
    standardResponse(res, 200, 'Therapeutic class updated successfully', { therapeuticClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.delete('/therapeutic-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    await adminService.deleteTherapeuticClass(id);
    standardResponse(res, 200, 'Therapeutic class deleted successfully');
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/therapeutic-classes/:id/children', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const children = await adminService.getPharmacologicalClassesByTherapeutic(id);
    standardResponse(res, 200, 'Child classes fetched successfully', { children });
  } catch (error) { 
    handleError(res, error); 
  }
});

// PHARMACOLOGICAL CLASSES
router.get('/pharmacological-classes', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { pharmacologicalClasses, pagination } = await adminService.getPharmacologicalClasses(req.query);
    standardResponse(res, 200, 'Pharmacological classes fetched successfully', { pharmacologicalClasses }, pagination);
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/pharmacological-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const pharmacologicalClass = await adminService.getPharmacologicalClass(id);
    standardResponse(res, 200, 'Pharmacological class fetched successfully', { pharmacologicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.post('/pharmacological-classes', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = PharmacologicalClassSchema.parse(req.body);
    const pharmacologicalClass = await adminService.createPharmacologicalClass(data);
    standardResponse(res, 201, 'Pharmacological class created successfully', { pharmacologicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.patch('/pharmacological-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const data = PharmacologicalClassUpdateSchema.parse(req.body);
    const pharmacologicalClass = await adminService.updatePharmacologicalClass(id, data);
    standardResponse(res, 200, 'Pharmacological class updated successfully', { pharmacologicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.delete('/pharmacological-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    await adminService.deletePharmacologicalClass(id);
    standardResponse(res, 200, 'Pharmacological class deleted successfully');
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/pharmacological-classes/:id/children', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const children = await adminService.getChemicalClassesByPharmacological(id);
    standardResponse(res, 200, 'Child classes fetched successfully', { children });
  } catch (error) { 
    handleError(res, error); 
  }
});

// CHEMICAL CLASSES
router.get('/chemical-classes', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { chemicalClasses, pagination } = await adminService.getChemicalClasses(req.query);
    standardResponse(res, 200, 'Chemical classes fetched successfully', { chemicalClasses }, pagination);
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/chemical-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const chemicalClass = await adminService.getChemicalClass(id);
    standardResponse(res, 200, 'Chemical class fetched successfully', { chemicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.post('/chemical-classes', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = ChemicalClassSchema.parse(req.body);
    const chemicalClass = await adminService.createChemicalClass(data);
    standardResponse(res, 201, 'Chemical class created successfully', { chemicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.patch('/chemical-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const data = ChemicalClassUpdateSchema.parse(req.body);
    const chemicalClass = await adminService.updateChemicalClass(id, data);
    standardResponse(res, 200, 'Chemical class updated successfully', { chemicalClass });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.delete('/chemical-classes/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    await adminService.deleteChemicalClass(id);
    standardResponse(res, 200, 'Chemical class deleted successfully');
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/chemical-classes/:id/children', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const children = await adminService.getChemicalSubstancesByChemical(id);
    standardResponse(res, 200, 'Child substances fetched successfully', { children });
  } catch (error) { 
    handleError(res, error); 
  }
});

// CHEMICAL SUBSTANCES
router.get('/chemical-substances', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { chemicalSubstances, pagination } = await adminService.getChemicalSubstances(req.query);
    standardResponse(res, 200, 'Chemical substances fetched successfully', { chemicalSubstances }, pagination);
  } catch (error) { 
    handleError(res, error); 
  }
});

router.get('/chemical-substances/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const chemicalSubstance = await adminService.getChemicalSubstance(id);
    standardResponse(res, 200, 'Chemical substance fetched successfully', { chemicalSubstance });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.post('/chemical-substances', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = ChemicalSubstanceSchema.parse(req.body);
    const chemicalSubstance = await adminService.createChemicalSubstance(data);
    standardResponse(res, 201, 'Chemical substance created successfully', { chemicalSubstance });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.patch('/chemical-substances/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    const data = ChemicalSubstanceUpdateSchema.parse(req.body);
    const chemicalSubstance = await adminService.updateChemicalSubstance(id, data);
    standardResponse(res, 200, 'Chemical substance updated successfully', { chemicalSubstance });
  } catch (error) { 
    handleError(res, error); 
  }
});

router.delete('/chemical-substances/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res); 
  if (!id) return;
  
  try {
    await adminService.deleteChemicalSubstance(id);
    standardResponse(res, 200, 'Chemical substance deleted successfully');
  } catch (error) { 
    handleError(res, error); 
  }
});

// ==================== GENERIC NAMES ====================
router.get('/generic-names', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { genericNames, pagination } = await adminService.getGenericNames(req.query);
    standardResponse(res, 200, 'Generic names fetched successfully', { genericNames }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/generic-names/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const genericName = await adminService.getGenericName(id);
    standardResponse(res, 200, 'Generic name fetched successfully', { genericName });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/generic-names', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = GenericNameSchema.parse(req.body);
    const genericName = await adminService.createGenericName(data);
    standardResponse(res, 201, 'Generic name created successfully', { genericName });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch('/generic-names/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const data = GenericNameUpdateSchema.parse(req.body);
    const genericName = await adminService.updateGenericName(id, data);
    standardResponse(res, 200, 'Generic name updated successfully', { genericName });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete('/generic-names/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    await adminService.deleteGenericName(id);
    standardResponse(res, 200, 'Generic name deleted successfully');
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== ACTIVE SUBSTANCES ====================
router.get('/active-substances', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { activeSubstances, pagination } = await adminService.getActiveSubstances(req.query);
    standardResponse(res, 200, 'Active substances fetched successfully', { activeSubstances }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/active-substances/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const activeSubstance = await adminService.getActiveSubstance(id);
    standardResponse(res, 200, 'Active substance fetched successfully', { activeSubstance });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/active-substances', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = ActiveSubstanceSchema.parse(req.body);
    const activeSubstance = await adminService.createActiveSubstance(data);
    standardResponse(res, 201, 'Active substance created successfully', { activeSubstance });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch('/active-substances/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const data = ActiveSubstanceUpdateSchema.parse(req.body);
    const activeSubstance = await adminService.updateActiveSubstance(id, data);
    standardResponse(res, 200, 'Active substance updated successfully', { activeSubstance });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete('/active-substances/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    await adminService.deleteActiveSubstance(id);
    standardResponse(res, 200, 'Active substance deleted successfully');
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== MEDICATION INGREDIENTS ====================
router.get('/medication-ingredients', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { medicationIngredients, pagination } = await adminService.getMedicationIngredients(req.query);
    standardResponse(res, 200, 'Medication ingredients fetched successfully', { medicationIngredients }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/medication-ingredients/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const medicationIngredient = await adminService.getMedicationIngredient(id);
    standardResponse(res, 200, 'Medication ingredient fetched successfully', { medicationIngredient });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/medication-ingredients', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = MedicationIngredientSchema.parse(req.body);
    const medicationIngredient = await adminService.createMedicationIngredient(data);
    standardResponse(res, 201, 'Medication ingredient created successfully', { medicationIngredient });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch('/medication-ingredients/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const data = MedicationIngredientUpdateSchema.parse(req.body);
    const medicationIngredient = await adminService.updateMedicationIngredient(id, data);
    standardResponse(res, 200, 'Medication ingredient updated successfully', { medicationIngredient });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete('/medication-ingredients/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    await adminService.deleteMedicationIngredient(id);
    standardResponse(res, 200, 'Medication ingredient deleted successfully');
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== MANUFACTURERS ====================
router.get('/manufacturers', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { manufacturers, pagination } = await adminService.getManufacturers(req.query);
    standardResponse(res, 200, 'Manufacturers fetched successfully', { manufacturers }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/manufacturers/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const manufacturer = await adminService.getManufacturer(id);
    standardResponse(res, 200, 'Manufacturer fetched successfully', { manufacturer });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/manufacturers', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = manufacturerSchema.parse(req.body);
    const manufacturer = await adminService.createManufacturer(data);
    standardResponse(res, 201, 'Manufacturer created successfully', { manufacturer });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch('/manufacturers/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const data = manufacturerSchema.parse(req.body);
    const manufacturer = await adminService.updateManufacturer(id, data);
    standardResponse(res, 200, 'Manufacturer updated successfully', { manufacturer });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete('/manufacturers/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    await adminService.deleteManufacturer(id);
    standardResponse(res, 200, 'Manufacturer deleted successfully');
  } catch (error) {
    handleError(res, error);
  }
});

// ==================== INDICATIONS ====================
router.get('/indications', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const { indications, pagination } = await adminService.getIndications(req.query);
    standardResponse(res, 200, 'Indications fetched successfully', { indications }, pagination);
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/indications/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const indication = await adminService.getIndication(id);
    standardResponse(res, 200, 'Indication fetched successfully', { indication });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/indications', authenticate, authenticateAdmin, async (req, res) => {
  try {
    const data = indicationSchema.parse(req.body);
    const indication = await adminService.createIndication(data);
    standardResponse(res, 201, 'Indication created successfully', { indication });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch('/indications/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    const data = indicationSchema.parse(req.body);
    const indication = await adminService.updateIndication(id, data);
    standardResponse(res, 200, 'Indication updated successfully', { indication });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete('/indications/:id', authenticate, authenticateAdmin, async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  try {
    await adminService.deleteIndication(id);
    standardResponse(res, 200, 'Indication deleted successfully');
  } catch (error) {
    handleError(res, error);
  }
});

module.exports = router;