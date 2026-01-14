import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import AppointmentStatus from '../models/AppointmentStatus';
import { AuthRequest } from '../types/express';
import { addTenantToData } from '../middleware/auth';
import mongoose from 'mongoose';

export class AppointmentStatusController {
  // Get all appointment statuses for current tenant/clinic
  static async getStatuses(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenant_id = req.tenant_id;
      const clinic_id = req.clinic_id;

      if (!tenant_id || !clinic_id) {
        res.status(400).json({
          success: false,
          message: 'Tenant and clinic context is required'
        });
        return;
      }

      // Check if we should include inactive statuses (for settings page)
      const includeInactive = req.query.includeInactive === 'true' || req.query.all === 'true';
      
      // Build query filter
      const filter: any = {
        tenant_id,
        clinic_id
      };
      
      // Only filter by is_active if we don't want all statuses
      if (!includeInactive) {
        filter.is_active = true;
      }

      let statuses = await AppointmentStatus.find(filter)
        .sort({ order: 1, created_at: 1 })
        .lean();

      // If no statuses exist, create default ones (only for active statuses)
      if (statuses.length === 0 && !includeInactive) {
        const { createDefaultAppointmentStatuses } = require('../migrations/createDefaultAppointmentStatuses');
        await createDefaultAppointmentStatuses();
        
        // Fetch again after creating defaults
        statuses = await AppointmentStatus.find({
          tenant_id,
          clinic_id,
          is_active: true
        })
          .sort({ order: 1 })
          .lean();
      }

      res.status(200).json({
        success: true,
        data: statuses
      });
    } catch (error: any) {
      console.error('Get appointment statuses error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Get single appointment status by ID
  static async getStatusById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenant_id = req.tenant_id;
      const clinic_id = req.clinic_id;

      if (!tenant_id || !clinic_id) {
        res.status(400).json({
          success: false,
          message: 'Tenant and clinic context is required'
        });
        return;
      }

      const status = await AppointmentStatus.findOne({
        _id: id,
        tenant_id,
        clinic_id
      }).lean();

      if (!status) {
        res.status(404).json({
          success: false,
          message: 'Appointment status not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: status
      });
    } catch (error: any) {
      console.error('Get appointment status error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Create new appointment status
  static async createStatus(req: AuthRequest, res: Response): Promise<void> {
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

      const tenant_id = req.tenant_id;
      const clinic_id = req.clinic_id;

      if (!tenant_id || !clinic_id) {
        res.status(400).json({
          success: false,
          message: 'Tenant and clinic context is required'
        });
        return;
      }

      const { code, name_en, name_ar, color, icon, order, show_in_calendar, is_default, description } = req.body;

      // Check if code already exists for this tenant/clinic
      const existingStatus = await AppointmentStatus.findOne({
        tenant_id,
        clinic_id,
        code: code.toLowerCase()
      });

      if (existingStatus) {
        res.status(409).json({
          success: false,
          message: 'Status code already exists for this clinic'
        });
        return;
      }

      // If this is set as default, unset other defaults
      if (is_default) {
        await AppointmentStatus.updateMany(
          { tenant_id, clinic_id, is_default: true },
          { $set: { is_default: false } }
        );
      }

      const statusData = addTenantToData(req, {
        clinic_id,
        tenant_id,
        code: code.toLowerCase(),
        name_en,
        name_ar,
        color,
        icon: icon || 'Clock',
        order: order || 1,
        show_in_calendar: show_in_calendar ?? false,
        is_active: true,
        is_default: is_default ?? false,
        description
      });

      const status = new AppointmentStatus(statusData);
      await status.save();

      res.status(201).json({
        success: true,
        message: 'Appointment status created successfully',
        data: status
      });
    } catch (error: any) {
      console.error('Create appointment status error:', error);
      
      if (error.code === 11000) {
        res.status(409).json({
          success: false,
          message: 'Status code already exists for this clinic'
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Update appointment status
  static async updateStatus(req: AuthRequest, res: Response): Promise<void> {
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
      const tenant_id = req.tenant_id;
      const clinic_id = req.clinic_id;

      if (!tenant_id || !clinic_id) {
        res.status(400).json({
          success: false,
          message: 'Tenant and clinic context is required'
        });
        return;
      }

      const status = await AppointmentStatus.findOne({
        _id: id,
        tenant_id,
        clinic_id
      });

      if (!status) {
        res.status(404).json({
          success: false,
          message: 'Appointment status not found'
        });
        return;
      }

      const { name_en, name_ar, color, icon, order, show_in_calendar, is_default, is_active, description } = req.body;

      // If setting as default, unset other defaults
      if (is_default && !status.is_default) {
        await AppointmentStatus.updateMany(
          { tenant_id, clinic_id, is_default: true, _id: { $ne: id } },
          { $set: { is_default: false } }
        );
      }

      // Update fields
      if (name_en !== undefined) status.name_en = name_en;
      if (name_ar !== undefined) status.name_ar = name_ar;
      if (color !== undefined) status.color = color;
      if (icon !== undefined) status.icon = icon;
      if (order !== undefined) status.order = order;
      if (show_in_calendar !== undefined) status.show_in_calendar = show_in_calendar;
      if (is_default !== undefined) status.is_default = is_default;
      if (is_active !== undefined) status.is_active = is_active;
      if (description !== undefined) status.description = description;

      await status.save();

      res.status(200).json({
        success: true,
        message: 'Appointment status updated successfully',
        data: status
      });
    } catch (error: any) {
      console.error('Update appointment status error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Delete appointment status (soft delete by setting is_active to false)
  static async deleteStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenant_id = req.tenant_id;
      const clinic_id = req.clinic_id;

      if (!tenant_id || !clinic_id) {
        res.status(400).json({
          success: false,
          message: 'Tenant and clinic context is required'
        });
        return;
      }

      const status = await AppointmentStatus.findOne({
        _id: id,
        tenant_id,
        clinic_id
      });

      if (!status) {
        res.status(404).json({
          success: false,
          message: 'Appointment status not found'
        });
        return;
      }

      // Prevent deletion of default status or 'scheduled' status
      if (status.is_default || status.code === 'scheduled') {
        res.status(400).json({
          success: false,
          message: status.code === 'scheduled' 
            ? 'Cannot delete the Scheduled status as it is a required default status'
            : 'Cannot delete default status'
        });
        return;
      }

      // Soft delete
      status.is_active = false;
      await status.save();

      res.status(200).json({
        success: true,
        message: 'Appointment status deleted successfully'
      });
    } catch (error: any) {
      console.error('Delete appointment status error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Batch update (for reordering)
  static async batchUpdate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const tenant_id = req.tenant_id;
      const clinic_id = req.clinic_id;

      if (!tenant_id || !clinic_id) {
        res.status(400).json({
          success: false,
          message: 'Tenant and clinic context is required'
        });
        return;
      }

      const { updates } = req.body; // Array of { id, order } or { id, is_active }, etc.

      if (!Array.isArray(updates) || updates.length === 0) {
        res.status(400).json({
          success: false,
          message: 'Updates array is required'
        });
        return;
      }

      const bulkOps = updates.map((update: any) => ({
        updateOne: {
          filter: {
            _id: update.id,
            tenant_id,
            clinic_id
          },
          update: {
            $set: {
              ...(update.order !== undefined && { order: update.order }),
              ...(update.is_active !== undefined && { is_active: update.is_active }),
              ...(update.show_in_calendar !== undefined && { show_in_calendar: update.show_in_calendar })
            }
          }
        }
      }));

      await AppointmentStatus.bulkWrite(bulkOps);

      res.status(200).json({
        success: true,
        message: 'Statuses updated successfully'
      });
    } catch (error: any) {
      console.error('Batch update appointment statuses error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
}

