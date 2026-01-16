# Multi-Clinic Administrative Hierarchy - Business Rules Documentation

## Overview
This document outlines all business rules implemented for the Main/Sub Clinic hierarchy system.

## Core Concepts

### Tenant
- **Definition**: Organizational boundary
- **Scope**: All clinics belong to a tenant
- **Isolation**: Data is isolated per tenant

### Main Clinic
- **Definition**: Administrative clinic per tenant (only one)
- **Rules**:
  - Only ONE Main Clinic allowed per Tenant
  - Cannot be deleted if it's the only clinic in the organization
  - Cannot be disabled
  - Must have `parent_clinic_id = null`
  - Automatically assigned when first clinic is created in tenant

### Sub Clinic
- **Definition**: Fully independent clinic with its own data
- **Rules**:
  - Must reference Main Clinic via `parent_clinic_id`
  - Cannot create other clinics
  - Can be disabled/deleted
  - Fully independent data storage

### Data Independence
- **Rule**: No data inheritance or data sharing between clinics
- **Implementation**: All models filter by `clinic_id` to ensure complete data isolation

## Data Model Structure

### Clinic Model Fields
```typescript
{
  tenant_id: ObjectId,           // Required - Tenant boundary
  is_main_clinic: boolean,       // Required - true for only one clinic per tenant
  parent_clinic_id: ObjectId | null, // Required - null for Main, Main Clinic ID for Sub
  is_active: boolean,            // Required - Existing field
  // ... other fields
}
```

## Mandatory Business Rules

### 1. Only One Main Clinic Per Tenant
- **Backend Validation**: 
  - Model pre-save middleware checks uniqueness
  - `validateMainClinicUniqueness()` utility function
  - Controller validates before creation
- **Frontend**: Automatically handled by backend

### 2. Main Clinic Must Have parent_clinic_id = null
- **Backend Validation**:
  - Schema validation in model
  - `validateClinicHierarchy()` utility function
- **Frontend**: Not applicable (backend sets this)

### 3. Sub Clinics Must Reference Main Clinic
- **Backend Validation**:
  - Schema validation in model
  - `validateParentClinic()` utility function
  - Controller ensures parent exists and is Main Clinic
- **Frontend**: Not applicable (backend sets this)

### 4. First Clinic Becomes Main Clinic Automatically
- **Implementation**: `createClinic()` controller logic
- **Flow**:
  1. Check if tenant has existing Main Clinic
  2. If no Main Clinic exists → Create as Main Clinic
  3. If Main Clinic exists → Check user's clinic membership
  4. If user belongs to Main Clinic → Create as Sub Clinic
  5. If user belongs to Sub Clinic → Block creation

### 5. Sub Clinics Cannot Create Other Clinics
- **Backend Validation**: `createClinic()` controller
- **Error Message**: "Sub Clinics are not allowed to create other clinics"

### 6. Main Clinic Cannot Be Deleted If Only One Exists
- **Backend Validation**: `validateMainClinicDeletion()` utility
- **Error Message**: "Cannot delete Main Clinic. It is the only clinic in the organization."

### 7. Main Clinic Cannot Be Disabled
- **Backend Validation**: `validateMainClinicStatus()` utility
- **Frontend Validation**: `handleToggleStatus()` prevents disabling
- **Error Message**: "Cannot disable Main Clinic. It is the primary administrative clinic for your organization."

### 8. Frontend Must NOT Send is_main_clinic or parent_clinic_id
- **Backend**: Controller removes these fields if accidentally sent
- **Frontend**: Modals do not include these fields in form data

### 9. Clinic Type Tag Display
- **Frontend**: 
  - Dedicated "Type" column in clinics table
  - Visual badges: Crown icon for Main Clinic, Building icon for Sub Clinic
  - Statistics card showing Main/Sub clinic counts

### 10. Data Independence Between Clinics
- **Implementation**: All queries filter by `clinic_id`
- **Models**: Patient, Appointment, Prescription, Invoice, Payment, TestReport, MedicalRecord, Odontogram, etc.
- **Middleware**: `getClinicScopedFilter()` ensures clinic isolation

## API Endpoints

### POST /api/clinics
- **Business Logic**:
  - Frontend sends only basic clinic data
  - Backend determines clinic type automatically
  - Validates all business rules before creation

### PUT /api/clinics/:id
- **Restrictions**:
  - Cannot change `is_main_clinic`
  - Cannot change `parent_clinic_id`
  - Cannot disable Main Clinic

### DELETE /api/clinics/:id
- **Restrictions**:
  - Cannot delete Main Clinic if only one exists
  - Cannot disable Main Clinic

## Validation Functions

All validation functions are in `clinc_backend/src/utils/clinicValidation.ts`:

1. `validateMainClinicUniqueness()` - Ensures only one Main Clinic per tenant
2. `validateClinicHierarchy()` - Validates parent_clinic_id rules
3. `validateParentClinic()` - Ensures parent clinic is valid Main Clinic
4. `validateMainClinicDeletion()` - Prevents deleting only Main Clinic
5. `validateMainClinicStatus()` - Prevents disabling Main Clinic
6. `validateClinicBusinessRules()` - Comprehensive validation for all rules

## Migration

### Setting Main Clinics for Existing Data
Run migration script to set first clinic as Main Clinic for existing tenants:
```bash
npm run ts-node src/migrations/setMainClinics.ts
```

This migration:
- Finds first (oldest) clinic per tenant
- Sets it as Main Clinic (`is_main_clinic: true, parent_clinic_id: null`)
- Sets all other clinics as Sub Clinics with proper `parent_clinic_id` references

## Testing Checklist

- [ ] Only one Main Clinic per tenant
- [ ] Main Clinic has parent_clinic_id = null
- [ ] Sub Clinic has parent_clinic_id set to Main Clinic
- [ ] First clinic becomes Main Clinic automatically
- [ ] Sub Clinic users cannot create clinics
- [ ] Main Clinic users can create Sub Clinics
- [ ] Main Clinic cannot be deleted if only one exists
- [ ] Main Clinic cannot be disabled
- [ ] Frontend does not send is_main_clinic or parent_clinic_id
- [ ] Clinic type tags display correctly
- [ ] Data is isolated per clinic (no sharing)

## Notes

- All clinics store and manage their data independently
- No data inheritance or data sharing between clinics
- Main Clinic has administrative visibility but no data access to Sub Clinics
- Each clinic manages its own: Patients, Appointments, Prescriptions, Invoices, etc.
