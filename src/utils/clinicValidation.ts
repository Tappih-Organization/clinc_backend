import { Types } from 'mongoose';
import { Clinic } from '../models';

/**
 * Business Rules Validation Utilities for Clinic Hierarchy
 */

/**
 * Validate that only one Main Clinic exists per Tenant
 */
export const validateMainClinicUniqueness = async (
  tenantId: Types.ObjectId,
  excludeClinicId?: Types.ObjectId
): Promise<{ valid: boolean; error?: string }> => {
  const filter: any = {
    tenant_id: tenantId,
    is_main_clinic: true,
    is_active: true
  };

  if (excludeClinicId) {
    filter._id = { $ne: excludeClinicId };
  }

  const existingMainClinic = await Clinic.findOne(filter);

  if (existingMainClinic) {
    return {
      valid: false,
      error: 'Only one Main Clinic is allowed per Tenant'
    };
  }

  return { valid: true };
};

/**
 * Validate Main Clinic rules:
 * - Main Clinic must have parent_clinic_id = null
 * - Sub Clinic must have parent_clinic_id set
 */
export const validateClinicHierarchy = (
  isMainClinic: boolean,
  parentClinicId: Types.ObjectId | null
): { valid: boolean; error?: string } => {
  if (isMainClinic && parentClinicId !== null) {
    return {
      valid: false,
      error: 'Main Clinic must have parent_clinic_id = null'
    };
  }

  if (!isMainClinic && parentClinicId === null) {
    return {
      valid: false,
      error: 'Sub Clinic must reference Main Clinic via parent_clinic_id'
    };
  }

  return { valid: true };
};

/**
 * Validate that parent_clinic_id references a valid Main Clinic
 */
export const validateParentClinic = async (
  parentClinicId: Types.ObjectId,
  tenantId: Types.ObjectId
): Promise<{ valid: boolean; error?: string }> => {
  const parentClinic = await Clinic.findOne({
    _id: parentClinicId,
    tenant_id: tenantId,
    is_main_clinic: true,
    is_active: true
  });

  if (!parentClinic) {
    return {
      valid: false,
      error: 'Parent clinic must be a valid Main Clinic in the same tenant'
    };
  }

  return { valid: true };
};

/**
 * Validate that Main Clinic cannot be deleted if it's the only clinic
 */
export const validateMainClinicDeletion = async (
  clinicId: Types.ObjectId,
  tenantId: Types.ObjectId
): Promise<{ valid: boolean; error?: string }> => {
  const clinic = await Clinic.findById(clinicId);

  if (!clinic) {
    return {
      valid: false,
      error: 'Clinic not found'
    };
  }

  if (!clinic.is_main_clinic) {
    return { valid: true }; // Sub clinics can be deleted
  }

  const tenantClinicsCount = await Clinic.countDocuments({
    tenant_id: tenantId,
    is_active: true
  });

  if (tenantClinicsCount === 1) {
    return {
      valid: false,
      error: 'Cannot delete Main Clinic. It is the only clinic in the organization.'
    };
  }

  return { valid: true };
};

/**
 * Validate that Main Clinic cannot be disabled
 */
export const validateMainClinicStatus = (
  isMainClinic: boolean,
  isActive: boolean
): { valid: boolean; error?: string } => {
  if (isMainClinic && !isActive) {
    return {
      valid: false,
      error: 'Cannot disable Main Clinic. It is the primary administrative clinic for your organization.'
    };
  }

  return { valid: true };
};

/**
 * Comprehensive validation for clinic creation/update
 */
export const validateClinicBusinessRules = async (
  tenantId: Types.ObjectId,
  isMainClinic: boolean,
  parentClinicId: Types.ObjectId | null,
  clinicId?: Types.ObjectId
): Promise<{ valid: boolean; error?: string }> => {
  // Validate hierarchy rules
  const hierarchyValidation = validateClinicHierarchy(isMainClinic, parentClinicId);
  if (!hierarchyValidation.valid) {
    return hierarchyValidation;
  }

  // Validate Main Clinic uniqueness (only for new main clinics or when updating to main)
  if (isMainClinic) {
    const uniquenessValidation = await validateMainClinicUniqueness(tenantId, clinicId);
    if (!uniquenessValidation.valid) {
      return uniquenessValidation;
    }
  }

  // Validate parent clinic exists and is Main Clinic (for sub clinics)
  if (!isMainClinic && parentClinicId) {
    const parentValidation = await validateParentClinic(parentClinicId, tenantId);
    if (!parentValidation.valid) {
      return parentValidation;
    }
  }

  return { valid: true };
};
