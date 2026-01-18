/**
 * Warehouse Events Utility
 * 
 * This module handles real-time events for warehouse operations.
 * Can be extended to use WebSockets, SSE, or other real-time technologies.
 */

import { IWarehouse } from '../models/Warehouse';

export type WarehouseEventType = 
  | 'warehouse.created'
  | 'warehouse.updated'
  | 'warehouse.deleted'
  | 'warehouse.statusChanged'
  | 'warehouse.branchesAssigned';

export interface WarehouseEvent {
  type: WarehouseEventType;
  warehouse: IWarehouse;
  timestamp: Date;
  tenantId: string;
}

// Event emitter storage (can be replaced with actual EventEmitter or WebSocket)
const eventListeners: Map<WarehouseEventType, Array<(event: WarehouseEvent) => void>> = new Map();

/**
 * Emit a warehouse event
 * This can be extended to use WebSockets, SSE, or other real-time technologies
 */
export function emitWarehouseEvent(
  type: WarehouseEventType,
  warehouse: IWarehouse,
  tenantId: string
): void {
  const event: WarehouseEvent = {
    type,
    warehouse,
    timestamp: new Date(),
    tenantId
  };

  // Log event (for debugging)
  console.log(`📢 Warehouse Event: ${type}`, {
    warehouseId: warehouse._id,
    warehouseName: warehouse.name,
    tenantId
  });

  // Notify all listeners for this event type
  const listeners = eventListeners.get(type) || [];
  listeners.forEach(listener => {
    try {
      listener(event);
    } catch (error) {
      console.error(`Error in warehouse event listener for ${type}:`, error);
    }
  });

  // TODO: Integrate with WebSocket/SSE server here
  // Example:
  // io.to(`tenant:${tenantId}`).emit('warehouse:event', event);
}

/**
 * Subscribe to warehouse events
 */
export function onWarehouseEvent(
  type: WarehouseEventType,
  listener: (event: WarehouseEvent) => void
): () => void {
  if (!eventListeners.has(type)) {
    eventListeners.set(type, []);
  }
  
  eventListeners.get(type)!.push(listener);

  // Return unsubscribe function
  return () => {
    const listeners = eventListeners.get(type) || [];
    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  };
}

/**
 * Remove all event listeners (useful for testing or cleanup)
 */
export function removeAllWarehouseEventListeners(): void {
  eventListeners.clear();
}
