import { Response } from 'express';
import { validationResult } from 'express-validator';
import mongoose, { Types } from 'mongoose';
import { Clinic, UserClinic, User, Role, Warehouse } from '../models';
import { AuthRequest } from '../types/express';
import { getClinicScopedFilter } from '../middleware/clinicContext';
import { getTenantScopedFilter, addTenantToData, canAccessTenant } from '../middleware/auth';
import { createDefaultStatusesForClinic } from '../migrations/createDefaultAppointmentStatuses';
import { validateClinicBusinessRules, validateMainClinicDeletion, validateMainClinicStatus } from '../utils/clinicValidation';

export class ClinicController {
  
  /**
   * Get all clinics for admin management (with tenant validation)
   * GET /api/clinics/all
   */
  static async getAllClinics(req: AuthRequest, res: Response): Promise<void> {
    try {
      // Check if user is super_admin - they can see ALL clinics
      const isSuperAdmin = req.user?.role === 'super_admin';
      
      let clinics;
      
      if (isSuperAdmin) {
        // Super admins can see all clinics across all tenants
        clinics = await Clinic.find({})
          .select('name code description address contact is_active is_main_clinic parent_clinic_id tenant_id created_at updated_at')
          .sort({ name: 1 });
      } else {
        // Regular admins can only see clinics from their own tenant
        const clinicFilter = getTenantScopedFilter(req, {});
        clinics = await Clinic.find(clinicFilter)
          .select('name code description address contact is_active is_main_clinic parent_clinic_id tenant_id created_at updated_at')
          .sort({ name: 1 });
      }

      res.json({
        success: true,
        data: {
          clinics: clinics
        },
        total: clinics.length,
        message: isSuperAdmin 
          ? `Retrieved ${clinics.length} clinics across all tenants (Super Admin access)`
          : `Retrieved ${clinics.length} clinics from your organization`
      });
    } catch (error: any) {
      console.error('Error fetching all clinics:', error);
      
      // Handle tenant validation errors
      if (error.message === 'Tenant context is required for this operation') {
        res.status(400).json({
          success: false,
          message: 'Tenant information is required',
          data: { clinics: [] },
          total: 0
        });
        return;
      }
      
      res.status(500).json({
        success: false,
        message: 'Error fetching clinics',
        data: { clinics: [] },
        total: 0
      });
    }
  }

  /**
   * Get all clinics that the current user has access to
   * GET /api/clinics
   */
  static async getUserClinics(req: AuthRequest, res: Response): Promise<void> {
    try {
      // Check if user is super_admin - only they get access to ALL clinics
      const isSuperAdmin = req.user?.role === 'super_admin';
      
      if (isSuperAdmin) {
        // Return all active clinics for super_admin users
        const allClinics = await Clinic.find({ is_active: true })
          .select('name code description address contact settings is_active is_main_clinic parent_clinic_id tenant_id created_at')
          .sort({ name: 1 });

        // Format to match UserClinic structure expected by frontend
        const formattedClinics = allClinics.map(clinic => ({
          clinic_id: clinic,
          role: 'super_admin',
          hasRelationship: true,
          joined_at: clinic.created_at,
          is_active: true
        }));

        res.json({
          success: true,
          data: formattedClinics,
          total: formattedClinics.length,
          message: `Retrieved ${formattedClinics.length} clinics across all tenants (Super Admin access)`
        });
        return;
      }

      // Regular users - only return clinics they have explicit relationships with (tenant-scoped)
      const userClinicFilter = getTenantScopedFilter(req, {
        user_id: req.user?._id,
        is_active: true
      });
      
      const userClinics = await UserClinic.find(userClinicFilter).populate({
        path: 'clinic_id',
        match: { is_active: true },
        select: 'name code description address contact settings is_active is_main_clinic parent_clinic_id tenant_id created_at'
      }).sort({ joined_at: 1 });

      // Filter out clinics that are null (inactive)
      const activeClinics = userClinics.filter(uc => uc.clinic_id);

      res.json({
        success: true,
        data: activeClinics,
        total: activeClinics.length,
        message: `Retrieved ${activeClinics.length} clinics from your organization`
      });
    } catch (error: any) {
      console.error('Error fetching user clinics:', error);
      
      // Handle tenant validation errors
      if (error.message === 'Tenant context is required for this operation') {
        res.status(400).json({
          success: false,
          message: 'Tenant information is required',
          data: [],
          total: 0
        });
        return;
      }
      
      res.status(500).json({
        success: false,
        message: 'Error fetching clinics',
        data: [],
        total: 0
      });
    }
  }

  /**
   * Get current clinic details
   * GET /api/clinics/current
   */
  static async getCurrentClinic(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.clinic_id) {
        res.status(400).json({
          success: false,
          message: 'No clinic selected'
        });
        return;
      }

      const clinic = await Clinic.findById(req.clinic_id)
        .select('name code description address contact settings is_active is_main_clinic parent_clinic_id tenant_id created_at updated_at');
      
      if (!clinic) {
        res.status(404).json({
          success: false,
          message: 'Clinic not found'
        });
        return;
      }

      res.json({
        success: true,
        data: clinic
      });
    } catch (error) {
      console.error('Error fetching current clinic:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching clinic details'
      });
    }
  }

  /**
   * Create a new clinic (only Main Clinic users can create Sub Clinics)
   * POST /api/clinics
   */
  static async createClinic(req: AuthRequest, res: Response): Promise<void> {
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

      // Ensure user is authenticated (should be handled by authenticate middleware)
      if (!req.user?._id || !req.tenant_id) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      // Frontend MUST NOT send is_main_clinic or parent_clinic_id
      // Remove them if accidentally sent
      const { is_main_clinic, parent_clinic_id, ...clinicBodyData } = req.body;

      // Check if tenant already has a main clinic (check all clinics, not just active ones)
      const existingMainClinic = await Clinic.findOne({
        tenant_id: req.tenant_id,
        is_main_clinic: true
      });

      // Also check if tenant has ANY clinics at all (to determine if this is the first clinic)
      const tenantClinicsCount = await Clinic.countDocuments({
        tenant_id: req.tenant_id
      });

      // Determine clinic type based on whether main clinic exists
      let isMainClinic = false;
      let parentClinicId: Types.ObjectId | null = null;

      // If no clinics exist for this tenant, this is the first clinic = Main Clinic
      if (tenantClinicsCount === 0) {
        // First clinic in tenant becomes Main Clinic automatically
        isMainClinic = true;
        parentClinicId = null;
        console.log(`✅ First clinic for tenant ${req.tenant_id} - Setting as Main Clinic`);
      } else if (!existingMainClinic) {
        // No main clinic exists but other clinics do - this shouldn't happen normally
        // but handle it by making this the main clinic
        console.warn(`⚠️  Tenant ${req.tenant_id} has ${tenantClinicsCount} clinics but no main clinic. Setting new clinic as main.`);
        isMainClinic = true;
        parentClinicId = null;
      } else {
        // Check if user belongs to Main Clinic
        const userClinic = await UserClinic.findOne({
          user_id: req.user._id,
          clinic_id: existingMainClinic._id,
          is_active: true
        });

        if (!userClinic) {
          // User doesn't belong to Main Clinic - check if they belong to any clinic
          const userClinics = await UserClinic.find({
            user_id: req.user._id,
            is_active: true
          }).populate('clinic_id', 'is_main_clinic');

          const belongsToSubClinic = userClinics.some((uc: any) => 
            uc.clinic_id && !uc.clinic_id.is_main_clinic
          );

          if (belongsToSubClinic) {
            res.status(403).json({
              success: false,
              message: 'Sub Clinics are not allowed to create other clinics'
            });
            return;
          }

          // User doesn't belong to any clinic - allow creation (will be main clinic if none exists)
          isMainClinic = !existingMainClinic;
          parentClinicId = existingMainClinic ? existingMainClinic._id : null;
        } else {
          // User belongs to Main Clinic - create Sub Clinic
          isMainClinic = false;
          parentClinicId = existingMainClinic._id;
        }
      }

      // Validate business rules before creating clinic
      const validation = await validateClinicBusinessRules(
        new Types.ObjectId(req.tenant_id!),
        isMainClinic,
        parentClinicId
      );

      if (!validation.valid) {
        res.status(400).json({
          success: false,
          message: validation.error
        });
        return;
      }

      // Add tenant_id and clinic hierarchy fields to clinic data
      const clinicData = addTenantToData(req, {
        ...clinicBodyData,
        is_main_clinic: isMainClinic,
        parent_clinic_id: parentClinicId
      });
      
      console.log(`🏥 Creating clinic with data:`, {
        name: clinicData.name,
        tenant_id: clinicData.tenant_id,
        is_main_clinic: clinicData.is_main_clinic,
        parent_clinic_id: clinicData.parent_clinic_id
      });
      
      const clinic = new Clinic(clinicData);
      await clinic.save();
      
      console.log(`✅ Clinic created successfully:`, {
        _id: clinic._id,
        name: clinic.name,
        is_main_clinic: clinic.is_main_clinic,
        parent_clinic_id: clinic.parent_clinic_id
      });

      // Automatically add the creator as admin of the new clinic
      const adminRole = await Role.findOne({ name: 'admin', is_system_role: true });
      
      // Create UserClinic relationship with tenant_id
      const userClinicData = addTenantToData(req, {
        user_id: req.user._id,
        clinic_id: clinic._id,
        roles: adminRole ? [{
          role_id: adminRole._id,
          assigned_at: new Date(),
          assigned_by: req.user._id,
          is_primary: true
        }] : [],
        permission_overrides: [],
        is_active: true
      });
      
      const userClinic = new UserClinic(userClinicData);
      await userClinic.save();

      // Create default appointment statuses for the new clinic
      try {
        await createDefaultStatusesForClinic(
          new mongoose.Types.ObjectId(req.tenant_id!),
          clinic._id
        );
        console.log(`✅ Default appointment statuses created for clinic: ${clinic._id}`);
      } catch (error) {
        console.error('⚠️  Error creating default appointment statuses:', error);
        // Don't fail clinic creation if status creation fails
      }

      // Auto-create warehouses for the new branch/clinic
      try {
        await createDefaultWarehousesForBranch(
          new mongoose.Types.ObjectId(req.tenant_id!),
          clinic._id,
          clinic.name
        );
        console.log(`✅ Default warehouses created for clinic: ${clinic._id}`);
      } catch (error) {
        console.error('⚠️  Error creating default warehouses:', error);
        // Don't fail clinic creation if warehouse creation fails, but log it
        // In production, you might want to rollback or handle this differently
      }

      // Reload clinic to ensure all fields are populated
      const createdClinic = await Clinic.findById(clinic._id)
        .select('name code description address contact settings is_active is_main_clinic parent_clinic_id tenant_id created_at updated_at');

      res.status(201).json({
        success: true,
        message: 'Clinic created successfully',
        data: createdClinic
      });
    } catch (error: any) {
      console.error('Error creating clinic:', error);
      if (error.code === 11000) {
        res.status(400).json({
          success: false,
          message: 'Clinic code already exists'
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Error creating clinic'
        });
      }
    }
  }

  /**
   * Get clinic by ID
   * GET /api/clinics/:id
   */
  static async getClinicById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      // Verify user has access to this clinic
      const userClinic = await UserClinic.findOne({
        user_id: req.user?._id,
        clinic_id: id,
        is_active: true
      });

      if (!userClinic) {
        res.status(403).json({
          success: false,
          message: 'Access denied to this clinic'
        });
        return;
      }

      const clinic = await Clinic.findById(id)
        .select('name code description address contact settings is_active is_main_clinic parent_clinic_id tenant_id created_at updated_at');
      
      if (!clinic) {
        res.status(404).json({
          success: false,
          message: 'Clinic not found'
        });
        return;
      }

      res.json({
        success: true,
        data: clinic
      });
    } catch (error) {
      console.error('Error fetching clinic:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching clinic'
      });
    }
  }

  /**
   * Update clinic
   * PUT /api/clinics/:id
   */
  static async updateClinic(req: AuthRequest, res: Response): Promise<void> {
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

      // Super Admin has unrestricted access - bypass clinic-specific checks
      if (req.user?.role === 'super_admin') {
        // Super Admin can update any clinic
      } else {
        // Verify user is admin of this clinic
        const userClinic = await UserClinic.findOne({
          user_id: req.user?._id,
          clinic_id: id,
          is_active: true
        }).populate('roles.role_id', 'name');

        let hasAdminAccess = false;
        if (userClinic) {
          const userRoles = userClinic.roles.map((role: any) => role.role_id?.name);
          hasAdminAccess = userRoles.includes('admin') || userRoles.includes('super_admin');
        }

        if (!hasAdminAccess) {
          res.status(403).json({
            success: false,
            message: 'Admin access required for this clinic'
          });
          return;
        }
      }

      // Check if clinic exists
      const existingClinic = await Clinic.findById(id);
      if (!existingClinic) {
        res.status(404).json({
          success: false,
          message: 'Clinic not found'
        });
        return;
      }

      // Prevent changing is_main_clinic or parent_clinic_id through update
      // These fields can only be set during creation
      const updateData = { ...req.body };
      delete updateData.is_main_clinic;
      delete updateData.parent_clinic_id;

      // Validate Main Clinic status change
      if (req.body.is_active !== undefined) {
        const statusValidation = validateMainClinicStatus(
          existingClinic.is_main_clinic,
          req.body.is_active
        );
        if (!statusValidation.valid) {
          res.status(400).json({
            success: false,
            message: statusValidation.error
          });
          return;
        }
      }

      const clinic = await Clinic.findByIdAndUpdate(
        id,
        { ...updateData, updated_at: new Date() },
        { new: true, runValidators: true }
      ).select('name code description address contact settings is_active is_main_clinic parent_clinic_id tenant_id created_at updated_at');

      if (!clinic) {
        res.status(404).json({
          success: false,
          message: 'Clinic not found'
        });
        return;
      }

      res.json({
        success: true,
        message: 'Clinic updated successfully',
        data: clinic
      });
    } catch (error: any) {
      console.error('Error updating clinic:', error);
      if (error.code === 11000) {
        res.status(400).json({
          success: false,
          message: 'Clinic code already exists'
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Error updating clinic'
        });
      }
    }
  }

  /**
   * Deactivate clinic (soft delete)
   * DELETE /api/clinics/:id
   */
  static async deactivateClinic(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      // Only super admin can deactivate clinics
      if (req.user?.role !== 'super_admin' && req.user?.role !== 'admin') {
        res.status(403).json({
          success: false,
          message: 'Only super administrators can deactivate clinics'
        });
        return;
      }

      const clinic = await Clinic.findById(id);
      if (!clinic) {
        res.status(404).json({
          success: false,
          message: 'Clinic not found'
        });
        return;
      }

      // Validate Main Clinic deletion rules
      const deletionValidation = await validateMainClinicDeletion(
        clinic._id,
        clinic.tenant_id
      );

      if (!deletionValidation.valid) {
        res.status(400).json({
          success: false,
          message: deletionValidation.error
        });
        return;
      }

      // Prevent disabling Main Clinic
      const statusValidation = validateMainClinicStatus(clinic.is_main_clinic, false);
      if (!statusValidation.valid) {
        res.status(400).json({
          success: false,
          message: statusValidation.error
        });
        return;
      }

      const updatedClinic = await Clinic.findByIdAndUpdate(
        id,
        { is_active: false, updated_at: new Date() },
        { new: true }
      );

      // Deactivate all user-clinic relationships
      await UserClinic.updateMany(
        { clinic_id: id },
        { is_active: false, updated_at: new Date() }
      );

      res.json({
        success: true,
        message: 'Clinic deactivated successfully'
      });
    } catch (error) {
      console.error('Error deactivating clinic:', error);
      res.status(500).json({
        success: false,
        message: 'Error deactivating clinic'
      });
    }
  }

  /**
   * Get clinic statistics
   * GET /api/clinics/:id/stats
   */
  static async getClinicStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      // Verify user has access to this clinic
      const userClinic = await UserClinic.findOne({
        user_id: req.user?._id,
        clinic_id: id,
        is_active: true
      });

      if (!userClinic) {
        res.status(403).json({
          success: false,
          message: 'Access denied to this clinic'
        });
        return;
      }

      // Get clinic users count
      const usersCount = await UserClinic.countDocuments({
        clinic_id: id,
        is_active: true
      });

      // Get users by role
      const usersByRole = await UserClinic.aggregate([
        { $match: { clinic_id: id, is_active: true } },
        { $group: { _id: '$role', count: { $sum: 1 } } }
      ]);

      const clinic = await Clinic.findById(id)
        .select('name code description address contact settings is_active is_main_clinic parent_clinic_id tenant_id created_at updated_at');

      res.json({
        success: true,
        data: {
          clinic_info: {
            name: clinic?.name,
            code: clinic?.code,
            is_main_clinic: clinic?.is_main_clinic,
            parent_clinic_id: clinic?.parent_clinic_id,
            created_at: clinic?.created_at
          },
          users: {
            total: usersCount,
            by_role: usersByRole.reduce((acc, curr) => {
              acc[curr._id] = curr.count;
              return acc;
            }, {})
          }
        }
      });
    } catch (error) {
      console.error('Error fetching clinic stats:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching clinic statistics'
      });
    }
  }

  /**
   * Get clinic users
   * GET /api/clinics/:id/users
   */
  static async getClinicUsers(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { page = 1, limit = 20, role } = req.query;

      // Verify current user is either global admin or admin of this clinic
      const isGlobalAdmin = req.user?.role === 'super_admin' || req.user?.role === 'admin';
      
      let hasPermission = isGlobalAdmin;
      
      if (!hasPermission) {
        const currentUserClinic = await UserClinic.findOne({
          user_id: req.user?._id,
          clinic_id: id,
          is_active: true
        }).populate('roles.role_id', 'name');
        
        if (currentUserClinic) {
          const userRoles = currentUserClinic.roles.map((role: any) => role.role_id?.name);
          hasPermission = userRoles.includes('admin') || userRoles.includes('super_admin');
        }
      }

      if (!hasPermission) {
        res.status(403).json({
          success: false,
          message: 'Admin access required'
        });
        return;
      }

      const filter: any = { clinic_id: id, is_active: true };
      if (role) {
        filter.role = role;
      }

      const users = await UserClinic.find(filter)
        .populate('user_id', 'first_name last_name email phone is_active created_at')
        .sort({ joined_at: 1 })
        .limit(Number(limit) * 1)
        .skip((Number(page) - 1) * Number(limit));

      const total = await UserClinic.countDocuments(filter);

      res.json({
        success: true,
        data: {
          users: users
        },
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      });
    } catch (error) {
      console.error('Error fetching clinic users:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching clinic users'
      });
    }
  }

  /**
   * Get user's clinic access for admin management
   * GET /api/clinics/user/:userId/access
   */
  static async getUserClinicAccess(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      const userClinics = await UserClinic.find({
        user_id: userId,
        is_active: true
      }).populate({
        path: 'clinic_id',
        select: 'name code is_active'
      }).sort({ joined_at: 1 });

      const clinicsWithAccess = userClinics
        .filter(uc => uc.clinic_id)
        .map(uc => uc.clinic_id);

      res.json({
        success: true,
        data: {
          clinics: clinicsWithAccess
        },
        total: clinicsWithAccess.length
      });
    } catch (error) {
      console.error('Error fetching user clinic access:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching user clinic access'
      });
    }
  }

  /**
   * Add user to clinic
   * POST /api/clinics/:id/users
   */
  static async addUserToClinic(req: AuthRequest, res: Response): Promise<void> {
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
      const { user_id, role, permissions } = req.body;

      // Verify current user is either global admin or admin of this clinic
      const isGlobalAdmin = req.user?.role === 'super_admin' || req.user?.role === 'admin';
      
      let hasPermission = isGlobalAdmin;
      
      if (!hasPermission) {
        const currentUserClinic = await UserClinic.findOne({
          user_id: req.user?._id,
          clinic_id: id,
          is_active: true
        }).populate('roles.role_id', 'name');
        
        if (currentUserClinic) {
          const userRoles = currentUserClinic.roles.map((role: any) => role.role_id?.name);
          hasPermission = userRoles.includes('admin') || userRoles.includes('super_admin');
        }
      }

      if (!hasPermission) {
        res.status(403).json({
          success: false,
          message: 'Admin access required'
        });
        return;
      }

      // Check if user exists
      const user = await User.findById(user_id);
      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found'
        });
        return;
      }

      // Check if user is already associated with this clinic
      const existingRelation = await UserClinic.findOne({
        user_id,
        clinic_id: id
      });

      if (existingRelation) {
        if (existingRelation.is_active) {
          res.status(400).json({
            success: false,
            message: 'User is already associated with this clinic'
          });
          return;
        } else {
          // Reactivate existing relationship with new role system and ensure tenant_id
          // Get the role object by name
          const roleObj = await Role.findOne({ name: role.toLowerCase() });
          if (roleObj && req.user) {
            await existingRelation.assignRole(roleObj._id, req.user._id, true);
          }
          
          // Ensure tenant_id is set if missing
          if (!existingRelation.tenant_id && req.tenant_id) {
            existingRelation.tenant_id = new mongoose.Types.ObjectId(req.tenant_id);
          }
          
          existingRelation.is_active = true;
          await existingRelation.save();

          res.json({
            success: true,
            message: 'User association reactivated',
            data: existingRelation
          });
          return;
        }
      }

      // Find the role by name
      const roleDoc = await Role.findOne({ name: role.toLowerCase(), is_system_role: true });
      
      if (!roleDoc) {
        res.status(400).json({
          success: false,
          message: `Role '${role}' not found`
        });
        return;
      }

      // Create new user-clinic relationship with proper role structure and tenant context
      const userClinicData = addTenantToData(req, {
        user_id,
        clinic_id: id,
        roles: [{
          role_id: roleDoc._id,
          assigned_at: new Date(),
          assigned_by: req.user!._id,
          is_primary: true
        }],
        permission_overrides: permissions ? permissions.map((perm: any) => ({
          permission_name: perm,
          granted: true,
          granted_at: new Date(),
          granted_by: req.user!._id
        })) : [],
        is_active: true
      });

      const userClinic = new UserClinic(userClinicData);

      await userClinic.save();

      res.status(201).json({
        success: true,
        message: 'User added to clinic successfully',
        data: userClinic
      });
    } catch (error: any) {
      console.error('Error adding user to clinic:', error);
      res.status(500).json({
        success: false,
        message: 'Error adding user to clinic',
        error: error.message
      });
    }
  }

  /**
   * Update user role/permissions in clinic
   * PUT /api/clinics/:id/users/:userId
   */
  static async updateUserInClinic(req: AuthRequest, res: Response): Promise<void> {
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

      const { id, userId } = req.params;
      const { role, permissions } = req.body;

      // Verify current user is either global admin or admin of this clinic
      const isGlobalAdmin = req.user?.role === 'super_admin' || req.user?.role === 'admin';
      
      let hasPermission = isGlobalAdmin;
      
      if (!hasPermission) {
        const currentUserClinic = await UserClinic.findOne({
          user_id: req.user?._id,
          clinic_id: id,
          is_active: true
        }).populate('roles.role_id', 'name');
        
        if (currentUserClinic) {
          const userRoles = currentUserClinic.roles.map((role: any) => role.role_id?.name);
          hasPermission = userRoles.includes('admin') || userRoles.includes('super_admin');
        }
      }

      if (!hasPermission) {
        res.status(403).json({
          success: false,
          message: 'Admin access required'
        });
        return;
      }

      const userClinic = await UserClinic.findOneAndUpdate(
        { user_id: userId, clinic_id: id, is_active: true },
        { role, permissions: permissions || [], updated_at: new Date() },
        { new: true }
      ).populate('user_id', 'first_name last_name email');

      if (!userClinic) {
        res.status(404).json({
          success: false,
          message: 'User not found in this clinic'
        });
        return;
      }

      res.json({
        success: true,
        message: 'User updated successfully',
        data: userClinic
      });
    } catch (error) {
      console.error('Error updating user in clinic:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating user'
      });
    }
  }

  /**
   * Remove user from clinic
   * DELETE /api/clinics/:id/users/:userId
   */
  static async removeUserFromClinic(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id, userId } = req.params;

      // Verify current user is either global admin or admin of this clinic
      const isGlobalAdmin = req.user?.role === 'super_admin' || req.user?.role === 'admin';
      
      let hasPermission = isGlobalAdmin;
      
      if (!hasPermission) {
        const currentUserClinic = await UserClinic.findOne({
          user_id: req.user?._id,
          clinic_id: id,
          is_active: true
        }).populate('roles.role_id', 'name');
        
        if (currentUserClinic) {
          const userRoles = currentUserClinic.roles.map((role: any) => role.role_id?.name);
          hasPermission = userRoles.includes('admin') || userRoles.includes('super_admin');
        }
      }

      if (!hasPermission) {
        res.status(403).json({
          success: false,
          message: 'Admin access required'
        });
        return;
      }

      // Prevent removing yourself as admin if you're the only admin
      if (userId === req.user?._id.toString()) {
        // Count admin users in this clinic using role system
        const adminUserClinics = await UserClinic.find({
          clinic_id: id,
          is_active: true
        }).populate('roles.role_id', 'name');

        let adminCount = 0;
        for (const uc of adminUserClinics) {
          const userRoles = uc.roles.map((role: any) => role.role_id?.name);
          if (userRoles.includes('admin') || userRoles.includes('super_admin')) {
            adminCount++;
          }
        }

        if (adminCount <= 1) {
          res.status(400).json({
            success: false,
            message: 'Cannot remove yourself as the only admin'
          });
          return;
        }
      }

      const userClinic = await UserClinic.findOneAndUpdate(
        { user_id: userId, clinic_id: id },
        { is_active: false, updated_at: new Date() },
        { new: true }
      );

      if (!userClinic) {
        res.status(404).json({
          success: false,
          message: 'User not found in this clinic'
        });
        return;
      }

      res.json({
        success: true,
        message: 'User removed from clinic successfully'
      });
    } catch (error) {
      console.error('Error removing user from clinic:', error);
      res.status(500).json({
        success: false,
        message: 'Error removing user from clinic'
      });
    }
  }
}

/**
 * Helper function to create default warehouse for a new branch/clinic
 * Rule: Each branch must have exactly ONE MAIN warehouse (default warehouse)
 * Only the MAIN warehouse is created automatically - SUB warehouses can be created manually if needed
 */
async function createDefaultWarehousesForBranch(
  tenantId: Types.ObjectId,
  branchId: Types.ObjectId,
  branchName: string
): Promise<void> {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Check if MAIN warehouse already exists for this branch
    const existingMainWarehouse = await Warehouse.findOne({
      tenant_id: tenantId,
      assignedBranches: branchId,
      type: 'MAIN',
      deleted_at: null
    }).session(session);

    // Create MAIN warehouse if it doesn't exist (this is the default warehouse)
    if (!existingMainWarehouse) {
      const mainWarehouse = new Warehouse({
        tenant_id: tenantId,
        name: `${branchName} - Main Warehouse`,
        type: 'MAIN',
        status: 'ACTIVE',
        assignedBranches: [branchId]
      });
      await mainWarehouse.save({ session });
      console.log(`✅ Created default MAIN warehouse for branch: ${branchName}`);
    }

    await session.commitTransaction();
  } catch (error: any) {
    await session.abortTransaction();
    console.error('Error creating default warehouse:', error);
    throw error;
  } finally {
    session.endSession();
  }
} 