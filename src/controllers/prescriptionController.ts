import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import mongoose from 'mongoose';
import { Prescription } from '../models';
import Clinic from '../models/Clinic';
import { AuthRequest } from '../types/express';
import { getRoleBasedFilter, getTenantScopedFilter, addTenantToData } from '../middleware/auth';
import { sendNotification } from '../utils/notificationService';

export class PrescriptionController {
  static async createPrescription(req: AuthRequest, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
        return;
      }

      // Convert clinic_id to ObjectId once
      const clinicId = new mongoose.Types.ObjectId(req.clinic_id!);

      // Generate prescription ID if not provided
      // Include tenant_id and clinic_id in the count to ensure uniqueness per tenant+clinic
      if (!req.body.prescription_id) {
        const tenantFilter = getTenantScopedFilter(req, { clinic_id: clinicId });
        
        // Get the maximum prescription_id number for this tenant+clinic
        const maxPrescription = await Prescription.findOne(tenantFilter)
          .sort({ prescription_id: -1 })
          .select('prescription_id');
        
        let nextNumber = 1;
        if (maxPrescription && maxPrescription.prescription_id) {
          // Extract number from prescription_id (e.g., "RX-001" -> 1)
          const match = maxPrescription.prescription_id.match(/RX-(\d+)/);
          if (match) {
            nextNumber = parseInt(match[1], 10) + 1;
          }
        }
        
        let prescriptionId = `RX-${String(nextNumber).padStart(3, '0')}`;
        
        // Check if prescription_id already exists within this tenant+clinic (handle race conditions)
        let existingPrescription = await Prescription.findOne({
          ...tenantFilter,
          prescription_id: prescriptionId
        });
        
        let attempts = 0;
        while (existingPrescription && attempts < 20) {
          nextNumber++;
          prescriptionId = `RX-${String(nextNumber).padStart(3, '0')}`;
          existingPrescription = await Prescription.findOne({
            ...tenantFilter,
            prescription_id: prescriptionId
          });
          attempts++;
        }
        
        if (existingPrescription) {
          // If still exists after 20 attempts, use timestamp-based ID
          const timestamp = Date.now().toString().slice(-6);
          prescriptionId = `RX-${timestamp}`;
        }
        
        req.body.prescription_id = prescriptionId;
      }

      // Add tenant_id to prescription data with validation
      const prescriptionData = addTenantToData(req, {
        ...req.body,
        clinic_id: clinicId
      });

      // Try to save, with retry logic for duplicate key errors
      let prescription: any;
      let saveAttempts = 0;
      const maxSaveAttempts = 5;
      
      while (saveAttempts < maxSaveAttempts) {
        try {
          prescription = new Prescription(prescriptionData);
          await prescription.save();
          break; // Success, exit loop
        } catch (saveError: any) {
          // If duplicate key error and we haven't exceeded max attempts, regenerate ID
          if ((saveError.code === 11000 || saveError.name === 'MongoServerError') && 
              saveError.keyPattern && (saveError.keyPattern.prescription_id || 
              (saveError.keyPattern.tenant_id && saveError.keyPattern.clinic_id && saveError.keyPattern.prescription_id)) && 
              saveAttempts < maxSaveAttempts - 1) {
            saveAttempts++;
            // Regenerate prescription_id with timestamp to ensure uniqueness
            const timestamp = Date.now().toString().slice(-6);
            const randomSuffix = Math.floor(Math.random() * 100).toString().padStart(2, '0');
            prescriptionData.prescription_id = `RX-${timestamp}${randomSuffix}`;
            continue;
          }
          // Re-throw if not a duplicate key error or max attempts reached
          throw saveError;
        }
      }

      if (!prescription) {
        throw new Error('Failed to create prescription after multiple attempts');
      }

      // Populate patient and doctor information
      await prescription.populate([
        { path: 'patient_id', select: 'first_name last_name date_of_birth gender phone' },
        { path: 'doctor_id', select: 'first_name last_name' },
        { path: 'appointment_id', select: 'appointment_date' }
      ]);

      const clinicId = String(req.clinic_id);
      const patient: any = prescription.patient_id;
      const doctor: any = prescription.doctor_id;
      const phone = patient?.phone;
      if (phone && clinicId) {
        const clinic = await Clinic.findById(req.clinic_id).select('name').lean();
        sendNotification('new_prescription', clinicId, {
          recipientPhone: phone,
          payload: {
            patient_name: patient ? `${patient.first_name || ''} ${patient.last_name || ''}`.trim() : '',
            patient_phone: phone,
            doctor_name: doctor ? `${doctor.first_name || ''} ${doctor.last_name || ''}`.trim() : '',
            clinic_name: clinic?.name || '',
          },
          lang: 'ar',
        }).catch((err) => console.error('[notification] new_prescription:', err));
      }

      res.status(201).json({
        success: true,
        message: 'Prescription created successfully',
        data: { prescription }
      });
    } catch (error: any) {
      console.error('Create prescription error:', error);
      
      // Log detailed error information
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
        errors: error.errors,
        keyPattern: error.keyPattern,
        keyValue: error.keyValue
      });

      // Handle duplicate key error (unique index violation)
      if (error.code === 11000 || error.name === 'MongoServerError') {
        const duplicateField = error.keyPattern ? Object.keys(error.keyPattern)[0] : 'unknown';
        res.status(409).json({
          success: false,
          message: `Duplicate ${duplicateField} detected. Please try again.`,
          error: {
            name: error.name,
            message: error.message,
            duplicateField: duplicateField,
            duplicateValue: error.keyValue ? error.keyValue[duplicateField] : null
          }
        });
        return;
      }

      // Handle validation errors
      if (error.name === 'ValidationError') {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          error: {
            name: error.name,
            message: error.message,
            errors: error.errors
          }
        });
        return;
      }

      // Return detailed error in development
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: {
          name: error.name,
          message: error.message,
          details: error.errors || error.details || null,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }
      });
    }
  }

  static async getAllPrescriptions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      // Apply tenant-scoped filtering
      let filter: any = getTenantScopedFilter(req, {
        clinic_id: req.clinic_id
      });

      // Search filter
      if (req.query.search) {
        filter.$or = [
          { prescription_id: { $regex: req.query.search, $options: 'i' } },
          { diagnosis: { $regex: req.query.search, $options: 'i' } }
        ];
      }

      // Status filter
      if (req.query.status && req.query.status !== 'all') {
        filter.status = req.query.status;
      }

      // Doctor filter (from query params)
      if (req.query.doctor_id) {
        filter.doctor_id = req.query.doctor_id;
      }

      // Patient filter
      if (req.query.patient_id) {
        filter.patient_id = req.query.patient_id;
      }

      // Date range filter
      if (req.query.date_from || req.query.date_to) {
        filter.created_at = {};
        if (req.query.date_from) {
          filter.created_at.$gte = new Date(req.query.date_from as string);
        }
        if (req.query.date_to) {
          filter.created_at.$lte = new Date(req.query.date_to as string);
        }
      }

      // Apply role-based filtering
      const roleFilter = getRoleBasedFilter(req.user, 'prescription');
      
      let prescriptions: any[];
      let totalPrescriptions: number;

      if (roleFilter._requiresNursePrescriptionFilter && req.user?.role === 'nurse') {
        // For nurses, find prescriptions for patients they have appointments with (as assigned nurse)
        const nurseId = roleFilter._nurseId;
        
        // Get patient IDs from appointments where nurse is assigned
        const { Appointment } = require('../models');
        const appointmentPatients = await Appointment.distinct('patient_id', { nurse_id: nurseId });
        
        if (appointmentPatients.length === 0) {
          // Nurse has no patients assigned
          prescriptions = [];
          totalPrescriptions = 0;
        } else {
          // Add patient ID filter to existing filters
          filter.patient_id = { $in: appointmentPatients };
          
          prescriptions = await Prescription.find(filter)
            .populate([
              { path: 'patient_id', select: 'first_name last_name date_of_birth gender' },
              { path: 'doctor_id', select: 'first_name last_name' },
              { path: 'appointment_id', select: 'appointment_date' }
            ])
            .skip(skip)
            .limit(limit)
            .sort({ created_at: -1 });

          totalPrescriptions = await Prescription.countDocuments(filter);
        }
      } else {
        // Admin, doctors, and other roles
        filter = { ...filter, ...roleFilter };
        
        prescriptions = await Prescription.find(filter)
          .populate([
            { path: 'patient_id', select: 'first_name last_name date_of_birth gender' },
            { path: 'doctor_id', select: 'first_name last_name' },
            { path: 'appointment_id', select: 'appointment_date' }
          ])
          .skip(skip)
          .limit(limit)
          .sort({ created_at: -1 });

        totalPrescriptions = await Prescription.countDocuments(filter);
      }

      res.json({
        success: true,
        data: {
          prescriptions,
          pagination: {
            page,
            limit,
            total: totalPrescriptions,
            pages: Math.ceil(totalPrescriptions / limit)
          }
        }
      });
    } catch (error: any) {
      console.error('Get all prescriptions error:', error);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: {
          name: error.name,
          message: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }
      });
    }
  }

  static async getPrescriptionById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      // Apply tenant-scoped filtering
      let filter: any = getTenantScopedFilter(req, {
        _id: id,
        clinic_id: req.clinic_id
      });
      
      // Apply role-based filtering
      const roleFilter = getRoleBasedFilter(req.user, 'prescription');
      filter = { ...filter, ...roleFilter };

      const prescription = await Prescription.findOne(filter)
        .populate([
          { path: 'patient_id', select: 'first_name last_name date_of_birth gender phone email' },
          { path: 'doctor_id', select: 'first_name last_name specialization' },
          { path: 'appointment_id', select: 'appointment_date status' }
        ]);

      if (!prescription) {
        res.status(404).json({
          success: false,
          message: 'Prescription not found or access denied'
        });
        return;
      }

      res.json({
        success: true,
        data: { prescription }
      });
    } catch (error) {
      console.error('Get prescription by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  static async updatePrescription(req: AuthRequest, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
        return;
      }

      const { id } = req.params;
      
      let filter: any = { 
        _id: id, 
        clinic_id: req.clinic_id // CLINIC FILTER: Only update prescription from current clinic
      };
      
      // Apply role-based filtering
      const roleFilter = getRoleBasedFilter(req.user, 'prescription');
      filter = { ...filter, ...roleFilter };

      const prescription = await Prescription.findOneAndUpdate(
        filter,
        req.body,
        { new: true, runValidators: true }
      ).populate([
        { path: 'patient_id', select: 'first_name last_name date_of_birth gender' },
        { path: 'doctor_id', select: 'first_name last_name' },
        { path: 'appointment_id', select: 'appointment_date' }
      ]);

      if (!prescription) {
        res.status(404).json({
          success: false,
          message: 'Prescription not found or access denied'
        });
        return;
      }

      res.json({
        success: true,
        message: 'Prescription updated successfully',
        data: { prescription }
      });
    } catch (error) {
      console.error('Update prescription error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  static async deletePrescription(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      // Only admin can delete prescriptions
      if (req.user?.role !== 'admin') {
        res.status(403).json({
          success: false,
          message: 'Access denied. Only administrators can delete prescriptions.'
        });
        return;
      }

      const prescription = await Prescription.findByIdAndDelete(id);

      if (!prescription) {
        res.status(404).json({
          success: false,
          message: 'Prescription not found'
        });
        return;
      }

      res.json({
        success: true,
        message: 'Prescription deleted successfully'
      });
    } catch (error) {
      console.error('Delete prescription error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  static async updatePrescriptionStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const validStatuses = ['active', 'completed', 'pending', 'cancelled', 'expired'];
      if (!validStatuses.includes(status)) {
        res.status(400).json({
          success: false,
          message: 'Invalid status'
        });
        return;
      }

      let filter: any = { _id: id };
      
      // Apply role-based filtering
      const roleFilter = getRoleBasedFilter(req.user, 'prescription');
      filter = { ...filter, ...roleFilter };

      const prescription = await Prescription.findOneAndUpdate(
        filter,
        { status },
        { new: true }
      ).populate([
        { path: 'patient_id', select: 'first_name last_name' },
        { path: 'doctor_id', select: 'first_name last_name' }
      ]);

      if (!prescription) {
        res.status(404).json({
          success: false,
          message: 'Prescription not found or access denied'
        });
        return;
      }

      res.json({
        success: true,
        message: 'Prescription status updated successfully',
        data: { prescription }
      });
    } catch (error) {
      console.error('Update prescription status error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  static async sendToPharmacy(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      let filter: any = { 
        _id: id, 
        clinic_id: req.clinic_id // CLINIC FILTER: Only access prescriptions from current clinic
      };
      
      // Apply role-based filtering
      const roleFilter = getRoleBasedFilter(req.user, 'prescription');
      filter = { ...filter, ...roleFilter };

      const prescription = await Prescription.findOneAndUpdate(
        filter,
        { 
          pharmacy_dispensed: true,
          dispensed_date: new Date(),
          status: 'active'
        },
        { new: true }
      ).populate([
        { path: 'patient_id', select: 'first_name last_name' },
        { path: 'doctor_id', select: 'first_name last_name' }
      ]);

      if (!prescription) {
        res.status(404).json({
          success: false,
          message: 'Prescription not found or access denied'
        });
        return;
      }

      res.json({
        success: true,
        message: 'Prescription sent to pharmacy successfully',
        data: { prescription }
      });
    } catch (error) {
      console.error('Send to pharmacy error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  static async getPrescriptionStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      let filter: any = {
        clinic_id: req.clinic_id // CLINIC FILTER: Only get stats from current clinic
      };

      // Apply role-based filtering
      const roleFilter = getRoleBasedFilter(req.user, 'prescription');
      filter = { ...filter, ...roleFilter };

      const totalPrescriptions = await Prescription.countDocuments(filter);
      
      // Status statistics
      const statusStats = await Prescription.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      // Monthly prescription trend
      const monthlyStats = await Prescription.aggregate([
        { $match: filter },
        {
          $group: {
            _id: {
              year: { $year: '$created_at' },
              month: { $month: '$created_at' }
            },
            count: { $sum: 1 }
          }
        },
        {
          $sort: { '_id.year': -1, '_id.month': -1 }
        },
        {
          $limit: 12
        }
      ]);

      // Top medications
      const topMedications = await Prescription.aggregate([
        { $match: filter },
        { $unwind: '$medications' },
        {
          $group: {
            _id: '$medications.name',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);

      // Top diagnoses
      const topDiagnoses = await Prescription.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$diagnosis',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);

      const activePrescriptions = statusStats.find(s => s._id === 'active')?.count || 0;
      const pendingPrescriptions = statusStats.find(s => s._id === 'pending')?.count || 0;
      const dispensedPrescriptions = await Prescription.countDocuments({ 
        ...filter, 
        pharmacy_dispensed: true 
      });

      res.json({
        success: true,
        data: {
          totalPrescriptions,
          activePrescriptions,
          pendingPrescriptions,
          dispensedPrescriptions,
          statusStats,
          monthlyStats,
          topMedications,
          topDiagnoses
        }
      });
    } catch (error) {
      console.error('Get prescription stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  static async getPrescriptionsByPatient(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { patientId } = req.params;
      
      let filter: any = { 
        patient_id: patientId, 
        clinic_id: req.clinic_id // CLINIC FILTER: Only get prescriptions from current clinic
      };
      
      // Apply role-based filtering
      const roleFilter = getRoleBasedFilter(req.user, 'prescription');
      filter = { ...filter, ...roleFilter };

      const prescriptions = await Prescription.find(filter)
        .populate([
          { path: 'doctor_id', select: 'first_name last_name' },
          { path: 'appointment_id', select: 'appointment_date' }
        ])
        .sort({ created_at: -1 });

      res.json({
        success: true,
        data: { prescriptions }
      });
    } catch (error) {
      console.error('Get prescriptions by patient error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  static async getPrescriptionsByDoctor(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { doctorId } = req.params;
      
      // Check if user can access this doctor's prescriptions
      if (req.user?.role === 'doctor' && req.user._id.toString() !== doctorId) {
        res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own prescriptions.'
        });
        return;
      }
      
      const prescriptions = await Prescription.find({ 
        doctor_id: doctorId, 
        clinic_id: req.clinic_id // CLINIC FILTER: Only get prescriptions from current clinic
      })
        .populate([
          { path: 'patient_id', select: 'first_name last_name date_of_birth' },
          { path: 'appointment_id', select: 'appointment_date' }
        ])
        .sort({ created_at: -1 });

      res.json({
        success: true,
        data: { prescriptions }
      });
    } catch (error) {
      console.error('Get prescriptions by doctor error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
} 