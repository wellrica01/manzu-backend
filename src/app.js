const express = require('express');
     const dotenv = require('dotenv');
     const userRoutes = require('./routes/user');
     const prescriptionRoutes = require('./routes/prescription');
     dotenv.config();
     const app = express();
     const cors = require('cors');

     app.use(cors());
     app.use(express.json());
     app.use('/api', userRoutes);
     app.use('/api/prescription', prescriptionRoutes);
     app.use('/uploads', express.static('uploads'));
    

     const PORT = process.env.PORT || 5000;
     
     
     app.listen(PORT, () => {
       console.log(`Server running on port ${PORT}`);
     });