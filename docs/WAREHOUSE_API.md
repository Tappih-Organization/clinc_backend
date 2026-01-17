# Warehouse Management API Documentation

## Overview

This document describes the Warehouse Management APIs for the Clinic Management SaaS system. The warehouse system supports multi-tenant architecture with branch/clinic assignments and real-time updates.

## Core Features

- **Warehouse Types**: MAIN / SUB
- **Status**: ACTIVE / INACTIVE
- **Many-to-Many Branch Assignment**: Warehouses can be assigned to multiple branches/clinics
- **Auto-Creation**: When a branch is created, MAIN + SUB warehouses are automatically created
- **Real-time Updates**: Events are emitted for warehouse operations
- **Soft Delete**: Warehouses are soft-deleted (deleted_at field)

## Business Rules

### Mandatory Warehouse Creation Rules

1. **Default MAIN Warehouse**: When a new Branch/Clinic is created:
   - Auto-create 1 MAIN warehouse (ACTIVE) as the default warehouse
   - Auto-assign it to the created branch
   - Name format: `{BranchName} - Main Warehouse`
   - SUB warehouses are NOT created automatically - they can be created manually if needed

2. **Exactly ONE MAIN Warehouse per Branch**:
   - For every branch/clinic, ensure exactly ONE MAIN warehouse exists
   - On branch creation, auto-create:
     - 1 MAIN warehouse (ACTIVE) only
   - SUB warehouses can be created manually through the API if needed

3. **Clinic Context Filtering**:
   - When viewing warehouses, only warehouses assigned to the current clinic context are shown
   - This ensures users only see warehouses relevant to their current clinic
   - The `branchId` query parameter can override this to show warehouses from a specific branch

4. **Constraints**:
   - A branch cannot have 0 MAIN warehouses
   - A branch cannot have more than 1 MAIN warehouse
   - DB constraints + transactions guarantee consistency

## API Endpoints

### Base URL
```
/api/warehouses
```

All endpoints require authentication and tenant context.

---

### 1. Get All Warehouses

**GET** `/api/warehouses`

Get a paginated list of warehouses with filtering, search, and sorting.

**Note**: By default, warehouses are filtered by the current clinic context (from `X-Clinic-Id` header). Only warehouses assigned to the current clinic are returned. Use the `branchId` query parameter to override this behavior.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | number | No | Page number (default: 1) |
| `limit` | number | No | Items per page (default: 10, max: 100) |
| `search` | string | No | Search by warehouse name (case-insensitive) |
| `type` | string | No | Filter by type: `MAIN` or `SUB` |
| `status` | string | No | Filter by status: `ACTIVE` or `INACTIVE` |
| `branchId` | string | No | Filter by assigned branch ID (MongoDB ObjectId). Overrides clinic context filtering. |
| `sortBy` | string | No | Field to sort by (default: `created_at`) |
| `sortOrder` | string | No | Sort order: `asc` or `desc` (default: `desc`) |

#### Example Request

```bash
GET /api/warehouses?page=1&limit=10&type=MAIN&status=ACTIVE&branchId=507f1f77bcf86cd799439011
```

#### Example Response

```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "Main Clinic - Main Warehouse",
      "type": "MAIN",
      "status": "ACTIVE",
      "assignedBranches": [
        {
          "_id": "507f1f77bcf86cd799439012",
          "name": "Main Clinic",
          "code": "CLN001"
        }
      ],
      "managerUserId": {
        "_id": "507f1f77bcf86cd799439013",
        "fullName": "John Doe",
        "email": "john@example.com",
        "role": "admin"
      },
      "created_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-01-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "totalPages": 3
  }
}
```

---

### 2. Get Warehouse by ID

**GET** `/api/warehouses/:id`

Get a single warehouse by its ID.

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Warehouse ID (MongoDB ObjectId) |

#### Example Request

```bash
GET /api/warehouses/507f1f77bcf86cd799439011
```

#### Example Response

```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Main Clinic - Main Warehouse",
    "type": "MAIN",
    "status": "ACTIVE",
    "assignedBranches": [...],
    "managerUserId": {...},
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-15T10:30:00.000Z"
  }
}
```

---

### 3. Create Warehouse

**POST** `/api/warehouses`

Create a new warehouse.

#### Request Body

```json
{
  "name": "Central Warehouse",
  "type": "SUB",
  "status": "ACTIVE",
  "assignedBranches": ["507f1f77bcf86cd799439012"],
  "managerUserId": "507f1f77bcf86cd799439013"
}
```

#### Body Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Warehouse name |
| `type` | string | Yes | Warehouse type: `MAIN` or `SUB` |
| `status` | string | No | Status: `ACTIVE` or `INACTIVE` (default: `ACTIVE`) |
| `assignedBranches` | array | Yes | Array of branch IDs (at least one required) |
| `managerUserId` | string | No | Manager user ID (optional) |

#### Validation Rules

- `name`: Required, 2-200 characters
- `type`: Must be `MAIN` or `SUB`
- `assignedBranches`: Must be an array with at least one valid branch ID
- If `type` is `MAIN`, each branch in `assignedBranches` must not already have a MAIN warehouse

#### Example Response

```json
{
  "success": true,
  "message": "Warehouse created successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Central Warehouse",
    "type": "SUB",
    "status": "ACTIVE",
    "assignedBranches": [...],
    "managerUserId": {...},
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-15T10:30:00.000Z"
  }
}
```

---

### 4. Update Warehouse

**PUT** `/api/warehouses/:id`

Update an existing warehouse.

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Warehouse ID (MongoDB ObjectId) |

#### Request Body

All fields are optional:

```json
{
  "name": "Updated Warehouse Name",
  "type": "MAIN",
  "status": "INACTIVE",
  "assignedBranches": ["507f1f77bcf86cd799439012", "507f1f77bcf86cd799439014"],
  "managerUserId": "507f1f77bcf86cd799439013"
}
```

#### Example Response

```json
{
  "success": true,
  "message": "Warehouse updated successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Updated Warehouse Name",
    "type": "MAIN",
    "status": "INACTIVE",
    "assignedBranches": [...],
    "managerUserId": {...},
    "updated_at": "2024-01-15T11:00:00.000Z"
  }
}
```

---

### 5. Update Warehouse Status

**PATCH** `/api/warehouses/:id/status`

Update only the warehouse status.

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Warehouse ID (MongoDB ObjectId) |

#### Request Body

```json
{
  "status": "INACTIVE"
}
```

#### Example Response

```json
{
  "success": true,
  "message": "Warehouse status updated successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "status": "INACTIVE",
    ...
  }
}
```

---

### 6. Delete Warehouse

**DELETE** `/api/warehouses/:id`

Soft delete a warehouse (sets `deleted_at` and `status` to `INACTIVE`).

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Warehouse ID (MongoDB ObjectId) |

#### Example Response

```json
{
  "success": true,
  "message": "Warehouse deleted successfully"
}
```

---

## Inventory Items API Updates

### Get All Inventory Items

**GET** `/api/inventory`

Now supports branch filtering:

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `branchId` | string | No | Filter items by assigned branch ID |

#### Example Request

```bash
GET /api/inventory?branchId=507f1f77bcf86cd799439012&page=1&limit=10
```

### Create Inventory Item

**POST** `/api/inventory`

Now supports branch assignment:

#### Request Body

```json
{
  "name": "Paracetamol 500mg",
  "category": "medications",
  "sku": "PAR500",
  "current_stock": 100,
  "minimum_stock": 20,
  "unit_price": 0.25,
  "supplier": "PharmaCorp",
  "assignedBranches": ["507f1f77bcf86cd799439012", "507f1f77bcf86cd799439014"]
}
```

### Update Inventory Item

**PUT** `/api/inventory/:id`

Now supports updating branch assignments:

#### Request Body

```json
{
  "assignedBranches": ["507f1f77bcf86cd799439012"]
}
```

---

## Real-time Events

The system emits events for warehouse operations. These can be consumed via WebSockets or SSE (to be implemented).

### Event Types

- `warehouse.created` - New warehouse created
- `warehouse.updated` - Warehouse updated
- `warehouse.deleted` - Warehouse deleted (soft delete)
- `warehouse.statusChanged` - Warehouse status changed
- `warehouse.branchesAssigned` - Branch assignments changed

### Event Structure

```json
{
  "type": "warehouse.created",
  "warehouse": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Main Warehouse",
    ...
  },
  "timestamp": "2024-01-15T10:30:00.000Z",
  "tenantId": "507f1f77bcf86cd799439010"
}
```

---

## Error Responses

### 400 Bad Request

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "name",
      "message": "Warehouse name is required"
    }
  ]
}
```

### 404 Not Found

```json
{
  "success": false,
  "message": "Warehouse not found"
}
```

### 400 Business Rule Violation

```json
{
  "success": false,
  "message": "Branch 507f1f77bcf86cd799439012 already has a MAIN warehouse. Each branch can have exactly ONE MAIN warehouse."
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "message": "Error creating warehouse"
}
```

---

## Auto-Creation on Branch Creation

When a new branch/clinic is created via `POST /api/clinics`, the system automatically:

1. Creates 1 MAIN warehouse (ACTIVE) as the default warehouse
   - Name: `{BranchName} - Main Warehouse`
   - Assigned to the new branch
   - This is the only warehouse created automatically

2. SUB warehouses are NOT created automatically
   - They can be created manually through the API if needed
   - This ensures a clean default state with only one warehouse per clinic

This happens in a database transaction to ensure consistency.

---

## Notes

- All endpoints are tenant-scoped (multi-tenant isolation)
- All endpoints require authentication
- Soft delete is used (warehouses are not permanently deleted)
- MAIN warehouse constraint is enforced at the database and application level
- Real-time events are emitted but WebSocket/SSE integration needs to be configured
